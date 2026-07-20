"""Plan-Erstellung (Vorschau) und Ausführung des Bulk-Imports.

Ein "Plan" wird serverseitig aus Excel-Zeilen + Mapping-Konfiguration gebaut.
Die an das Frontend gelieferte Fassung maskiert sensible Feldwerte; die
ungekürzte Fassung bleibt im Server-State und wird bei der Ausführung genutzt.
"""
from __future__ import annotations

import copy
import threading
from concurrent.futures import ThreadPoolExecutor

from .fortipam import FortiPAMClient, FortiPAMError

EXECUTE_CONCURRENCY = 6   # parallele Schreibzugriffe (Ordner bleiben seriell)

MASK = "••••••"
SENSITIVE_TYPES = {"password", "passphrase", "private-key"}


def _norm(s) -> str:
    return str(s or "").strip().lower()


def resolve_source(src, row: dict) -> str:
    """Löst eine Feld-Quelle ({type: column|fixed, value}) gegen eine Zeile auf."""
    if not isinstance(src, dict):
        return ""
    kind = src.get("type")
    if kind == "column":
        return str(row.get(src.get("value") or "", "") or "").strip()
    if kind == "fixed":
        return str(src.get("value") or "").strip()
    return ""


def folder_paths(folders: list[dict]) -> tuple[dict, dict]:
    """Berechnet vollständige Pfade der Ordner. Rückgabe: (id->pfad, pfad_norm->id)."""
    by_id = {int(f.get("id", 0)): f for f in folders}
    cache: dict[int, str] = {}

    def path_of(fid: int, depth: int = 0) -> str:
        if fid == 0:
            return ""
        if fid in cache:
            return cache[fid]
        node = by_id.get(fid)
        if node is None or depth > 50:
            return f"#{fid}"
        parent = int(node.get("parent-folder", 0) or 0)
        prefix = path_of(parent, depth + 1)
        full = (prefix + "/" if prefix else "") + str(node.get("name", ""))
        cache[fid] = full
        return full

    id_to_path = {fid: path_of(fid) for fid in by_id}
    path_to_id = {_norm(p): fid for fid, p in id_to_path.items()}
    path_to_id[""] = 0
    return id_to_path, path_to_id


# ======================================================================
# Plan bauen
# ======================================================================

