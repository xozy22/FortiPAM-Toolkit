"""Schlanker REST-Client für die FortiPAM CMDB-API (FortiOS-Stil, /api/v2)."""
from __future__ import annotations

import time

import httpx

from .i18n import tr

_RETRY_STATUS = {429}
_RETRY_DELAYS = (1.0, 2.0, 4.0)   # Backoff bei "Too many requests"


class FortiPAMError(Exception):
    """Fehler bei der Kommunikation mit FortiPAM."""


_HTTP_HINTS = {
    401: "Nicht autorisiert – API-Token prüfen.",
    403: "Zugriff verweigert – Berechtigungen (accprofile) und Trusted Hosts des API-Users prüfen.",
    404: "Pfad nicht gefunden – Basis-URL prüfen.",
    405: "Methode nicht erlaubt.",
    424: "Abhängigkeit fehlt – ein referenziertes Objekt (Template, Ordner, Tag …) existiert nicht.",
    429: "Zu viele Anfragen – kurz warten und erneut versuchen.",
    500: "Interner Fehler auf dem FortiPAM (Details siehe cli_error).",
}


class FortiPAMClient:
    def __init__(self, base_url: str, token: str, verify_ssl: bool = False,
                 vdom: str = "", timeout: float = 25.0):
        self.base_url = base_url.rstrip("/")
        self.vdom = (vdom or "").strip()
        self._client = httpx.Client(
            verify=verify_ssl,
            timeout=timeout,
            headers={"Authorization": f"Bearer {token}"},
        )

    def close(self) -> None:
        try:
            self._client.close()
        except Exception:
            pass

    # ------------------------------------------------------------------
    def request(self, method: str, path: str, params: dict | None = None,
                body: dict | None = None, override: str | None = None) -> dict:
        params = dict(params or {})
        if self.vdom:
            params["vdom"] = self.vdom
        url = f"{self.base_url}/api/v2/{path.lstrip('/')}"
        headers = {"X-HTTP-Method-Override": override} if override else None
        try:
            resp = self._client.request(method, url, params=params, json=body,
                                        headers=headers)
            # Rate-Limit: mit Backoff erneut versuchen
            for delay in _RETRY_DELAYS:
                if resp.status_code not in _RETRY_STATUS:
                    break
                time.sleep(delay)
                resp = self._client.request(method, url, params=params, json=body,
                                            headers=headers)
        except httpx.ConnectError as exc:
            raise FortiPAMError(tr("Verbindung fehlgeschlagen: {exc}", exc=exc)) from exc
        except httpx.TimeoutException as exc:
            raise FortiPAMError(tr("Zeitüberschreitung bei der Anfrage an FortiPAM.")) from exc
        except httpx.HTTPError as exc:
            raise FortiPAMError(tr("HTTP-Fehler: {exc}", exc=exc)) from exc

        try:
            data = resp.json()
        except ValueError:
            data = {}
        if not isinstance(data, dict):
            data = {"results": data}

        if resp.status_code >= 400 or data.get("status") == "error":
            raise FortiPAMError(self._describe_error(resp.status_code, data))
        return data

    @staticmethod
    def _describe_error(status_code: int, data: dict) -> str:
        parts = [f"HTTP {status_code}"]
        for key in ("cli_error", "error_description", "message"):
            val = data.get(key)
            if val:
                parts.append(str(val).strip())
                break
        err = data.get("error")
        if isinstance(err, str) and err.strip() and not err.strip().lstrip("-").isdigit():
            # FortiPAM liefert hier teils Klartext (z. B. "Missing field in payload: 'x'")
            parts.append(err.strip())
        elif err not in (None, 0, "0", ""):
            parts.append(tr("Fehlercode {err}", err=err))
        hint = _HTTP_HINTS.get(status_code)
        if hint:
            parts.append(tr(hint))
        return " — ".join(parts)

    # ------------------------------------------------------------------
    def list_table(self, path: str, fmt: str | None = None,
                   page_size: int = 500) -> tuple[list, dict]:
        """Liest eine CMDB-Tabelle seitenweise; gibt (results, envelope) zurück.

        FortiPAM verweigert bei secret/target und secret/template das normale
        Collection-GET ("Unable to get mkey from uri"). Die GUI listet diese
        Tabellen per POST mit X-HTTP-Method-Override: GET und dem Body
        {"json_filter": []} — das nutzen wir hier als Fallback (ungepaged,
        die Route liefert die vollständige Liste).
        """
        params = {"format": fmt} if fmt else {}
        try:
            return self._list_paged(path, params, page_size)
        except FortiPAMError as first_exc:
            if "Unable to get mkey" not in str(first_exc):
                raise
            try:
                data = self.request("POST", f"cmdb/{path}", params=params or None,
                                    body={"json_filter": []}, override="GET")
            except FortiPAMError:
                raise first_exc from None
            results = data.get("results", [])
            if not isinstance(results, list):
                results = [results]
            return results, data

    def _list_paged(self, path: str, params: dict, page_size: int) -> tuple[list, dict]:
        """Chunk-weises GET mit start/count (wichtig bei großen Beständen)."""
        rows: list = []
        envelope: dict | None = None
        start = 0
        while True:
            page = dict(params)
            page.update({"start": start, "count": page_size})
            data = self.request("GET", f"cmdb/{path}", params=page)
            if envelope is None:
                envelope = data
            chunk = data.get("results", [])
            if not isinstance(chunk, list):
                chunk = [chunk]
            rows.extend(chunk)
            if len(chunk) < page_size:
                break
            size = data.get("size")
            if isinstance(size, int) and len(rows) >= size:
                break
            start += page_size
        return rows, envelope or {}

    def get_by_mkey(self, path: str, mkey) -> dict | None:
        """Liest einen einzelnen Tabelleneintrag. None bei 404 (nicht vorhanden).

        Wichtig für FortiPAM: secret/target und secret/template erlauben kein
        Auflisten über die REST-API, Einzelzugriff per mkey funktioniert aber.
        """
        from urllib.parse import quote
        try:
            data = self.request("GET", f"cmdb/{path}/{quote(str(mkey), safe='')}")
        except FortiPAMError as exc:
            if "HTTP 404" in str(exc):
                return None
            raise
        results = data.get("results")
        if isinstance(results, list):
            return results[0] if results else None
        return results

    def create(self, path: str, body: dict) -> dict:
        return self.request("POST", f"cmdb/{path}", body=body)

    def delete(self, path: str, mkey) -> dict:
        from urllib.parse import quote
        return self.request("DELETE", f"cmdb/{path}/{quote(str(mkey), safe='')}")

    def dup_check(self, username: str, target_addr: str) -> tuple[bool, str]:
        """Geräteseitige Duplikat-Prüfung: existiert bereits ein Secret mit
        diesem Benutzernamen auf der Ziel-Adresse? (Internal-API, liefert
        409 bei Duplikat, 200 sonst.)"""
        try:
            data = self.request("POST", "internal/secret-dup-check",
                                body={"username": username, "target_addr": target_addr})
            return False, str(data.get("msg") or "")
        except FortiPAMError as exc:
            if "HTTP 409" in str(exc):
                msg = str(exc).replace("HTTP 409 — ", "").strip()
                return True, msg
            raise
