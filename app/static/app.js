/* FortiPAM Toolkit — Frontend-Logik */
"use strict";

const S = {
  connected: false,
  inventory: null,
  upload: null,        // Antwort von /api/excel/upload
  plan: null,          // maskierter Plan
  invTab: "targets",
  pollTimer: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ==== Protokoll & Toasts ============================================ */

const LOG = [];
function addLog(level, msg) {
  const ts = new Date().toLocaleTimeString("de-DE");
  LOG.push({ ts, level, msg });
  const box = $("sessionLog");
  const line = document.createElement("div");
  line.className = "cl-" + level;
  line.textContent = `[${ts}] ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function toast(msg, kind = "info") {
  const t = document.createElement("div");
  t.className = "toast " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "");
  t.textContent = msg;
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), kind === "err" ? 7000 : 3500);
}

/* ==== API-Wrapper ==================================================== */

async function api(path, opts = {}) {
  const init = { method: opts.method || "GET", headers: {} };
  if (opts.body instanceof FormData) {
    init.body = opts.body;
  } else if (opts.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  let resp;
  try {
    resp = await fetch(path, init);
  } catch (e) {
    throw new Error("Lokaler Server nicht erreichbar – läuft start.bat noch?");
  }
  let data = null;
  try { data = await resp.json(); } catch (e) { /* leer */ }
  if (!resp.ok) {
    const detail = data && data.detail ? data.detail : `HTTP ${resp.status}`;
    throw new Error(detail);
  }
  return data;
}

/* ==== Navigation ===================================================== */

function showView(name) {
  document.querySelectorAll(".rail-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("active", v.id === "view-" + name));
}
document.querySelectorAll(".rail-item").forEach((b) =>
  b.addEventListener("click", () => !b.disabled && showView(b.dataset.view)));

function setConnected(on, info) {
  S.connected = on;
  $("connLed").classList.toggle("on", on);
  $("connText").textContent = on
    ? `${info.base_url.replace(/^https?:\/\//, "")} · ${info.version}`
    : "Nicht verbunden";
  document.querySelectorAll('.rail-item[data-view="inventar"], .rail-item[data-view="import"]')
    .forEach((b) => (b.disabled = !on));
  $("btnDisconnect").disabled = !on;
}

/* ==== Schritt-Steuerung Import ====================================== */

function gotoStep(n) {
  document.querySelectorAll(".step").forEach((s) =>
    s.classList.toggle("active", +s.dataset.step === n));
  document.querySelectorAll(".istep").forEach((s) =>
    s.classList.toggle("active", s.id === "istep-" + n));
}
function enableStep(n, on = true) {
  const b = document.querySelector(`.step[data-step="${n}"]`);
  if (b) b.disabled = !on;
}
document.querySelectorAll(".step").forEach((s) =>
  s.addEventListener("click", () => !s.disabled && gotoStep(+s.dataset.step)));

/* ==== Verbindung ===================================================== */

function loadSavedConn() {
  try {
    const saved = JSON.parse(localStorage.getItem("fpt_conn") || "{}");
    if (saved.url) $("inUrl").value = saved.url;
    if (saved.vdom) $("inVdom").value = saved.vdom;
    $("inVerify").checked = !!saved.verify;
    if (saved.token) { $("inToken").value = saved.token; $("inRemember").checked = true; }
  } catch (e) { /* egal */ }
}
loadSavedConn();

$("btnConnect").addEventListener("click", async () => {
  const btn = $("btnConnect");
  btn.disabled = true; btn.textContent = "Verbinde …";
  try {
    const info = await api("/api/connect", {
      method: "POST",
      body: {
        base_url: $("inUrl").value.trim(),
        token: $("inToken").value.trim(),
        verify_ssl: $("inVerify").checked,
        vdom: $("inVdom").value.trim(),
      },
    });
    const save = { url: $("inUrl").value.trim(), vdom: $("inVdom").value.trim(),
                   verify: $("inVerify").checked };
    if ($("inRemember").checked) save.token = $("inToken").value.trim();
    localStorage.setItem("fpt_conn", JSON.stringify(save));

    setConnected(true, info);
    $("connResult").innerHTML = `
      <div class="conn-card">
        <span class="k">Gerät</span><span class="v">${esc(info.base_url)}</span>
        <span class="k">Version</span><span class="v">${esc(info.version)} (Build ${esc(info.build)})</span>
        <span class="k">Seriennummer</span><span class="v">${esc(info.serial || "—")}</span>
        ${info.vdom ? `<span class="k">VDOM</span><span class="v">${esc(info.vdom)}</span>` : ""}
      </div>`;
    addLog("ok", `Verbunden mit ${info.base_url} (${info.version})`);
    toast("Verbindung hergestellt.", "ok");
    await loadInventory(true);
    showView("inventar");
  } catch (e) {
    $("connResult").innerHTML = `<div class="notice error">${esc(e.message)}</div>`;
    addLog("err", "Verbindung fehlgeschlagen: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Verbinden";
  }
});

$("btnDisconnect").addEventListener("click", async () => {
  await api("/api/disconnect", { method: "POST" });
  setConnected(false);
  S.inventory = null;
  $("connResult").innerHTML = "";
  addLog("info", "Verbindung getrennt.");
  showView("verbindung");
});

/* ==== Inventar ======================================================= */

const INV_COLS = {
  targets: [
    { k: "name", l: "Name" }, { k: "address", l: "Adresse" },
    { k: "template", l: "Template" }, { k: "class", l: "Klassifizierung" },
    { k: "domain", l: "Domäne" }, { k: "description", l: "Beschreibung" },
  ],
  secrets: [
    { k: "id", l: "ID" }, { k: "name", l: "Name" },
    { k: "folder_path", l: "Ordner" }, { k: "template", l: "Template" },
    { k: "target", l: "Target" }, { k: "description", l: "Beschreibung" },
  ],
  folders: [
    { k: "id", l: "ID" }, { k: "path", l: "Pfad" },
    { k: "parent-folder", l: "Übergeordnet (ID)" },
  ],
  templates: [
    { k: "name", l: "Name" },
    { k: "_fields", l: "Felder" },
    { k: "server-info", l: "Server-Info" },
  ],
  class_tags: [
    { k: "name", l: "Name" }, { k: "description", l: "Beschreibung" },
  ],
};

async function loadInventory(refresh = false) {
  try {
    const inv = await api("/api/inventory" + (refresh ? "?refresh=1" : ""));
    S.inventory = inv;
    for (const t of inv.templates) {
      t._fields = (t.field || []).map((f) => f.name).join(", ");
    }
    renderInvTiles();
    renderInvTable();
    addLog("info", `Inventar geladen: ${inv.targets.length} Targets, ${inv.secrets.length} Secrets, ` +
      `${inv.folders.length} Ordner, ${inv.templates.length} Templates`);
    if (S.upload) buildMappingUI();
  } catch (e) {
    toast(e.message, "err");
    addLog("err", "Inventar: " + e.message);
  }
}

function renderInvTiles() {
  const inv = S.inventory;
  $("invTiles").innerHTML = `
    <div class="tile"><div class="num">${inv.targets.length}</div><div class="cap">Targets</div></div>
    <div class="tile"><div class="num">${inv.secrets.length}</div><div class="cap">Secrets</div></div>
    <div class="tile dim"><div class="num">${inv.folders.length}</div><div class="cap">Ordner</div></div>
    <div class="tile dim"><div class="num">${inv.templates.length}</div><div class="cap">Templates</div></div>
    <div class="tile dim"><div class="num">${inv.class_tags.length}</div><div class="cap">Klassifizierungen</div></div>`;
}

function renderInvTable() {
  const cols = INV_COLS[S.invTab];
  const data = S.inventory[S.invTab] || [];
  const q = $("invSearch").value.trim().toLowerCase();
  const rows = q
    ? data.filter((r) => cols.some((c) => String(r[c.k] ?? "").toLowerCase().includes(q)))
    : data;
  let note = "";
  if (S.invTab === "targets" && S.inventory.target_listing === false) {
    note = `<div class="notice">Dieses FortiPAM erlaubt kein Auflisten von Targets über die
      REST-API. Angezeigt werden Targets, die über Secrets referenziert oder in dieser
      Sitzung angelegt wurden – der Bestand kann größer sein. Die Duplikat-Prüfung beim
      Import fragt jedes Target einzeln ab und ist davon nicht betroffen.</div>`;
  }
  if (S.invTab === "templates" && S.inventory.template_listing === false) {
    note = `<div class="notice">Dieses FortiPAM erlaubt kein Auflisten von Templates über die
      REST-API. Angezeigt werden per Einzelabfrage gefundene Templates, für die der API-User
      Berechtigung hat. Weitere Templates können im Import-Mapping per Name geladen werden.</div>`;
  }
  $("invTable").innerHTML = note + tableHTML(cols, rows);
}

function tableHTML(cols, rows) {
  if (!rows.length) return `<p class="empty-note">Keine Einträge.</p>`;
  const head = cols.map((c) => `<th>${esc(c.l)}</th>`).join("");
  const body = rows.map((r) =>
    "<tr>" + cols.map((c) => `<td>${c.r ? c.r(r) : esc(r[c.k] ?? "")}</td>`).join("") + "</tr>"
  ).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

$("invTabs").querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => {
    $("invTabs").querySelectorAll("button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    S.invTab = b.dataset.tab;
    renderInvTable();
  }));
$("invSearch").addEventListener("input", renderInvTable);
$("btnInvRefresh").addEventListener("click", () => loadInventory(true));

/* ==== Excel-Upload =================================================== */

const drop = $("dropZone");
drop.addEventListener("click", () => $("fileInput").click());
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault(); drop.classList.remove("over");
  if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
});
$("fileInput").addEventListener("change", (e) => {
  if (e.target.files.length) uploadFile(e.target.files[0]);
});

async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const up = await api("/api/excel/upload", { method: "POST", body: fd });
    S.upload = up;
    S.plan = null;
    addLog("ok", `Excel geladen: ${up.filename} · Blatt '${up.sheet}' · ${up.row_count} Zeilen`);
    renderUploadInfo();
    buildMappingUI();
    enableStep(2); enableStep(3, false); enableStep(4, false);
  } catch (e) {
    toast(e.message, "err");
    addLog("err", "Excel: " + e.message);
  }
}

