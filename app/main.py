"""FastAPI-Backend des FortiPAM Toolkits (nur für localhost gedacht)."""
from __future__ import annotations

import base64
import copy
import io
import json
import os
import sys
import threading
import time
from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import excel_io, planner, winsec
from .fortipam import FortiPAMClient, FortiPAMError

app = FastAPI(title="FortiPAM Toolkit", docs_url=None, redoc_url=None)

STATE: dict = {
    "client": None,          # FortiPAMClient
    "conn_info": None,       # {base_url, version, serial, build, vdom}
    "inventory": None,       # dict mit targets/secrets/folders/templates/class_tags
    "excel_bytes": None,     # Original-Datei für Blattwechsel
    "excel": None,           # geparste Daten inkl. rows
    "plan": None,            # interner Plan (ungemaskt)
    "job": None,             # Ausführungsstatus
    "extra_templates": set(),     # vom Benutzer nachgeladene Template-Namen
    "extra_target_names": set(),  # selbst angelegte Targets (Listing nicht möglich)
}
JOB_LOCK = threading.Lock()


def _require(key: str, message: str):
    val = STATE.get(key)
    if val is None:
        raise HTTPException(status_code=409, detail=message)
    return val


# ======================================================================
# Verbindungsmanager: mehrere benannte Profile, Token DPAPI-verschlüsselt
# ======================================================================

def _store_dir() -> Path:
    base = Path(os.environ.get("APPDATA") or Path.home()) / "FortiPAM-Toolkit"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _encrypt_token(token: str) -> str | None:
    if not token or not winsec.available():
        return None
    return base64.b64encode(winsec.protect(token.encode("utf-8"))).decode("ascii")


def _decrypt_token(enc: str | None) -> str:
    if not enc:
        return ""
    try:
        return winsec.unprotect(base64.b64decode(enc)).decode("utf-8")
    except (OSError, ValueError):
        return ""


def _load_store() -> dict:
    path = _store_dir() / "connections.json"
    try:
        # utf-8-sig: toleriert ein evtl. vorhandenes BOM
        store = json.loads(path.read_text(encoding="utf-8-sig"))
        if isinstance(store.get("profiles"), list):
            return store
    except (OSError, ValueError):
        pass
    store = {"profiles": [], "last_used": ""}
    # Migration der alten Einzel-Ablage (connection.json)
    old = _store_dir() / "connection.json"
    try:
        prof = json.loads(old.read_text(encoding="utf-8-sig"))
        if prof.get("base_url"):
            store["profiles"].append({
                "name": "Standard", "base_url": prof.get("base_url", ""),
                "vdom": prof.get("vdom", ""),
                "verify_ssl": bool(prof.get("verify_ssl")),
                "token_enc": prof.get("token_enc")})
            store["last_used"] = "Standard"
            _save_store(store)
        old.unlink(missing_ok=True)
    except (OSError, ValueError):
        pass
    return store


def _save_store(store: dict) -> None:
    path = _store_dir() / "connections.json"
    path.write_text(json.dumps(store, indent=1, ensure_ascii=False), encoding="utf-8")


def _find_profile(store: dict, name: str) -> dict | None:
    want = str(name or "").strip().lower()
    for p in store.get("profiles", []):
        if str(p.get("name", "")).strip().lower() == want:
            return p
    return None


@app.get("/api/connections")
def connections_list():
    store = _load_store()
    return {
        "profiles": [{"name": p.get("name", ""),
                      "base_url": p.get("base_url", ""),
                      "vdom": p.get("vdom", ""),
                      "verify_ssl": bool(p.get("verify_ssl")),
                      "has_token": bool(p.get("token_enc"))}
                     for p in store.get("profiles", [])],
        "last_used": store.get("last_used", ""),
        "dpapi": winsec.available(),
    }


@app.delete("/api/connections/{name}")
def connections_delete(name: str):
    store = _load_store()
    prof = _find_profile(store, name)
    if prof is None:
        raise HTTPException(status_code=404, detail=f"Verbindung '{name}' nicht gefunden.")
    store["profiles"].remove(prof)
    if store.get("last_used", "").strip().lower() == str(name).strip().lower():
        store["last_used"] = ""
    _save_store(store)
    return {"ok": True}


# ======================================================================
# Verbindung
# ======================================================================

