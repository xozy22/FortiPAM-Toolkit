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

/* Nach dynamischem Rendern statische Treffer nachübersetzen (nur bei EN). */
function retranslate() {
  if (I18N.lang === "en") translateDom(document.body);
}

async function applyLang(lang) {
  I18N.lang = (lang === "en") ? "en" : "de";
  try { localStorage.setItem("fpt_lang", I18N.lang); } catch (e) { /* egal */ }
  document.documentElement.lang = I18N.lang;
  document.querySelectorAll("#langSwitch button").forEach((b) =>
    b.classList.toggle("active", b.dataset.lang === I18N.lang));
  try { await api("/api/lang", { method: "POST", body: { lang: I18N.lang } }); }
  catch (e) { /* Server evtl. noch nicht bereit */ }
  // dynamische Ansichten neu aufbauen, damit deren Texte durch t()/Sweep laufen
  if (typeof buildSoSelects === "function") buildSoSelects();
  if (S.inventory) { renderInvTiles(); renderInvFilters(); renderChips(); renderInvTable(); }
  if (S.plan) renderPlan();
  if (S.upload) { renderUploadInfo(); if (S.inventory) buildMappingUI(); }
  if (S.connected && S.conn_info) setConnected(true, S.conn_info);
  translateDom(document.body);
}

document.querySelectorAll("#langSwitch button").forEach((b) =>
  b.addEventListener("click", () => applyLang(b.dataset.lang)));

/* ==== Protokoll & Toasts ============================================ */