def build_plan(mapping: dict, rows: list[dict], inventory: dict,
               target_checker=None) -> tuple[dict, dict]:
    """Baut den Ausführungsplan. Rückgabe: (plan_intern, plan_maskiert).

    target_checker(name) -> True/False/None: Live-Existenzprüfung für Targets,
    nötig weil FortiPAM das Auflisten von secret/target per REST nicht erlaubt.
    """
    opts = mapping.get("options") or {}
    create_targets = bool(opts.get("create_targets"))
    create_secrets = bool(opts.get("create_secrets"))
    auto_folders = bool(opts.get("auto_create_folders"))
    folder_owner = str(opts.get("root_folder_owner") or "").strip()

    templates = {t.get("name", ""): t for t in inventory.get("templates", [])}
    tpl_lookup = {_norm(n): n for n in templates}
    class_tags = {_norm(t.get("name")): t.get("name") for t in inventory.get("class_tags", [])}
    existing_targets = {_norm(t.get("name")) for t in inventory.get("targets", [])}
    id_to_path, path_to_id = folder_paths(inventory.get("folders", []))
    existing_secrets = {(_norm(s.get("name")), int(s.get("folder", 0) or 0))
                       for s in inventory.get("secrets", [])}
    notices: list[str] = []

    target_check_cache: dict[str, bool | None] = {}

    def target_exists(name: str) -> bool | None:
        """True/False sicher, None = unbekannt (Prüfung nicht möglich)."""
        key = _norm(name)
        if key in existing_targets:
            return True
        if target_checker is None:
            return False if inventory.get("target_listing", True) else None
        if key not in target_check_cache:
            target_check_cache[key] = target_checker(name)
        return target_check_cache[key]

    tmap = mapping.get("target") or {}
    smap = mapping.get("secret") or {}

    # ---- Secret-Template-Auflösung -----------------------------------
    tpl_src = smap.get("template") or {}
    value_map = {_norm(k): v for k, v in (tpl_src.get("value_map") or {}).items()}

    def resolve_template(row: dict) -> tuple[str, str | None]:
        if tpl_src.get("type") == "fixed":
            name = tpl_lookup.get(_norm(tpl_src.get("value")))
            if not name:
                return "", "Kein gültiges Secret-Template gewählt"
            return name, None
        if tpl_src.get("type") == "column":
            raw = str(row.get(tpl_src.get("value") or "", "") or "").strip()
            if not raw:
                return "", "Secret-Typ-Spalte ist leer"
            mapped = value_map.get(_norm(raw), "")
            canon = tpl_lookup.get(_norm(mapped)) if mapped else None
            if not canon:
                return "", f"Kein Template für Typ '{raw}' zugeordnet"
            return canon, None
        return "", "Keine Template-Quelle konfiguriert"

    # ---- Ordner-Auflösung --------------------------------------------
    fol_src = smap.get("folder") or {}
    base_id = int(fol_src.get("base") or 0)
    base_path = id_to_path.get(base_id, "") if base_id else ""
    planned_folders: dict[str, dict] = {}   # norm_pfad -> {path, parent_path, root_level}

    def resolve_path(raw: str) -> tuple[int | None, str, str | None]:
        raw = str(raw or "").replace("\\", "/").strip().strip("/")
        segs = [s.strip() for s in raw.split("/") if s.strip()]
        if not segs:
            return base_id, base_path or "Root", None
        path = base_path
        for seg in segs:
            path = (path + "/" if path else "") + seg
        key = _norm(path)
        if key in path_to_id:
            return path_to_id[key], path, None
        if not auto_folders and key not in planned_folders:
            return None, path, f"Ordner '{path}' existiert nicht"
        # fehlende Kette unterhalb des Basisordners einplanen
        walk = base_path
        for seg in segs:
            nxt = (walk + "/" if walk else "") + seg
            nkey = _norm(nxt)
            if nkey not in path_to_id and nkey not in planned_folders:
                planned_folders[nkey] = {"path": nxt, "parent_path": walk,
                                         "root_level": walk == ""}
            walk = nxt
        return None, path, None

    def resolve_folder(row: dict) -> tuple[int | None, str, str | None]:
        """Rückgabe: (folder_id | None wenn noch anzulegen, pfad, fehler)."""
        kind = fol_src.get("type")
        if kind == "column_path":
            return resolve_path(row.get(fol_src.get("value") or "", ""))
        if kind == "fixed_path":
            return resolve_path(fol_src.get("value") or "")
        # fester Ordner (vorhandene ID)
        fid = int(fol_src.get("value") or 0)
        return fid, id_to_path.get(fid, "Root" if fid == 0 else f"#{fid}") or "Root", None

    # ---- Target je Zeile ---------------------------------------------
    def build_target_body(row: dict, secret_tpl: str, issues: list, warnings: list):
        name = resolve_source(tmap.get("name"), row)
        if not name:
            issues.append("Target-Name ist leer")
            return None
        body = {"name": name}

        cls = resolve_source(tmap.get("class"), row)
        canon_cls = class_tags.get(_norm(cls)) if cls else None
        if not canon_cls:
            issues.append(f"Klassifizierung '{cls or '—'}' unbekannt (Pflichtfeld)")
            return None
        body["class"] = canon_cls

        t_tpl_src = tmap.get("template") or {"type": "secret_template"}
        if t_tpl_src.get("type") == "secret_template":
            t_tpl = secret_tpl
        else:
            t_tpl = resolve_source(t_tpl_src, row)
        canon_tpl = tpl_lookup.get(_norm(t_tpl)) if t_tpl else None
        if not canon_tpl:
            issues.append("Target-Template fehlt oder ist unbekannt (Pflichtfeld)")
            return None
        body["template"] = canon_tpl

        for fld in ("address", "domain", "url", "description"):
            val = resolve_source(tmap.get(fld), row)
            if val:
                body[fld] = val
        if not body.get("address"):
            warnings.append("Target ohne Adresse (IP/FQDN)")
        return body

    # ---- Secret-Felder je Template -----------------------------------
    fields_map = smap.get("fields") or {}
    sensitive_fields: dict[tuple[str, str], bool] = {}
    for tname, tpl in templates.items():
        for f in tpl.get("field", []) or []:
            sensitive_fields[(tname, f.get("name", ""))] = f.get("type") in SENSITIVE_TYPES

    def build_fields(tpl_name: str, row: dict, warnings: list) -> list[dict]:
        tpl = templates.get(tpl_name) or {}
        fmap = fields_map.get(tpl_name) or {}
        out = []
        for pos, f in enumerate(tpl.get("field", []) or [], start=1):
            fname = f.get("name", "")
            val = resolve_source(fmap.get(fname), row)
            if val:
                out.append({"id": pos, "name": fname, "value": val})
            elif f.get("mandatory") == "enable" and f.get("type") in ("username", "password"):
                warnings.append(f"Pflichtfeld '{fname}' ist leer")
        return out

    # ---- Zeilen durchgehen -------------------------------------------
    targets_plan: dict[str, dict] = {}   # norm_name -> eintrag
    secrets_plan: list[dict] = []
    row_errors: list[dict] = []

    target_ref_src = smap.get("target") or {"type": "row_target"}

    for row in rows:
        rownum = int(row.get("_row", 0))
        issues: list[str] = []
        warnings: list[str] = []

        secret_tpl, tpl_err = resolve_template(row)

        # ---------------- Target ----------------
        row_target_name = ""
        if create_targets:
            t_issues: list[str] = []
            if tpl_err and (tmap.get("template") or {}).get("type", "secret_template") == "secret_template":
                t_issues.append(tpl_err)
                body = None
            else:
                body = build_target_body(row, secret_tpl, t_issues, warnings)
            if body:
                row_target_name = body["name"]
                key = _norm(body["name"])
                if key in targets_plan:
                    targets_plan[key]["rows"].append(rownum)
                    if targets_plan[key]["action"] == "create" \
                            and targets_plan[key]["body"] != body:
                        warnings.append(
                            f"Target '{body['name']}' mehrfach mit abweichenden Daten – erste Definition gewinnt")
                else:
                    exists = target_exists(body["name"])
                    if exists:
                        targets_plan[key] = {"name": body["name"], "action": "exists",
                                             "body": body, "rows": [rownum]}
                    else:
                        if exists is None:
                            warnings.append(
                                f"Existenz von Target '{body['name']}' konnte nicht geprüft werden")
                        targets_plan[key] = {"name": body["name"], "action": "create",
                                             "body": body, "rows": [rownum]}
            else:
                issues.extend(t_issues)

        # ---------------- Secret ----------------
        if create_secrets:
            s_name = resolve_source(smap.get("name"), row)
            if tpl_err:
                issues.append(tpl_err)
            if not s_name:
                issues.append("Secret-Name ist leer")
            folder_id, folder_path_str, folder_err = resolve_folder(row)
            if folder_err:
                issues.append(folder_err)
            elif folder_id == 0:
                issues.append("Secrets können nicht direkt im Root-Ordner liegen – Unterordner wählen")

            if not issues:
                if target_ref_src.get("type") == "row_target":
                    target_ref = row_target_name
                else:
                    target_ref = resolve_source(target_ref_src, row)
                if target_ref and _norm(target_ref) not in targets_plan \
                        and not target_exists(target_ref):
                    warnings.append(f"Referenziertes Target '{target_ref}' existiert nicht")

                body = {"name": s_name, "template": secret_tpl,
                        "inherit-permission": "enable"}
                if target_ref:
                    body["target"] = target_ref
                desc = resolve_source(smap.get("description"), row)
                if desc:
                    body["description"] = desc
                body["field"] = build_fields(secret_tpl, row, warnings)

                action = "create"
                if folder_id is not None and (_norm(s_name), folder_id) in existing_secrets:
                    action = "exists"
                dup = next((s for s in secrets_plan
                            if _norm(s["name"]) == _norm(s_name)
                            and _norm(s["folder_path"]) == _norm(folder_path_str)
                            and s["action"] == "create"), None)
                if dup and action == "create":
                    action = "duplicate"
                    warnings.append(f"Doppelt in Datei (zuerst Zeile {dup['row']})")

                secrets_plan.append({
                    "row": rownum, "name": s_name, "action": action,
                    "folder_id": folder_id, "folder_path": folder_path_str or "Root",
                    "template": secret_tpl, "target": target_ref,
                    "warnings": warnings, "body": body,
                })
            else:
                secrets_plan.append({
                    "row": rownum, "name": s_name or "—", "action": "error",
                    "folder_id": None, "folder_path": "", "template": secret_tpl,
                    "target": "", "warnings": warnings, "body": None,
                    "error": "; ".join(issues),
                })
        elif issues:
            row_errors.append({"row": rownum, "error": "; ".join(issues)})

    folders_list = list(planned_folders.values())
    targets_list = sorted(targets_plan.values(), key=lambda t: _norm(t["name"]))

    if any(f.get("root_level") for f in folders_list) and not folder_owner:
        notices.append(
            "Es werden Ordner direkt unter Root angelegt – dafür ist ein Owner nötig. "
            "Bitte im Mapping einen Owner für neue Root-Ordner wählen.")

    summary = {
        "rows": len(rows),
        "folders_create": len(folders_list),
        "targets_create": sum(1 for t in targets_list if t["action"] == "create"),
        "targets_exist": sum(1 for t in targets_list if t["action"] == "exists"),
        "secrets_create": sum(1 for s in secrets_plan if s["action"] == "create"),
        "secrets_exist": sum(1 for s in secrets_plan if s["action"] == "exists"),
        "secrets_error": sum(1 for s in secrets_plan if s["action"] == "error"),
        "secrets_duplicate": sum(1 for s in secrets_plan if s["action"] == "duplicate"),
        "row_errors": len(row_errors),
    }

    plan = {
        "summary": summary,
        "folders": folders_list,
        "targets": targets_list,
        "secrets": secrets_plan,
        "row_errors": row_errors,
        "notices": notices,
        "_path_to_id": {k: v for k, v in path_to_id.items()},
        "_folder_owner": folder_owner,
    }

    # ---- maskierte Fassung für das Frontend --------------------------
    public = copy.deepcopy({k: v for k, v in plan.items() if not k.startswith("_")})
    for s in public["secrets"]:
        body = s.get("body")
        if body:
            for f in body.get("field", []):
                if sensitive_fields.get((s["template"], f["name"])):
                    f["value"] = MASK
    return plan, public


