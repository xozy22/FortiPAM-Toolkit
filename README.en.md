<p align="center">
  <img src="assets/logo.svg" alt="FortiPAM Toolkit" width="680">
</p>

<p align="center">
  <a href="https://github.com/xozy22/FortiPAM-Toolkit/actions/workflows/ci.yml"><img src="https://github.com/xozy22/FortiPAM-Toolkit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-2ea44f" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Platform-Windows-0078d4" alt="Platform: Windows">
  <img src="https://img.shields.io/badge/Python-3.11%2B-3776ab" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/FortiPAM-tested_on_v1.9.x-ff6a2b" alt="Tested on FortiPAM v1.9.x">
  <img src="https://img.shields.io/badge/Data-100%25_local-1d2226" alt="100% local">
</p>

<p align="center"><a href="README.md">Deutsch</a> · <b>English</b></p>

> **Disclaimer:** This is an **unofficial community tool**, not affiliated
> with, endorsed, or supported by Fortinet Inc. It is not an official Fortinet
> product. "Fortinet" and "FortiPAM" are trademarks of Fortinet Inc.
> Use at your own risk — please test against a demo/staging instance before
> touching production systems.

---

A local Windows tool for bulk management of **targets** and **secrets** on a
Fortinet **FortiPAM** appliance. Feed it an Excel or CSV list, configure the
mapping, review the plan, and bulk-create — with three layers of duplicate
protection, and without a single password leaving your network. Tested against
FortiPAM **v1.9.0/v1.9.1** (mock suite with 70 checks plus a live appliance).
The UI is currently German.

## Features

### Inventory
- Full view of targets, secrets, folders, templates, and classification tags —
  loaded page-wise, stable even with large datasets
- **Folders as a collapsible tree** with secret counts per folder
  (direct + including subfolders)
- **Visible / total counters** that reveal missing API-user permissions
  (FortiPAM filters secrets and folders per user)
- **Detail view** on click — sensitive field values (passwords, passphrases,
  private keys) are masked server-side
- **Bulk delete** with checkbox selection, double confirmation, and a live
  log (order: secrets → targets → folders)
- **Excel export** of the whole inventory (one sheet per object type)
- **Click-to-filter**: click any value in the table or use the "+ Filter"
  menu (all values with hit counts, multi-select) — every filter becomes a
  removable **chip**. Same column = OR, different columns = AND, freely
  combined with the text search (Enter pins the query as a chip). Search
  syntax for power users: `column:value`, `-term` (exclude), `a|b` (or),
  `"quoted phrase"`. Sortable column headers included.

### Bulk import
- Read **Excel (.xlsx) or CSV** files — delimiter and encoding are detected
  automatically, column names are free-form
- **Mapping assistant** with automatic column detection: free-form secret
  types (e.g. `linux`, `windows`) are mapped to FortiPAM templates, columns
  to template fields
- **Template generator**: builds an import template that matches the
  templates of your own appliance
- **Mapping profiles**: save the whole configuration as JSON and reuse it
- Target folder fixed, as a fixed path, or from a column (`Linux/Prod`);
  missing folders are created automatically (including the owner rule for
  root-level folders)
- **Password generator** for empty mandatory password fields (strong random
  values, length 8–64)
- **Secret options** per import: checkout, session recording, password
  changer, and password heartbeat
- **Preview before any change**: plan with actions (create / exists / error),
  per-row warnings, masked passwords
- **Parallel execution** (6 workers) with automatic retry on rate limits
  (HTTP 429) and live progress

### Duplicate protection (three layers)
1. **Name + folder** against the listed inventory
2. **Live per-name lookup** for targets — covers the appliance's consistency
   window after bulk runs (single lookups are immediately consistent)
3. **Device-side check** of username + target address via the internal API
   (`secret-dup-check`) — finds existing accounts even under different names
   and across permission boundaries

### Connection manager
- Store **multiple FortiPAM systems** as named profiles (e.g. "PAM prod",
  "PAM test") and switch via dropdown
