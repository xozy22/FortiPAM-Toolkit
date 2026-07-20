"""Schlanker REST-Client für die FortiPAM CMDB-API (FortiOS-Stil, /api/v2)."""
from __future__ import annotations

import time

import httpx

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
                body: dict | None = None) -> dict:
        params = dict(params or {})
        if self.vdom:
            params["vdom"] = self.vdom
        url = f"{self.base_url}/api/v2/{path.lstrip('/')}"
        try:
            resp = self._client.request(method, url, params=params, json=body)
            # Rate-Limit: mit Backoff erneut versuchen
            for delay in _RETRY_DELAYS:
                if resp.status_code not in _RETRY_STATUS:
                    break
                time.sleep(delay)
                resp = self._client.request(method, url, params=params, json=body)
        except httpx.ConnectError as exc:
            raise FortiPAMError(f"Verbindung fehlgeschlagen: {exc}") from exc
        except httpx.TimeoutException as exc:
            raise FortiPAMError("Zeitüberschreitung bei der Anfrage an FortiPAM.") from exc
        except httpx.HTTPError as exc:
            raise FortiPAMError(f"HTTP-Fehler: {exc}") from exc

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
        if err not in (None, 0, "0", ""):
            parts.append(f"Fehlercode {err}")
        hint = _HTTP_HINTS.get(status_code)
        if hint:
            parts.append(hint)
        return " — ".join(parts)

    # ------------------------------------------------------------------
    def list_table(self, path: str, fmt: str | None = None) -> tuple[list, dict]:
        """Liest eine CMDB-Tabelle; gibt (results, envelope) zurück."""
        params = {"format": fmt} if fmt else None
        data = self.request("GET", f"cmdb/{path}", params=params)
        results = data.get("results", [])
        if not isinstance(results, list):
            results = [results]
        return results, data

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