@app.post("/api/connect")
def connect(payload: dict = Body(...)):
    base_url = str(payload.get("base_url") or "").strip()
    token = str(payload.get("token") or "").strip()
    profile_name = str(payload.get("profile_name") or "").strip()
    remember = bool(payload.get("remember"))
    if not token and profile_name:
        # gespeicherten Token des Profils verwenden
        prof = _find_profile(_load_store(), profile_name)
        token = _decrypt_token((prof or {}).get("token_enc"))
        if not token:
            raise HTTPException(status_code=400, detail=(
                f"Für '{profile_name}' ist kein Token gespeichert oder die "
                f"Entschlüsselung schlug fehl — bitte Token eingeben."))
    if not base_url or not token:
        raise HTTPException(status_code=400, detail="Basis-URL und API-Token sind erforderlich.")
    if not base_url.lower().startswith(("http://", "https://")):
        base_url = "https://" + base_url

    client = FortiPAMClient(
        base_url=base_url,
        token=token,
        verify_ssl=bool(payload.get("verify_ssl")),
        vdom=str(payload.get("vdom") or ""),
    )
    try:
        _, envelope = client.list_table("secret/folder", fmt="id|name")
    except FortiPAMError as exc:
        client.close()
        raise HTTPException(status_code=400, detail=str(exc))

    old = STATE.get("client")
    if old:
        old.close()
    info = {
        "base_url": base_url,
        "vdom": client.vdom,
        "version": envelope.get("version", "?"),
        "build": envelope.get("build", ""),
        "serial": envelope.get("serial", ""),
    }
    info["profile"] = profile_name
    STATE.update({"client": client, "conn_info": info, "inventory": None,
                  "plan": None, "extra_templates": set(),
                  "extra_target_names": set()})
    # Profil speichern/aktualisieren (Token DPAPI-verschlüsselt) + last_used
    try:
        store = _load_store()
        if remember and profile_name:
            prof = _find_profile(store, profile_name)
            if prof is None:
                prof = {"name": profile_name}
                store["profiles"].append(prof)
            prof.update({"base_url": base_url, "vdom": client.vdom,
                         "verify_ssl": bool(payload.get("verify_ssl"))})
            enc = _encrypt_token(token)
            if enc:
                prof["token_enc"] = enc
        existing = _find_profile(store, profile_name) if profile_name else None
        if existing:
            store["last_used"] = existing["name"]
        _save_store(store)
    except OSError:
        pass
    return info


@app.post("/api/disconnect")
def disconnect():
    client = STATE.get("client")
    if client:
        client.close()
    STATE.update({"client": None, "conn_info": None, "inventory": None, "plan": None})
    return {"ok": True}


@app.get("/api/status")
def status():
    return {"connected": STATE.get("client") is not None,
            "conn_info": STATE.get("conn_info")}


# ======================================================================
# Inventar
# ======================================================================

# FortiPAM (v1.9) erlaubt kein Auflisten von secret/target und secret/template
# über die REST-API ("Unable to get mkey from uri"). Fallback: Einzelabfragen
# per mkey für bekannte/wahrscheinliche Namen.
_MKEY_LISTING_BLOCKED = "Unable to get mkey"

DEFAULT_TEMPLATE_CANDIDATES = [
    "Unix Account (SSH Password)", "Unix Account (SSH Key)",
    "Windows Domain Account", "Windows Account (RDP)", "Web Account",
    "Cisco Account (SSH)", "LDAP Account", "ESXi Account",
    "FortiOS Account", "FortiProduct Account (HTTPS)", "Database Account",
    "VNC Account", "Telnet Account", "SFTP Account", "Samba Account",
]

_MAX_TARGET_PROBES = 300


def _probe_by_names(client: FortiPAMClient, path: str, names: list[str]) -> list[dict]:
    """Holt Einzelobjekte per mkey; 404/403 werden übersprungen."""
    out, seen = [], set()
    for name in names:
        key = name.strip().lower()
        if not name.strip() or key in seen:
            continue
        seen.add(key)
        try:
            obj = client.get_by_mkey(path, name)
        except FortiPAMError:
            continue    # z. B. 403: existiert evtl., aber ohne Berechtigung nicht nutzbar
        if obj:
            out.append(obj)
    return out