- The API token is stored **DPAPI-encrypted** per profile (bound to your
  Windows user account); reconnect without re-entering the token
- The last-used profile is preselected on start; profiles can be deleted
  individually (removes the stored token as well)

### Security
- Runs exclusively on `127.0.0.1` — no cloud, no telemetry, no external CDNs
  (works in air-gapped networks)
- API token kept **in memory only** by default; optionally stored
  DPAPI-encrypted per profile (`%APPDATA%\FortiPAM-Toolkit\connections.json`)
- Passwords never appear in clear text in previews or detail views

## Quick start

**Option A — with Python (recommended for development):**

1. Install [Python 3.11+](https://www.python.org/downloads/)
2. Double-click `start.bat` — on first run it sets up a virtual environment
   and installs the dependencies, then your browser opens automatically
   (port 8420)

**Option B — portable EXE:**

Download the prebuilt EXE from the
[Releases page](https://github.com/xozy22/FortiPAM-Toolkit/releases)
(built and smoke-tested automatically for every release) — or build it
yourself:

```
build_exe.bat
```

produces `dist\FortiPAM-Toolkit.exe` (~15 MB, no Python required on the
target machine). The EXE is unsigned — confirm the SmartScreen prompt via
"More info → Run anyway" on first start.

## Preparing FortiPAM

### Create a REST API admin

1. FortiPAM GUI: `System › Administrator › Create New › REST API Admin`
2. Assign an administrator profile with read/write access to the secrets
   area (`secgrp` or an equivalent access profile)
3. Set **Trusted Hosts** to the IP of the machine running the toolkit
4. Enter the one-time **API key** in the app

### Folder permissions (important!)

FortiPAM filters secrets and folders **per user** — independent of the
administrator profile. The API user only sees objects it is granted via
`user-permission`. To let the toolkit see existing inventory: in the GUI,
add the API user (with folder and secret permission) to the top-level
folders under *Permissions* — subfolders inherit if inheritance is enabled.
The inventory shows "visible / total" and warns when entries are missing.
Root-level folders created by the toolkit automatically get the API user
as owner.

### Managing connections

The connection screen stores multiple FortiPAM systems as **named profiles**:

- **New connection**: enter name, URL, and token, keep "save connection"
  enabled, connect — the profile is created.
- **Use an existing profile**: pick it from the dropdown; URL/VDOM fill in
  automatically. Leave the token field empty to use the stored token.
- **Delete a profile**: select it and click delete — this also removes the
  stored token.

Tokens are stored **DPAPI-encrypted** per profile in
`%APPDATA%\FortiPAM-Toolkit\connections.json` — decryptable only by the
logged-in Windows user on this machine. Without "save connection" the token
stays in memory for the running session only.

## Workflow

1. **Connect** — pick or create a profile (URL + API token, optional TLS
   verification, optional VDOM)
2. **Inventory** — review, export, inspect details, clean up
3. **Bulk import**
   1. *File*: upload Excel/CSV or generate a template
   2. *Mapping*: secret type → template, target folder, fields, options
      (auto-prefilled; savable as a profile)
   3. *Preview*: review the plan — nothing is written without this step
   4. *Execution*: folders → targets → secrets with a live log

### Example file

| Name | Address | Secret type | Username | Password | Domain | Folder |
|------|---------|-------------|----------|----------|--------|--------|
| srv-linux-01 | 10.10.1.21 | linux | root | … | | Linux/Production |
| srv-win-01 | 10.10.2.15 | windows | Administrator | … | corp.example.com | Windows/Production |

Column names are free-form — the assignment happens in the mapping step.
A sample file and the device-specific template generator are available in
the app. Maximum 5000 rows per file.

## FortiPAM API quirks

Deviations from the CMDB schema verified against a real appliance
(v1.9.0/1.9.1) — all handled by the toolkit:

<details>
<summary><b>Listing targets/templates is special</b> (expand)</summary>

- A regular collection GET on `secret/target` and `secret/template` returns
  "Unable to get mkey from uri" for **every** auth method (including GUI
  sessions).
- The GUI — and this toolkit — lists these tables via **`POST` with the
  `X-HTTP-Method-Override: GET` header** and body `{"json_filter": []}`.
  This returns the full list, for templates even including those without
  "create secret" permission. The body also supports server-side filters:
  `{"json_filter": [{"logic": "and", "filters": [{"key": "…",
  "type": "string", "operator": "exact", "pattern": "…"}]}]}`.
- This mechanism is **undocumented** (absent from the official FPAM SDK) and
  was discovered by capturing GUI requests — hence the toolkit's fallback
  chain: regular GET → override POST → per-name candidate lookups.
- `secret/database`, `secret/folder`, and `secret/classification-tag` support
  the regular collection GET (including `start`/`count` pagination).

</details>

<details>
<summary><b>Consistency window, mandatory fields, root rules</b> (expand)</summary>

- **Consistency window:** the target listing lags several seconds behind
  after bulk creation. The toolkit's duplicate check therefore never relies
  on the listing alone but additionally verifies unknown names individually
  (single lookups are immediately consistent).
- **POST applies no defaults:** `secret/folder` and `secret/database` require
  `inherit-permission` (among others) explicitly in the payload.
- **Folders directly under root:** `inherit-permission` must be `disable`
  and a `user-permission` with `folder-permission: owner` is mandatory.
- **Secrets cannot live in root** (`folder_id can't be 0`) — a subfolder is
  always required.
- **Templates with a mandatory `target-address` field** (e.g. "Host") need a
  target reference, otherwise the device rejects with "Mandatory field
  missing" — the toolkit warns in the preview.
- Per-name template lookups return **403 even for non-existent names** when
  the "create secret" permission is missing — only 200 is reliable.
- The envelope fields `size` (total) and `matched_count` (visible) make
  permission gaps measurable.
- Useful extra APIs using the same bearer auth:
  `POST /api/v2/internal/secret-dup-check` (409 = duplicate for
  username + target address), `secret-checkout`/`secret-checkin`/
  `secret-clear-text`, and `GET /api/v2/utility/id/{path}?type=secret|folder`.

</details>

## Development & tests

`dev\mock_fortipam.py` simulates the FortiPAM API on `http://127.0.0.1:9443`
including all quirks described above (blocked listing, override route, root
rules, rate limits, duplicate check). `dev\e2e_test.py` runs the complete
flow with **70 checks**, `dev\test_planner.py` holds unit tests for the
planning logic:

```
.venv\Scripts\python.exe -m pytest dev\test_planner.py    (unit tests)
.venv\Scripts\python.exe dev\mock_fortipam.py             (terminal 1)
start.bat                                                  (terminal 2)
.venv\Scripts\python.exe dev\e2e_test.py                  (terminal 3)
```

Both suites run via **GitHub Actions** on every push (Windows runner, see CI
badge). A git tag `v*` automatically builds the EXE, smoke-tests it, and
publishes it as a GitHub release.

**Tech:** FastAPI + httpx (backend), vanilla JS without a build step
(frontend), openpyxl (Excel). The CMDB schema reference is not part of the
repo (device-specific dump) — fetch it from your own appliance if needed:
`GET /api/v2/cmdb?action=schema`.

### Project layout

```
app/
  main.py        FastAPI endpoints, connection manager, inventory, jobs
  fortipam.py    REST client (pagination, override fallback, retry)
  planner.py     plan building, validation, parallel execution
  excel_io.py    Excel/CSV parser, templates, export
  winsec.py      DPAPI encryption (per-profile token storage)
  static/        UI (index.html, app.js, style.css)
dev/             mock FortiPAM + e2e suite + unit tests
start.bat        start incl. virtual-environment setup
build_exe.bat    portable EXE via PyInstaller
```

## License

[MIT](LICENSE) © 2026 Dennis Kobiolka — contributions and issues welcome.
