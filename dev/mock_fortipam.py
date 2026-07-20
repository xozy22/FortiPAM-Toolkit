"""Mock-FortiPAM für lokale Tests des Toolkits.

Bildet das am echten Gerät (v1.9.0, Build 1751) beobachtete Verhalten nach:
- Kein Collection-GET auf secret/target und secret/template ("Unable to get mkey from uri")
- Einzel-GET per mkey funktioniert
- POST wendet KEINE Defaults an: folder/database verlangen 'inherit-permission' explizit
- Ordner direkt unter Root: inherit-permission muss 'disable' sein + Owner-Permission Pflicht
- Secrets dürfen nicht in Root (folder 0) liegen
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn

app = FastAPI()

DB = {
    "secret/folder": [
        {"id": 1, "name": "Linux", "parent-folder": 0},
        {"id": 2, "name": "Produktion", "parent-folder": 1},
        {"id": 3, "name": "Windows", "parent-folder": 0},
    ],
    "secret/target": [
        {"id": 10, "name": "srv-alt-01", "address": "10.0.0.5",
         "template": "Unix Account (SSH Password)", "class": "Linux Server",
         "domain": "", "description": "Bestand"},
    ],
    "secret/database": [
        {"id": 100, "name": "srv-alt-01", "folder": 2,
         "template": "Unix Account (SSH Password)", "target": "srv-alt-01",
         "description": "Bestand"},
    ],
    "secret/template": [
        {"name": "Unix Account (SSH Password)", "server-info": "Unix-like",
         "field": [
             {"name": "Host", "type": "target-address", "mandatory": "enable"},
             {"name": "Username", "type": "username", "mandatory": "enable"},
             {"name": "Password", "type": "password", "mandatory": "enable"},
         ]},
        {"name": "Windows Account (RDP)", "server-info": "Windows",
         "field": [
             {"name": "Username", "type": "username", "mandatory": "enable"},
             {"name": "Password", "type": "password", "mandatory": "enable"},
             {"name": "Domain", "type": "domain", "mandatory": "disable"},
         ]},
        {"name": "Cisco Account (SSH)", "server-info": "Cisco",
         "field": [
             {"name": "Username", "type": "username", "mandatory": "enable"},
             {"name": "Password", "type": "password", "mandatory": "enable"},
             {"name": "Enable Password", "type": "password", "mandatory": "disable"},
         ]},
    ],
    "secret/classification-tag": [
        {"name": "Import", "description": ""},
        {"name": "Other", "description": ""},
    ],
    "system/api-user": [{"name": "api"}],
    "system/admin": [{"name": "admin"}],
}
NEXT_ID = {"secret/folder": 50, "secret/database": 500, "secret/target": 60}
LISTING_BLOCKED = {"secret/target", "secret/template"}


def envelope(path, results):
    return {"http_method": "GET", "results": results, "status": "success",
            "http_status": 200, "vdom": "root", "path": path,
            "serial": "FPAMMOCK00000001", "version": "v1.9.0", "build": 1751}


def err(status, cli_error, error=2):
    return JSONResponse({"status": "error", "http_status": status,
                         "error": error, "cli_error": cli_error}, status_code=status)


@app.get("/api/v2/cmdb/{p1}/{p2}")
async def get_table(p1: str, p2: str, request: Request):
    key = f"{p1}/{p2}"
    if key in LISTING_BLOCKED:
        return err(400, "Unable to get mkey from uri")
    if key not in DB:
        return err(404, "path not found")
    rows = DB[key]
    fmt = request.query_params.get("format")
    if fmt:
        keep = fmt.split("|")
        rows = [{k: v for k, v in r.items() if k in keep} for r in rows]
    return envelope(key, rows)


def _find(key: str, mkey: str):
    for r in DB.get(key, []):
        if str(r.get("name")) == mkey or str(r.get("id")) == mkey:
            return r
    return None


@app.get("/api/v2/cmdb/{p1}/{p2}/{mkey:path}")
async def get_one(p1: str, p2: str, mkey: str):
    key = f"{p1}/{p2}"
    if key not in DB:
        return err(404, "path not found")
    row = _find(key, mkey)
    if row is None:
        return err(404, "Entry not found or access restricted")
    return envelope(key, [row])


@app.delete("/api/v2/cmdb/{p1}/{p2}/{mkey:path}")
async def delete_one(p1: str, p2: str, mkey: str):
    key = f"{p1}/{p2}"
    row = _find(key, mkey)
    if row is None:
        return err(404, "entry not found")
    DB[key].remove(row)
    return {"http_method": "DELETE", "status": "success", "http_status": 200}


@app.post("/api/v2/cmdb/{p1}/{p2}")
async def post_table(p1: str, p2: str, request: Request):
    key = f"{p1}/{p2}"
    if key not in DB:
        return err(404, "path not found")
    body = await request.json()

    # --- am echten Gerät beobachtete Validierung ----------------------
    if key in ("secret/folder", "secret/database") and "inherit-permission" not in body:
        return JSONResponse({"status": "error", "http_status": 400,
                             "error": "Missing field in payload: 'inherit-permission'"},
                            status_code=400)
    if key == "secret/folder":
        parent = int(body.get("parent-folder", 0) or 0)
        if parent == 0:
            if body.get("inherit-permission") != "disable":
                return err(400, "Cannot have inherit permission for root folder\n")
            has_owner = any(p.get("folder-permission") == "owner"
                            and (p.get("user-name") or [])
                            for p in body.get("user-permission", []))
            if not has_owner:
                return err(400, "Folder must contain owner permission\n")
    if key == "secret/database":
        folder = body.get("folder")
        if not isinstance(folder, int):
            return JSONResponse({"status": "error", "http_status": 400,
                                 "error": "Expected folder to be a number."}, status_code=400)
        if folder == 0:
            return err(400, "folder_id can't be 0")
    if str(body.get("name", "")).startswith("FAIL"):
        return err(500, "entry not found in datasource", -3)

    mkey = body.get("name")
    if key in NEXT_ID:
        NEXT_ID[key] += 1
        body["id"] = NEXT_ID[key]
        if p2 in ("folder", "database"):
            mkey = NEXT_ID[key]
    DB[key].append(body)
    return {"http_method": "POST", "mkey": mkey, "status": "success",
            "http_status": 200, "path": key, "version": "v1.9.0"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9443, log_level="warning")
