"""End-to-End-Test: Toolkit gegen Mock-FortiPAM (dev/mock_fortipam.py).

Der Mock bildet die am echten Gerät beobachteten Einschränkungen nach
(kein Target-/Template-Listing, Pflichtfelder, Root-Regeln).
"""
import json
import time

import httpx

APP = "http://127.0.0.1:8420"
c = httpx.Client(timeout=30)


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  -> {detail}" if detail else ""))
    if not cond:
        raise SystemExit(1)


# 0) 429-Retry des API-Clients (Mock liefert beim 1. Versuch "Too many requests")
import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
from app.fortipam import FortiPAMClient  # noqa: E402

cl = FortiPAMClient("http://127.0.0.1:9443", "mocktoken", verify_ssl=False)
resp = cl.create("secret/target", {"name": "RATE429-test", "template": "x", "class": "Import"})
check("429-retry", resp.get("status") == "success", str(resp)[:120])
cl.request("DELETE", "cmdb/secret/target/RATE429-test")

# Geräteseitige Duplikat-Prüfung (Internal-API): root@10.0.0.5 existiert im Mock
is_dup, msg = cl.dup_check("root", "10.0.0.5")
check("dup-check positiv", is_dup and "owned" in msg, f"{is_dup} {msg[:60]}")
is_dup, msg = cl.dup_check("niemand", "10.0.0.5")
check("dup-check negativ", not is_dup, f"{is_dup} {msg[:60]}")
cl.close()

# 1) Verbinden (mit DPAPI-Speicherung)
r = c.post(f"{APP}/api/connect", json={
    "base_url": "http://127.0.0.1:9443", "token": "mocktoken", "verify_ssl": False,
    "remember": True})
check("connect", r.status_code == 200, r.text[:200])
check("connect version", r.json()["version"] == "v1.9.0")

# 1b) Gespeichertes Profil + Wiederverbinden mit gespeichertem Token
r = c.get(f"{APP}/api/connection/saved")
saved = r.json()
check("profil gespeichert", saved.get("has_token") is True
      and saved.get("base_url") == "http://127.0.0.1:9443", str(saved))
r = c.post(f"{APP}/api/connect", json={
    "base_url": "http://127.0.0.1:9443", "token": "", "verify_ssl": False,
    "use_saved_token": True})
check("reconnect mit gespeichertem token", r.status_code == 200, r.text[:150])

# 2) Inventar (Listing via X-HTTP-Method-Override-Fallback)
r = c.get(f"{APP}/api/inventory")
inv = r.json()
check("inventory", r.status_code == 200)
check("inventory target_listing via override", inv["target_listing"] is True)
check("inventory template_listing via override", inv["template_listing"] is True)
check("inventory targets gelistet", len(inv["targets"]) == 1,
      str([t.get("name") for t in inv["targets"]]))
check("inventory templates gelistet", len(inv["templates"]) == 3,
      str([t.get("name") for t in inv["templates"]]))
check("inventory owners", "api" in inv["owners"], str(inv["owners"]))
check("inventory folder path", any(f["path"] == "Linux/Produktion" for f in inv["folders"]))
check("inventory totals", inv["totals"]["secrets"] == len(inv["secrets"])
      and inv["totals"]["folders"] == len(inv["folders"]), str(inv["totals"]))

# 3) Template-Nachladen
r = c.post(f"{APP}/api/templates/add", json={"name": "Gibtsnicht"})
check("template add 404", r.status_code == 404, r.text[:120])
r = c.post(f"{APP}/api/templates/add", json={"name": "Cisco Account (SSH)"})
check("template add ok", r.status_code == 200, r.text[:120])

# 3b) Inventar-Export + Vorlagen-Generator
r = c.get(f"{APP}/api/inventory/export")
check("inventar-export", r.status_code == 200 and len(r.content) > 2000
      and "spreadsheet" in r.headers.get("content-type", ""), str(len(r.content)))
r = c.post(f"{APP}/api/excel/template-generate",
           json={"templates": ["Unix Account (SSH Password)", "Windows Account (RDP)"]})
check("vorlagen-generator", r.status_code == 200 and len(r.content) > 1000)
r = c.post(f"{APP}/api/excel/template-generate", json={"templates": ["Gibtsnicht"]})
check("vorlagen-generator 400", r.status_code == 400)

