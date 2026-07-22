/* Frontend-Sprachumschaltung. Deutsch = Quelle/Schlüssel, Englisch als Overlay.
   t("Deutscher Text", {n: 3}) -> Übersetzung oder Original mit {n}-Ersetzung.
   translateDom() übersetzt statische Textknoten + placeholder/title-Attribute. */
"use strict";

const I18N = {
  lang: "de",
  _orig: new WeakMap(),   // Textknoten/Attribut-Originale (deutsch)
};

const T_EN = {
  // ---- Kopfzeile / Navigation ----
  "Nicht verbunden": "Not connected",
  "Verbindung": "Connection",
  "Inventar": "Inventory",
  "Bulk-Import": "Bulk import",
  "Protokoll": "Log",
  "lokal · 127.0.0.1": "local · 127.0.0.1",
  "Token: RAM, optional DPAPI": "Token: RAM, optional DPAPI",

  // ---- Verbindungsansicht ----
  "zum FortiPAM": "to FortiPAM",
  "Gespeicherte Verbindung": "Saved connection",
  "— Neue Verbindung —": "— New connection —",
  "Löschen": "Delete",
  "Name der Verbindung": "Connection name",
  "z. B. PAM Produktion": "e.g. PAM production",
  "FortiPAM-URL": "FortiPAM URL",
  "API-Token": "API token",
  "API-Schlüssel des REST-API-Admins": "API key of the REST API admin",
  "leer lassen = gespeicherten Token verwenden": "leave empty = use stored token",
  "TLS-Zertifikat prüfen": "Verify TLS certificate",
  "Nur nötig, wenn VDOMs aktiviert sind": "Only needed if VDOMs are enabled",
  "optional": "optional",
  "Verbindung speichern": "Save connection",
  "(Token DPAPI-verschlüsselt, an dieses Windows-Konto gebunden)":
    "(token DPAPI-encrypted, bound to this Windows account)",
  "Verbinden": "Connect",
  "Verbinde …": "Connecting …",
  "Trennen": "Disconnect",
  "Der API-Token gehört zu einem REST-API-Administrator (FortiPAM:":
    "The API token belongs to a REST API administrator (FortiPAM:",
  ") mit einem Zugriffsprofil, das Lese-/Schreibrechte auf Secrets besitzt. Trusted Hosts beachten.":
    ") with an access profile that has read/write permissions on secrets. Mind the trusted hosts.",
  "Gerät": "Device",
  "Version": "Version",
  "Seriennummer": "Serial number",
  "VDOM": "VDOM",

  // ---- Inventar ----
  "Bestand auf dem FortiPAM": "Inventory on the FortiPAM",
  "Export (.xlsx)": "Export (.xlsx)",
  "Neu laden": "Reload",
  "Targets": "Targets",
  "Secrets": "Secrets",
  "Ordner": "Folders",
  "Templates": "Templates",
  "Klassifizierungen": "Classification tags",
  "Suchen … (Enter hält den Filter fest)": "Search … (Enter pins the filter)",
  "Suchsyntax anzeigen": "Show search syntax",
  "+ Filter": "+ Filter",
  "Zurücksetzen": "Reset",
  "Auswahl löschen": "Delete selection",
  "Filtern ohne Tippen:": "Filter without typing:",
  "Werte in der Tabelle anklicken (unterstrichelt) oder das":
    "Click values in the table (underlined) or use the",
  "„+ Filter\"-Menü nutzen — jeder Filter erscheint als Chip und lässt sich einzeln":
    "\"+ Filter\" menu — each filter becomes a chip and can be removed",
  "entfernen. Mehrere Chips derselben Spalte = ODER, verschiedene Spalten = UND.":
    "individually. Multiple chips in the same column = OR, different columns = AND.",
  "Suchfeld:": "Search field:",
  "mehrere Begriffe = UND ·": "multiple terms = AND ·",
  "spalte:wert": "column:value",
  "nur in einer Spalte ·": "only in one column ·",
  "-begriff": "-term",
  "ausschließen ·": "exclude ·",
  "a|b": "a|b",
  "oder ·": "or ·",
  "\"Phrase mit Leerzeichen\"": "\"quoted phrase\"",
  "·": "·",
  "hält die Eingabe als Chip fest.": "pins the input as a chip.",
  "Sortieren:": "Sort:",
  "Spaltenkopf anklicken (auf/ab).": "click the column header (asc/desc).",
  "Enter": "Enter",
  "Keine Einträge.": "No entries.",
  "Filter entfernen": "Remove filter",
  "Filter hinzufügen": "Add filter",
  "alle auswählen": "select all",
  "alle (gefilterten) auswählen": "select all (filtered)",
  "inklusive Unterordner": "including subfolders",
  "Gesamt": "Total",
  "ID": "ID",
  "aufklappen": "expand",
  "zuklappen": "collapse",
  "Schließen": "Close",

  // ---- Inventar-Spalten / Kacheln ----
  "Name": "Name",
  "Adresse": "Address",
  "Template": "Template",
  "Klassifizierung": "Classification",
  "Domäne": "Domain",
  "Beschreibung": "Description",
  "Pfad": "Path",
  "Übergeordnet (ID)": "Parent (ID)",
  "Felder": "Fields",
  "Server-Info": "Server info",
  "Target": "Target",
  "Secrets sichtbar": "Secrets visible",
  "Ordner sichtbar": "Folders visible",

  // ---- Import: Schritte ----
  "Excel → Targets & Secrets": "Excel → targets & secrets",
  "Datei": "File",
  "Mapping": "Mapping",
  "Vorschau": "Preview",
  "Ausführung": "Execution",
  "Excel- oder CSV-Datei hierher ziehen": "Drag an Excel or CSV file here",
  "oder klicken zum Auswählen": "or click to select",
  ".xlsx / .csv · erste nicht-leere Zeile = Spaltenüberschriften":
    ".xlsx / .csv · first non-empty row = column headers",
  "Beispiel-Vorlage herunterladen": "Download sample template",
  "Mehrfachauswahl mit Strg/Umschalt": "Multi-select with Ctrl/Shift",
  "Vorlage passend zu Templates": "Template matching the FortiPAM templates",
  "Vorlage erzeugen": "Generate template",

  // ---- Import: Mapping ----
  "Was soll erstellt werden?": "What should be created?",
  "Targets erstellen": "Create targets",
  "Secrets erstellen": "Create secrets",
  "Fehlende Ordner automatisch anlegen": "Create missing folders automatically",
  "Fragt das Gerät, ob es zu Benutzername + Zieladresse bereits ein Secret gibt (auch unter anderem Namen)":
    "Asks the device whether a secret already exists for username + target address (even under a different name)",
  "Geräteprüfung Benutzer+Adresse": "Device check user+address",
  "Erzeugt für leere Pflicht-Passwortfelder starke Zufallspasswörter (Klein-/Großbuchstaben, Ziffern, Sonderzeichen)":
    "Generates strong random passwords for empty mandatory password fields (lower/upper case, digits, special chars)",
  "Fehlende Passwörter generieren": "Generate missing passwords",
  "Länge (8–64)": "Length (8–64)",
  "Secret-Typ": "Secret type",
  "→ FortiPAM-Template": "→ FortiPAM template",
  "Quelle": "Source",
  "Weiteres Template laden": "Load another template",
  "exakter Template-Name": "exact template name",
  "Laden": "Load",
  "Ziel-Ordner": "Target folder",
  "für Secrets": "for secrets",
  "Modus": "Mode",
  "Fester Ordner (vorhanden)": "Fixed folder (existing)",
  "Fester Pfad (wird ggf. angelegt)": "Fixed path (created if needed)",
  "Aus Spalte (Pfad, z. B. Linux/Prod)": "From column (path, e.g. Linux/Prod)",
  "Pfad": "Path",
  "z. B. Import/2026": "e.g. Import/2026",
  "Spalte": "Column",
  "Basisordner": "Base folder",
  "Pflicht, wenn Ordner direkt unter Root angelegt werden":
    "Required when folders are created directly under root",
  "Owner neuer Root-Ordner": "Owner of new root folders",
  "Hinweis: Secrets können nicht direkt im Root-Ordner liegen. Neue Ordner direkt unter Root benötigen einen Owner.":
    "Note: secrets cannot live directly in the root folder. New folders directly under root require an owner.",
  "Target-Felder": "Target fields",
  "Secret-Felder": "Secret fields",
  "Secret-Optionen": "Secret options",
  "für alle importierten Secrets": "for all imported secrets",
  "Checkout": "Checkout",
  "Sitzungs-Aufzeichnung": "Session recording",
  "Password-Changer": "Password changer",
  "Passwort-Heartbeat": "Password heartbeat",
  "— Gerätestandard —": "— device default —",
  "aktivieren": "enable",
  "deaktivieren": "disable",
  "Vorschau berechnen →": "Compute preview →",
  "Berechne …": "Computing …",
  "Mapping-Profil speichern": "Save mapping profile",
  "Mapping-Profil laden": "Load mapping profile",
  "fester Wert": "fixed value",
  "Root": "Root",

  // ---- Import: Vorschau / Ausführung ----
  "← Mapping anpassen": "← Adjust mapping",
  "Jetzt erstellen": "Create now",
  "Ausführung läuft …": "Execution running …",
  "Abbrechen": "Cancel",
  "Fertig – Inventar aktualisieren": "Done – refresh inventory",
  "Targets neu": "Targets new",
  "Secrets neu": "Secrets new",
  "Ordner neu": "Folders new",
  "Übersprungen": "Skipped",
  "Fehler": "Errors",
  "Zeilen": "Rows",
  "Aktion": "Action",
  "Hinweise": "Notes",
  "Zeile": "Row",
  "Zeilenfehler": "Row errors",
  "Nichts zu tun.": "Nothing to do.",
  "erstellen": "create",
  "existiert": "exists",
  "fehler": "error",
  "doppelt": "duplicate",
  "Nichts zu tun": "Nothing to do",

  // ---- Protokoll ----
  "dieser Sitzung": "of this session",
  "Als Datei speichern": "Save to file",

  // ---- dynamische Kurztexte ----
  "Suche": "Search",
  "Verbindung hergestellt.": "Connected.",
  "Verbindung getrennt.": "Disconnected.",
  "Zum Speichern der Verbindung bitte einen Namen vergeben.":
    "Please provide a name to save the connection.",
  "Vorlage erzeugen": "Generate template",
  "Bitte mindestens ein Template auswählen.": "Please select at least one template.",
  "Mapping-Profil gespeichert.": "Mapping profile saved.",
  "Profil geladen.": "Profile loaded.",
  "Objekte gelöscht.": "Objects deleted.",
  "Alle Objekte erstellt.": "All objects created.",
  "Abgeschlossen – alles erstellt": "Completed – everything created",
  "Nichts zu tun.": "Nothing to do.",

  // ---- Upload-Info ----
  "Blatt": "Sheet",
  "Datei:": "File:",
  "Blatt:": "Sheet:",
  "Zeilen:": "Rows:",
  "Spalten:": "Columns:",
  "Weiter zum Mapping →": "Continue to mapping →",
  "Datei wurde auf 5000 Zeilen begrenzt.": "File was limited to 5000 rows.",
  "Vorschau berechnen →": "Compute preview →",
  "Adresse (IP/FQDN)": "Address (IP/FQDN)",
  "Ziel": "Target device",
  "Abgeschlossen –": "Completed –",
  "{n} Objekt(e) löschen?": "Delete {n} object(s)?",
  "und {n} weitere": "and {n} more",
  "Wirklich ENDGÜLTIG löschen?": "Really delete PERMANENTLY?",
  "{n} Objekt(e) auf {dev}": "{n} object(s) on {dev}",
  "Dies kann nicht rückgängig gemacht werden.": "This cannot be undone.",
  "Löschen beendet – {n} Fehler.": "Deletion finished – {n} errors.",
  "Fertig mit {n} Fehlern.": "Finished with {n} errors.",
  "Nach {c} sortieren": "Sort by {c}",
  "Zeilen mit Fehlern werden bei der Ausführung übersprungen.":
    "Rows with errors are skipped during execution.",
  "Neue Ordner:": "New folders:",
  "erstellen": "create",
  "existiert": "exists",
  "fehler": "error",
  "doppelt": "duplicate",

  // ---- Mapping-Selects (dynamisch) ----
  "— nicht setzen —": "— do not set —",
  "Fester Wert …": "Fixed value …",
  "FortiPAM-Werte": "FortiPAM values",
  "Excel-Spalten": "Excel columns",
  "Spalte": "Column",
  "fester Wert": "fixed value",
  "Festes Template für alle Zeilen": "Fixed template for all rows",
  "— nicht zugeordnet —": "— not mapped —",
  "FortiPAM-Template": "FortiPAM template",
  "Wert in Spalte '{col}'": "Value in column '{col}'",
  "Spalte '{col}' hat zu viele oder keine unterschiedlichen Werte – bitte andere Spalte oder festes Template wählen.":
    "Column '{col}' has too many or no distinct values – please choose a different column or a fixed template.",
  "Noch kein Template gewählt bzw. zugeordnet – oben die Secret-Typ-Zuordnung vervollständigen.":
    "No template selected or mapped yet – complete the secret-type mapping above.",
};