const LOG = [];
function addLog(level, msg) {
  const ts = new Date().toLocaleTimeString("en-GB");
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
  S.conn_info = on ? info : null;
  $("connLed").classList.toggle("on", on);
  $("connText").textContent = on
    ? `${info.base_url.replace(/^https?:\/\//, "")} · ${info.version}`
    : t("Nicht verbunden");
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

/* Verbindungsmanager: mehrere benannte Profile, Token DPAPI-verschlüsselt */
let connProfiles = [];

function selectedProfile() {
  const name = $("connProfiles").value;
  return connProfiles.find((p) => p.name === name) || null;
}

function fillConnForm(p) {
  $("inProfName").value = p ? p.name : "";
  $("inUrl").value = p ? p.base_url : "";
  $("inVdom").value = p ? p.vdom : "";
  $("inVerify").checked = p ? !!p.verify_ssl : false;
  $("inToken").value = "";
  $("inToken").placeholder = p && p.has_token
    ? "leer lassen = gespeicherten Token verwenden"
    : "API-Schlüssel des REST-API-Admins";
  $("btnProfDelete").hidden = !p;
}

async function loadConnections(preselect) {
  let data = {};
  try {
    data = await api("/api/connections") || {};
  } catch (e) { data = {}; }
  connProfiles = data.profiles || [];
  const want = preselect !== undefined ? preselect : (data.last_used || "");
  $("connProfiles").innerHTML = `<option value="">— Neue Verbindung —</option>` +
    connProfiles.map((p) =>
      `<option value="${esc(p.name)}"${p.name === want ? " selected" : ""}>` +
      `${esc(p.name)} (${esc(String(p.base_url).replace(/^https?:\/\//, ""))})</option>`).join("");
  fillConnForm(selectedProfile());
}

$("connProfiles").addEventListener("change", () => fillConnForm(selectedProfile()));

$("btnProfDelete").addEventListener("click", async () => {
  const p = selectedProfile();
  if (!p) return;
  if (!confirm(`Verbindung '${p.name}' löschen?\n\nDer gespeicherte Token wird dabei entfernt.`)) return;
  try {
    await api(`/api/connections/${encodeURIComponent(p.name)}`, { method: "DELETE" });
    addLog("info", `Connection '${p.name}' deleted.`);
    toast(`'${p.name}' gelöscht.`, "ok");
    await loadConnections("");
  } catch (e) {
    toast(e.message, "err");
  }
});

$("btnConnect").addEventListener("click", async () => {
  const btn = $("btnConnect");
  btn.disabled = true; btn.textContent = "Verbinde …";
  try {
    const token = $("inToken").value.trim();
    const profileName = $("inProfName").value.trim() || $("connProfiles").value || "";
    const remember = $("inRemember").checked;
    const info = await api("/api/connect", {
      method: "POST",
      body: {
        base_url: $("inUrl").value.trim(),
        token,
        verify_ssl: $("inVerify").checked,
        vdom: $("inVdom").value.trim(),
        remember,
        profile_name: profileName,
      },
    });
    if (remember && !profileName) {
      toast(t("Zum Speichern der Verbindung bitte einen Namen vergeben."), "err");
    }
    await loadConnections(profileName);
    setConnected(true, info);
    $("connResult").innerHTML = `
      <div class="conn-card">
        <span class="k">Gerät</span><span class="v">${esc(info.base_url)}</span>
        <span class="k">Version</span><span class="v">${esc(info.version)} (Build ${esc(info.build)})</span>
        <span class="k">Seriennummer</span><span class="v">${esc(info.serial || "—")}</span>
        ${info.vdom ? `<span class="k">VDOM</span><span class="v">${esc(info.vdom)}</span>` : ""}
      </div>`;
    addLog("ok", `Connected to ${info.base_url} (${info.version})`);
    toast(t("Verbindung hergestellt."), "ok");
    await loadInventory(true);
    showView("inventar");
  } catch (e) {
    $("connResult").innerHTML = `<div class="notice error">${esc(e.message)}</div>`;
    addLog("err", "Connection failed: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Verbinden";
  }
});

$("btnDisconnect").addEventListener("click", async () => {
  await api("/api/disconnect", { method: "POST" });
  setConnected(false);
  S.inventory = null;
  $("connResult").innerHTML = "";
  addLog("info", "Disconnected.");
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
    renderChips();
    renderInvFilters();
    renderInvTable();
    $("tplGenSel").innerHTML = inv.templates.map((t) =>
      `<option>${esc(t.name)}</option>`).join("");
    addLog("info", `Inventory loaded: ${inv.targets.length} targets, ${inv.secrets.length} secrets, ` +
      `${inv.folders.length} folders, ${inv.templates.length} templates`);
    if (S.upload) buildMappingUI();
  } catch (e) {
    toast(e.message, "err");
    addLog("err", "Inventory: " + e.message);
  }
}

function renderInvTiles() {
  const inv = S.inventory;
  const tot = inv.totals || {};
  const withTotal = (visible, total) =>
    (total != null && total > visible)
      ? `${visible}<span class="h-dim"> / ${total}</span>` : String(visible);
  const secHidden = tot.secrets != null && tot.secrets > inv.secrets.length;
  const folHidden = tot.folders != null && tot.folders > inv.folders.length;
  $("invTiles").innerHTML = `
    <div class="tile"><div class="num">${inv.targets.length}</div><div class="cap">Targets</div></div>
    <div class="tile ${secHidden ? "warn" : ""}"><div class="num">${withTotal(inv.secrets.length, tot.secrets)}</div><div class="cap">Secrets sichtbar</div></div>
    <div class="tile ${folHidden ? "warn" : "dim"}"><div class="num">${withTotal(inv.folders.length, tot.folders)}</div><div class="cap">Ordner sichtbar</div></div>
    <div class="tile dim"><div class="num">${inv.templates.length}</div><div class="cap">Templates</div></div>
    <div class="tile dim"><div class="num">${inv.class_tags.length}</div><div class="cap">Klassifizierungen</div></div>`;
  retranslate();
}

/* Auswahl-/Detail-Konfiguration je Inventar-Tab */
const SELECTABLE = {
  secrets: { kind: "secret", mkey: (r) => r.id, label: (r) => r.name || String(r.id) },
  targets: { kind: "target", mkey: (r) => r.name, label: (r) => r.name },
  folders: { kind: "folder", mkey: (r) => r.id, label: (r) => r.path || r.name },
};

/* Spalten, die als kombinierbare Dropdown-Filter angeboten werden */
const FILTER_COLS = {
  secrets: ["folder_path", "template", "target"],
  targets: ["template", "class"],
  templates: ["server-info"],
  folders: [],
  class_tags: [],
};
const MAX_FILTER_VALUES = 60;

/* Suchsyntax: Begriffe = UND · spalte:wert · -begriff (nicht) · a|b (oder) · "Phrase" */
function parseQuery(q) {
  const tokens = q.match(/"[^"]*"|\S+/g) || [];
  return tokens.map((tok) => {
    let neg = false;
    if (tok.startsWith("-") || tok.startsWith("!")) { neg = true; tok = tok.slice(1); }
    let col = null;
    const m = tok.match(/^([\wäöüß.\-()]+):(.+)$/i);
    if (m) { col = m[1].toLowerCase(); tok = m[2]; }
    const value = tok.replace(/^"|"$/g, "").toLowerCase();
    const alts = value.split("|").map((a) => a.trim()).filter(Boolean);
    return { neg, col, alts };
  }).filter((t) => t.alts.length);
}

function tokenColumns(token, cols) {
  if (!token.col) return cols;
  const want = token.col;
  const hit = cols.filter((c) =>
    c.k.toLowerCase() === want || c.l.toLowerCase() === want ||
    c.k.toLowerCase().startsWith(want) || c.l.toLowerCase().startsWith(want));
  return hit.length ? hit : cols;   // unbekannte Spalte -> normale Volltextsuche
}

function matchToken(row, token, cols) {
  const hit = tokenColumns(token, cols).some((c) => {
    const val = String(row[c.k] ?? "").toLowerCase();
    return token.alts.some((a) => val.includes(a));
  });
  return token.neg ? !hit : hit;
}

/* ---- Filter-Chips: sichtbare, einzeln entfernbare Filter ------------ */

function addChip(chip) {
  S.invChips = S.invChips || [];
  const dup = S.invChips.some((c) => c.type === chip.type && c.key === chip.key
    && c.value === chip.value && c.raw === chip.raw);
  if (dup) return;
  S.invChips.push(chip);
  renderChips();
  renderInvFilters();
  renderInvTable();
}

function removeChip(idx) {
  (S.invChips || []).splice(idx, 1);
  renderChips();
  renderInvFilters();
  renderInvTable();
}

function renderChips() {
  const box = $("invChips");
  box.innerHTML = (S.invChips || []).map((c, i) => {
    const label = c.type === "col"
      ? `<span class="chip-k">${esc(t(c.label))}:</span> ${esc(c.value)}`
      : `<span class="chip-k">${esc(t("Suche"))}:</span> ${esc(c.raw)}`;
    return `<span class="chip">${label}` +
      `<button class="chip-x" data-idx="${i}" title="${esc(t("Filter entfernen"))}">✕</button></span>`;
  }).join("");
  box.querySelectorAll(".chip-x").forEach((b) =>
    b.addEventListener("click", () => removeChip(+b.dataset.idx)));
}

function closeFilterMenu() {
  $("filterMenu").hidden = true;
  $("btnAddFilter").classList.remove("active");
}

function renderInvFilters() {
  const cols = INV_COLS[S.invTab];
  const data = S.inventory ? (S.inventory[S.invTab] || []) : [];
  const menu = $("filterMenu");
  const btn = $("btnAddFilter");
  let html = "";
  for (const key of FILTER_COLS[S.invTab] || []) {
    const col = cols.find((c) => c.k === key);
    if (!col) continue;
    const counts = new Map();
    for (const r of data) {
      const v = String(r[key] ?? "");
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
    if (counts.size < 2 || counts.size > MAX_FILTER_VALUES) continue;
    const chosen = new Set((S.invChips || [])
      .filter((c) => c.type === "col" && c.key === key).map((c) => c.value));
    const values = [...counts.keys()].sort((a, b) => a.localeCompare(b, "de"));
    html += `<div class="fmenu-group"><div class="fmenu-head">${esc(col.l)}</div>` +
      values.map((v) => {
        const on = chosen.has(v);
        return `<button class="fmenu-item${on ? " active" : ""}" data-key="${esc(key)}"` +
          ` data-val="${esc(v)}" title="${on ? "Filter entfernen" : "Filter hinzufügen"}">` +
          `<span class="fmenu-check">${on ? "✓" : ""}</span>${esc(v)}` +
          `<span class="fmenu-count">${counts.get(v)}</span></button>`;
      }).join("") + `</div>`;
  }
  btn.hidden = !html;
  menu.innerHTML = html;
  if (!html) closeFilterMenu();
  menu.querySelectorAll(".fmenu-item").forEach((b) =>
    b.addEventListener("click", (e) => {
      // Menü bleibt für Mehrfachauswahl offen; ohne stopPropagation würde der
      // document-Listener das (durch das Re-Rendering gelöste) Ziel nicht mehr
      // dem Menü zuordnen und es schließen
      e.stopPropagation();
      const key = b.dataset.key;
      const val = b.dataset.val;
      const idx = (S.invChips || []).findIndex((c) =>
        c.type === "col" && c.key === key && c.value === val);
      if (idx >= 0) {
        removeChip(idx);            // abwählen = Chip entfernen
      } else {
        const col = cols.find((c) => c.k === key);
        addChip({ type: "col", key, label: col ? col.l : key, value: val });
      }
    }));
}

/* Chips + Live-Sucheingabe auf die Daten anwenden */
function applyInvFilters(data, cols) {
  let rows = data;
  const groups = {};
  for (const c of S.invChips || []) {
    if (c.type === "col") (groups[c.key] = groups[c.key] || []).push(c.value);
  }
  for (const [key, vals] of Object.entries(groups)) {
    rows = rows.filter((r) => vals.includes(String(r[key] ?? "")));
  }
  for (const c of S.invChips || []) {
    if (c.type === "text") {
      rows = rows.filter((r) => c.tokens.every((t) => matchToken(r, t, cols)));
    }
  }
  const live = parseQuery($("invSearch").value.trim());
  if (live.length) {
    rows = rows.filter((r) => live.every((t) => matchToken(r, t, cols)));
  }
  return rows;
}

/* Ordner-Hierarchie als flache, eingerückte Liste (mit Auf-/Zuklappen) */
function buildFolderTree() {
  const folders = S.inventory.folders || [];
  const secrets = S.inventory.secrets || [];
  const direct = new Map();
  for (const s of secrets) {
    const fid = +s.folder || 0;
    direct.set(fid, (direct.get(fid) || 0) + 1);
  }
  const byId = new Map(folders.map((f) => [+f.id, f]));
  const children = new Map();
  const roots = [];
  for (const f of folders) {
    const pid = +f["parent-folder"] || 0;
    if (pid && byId.has(pid)) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(f);
    } else {
      roots.push(f);   // Root-Ebene oder Elternordner nicht sichtbar
    }
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), "de");
  roots.sort(byName);
  children.forEach((arr) => arr.sort(byName));
  const total = new Map();
  const calcTotal = (f) => {
    let n = direct.get(+f.id) || 0;
    for (const c of children.get(+f.id) || []) n += calcTotal(c);
    total.set(+f.id, n);
    return n;
  };
  roots.forEach(calcTotal);
  S.folderCollapsed = S.folderCollapsed || new Set();
  const rows = [];
  const walk = (f, depth) => {
    const id = +f.id;
    const kids = children.get(id) || [];
    rows.push({ ...f, _depth: depth, _kids: kids.length,
                _direct: direct.get(id) || 0, _total: total.get(id) || 0,
                _collapsed: S.folderCollapsed.has(id) });
    if (!S.folderCollapsed.has(id)) kids.forEach((k) => walk(k, depth + 1));
  };
  roots.forEach((r) => walk(r, 0));
  return rows;
}

function renderInvTable() {
  const cols = INV_COLS[S.invTab];
  const data = S.inventory[S.invTab] || [];
  let rows = applyInvFilters(data, cols);
  // Baumansicht für Ordner, solange weder Filter noch Sortierung aktiv sind
  const treeMode = S.invTab === "folders" && !(S.invChips || []).length
    && !$("invSearch").value.trim() && !S.invSort;

  if (S.invSort) {
    const { key, dir } = S.invSort;
    const mul = dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => String(a[key] ?? "").localeCompare(
      String(b[key] ?? ""), "de", { numeric: true, sensitivity: "base" }) * mul);
  }
  S.invRows = rows;

  const active = (S.invChips || []).length > 0 || $("invSearch").value.trim() !== "";
  $("invCount").textContent = rows.length !== data.length
    ? `${rows.length} / ${data.length}` : `${data.length}`;
  $("btnFilterReset").hidden = !active && !S.invSort;
  let note = "";
  const tot = S.inventory.totals || {};
  if ((S.invTab === "secrets" && tot.secrets != null && tot.secrets > S.inventory.secrets.length) ||
      (S.invTab === "folders" && tot.folders != null && tot.folders > S.inventory.folders.length)) {
    const total = S.invTab === "secrets" ? tot.secrets : tot.folders;
    const visible = data.length;
    note = `<div class="notice">Das Gerät meldet insgesamt <b>${total}</b> Einträge, für den
      API-User sichtbar: <b>${visible}</b>. FortiPAM filtert Secrets und Ordner pro Benutzer —
      dem API-User fehlen Berechtigungen. Abhilfe: In der FortiPAM-GUI den betroffenen Ordnern
      unter <span class="mono">Permissions</span> den API-User (z. B. „api") mit Ordner- und
      Secret-Berechtigung hinzufügen.</div>`;
  }
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

  const sel = SELECTABLE[S.invTab];
  const filterKeys = new Set(FILTER_COLS[S.invTab] || []);
  if (treeMode && data.length) {
    rows = buildFolderTree();
    S.invRows = rows;
    $("invCount").textContent = String(data.length);
    const head = `<th class="sel-col"><input type="checkbox" id="selAll" title="${esc(t("alle auswählen"))}"></th>` +
      `<th>${esc(t("Ordner"))}</th><th>ID</th><th>Secrets</th><th title="${esc(t("inklusive Unterordner"))}">${esc(t("Gesamt"))}</th>`;
    const body = rows.map((r, i) => {
      const toggle = r._kids
        ? `<span class="tree-toggle" data-id="${r.id}" title="${r._collapsed ? "aufklappen" : "zuklappen"}">${r._collapsed ? "▸" : "▾"}</span>`
        : `<span class="tree-toggle-spacer"></span>`;
      const hidden = r._collapsed && r._kids
        ? ` <span class="dim">(+${r._kids} Unterordner)</span>` : "";
      return `<tr class="clickable" data-idx="${i}">` +
        `<td class="sel-col"><input type="checkbox" class="sel-row" data-idx="${i}"></td>` +
        `<td><span style="display:inline-block;width:${r._depth * 20}px"></span>${toggle}` +
        `${esc(r.name)}${hidden}</td>` +
        `<td>${r.id}</td><td>${r._direct || ""}</td>` +
        `<td>${r._total !== r._direct ? r._total : (r._direct || "")}</td></tr>`;
    }).join("");
    $("invTable").innerHTML = note +
      `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    $("invTable").querySelectorAll(".tree-toggle[data-id]").forEach((t) =>
      t.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = +t.dataset.id;
        if (S.folderCollapsed.has(id)) S.folderCollapsed.delete(id);
        else S.folderCollapsed.add(id);
        renderInvTable();
      }));
  } else if (!rows.length) {
    $("invTable").innerHTML = note + `<p class="empty-note">${esc(t("Keine Einträge."))}</p>`;
  } else {
    const head = (sel ? `<th class="sel-col"><input type="checkbox" id="selAll" title="alle (gefilterten) auswählen"></th>` : "") +
      cols.map((c) => {
        const arrow = S.invSort && S.invSort.key === c.k
          ? `<span class="sort-arrow">${S.invSort.dir === "asc" ? "▲" : "▼"}</span>` : "";
        return `<th class="sortable" data-key="${esc(c.k)}" title="${esc(t("Nach {c} sortieren", { c: t(c.l) }))}">${esc(t(c.l))}${arrow}</th>`;
      }).join("");
    const body = rows.map((r, i) =>
      `<tr class="clickable" data-idx="${i}">` +
      (sel ? `<td class="sel-col"><input type="checkbox" class="sel-row" data-idx="${i}"></td>` : "") +
      cols.map((c) => {
        if (c.r) return `<td>${c.r(r)}</td>`;
        const val = String(r[c.k] ?? "");
        if (val && filterKeys.has(c.k)) {
          return `<td><span class="cellf" data-key="${esc(c.k)}" data-val="${esc(val)}"` +
                 ` title="Nach '${esc(val)}' filtern">${esc(val)}</span></td>`;
        }
        return `<td>${esc(val)}</td>`;
      }).join("") + "</tr>"
    ).join("");
    $("invTable").innerHTML = note +
      `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  const selAll = $("selAll");
  if (selAll) selAll.addEventListener("change", () => {
    $("invTable").querySelectorAll(".sel-row").forEach((cb) => (cb.checked = selAll.checked));
    updateDeleteBtn();
  });
  $("invTable").querySelectorAll(".sel-row").forEach((cb) =>
    cb.addEventListener("change", updateDeleteBtn));
  $("invTable").querySelectorAll("tr.clickable").forEach((tr) =>
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".sel-col") || e.target.closest(".cellf")) return;
      openDetail(+tr.dataset.idx);
    }));
  $("invTable").querySelectorAll("th.sortable").forEach((th) =>
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (S.invSort && S.invSort.key === key) {
        S.invSort = S.invSort.dir === "asc" ? { key, dir: "desc" } : null;
      } else {
        S.invSort = { key, dir: "asc" };
      }
      renderInvTable();
    }));
  $("invTable").querySelectorAll(".cellf").forEach((sp) =>
    sp.addEventListener("click", (e) => {
      e.stopPropagation();
      const col = cols.find((c) => c.k === sp.dataset.key);
      addChip({ type: "col", key: sp.dataset.key,
                label: col ? col.l : sp.dataset.key, value: sp.dataset.val });
    }));
  updateDeleteBtn();
  retranslate();
}

