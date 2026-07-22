"""Unit-Tests für app.planner (pytest, ohne Gerät/Mock lauffähig)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import planner  # noqa: E402

MASK = planner.MASK


# ---------------------------------------------------------------------------
# Hilfsdaten
# ---------------------------------------------------------------------------

def make_inventory():
    return {
        "templates": [
            {"name": "Unix Account (SSH Password)", "server-info": "Unix-like",
             "field": [
                 {"name": "Host", "type": "target-address", "mandatory": "enable"},
                 {"name": "Username", "type": "username", "mandatory": "enable"},
                 {"name": "Password", "type": "password", "mandatory": "enable"},
             ]},
        ],
        "class_tags": [{"name": "Import"}],
        "targets": [{"name": "alt-01", "address": "10.0.0.5"}],
        "folders": [
            {"id": 1, "name": "Linux", "parent-folder": 0},
            {"id": 2, "name": "Produktion", "parent-folder": 1},
        ],
        "secrets": [{"id": 9, "name": "alt-01", "folder": 2}],
        "target_listing": True,
    }


def make_mapping(**opts):
    options = {"create_targets": True, "create_secrets": True,
               "auto_create_folders": True, "root_folder_owner": "api",
               "dup_check": False}
    options.update(opts)
    return {
        "options": options,
        "target": {
            "name": {"type": "column", "value": "Name"},
            "address": {"type": "column", "value": "Adresse"},
            "class": {"type": "fixed", "value": "Import"},
            "template": {"type": "secret_template"},
        },
        "secret": {
            "name": {"type": "column", "value": "Name"},
            "target": {"type": "row_target"},
            "folder": {"type": "column_path", "value": "Ordner", "base": 0},
            "template": {"type": "column", "value": "Typ",
                         "value_map": {"linux": "Unix Account (SSH Password)"}},
            "fields": {"Unix Account (SSH Password)": {
                "Username": {"type": "column", "value": "User"},
                "Password": {"type": "column", "value": "Passwort"},
            }},
        },
    }


def row(n, name, ordner="Linux/Produktion", typ="linux",
        user="root", pw="Geheim1!", addr="10.1.1.1"):
    return {"_row": n, "Name": name, "Adresse": addr, "Typ": typ,
            "User": user, "Passwort": pw, "Ordner": ordner}


# ---------------------------------------------------------------------------
# Basisfunktionen
# ---------------------------------------------------------------------------

def test_generate_password_properties():
    pw = planner.generate_password()
    assert len(pw) == 20
    assert len(planner.generate_password(1)) == 8       # Untergrenze
    assert len(planner.generate_password(999)) == 64    # Obergrenze
    for cls in planner._PW_CLASSES:
        assert any(c in cls for c in pw), f"Zeichenklasse fehlt: {cls}"
    assert planner.generate_password() != planner.generate_password()


def test_folder_paths():
    id_to_path, path_to_id = planner.folder_paths(make_inventory()["folders"])
    assert id_to_path[2] == "Linux/Produktion"
    assert path_to_id["linux/produktion"] == 2
    assert path_to_id[""] == 0


def test_resolve_source():
    r = {"Spalte": " wert "}
    assert planner.resolve_source({"type": "column", "value": "Spalte"}, r) == "wert"
    assert planner.resolve_source({"type": "fixed", "value": "fest"}, r) == "fest"
    assert planner.resolve_source(None, r) == ""
    assert planner.resolve_source({"type": "column", "value": "fehlt"}, r) == ""


# ---------------------------------------------------------------------------
# Plan-Erstellung
# ---------------------------------------------------------------------------

def test_plan_creates_target_and_secret():
    plan, public = planner.build_plan(make_mapping(), [row(2, "neu-01")], make_inventory())
    s = plan["summary"]
    assert s["targets_create"] == 1 and s["secrets_create"] == 1
    assert s["secrets_error"] == 0 and s["folders_create"] == 0
    body = plan["secrets"][0]["body"]
    assert body["template"] == "Unix Account (SSH Password)"
    assert body["inherit-permission"] == "enable"
    assert body["target"] == "neu-01"


def test_plan_existing_objects_skipped():
    plan, _ = planner.build_plan(make_mapping(), [row(2, "alt-01")], make_inventory())
    s = plan["summary"]
    assert s["targets_exist"] == 1 and s["targets_create"] == 0
    assert s["secrets_exist"] == 1 and s["secrets_create"] == 0


def test_plan_file_duplicate_detected():
    rows = [row(2, "dup-01"), row(3, "dup-01")]
    plan, _ = planner.build_plan(make_mapping(), rows, make_inventory())
    assert plan["summary"]["secrets_create"] == 1
    assert plan["summary"]["secrets_duplicate"] == 1


def test_plan_unknown_type_is_error():
    plan, _ = planner.build_plan(make_mapping(), [row(2, "x", typ="windows")],
                                 make_inventory())
    assert plan["summary"]["secrets_error"] == 1
    assert "windows" in plan["secrets"][0]["error"]


def test_plan_folder_chain_and_root_level():
    plan, _ = planner.build_plan(make_mapping(), [row(2, "x", ordner="Neu/Tief")],
                                 make_inventory())
    paths = [f["path"] for f in plan["folders"]]
    assert paths == ["Neu", "Neu/Tief"]
    assert plan["folders"][0]["root_level"] is True
    assert plan["folders"][1]["root_level"] is False


def test_root_folder_without_owner_gives_notice():
    m = make_mapping(root_folder_owner="")
    plan, public = planner.build_plan(m, [row(2, "x", ordner="Neu")], make_inventory())
    assert plan["notices"] and "Owner" in plan["notices"][0]
    assert public["notices"] == plan["notices"]


def test_password_masked_only_in_public_plan():
    plan, public = planner.build_plan(make_mapping(), [row(2, "neu-01")], make_inventory())
    internal = {f["name"]: f["value"] for f in plan["secrets"][0]["body"]["field"]}
    masked = {f["name"]: f["value"] for f in public["secrets"][0]["body"]["field"]}
    assert internal["Password"] == "Geheim1!"
    assert masked["Password"] == MASK
    assert masked["Username"] == "root"


def test_generate_passwords_option():
    m = make_mapping(generate_passwords=True, password_length=24)
    plan, _ = planner.build_plan(m, [row(2, "neu-01", pw="")], make_inventory())
    sec = plan["secrets"][0]
    pw = next(f["value"] for f in sec["body"]["field"] if f["name"] == "Password")
    assert len(pw) == 24
    assert any("generiert" in w for w in sec["warnings"])


def test_missing_password_without_generator_warns():
    plan, _ = planner.build_plan(make_mapping(), [row(2, "neu-01", pw="")],
                                 make_inventory())
    assert any("leer" in w for w in plan["secrets"][0]["warnings"])


def test_target_address_warning_without_target():
    m = make_mapping(create_targets=False)
    plan, _ = planner.build_plan(m, [row(2, "neu-01")], make_inventory())
    assert any("Ziel-Adresse" in w for w in plan["secrets"][0]["warnings"])


def test_secret_options_applied():
    m = make_mapping()
    m["secret"]["options"] = {"checkout": "enable", "recording": "quatsch"}
    plan, _ = planner.build_plan(m, [row(2, "neu-01")], make_inventory())
    body = plan["secrets"][0]["body"]
    assert body["checkout"] == "enable"
    assert "recording" not in body          # ungültiger Wert wird ignoriert


def test_device_dup_checker_warning_and_cache():
    calls = []

    def dup_checker(user, addr):
        calls.append((user, addr))
        return True, "owned by [api]"

    m = make_mapping(dup_check=True)
    rows = [row(2, "a-01"), row(3, "b-01")]    # gleiche user/addr -> 1 Aufruf
    plan, _ = planner.build_plan(m, rows, make_inventory(), dup_checker=dup_checker)
    assert all(any("bestehendes Secret" in w for w in s["warnings"])
               for s in plan["secrets"])
    assert len(calls) == 1                     # Cache greift


def test_target_checker_used_when_listing_incomplete():
    inv = make_inventory()
    plan, _ = planner.build_plan(make_mapping(), [row(2, "unbekannt-01")], inv,
                                 target_checker=lambda name: True)
    assert plan["summary"]["targets_exist"] == 1
