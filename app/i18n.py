"""Sprachumschaltung für servergenerierte Texte (Deutsch = Standard/Schlüssel).

Die deutschen Originaltexte dienen als Katalog-Schlüssel; `tr()` liefert bei
aktivem Englisch die Übersetzung, sonst den Schlüssel selbst (mit Platzhaltern
im str.format-Stil).
"""
from __future__ import annotations

_LANG = "de"


def set_lang(lang: str) -> str:
    global _LANG
    _LANG = lang if lang in ("de", "en") else "de"
    return _LANG


def get_lang() -> str:
    return _LANG


def tr(key: str, **kw) -> str:
    text = _EN.get(key, key) if _LANG == "en" else key
    return text.format(**kw) if kw else text


_EN = {
    # ---- fortipam.py -------------------------------------------------
    "Nicht autorisiert – API-Token prüfen.":
        "Unauthorized – check the API token.",
    "Zugriff verweigert – Berechtigungen (accprofile) und Trusted Hosts des API-Users prüfen.":
        "Access denied – check the API user's access profile and trusted hosts.",
    "Pfad nicht gefunden – Basis-URL prüfen.":
        "Path not found – check the base URL.",
    "Methode nicht erlaubt.":
        "Method not allowed.",
    "Abhängigkeit fehlt – ein referenziertes Objekt (Template, Ordner, Tag …) existiert nicht.":
        "Missing dependency – a referenced object (template, folder, tag …) does not exist.",
    "Zu viele Anfragen – kurz warten und erneut versuchen.":
        "Too many requests – wait a moment and retry.",
    "Interner Fehler auf dem FortiPAM (Details siehe cli_error).":
        "Internal error on the FortiPAM (see cli_error for details).",
    "Verbindung fehlgeschlagen: {exc}":
        "Connection failed: {exc}",
    "Zeitüberschreitung bei der Anfrage an FortiPAM.":
        "Request to FortiPAM timed out.",
    "HTTP-Fehler: {exc}":
        "HTTP error: {exc}",
    "Fehlercode {err}":
        "Error code {err}",

    # ---- planner.py: Plan --------------------------------------------
    "Target-Name ist leer":
        "Target name is empty",
    "Klassifizierung '{cls}' unbekannt (Pflichtfeld)":
        "Classification '{cls}' unknown (mandatory field)",
    "Target-Template fehlt oder ist unbekannt (Pflichtfeld)":
        "Target template missing or unknown (mandatory field)",
    "Target ohne Adresse (IP/FQDN)":
        "Target without address (IP/FQDN)",
    "Kein gültiges Secret-Template gewählt":
        "No valid secret template selected",
    "Secret-Typ-Spalte ist leer":
        "Secret type column is empty",
    "Kein Template für Typ '{raw}' zugeordnet":
        "No template mapped for type '{raw}'",
    "Keine Template-Quelle konfiguriert":
        "No template source configured",
    "Ordner '{path}' existiert nicht":
        "Folder '{path}' does not exist",
    "Secrets können nicht direkt im Root-Ordner liegen – Unterordner wählen":
        "Secrets cannot live directly in the root folder – choose a subfolder",
    "Secret-Name ist leer":
        "Secret name is empty",
    "Referenziertes Target '{name}' existiert nicht":
        "Referenced target '{name}' does not exist",
    "Target '{name}' mehrfach mit abweichenden Daten – erste Definition gewinnt":
        "Target '{name}' defined multiple times with different data – first definition wins",
    "Existenz von Target '{name}' konnte nicht geprüft werden":
        "Could not verify whether target '{name}' exists",
    "Pflichtfeld '{fname}' ist leer":
        "Mandatory field '{fname}' is empty",
    "Passwort für Feld '{fname}' wird generiert":
        "Password for field '{fname}' will be generated",
    "Doppelt in Datei (zuerst Zeile {row})":
        "Duplicate in file (first in row {row})",
    "Template erwartet eine Ziel-Adresse (Feld '{field}') – ohne Target-Referenz lehnt das Gerät die Erstellung ab":
        "Template expects a target address (field '{field}') – without a target reference the device rejects creation",
    "Duplikat-Prüfung (Benutzer/Adresse) nicht möglich":
        "Duplicate check (user/address) not possible",
    "Gerät meldet bestehendes Secret für '{user}' auf {addr}: {msg}":
        "Device reports an existing secret for '{user}' on {addr}: {msg}",
    "Es werden Ordner direkt unter Root angelegt – dafür ist ein Owner nötig. Bitte im Mapping einen Owner für neue Root-Ordner wählen.":
        "Folders will be created directly under root – this requires an owner. Please select an owner for new root folders in the mapping.",

    # ---- planner.py: Ausführung --------------------------------------
    "Übergeordneter Ordner wurde nicht angelegt":
        "Parent folder was not created",
    "Kein Owner für Root-Ordner konfiguriert":
        "No owner configured for root folder",
    "Antwort ohne neue Ordner-ID (mkey)":
        "Response without new folder ID (mkey)",
    "angelegt (ID {id})":
        "created (ID {id})",
    "angelegt":
        "created",
    "abgebrochen":
        "cancelled",
    "Ordner '{path}' wurde nicht angelegt":
        "Folder '{path}' was not created",
    "angelegt in '{path}'":
        "created in '{path}'",

    # ---- main.py ------------------------------------------------------
    "Nicht mit FortiPAM verbunden.":
        "Not connected to FortiPAM.",
    "Keine Excel-Datei geladen.":
        "No Excel file loaded.",
    "Kein Plan vorhanden – zuerst Vorschau berechnen.":
        "No plan available – compute the preview first.",
    "Es läuft bereits eine Ausführung.":
        "An execution is already running.",
    "Es läuft bereits ein Vorgang.":
        "An operation is already running.",
    "Leere Datei.":
        "Empty file.",
    "Datei konnte nicht gelesen werden: {exc}":
        "File could not be read: {exc}",
    "Blatt konnte nicht gelesen werden: {exc}":
        "Sheet could not be read: {exc}",
    "Basis-URL und API-Token sind erforderlich.":
        "Base URL and API token are required.",
    "Für '{name}' ist kein Token gespeichert oder die Entschlüsselung schlug fehl — bitte Token eingeben.":
        "No token stored for '{name}' or decryption failed — please enter the token.",
    "Verbindung '{name}' nicht gefunden.":
        "Connection '{name}' not found.",
    "Template-Name fehlt.":
        "Template name missing.",
    "Kein Zugriff auf Template '{name}' – der API-User braucht 'create secret'-Berechtigung für dieses Template.":
        "No access to template '{name}' – the API user needs 'create secret' permission for this template.",
    "Template '{name}' wurde nicht gefunden.":
        "Template '{name}' was not found.",
    "Keine gültigen Templates gewählt.":
        "No valid templates selected.",
    "Unbekannter Objekttyp.":
        "Unknown object type.",
    "Objekttyp '{kind}' nicht löschbar.":
        "Object type '{kind}' cannot be deleted.",
    "Keine Objekte ausgewählt.":
        "No objects selected.",
    "Objekt nicht gefunden.":
        "Object not found.",
    "gelöscht":
        "deleted",
    "Ausführung":
        "Execution",

    # ---- excel_io.py --------------------------------------------------
    "Die Arbeitsmappe enthält keine Tabellenblätter.":
        "The workbook contains no sheets.",
    "Keine Kopfzeile im Blatt '{name}' gefunden.":
        "No header row found in sheet '{name}'.",
    "CSV-Datei konnte nicht dekodiert werden (UTF-8/CP1252).":
        "CSV file could not be decoded (UTF-8/CP1252).",
    "Keine Kopfzeile in der CSV-Datei gefunden.":
        "No header row found in the CSV file.",
    "Ordner": "Folders",
    "Klassifizierungen": "Classification tags",
    "Secret-Typ": "Secret type",
    "Benutzername": "Username",
    "Passwort": "Password",
    "Server-Info": "Server info",
    "Pfad": "Path",
    "Übergeordnet (ID)": "Parent (ID)",
    "Felder": "Fields",
    "Beschreibung": "Description",
    "Klassifizierung": "Classification",
    "Domäne": "Domain",
    "Adresse": "Address",
    "Beispielzeile für {name}": "Example row for {name}",
}