function updateDeleteBtn() {
  const sel = SELECTABLE[S.invTab];
  const n = document.querySelectorAll("#invTable .sel-row:checked").length;
  const btn = $("btnDelete");
  btn.hidden = !sel || n === 0;
  btn.textContent = `${t("Auswahl löschen")} (${n})`;
}

/* ---- Detailansicht -------------------------------------------------- */

async function openDetail(idx) {
  const r = S.invRows[idx];
  if (!r) return;
  const km = { secrets: ["secret", r.id], targets: ["target", r.name],
               templates: ["template", r.name], folders: ["folder", r.id] }[S.invTab];
  if (!km) return;
  const [kind, mkey] = km;
  let obj = r;
  if (S.invTab === "secrets" || S.invTab === "targets") {
    try {
      obj = await api(`/api/object/${kind}/${encodeURIComponent(mkey)}`);
    } catch (e) { toast(e.message, "err"); return; }
  }
  const entries = Object.entries(obj)
    .filter(([k, v]) => !k.startsWith("q_") && !k.startsWith("_") && v !== "" && v != null
      && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => {
      const val = (typeof v === "object") ? JSON.stringify(v, null, 1) : String(v);
      return `<span class="k">${esc(k)}</span><span class="v">${esc(val)}</span>`;
    }).join("");
  $("invDetail").innerHTML = `<div class="detail-box">
    <button class="close-x" title="Schließen">✕</button>
    <h3>${esc(kind)} · ${esc(String(obj.name ?? mkey))}</h3>
    <div class="detail-grid">${entries}</div></div>`;
  $("invDetail").querySelector(".close-x").addEventListener("click",
    () => { $("invDetail").innerHTML = ""; });
}