def _fetch_inventory(client: FortiPAMClient) -> dict:
    secrets, secrets_env = client.list_table(
        "secret/database", fmt="id|name|folder|template|target|description")
    folders, folders_env = client.list_table("secret/folder")
    class_tags, _ = client.list_table("secret/classification-tag")

    # ---- Targets: Listing versuchen, sonst über bekannte Namen -------
    target_listing = True
    try:
        targets, _ = client.list_table(
            "secret/target", fmt="id|name|address|template|class|domain|description")
    except FortiPAMError as exc:
        if _MKEY_LISTING_BLOCKED not in str(exc):
            raise
        target_listing = False
        names = [str(s.get("target") or "") for s in secrets]
        names += sorted(STATE.get("extra_target_names") or [])
        targets = _probe_by_names(client, "secret/target", names[:_MAX_TARGET_PROBES])

    # ---- Templates: Listing versuchen, sonst Kandidaten abfragen -----
    template_listing = True
    try:
        templates, _ = client.list_table("secret/template")
    except FortiPAMError as exc:
        if _MKEY_LISTING_BLOCKED not in str(exc):
            raise
        template_listing = False
        names = list(DEFAULT_TEMPLATE_CANDIDATES)
        names += [str(s.get("template") or "") for s in secrets]
        names += [str(t.get("template") or "") for t in targets]
        names += sorted(STATE.get("extra_templates") or [])
        templates = _probe_by_names(client, "secret/template", names)

    # ---- Owner-Kandidaten für neue Root-Ordner -----------------------
    owners: list[str] = []
    for path, fmt in (("system/api-user", "name"), ("system/admin", "name")):
        try:
            rows, _ = client.list_table(path, fmt=fmt)
            owners += [str(r.get("name")) for r in rows if r.get("name")]
        except FortiPAMError:
            pass

    id_to_path, _ = planner.folder_paths(folders)
    for f in folders:
        f["path"] = id_to_path.get(int(f.get("id", 0)), f.get("name", ""))
    for s in secrets:
        s["folder_path"] = id_to_path.get(int(s.get("folder", 0) or 0), "") or "Root"

    return {
        "targets": targets,
        "secrets": secrets,
        "folders": folders,
        "templates": templates,
        "class_tags": class_tags,
        "owners": owners,
        "target_listing": target_listing,
        "template_listing": template_listing,
        # Envelope-Feld "size" = Gesamtanzahl in der Tabelle. Liegt sie über
        # der Anzahl sichtbarer Einträge, fehlen dem API-User Berechtigungen
        # (FortiPAM filtert Secrets/Ordner pro Benutzer).
        "totals": {"secrets": secrets_env.get("size"),
                   "folders": folders_env.get("size")},
        "fetched_at": time.strftime("%H:%M:%S"),
    }


@app.get("/api/inventory")
def inventory(refresh: int = 0):
    client = _require("client", "Nicht mit FortiPAM verbunden.")
    if STATE.get("inventory") is None or refresh:
        try:
            STATE["inventory"] = _fetch_inventory(client)
        except FortiPAMError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
    return STATE["inventory"]


# ======================================================================
# Excel
# ======================================================================