# ======================================================================
# Plan ausführen
# ======================================================================

def execute_plan(client: FortiPAMClient, plan: dict, job: dict,
                 lock: threading.Lock | None = None,
                 concurrency: int = EXECUTE_CONCURRENCY) -> None:
    """Führt den Plan aus und aktualisiert `job`.

    Ordner werden seriell angelegt (Eltern-Kind-Abhängigkeit), Targets und
    Secrets parallel mit begrenzter Nebenläufigkeit.
    """
    path_to_id = dict(plan.get("_path_to_id") or {})
    lock = lock or threading.Lock()

    todo_folders = plan.get("folders", [])
    todo_targets = [t for t in plan.get("targets", []) if t["action"] == "create"]
    todo_secrets = [s for s in plan.get("secrets", []) if s["action"] == "create"]
    job["total"] = len(todo_folders) + len(todo_targets) + len(todo_secrets)

    def push(kind: str, name: str, status: str, message: str = "", row: int | None = None):
        with lock:
            job["items"].append({"kind": kind, "name": name, "status": status,
                                 "message": message, "row": row})
            if status != "info":
                job["done"] += 1

    # ---- Ordner (in geplanter Reihenfolge: Eltern vor Kindern) -------
    # FortiPAM verlangt diese Felder explizit (POST wendet keine Defaults an).
    # Ordner direkt unter Root: inherit-permission verboten, Owner Pflicht.
    owner = str(plan.get("_folder_owner") or "").strip()
    for f in todo_folders:
        if job.get("cancel"):
            break
        seg = f["path"].split("/")[-1]
        parent_id = path_to_id.get(_norm(f["parent_path"]), None)
        if parent_id is None:
            push("folder", f["path"], "error", "Übergeordneter Ordner wurde nicht angelegt")
            continue
        body = {"name": seg, "id": 0, "parent-folder": int(parent_id),
                "group-permission": []}
        if int(parent_id) == 0:
            if not owner:
                push("folder", f["path"], "error",
                     "Kein Owner für Root-Ordner konfiguriert")
                continue
            body["inherit-permission"] = "disable"
            body["user-permission"] = [{
                "id": 1, "user-name": [{"name": owner}],
                "folder-permission": "owner", "secret-permission": "owner",
                "allowed-launcher-type": "all"}]
        else:
            body["inherit-permission"] = "enable"
            body["user-permission"] = []
        try:
            resp = client.create("secret/folder", body)
            new_id = resp.get("mkey")
            if new_id is None:
                push("folder", f["path"], "error", "Antwort ohne neue Ordner-ID (mkey)")
                continue
            path_to_id[_norm(f["path"])] = int(new_id)
            push("folder", f["path"], "ok", f"angelegt (ID {new_id})")
        except FortiPAMError as exc:
            push("folder", f["path"], "error", str(exc))

    # ---- Targets (parallel) ------------------------------------------
    def create_target(t: dict):
        if job.get("cancel"):
            push("target", t["name"], "error", "abgebrochen")
            return
        try:
            client.create("secret/target", t["body"])
            push("target", t["name"], "ok", "angelegt")
        except FortiPAMError as exc:
            push("target", t["name"], "error", str(exc))

    # ---- Secrets (parallel) ------------------------------------------
    def create_secret(s: dict):
        if job.get("cancel"):
            push("secret", s["name"], "error", "abgebrochen", s.get("row"))
            return
        fid = s.get("folder_id")
        if fid is None:
            fid = path_to_id.get(_norm(s["folder_path"]))
        if fid is None:
            push("secret", s["name"], "error",
                 f"Ordner '{s['folder_path']}' wurde nicht angelegt", s.get("row"))
            return
        body = dict(s["body"])
        body["folder"] = int(fid)
        try:
            client.create("secret/database", body)
            push("secret", s["name"], "ok", f"angelegt in '{s['folder_path']}'", s.get("row"))
        except FortiPAMError as exc:
            push("secret", s["name"], "error", str(exc), s.get("row"))

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        # Targets vollständig vor den Secrets (Secrets referenzieren Targets)
        list(pool.map(create_target, todo_targets))
        list(pool.map(create_secret, todo_secrets))

    job["finished"] = True
    job["running"] = False