/* ---- Bulk-Löschen --------------------------------------------------- */

$("btnDelete").addEventListener("click", async () => {
  const sel = SELECTABLE[S.invTab];
  if (!sel) return;
  const items = [...document.querySelectorAll("#invTable .sel-row:checked")].map((cb) => {
    const r = S.invRows[+cb.dataset.idx];
    return { kind: sel.kind, mkey: sel.mkey(r), label: String(sel.label(r)) };
  });
  if (!items.length) return;
  const preview = items.slice(0, 10).map((i) => i.label).join("\n· ");
  if (!confirm(`${t("{n} Objekt(e) löschen?", { n: items.length })}\n\n· ${preview}` +
               (items.length > 10 ? `\n… ${t("und {n} weitere", { n: items.length - 10 })}` : ""))) return;
  if (!confirm(`${t("Wirklich ENDGÜLTIG löschen?")}\n\n${t("{n} Objekt(e) auf {dev}",
               { n: items.length, dev: $("connText").textContent })}\n\n` +
               t("Dies kann nicht rückgängig gemacht werden."))) return;
  try {
    await api("/api/delete", { method: "POST", body: { items } });
    addLog("warn", `Delete started: ${items.length} object(s).`);
    pollDelete();
  } catch (e) {
    toast(e.message, "err");
  }
});