@app.post("/api/excel/upload")
async def excel_upload(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Leere Datei.")
    try:
        parsed = excel_io.parse_any(data, file.filename or "")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Datei konnte nicht gelesen werden: {exc}")
    parsed["filename"] = file.filename
    STATE["excel_bytes"] = data
    STATE["excel"] = parsed
    STATE["plan"] = None
    return _excel_public(parsed)


@app.post("/api/excel/sheet")
def excel_sheet(payload: dict = Body(...)):
    data = _require("excel_bytes", "Keine Excel-Datei geladen.")
    old = STATE.get("excel") or {}
    try:
        parsed = excel_io.parse_any(data, old.get("filename", ""),
                                    sheet_name=payload.get("sheet"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Blatt konnte nicht gelesen werden: {exc}")
    parsed["filename"] = old.get("filename", "")
    STATE["excel"] = parsed
    STATE["plan"] = None
    return _excel_public(parsed)


def _excel_public(parsed: dict) -> dict:
    return {
        "filename": parsed.get("filename", ""),
        "sheets": parsed["sheets"],
        "sheet": parsed["sheet"],
        "headers": parsed["headers"],
        "row_count": parsed["row_count"],
        "preview": parsed["rows"][:15],
        "distinct": parsed["distinct"],
        "truncated": parsed["truncated"],
    }


_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx_response(data: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(data), media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/excel/sample")
def excel_sample():
    return _xlsx_response(excel_io.sample_workbook(), "FortiPAM_Import_Vorlage.xlsx")


@app.post("/api/excel/template-generate")
def excel_template_generate(payload: dict = Body(...)):
    """Erzeugt eine Import-Vorlage passend zu den gewählten FortiPAM-Templates."""
    _require("client", "Nicht mit FortiPAM verbunden.")
    inv = STATE.get("inventory")
    if inv is None:
        inv = STATE["inventory"] = _fetch_inventory(STATE["client"])
    wanted = [str(n) for n in (payload.get("templates") or [])]
    by_name = {t.get("name"): t for t in inv.get("templates", [])}
    templates = [by_name[n] for n in wanted if n in by_name]
    if not templates:
        raise HTTPException(status_code=400, detail="Keine gültigen Templates gewählt.")
    data = excel_io.template_workbook(templates)
    return _xlsx_response(data, "FortiPAM_Import_Vorlage_Templates.xlsx")


@app.get("/api/inventory/export")
def inventory_export():
    _require("client", "Nicht mit FortiPAM verbunden.")
    inv = STATE.get("inventory")
    if inv is None:
        inv = STATE["inventory"] = _fetch_inventory(STATE["client"])
    data = excel_io.inventory_workbook(inv)
    stamp = time.strftime("%Y-%m-%d")
    return _xlsx_response(data, f"FortiPAM_Inventar_{stamp}.xlsx")


# ======================================================================
# Objekt-Details & Bulk-Löschen
# ======================================================================

_OBJECT_PATHS = {
    "secret": ("secret/database", True),
    "target": ("secret/target", False),
    "template": ("secret/template", False),
    "folder": ("secret/folder", False),
}


@app.get("/api/object/{kind}/{mkey}")
def object_detail(kind: str, mkey: str):
    client = _require("client", "Nicht mit FortiPAM verbunden.")
    if kind not in _OBJECT_PATHS:
        raise HTTPException(status_code=400, detail="Unbekannter Objekttyp.")
    path, mask_fields = _OBJECT_PATHS[kind]
    try:
        obj = client.get_by_mkey(path, mkey)
    except FortiPAMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    if obj is None:
        raise HTTPException(status_code=404, detail="Objekt nicht gefunden.")
    obj = copy.deepcopy(obj)
    obj.pop("q_origin_key", None)
    if mask_fields:
        # Sensible Feldtypen zusätzlich über die Template-Definition ermitteln
        # (falls die Feld-Antwort selbst keinen "type" trägt)
        tpl_types: dict[str, str] = {}
        inv = STATE.get("inventory") or {}
        for tpl in inv.get("templates", []):
            if tpl.get("name") == obj.get("template"):
                tpl_types = {f.get("name"): f.get("type")
                             for f in (tpl.get("field") or [])}
                break
        for f in obj.get("field", []) or []:
            ftype = f.get("type") or tpl_types.get(f.get("name"))
            if ftype in planner.SENSITIVE_TYPES and f.get("value"):
                f["value"] = planner.MASK
        obj.pop("credentials-history", None)
    return obj


@app.post("/api/delete")
def bulk_delete(payload: dict = Body(...)):
    client = _require("client", "Nicht mit FortiPAM verbunden.")
    items = payload.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="Keine Objekte ausgewählt.")
    for it in items:
        if it.get("kind") not in ("secret", "target", "folder"):
            raise HTTPException(status_code=400,
                                detail=f"Objekttyp '{it.get('kind')}' nicht löschbar.")
    with JOB_LOCK:
        job = STATE.get("job")
        if job and job.get("running"):
            raise HTTPException(status_code=409, detail="Es läuft bereits ein Vorgang.")
        job = {"running": True, "finished": False, "cancel": False,
               "done": 0, "total": len(items), "items": [],
               "started": time.strftime("%H:%M:%S")}
        STATE["job"] = job

    # Reihenfolge: Secrets -> Targets -> Ordner (tiefste zuerst)
    order = {"secret": 0, "target": 1, "folder": 2}
    def depth(it):
        return -str(it.get("label", "")).count("/") if it.get("kind") == "folder" else 0
    todo = sorted(items, key=lambda it: (order[it["kind"]], depth(it)))

    def worker():
        for it in todo:
            if job.get("cancel"):
                break
            path, _ = _OBJECT_PATHS[it["kind"]]
            label = str(it.get("label") or it.get("mkey"))
            try:
                client.delete(path, it.get("mkey"))
                status, msg = "ok", "gelöscht"
            except FortiPAMError as exc:
                status, msg = "error", str(exc)
            with JOB_LOCK:
                job["items"].append({"kind": it["kind"], "name": label,
                                     "status": status, "message": msg, "row": None})
                job["done"] += 1
        job["finished"] = True
        job["running"] = False
        STATE["inventory"] = None
        STATE["plan"] = None

    threading.Thread(target=worker, daemon=True).start()
    return {"started": True, "total": len(todo)}


# ======================================================================
# Plan & Ausführung
# ======================================================================

@app.post("/api/plan")
def make_plan(mapping: dict = Body(...)):
    client = _require("client", "Nicht mit FortiPAM verbunden.")
    excel = _require("excel", "Keine Excel-Datei geladen.")
    inv = STATE.get("inventory")
    if inv is None:
        inv = STATE["inventory"] = _fetch_inventory(client)

    def target_checker(name: str):
        """Live-Prüfung, weil Target-Listing per REST gesperrt sein kann."""
        try:
            return client.get_by_mkey("secret/target", name) is not None
        except FortiPAMError:
            return None

    def dup_checker(username: str, addr: str):
        """Geräteseitige Duplikat-Prüfung (Internal-API secret-dup-check)."""
        try:
            return client.dup_check(username, addr)
        except FortiPAMError:
            return None

    # target_checker immer mitgeben: Das Geräte-Listing hinkt nach Bulk-Läufen
    # einige Sekunden nach (eventual consistency) — die Einzelabfrage per Name
    # ist sofort konsistent und fängt das ab.
    plan, public = planner.build_plan(mapping, excel["rows"], inv,
                                      target_checker=target_checker,
                                      dup_checker=dup_checker)
    STATE["plan"] = plan
    return public


@app.post("/api/templates/add")
def template_add(payload: dict = Body(...)):
    client = _require("client", "Nicht mit FortiPAM verbunden.")
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template-Name fehlt.")
    try:
        tpl = client.get_by_mkey("secret/template", name)
    except FortiPAMError as exc:
        if "HTTP 403" in str(exc):
            raise HTTPException(status_code=403, detail=(
                f"Kein Zugriff auf Template '{name}' – der API-User braucht "
                f"'create secret'-Berechtigung für dieses Template."))
        raise HTTPException(status_code=502, detail=str(exc))
    if tpl is None:
        raise HTTPException(status_code=404, detail=f"Template '{name}' wurde nicht gefunden.")
    STATE["extra_templates"].add(tpl.get("name", name))
    inv = STATE.get("inventory")
    if inv is not None:
        existing = {t.get("name") for t in inv.get("templates", [])}
        if tpl.get("name") not in existing:
            inv["templates"].append(tpl)
    return tpl


@app.post("/api/execute")
def execute():
    client = _require("client", "Nicht mit FortiPAM verbunden.")
    plan = _require("plan", "Kein Plan vorhanden – zuerst Vorschau berechnen.")
    with JOB_LOCK:
        job = STATE.get("job")
        if job and job.get("running"):
            raise HTTPException(status_code=409, detail="Es läuft bereits eine Ausführung.")
        job = {"running": True, "finished": False, "cancel": False,
               "done": 0, "total": 0, "items": [], "started": time.strftime("%H:%M:%S")}
        STATE["job"] = job

    def worker():
        try:
            planner.execute_plan(client, plan, job, lock=JOB_LOCK)
        except Exception as exc:  # unerwartete Fehler sichtbar machen
            job["items"].append({"kind": "system", "name": "Ausführung",
                                 "status": "error", "message": str(exc), "row": None})
            job["finished"] = True
            job["running"] = False
        # angelegte Targets merken (Listing per REST ggf. nicht möglich)
        for item in job["items"]:
            if item.get("kind") == "target" and item.get("status") == "ok":
                STATE["extra_target_names"].add(item.get("name", ""))
        # Inventar ist danach veraltet
        STATE["inventory"] = None
        STATE["plan"] = None

    threading.Thread(target=worker, daemon=True).start()
    return {"started": True}


@app.get("/api/execute/status")
def execute_status():
    job = STATE.get("job")
    if not job:
        return {"running": False, "finished": False, "done": 0, "total": 0, "items": []}
    with JOB_LOCK:
        return copy.deepcopy(job)


@app.post("/api/execute/cancel")
def execute_cancel():
    job = STATE.get("job")
    if job and job.get("running"):
        job["cancel"] = True
    return {"ok": True}


# ======================================================================
# Statische Dateien
# ======================================================================

def _static_dir() -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    for cand in (base / "static", base / "app" / "static"):
        if cand.exists():
            return cand
    return Path(__file__).resolve().parent / "static"


STATIC_DIR = _static_dir()
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))