# 4) Beispiel-Excel hochladen
r = c.get(f"{APP}/api/excel/sample")
check("sample download", r.status_code == 200 and len(r.content) > 1000)
r = c.post(f"{APP}/api/excel/upload",
           files={"file": ("test.xlsx", r.content,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
up = r.json()
check("upload", r.status_code == 200, str(up)[:150])
check("upload rows", up["row_count"] == 3)

# 5) Plan
mapping = {
    "options": {"create_targets": True, "create_secrets": True,
                "auto_create_folders": True, "root_folder_owner": "api"},
    "target": {
        "name": {"type": "column", "value": "Name"},
        "address": {"type": "column", "value": "Adresse"},
        "class": {"type": "fixed", "value": "Import"},
        "template": {"type": "secret_template"},
        "domain": {"type": "column", "value": "Domäne"},
        "description": {"type": "column", "value": "Beschreibung"},
    },
    "secret": {
        "name": {"type": "column", "value": "Name"},
        "description": {"type": "column", "value": "Beschreibung"},
        "target": {"type": "row_target"},
        "folder": {"type": "column_path", "value": "Ordner", "base": 0},
        "template": {"type": "column", "value": "Secret-Typ", "value_map": {
            "linux": "Unix Account (SSH Password)",
            "windows": "Windows Account (RDP)",
            "netzwerk": "Cisco Account (SSH)",
        }},
        "fields": {
            "Unix Account (SSH Password)": {
                "Username": {"type": "column", "value": "Benutzername"},
                "Password": {"type": "column", "value": "Passwort"}},
            "Windows Account (RDP)": {
                "Username": {"type": "column", "value": "Benutzername"},
                "Password": {"type": "column", "value": "Passwort"},
                "Domain": {"type": "column", "value": "Domäne"}},
            "Cisco Account (SSH)": {
                "Username": {"type": "column", "value": "Benutzername"},
                "Password": {"type": "column", "value": "Passwort"}},
        },
    },
}
r = c.post(f"{APP}/api/plan", json=mapping)
plan = r.json()
check("plan", r.status_code == 200, json.dumps(plan)[:250])
s = plan["summary"]
check("plan targets_create", s["targets_create"] == 3, str(s))
check("plan secrets_create", s["secrets_create"] == 3, str(s))
check("plan folders_create", s["folders_create"] == 2,
      str([f["path"] for f in plan["folders"]]))
check("plan root-level ordner erkannt",
      any(f.get("root_level") for f in plan["folders"]))
check("plan keine fehler", s["secrets_error"] == 0 and s["row_errors"] == 0, str(s))
check("plan keine notices", not plan.get("notices"), str(plan.get("notices")))
masked = all(f["value"] == "••••••" for sec in plan["secrets"]
             for f in sec["body"]["field"] if f["name"] == "Password")
check("plan passwort maskiert", masked)

# 6) Ausführen
r = c.post(f"{APP}/api/execute")
check("execute start", r.status_code == 200, r.text[:150])
for _ in range(80):
    j = c.get(f"{APP}/api/execute/status").json()
    if j.get("finished"):
        break
    time.sleep(0.25)
check("execute finished", j.get("finished"))
errors = [i for i in j["items"] if i["status"] == "error"]
check("execute ohne fehler", not errors, json.dumps(errors, ensure_ascii=False)[:400])
check("execute anzahl", j["done"] == 8, f"done={j['done']} total={j['total']}")

# 7) Bestand im Mock prüfen
mock = httpx.get("http://127.0.0.1:9443/api/v2/cmdb/secret/database").json()["results"]
names = [m["name"] for m in mock]
check("secrets im mock", all(n in names for n in ("srv-linux-01", "srv-win-01", "sw-core-01")),
      str(names))
new = next(m for m in mock if m["name"] == "srv-win-01")
check("secret inherit-permission", new.get("inherit-permission") == "enable")
check("secret feldwerte echt", any(f["name"] == "Password" and f["value"].startswith("Geheim")
                                   for f in new["field"]))
folders = httpx.get("http://127.0.0.1:9443/api/v2/cmdb/secret/folder").json()["results"]
netz = next((f for f in folders if f["name"] == "Netzwerk"), None)
check("root-ordner angelegt", netz is not None, str([f['name'] for f in folders]))
check("root-ordner owner", any(p.get("folder-permission") == "owner"
                               for p in (netz.get("user-permission") or [])))

# 8) Idempotenz: zweiter Lauf erkennt alles als vorhanden
r = c.get(f"{APP}/api/inventory?refresh=1")
check("inventory refresh", r.status_code == 200)
inv2 = r.json()
check("inventory kennt neue targets", len(inv2["targets"]) == 4,
      str([t.get("name") for t in inv2["targets"]]))
r = c.post(f"{APP}/api/plan", json=mapping)
s2 = r.json()["summary"]
check("idempotenz targets", s2["targets_create"] == 0 and s2["targets_exist"] == 3, str(s2))
check("idempotenz secrets", s2["secrets_create"] == 0 and s2["secrets_exist"] == 3, str(s2))
check("idempotenz ordner", s2["folders_create"] == 0, str(s2))

# 9) Geräteprüfung im Plan: Zeile kollidiert mit bestehendem Secret (root@10.0.0.5)
import io
from openpyxl import Workbook

wb = Workbook()
ws = wb.active
ws.append(["Name", "Adresse", "Secret-Typ", "Benutzername", "Passwort", "Domäne", "Ordner"])
ws.append(["srv-kollision-01", "10.0.0.5", "linux", "root", "Xx!12345", "", "Linux/Produktion"])
buf = io.BytesIO()
wb.save(buf)
r = c.post(f"{APP}/api/excel/upload",
           files={"file": ("kollision.xlsx", buf.getvalue(),
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
check("upload kollisionstest", r.status_code == 200)
r = c.post(f"{APP}/api/plan", json=mapping)
sec = r.json()["secrets"][0]
check("dup-warnung im plan", any("bestehendes Secret" in w for w in sec.get("warnings", [])),
      str(sec.get("warnings")))

# 10) Ohne Target-Referenz: Warnung bei Pflichtfeld vom Typ target-address
import copy
m2 = copy.deepcopy(mapping)
m2["options"]["create_targets"] = False
r = c.post(f"{APP}/api/plan", json=m2)
sec = r.json()["secrets"][0]
check("target-address-warnung", any("Ziel-Adresse" in w for w in sec.get("warnings", [])),
      str(sec.get("warnings")))

print("\nAlle Tests bestanden.")