function pollDelete() {
  const box = $("invConsole");
  box.hidden = false;
  box.innerHTML = "";
  let rendered = 0;
  const tick = async () => {
    try {
      const j = await api("/api/execute/status");
      for (; rendered < j.items.length; rendered++) {
        const it = j.items[rendered];
        const line = document.createElement("div");
        line.className = it.status === "ok" ? "cl-ok" : "cl-err";
        line.textContent = `${it.status === "ok" ? "✔" : "✘"} ${it.kind} ${it.name} — ${it.message}`;
        box.appendChild(line);
        addLog(it.status === "ok" ? "ok" : "err", `Delete ${it.kind} ${it.name}: ${it.message}`);
      }
      box.scrollTop = box.scrollHeight;
      if (j.finished) {
        const errs = j.items.filter((i) => i.status === "error").length;
        toast(errs ? t("Löschen beendet – {n} Fehler.", { n: errs }) : t("Objekte gelöscht."),
              errs ? "err" : "ok");
        $("invDetail").innerHTML = "";
        await loadInventory(true);
        return;
      }
      setTimeout(tick, 600);
    } catch (e) {
      toast(e.message, "err");
    }
  };
  tick();
}

function tableHTML(cols, rows) {
  if (!rows.length) return `<p class="empty-note">${esc(t("Keine Einträge."))}</p>`;
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
    S.invChips = [];
    S.invSort = null;
    $("invSearch").value = "";
    $("invDetail").innerHTML = "";
    closeFilterMenu();
    renderChips();
    renderInvFilters();
    renderInvTable();
  }));
$("invSearch").addEventListener("input", renderInvTable);
$("invSearch").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const raw = $("invSearch").value.trim();
  const tokens = parseQuery(raw);
  if (!tokens.length) return;
  $("invSearch").value = "";
  addChip({ type: "text", raw, tokens });
});
$("btnSearchHelp").addEventListener("click", () => {
  const box = $("searchHelp");
  box.hidden = !box.hidden;
  $("btnSearchHelp").classList.toggle("active", !box.hidden);
});
$("btnAddFilter").addEventListener("click", () => {
  const menu = $("filterMenu");
  menu.hidden = !menu.hidden;
  $("btnAddFilter").classList.toggle("active", !menu.hidden);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".fmenu-wrap")) closeFilterMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeFilterMenu();
});
$("btnFilterReset").addEventListener("click", () => {
  $("invSearch").value = "";
  S.invChips = [];
  S.invSort = null;
  renderChips();
  renderInvFilters();
  renderInvTable();
});
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
    addLog("ok", `File loaded: ${up.filename} · sheet '${up.sheet}' · ${up.row_count} rows`);
    renderUploadInfo();
    buildMappingUI();
    enableStep(2); enableStep(3, false); enableStep(4, false);
  } catch (e) {
    toast(e.message, "err");
    addLog("err", "File: " + e.message);
  }
}

