/*!
 * DBF Studio — app.js
 * DBX plugin: browse, inspect and edit DBF tables (securities settlement exchange files).
 */
(function (g) {
  "use strict";

  const DBF = g.DBF;
  let T = (k, vars) => (g.I18N ? g.I18N.t(k, vars) : k);

  /* ------------------------------------------------------------- utilities */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k === "dataset") Object.assign(node.dataset, v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      const list = Array.isArray(children) ? children : [children];
      for (const c of list) {
        if (c === null || c === undefined) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function icon(name, cls) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ico" + (cls ? " " + cls : ""));
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }

  function debounce(fn, ms) {
    let h = null;
    return function () {
      const args = arguments;
      clearTimeout(h);
      h = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  function fmtBytes(n) {
    if (n == null) return "—";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  function fmtYmd(d) {
    if (!d || !d.y) return "—";
    const two = (n) => String(n || 0).padStart(2, "0");
    return d.y + "-" + two(d.m) + "-" + two(d.d);
  }

  function b64ToBytes(b64) {
    const bin = atob(String(b64 || ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(bytes) {
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  function concat(parts, total) {
    const size = total != null ? total : parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out.subarray(0, at);
  }

  const nowIso = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  function baseName(name) {
    return String(name || "").split(/[\\/]/).pop();
  }

  function stemOf(name) {
    return baseName(name).replace(/\.[^.]+$/, "").toUpperCase();
  }

  function extOf(name) {
    const m = String(name || "").match(/\.([^.]+)$/);
    return m ? m[1].toLowerCase() : "";
  }

  /* ------------------------------------------------------------- host bridge */

  const Host = {
    api: g.dbxPlugin || null,
    caps: {},
    ready: false,

    async init() {
      const api = Host.api;
      if (api && api.ready) {
        try {
          await api.ready;
        } catch (e) {
          /* host may not answer in a plain browser */
        }
      }
      Host.caps = (api && api.capabilities) || {};
      Host.ready = true;
      return Host.caps;
    },

    ft() {
      return (Host.api && Host.api.fileTransfer) || null;
    },

    can(flag) {
      const ft = Host.caps && Host.caps.fileTransfer;
      return !!(ft && ft[flag]);
    },

    /** pick local files, returns [{name,size,read(offset,len)}] */
    async pick(multiple) {
      const ft = Host.ft();
      if (ft && Host.can("pick")) {
        const res = await ft.pick({ multiple: !!multiple });
        const files = (res && res.files) || [];
        return files.map((f) => ({
          name: f.name,
          size: f.size,
          path: f.relativePath || f.name,
          handleId: f.handleId,
          read: async (offset, length) => {
            const r = await ft.read(f.handleId, offset, length);
            const bytes = b64ToBytes(r && r.dataBase64);
            return { bytes, eof: !!(r && r.eof) };
          },
        }));
      }
      return pickWithInput(multiple);
    },

    /** write bytes to disk, returns true on success */
    async save(name, bytes, mime) {
      const ft = Host.ft();
      if (ft && Host.can("beginSave")) {
        const target = await ft.beginSave({
          name,
          contentType: mime || "application/octet-stream",
          size: bytes.length,
        });
        if (!target) return false;
        const chunk = Math.max(1, target.chunkBytes || 1024 * 1024);
        let at = 0;
        try {
          while (at < bytes.length) {
            const slice = bytes.subarray(at, Math.min(at + chunk, bytes.length));
            await ft.write(target.handleId, at, bytesToB64(slice));
            at += slice.length;
          }
          await ft.finish(target.handleId);
          return true;
        } catch (err) {
          try {
            if (ft.cancel) await ft.cancel(target.handleId);
          } catch (e) {
            /* ignore */
          }
          throw err;
        }
      }
      download(name, bytes, mime);
      return true;
    },

    async getStore(key) {
      const api = Host.api;
      try {
        if (api && api.storage && api.storage.get) {
          const v = await api.storage.get(key);
          return v == null ? null : v;
        }
      } catch (e) {
        /* ignore */
      }
      try {
        const raw = localStorage.getItem("dbfstudio:" + key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    async setStore(key, value) {
      const api = Host.api;
      try {
        if (api && api.storage && api.storage.set) {
          await api.storage.set(key, value);
          return;
        }
      } catch (e) {
        /* ignore */
      }
      try {
        localStorage.setItem("dbfstudio:" + key, JSON.stringify(value));
      } catch (e) {
        /* ignore */
      }
    },

    async copy(text) {
      const api = Host.api;
      try {
        if (api && api.clipboard && api.clipboard.writeText) {
          await api.clipboard.writeText(text);
          return true;
        }
      } catch (e) {
        /* ignore */
      }
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        return false;
      }
    },

    async assetUrl(path) {
      const api = Host.api;
      try {
        if (api && api.readAssetUrl) {
          const u = await api.readAssetUrl(path);
          if (u) return u;
        }
      } catch (e) {
        /* ignore */
      }
      return path;
    },

    /** call into this plugin's backend sidecar */
    async backend(method, params) {
      const api = Host.api;
      if (!api || typeof api.invoke !== "function") {
        throw new Error(typeof T === "function" ? T("conn.noBackend") : "plugin backend unavailable");
      }
      return api.invoke(method, params || {}, { timeoutMs: 120000 });
    },

    setTitle(t) {
      const api = Host.api;
      try {
        if (api && api.setTitle) api.setTitle(t);
      } catch (e) {
        /* ignore */
      }
    },
  };

  function download(name, bytes, mime) {
    const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 4000);
  }

  function pickWithInput(multiple) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = !!multiple;
      input.accept = ".dbf,.DBF,.dbt,.DBT,.fpt,.FPT,.csv,.txt";
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.appendChild(input);
      input.addEventListener("change", () => {
        const files = Array.from(input.files || []);
        input.remove();
        resolve(
          files.map((f) => ({
            name: f.name,
            size: f.size,
            path: f.name,
            file: f,
            read: async (offset, length) => {
              const end = length == null || length <= 0 ? f.size : Math.min(offset + length, f.size);
              const buf = await f.slice(offset, end).arrayBuffer();
              return { bytes: new Uint8Array(buf), eof: end >= f.size };
            },
          }))
        );
      });
      input.addEventListener("cancel", () => {
        input.remove();
        resolve([]);
      });
      input.click();
    });
  }

  /* ----------------------------------------------------------------- state */

  const state = {
    sources: [], // sources of the active table (dbf + memo)
    source: null, // active dbf source
    buf: null,
    header: null,
    encoding: "gbk",
    autoEncoding: "",
    manualEncoding: "",
    rows: [],
    dirty: false,
    readonly: false,
    sample: "",
    memo: { reader: null, kind: "", name: "", buffer: null, cache: new Map() },
    notes: {},
    prefs: { locale: "", density: "normal", pageSize: 500, showDeleted: false, detail: true, sidebar: true, appearance: "auto", connTable: {}, encodings: {} },
    view: { hidden: new Set(), widths: {}, sort: { col: -1, dir: 0 }, filter: "", page: 0 },
    sel: { row: -1, col: 0 },
    search: { term: "", field: -1, hits: [], at: -1 },
    issues: [],
    busy: false,
    files: [], // multi-open
    conn: null, // {id, info} while opened from a DBF connection provider
  };

  const ui = {};

  function cacheUi() {
    ui.app = $("#app");
    ui.fileChip = $("#fileChip");
    ui.fileName = $("#fileName");
    ui.fileVersion = $("#fileVersion");
    ui.encodingLabel = $("#encodingLabel");
    ui.encodingBtn = $("#encodingBtn");
    ui.recordNo = $("#recordNo");
    ui.recordTotal = $("#recordTotal");
    ui.grid = $("#grid");
    ui.gridHead = $("#gridHead");
    ui.gridBody = $("#gridBody");
    ui.gridScroll = $("#gridScroll");
    ui.emptyState = $("#emptyState");
    ui.fieldList = $("#fieldList");
    ui.infoList = $("#infoList");
    ui.infoNote = $("#infoNote");
    ui.recordForm = $("#recordForm");
    ui.detailEmpty = $("#detailEmpty");
    ui.memoBox = $("#memoBox");
    ui.issueList = $("#issueList");
    ui.stRows = $("#stRows");
    ui.stCols = $("#stCols");
    ui.stSel = $("#stSel");
    ui.stIssues = $("#stIssues");
    ui.stDirty = $("#stDirty");
    ui.stEncoding = $("#stEncoding");
    ui.stTrace = $("#stTrace");
    ui.searchField = $("#searchField");
    ui.searchInput = $("#searchInput");
    ui.searchHits = $("#searchHits");
    ui.filterInput = $("#filterInput");
    ui.filterClear = $("#filterClear");
    ui.showDeleted = $("#showDeleted");
    ui.pager = $("#pager");
    ui.pagerInfo = $("#pagerInfo");
    ui.pageSize = $("#pageSize");
    ui.detail = $("#detail");
    ui.sampleRow = $("#sampleRow");
    ui.toasts = $("#toasts");
    ui.modalRoot = $("#modalRoot");
    ui.menuRoot = $("#menuRoot");
    ui.dropzone = $("#dropzone");
  }

  /* --------------------------------------------------------------- table api */

  function visibleFields() {
    if (!state.header) return [];
    return state.header.fields.filter((f) => !state.view.hidden.has(f.name));
  }

  /** table object in the shape DBF exports/validate expect */
  function tableOf(rows, fields) {
    return {
      fields: fields || state.header.fields,
      rows,
      value: (r, i) => (r.v ? r.v[i] : r[i]),
      deleted: (r) => !!(r && r.del),
    };
  }

  function currentRows(includeDeleted) {
    const showDel = includeDeleted || state.prefs.showDeleted;
    return state.rows.filter((r) => showDel || !r.del);
  }

  /* -------------------------------------------------------------- filtering */

  const filterCache = { key: "", list: [] };

  function filterRows() {
    const text = state.view.filter.trim();
    if (!text) return state.rows.map((_, i) => i);
    if (filterCache.key === text) return filterCache.list;
    const terms = text.split(/\s+/).filter(Boolean).map((term) => {
      const m = term.match(/^([A-Za-z0-9_]+)\s*[:=]\s*(.*)$/);
      if (m) {
        const fi = state.header.fields.findIndex((f) => f.name.toUpperCase() === m[1].toUpperCase());
        if (fi >= 0) return { field: fi, value: m[2].toLowerCase() };
      }
      return { field: -1, value: term.toLowerCase() };
    });
    const out = [];
    for (let i = 0; i < state.rows.length; i += 1) {
      const row = state.rows[i];
      let ok = true;
      for (const t of terms) {
        if (t.field >= 0) {
          if (String(row.v[t.field] || "").toLowerCase().indexOf(t.value) < 0) {
            ok = false;
            break;
          }
        } else {
          let hit = false;
          for (let c = 0; c < row.v.length; c += 1) {
            if (String(row.v[c] || "").toLowerCase().indexOf(t.value) >= 0) {
              hit = true;
              break;
            }
          }
          if (!hit) {
            ok = false;
            break;
          }
        }
      }
      if (ok) out.push(i);
    }
    filterCache.key = text;
    filterCache.list = out;
    return out;
  }

  function sortList(list) {
    const { col, dir } = state.view.sort;
    if (col < 0 || !dir) return list;
    const f = state.header.fields[col];
    const numeric = f && (f.kind === "number" || f.kind === "integer" || f.kind === "currency");
    const copy = list.slice();
    copy.sort((a, b) => {
      const va = state.rows[a].v[col] || "";
      const vb = state.rows[b].v[col] || "";
      let c;
      if (numeric) {
        const na = Number(String(va).replace(/,/g, ""));
        const nb = Number(String(vb).replace(/,/g, ""));
        c = (isFinite(na) ? na : -Infinity) - (isFinite(nb) ? nb : -Infinity);
      } else {
        c = String(va).localeCompare(String(vb), "zh-CN", { numeric: true });
      }
      if (!c) c = a - b;
      return dir > 0 ? c : -c;
    });
    return copy;
  }

  function viewIndices() {
    return sortList(filterRows());
  }

  function pageSize() {
    return state.prefs.pageSize;
  }

  function pageCount() {
    const n = viewIndices().length;
    const ps = pageSize();
    return ps > 0 ? Math.max(1, Math.ceil(n / ps)) : 1;
  }

  function pageRows() {
    const list = viewIndices();
    const ps = pageSize();
    if (!ps) return list;
    const start = state.view.page * ps;
    return list.slice(start, start + ps);
  }

  /* ----------------------------------------------------------------- render */

  function renderAll() {
    renderChrome();
    renderGrid();
    renderSidebar();
    renderDetail();
    renderStatus();
    renderIssues();
  }

  function renderChrome() {
    const has = !!state.header;
    ui.app.classList.toggle("is-empty", !has);
    ui.emptyState.classList.toggle("is-hidden", has);
    ui.fileChip.hidden = !has;
    if (has) {
      ui.fileName.textContent = state.source ? baseName(state.source.name) : "untitled.dbf";
      ui.fileName.title = state.source ? state.source.path || state.source.name : "";
      ui.fileVersion.textContent = state.header.versionName;
      ui.fileVersion.className = "badge" + (state.header.layoutValid ? "" : " warn");
      const encLabel = state.encoding === "gbk" ? "GBK" : state.encoding.toUpperCase();
      const manual = !!state.manualEncoding;
      ui.encodingLabel.textContent = encLabel;
      ui.encodingBtn.title = T("enc.tip", { enc: encLabel, mode: manual ? T("enc.manual") : T("enc.auto") });
      ui.encodingBtn.classList.toggle("is-manual", manual);
      ui.recordTotal.textContent = "/ " + state.rows.length;
      ui.recordNo.value = state.sel.row >= 0 ? String(state.sel.row + 1) : "0";
      ui.pager.hidden = state.rows.length <= Math.min(200, pageSize() || 1e9);
    } else {
      ui.recordTotal.textContent = "/ 0";
      ui.pager.hidden = true;
    }
    const id = state.header && state.source ? stemOf(state.source.name) : "";
    const fam = id && g.DBF_DICT ? g.DBF_DICT.familyOf(state.source.name) : null;
    Host.setTitle(has ? "DBF Studio — " + baseName(state.source ? state.source.name : "") : "DBF Studio");
    void fam;

    const enable = (node, on) => {
      if (node) node.disabled = !on;
    };
    enable($("#saveBtn"), has && !state.readonly && !state.header.hasMemo);
    enable($("#exportBtn"), has);
    enable($("#exportMenuBtn"), has);
    enable($("#printBtn"), has);
    enable($("#addRowBtn"), has && !state.readonly);
    enable($("#delRowBtn"), has && !state.readonly && state.sel.row >= 0);
    enable($("#restoreRowBtn"), has && !state.readonly && state.sel.row >= 0 && state.rows[state.sel.row] && state.rows[state.sel.row].del);
    enable($("#commitBtn"), has && !state.readonly);
    enable($("#addFieldBtn"), has && !state.readonly && !state.header.hasMemo);
    $("#saveBtn").classList.toggle("dirty", state.dirty);
    ui.stDirty.textContent = state.dirty ? T("status.dirty") : "";
    const connected = !!(state.conn && state.source && state.source.connectionId);
    if (has) {
      ui.fileName.title = connected
        ? (state.conn.info.path || connTitle()) + " — " + T("conn.hint")
        : state.source ? state.source.path || state.source.name : "";
    }
    ui.stTrace.textContent = connected
      ? T("status.connection", { name: connTitle() })
      : state.readonly
        ? T("status.readonly")
        : state.sample
          ? T("status.sample")
          : "";
    ui.stTrace.title = connected
      ? (state.conn.info.path || "") + (state.readonly ? " — " + T("conn.readonly") : "")
      : "";
  }

  function colWidth(f) {
    if (state.view.widths[f.name]) return state.view.widths[f.name];
    const guess = Math.max(64, Math.min(240, (f.length || 10) * 8 + 26));
    if (f.kind === "number" || f.kind === "currency") return Math.max(74, Math.min(160, guess));
    if (f.kind === "date") return 104;
    if (f.kind === "logical") return 72;
    return guess;
  }

  function renderGrid() {
    if (!state.header) {
      ui.gridHead.innerHTML = "";
      ui.gridBody.innerHTML = "";
      return;
    }
    const fields = visibleFields();
    const dict = g.DBF_DICT;
    const file = state.source ? state.source.name : "";

    const headRow = el("tr");
    headRow.appendChild(el("th", { class: "rownum", text: "#" }));
    for (const f of fields) {
      const th = el("th", { class: "sortable", style: "width:" + colWidth(f) + "px" });
      th.dataset.field = f.name;
      const inner = el("div", { class: "th-inner" });
      const box = el("div", { style: "min-width:0;display:flex;flex-direction:column;gap:1px" });
      const nameRow = el("div", { style: "display:flex;align-items:center;gap:4px" });
      nameRow.appendChild(el("span", { class: "th-name", text: f.name }));
      nameRow.appendChild(el("span", { class: "th-type", text: f.type + (f.decimals ? "," + f.decimals : "") }));
      if (state.view.sort.col === f.index && state.view.sort.dir) {
        nameRow.appendChild(el("span", { class: "sort-mark", text: state.view.sort.dir > 0 ? "▲" : "▼" }));
      }
      box.appendChild(nameRow);
      if (dict) {
        const d = dict.describeField(file, f.name);
        if (d.cn) {
          const cn = el("span", { class: "th-cn", text: d.cn });
          if (d.confidence === "inferred") cn.title = T("field.inferred");
          box.appendChild(cn);
        }
      }
      inner.appendChild(box);
      const menuBtn = el("button", { class: "col-menu", type: "button", title: T("col.settings") });
      menuBtn.appendChild(icon("more"));
      menuBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        openColumnMenu(ev.currentTarget, f);
      });
      inner.appendChild(menuBtn);
      th.appendChild(inner);
      const grip = el("div", { class: "col-resize" });
      grip.addEventListener("mousedown", (ev) => startResize(ev, f));
      th.appendChild(grip);
      th.addEventListener("click", () => {
        const s = state.view.sort;
        if (s.col !== f.index) state.view.sort = { col: f.index, dir: 1 };
        else if (s.dir === 1) state.view.sort = { col: f.index, dir: -1 };
        else state.view.sort = { col: -1, dir: 0 };
        renderGrid();
      });
      headRow.appendChild(th);
    }
    ui.gridHead.replaceChildren(headRow);

    const body = document.createDocumentFragment();
    const rows = pageRows();
    for (const idx of rows) {
      const row = state.rows[idx];
      const tr = el("tr", { dataset: { row: String(idx) } });
      if (idx === state.sel.row) tr.classList.add("is-selected");
      if (row.del) tr.classList.add("is-deleted");
      tr.appendChild(el("td", { class: "rownum", text: String(idx + 1) }));
      for (const f of fields) {
        const v = row.v[f.index];
        const td = el("td", {});
        td.dataset.col = String(f.index);
        if (f.kind === "number" || f.kind === "integer" || f.kind === "currency") td.classList.add("num");
        if (v === "" || v === null || v === undefined) td.classList.add("empty-val");
        setCellText(td, v, f);
        if (idx === state.sel.row && f.index === state.sel.col) td.classList.add("is-active-cell");
        tr.appendChild(td);
      }
      tr.addEventListener("mousedown", (ev) => {
        const td = ev.target.closest("td");
        const col = td && td.dataset.col != null ? Number(td.dataset.col) : state.sel.col;
        selectCell(idx, col);
      });
      tr.addEventListener("dblclick", (ev) => {
        const td = ev.target.closest("td");
        if (!td || td.classList.contains("rownum")) return;
        beginEdit(td, idx, Number(td.dataset.col));
      });
      body.appendChild(tr);
    }
    ui.gridBody.replaceChildren(body);
    renderPager();
  }

  function setCellText(td, v, f) {
    const s = v === "" || v === null || v === undefined ? (f.kind === "logical" ? "" : "") : String(v);
    if (f.kind === "memo" && s) {
      td.textContent = "¶ " + s;
      td.title = T("panel.memo");
      return;
    }
    if (f.kind === "binary" && s) {
      td.textContent = "◘ " + s;
      return;
    }
    td.textContent = s;
    if (f.kind === "date" && s) td.textContent = s;
  }

  function renderPager() {
    const total = viewIndices().length;
    if (!total) {
      ui.pager.hidden = true;
      return;
    }
    ui.pager.hidden = total <= Math.min(200, pageSize() || 1e9);
    ui.pagerInfo.textContent = T("status.page", { page: state.view.page + 1, total: pageCount() }) + " · " + total;
  }

  function renderSidebar() {
    if (!state.header) {
      ui.fieldList.replaceChildren();
      ui.infoList.replaceChildren();
      ui.infoNote.hidden = true;
      return;
    }
    const dict = g.DBF_DICT;
    const file = state.source ? state.source.name : "";
    const frag = document.createDocumentFragment();
    for (const f of state.header.fields) {
      const li = el("li", { class: "field-item", dataset: { field: f.name } });
      if (state.view.hidden.has(f.name)) li.classList.add("is-hidden");
      if (f.index === state.sel.col) li.classList.add("is-selected");
      const dot = el("span", { class: "field-dot" });
      dot.style.background = typeColor(f.type);
      li.appendChild(dot);
      const body = el("div", { class: "field-body" });
      body.appendChild(el("span", { class: "field-name", text: f.name }));
      const d = dict ? dict.describeField(file, f.name) : { cn: "" };
      let cnText = d.cn;
      if (!cnText && d.prefix) cnText = d.prefix + "（" + T("field.dictMissing") + "）";
      if (!cnText && state.notes[f.name]) cnText = state.notes[f.name];
      if (!cnText) cnText = T("field.dictMissing");
      const cn = el("span", { class: "field-cn" + (d.cn ? "" : " missing"), text: cnText });
      if (d.cn && d.confidence === "custom") cn.appendChild(el("span", { class: "custom", text: T("field.custom") }));
      if (d.cn && d.confidence === "inferred") cn.appendChild(el("span", { class: "inferred", text: T("field.inferred") }));
      cn.title = d.hint || d.source || "";
      body.appendChild(cn);
      li.appendChild(body);
      li.appendChild(el("span", { class: "field-meta", text: f.type + f.length + (f.decimals ? "," + f.decimals : "") }));
      li.addEventListener("click", () => {
        selectCell(state.sel.row, f.index);
        if (state.view.hidden.has(f.name)) toggleColumn(f.name, true);
      });
      li.addEventListener("dblclick", () => openFieldDialog(f));
      frag.appendChild(li);
    }
    ui.fieldList.replaceChildren(frag);
    renderInfo();
  }

  function typeColor(t) {
    return {
      C: "#3b82f6",
      N: "#8b5cf6",
      F: "#a78bfa",
      D: "#0ea5e9",
      L: "#22c55e",
      M: "#f59e0b",
      B: "#ef4444",
      G: "#ec4899",
      P: "#ec4899",
      I: "#06b6d4",
      T: "#14b8a6",
      Y: "#eab308",
    }[t] || "var(--fg-muted)";
  }

  /* “前缀_YYYYMMDD.dbf” 命名的接口文件：取其中的数据日期 */
  function interfaceDate(name) {
    const base = String(name || "").replace(/\.[^.]+$/, "");
    const m = /^(.*?)[_\-#](\d{8})$/i.exec(base);
    if (!m) return null;
    const ymd = m[2];
    if (!DBF.isValidDate(+ymd.slice(0, 4), +ymd.slice(4, 6), +ymd.slice(6, 8))) return null;
    return { prefix: m[1], ymd };
  }

  function renderInfo() {
    const h = state.header;
    if (!h) return;
    const dict = g.DBF_DICT;
    const file = state.source ? state.source.name : "";
    const fam = dict ? dict.familyOf(file) : null;
    const idate = interfaceDate(file);
    let described = 0;
    for (const f of h.fields) if (dict && dict.describeField(file, f.name).cn) described += 1;

    const rows = [
      ["info.version", h.versionName + " (0x" + h.version.toString(16).padStart(2, "0") + ")"],
      ["info.records", String(h.recordCount) + " / " + String(state.rows.length)],
      ["info.deleted", String(state.rows.filter((r) => r.del).length)],
      ["info.fields", String(h.fields.length)],
      ["info.headerLength", String(h.headerLength)],
      ["info.recordLength", String(h.recordLength)],
      [
        "info.ldid",
        h.ldid
          ? "0x" + h.ldid.toString(16).padStart(2, "0") + " · " + (h.ldidLabel || "—")
          : "0x00 · " + T("info.ldidAuto"),
      ],
      ["info.encoding", state.encoding.toUpperCase()],
      ["info.updated", h.lastUpdate && h.lastUpdate.y ? fmtYmd(h.lastUpdate) : "—"],
      ["info.dataDate", idate ? fmtYmd({ y: +idate.ymd.slice(0, 4), m: +idate.ymd.slice(4, 6), d: +idate.ymd.slice(6, 8) }) + " · " + idate.prefix : "—"],
      ["info.memo", h.hasMemo ? h.memoExt.toUpperCase() + (state.memo.name ? "" : " · " + T("common.none")) : T("common.none")],
      ["info.layout", h.layoutValid ? T("info.layoutOk") : T("info.layoutBad")],
      ["info.dictCoverage", described + " / " + h.fields.length],
      ["info.size", state.buf ? fmtBytes(state.buf.length) : "—"],
      ["info.family", fam ? fam.label : T("common.none")],
      ["info.spec", fam ? fam.spec : "—"],
      ["info.path", state.source ? state.source.path || state.source.name : "—"],
    ];
    const frag = document.createDocumentFragment();
    for (const [key, val] of rows) {
      const row = el("div", { class: "info-row" });
      row.appendChild(el("dt", { text: T(key) }));
      row.appendChild(el("dd", { text: val }));
      frag.appendChild(row);
    }
    ui.infoList.replaceChildren(frag);

    const missing = [];
    if (!h.layoutValid) missing.push(T("info.layoutBad"));
    if (h.hasMemo && !state.memo.name) missing.push(T("dlg.memo.missing", { ext: h.memoExt.toUpperCase() }));
    if (fam && fam.spec.indexOf("推断") >= 0) missing.push(fam.spec);
    ui.infoNote.hidden = !missing.length;
    ui.infoNote.textContent = missing.join("；");
  }

  function renderDetail() {
    if (!state.header || state.sel.row < 0 || !state.rows[state.sel.row]) {
      ui.recordForm.replaceChildren();
      ui.detailEmpty.hidden = false;
      ui.detailEmpty.textContent = state.header ? T("msg.noRecordSel") : "—";
      ui.memoBox.replaceChildren();
      return;
    }
    ui.detailEmpty.hidden = true;
    const row = state.rows[state.sel.row];
    const dict = g.DBF_DICT;
    const file = state.source ? state.source.name : "";
    const frag = document.createDocumentFragment();
    for (const f of state.header.fields) {
      const v = row.v[f.index];
      const d = dict ? dict.describeField(file, f.name) : { cn: "" };
      const wrap = el("div", { class: "rec-row" });
      if (state.sel.col === f.index) wrap.classList.add("is-sel");
      const empty = v === "" || v === null || v === undefined;
      const head = el("div", { class: "rec-head" });
      head.appendChild(el("span", { class: "rec-name", text: f.name, title: f.name }));
      if (d.cn) head.appendChild(el("span", { class: "rec-cn", text: d.cn, title: d.cn }));
      const tools = el("span", { class: "rec-tools" });
      if (f.kind === "memo" && !empty) {
        const btn = el("button", { class: "rec-action", type: "button", text: T("panel.memo") });
        btn.addEventListener("click", () => showMemo(f, v));
        tools.appendChild(btn);
      }
      if ((f.kind === "binary" || f.kind === "memo") && !empty) {
        const btn = el("button", { class: "rec-action", type: "button", text: T("panel.binary") });
        btn.addEventListener("click", () => showBinary(f, v));
        tools.appendChild(btn);
      }
      const cp = el("button", { class: "rec-action", type: "button", text: T("common.copy"), title: T("common.copy") });
      cp.addEventListener("click", async () => {
        const ok = await Host.copy(empty ? "" : String(v));
        if (ok) toast(T("common.copied"), "ok");
      });
      tools.appendChild(cp);
      head.appendChild(tools);
      wrap.appendChild(head);
      const val = el("div", { class: "rec-val" });
      val.textContent = empty ? T("common.empty") : v;
      if (empty) val.classList.add("empty-val");
      wrap.appendChild(val);
      const hint = !empty && dict && dict.describeValue ? dict.describeValue(f.name, v) : "";
      if (hint) wrap.appendChild(el("div", { class: "rec-hint", text: hint }));
      frag.appendChild(wrap);
    }
    ui.recordForm.replaceChildren(frag);
    renderMemoPane();
  }

  function renderStatus() {
    if (!state.header) {
      ui.stRows.textContent = T("status.rows", { n: 0 });
      ui.stCols.textContent = T("status.cols", { n: 0 });
      ui.stSel.textContent = "";
      ui.stIssues.textContent = "";
      ui.stEncoding.textContent = "";
      return;
    }
    const visible = viewIndices().length;
    ui.stRows.textContent = T("status.rows", { n: visible }) + (visible !== state.rows.length ? " / " + state.rows.length : "");
    ui.stCols.textContent = T("status.cols", { n: visibleFields().length }) + " / " + state.header.fields.length;
    if (state.sel.row >= 0 && state.rows[state.sel.row]) {
      const f = state.header.fields[state.sel.col];
      ui.stSel.textContent = T("status.selected", { row: state.sel.row + 1, field: f ? f.name : "—" });
    } else {
      ui.stSel.textContent = "";
    }
    if (state.issues.length) {
      ui.stIssues.textContent = T("status.issues", { n: state.issues.length });
      ui.stIssues.className = "status-item badge-warn";
    } else {
      ui.stIssues.textContent = T("status.noIssues");
      ui.stIssues.className = "status-item badge-ok";
    }
    const encName = state.encoding === "gbk" ? "GBK" : state.encoding.toUpperCase();
    ui.stEncoding.textContent = state.manualEncoding ? encName + " · " + T("enc.manual") : encName;
  }

  function renderIssues() {
    if (!state.header) {
      ui.issueList.replaceChildren();
      return;
    }
    if (!state.issues.length) {
      const box = el("li", { class: "issue-empty" });
      box.appendChild(icon("check"));
      box.appendChild(el("span", { text: T("status.noIssues") }));
      ui.issueList.replaceChildren(box);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const is of state.issues.slice(0, 300)) {
      const li = el("li", { class: "issue-item" });
      li.appendChild(icon("warn"));
      const body = el("div", {});
      body.appendChild(el("b", { text: String(is.row + 1) + " · " + is.field }));
      let msg = is.problem;
      if (is.code) {
        const k = T("val." + is.code, { n: is.limit });
        if (k && k.indexOf("val.") !== 0) msg = k;
      }
      body.appendChild(el("span", { class: "issue-msg", text: msg }));
      if (is.value) body.appendChild(el("code", { class: "issue-val", text: is.value }));
      li.appendChild(body);
      li.addEventListener("click", () => {
        selectCell(is.row, is.fieldIndex);
        revealRow(is.row);
      });
      frag.appendChild(li);
    }
    ui.issueList.replaceChildren(frag);
  }

  function renderMemoPane() {
    ui.memoBox.replaceChildren();
    if (!state.header) return;
    if (state.header.hasMemo && !state.memo.name) {
      const note = el("div", { class: "memo-meta", text: T("dlg.memo.missing", { ext: state.header.memoExt.toUpperCase() }) });
      const btn = el("button", { class: "btn tiny", type: "button", text: T("dlg.memo.load") });
      btn.addEventListener("click", loadMemoFile);
      ui.memoBox.appendChild(note);
      ui.memoBox.appendChild(btn);
      return;
    }
    if (!state.sel.row || !state.rows[state.sel.row]) return;
    const row = state.rows[state.sel.row];
    const f = state.header.fields[state.sel.col];
    if (!f) return;
    const v = row.v[f.index];
    if (f.kind === "memo" && v) {
      state.memo.cache.get(v) ? renderMemoText(state.memo.cache.get(v)) : loadMemoInto(f, v);
    }
  }

  function renderMemoText(text) {
    const ta = el("textarea", { class: "memo-text", spellcheck: "false" });
    ta.value = text;
    const meta = el("div", { class: "memo-meta", text: text.length + " chars" });
    const actions = el("div", { class: "memo-actions" });
    const copyBtn = el("button", { class: "btn tiny", type: "button", text: T("common.copy") });
    copyBtn.addEventListener("click", async () => {
      if (await Host.copy(ta.value)) toast(T("common.copied"), "ok");
    });
    actions.appendChild(copyBtn);
    ui.memoBox.replaceChildren(meta, ta, actions);
  }

  /* ------------------------------------------------------------- selection */

  function selectCell(row, col) {
    state.sel.row = row;
    state.sel.col = col;
    if (state.header) {
      const list = pageRows();
      const at = list.indexOf(row);
      if (at < 0) {
        const all = viewIndices();
        const pos = all.indexOf(row);
        if (pos >= 0 && pageSize()) state.view.page = Math.floor(pos / pageSize());
        renderGrid();
      } else {
        $$("#gridBody tr").forEach((tr) => {
          tr.classList.toggle("is-selected", Number(tr.dataset.row) === row);
          $$("td", tr).forEach((td) => td.classList.toggle("is-active-cell", Number(td.dataset.col) === col && Number(tr.dataset.row) === row));
        });
      }
    }
    renderChrome();
    renderSidebar();
    renderDetail();
    renderStatus();
    scrollToSelected();
  }

  function scrollToSelected() {
    const tr = $("#gridBody tr.is-selected");
    if (!tr) return;
    const box = ui.gridScroll;
    const top = tr.offsetTop;
    const bottom = top + tr.offsetHeight;
    if (top < box.scrollTop + 30) box.scrollTop = Math.max(0, top - 34);
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 4;
  }

  function revealRow(row) {
    if (!state.header) return;
    const all = viewIndices();
    const pos = all.indexOf(row);
    if (pos < 0) return;
    if (pageSize()) state.view.page = Math.floor(pos / pageSize());
    renderGrid();
    scrollToSelected();
  }

  function beginEdit(td, rowIdx, colIdx) {
    if (state.readonly) {
      toast(T("msg.readOnly"), "warn");
      return;
    }
    const f = state.header.fields[colIdx];
    if (!f) return;
    if (f.kind === "memo" || f.kind === "binary") {
      selectCell(rowIdx, colIdx);
      const v = state.rows[rowIdx].v[colIdx];
      if (f.kind === "memo") showMemo(f, v);
      return;
    }
    if (td.querySelector("input")) return;
    const prev = state.rows[rowIdx].v[colIdx] || "";
    const input = el("input", { type: "text", value: prev, spellcheck: "false" });
    input.style.width = "100%";
    td.classList.add("editing");
    td.textContent = "";
    td.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const next = input.value;
      td.classList.remove("editing");
      if (commit && next !== prev) {
        const err = validateCell(f, next);
        if (err) {
          toast(err, "err");
          setCellText(td, prev, f);
          return;
        }
        state.rows[rowIdx].v[colIdx] = next;
        state.dirty = true;
      }
      setCellText(td, state.rows[rowIdx].v[colIdx], f);
      if (commit) {
        renderDetail();
        renderChrome();
        scheduleValidate();
      }
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        finish(true);
        const next = (colIdx + 1) % state.header.fields.length;
        selectCell(rowIdx, next);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  function validateCell(f, value) {
    const v = String(value == null ? "" : value);
    if (f.kind === "number") {
      if (v.trim() && !/^-?\d+(\.\d+)?$/.test(v.trim().replace(/,/g, ""))) return T("dlg.field.invalidLength");
      if (v.trim().length > f.length) return T("dlg.field.invalidLength") + " (" + f.length + ")";
      if (f.decimals && v.indexOf(".") >= 0 && (v.split(".")[1] || "").length > f.decimals) return T("dlg.field.invalidLength");
    }
    if (f.kind === "date" && v.trim()) {
      const p = DBF.dateToYmd(v);
      if (!p) return "YYYYMMDD";
    }
    if (f.kind === "logical" && v.trim()) {
      const u = v.trim().toUpperCase();
      if (u !== "T" && u !== "F" && u !== "?") return "T/F";
    }
    if (f.kind === "text" || f.kind === "memo") {
      try {
        const len = DBF.encodeText(v, state.encoding).length;
        if (len > f.length && f.kind === "text") return T("field.length") + " " + f.length + " (" + len + ")";
      } catch (e) {
        /* ignore */
      }
    }
    return "";
  }

  const scheduleValidate = debounce(() => {
    if (!state.header) return;
    const table = tableOf(state.rows);
    const res = DBF.validateTable(table, { maxIssues: 300, limit: 50000 });
    state.issues = res.issues.slice(0, 300).map((x) => {
      const idx = state.rows.indexOf(x.row);
      return { row: idx < 0 ? 0 : idx, field: x.field, fieldIndex: x.fieldIndex, value: x.value, problem: x.problem, code: x.code || "", limit: x.limit };
    });
    renderIssues();
    renderStatus();
  }, 260);

  /* ------------------------------------------------------------ file loading */

  function loadingBar(on) {
    let bar = $(".loading-bar");
    if (!bar) {
      bar = el("div", { class: "loading-bar" });
      ui.app.appendChild(bar);
    }
    bar.style.width = on ? "40%" : "100%";
    if (!on) setTimeout(() => { bar.style.width = "0"; }, 220);
  }

  async function readRange(src, offset, length) {
    const res = await src.read(offset, length);
    const bytes = res.bytes || res;
    return { bytes, eof: !!(res && res.eof) };
  }

  async function readAll(src, onProgress) {
    const parts = [];
    let offset = 0;
    const CHUNK = 4 * 1024 * 1024;
    const size = typeof src.size === "number" && src.size > 0 ? src.size : null;
    for (let guard = 0; guard < 4096; guard += 1) {
      const want = size ? Math.min(CHUNK, size - offset) : CHUNK;
      if (size && want <= 0) break;
      const { bytes, eof } = await readRange(src, offset, want);
      if (!bytes || !bytes.length) break;
      parts.push(bytes);
      offset += bytes.length;
      if (onProgress) onProgress(offset, size);
      if (size && offset >= size) break;
      if (!size && (eof || bytes.length < want)) break;
      if (eof && bytes.length < want) break;
    }
    return concat(parts);
  }

  async function openSources(sources) {
    if (!sources || !sources.length) return;
    loadingBar(true);
    state.busy = true;
    try {
      const dbfs = [];
      const memos = [];
      for (const s of sources) {
        const ext = extOf(s.name);
        if (ext === "dbf") dbfs.push(s);
        else if (ext === "dbt" || ext === "fpt") memos.push(s);
      }
      if (!dbfs.length) {
        if (memos.length && state.header && state.header.hasMemo) {
          await attachMemo(memos[0]);
          return;
        }
        toast(T("msg.unsupported", { name: sources[0].name }), "err");
        return;
      }
      const target = dbfs[0];
      const buf = await readAll(target, (at, total) => {
        const bar = $(".loading-bar");
        if (bar && total) bar.style.width = Math.max(6, Math.round((at / total) * 92)) + "%";
      });
      const header0 = DBF.parseHeader(buf);
      const recSample = buf.subarray(header0.headerLength, Math.min(buf.length, header0.headerLength + header0.recordLength * 64));
      const auto = DBF.detectEncoding(header0, recSample);
      const pick = pickEncoding(header0, auto, target.name);
      loadTable(target, buf, header0, pick.enc, auto.encoding, pick.manual);

      if (header0.hasMemo) {
        const stem = stemOf(target.name);
        const match = memos.find((m) => stemOf(m.name) === stem) || memos[0];
        if (match) await attachMemo(match);
      }
      state.files = dbfs.slice(1).map((s) => s.name);
      toast(T("msg.opened", { name: baseName(target.name) }), "ok");
    } catch (err) {
      console.error(err);
      toast(T("msg.parseError", { err: err && err.message ? err.message : String(err) }), "err");
    } finally {
      state.busy = false;
      loadingBar(false);
      renderAll();
    }
  }

  /**
   * Decide the encoding for a freshly parsed table.
   * `auto` is either a DBF.detectEncoding() result or a plain encoding id.
   * Priority: strictly-valid UTF-8 content > language driver > file family > name hint.
   */
  function chooseEncoding(header, auto, name) {
    const autoEnc = auto && typeof auto === "object" ? auto.encoding : auto;
    const fam = g.DBF_DICT ? g.DBF_DICT.familyOf(name) : null;
    if (autoEnc === "utf-8") return "utf-8"; // content proved to be UTF-8, ldid often lies
    if (header.ldidEncoding) return DBF.normEncoding(header.ldidEncoding);
    if (fam) return "gbk"; // Chinese exchange files: default to GBK even when ASCII-only
    if (/[\u4e00-\u9fff]/.test(String(name))) return "gbk";
    return autoEnc || "gbk";
  }

  /** manual encoding remembered for this file name, if any */
  function rememberedEncoding(name) {
    const map = state.prefs.encodings || null;
    const hit = map && name ? map[name] : "";
    return hit ? DBF.normEncoding(hit) : "";
  }

  /** resolve {enc, manual} for an opened table */
  function pickEncoding(header, auto, name) {
    const remembered = rememberedEncoding(name);
    if (remembered) return { enc: remembered, manual: true };
    const autoEnc = auto && typeof auto === "object" ? auto.encoding : auto;
    return { enc: chooseEncoding(header, auto, name), manual: false, autoEnc };
  }

  function loadTable(src, buf, header, enc, autoEnc, manual) {
    const decoded = decodeRows(buf, header, enc);
    state.source = src;
    state.sources = [src];
    state.buf = buf;
    state.header = header;
    state.encoding = enc;
    state.autoEncoding = autoEnc || enc;
    state.manualEncoding = manual ? enc : "";
    state.rows = decoded.rows;
    state.view = { hidden: new Set(), widths: {}, sort: { col: -1, dir: 0 }, filter: "", page: 0 };
    state.sel = { row: decoded.rows.length ? 0 : -1, col: 0 };
    state.dirty = false;
    state.readonly = false;
    state.sample = "";
    state.memo = { reader: null, kind: "", name: "", buffer: null, cache: new Map() };
    state.issues = [];
    state.notes = (state.prefs.notes && state.prefs.notes[stemOf(src.name)]) || {};
    ui.searchInput.value = "";
    ui.filterInput.value = "";
    ui.filterClear.hidden = true;
    ui.showDeleted.checked = !!state.prefs.showDeleted;
    state.search = { term: "", field: -1, hits: [], at: -1 };
    filterCache.key = "";
    fillSearchFields();
    state.view.widths = autoWidths(header, decoded.rows);
    scheduleValidate();
    if (manual) toast(T("enc.restored", { enc: state.encoding === "gbk" ? "GBK" : state.encoding.toUpperCase() }), "");
  }

  /** first-load column widths from the actual data (users can still resize) */
  function autoWidths(header, rows) {
    const out = {};
    const sample = rows.slice(0, 150);
    for (const f of header.fields) {
      if (f.kind === "memo" || f.kind === "binary") {
        out[f.name] = 128;
        continue;
      }
      let units = f.name.length + (f.decimals ? 3 : 2);
      for (const r of sample) {
        const v = String(r.v[f.index] == null ? "" : r.v[f.index]);
        let w = 0;
        for (const ch of v) w += ch.charCodeAt(0) > 255 ? 2 : 1;
        if (w > units) units = w;
      }
      const px = Math.round(units * 7.1) + 22;
      const max = f.kind === "text" ? 208 : 148;
      out[f.name] = Math.max(60, Math.min(max, px));
    }
    return out;
  }

  function decodeRows(buf, header, enc) {
    const rows = [];
    const recLen = header.recordLength;
    const maxRows = Math.min(header.recordCount, Math.floor((buf.length - header.headerLength) / recLen));
    for (let i = 0; i < maxRows; i += 1) {
      const at = header.headerLength + i * recLen;
      if (at + recLen > buf.length) break;
      const del = buf[at] === 0x2a;
      const v = new Array(header.fields.length);
      for (let fi = 0; fi < header.fields.length; fi += 1) {
        const f = header.fields[fi];
        const start = at + f.offset;
        const bytes = buf.subarray(start, start + f.length);
        v[fi] = f.kind === "memo" ? (DBF.memoPointer(f, bytes) ? String(DBF.memoPointer(f, bytes)) : "") : DBF.rawToDisplay(f, bytes, enc);
      }
      rows.push({ v, del });
    }
    return { rows };
  }

  async function attachMemo(src) {
    if (!state.header || !state.header.hasMemo) return;
    try {
      const buf = await readAll(src);
      const kind = state.header.memoExt === "fpt" ? "fpt" : "dbt";
      const reader = DBF.createMemoReader(kind, async (offset, length) => {
        const start = Math.max(0, offset);
        const end = Math.min(buf.length, start + length);
        return buf.subarray(start, end);
      });
      await reader.init();
      state.memo = { reader, kind, name: src.name, buffer: buf, cache: new Map() };
      if (!state.sources.includes(src)) state.sources.push(src);
      toast(T("msg.memoOk", { name: baseName(src.name) }), "ok");
      renderAll();
    } catch (err) {
      toast(T("msg.parseError", { err: String(err && err.message ? err.message : err) }), "err");
    }
  }

  async function loadMemoFile() {
    const picked = await Host.pick(false);
    if (picked && picked.length) await attachMemo(picked[0]);
  }

  async function loadMemoInto(field, pointer) {
    if (!state.memo.reader) return;
    ui.memoBox.replaceChildren(el("div", { class: "memo-meta", text: T("app.loading") }));
    try {
      const text = await state.memo.reader.read(Number(pointer) || 0);
      state.memo.cache.set(String(pointer), text);
      renderMemoText(text);
    } catch (err) {
      ui.memoBox.replaceChildren(el("div", { class: "memo-meta", text: String(err.message || err) }));
    }
    void field;
  }

  function showMemo(field, pointer) {
    if (!pointer) {
      toast(T("common.empty"), "warn");
      return;
    }
    if (!state.memo.reader) {
      toast(T("dlg.memo.missing", { ext: state.header.memoExt.toUpperCase() }), "warn");
      loadMemoFile();
      return;
    }
    const cached = state.memo.cache.get(String(pointer));
    if (cached != null) {
      openMemoDialog(field, cached);
      return;
    }
    state.memo.reader.read(Number(pointer)).then((text) => {
      state.memo.cache.set(String(pointer), text);
      openMemoDialog(field, text);
    });
  }

  function openMemoDialog(field, text) {
    const ta = el("textarea", { class: "textarea", spellcheck: "false" });
    ta.value = text;
    App.modal({
      title: T("dlg.memo.title") + " · " + field.name,
      body: ta,
      actions: [
        { label: T("common.cancel") },
        {
          label: T("common.ok"),
          primary: true,
          onClick: () => {
            state.memo.cache.set(String(state.rows[state.sel.row].v[field.index]), ta.value);
            state.dirty = true;
            renderDetail();
          },
        },
      ],
    });
  }

  function showBinary(field, pointer) {
    const n = Number(pointer) || 0;
    const body = el("div", {});
    const hex = el("div", { class: "hex-view", text: "—" });
    body.appendChild(hex);
    if (!state.memo.reader) {
      body.appendChild(el("div", { class: "memo-meta", text: T("dlg.memo.missing", { ext: (state.header.memoExt || "dbt").toUpperCase() }) }));
      App.modal({ title: T("dlg.binary.title") + " · " + field.name, body, actions: [{ label: T("dlg.memo.load"), onClick: loadMemoFile }, { label: T("common.close") }] });
      return;
    }
    state.memo.reader.read(n).then((text) => {
      const raw = [];
      for (let i = 0; i < text.length; i += 1) raw.push(text.charCodeAt(i) & 0xff);
      const lines = [];
      for (let i = 0; i < raw.length; i += 16) {
        const slice = raw.slice(i, i + 16);
        const hexPart = slice.map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
        const ascii = slice.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
        lines.push(i.toString(16).padStart(6, "0") + "  " + hexPart + "  " + ascii);
      }
      hex.textContent = lines.join("\n") || T("common.empty");
    });
    App.modal({ title: T("dlg.binary.title") + " · " + field.name, body, wide: true, actions: [{ label: T("common.close") }] });
  }

  /* ------------------------------------------------------------ save / export */

  async function saveTable(asName) {
    if (!state.header) return;
    if (state.readonly) {
      toast(T("msg.readOnly"), "warn");
      return;
    }
    if (state.header.hasMemo) {
      toast(T("dlg.memo.missing", { ext: state.header.memoExt.toUpperCase() }), "warn");
      return;
    }
    const inPlace = !asName && !!(state.source && state.source.connectionId);
    const name = asName ? await App.askFileName(state.source ? baseName(state.source.name) : "table.dbf") : baseName(state.source ? state.source.name : "table.dbf");
    if (!name) return;
    try {
      loadingBar(true);
      ui.stDirty.textContent = T("status.saving");
      const out = DBF.buildDbf({
        fields: state.header.fields,
        rows: state.rows.map((r) => r.v),
        deleted: state.rows.map((r) => r.del),
        encoding: state.encoding,
        ldid: DBF.encodingLdid(state.encoding),
        version: state.header.version,
      });
      if (inPlace) {
        const res = await writeBack(out.bytes, name);
        state.dirty = false;
        state.buf = out.bytes;
        state.source = Object.assign({}, state.source, { size: out.bytes.length });
        const backup = res && res.backup ? baseName(res.backup) : "";
        toast(backup ? T("msg.saveBackup", { name, backup }) : T("msg.saveOk", { name }), "ok");
        renderChrome();
        return;
      }
      const ok = await Host.save(name, out.bytes, "application/x-dbf");
      if (ok) {
        state.dirty = false;
        toast(T("msg.saveOk", { name }), "ok");
        if (asName && state.source) {
          state.source = Object.assign({}, state.source, { name, path: name });
        }
        renderChrome();
      } else {
        toast(T("msg.saveFail", { err: "cancelled" }), "warn");
      }
    } catch (err) {
      toast(T("msg.saveFail", { err: String(err.message || err) }), "err");
    } finally {
      loadingBar(false);
      renderChrome();
    }
  }

  function exportTable(opts) {
    if (!state.header) {
      toast(T("msg.pickFirst"), "warn");
      return;
    }
    const fields = visibleFields();
    const indices = opts.rows || viewIndices();
    const rows = indices.map((i) => state.rows[i]);
    const view = tableOf(rows, fields);
    const base = stemOf(state.source ? state.source.name : "table") || "TABLE";
    const format = opts.format;
    let bytes;
    let name = opts.filename || base + "." + (format === "xlsx" ? "xml" : format === "markdown" ? "md" : format);
    const exportOpts = {
      rows,
      includeDeleted: !!opts.includeDeleted,
      header: opts.header !== false,
    };
    switch (format) {
      case "csv":
        bytes = DBF.toCsv(view, Object.assign({ separator: opts.delimiter || ",", encoding: opts.encoding || "utf-8", bom: !!opts.bom }, exportOpts));
        break;
      case "json":
        bytes = DBF.toJson(view, Object.assign({ pretty: true }, exportOpts));
        break;
      case "sql":
        bytes = DBF.toSql(view, Object.assign({ table: base.toLowerCase(), dialect: opts.dialect || "standard" }, exportOpts));
        break;
      case "html":
        bytes = DBF.toHtml(view, Object.assign({ title: base }, exportOpts));
        break;
      case "markdown":
        bytes = DBF.toMarkdown(view, exportOpts);
        break;
      case "xlsx":
        bytes = DBF.toSpreadsheetXml(view, Object.assign({ title: base }, exportOpts));
        break;
      case "dbf": {
        const out = DBF.buildDbf({
          fields: fields,
          rows: rows.map((r) => r.v),
          deleted: rows.map((r) => r.del),
          encoding: opts.encoding || state.encoding,
        });
        bytes = out.bytes;
        name = opts.filename || base + ".dbf";
        break;
      }
      case "txt": {
        const list = [];
        for (const r of rows) {
          list.push(fields.map((f) => String(r.v[f.index] || "").padEnd(f.length, " ")).join(""));
        }
        bytes = DBF.encodeText(list.join("\r\n") + "\r\n", opts.encoding || state.encoding);
        break;
      }
      default:
        return;
    }
    Host.save(name, bytes, "application/octet-stream").then((ok) => {
      if (ok) toast(T("msg.exportOk", { name }), "ok");
    });
  }

  /* ------------------------------------------------------------- operations */

  function addRow() {
    if (!state.header) return;
    const v = state.header.fields.map((f) => (f.kind === "logical" ? "F" : ""));
    state.rows.push({ v, del: false });
    state.dirty = true;
    filterCache.key = "";
    const last = state.rows.length - 1;
    const all = viewIndices();
    const pos = all.indexOf(last);
    if (pos >= 0 && pageSize()) state.view.page = Math.floor(pos / pageSize());
    selectCell(last, 0);
    renderGrid();
    scheduleValidate();
  }

  function deleteRow() {
    if (state.sel.row < 0 || !state.rows[state.sel.row]) return;
    const row = state.rows[state.sel.row];
    row.del = !row.del;
    state.dirty = true;
    filterCache.key = "";
    renderAll();
  }

  function toggleColumn(name, show) {
    if (show) state.view.hidden.delete(name);
    else state.view.hidden.add(name);
    renderGrid();
    renderSidebar();
    renderStatus();
  }

  function startResize(ev, field) {
    ev.preventDefault();
    ev.stopPropagation();
    const th = ev.currentTarget.parentElement;
    const startX = ev.clientX;
    const startW = th.getBoundingClientRect().width;
    const move = (e) => {
      const w = Math.max(48, Math.round(startW + (e.clientX - startX)));
      state.view.widths[field.name] = w;
      th.style.width = w + "px";
      const cells = $$("#gridBody td[data-col='" + field.index + "']");
      cells.forEach((c) => (c.style.width = w + "px"));
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      savePrefsDebounced();
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function openColumnMenu(anchor, field) {
    const items = [
      { label: T("field.alter"), icon: "edit", onClick: () => openFieldDialog(field) },
      { label: T("field.drop"), icon: "trash", onClick: () => App.dropField(field) },
      { sep: true },
      { label: T("common.copy"), icon: "copy", onClick: () => copyColumn(field) },
      { label: T("col.jump"), onClick: () => gotoRecordColumn(field) },
      { label: T("col.hideOne"), onClick: () => toggleColumn(field.name, false) },
      { label: T("col.showAllCols"), onClick: () => {
        state.view.hidden.clear();
        renderAll();
      } },
      { sep: true },
      { label: T("col.fit"), onClick: () => fitColumns() },
    ];
    openMenu(anchor, items);
  }

  function gotoRecordColumn(field) {
    state.sel.col = field.index;
    renderGrid();
    renderDetail();
  }

  /** forwards to views.js implementation (loaded after this file) */
  function openFieldDialog(field) {
    if (typeof App.openFieldDialog === "function" && App.openFieldDialog !== openFieldDialog) {
      App.openFieldDialog(field);
    }
  }
  function copyColumn(field) {
    const list = viewIndices().map((i) => state.rows[i].v[field.index]);
    Host.copy(list.join("\n")).then((ok) => ok && toast(T("common.copied"), "ok"));
  }

  function copyRow() {
    if (state.sel.row < 0) return;
    const row = state.rows[state.sel.row];
    Host.copy(row.v.join("\t")).then((ok) => ok && toast(T("common.copied"), "ok"));
  }

  function fitColumns() {
    for (const f of visibleFields()) {
      let max = f.name.length + 4;
      const list = pageRows().slice(0, 200);
      for (const idx of list) {
        const v = String(state.rows[idx].v[f.index] || "");
        let w = 0;
        for (const ch of v) w += ch.charCodeAt(0) > 255 ? 2 : 1;
        if (w > max) max = w;
      }
      state.view.widths[f.name] = Math.max(52, Math.min(360, max * 7 + 22));
    }
    renderGrid();
    savePrefsDebounced();
  }

  function navigate(delta) {
    if (!state.header) return;
    const all = viewIndices();
    if (!all.length) return;
    let pos = all.indexOf(state.sel.row);
    if (pos < 0) pos = 0;
    else pos += delta;
    if (pos < 0) {
      toast(T("msg.navStart"), "warn");
      pos = 0;
    }
    if (pos > all.length - 1) {
      toast(T("msg.navEnd"), "warn");
      pos = all.length - 1;
    }
    selectCell(all[pos], state.sel.col);
  }

  function gotoRecord(n) {
    const all = viewIndices();
    if (!all.length) return;
    const pos = Math.max(0, Math.min(all.length - 1, n - 1));
    selectCell(all[pos], state.sel.col);
  }

  function fillSearchFields() {
    if (!state.header) return;
    const frag = document.createDocumentFragment();
    frag.appendChild(el("option", { value: "-1", text: T("search.all") }));
    for (const f of state.header.fields) frag.appendChild(el("option", { value: String(f.index), text: f.name }));
    ui.searchField.replaceChildren(frag);
  }

  function runSearch() {
    const term = ui.searchInput.value;
    if (!term) {
      toast(T("msg.noSearch"), "warn");
      return;
    }
    const fieldIdx = Number(ui.searchField.value);
    const hits = [];
    const needle = term.toLowerCase();
    for (let i = 0; i < state.rows.length; i += 1) {
      const row = state.rows[i];
      if (row.del && !state.prefs.showDeleted) continue;
      const cols = fieldIdx >= 0 ? [fieldIdx] : row.v.map((_, k) => k);
      for (const c of cols) {
        if (String(row.v[c] || "").toLowerCase().indexOf(needle) >= 0) hits.push({ row: i, col: c });
      }
    }
    state.search = { term, field: fieldIdx, hits, at: hits.length ? 0 : -1 };
    ui.searchHits.textContent = hits.length ? T("search.hits", { n: hits.length }) : T("search.noHit");
    if (hits.length) focusHit(0);
  }

  function focusHit(i) {
    const hit = state.search.hits[i];
    if (!hit) return;
    state.search.at = i;
    revealRow(hit.row);
    selectCell(hit.row, hit.col);
  }

  function nextHit() {
    if (!state.search.hits.length) {
      runSearch();
      return;
    }
    focusHit((state.search.at + 1) % state.search.hits.length);
  }

  /* ------------------------------------------------------------- menu/modal */

  function openMenu(anchor, items) {
    const root = ui.menuRoot;
    root.hidden = false;
    root.replaceChildren();
    const menu = el("div", { class: "menu", role: "menu" });
    for (const item of items) {
      if (item.sep) {
        menu.appendChild(el("div", { class: "menu-sep" }));
        continue;
      }
      if (item.label) {
        menu.appendChild(el("div", { class: "menu-label", text: item.label }));
        continue;
      }
      const btn = el("button", { class: "menu-item" + (item.checked ? " check on" : item.checkable ? " check" : ""), type: "button", role: "menuitem" });
      if (item.icon) btn.appendChild(icon(item.icon));
      btn.appendChild(el("span", { text: item.text || item.title || "" }));
      if (item.hint) btn.appendChild(el("span", { class: "hint", text: item.hint }));
      btn.addEventListener("click", () => {
        closeMenu();
        if (item.onClick) item.onClick();
      });
      menu.appendChild(btn);
    }
    root.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth || 220;
    const mh = menu.offsetHeight || 200;
    let left = Math.min(r.left, window.innerWidth - mw - 8);
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = top + "px";
    anchor.setAttribute("aria-expanded", "true");
    root.onmousedown = (ev) => {
      if (ev.target === root) closeMenu();
    };
  }

  function closeMenu() {
    ui.menuRoot.hidden = true;
    ui.menuRoot.replaceChildren();
    $$("[aria-expanded='true']").forEach((n) => n.setAttribute("aria-expanded", "false"));
  }

  function modal(cfg) {
    const root = ui.modalRoot;
    root.hidden = false;
    root.replaceChildren();
    const box = el("div", { class: "modal" + (cfg.wide ? " wide" : ""), role: "dialog", "aria-modal": "true" });
    const head = el("div", { class: "modal-head" });
    head.appendChild(el("div", { class: "modal-title", text: cfg.title || "" }));
    const closeBtn = el("button", { class: "btn icon-only ghost", type: "button" });
    closeBtn.appendChild(icon("close"));
    closeBtn.addEventListener("click", () => close());
    head.appendChild(closeBtn);
    box.appendChild(head);
    const body = el("div", { class: "modal-body" });
    if (cfg.body) body.appendChild(cfg.body);
    box.appendChild(body);
    if (cfg.actions && cfg.actions.length) {
      const foot = el("div", { class: "modal-foot" });
      for (const a of cfg.actions) {
        const btn = el("button", { class: "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : ""), type: "button", text: a.label });
        btn.addEventListener("click", () => {
          const keep = a.onClick ? a.onClick() : undefined;
          if (keep !== false) close();
        });
        foot.appendChild(btn);
      }
      box.appendChild(foot);
    }
    root.appendChild(box);
    const close = () => {
      root.hidden = true;
      root.replaceChildren();
      if (cfg.onClose) cfg.onClose();
    };
    root.onmousedown = (ev) => {
      if (ev.target === root) close();
    };
    root.onkeydown = (ev) => {
      if (ev.key === "Escape") close();
    };
    setTimeout(() => {
      const first = box.querySelector("input, select, textarea, button.primary");
      if (first) first.focus();
    }, 30);
    return { close, body, box };
  }

  function toast(msg, kind) {
    const node = el("div", { class: "toast " + (kind || "") });
    node.appendChild(icon(kind === "err" ? "warn" : kind === "warn" ? "warn" : "check"));
    node.appendChild(el("span", { text: msg }));
    ui.toasts.appendChild(node);
    setTimeout(() => {
      node.classList.add("leaving");
      setTimeout(() => node.remove(), 220);
    }, kind === "err" ? 5200 : 2600);
  }

  function confirmDialog(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      App.modal({
        title,
        body: el("p", { class: "form-hint", text }),
        actions: [
          { label: T("common.cancel"), onClick: () => resolve(false) },
          { label: okLabel || T("common.ok"), primary: !danger, danger: !!danger, onClick: () => resolve(true) },
        ],
        onClose: () => resolve(false),
      });
    });
  }

  function askFileName(defaultName) {
    return new Promise((resolve) => {
      const input = el("input", { class: "input", value: defaultName, spellcheck: "false" });
      const m = App.modal({
        title: T("dlg.export.filename"),
        body: input,
        actions: [
          { label: T("common.cancel") },
          {
            label: T("common.ok"),
            primary: true,
            onClick: () => {
              resolve(input.value.trim() || defaultName);
            },
          },
        ],
      });
      void m;
    });
  }

  /* --------------------------------------------------------------- prefs */

  const savePrefsDebounced = debounce(() => {
    state.prefs.notes = state.prefs.notes || {};
    if (state.source) {
      state.prefs.notes[stemOf(state.source.name)] = state.notes;
    }
    Host.setStore("prefs", state.prefs);
  }, 600);

  async function loadPrefs() {
    const p = await Host.getStore("prefs");
    if (p && typeof p === "object") state.prefs = Object.assign(state.prefs, p);
    if (state.prefs.notes == null) state.prefs.notes = {};
    if (!state.prefs.columns || typeof state.prefs.columns !== "object") state.prefs.columns = {};
    if (g.DBF_DICT && g.DBF_DICT.setUser) g.DBF_DICT.setUser(state.prefs.columns, "replace");
  }

  /* ---------------------------------------------------------------- events */

  function wire() {
    $("#openBtn").addEventListener("click", () => doPick());
    $("#emptyOpenBtn").addEventListener("click", () => doPick());
    $("#emptyNewBtn").addEventListener("click", () => App.newTableDialog());
    $("#emptyCsvBtn").addEventListener("click", () => App.importCsvDialog());
    $("#saveBtn").addEventListener("click", () => saveTable(false));
    $("#printBtn").addEventListener("click", () => window.print());
    $("#addRowBtn").addEventListener("click", addRow);
    $("#delRowBtn").addEventListener("click", deleteRow);
    $("#restoreRowBtn").addEventListener("click", () => {
      if (state.sel.row >= 0 && state.rows[state.sel.row]) {
        state.rows[state.sel.row].del = false;
        state.dirty = true;
        filterCache.key = "";
        renderAll();
      }
    });
    $("#commitBtn").addEventListener("click", () => {
      scheduleValidate();
      toast(T("status.noIssues"), "ok");
    });
    $("#addFieldBtn").addEventListener("click", () => openFieldDialog(null));
    $("#navFirst").addEventListener("click", () => gotoRecord(1));
    $("#navPrev").addEventListener("click", () => navigate(-1));
    $("#navNext").addEventListener("click", () => navigate(1));
    $("#navLast").addEventListener("click", () => gotoRecord(viewIndices().length));
    ui.recordNo.addEventListener("change", () => gotoRecord(Number(ui.recordNo.value) || 1));
    $("#detailClose").addEventListener("click", () => {
      ui.app.classList.remove("no-sidebar");
      ui.app.classList.toggle("no-detail");
      $("#panelToggle").classList.toggle("is-off", ui.app.classList.contains("no-detail"));
    });
    $("#panelToggle").addEventListener("click", () => {
      ui.app.classList.toggle("no-detail");
    });
    $("#pagePrev").addEventListener("click", () => {
      state.view.page = Math.max(0, state.view.page - 1);
      renderGrid();
    });
    $("#pageNext").addEventListener("click", () => {
      state.view.page = Math.min(pageCount() - 1, state.view.page + 1);
      renderGrid();
    });
    ui.pageSize.addEventListener("change", () => {
      state.prefs.pageSize = Number(ui.pageSize.value);
      state.view.page = 0;
      renderGrid();
      savePrefsDebounced();
    });
    ui.showDeleted.addEventListener("change", () => {
      state.prefs.showDeleted = ui.showDeleted.checked;
      filterCache.key = "";
      state.view.page = 0;
      renderGrid();
      renderStatus();
      savePrefsDebounced();
    });
    ui.filterInput.addEventListener("input", debounce(() => {
      state.view.filter = ui.filterInput.value;
      ui.filterClear.hidden = !state.view.filter;
      filterCache.key = "";
      state.view.page = 0;
      renderGrid();
      renderStatus();
    }, 160));
    ui.filterClear.addEventListener("click", () => {
      ui.filterInput.value = "";
      state.view.filter = "";
      ui.filterClear.hidden = true;
      filterCache.key = "";
      renderGrid();
      renderStatus();
    });
    ui.searchInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        nextHit();
      }
    });
    $("#searchNextBtn").addEventListener("click", nextHit);
    $("#encodingBtn").addEventListener("click", (ev) => {
      const autoEnc = DBF.normEncoding(state.autoEncoding || state.encoding);
      const autoName = autoEnc === "gbk" ? "GBK" : autoEnc.toUpperCase();
      const items = [
        {
          text: T("enc.autoItem", { enc: autoName }),
          checked: !state.manualEncoding,
          onClick: () => reopenWithEncoding("auto", true),
        },
        { sep: true },
        ...DBF.ENCODING_CHOICES.map((c) => ({
          text: c.label,
          checked: DBF.normEncoding(c.id) === state.encoding,
          onClick: () => reopenWithEncoding(c.id, true),
        })),
        { sep: true },
        { text: T("enc.dialog") + "…", onClick: () => App.encodingDialog && App.encodingDialog() },
      ];
      openMenu(ev.currentTarget, items);
    });
    $("#exportBtn").addEventListener("click", () => App.exportDialog());
    $("#exportMenuBtn").addEventListener("click", (ev) => {
      openMenu(ev.currentTarget, [
        { text: T("export.csv"), onClick: () => quickExport("csv") },
        { text: T("export.json"), onClick: () => quickExport("json") },
        { text: T("export.xlsx"), onClick: () => quickExport("xlsx") },
        { text: T("export.markdown"), onClick: () => quickExport("markdown") },
        { sep: true },
        { text: T("dlg.export.title") + "…", onClick: () => App.exportDialog() },
      ]);
    });
    $("#moreBtn").addEventListener("click", (ev) => {
      const mark = (v) => (state.prefs.appearance === v ? " ✓" : "");
      const base = [
        { text: T("btn.saveAs") + "…", icon: "save", onClick: () => saveTable(true) },
        { text: T("btn.importCsv"), icon: "import", onClick: () => App.importCsvDialog() },
        { text: T("btn.newTable"), icon: "plus", onClick: () => App.newTableDialog() },
        { sep: true },
        { text: T("col.settings"), icon: "columns", onClick: () => App.columnsDialog() },
        { text: T("enc.dialog") + "…", onClick: () => App.encodingDialog && App.encodingDialog() },
        { text: T("col.fit"), onClick: fitColumns },
        { text: T("view.density") + (state.prefs.density === "compact" ? " ✓" : ""), onClick: () => toggleDensity() },
        { sep: true },
        { label: T("dict.menu") },
        { text: T("dict.export") + "…", icon: "export", onClick: () => exportColumnDict() },
        { text: T("dict.import") + "…", icon: "import", onClick: () => importColumnDict() },
        { text: T("dict.clear") + "…", onClick: () => clearColumnDict() },
        { sep: true },
        { label: T("table.tools") },
        { text: T("table.pack"), onClick: () => packTable() },
        { text: T("table.zap"), icon: "trash", onClick: () => zapTable() },
        { text: T("table.version"), onClick: () => versionDialog() },
        { sep: true },
        { label: T("view.appearance") },
        { text: T("theme.auto") + mark("auto"), onClick: () => chooseAppearance("auto") },
        { text: T("theme.light") + mark("light"), onClick: () => chooseAppearance("light") },
        { text: T("theme.dark") + mark("dark"), onClick: () => chooseAppearance("dark") },
        { sep: true },
        { text: (g.I18N.locale === "zh-CN" ? "English" : "简体中文"), icon: "lang", onClick: () => switchLocale() },
        { text: T("dlg.about.title"), icon: "help", onClick: () => App.aboutDialog() },
      ];
      const items = state.conn ? connMenuItems().concat([{ sep: true }], base) : base;
      openMenu(ev.currentTarget, items);
    });
    $("#columnsBtn").addEventListener("click", (ev) => App.columnsMenu(ev.currentTarget));
    document.addEventListener("keydown", (ev) => {
      if (ev.target.matches("input, textarea, select")) return;
      if (ev.key === "Escape") {
        closeMenu();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        saveTable(ev.shiftKey);
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") {
        ev.preventDefault();
        ui.searchInput.focus();
        return;
      }
      if (!state.header) return;
      const map = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
      if (map[ev.key] && state.sel.row >= 0) {
        ev.preventDefault();
        navigate(map[ev.key]);
      } else if (ev.key === "Home" && ev.ctrlKey) {
        ev.preventDefault();
        gotoRecord(1);
      } else if (ev.key === "End" && ev.ctrlKey) {
        ev.preventDefault();
        gotoRecord(viewIndices().length);
      } else if (ev.key === "F2" || ev.key === "Enter") {
        const td = $("#gridBody tr.is-selected td.is-active-cell");
        if (td) {
          ev.preventDefault();
          beginEdit(td, state.sel.row, state.sel.col);
        }
      } else if (ev.key === "Delete" && state.sel.row >= 0 && !state.readonly) {
        deleteRow();
      } else if (ev.key === "ArrowRight" && ev.altKey) {
        selectCell(state.sel.row, Math.min(state.header.fields.length - 1, state.sel.col + 1));
      } else if (ev.key === "ArrowLeft" && ev.altKey) {
        selectCell(state.sel.row, Math.max(0, state.sel.col - 1));
      }
    });

    $$(".side-tab[data-side-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".side-tab[data-side-tab]").forEach((t) => t.classList.toggle("is-active", t === tab));
        $$(".side-pane").forEach((p) => p.classList.toggle("is-active", p.dataset.sidePane === tab.dataset.sideTab));
      });
    });
    $$(".side-tab[data-detail-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".side-tab[data-detail-tab]").forEach((t) => t.classList.toggle("is-active", t === tab));
        $$(".detail-pane").forEach((p) => p.classList.toggle("is-active", p.dataset.detailPane === tab.dataset.detailTab));
      });
    });
    $("#fileCloseBtn").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!state.source) return;
      if (!state.dirty) {
        closeTable();
        return;
      }
      const ok = await confirmDialog(T("btn.close"), T("msg.dirtyCancel"), T("common.close"), true);
      if (ok) closeTable();
    });
    $("#fileChip").addEventListener("click", async (ev) => {
      if (ev.target.closest("#encodingBtn, #fileCloseBtn")) return;
      if (!state.source) return;
      if (state.conn && state.source.connectionId) {
        const items = connMenuItems();
        if (items.length) {
          openMenu(ev.currentTarget, items);
          return;
        }
      }
    });

    window.addEventListener("resize", debounce(() => renderGrid(), 160));
    window.addEventListener("beforeunload", (ev) => {
      if (state.dirty) {
        ev.preventDefault();
        ev.returnValue = "";
      }
    });
    initDrop();
    initSamples();
  }

  function toggleDensity() {
    state.prefs.density = state.prefs.density === "compact" ? "normal" : "compact";
    ui.app.dataset.density = state.prefs.density;
    renderGrid();
    savePrefsDebounced();
  }

  function chooseAppearance(mode) {
    setAppearance(mode, Host.api && Host.api.theme ? Host.api.theme.appearance : null);
    savePrefsDebounced();
  }

  function switchLocale() {
    const next = g.I18N.locale === "zh-CN" ? "en-US" : "zh-CN";
    g.I18N.setLocale(next);
    state.prefs.locale = next;
    g.I18N.apply();
    applyStaticLabels();
    renderAll();
    savePrefsDebounced();
  }

  /**
   * Re-decode the open table with another encoding — the "重新以 X 编码打开" action.
   * Keeps page/selection/sort/hidden columns, drops unsaved edits after confirmation.
   * enc === "auto" goes back to the auto-detected encoding.
   */
  async function reopenWithEncoding(enc, remember) {
    if (!state.header || !state.source) return;
    const isAuto = enc === "auto";
    const next = isAuto ? DBF.normEncoding(state.autoEncoding || state.encoding) : DBF.normEncoding(enc);
    if (!isAuto && next === state.encoding) {
      if (remember) rememberEncoding(state.source.name, next);
      renderChrome();
      return;
    }
    if (state.dirty) {
      const ok = await confirmDialog(T("enc.title"), T("enc.discardDirty"), T("enc.reopen"));
      if (!ok) return;
    }
    loadingBar(true);
    try {
      const buf = state.buf || (await readAll(state.source));
      const header = state.header;
      const decoded = decodeRows(buf, header, next);
      state.buf = buf;
      state.encoding = next;
      state.manualEncoding = isAuto ? "" : next;
      if (isAuto) state.autoEncoding = next;
      state.rows = decoded.rows;
      state.dirty = false;
      state.issues = [];
      const total = Math.max(1, Math.ceil(decoded.rows.length / (pageSize() || 1)));
      state.view.page = Math.min(state.view.page, total - 1);
      state.view.widths = autoWidths(header, decoded.rows);
      state.sel = {
        row: decoded.rows.length ? Math.min(state.sel.row < 0 ? 0 : state.sel.row, decoded.rows.length - 1) : -1,
        col: state.sel.col,
      };
      filterCache.key = "";
      if (remember) rememberEncoding(state.source.name, isAuto ? "" : next);
      renderAll();
      scheduleValidate();
      toast(T("enc.changed", { enc: next === "gbk" ? "GBK" : next.toUpperCase() }), "ok");
    } catch (err) {
      toast(String((err && err.message) || err), "err");
    } finally {
      loadingBar(false);
    }
  }

  /** remember (or forget, when enc is empty) the manual encoding for a file name */
  function rememberEncoding(name, enc) {
    if (!name) return;
    if (!state.prefs.encodings) state.prefs.encodings = {};
    if (enc) state.prefs.encodings[name] = enc;
    else delete state.prefs.encodings[name];
    savePrefsDebounced();
  }

  function setEncoding(enc) {
    return reopenWithEncoding(enc, true);
  }

  /* ---- 字段释义（列名 ↔ 中文名）：运行期导入 / 导出，数据层与规则层解耦 ---- */

  function dictApi() {
    return g.DBF_DICT || null;
  }

  function syncColumnPrefs() {
    const dict = dictApi();
    if (!dict) return;
    state.prefs.columns = dict.userColumns();
    savePrefsDebounced();
  }

  /** 导出：当前数据表的字段名 + 已有中文名（含自定义覆盖），可直接编辑后回传 */
  async function exportColumnDict() {
    const dict = dictApi();
    if (!dict) return;
    const map = {};
    if (state.header) {
      for (const f of visibleFields()) {
        const d = dict.describeField(state.source.name, f.name);
        map[f.name] = d.cn || "";
      }
    } else {
      Object.assign(map, dict.userColumns());
    }
    if (!Object.keys(map).length) {
      toast(T("dict.none"), "warn");
      return;
    }
    const payload = {
      $schema: "dbf-studio/columns-cn@1",
      plugin: "com.dbx.dbf",
      file: state.source ? state.source.name : "",
      exported: new Date().toISOString(),
      columns: map,
    };
    const base = state.source ? stemOf(state.source.name) : "columns";
    const name = base + ".columns.json";
    const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
    try {
      await Host.save(name, bytes, "application/json");
      toast(T("dict.exported", { name }), "ok");
    } catch (err) {
      toast(String(err.message || err), "err");
    }
  }

  /** 导入：合并（同名覆盖）自定义释义，持久化到宿主存储 */
  async function importColumnDict() {
    const dict = dictApi();
    if (!dict || !Host.can("read") || !Host.can("pick")) {
      toast(T("msg.noSource"), "warn");
      return;
    }
    let picked;
    try {
      picked = await Host.pick(true);
    } catch (err) {
      toast(String(err.message || err), "err");
      return;
    }
    if (!picked || !picked.length) return;
    let added = 0;
    let bad = 0;
    for (const src of picked) {
      try {
        const bytes = await readAll(src);
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        const json = JSON.parse(text);
        added += dict.setUser(json, "merge");
      } catch (err) {
        bad += 1;
      }
    }
    if (added) {
      syncColumnPrefs();
      renderAll();
      toast(T("dict.imported", { n: added }), "ok");
    } else {
      toast(T("dict.invalid"), "err");
    }
    if (bad && added) toast(T("dict.invalid"), "warn");
  }

  async function clearColumnDict() {
    const dict = dictApi();
    if (!dict) return;
    const count = Object.keys(dict.userColumns()).length;
    if (!count) {
      toast(T("dict.none"), "warn");
      return;
    }
    const ok = await confirmDialog(T("dict.clear"), T("dict.confirmClear", { n: count }), T("common.ok"));
    if (!ok) return;
    dict.clearUser();
    syncColumnPrefs();
    renderAll();
    toast(T("dict.cleared"), "ok");
  }

  function closeTable() {
    state.source = null;
    state.buf = null;
    state.header = null;
    state.rows = [];
    state.sample = "";
    state.manualEncoding = "";
    state.autoEncoding = "";
    state.memo = { reader: null, kind: "", name: "", buffer: null, cache: new Map() };
    state.issues = [];
    state.dirty = false;
    state.sel = { row: -1, col: 0 };
    ui.searchHits.textContent = "";
    renderAll();
  }

  /* -------------------------------------------------------------- connection */

  function connTables() {
    const info = state.conn && state.conn.info;
    return (info && info.tables) || [];
  }

  function connTitle() {
    const info = state.conn && state.conn.info;
    if (!info) return "";
    return baseName(info.path || info.folder || info.source || "");
  }

  /** a source whose bytes come from the backend instead of the file picker */
  function connSource(name, size, connectionId) {
    return {
      name,
      size: Number(size) || 0,
      path: name,
      connectionId,
      read: async (offset, length) => {
        const res = await Host.backend("dbf/read", {
          connectionId,
          name,
          offset,
          length: length || 0,
        });
        return {
          bytes: b64ToBytes((res && res.dataBase64) || ""),
          eof: !!(res && res.eof),
        };
      },
    };
  }

  async function writeBack(bytes, name) {
    const connectionId = state.source.connectionId;
    const begin = await Host.backend("dbf/write-begin", { connectionId, name, size: bytes.length });
    const token = begin && begin.token;
    if (!token) throw new Error(T("conn.writeFail"));
    const chunk = 1024 * 1024;
    try {
      for (let at = 0; at < bytes.length; at += chunk) {
        const slice = bytes.subarray(at, Math.min(at + chunk, bytes.length));
        await Host.backend("dbf/write-chunk", { token, offset: at, dataBase64: bytesToB64(slice) });
      }
      return await Host.backend("dbf/write-commit", { token });
    } catch (err) {
      try {
        await Host.backend("dbf/write-abort", { token });
      } catch (e) {
        /* ignore */
      }
      throw err;
    }
  }

  async function loadConnTable(name, quiet) {
    if (!state.conn) return;
    const tables = connTables();
    const wanted = String(name || "").toLowerCase();
    const table = tables.find((t) => String(t.name).toLowerCase() === wanted) || tables[0];
    if (!table) return;
    loadingBar(true);
    try {
      const info = state.conn.info;
      const src = connSource(table.name, table.size, state.conn.id);
      const buf = await readAll(src);
      const header0 = DBF.parseHeader(buf);
      const recSample = buf.subarray(header0.headerLength, Math.min(buf.length, header0.headerLength + header0.recordLength * 64));
      const auto = DBF.detectEncoding(header0, recSample);
      const forced = info.encoding && info.encoding !== "auto" ? DBF.normEncoding(info.encoding) : "";
      const enc = forced || chooseEncoding(header0, auto, table.name);
      loadTable(src, buf, header0, enc);
      state.readonly = !info.allowWrite;
      state.prefs.connTable = Object.assign({}, state.prefs.connTable || {}, { [state.conn.id]: table.name });
      savePrefsDebounced();
      if (header0.hasMemo && table.memo) {
        await attachMemo(connSource(table.memo, 0, state.conn.id));
      }
      if (!quiet) toast(T("conn.switched", { name: table.name }), "ok");
      renderAll();
    } catch (err) {
      console.error(err);
      toast(T("msg.parseError", { err: err && err.message ? err.message : String(err) }), "err");
    } finally {
      loadingBar(false);
    }
  }

  async function openConnection(ctx) {
    const connectionId = ctx && ctx.connectionId;
    if (!connectionId) return false;
    try {
      loadingBar(true);
      const info = await Host.backend("dbf/info", { connectionId });
      state.conn = { id: connectionId, info };
      const tables = connTables();
      if (!tables.length) throw new Error(T("conn.noTables"));
      const remembered = (state.prefs.connTable || {})[connectionId];
      const pick = tables.find((t) => t.name === remembered) || tables[0];
      await loadConnTable(pick.name, true);
      toast(T("conn.connected", { name: connTitle() }), "ok");
      renderAll();
      return true;
    } catch (err) {
      state.conn = null;
      renderAll();
      toast(T("conn.failed", { err: err && err.message ? err.message : String(err) }), "err");
      return false;
    } finally {
      loadingBar(false);
    }
  }

  function connMenuItems() {
    if (!state.conn) return [];
    const cur = state.source && state.source.connectionId ? state.source.name : "";
    const items = [{ label: T("conn.tables") + " · " + connTitle() }];
    for (const t of connTables()) {
      const mark = t.name === cur ? " ✓" : "";
      const extra = t.records != null ? " · " + T("status.rows", { n: t.records }) : "";
      items.push({ text: t.name + extra + mark, onClick: () => loadConnTable(t.name) });
    }
    items.push({ text: T("conn.reload") + "…", onClick: () => refreshConnection() });
    return items;
  }

  async function refreshConnection() {
    if (!state.conn) return;
    const keep = state.source && state.source.connectionId ? state.source.name : "";
    try {
      const info = await Host.backend("dbf/info", { connectionId: state.conn.id });
      state.conn = { id: state.conn.id, info };
      const tables = connTables();
      const pick = tables.find((t) => t.name === keep) || tables[0];
      if (pick) await loadConnTable(pick.name, true);
      else renderAll();
      toast(T("conn.refreshed", { n: tables.length }), "ok");
    } catch (err) {
      toast(T("conn.failed", { err: err && err.message ? err.message : String(err) }), "err");
    }
  }

  async function bindConnectionContext() {
    const api = Host.api;
    if (!api) return;
    let ctx = null;
    try {
      ctx = typeof api.context === "function" ? api.context() : api.context;
    } catch (e) {
      ctx = null;
    }
    if (ctx && ctx.connectionId) await openConnection(ctx);
    if (typeof api.onContext === "function") {
      try {
        api.onContext((next) => {
          if (next && next.connectionId && (!state.conn || state.conn.id !== next.connectionId)) {
            openConnection(next);
          }
        });
      } catch (e) {
        /* ignore */
      }
    }
  }

  function doPick() {
    Host.pick(false)
      .then((files) => openSources(files))
      .catch((err) => toast(String(err.message || err), "err"));
  }

  /** physical pack: drop rows flagged as deleted, then rebuild on save */
  function packTable() {
    if (!state.header || state.readonly) return;
    const gone = state.rows.filter((r) => r.del).length;
    if (!gone) {
      toast(T("msg.packNone"), "info");
      return;
    }
    state.rows = state.rows.filter((r) => !r.del);
    state.dirty = true;
    state.sel = { row: state.rows.length ? 0 : -1, col: Math.min(state.sel.col, state.header.fields.length - 1) };
    filterCache.key = "";
    if (state.view.page * pageSize() >= state.rows.length) state.view.page = 0;
    renderAll();
    scheduleValidate();
    toast(T("msg.packDone", { n: gone }), "ok");
  }

  async function zapTable() {
    if (!state.header || state.readonly) return;
    const name = state.source ? baseName(state.source.name) : "table.dbf";
    const ok = await confirmDialog(T("table.zap"), T("msg.zapConfirm", { name }), T("table.zap"), true);
    if (!ok) return;
    state.rows = [];
    state.dirty = true;
    state.sel = { row: -1, col: 0 };
    state.search = { term: "", field: -1, hits: [], at: -1 };
    state.view.page = 0;
    state.view.filter = "";
    filterCache.key = "";
    ui.searchInput.value = "";
    ui.searchHits.textContent = "";
    ui.filterInput.value = "";
    renderAll();
    scheduleValidate();
    toast(T("msg.zapDone"), "ok");
  }

  function versionDialog() {
    if (!state.header) return;
    const choices = [
      { v: 3, name: T("version.3") },
      { v: 4, name: T("version.4") },
      { v: 5, name: T("version.5") },
    ];
    let pickd = state.header.version;
    const body = el("div", { class: "form" });
    body.appendChild(el("p", { class: "form-hint", text: T("dlg.version.hint") }));
    const list = el("div", { class: "choice-list" });
    choices.forEach((c) => {
      const row = el("label", { class: "choice-item" });
      const radio = el("input", { type: "radio", name: "dbftype", value: String(c.v) });
      radio.checked = c.v === pickd;
      radio.addEventListener("change", () => {
        pickd = c.v;
      });
      row.appendChild(radio);
      row.appendChild(el("span", { text: c.name }));
      if (c.v === state.header.version) row.appendChild(el("span", { class: "badge", text: T("dlg.version.current") }));
      list.appendChild(row);
    });
    body.appendChild(list);
    App.modal({
      title: T("dlg.version.title"),
      body,
      actions: [
        { label: T("common.cancel"), onClick: () => {} },
        {
          label: T("common.ok"),
          primary: true,
          onClick: () => {
            if (pickd === state.header.version) return;
            state.header.version = pickd;
            state.header.versionName = (DBF.VERSIONS[pickd] || {}).name || state.header.versionName;
            state.dirty = true;
            renderAll();
            toast(T("msg.versionSet", { name: state.header.versionName }), "ok");
          },
        },
      ],
    });
  }

  function quickExport(format) {
    if (!state.header) return;
    exportTable({ format: format, rows: viewIndices() });
  }

  /* ------------------------------------------------------------------- drop */

  function initDrop() {
    const api = Host.api;
    const ft = api && api.fileTransfer;
    if (ft && ft.onDrop && Host.can("drop")) {
      ft.onDrop(async (files) => {
        const sources = (files || []).map((f) => ({
          name: f.name,
          size: f.size,
          path: f.relativePath || f.name,
          handleId: f.handleId,
          read: async (offset, length) => {
            const r = await ft.read(f.handleId, offset, length);
            return { bytes: b64ToBytes(r && r.dataBase64), eof: !!(r && r.eof) };
          },
        }));
        await openSources(sources);
      });
      if (ft.onDragState) {
        ft.onDragState((active) => {
          ui.dropzone.hidden = !active;
        });
      }
    }
    ["dragenter", "dragover"].forEach((type) => {
      window.addEventListener(type, (ev) => {
        ev.preventDefault();
        if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes("Files")) ui.dropzone.hidden = false;
      });
    });
    window.addEventListener("dragleave", (ev) => {
      if (!ev.relatedTarget) ui.dropzone.hidden = true;
    });
    window.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      ui.dropzone.hidden = true;
      const files = Array.from((ev.dataTransfer && ev.dataTransfer.files) || []);
      if (!files.length) return;
      const sources = files.map((f) => ({
        name: f.name,
        size: f.size,
        path: f.webkitRelativePath || f.name,
        read: async (offset, length) => {
          const end = length == null || length <= 0 ? f.size : Math.min(offset + length, f.size);
          const buf = await f.slice(offset, end).arrayBuffer();
          return { bytes: new Uint8Array(buf), eof: end >= f.size };
        },
      }));
      await openSources(sources);
    });
  }

  function initSamples() {
    const packs = g.DBF_SAMPLES || {};
    const samples = Object.keys(packs).map((name) => ({ name, label: packs[name].label || name }));
    ui.sampleRow.replaceChildren();
    samples.forEach((s) => {
      const chip = el("button", { class: "sample-chip", type: "button", text: s.label });
      chip.title = packs[s.name] && packs[s.name].title ? packs[s.name].title : "";
      chip.addEventListener("click", () => loadSample(s.name));
      ui.sampleRow.appendChild(chip);
    });
  }

  async function loadSample(name) {
    try {
      loadingBar(true);
      let buf = null;
      const pack = g.DBF_SAMPLES && g.DBF_SAMPLES[name];
      if (pack && pack.b64) buf = b64ToBytes(pack.b64);
      if (!buf) {
        const candidates = [await Host.assetUrl("samples/" + name), "samples/" + name];
        for (const u of candidates) {
          try {
            const res = await fetch(u);
            if (res.ok) {
              buf = new Uint8Array(await res.arrayBuffer());
              break;
            }
          } catch (e) {
            /* try next */
          }
        }
      }
      if (!buf) throw new Error(T("msg.unsupported", { name }));
      const header = DBF.parseHeader(buf);
      const recSample = buf.subarray(header.headerLength, Math.min(buf.length, header.headerLength + header.recordLength * 64));
      const auto = DBF.detectEncoding(header, recSample);
      const pick = pickEncoding(header, auto, name);
      loadTable({ name, size: buf.length, path: name, readonly: false }, buf, header, pick.enc, auto.encoding, pick.manual);
      state.sample = name;
      state.meta = { title: pack ? pack.title : "", note: pack ? pack.note : "" };
      renderAll();
      toast(T("msg.opened", { name }), "ok");
    } catch (err) {
      toast(String(err.message || err), "err");
    } finally {
      loadingBar(false);
    }
  }

  /* ------------------------------------------------------------------- init */

  async function init() {
    cacheUi();
    T = (k, vars) => g.I18N.t(k, vars);
    await loadPrefs();
    g.I18N.setLocale(state.prefs.locale || g.I18N.detect());
    g.I18N.apply();
    applyStaticLabels();
    ui.app.dataset.density = state.prefs.density || "normal";
    ui.pageSize.value = String(state.prefs.pageSize || 500);
    ui.showDeleted.checked = !!state.prefs.showDeleted;
    if (!state.prefs.detail) ui.app.classList.add("no-detail");

    await Host.init();
    applyHostTheme();
    wire();
    renderAll();
    await bindConnectionContext();
    document.body.classList.add("is-ready");
    App.ready = true;
  }

  function applyStaticLabels() {
    $("#searchField").setAttribute("aria-label", T("search.all"));
  }

  function applyHostTheme() {
    const api = Host.api;
    const theme = (api && api.theme) || null;
    setAppearance(state.prefs.appearance || "auto", theme && theme.appearance);
    window.addEventListener("dbx-plugin-env", (ev) => {
      const detail = ev.detail || {};
      if (state.prefs.appearance === "auto" || !state.prefs.appearance) {
        setAppearance("auto", (detail.theme && detail.theme.appearance) || null);
      }
      if (detail.locale && g.I18N && detail.locale !== g.I18N.locale) {
        g.I18N.setLocale(detail.locale);
        g.I18N.apply();
        renderAll();
      }
    });
  }

  /** resolve "auto" against the host appearance and stamp it on <html> + <body> */
  function setAppearance(mode, hostAppearance) {
    const pref = mode || "auto";
    state.prefs.appearance = pref;
    let resolved = pref;
    if (pref === "auto") resolved = hostAppearance === "dark" ? "dark" : "light";
    const root = document.documentElement;
    const hostResolved = hostAppearance === "dark" ? "dark" : hostAppearance === "light" ? "light" : "";
    root.setAttribute("data-dbx-theme", resolved);
    root.setAttribute("data-dbx-tokens", hostResolved && hostResolved === resolved ? "host" : "own");
    if (document.body) {
      document.body.removeAttribute("data-dbx-theme");
      document.body.dataset.appearance = pref;
    }
  }

  /* -------------------------------------------------------------------- app */

  const App = {
    state,
    ui,
    host: Host,
    init,
    t: (k, v) => T(k, v),
    fmtBytes,
    openSources,
    closeTable,
    saveTable,
    exportTable,
    loadMemoFile,
    addRow,
    deleteRow,
    renderAll,
    renderGrid,
    renderSidebar,
    renderDetail,
    renderChrome,
    renderStatus,
    selectCell,
    tableOf,
    visibleFields,
    viewIndices,
    pageRows,
    toast,
    modal,
    menu: openMenu,
    closeMenu,
    confirmDialog,
    askFileName,
    beginEdit,
    packTable,
    zapTable,
    versionDialog,
    openFieldDialog: null,
    dropField: null,
    encodingDialog: null,
    setEncoding,
    reopenWithEncoding,
    rememberEncoding,
    exportColumnDict,
    importColumnDict,
    clearColumnDict,
    scheduleValidate,
    loadSample,
    openConnection,
    loadConnTable,
    refreshConnection,
    connTables,
    ready: false,
    stemOf,
    baseName,
    extOf,
    b64ToBytes,
    bytesToB64,
    savePrefs: savePrefsDebounced,
    prefs: state.prefs,
    setNotes(notes) {
      state.notes = notes || {};
      renderSidebar();
      savePrefsDebounced();
    },
    chooseEncoding,
    /** load generated bytes as the active table (csv import / new table) */
    adopt(name, bytes, opts) {
      const header = DBF.parseHeader(bytes);
      const recSample = bytes.subarray(header.headerLength, Math.min(bytes.length, header.headerLength + header.recordLength * 64));
      const auto = DBF.detectEncoding(header, recSample);
      const pick = pickEncoding(header, auto, name);
      const src = {
        name,
        size: bytes.length,
        path: name,
        read: async (o, l) => {
          const end = Math.min(bytes.length, o + (l || 0));
          return Promise.resolve({ bytes: bytes.subarray(o, end), eof: end >= bytes.length });
        },
      };
      loadTable(src, bytes, header, pick.enc, auto.encoding, pick.manual);
      state.readonly = !!(opts && opts.readonly);
      renderAll();
      scheduleValidate();
      toast(T("msg.opened", { name }), "ok");
    },
    rebuildWithFields,
  };

  /** rebuild the table with a new field layout, keeping values by name */
  async function rebuildWithFields(nextFields, opts) {
    const oldFields = state.header.fields;
    const mapping = nextFields.map((nf) => {
      const from = nf.from != null ? nf.from : nf.name;
      return oldFields.findIndex((f) => f.name.toUpperCase() === String(from).toUpperCase());
    });
    const rows = state.rows.map((r) => {
      const v = nextFields.map((nf, i) => {
        const src = mapping[i];
        if (src < 0) return "";
        const val = r.v[src] || "";
        const field = nf;
        if (field.type === "C" && val.length > field.length) return val.slice(0, field.length);
        return val;
      });
      return { v, del: r.del };
    });
    const probe = DBF.buildDbf({
      fields: nextFields.map((f) => ({ name: f.name, type: f.type, length: f.length, decimals: f.decimals || 0 })),
      rows: [],
      encoding: state.encoding,
      ldid: DBF.encodingLdid(state.encoding),
    });
    const header = DBF.parseHeader(probe.bytes);
    state.header = header;
    state.rows = rows;
    state.view = { hidden: new Set(), widths: {}, sort: { col: -1, dir: 0 }, filter: "", page: 0 };
    state.sel = { row: rows.length ? Math.min(state.sel.row, rows.length - 1) : -1, col: 0 };
    state.dirty = true;
    filterCache.key = "";
    fillSearchFields();
    renderAll();
    scheduleValidate();
    void opts;
  }

  g.addEventListener("load", () => {
    if (!App.ready) App.init().catch((err) => console.error(err));
  });
  if (document.readyState === "complete") {
    setTimeout(() => {
      if (!App.ready) App.init().catch((err) => console.error(err));
    }, 0);
  }

  g.App = App;
})(typeof globalThis !== "undefined" ? globalThis : this);
