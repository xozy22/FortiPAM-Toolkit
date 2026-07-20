# FortiPAM Toolkit

> **Disclaimer / Hinweis:** Dies ist ein **inoffizielles Community-Tool** und
> steht in keiner Verbindung zu Fortinet Inc. Es ist **kein offizielles
> Fortinet-Produkt**, wird von Fortinet weder unterstützt noch geprüft.
> „Fortinet" und „FortiPAM" sind Marken der Fortinet Inc. Nutzung auf eigene
> Verantwortung — vor dem Einsatz auf Produktivsystemen bitte zuerst gegen
> eine Test-/Demo-Instanz prüfen.
>
> *This is an unofficial community tool, not affiliated with, endorsed, or
> supported by Fortinet Inc. Use at your own risk.*

Lokales Windows-Tool zur Verwaltung von **Targets** und **Secrets** auf einem
Fortinet **FortiPAM** (getestet gegen API v1.9.0, Build 1751 — Mock und
Live-Gerät). Kernfunktionen:

- Bestand auslesen (Targets, Secrets, Ordner, Templates, Klassifizierungen)
  und als **Excel exportieren**
- Excel-Datei (.xlsx) einlesen; **Vorlagen-Generator** passend zu den
  Templates des eigenen FortiPAM
- Spalten-Mapping inkl. Zuordnung *Secret-Typ → FortiPAM-Template*;
  Mapping als **Profil** speicher- und wiederladbar (für wiederkehrende Importe)
- Bulk-Erstellung von Targets und Secrets (optional inkl. fehlender Ordner),
  **parallelisiert** mit automatischem Retry bei Rate-Limits (HTTP 429)
- Duplikat-Erkennung: bereits vorhandene Objekte werden übersprungen
- Vorschau (Plan) vor jeder Änderung, Live-Protokoll bei der Ausführung
- Optionale Token-Speicherung, **DPAPI-verschlüsselt** an das
  Windows-Benutzerkonto gebunden

Die App läuft komplett lokal (`127.0.0.1`), die Oberfläche im Browser.

## Schnellstart

1. **Python 3.11+** installieren (falls nicht vorhanden): <https://www.python.org/downloads/>
2. `start.bat` doppelklicken — beim ersten Start wird eine virtuelle Umgebung
   angelegt und die Abhängigkeiten installiert. Danach öffnet sich der Browser
   automatisch (Standard-Port 8420).
3. In der App verbinden: FortiPAM-URL + API-Token.

## API-Token auf dem FortiPAM erstellen

1. FortiPAM-GUI: `System › Administrator › Create New › REST API Admin`
2. Ein **Administratorprofil** zuweisen, das Lese-/Schreibrechte auf den
   Secrets-Bereich hat (`secgrp` bzw. entsprechendes Zugriffsprofil).
3. **Trusted Hosts** setzen (die IP des Rechners, auf dem dieses Toolkit läuft).
4. Beim Erzeugen wird der **API-Schlüssel** einmalig angezeigt — diesen Token
   in der App eintragen.

Der Token wird standardmäßig **nur im Arbeitsspeicher** gehalten. Die Option
„Zugangsdaten sicher speichern" legt ihn **DPAPI-verschlüsselt** unter
`%APPDATA%\FortiPAM-Toolkit\connection.json` ab — entschlüsselbar nur vom
angemeldeten Windows-Benutzer auf diesem Rechner. Über „Gespeicherte Daten
löschen" wird die Ablage wieder entfernt.

## Excel-Format

Die erste nicht-leere Zeile ist die Kopfzeile; jede weitere Zeile wird ein
Target und/oder Secret. Eine Beispiel-Vorlage gibt es in der App unter
*Bulk-Import › Beispiel-Vorlage herunterladen*. Typische Spalten:

| Name | Adresse | Secret-Typ | Benutzername | Passwort | Domäne | Ordner | Beschreibung |
|------|---------|-----------|--------------|----------|--------|--------|--------------|
| srv-linux-01 | 10.10.1.21 | linux | root | … | | Linux/Produktion | Webserver |