function t(de, vars) {
  const key = String(de).replace(/\s+/g, " ").trim();
  let s = (I18N.lang === "en" && T_EN[key] !== undefined) ? T_EN[key] : de;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}

/* Container mit Nutzerdaten NICHT übersetzen (nur statische UI-Chrome sweepen). */
const I18N_SKIP = new Set([
  "invTable", "previewTable", "planTable", "invTiles", "invChips", "invDetail",
  "invFilterSelects", "filterMenu", "uploadInfo", "execLog", "sessionLog",
  "connResult", "planWarnings", "planTiles", "tplValueMap", "mapTarget",
  "mapSecretBase", "mapSecretFields", "tplListingNote", "toasts",
]);

function _inSkip(node) {
  for (let el = node.parentNode; el && el !== document.body; el = el.parentNode) {
    if (el.nodeType === 1 && (I18N_SKIP.has(el.id) || el.nodeName === "SELECT"))
      return true;
  }
  return false;
}

/* Statische Textknoten + placeholder/title übersetzen (idempotent über _orig-Cache).
   Dynamische Container/Selects bleiben unangetastet (dort greift t() beim Bauen). */
function translateDom(root) {
  root = root || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentNode;
      if (!p || p.nodeName === "SCRIPT" || p.nodeName === "STYLE") return NodeFilter.FILTER_REJECT;
      if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return _inSkip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const n of nodes) {
    let orig = I18N._orig.get(n);
    if (orig === undefined) { orig = n.nodeValue; I18N._orig.set(n, orig); }
    const key = orig.replace(/\s+/g, " ").trim();
    const translated = t(key);
    n.nodeValue = (translated !== key) ? orig.replace(orig.trim(), translated) : orig;
  }
  root.querySelectorAll("[placeholder],[title]").forEach((el) => {
    if (_inSkip(el)) return;
    for (const attr of ["placeholder", "title"]) {
      if (!el.hasAttribute(attr)) continue;
      let store = I18N._orig.get(el) || {};
      if (store[attr] === undefined) { store[attr] = el.getAttribute(attr); I18N._orig.set(el, store); }
      const orig = store[attr];
      if (orig && orig.trim()) el.setAttribute(attr, t(orig));
    }
  });
}