function renderUploadInfo() {
  const up = S.upload;
  const sheetSel = up.sheets.length > 1
    ? `<label class="inline"><span class="lbl-inline">${esc(t("Blatt"))}</span>
        <select id="sheetSel">${up.sheets.map((s) =>
          `<option ${s === up.sheet ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>`
    : `<span><span class="k">${esc(t("Blatt:"))}</span> ${esc(up.sheet)}</span>`;
  $("uploadInfo").innerHTML = `
    <div class="upload-meta">
      <span><span class="k">${esc(t("Datei:"))}</span> ${esc(up.filename)}</span>
      ${sheetSel}
      <span><span class="k">${esc(t("Zeilen:"))}</span> ${up.row_count}</span>
      <span><span class="k">${esc(t("Spalten:"))}</span> ${up.headers.length}</span>
      <button class="btn primary" id="btnToMapping">${esc(t("Weiter zum Mapping →"))}</button>
    </div>
    ${up.truncated ? `<div class="notice">${esc(t("Datei wurde auf 5000 Zeilen begrenzt."))}</div>` : ""}`;
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
  retranslate();
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
  let opts = `<option value="">${esc(t("— nicht setzen —"))}</option>`;
  if (fixedOptions.length) {
    opts += `<optgroup label="${esc(t("FortiPAM-Werte"))}">` + fixedOptions.map((o) =>
      `<option value="xfix:${esc(o)}">${esc(o)}</option>`).join("") + `</optgroup>`;
  }
  opts += `<option value="fixed">${esc(t("Fester Wert …"))}</option>`;
  opts += `<optgroup label="${esc(t("Excel-Spalten"))}">` + cols.map((c) =>
    `<option value="col:${esc(c)}">${esc(t("Spalte"))}: ${esc(c)}</option>`).join("") + `</optgroup>`;
  return `<span class="src-pair">
    <select id="${id}" data-preset="${esc(preset || "")}">${opts}</select>
    <input type="text" id="${id}_fx" placeholder="${esc(t("fester Wert"))}" hidden>
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
    `<option value="fixed">${esc(t("Festes Template für alle Zeilen"))}</option>` +
    headers.map((h) =>
      `<option value="col:${esc(h)}" ${h === typeColGuess ? "selected" : ""}>${esc(t("Spalte"))}: ${esc(h)}</option>`).join("");
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
      addLog("ok", `Template '${tpl.name}' loaded.`);
      toast(`Template '${tpl.name}' verfügbar.`, "ok");
    } catch (e) {
      toast(e.message, "err");
      addLog("err", "Load template: " + e.message);
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
    [t("Name") + " *", srcSelectHTML("tName", { preset: nameGuess ? "col:" + nameGuess : null })],
    [t("Adresse (IP/FQDN)"), srcSelectHTML("tAddr", { preset: addrGuess ? "col:" + addrGuess : null })],
    [t("Klassifizierung") + " *", srcSelectHTML("tClass", {
      fixedOptions: tagNames, preset: tagNames.length ? "xfix:" + tagNames[0] : null })],
    [t("Domäne"), srcSelectHTML("tDomain", { preset: domGuess ? "col:" + domGuess : null })],
    ["URL", srcSelectHTML("tUrl", {})],
    [t("Beschreibung"), srcSelectHTML("tDesc", { preset: descGuess ? "col:" + descGuess : null })],
  ].map(([l, s]) => `<div class="fname">${l}</div>${s}`).join("");
  ["tName", "tAddr", "tClass", "tDomain", "tUrl", "tDesc"].forEach(wireSrcSelect);

  /* --- Secret-Basisfelder --- */
  $("mapSecretBase").innerHTML = [
    [t("Name") + " *", srcSelectHTML("sName", { preset: nameGuess ? "col:" + nameGuess : null })],
    [t("Beschreibung"), srcSelectHTML("sDesc", { preset: descGuess ? "col:" + descGuess : null })],
  ].map(([l, s]) => `<div class="fname">${l}</div>${s}`).join("");
  ["sName", "sDesc"].forEach(wireSrcSelect);

  renderFieldMaps();

  $("optTargets").onchange = () => { $("panelTarget").style.opacity = $("optTargets").checked ? 1 : .35; };
  $("optSecrets").onchange = () => { $("panelSecret").style.opacity = $("optSecrets").checked ? 1 : .35; };
  retranslate();
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
    box.innerHTML = `<div class="notice">${esc(t("Spalte '{col}' hat zu viele oder keine unterschiedlichen Werte – bitte andere Spalte oder festes Template wählen.", { col }))}</div>`;
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
  const thVal = t("Wert in Spalte '{col}'", { col });
  const thTpl = t("FortiPAM-Template");
  const naOpt = t("— nicht zugeordnet —");
  box.innerHTML = `<div class="vmap-table"><table><thead>
      <tr><th>${esc(thVal)}</th><th>${esc(thTpl)}</th></tr></thead><tbody>` +
    distinct.map((v, i) => `<tr><td class="mono">${esc(v)}</td><td>
      <select class="vmap-sel" data-raw="${esc(v)}" id="vmap_${i}">
        <option value="">${esc(naOpt)}</option>
        ${tplNames.map((tn) => `<option ${tn === guess(v) ? "selected" : ""}>${esc(tn)}</option>`).join("")}
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
    box.innerHTML = `<div class="notice">${esc(t("Noch kein Template gewählt bzw. zugeordnet – oben die Secret-Typ-Zuordnung vervollständigen."))}</div>`;
  }
}

/* ==== Vorlagen-Generator ============================================ */

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("btnTplGen").addEventListener("click", async () => {
  const chosen = [...$("tplGenSel").selectedOptions].map((o) => o.value);
  if (!chosen.length) { toast("Bitte mindestens ein Template auswählen.", "err"); return; }
  try {
    const resp = await fetch("/api/excel/template-generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templates: chosen }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || `HTTP ${resp.status}`);
    }
    downloadBlob(await resp.blob(), "FortiPAM_Import_Vorlage_Templates.xlsx");
    addLog("ok", `Template generated for ${chosen.length} template(s).`);
  } catch (e) {
    toast(e.message, "err");
  }
});

/* ==== Mapping-Profile =============================================== */

$("btnProfileSave").addEventListener("click", () => {
  const profile = { version: 1, saved: new Date().toISOString(),
                    mapping: collectMapping() };
  downloadBlob(new Blob([JSON.stringify(profile, null, 2)],
                        { type: "application/json" }),
               "fortipam-mapping-profil.json");
  addLog("ok", "Mapping profile saved.");
});

$("btnProfileLoad").addEventListener("click", () => $("profileFile").click());
$("profileFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const mapping = data.mapping || data;
      const warnings = applyMapping(mapping);
      addLog("ok", `Mapping profile '${file.name}' loaded.`);
      toast(warnings.length
        ? `Profil geladen – ${warnings.length} Hinweis(e), siehe Protokoll.`
        : "Profil geladen.", warnings.length ? "err" : "ok");
      warnings.forEach((w) => addLog("warn", "Profile: " + w));
    } catch (err) {
      toast("Profil konnte nicht gelesen werden: " + err.message, "err");
    }
  };
  reader.readAsText(file);
});

/* Quelle in ein srcSelect-Paar zurückschreiben */
function setSrc(id, src, warnings) {
  const sel = $(id);
  if (!sel) return;
  const fx = $(id + "_fx");
  if (!src || !src.type) { sel.value = ""; fx.hidden = true; return; }
  if (src.type === "column") {
    const want = "col:" + src.value;
    if ([...sel.options].some((o) => o.value === want)) {
      sel.value = want;
    } else {
      warnings.push(`Spalte '${src.value}' existiert in dieser Datei nicht (${id})`);
      sel.value = "";
    }
    fx.hidden = true;
  } else if (src.type === "fixed") {
    const xf = "xfix:" + src.value;
    if ([...sel.options].some((o) => o.value === xf)) {
      sel.value = xf; fx.hidden = true;
    } else {
      sel.value = "fixed"; fx.hidden = false; fx.value = src.value;
    }
  }
}

/* Ein gespeichertes Mapping auf die aktuelle UI anwenden */
function applyMapping(m) {
  const warnings = [];
  if (!S.upload || !S.inventory) { warnings.push("Keine Datei/Verbindung geladen"); return warnings; }
  const opts = m.options || {};
  $("optTargets").checked = !!opts.create_targets;
  $("optSecrets").checked = !!opts.create_secrets;
  $("optAutoFolders").checked = !!opts.auto_create_folders;
  $("optDupCheck").checked = opts.dup_check !== false;
  $("optGenPw").checked = !!opts.generate_passwords;
  if (opts.password_length) $("optGenLen").value = opts.password_length;
  const soIds = { "checkout": "soCheckout", "recording": "soRecording",
                  "password-changer": "soPwChanger", "password-heartbeat": "soHeartbeat" };
  const sopts = (m.secret || {}).options || {};
  for (const [key, id] of Object.entries(soIds)) {
    $(id).value = ["enable", "disable"].includes(sopts[key]) ? sopts[key] : "";
  }
  $("optTargets").onchange(); $("optSecrets").onchange();

  // Secret-Typ-Quelle
  const tpl = (m.secret || {}).template || {};
  if (tpl.type === "fixed") {
    $("tplSource").value = "fixed";
    renderTplValueMap();
    if ([...$("tplFixed").options].some((o) => o.value === tpl.value || o.text === tpl.value)) {
      $("tplFixed").value = tpl.value;
    } else {
      warnings.push(`Template '${tpl.value}' nicht verfügbar`);
    }
  } else if (tpl.type === "column") {
    const want = "col:" + tpl.value;
    if ([...$("tplSource").options].some((o) => o.value === want)) {
      $("tplSource").value = want;
      renderTplValueMap();
      const vmap = {};
      for (const [k, v] of Object.entries(tpl.value_map || {})) vmap[k.toLowerCase()] = v;
      document.querySelectorAll(".vmap-sel").forEach((sel) => {
        const mapped = vmap[(sel.dataset.raw || "").toLowerCase()];
        if (mapped === undefined) return;
        if ([...sel.options].some((o) => o.value === mapped || o.text === mapped)) {
          sel.value = mapped;
        } else {
          warnings.push(`Template '${mapped}' (für '${sel.dataset.raw}') nicht verfügbar`);
        }
      });
    } else {
      warnings.push(`Secret-Typ-Spalte '${tpl.value}' existiert nicht`);
    }
  }
  renderFieldMaps();

  // Ordner
  const fol = (m.secret || {}).folder || {};
  if (fol.type) {
    $("folderMode").value = fol.type;
    $("folderMode").onchange();
    if (fol.type === "fixed_id") {
      if ([...$("folderFixed").options].some((o) => o.value === String(fol.value))) {
        $("folderFixed").value = String(fol.value);
      } else {
        warnings.push(`Ordner-ID ${fol.value} existiert nicht mehr`);
      }
    } else if (fol.type === "fixed_path") {
      $("folderPath").value = fol.value || "";
    } else if (fol.type === "column_path") {
      if ([...$("folderCol").options].some((o) => o.value === fol.value)) {
        $("folderCol").value = fol.value;
      } else {
        warnings.push(`Ordner-Spalte '${fol.value}' existiert nicht`);
      }
      if ([...$("folderBase").options].some((o) => o.value === String(fol.base ?? 0))) {
        $("folderBase").value = String(fol.base ?? 0);
      }
    }
  }
  if (opts.root_folder_owner &&
      [...$("folderOwner").options].some((o) => o.value === opts.root_folder_owner)) {
    $("folderOwner").value = opts.root_folder_owner;
  }

  // Target-/Secret-Basisfelder
  const t = m.target || {};
  setSrc("tName", t.name, warnings); setSrc("tAddr", t.address, warnings);
  setSrc("tClass", t.class, warnings); setSrc("tDomain", t.domain, warnings);
  setSrc("tUrl", t.url, warnings); setSrc("tDesc", t.description, warnings);
  const sec = m.secret || {};
  setSrc("sName", sec.name, warnings); setSrc("sDesc", sec.description, warnings);

  // Template-Felder
  document.querySelectorAll(".tpl-card").forEach((card) => {
    const tplName = card.dataset.tpl;
    const tplObj = S.inventory.templates.find((x) => x.name === tplName);
    const fmap = (sec.fields || {})[tplName] || {};
    if (!tplObj) return;
    card.querySelectorAll("select[id^=fmap_]").forEach((sel, i) => {
      const f = (tplObj.field || [])[i];
      if (f && fmap[f.name] !== undefined) setSrc(sel.id, fmap[f.name], warnings);
    });
  });
  return warnings;
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
      dup_check: $("optDupCheck").checked,
      generate_passwords: $("optGenPw").checked,
      password_length: +$("optGenLen").value || 20,
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
      options: {
        "checkout": $("soCheckout").value,
        "recording": $("soRecording").value,
        "password-changer": $("soPwChanger").value,
        "password-heartbeat": $("soHeartbeat").value,
      },
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
    addLog("info", `Plan computed: ${plan.summary.targets_create} targets, ` +
      `${plan.summary.secrets_create} secrets, ${plan.summary.folders_create} folders new`);
  } catch (e) {
    toast(e.message, "err");
    addLog("err", "Plan: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Vorschau berechnen →";
  }
});

const BADGE_KEY = { create: "erstellen", exists: "existiert",
  error: "fehler", duplicate: "doppelt", none: "—" };
const BADGE = new Proxy({}, { get: (_, k) =>
  `<span class="badge ${String(k)}">${esc(t(BADGE_KEY[k] || k))}</span>` });

function renderPlan() {
  const p = S.plan, s = p.summary;
  $("planTiles").innerHTML = `
    <div class="tile ok"><div class="num">${s.targets_create}</div><div class="cap">${t("Targets neu")}</div></div>
    <div class="tile ok"><div class="num">${s.secrets_create}</div><div class="cap">${t("Secrets neu")}</div></div>
    <div class="tile dim"><div class="num">${s.folders_create}</div><div class="cap">${t("Ordner neu")}</div></div>
    <div class="tile dim"><div class="num">${s.targets_exist + s.secrets_exist}</div><div class="cap">${t("Übersprungen")}</div></div>
    <div class="tile ${s.secrets_error + s.row_errors ? "err" : "dim"}">
      <div class="num">${s.secrets_error + s.row_errors}</div><div class="cap">${t("Fehler")}</div></div>`;

  let warn = "";
  for (const n of p.notices || []) {
    warn += `<div class="notice error">${esc(n)}</div>`;
  }
  if (s.secrets_error + s.row_errors > 0) {
    warn += `<div class="notice error">${esc(t("Zeilen mit Fehlern werden bei der Ausführung übersprungen."))}</div>`;
  }
  if (p.folders.length) {
    warn += `<div class="notice">${esc(t("Neue Ordner:"))} ${p.folders.map((f) => esc(f.path)).join(" · ")}</div>`;
  }
  $("planWarnings").innerHTML = warn;

  let html = "";
  if (p.targets.length) {
    html += `<h2>Targets</h2>` + tableHTML(
      [{ k: "name", l: t("Name") },
       { k: "action", l: t("Aktion"), r: (r) => BADGE[r.action] || esc(r.action) },
       { k: "_addr", l: t("Adresse"), r: (r) => esc(r.body?.address || "") },
       { k: "_tpl", l: "Template", r: (r) => esc(r.body?.template || "") },
       { k: "rows", l: t("Zeilen"), r: (r) => esc(r.rows.join(", ")) }],
      p.targets);
  }
  if (p.secrets.length) {
    html += `<h2 style="margin-top:22px">Secrets</h2>` + tableHTML(
      [{ k: "row", l: t("Zeile") },
       { k: "name", l: t("Name") },
       { k: "action", l: t("Aktion"), r: (r) => BADGE[r.action] || esc(r.action) },
       { k: "folder_path", l: t("Ordner") },
       { k: "template", l: "Template" },
       { k: "target", l: "Target" },
       { k: "_msg", l: t("Hinweise"), r: (r) =>
          `<span class="cl-err">${esc(r.error || "")}</span>` +
          (r.warnings?.length ? ` <span class="cl-warn">${esc(r.warnings.join("; "))}</span>` : "") }],
      p.secrets);
  }
  if (p.row_errors.length) {
    html += `<h2 style="margin-top:22px">${t("Zeilenfehler")}</h2>` + tableHTML(
      [{ k: "row", l: t("Zeile") }, { k: "error", l: t("Fehler") }], p.row_errors);
  }
  $("planTable").innerHTML = html || `<p class="empty-note">${esc(t("Nichts zu tun."))}</p>`;

  $("btnExecute").disabled =
    s.targets_create + s.secrets_create + s.folders_create === 0;
  retranslate();
}

$("btnBackMapping").addEventListener("click", () => gotoStep(2));

/* ==== Ausführung ===================================================== */

$("btnExecute").addEventListener("click", async () => {
  const s = S.plan.summary;
  const msg = `${t("Jetzt erstellen")}?\n\n` +
    `· ${s.folders_create} ${t("Ordner")}\n· ${s.targets_create} Targets\n· ${s.secrets_create} Secrets\n\n` +
    `${t("Ziel")}: ${$("connText").textContent}`;
  if (!confirm(msg)) return;
  try {
    await api("/api/execute", { method: "POST" });
    enableStep(4); gotoStep(4);
    $("execLog").innerHTML = "";
    $("btnExecDone").hidden = true;
    $("btnCancel").hidden = false;
    $("execTitle").textContent = t("Ausführung läuft …");
    addLog("info", "Bulk creation started.");
    pollExecution();
  } catch (e) {
    toast(e.message, "err");
  }
});

$("btnCancel").addEventListener("click", async () => {
  await api("/api/execute/cancel", { method: "POST" });
  addLog("warn", "Cancellation requested.");
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
      // sichtbare Ausführungsansicht folgt der UI-Sprache …
      const KIND = { folder: t("Ordner"), target: "Target", secret: "Secret", system: "System" };
      // … das Protokoll ist immer englisch
      const LOG_KIND = { folder: "Folder", target: "Target", secret: "Secret", system: "System" };
      for (; renderedItems < j.items.length; renderedItems++) {
        const it = j.items[renderedItems];
        const line = document.createElement("div");
        const sym = it.status === "ok" ? "✔" : it.status === "error" ? "✘" : "·";
        line.className = it.status === "ok" ? "cl-ok" : it.status === "error" ? "cl-err" : "cl-dim";
        line.textContent = `${sym} ${KIND[it.kind] || it.kind} ${it.name}` +
          (it.row ? ` (${t("Zeile")} ${it.row})` : "") + (it.message ? ` — ${it.message}` : "");
        box.appendChild(line);
        addLog(it.status === "error" ? "err" : "ok",
          `${LOG_KIND[it.kind] || it.kind} ${it.name}: ${it.message || it.status}`);
      }
      box.scrollTop = box.scrollHeight;
      if (j.finished) {
        const errors = j.items.filter((i) => i.status === "error").length;
        $("execTitle").textContent = errors
          ? `${t("Abgeschlossen –")} ${errors} ${t("Fehler")}`
          : t("Abgeschlossen – alles erstellt");
        $("execBar").style.width = "100%";
        $("btnCancel").hidden = true;
        $("btnExecDone").hidden = false;
        addLog(errors ? "warn" : "ok",
          `Bulk creation finished: ${j.done} actions, ${errors} errors.`);
        toast(errors ? t("Fertig mit {n} Fehlern.", { n: errors }) : t("Alle Objekte erstellt."),
              errors ? "err" : "ok");
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

function buildSoSelects() {
  document.querySelectorAll(".so-sel").forEach((sel) => {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${esc(t("— Gerätestandard —"))}</option>
      <option value="enable">${esc(t("aktivieren"))}</option>
      <option value="disable">${esc(t("deaktivieren"))}</option>`;
    sel.value = cur;
  });
}

addLog("info", "FortiPAM Toolkit started.");
buildSoSelects();
(async () => {
  let saved = "de";
  try { saved = localStorage.getItem("fpt_lang") || "de"; } catch (e) { /* egal */ }
  await applyLang(saved);
  await loadConnections();
  try {
    const st = await api("/api/status");
    if (st.connected && st.conn_info) {
      setConnected(true, st.conn_info);
      await loadInventory();
    }
  } catch (e) { /* Server frisch gestartet */ }
})();