- **Secret-Typ**: freie Werte (z. B. `linux`, `windows`) — die Zuordnung zu
  FortiPAM-Templates erfolgt im Mapping-Schritt.
- **Ordner**: Pfad mit `/` als Trenner, relativ zum gewählten Basisordner.
  Fehlende Ordner können automatisch angelegt werden.
- Spaltennamen sind frei — das Mapping wird in der App konfiguriert
  (mit automatischer Vorbelegung anhand der Spaltennamen).

## Ablauf in der App

1. **Verbindung** — URL, Token, ggf. TLS-Prüfung/VDOM.
2. **Inventar** — liest den Bestand; dient auch als Duplikat-Referenz.
3. **Bulk-Import**
   1. *Datei*: Excel hochladen, Blatt wählen, Vorschau prüfen.
   2. *Mapping*: Secret-Typ → Template, Ziel-Ordner, Target-/Secret-Felder.
   3. *Vorschau*: Plan mit Aktionen (erstellen / existiert / Fehler) prüfen.
   4. *Ausführung*: Erstellung mit Live-Fortschritt; Reihenfolge
      Ordner → Targets → Secrets.

## Als EXE paketieren (optional)

```
build_exe.bat
```

erzeugt mit PyInstaller eine portable `dist\FortiPAM-Toolkit.exe`
(kein installiertes Python auf dem Zielrechner nötig).

## Technische Hinweise

- Backend: FastAPI + httpx, Frontend: Vanilla JS (keine externen CDNs —
  funktioniert auch in Netzwerken ohne Internetzugang).
- FortiPAM-API: `/api/v2/cmdb/secret/target`, `/api/v2/cmdb/secret/database`,
  `/api/v2/cmdb/secret/folder`, `/api/v2/cmdb/secret/template`,
  `/api/v2/cmdb/secret/classification-tag` (Bearer-Token-Auth).
- Selbstsignierte Zertifikate: TLS-Prüfung ist standardmäßig deaktiviert und
  kann in der Verbindungsmaske aktiviert werden.
- Max. 5000 Zeilen pro Excel-Datei.
- Die CMDB-Schema-Referenz (`FortiPAM_json_api_ref.json`) ist **nicht Teil des
  Repos** (geräte-spezifischer Dump). Sie wird zur Laufzeit nicht benötigt und
  kann bei Bedarf vom eigenen FortiPAM abgerufen werden
  (`GET /api/v2/cmdb?action=schema`).

## Am echten Gerät verifizierte API-Eigenheiten (v1.9.0, Build 1751)

Diese Punkte weichen vom CMDB-Schema ab und sind im Toolkit berücksichtigt:

- **Kein Collection-GET** auf `secret/target` und `secret/template`
  („Unable to get mkey from uri"). Das Toolkit weicht auf Einzelabfragen aus:
  Templates werden über eine Kandidatenliste + Referenzen aus Secrets ermittelt
  (weitere per Namen nachladbar), Target-Duplikate werden pro Name live geprüft.
- **POST wendet keine Defaults an**: `secret/folder` und `secret/database`
  verlangen u. a. `inherit-permission` explizit im Payload.
- **Ordner direkt unter Root**: `inherit-permission` muss `disable` sein und
  eine `user-permission` mit `folder-permission: owner` ist Pflicht
  (Owner ist in der App wählbar, Vorbelegung: erster REST-API-Admin).
- **Secrets können nicht in Root** (`folder_id can't be 0`) liegen — es ist
  immer ein (Unter-)Ordner nötig.
- Template-Einzelabfragen liefern **403 auch für nicht existierende Namen**,
  wenn der API-User keine „create secret"-Berechtigung für das Template hat —
  nur 200-Antworten sind verlässlich nutzbar.

## Entwicklung / Testen ohne echtes Gerät

`dev\mock_fortipam.py` simuliert die FortiPAM-API auf `http://127.0.0.1:9443`
(Token beliebig). `dev\e2e_test.py` fährt den kompletten Ablauf automatisch ab:

```
.venv\Scripts\python.exe dev\mock_fortipam.py     (Terminal 1)
start.bat                                          (Terminal 2)
.venv\Scripts\python.exe dev\e2e_test.py          (Terminal 3)
```