function renderUploadInfo() {
  const up = S.upload;
  const sheetSel = up.sheets.length > 1
    ? `<label class="inline"><span class="lbl-inline">Blatt</span>
        <select id="sheetSel">${up.sheets.map((s) =>
          `<option ${s === up.sheet ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>`
    : `<span><span class="k">Blatt:</span> ${esc(up.sheet)}</span>`;
  $("uploadInfo").innerHTML = `
    <div class="upload-meta">
      <span><span class="k">Datei:</span> ${esc(up.filename)}</span>
      ${sheetSel}
      <span><span class="k">Zeilen:</span> ${up.row_count}</span>
      <span><span class="k">Spalten:</span> ${up.headers.length}</span>
      <button class="btn primary" id="btnToMapping">Weiter zum Mapping →</button>
    </div>
    ${up.truncated ? '<div class="notice">Datei wurde auf 5000 Zeilen begrenzt.</div>' : ""}`;
  const cols = up.headers.map((h) => ({ k: h, l: h }));
  $("previewTable").innerHTML = tableHTML(cols, up.preview);
  const sel = $("sheetSel");
  if (sel) sel.addEventListener("change", async () => {
    try {
      S.upload = await api("/api/excel/sheet", { method: "POST", body: { sheet: sel.value } });
      renderUploadInfo(); buildMappingUI();
    } catch (e) { toast(e.message, "err"); }
  });
  $("btnToMapping").addEventListener("click", () => { gotoStep(2); });
}

/* ==== Mapping-UI ===================================================== */

const normStr = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9äöüß]/g, "");

const TYPE_SYNONYMS = {
  username: ["benutzername", "benutzer", "username", "user", "login", "account", "anmeldename", "konto"],
  password: ["passwort", "password", "kennwort", "pass", "pwd"],
  domain: ["domäne", "domaene", "domain"],
  url: ["url", "link", "webadresse"],
  "private-key": ["privatekey", "sshkey", "privaterschlüssel"],
  passphrase: ["passphrase"],
  "target-address": ["adresse", "address", "ip", "ipadresse", "host", "hostname", "fqdn"],
};

function guessColumn(candidates) {
  const headers = S.upload.headers;
  for (const cand of candidates) {
    const n = normStr(cand);
    const hit = headers.find((h) => normStr(h) === n);
    if (hit) return hit;
  }
  for (const cand of candidates) {
    const n = normStr(cand);
    if (!n) continue;
    const hit = headers.find((h) => normStr(h).includes(n));
    if (hit) return hit;
  }
  return null;
}

/* Quelle-Auswahl: Optionen "", fixed, xfix:<wert>, col:<spalte> */
function srcSelectHTML(id, { fixedOptions = [], preset = null } = {}) {
  const cols = S.upload ? S.upload.headers : [];
  let opts = `<option value="">— nicht setzen —</option>`;
  if (fixedOptions.length) {
    opts += `<optgroup label="FortiPAM-Werte">` + fixedOptions.map((o) =>
      `<option value="xfix:${esc(o)}">${esc(o)}</option>`).join("") + `</optgroup>`;
  }
  opts += `<option value="fixed">Fester Wert …</option>`;
  opts += `<optgroup label="Excel-Spalten">` + cols.map((c) =>
    `<option value="col:${esc(c)}">Spalte: ${esc(c)}</option>`).join("") + `</optgroup>`;
  return `<span class="src-pair">
    <select id="${id}" data-preset="${esc(preset || "")}">${opts}</select>
    <input type="text" id="${id}_fx" placeholder="fester Wert" hidden>
  </span>`;
}

function wireSrcSelect(id) {
  const sel = $(id);
  if (!sel) return;
  const fx = $(id + "_fx");
  const preset = sel.dataset.preset;
  if (preset) sel.value = preset;
  sel.addEventListener("change", () => { fx.hidden = sel.value !== "fixed"; });
  fx.hidden = sel.value !== "fixed";
}

function getSrc(id) {
  const sel = $(id);
  if (!sel || !sel.value) return null;
  if (sel.value === "fixed") {
    const v = $(id + "_fx").value.trim();
    return v ? { type: "fixed", value: v } : null;
  }
  if (sel.value.startsWith("xfix:")) return { type: "fixed", value: sel.value.slice(5) };
  if (sel.value.startsWith("col:")) return { type: "column", value: sel.value.slice(4) };
  return null;
}

function buildMappingUI() {
  if (!S.upload || !S.inventory) return;
  const inv = S.inventory;
  const tplNames = inv.templates.map((t) => t.name);
  const tagNames = inv.class_tags.map((t) => t.name);
  const headers = S.upload.headers;

  /* --- Secret-Typ-Quelle --- */
  const typeColGuess = guessColumn(["secrettyp", "secret-typ", "typ", "type", "os", "betriebssystem", "template"]);
  $("tplSource").innerHTML =
    `<option value="fixed">Festes Template für alle Zeilen</option>` +
    headers.map((h) =>
      `<option value="col:${esc(h)}" ${h === typeColGuess ? "selected" : ""}>Spalte: ${esc(h)}</option>`).join("");
  $("tplFixed").innerHTML = tplNames.map((t) => `<option>${esc(t)}</option>`).join("");

  $("tplSource").onchange = () => { renderTplValueMap(); renderFieldMaps(); };
  $("tplFixed").onchange = () => renderFieldMaps();
  renderTplValueMap();

  $("tplListingNote").innerHTML = inv.template_listing === false
    ? `<div class="notice">Template-Auflistung ist auf diesem FortiPAM per REST gesperrt –
        angezeigt werden per Einzelabfrage gefundene Templates. Fehlt eines, unten per
        exaktem Namen nachladen.</div>`
    : "";
  $("btnTplAdd").onclick = async () => {
    const name = $("tplAddName").value.trim();
    if (!name) return;
    try {
      const tpl = await api("/api/templates/add", { method: "POST", body: { name } });
      if (!S.inventory.templates.some((t) => t.name === tpl.name)) {
        tpl._fields = (tpl.field || []).map((f) => f.name).join(", ");
        S.inventory.templates.push(tpl);
      }
      addTemplateOption(tpl.name);
      $("tplAddName").value = "";
      addLog("ok", `Template '${tpl.name}' geladen.`);
      toast(`Template '${tpl.name}' verfügbar.`, "ok");
    } catch (e) {
      toast(e.message, "err");
      addLog("err", "Template laden: " + e.message);
    }
  };

  /* --- Ordner --- */
  $("folderFixed").innerHTML = folderOptionsHTML(false)
    || `<option value="">— keine Ordner vorhanden —</option>`;
  $("folderBase").innerHTML = `<option value="0">Root</option>` + folderOptionsHTML(false);
  const folderColGuess = guessColumn(["ordner", "folder", "pfad", "gruppe"]);
  $("folderCol").innerHTML = headers.map((h) =>
    `<option ${h === folderColGuess ? "selected" : ""}>${esc(h)}</option>`).join("");
  const owners = inv.owners || [];
  $("folderOwner").innerHTML = owners.length
    ? owners.map((o, i) => `<option ${i === 0 ? "selected" : ""}>${esc(o)}</option>`).join("")
    : `<option value="">— unbekannt —</option>`;
  $("folderMode").onchange = () => {
    const m = $("folderMode").value;
    $("folderFixedWrap").hidden = m !== "fixed_id";
    $("folderPathWrap").hidden = m !== "fixed_path";
    $("folderColWrap").hidden = m !== "column_path";
    $("folderBaseWrap").hidden = m !== "column_path";
    $("folderOwnerWrap").hidden = m === "fixed_id";
  };
  // ohne vorhandene Ordner ist "Fester Pfad" der sinnvolle Standard
  if (!inv.folders.length) $("folderMode").value = "fixed_path";
  $("folderMode").onchange();

  /* --- Target-Felder --- */
  const nameGuess = guessColumn(["name", "hostname", "host", "servername", "gerät", "device"]);
  const addrGuess = guessColumn(["adresse", "address", "ip", "ipadresse", "fqdn", "host"]);
  const domGuess = guessColumn(["domäne", "domaene", "domain"]);
  const descGuess = guessColumn(["beschreibung", "description", "kommentar", "notiz"]);

  $("mapTarget").innerHTML = [
    ["Name *", srcSelectHTML("tName", { preset: nameGuess ? "col:" + nameGuess : null })],
    ["Adresse (IP/FQDN)", srcSelectHTML("tAddr", { preset: addrGuess ? "col:" + addrGuess : null })],
    ["Klassifizierung *", srcSelectHTML("tClass", {
      fixedOptions: tagNames, preset: tagNames.length ? "xfix:" + tagNames[0] : null })],
    ["Domäne", srcSelectHTML("tDomain", { preset: domGuess ? "col:" + domGuess : null })],
    ["URL", srcSelectHTML("tUrl", {})],
    ["Beschreibung", srcSelectHTML("tDesc", { preset: descGuess ? "col:" + descGuess : null })],
  ].map(([l, s]) => `<div class="fname">${l}</div>${s}`).join("");
  ["tName", "tAddr", "tClass", "tDomain", "tUrl", "tDesc"].forEach(wireSrcSelect);

  /* --- Secret-Basisfelder --- */
  $("mapSecretBase").innerHTML = [
    ["Name *", srcSelectHTML("sName", { preset: nameGuess ? "col:" + nameGuess : null })],
    ["Beschreibung", srcSelectHTML("sDesc", { preset: descGuess ? "col:" + descGuess : null })],
  ].map(([l, s]) => `<div class="fname">${l}</div>${s}`).join("");
  ["sName", "sDesc"].forEach(wireSrcSelect);

  renderFieldMaps();

  $("optTargets").onchange = () => { $("panelTarget").style.opacity = $("optTargets").checked ? 1 : .35; };
  $("optSecrets").onchange = () => { $("panelSecret").style.opacity = $("optSecrets").checked ? 1 : .35; };
}

function folderOptionsHTML(includeRoot = true) {
  const folders = [...S.inventory.folders].sort((a, b) =>
    String(a.path).localeCompare(String(b.path), "de"));
  return (includeRoot ? `<option value="0">Root</option>` : "") + folders.map((f) =>
    `<option value="${f.id}">${esc(f.path)}</option>`).join("");
}

/* Wertzuordnung Secret-Typ (Spaltenwerte → Templates) */
function renderTplValueMap() {
  const src = $("tplSource").value;
  const isFixed = src === "fixed";
  $("tplFixedWrap").hidden = !isFixed;
  const box = $("tplValueMap");
  if (isFixed) { box.innerHTML = ""; return; }

  const col = src.slice(4);
  const distinct = (S.upload.distinct || {})[col];
  if (!distinct) {
    box.innerHTML = `<div class="notice">Spalte '${esc(col)}' hat zu viele oder keine unterschiedlichen Werte
      – bitte andere Spalte oder festes Template wählen.</div>`;
    return;
  }
  const tplNames = S.inventory.templates.map((t) => t.name);
  const guess = (val) => {
    const n = normStr(val);
    const pairs = [["win", "windows"], ["linux", "unix"], ["unix", "unix"], ["esx", "esxi"],
                   ["cisco", "cisco"], ["forti", "fortios"], ["web", "web"], ["netz", "cisco"],
                   ["network", "cisco"], ["db", "sql"], ["sql", "sql"]];
    for (const [key, tplPart] of pairs) {
      if (n.includes(key)) {
        const hit = tplNames.find((t) => normStr(t).includes(tplPart));
        if (hit) return hit;
      }
    }
    return tplNames.find((t) => normStr(t).includes(n)) || "";
  };
  box.innerHTML = `<div class="vmap-table"><table><thead>
      <tr><th>Wert in Spalte '${esc(col)}'</th><th>FortiPAM-Template</th></tr></thead><tbody>` +
    distinct.map((v, i) => `<tr><td class="mono">${esc(v)}</td><td>
      <select class="vmap-sel" data-raw="${esc(v)}" id="vmap_${i}">
        <option value="">— nicht zugeordnet —</option>
        ${tplNames.map((t) => `<option ${t === guess(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}
      </select></td></tr>`).join("") +
    `</tbody></table></div>`;
  box.querySelectorAll(".vmap-sel").forEach((sel) =>
    sel.addEventListener("change", renderFieldMaps));
}

/* Nachgeladenes Template in alle Template-Auswahlfelder aufnehmen */
function addTemplateOption(name) {
  const sels = [$("tplFixed"), ...document.querySelectorAll(".vmap-sel")];
  for (const sel of sels) {
    if (sel && ![...sel.options].some((o) => o.value === name || o.text === name)) {
      const opt = document.createElement("option");
      opt.textContent = name;
      sel.appendChild(opt);
    }
  }
}

/* Verwendete Templates ermitteln */
function usedTemplates() {
  if ($("tplSource").value === "fixed") {
    return $("tplFixed").value ? [$("tplFixed").value] : [];
  }
  const set = new Set();
  document.querySelectorAll(".vmap-sel").forEach((sel) => sel.value && set.add(sel.value));
  return [...set];
}

/* Feld-Zuordnungen je Template */
function renderFieldMaps() {
  const box = $("mapSecretFields");
  const used = usedTemplates();
  const inv = S.inventory;
  box.innerHTML = "";
  used.forEach((tplName, ti) => {
    const tpl = inv.templates.find((t) => t.name === tplName);
    if (!tpl) return;
    const rows = (tpl.field || []).map((f, fi) => {
      const id = `fmap_${ti}_${fi}`;
      const syn = [f.name, ...(TYPE_SYNONYMS[f.type] || [])];
      const g = guessColumn(syn);
      const label = `${esc(f.name)} ${f.mandatory === "enable" ? '<span class="req">*</span>' : ""}
        <em>(${esc(f.type)})</em>`;
      return `<div class="fname">${label}</div>` +
        srcSelectHTML(id, { preset: g ? "col:" + g : null });
    }).join("");
    box.insertAdjacentHTML("beforeend",
      `<div class="tpl-card" data-tpl="${esc(tplName)}"><h3>${esc(tplName)}</h3>
        <div class="map-grid">${rows}</div></div>`);
    (tpl.field || []).forEach((f, fi) => wireSrcSelect(`fmap_${ti}_${fi}`));
  });
  if (!used.length) {
    box.innerHTML = `<div class="notice">Noch kein Template gewählt bzw. zugeordnet –
      oben die Secret-Typ-Zuordnung vervollständigen.</div>`;
  }
}

/* ==== Mapping einsammeln & Plan ====================================== */

function collectMapping() {
  const tplSrcVal = $("tplSource").value;
  let template;
  if (tplSrcVal === "fixed") {
    template = { type: "fixed", value: $("tplFixed").value };
  } else {
    const value_map = {};
    document.querySelectorAll(".vmap-sel").forEach((sel) => {
      if (sel.value) value_map[sel.dataset.raw] = sel.value;
    });
    template = { type: "column", value: tplSrcVal.slice(4), value_map };
  }

  const mode = $("folderMode").value;
  let folder;
  if (mode === "fixed_id") {
    folder = { type: "fixed_id", value: +$("folderFixed").value };
  } else if (mode === "fixed_path") {
    folder = { type: "fixed_path", value: $("folderPath").value.trim(), base: 0 };
  } else {
    folder = { type: "column_path", value: $("folderCol").value, base: +$("folderBase").value };
  }

  const fields = {};
  document.querySelectorAll(".tpl-card").forEach((card) => {
    const tplName = card.dataset.tpl;
    const tpl = S.inventory.templates.find((t) => t.name === tplName);
    if (!tpl) return;
    const fmap = {};
    card.querySelectorAll("select[id^=fmap_]").forEach((sel, i) => {
      const f = (tpl.field || [])[i];
      const src = getSrc(sel.id);
      if (f && src) fmap[f.name] = src;
    });
    fields[tplName] = fmap;
  });

  return {
    options: {
      create_targets: $("optTargets").checked,
      create_secrets: $("optSecrets").checked,
      // "Fester Pfad" impliziert das Anlegen fehlender Ordner
      auto_create_folders: $("optAutoFolders").checked || mode === "fixed_path",
      root_folder_owner: $("folderOwner").value || "",
    },
    target: {
      name: getSrc("tName"), address: getSrc("tAddr"), class: getSrc("tClass"),
      template: { type: "secret_template" },
      domain: getSrc("tDomain"), url: getSrc("tUrl"), description: getSrc("tDesc"),
    },
    secret: {
      name: getSrc("sName"), description: getSrc("sDesc"),
      target: { type: "row_target" },
      folder, template, fields,
    },
  };
}

$("btnPlan").addEventListener("click", async () => {
  const btn = $("btnPlan");
  btn.disabled = true; btn.textContent = "Berechne …";
  try {
    const plan = await api("/api/plan", { method: "POST", body: collectMapping() });
    S.plan = plan;
    renderPlan();
    enableStep(3); gotoStep(3);
    addLog("info", `Plan berechnet: ${plan.summary.targets_create} Targets, ` +
      `${plan.summary.secrets_create} Secrets, ${plan.summary.folders_create} Ordner neu`);
  } catch (e) {
    toast(e.message, "err");
    addLog("err", "Plan: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Vorschau berechnen →";
  }
});

const BADGE = {
  create: '<span class="badge create">erstellen</span>',
  exists: '<span class="badge exists">existiert</span>',
  error: '<span class="badge error">fehler</span>',
  duplicate: '<span class="badge duplicate">doppelt</span>',
  none: '<span class="badge none">—</span>',
};

function renderPlan() {
  const p = S.plan, s = p.summary;
  $("planTiles").innerHTML = `
    <div class="tile ok"><div class="num">${s.targets_create}</div><div class="cap">Targets neu</div></div>
    <div class="tile ok"><div class="num">${s.secrets_create}</div><div class="cap">Secrets neu</div></div>
    <div class="tile dim"><div class="num">${s.folders_create}</div><div class="cap">Ordner neu</div></div>
    <div class="tile dim"><div class="num">${s.targets_exist + s.secrets_exist}</div><div class="cap">Übersprungen</div></div>
    <div class="tile ${s.secrets_error + s.row_errors ? "err" : "dim"}">
      <div class="num">${s.secrets_error + s.row_errors}</div><div class="cap">Fehler</div></div>`;

  let warn = "";
  for (const n of p.notices || []) {
    warn += `<div class="notice error">${esc(n)}</div>`;
  }
  if (s.secrets_error + s.row_errors > 0) {
    warn += `<div class="notice error">Zeilen mit Fehlern werden bei der Ausführung übersprungen.</div>`;
  }
  if (p.folders.length) {
    warn += `<div class="notice">Neue Ordner: ${p.folders.map((f) => esc(f.path)).join(" · ")}</div>`;
  }
  $("planWarnings").innerHTML = warn;

  let html = "";
  if (p.targets.length) {
    html += `<h2>Targets</h2>` + tableHTML(
      [{ k: "name", l: "Name" },
       { k: "action", l: "Aktion", r: (r) => BADGE[r.action] || esc(r.action) },
       { k: "_addr", l: "Adresse", r: (r) => esc(r.body?.address || "") },
       { k: "_tpl", l: "Template", r: (r) => esc(r.body?.template || "") },
       { k: "rows", l: "Zeilen", r: (r) => esc(r.rows.join(", ")) }],
      p.targets);
  }
  if (p.secrets.length) {
    html += `<h2 style="margin-top:22px">Secrets</h2>` + tableHTML(
      [{ k: "row", l: "Zeile" },
       { k: "name", l: "Name" },
       { k: "action", l: "Aktion", r: (r) => BADGE[r.action] || esc(r.action) },
       { k: "folder_path", l: "Ordner" },
       { k: "template", l: "Template" },
       { k: "target", l: "Target" },
       { k: "_msg", l: "Hinweise", r: (r) =>
          `<span class="cl-err">${esc(r.error || "")}</span>` +
          (r.warnings?.length ? ` <span class="cl-warn">${esc(r.warnings.join("; "))}</span>` : "") }],
      p.secrets);
  }
  if (p.row_errors.length) {
    html += `<h2 style="margin-top:22px">Zeilenfehler</h2>` + tableHTML(
      [{ k: "row", l: "Zeile" }, { k: "error", l: "Fehler" }], p.row_errors);
  }
  $("planTable").innerHTML = html || `<p class="empty-note">Nichts zu tun.</p>`;

  $("btnExecute").disabled =
    s.targets_create + s.secrets_create + s.folders_create === 0;
}

$("btnBackMapping").addEventListener("click", () => gotoStep(2));

/* ==== Ausführung ===================================================== */

$("btnExecute").addEventListener("click", async () => {
  const s = S.plan.summary;
  const msg = `Jetzt erstellen?\n\n` +
    `· ${s.folders_create} Ordner\n· ${s.targets_create} Targets\n· ${s.secrets_create} Secrets\n\n` +
    `Ziel: ${$("connText").textContent}`;
  if (!confirm(msg)) return;
  try {
    await api("/api/execute", { method: "POST" });
    enableStep(4); gotoStep(4);
    $("execLog").innerHTML = "";
    $("btnExecDone").hidden = true;
    $("btnCancel").hidden = false;
    $("execTitle").textContent = "Ausführung läuft …";
    addLog("info", "Bulk-Erstellung gestartet.");
    pollExecution();
  } catch (e) {
    toast(e.message, "err");
  }
});

$("btnCancel").addEventListener("click", async () => {
  await api("/api/execute/cancel", { method: "POST" });
  addLog("warn", "Abbruch angefordert.");
});

let renderedItems = 0;
function pollExecution() {
  clearTimeout(S.pollTimer);
  renderedItems = 0;
  const tick = async () => {
    try {
      const j = await api("/api/execute/status");
      const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
      $("execBar").style.width = pct + "%";
      $("execCount").textContent = `${j.done} / ${j.total}`;
      const box = $("execLog");
      const KIND = { folder: "Ordner", target: "Target", secret: "Secret", system: "System" };
      for (; renderedItems < j.items.length; renderedItems++) {
        const it = j.items[renderedItems];
        const line = document.createElement("div");
        const sym = it.status === "ok" ? "✔" : it.status === "error" ? "✘" : "·";
        line.className = it.status === "ok" ? "cl-ok" : it.status === "error" ? "cl-err" : "cl-dim";
        line.textContent = `${sym} ${KIND[it.kind] || it.kind} ${it.name}` +
          (it.row ? ` (Zeile ${it.row})` : "") + (it.message ? ` — ${it.message}` : "");
        box.appendChild(line);
        addLog(it.status === "error" ? "err" : "ok",
          `${KIND[it.kind] || it.kind} ${it.name}: ${it.message || it.status}`);
      }
      box.scrollTop = box.scrollHeight;
      if (j.finished) {
        const errors = j.items.filter((i) => i.status === "error").length;
        $("execTitle").textContent = errors
          ? `Abgeschlossen – ${errors} Fehler`
          : "Abgeschlossen – alles erstellt";
        $("execBar").style.width = "100%";
        $("btnCancel").hidden = true;
        $("btnExecDone").hidden = false;
        addLog(errors ? "warn" : "ok",
          `Bulk-Erstellung beendet: ${j.done} Aktionen, ${errors} Fehler.`);
        toast(errors ? `Fertig mit ${errors} Fehlern.` : "Alle Objekte erstellt.", errors ? "err" : "ok");
        return;
      }
      S.pollTimer = setTimeout(tick, 700);
    } catch (e) {
      toast(e.message, "err");
    }
  };
  tick();
}

$("btnExecDone").addEventListener("click", async () => {
  await loadInventory(true);
  showView("inventar");
  gotoStep(1);
  enableStep(3, false); enableStep(4, false);
});

/* ==== Protokoll speichern =========================================== */

$("btnLogSave").addEventListener("click", () => {
  const text = LOG.map((l) => `[${l.ts}] [${l.level.toUpperCase()}] ${l.msg}`).join("\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fortipam-toolkit-protokoll-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ==== Start ========================================================== */

addLog("info", "FortiPAM Toolkit gestartet.");
(async () => {
  try {
    const st = await api("/api/status");
    if (st.connected && st.conn_info) {
      setConnected(true, st.conn_info);
      await loadInventory();
    }
  } catch (e) { /* Server frisch gestartet */ }
})();
