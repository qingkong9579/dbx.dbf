/*!
 * DBF Studio — views.js
 * Dialogs and secondary views: field editor, export, CSV import, new table,
 * column manager, about.
 */
(function (g) {
  "use strict";

  const App = g.App;
  const DBF = g.DBF;
  const T = (k, vars) => g.I18N.t(k, vars);
  const el = (tag, attrs, children) => App.__el(tag, attrs, children);

  const TYPE_CHOICES = [
    { id: "C", label: () => T("type.C") },
    { id: "N", label: () => T("type.N") },
    { id: "F", label: () => T("type.F") },
    { id: "D", label: () => T("type.D") },
    { id: "L", label: () => T("type.L") },
    { id: "M", label: () => T("type.M") },
    { id: "I", label: () => T("type.I") },
    { id: "T", label: () => T("type.T") },
    { id: "Y", label: () => T("type.Y") },
  ];

  const LENGTH_RANGE = {
    C: [1, 254],
    N: [1, 20],
    F: [1, 20],
    D: [8, 8],
    L: [1, 1],
    M: [10, 10],
    I: [4, 4],
    T: [8, 8],
    Y: [8, 8],
  };

  function formRow(label, control) {
    const row = el("div", { class: "form-row" });
    row.appendChild(el("label", { text: label }));
    row.appendChild(control);
    return row;
  }

  function input(attrs) {
    return el("input", Object.assign({ class: "input", spellcheck: "false" }, attrs || {}));
  }

  function select(options, value) {
    const node = el("select", { class: "select" });
    for (const o of options) {
      const opt = el("option", { value: o.id, text: typeof o.label === "function" ? o.label() : o.label });
      if (String(o.id) === String(value)) opt.selected = true;
      node.appendChild(opt);
    }
    return node;
  }

  function fileBaseName(name) {
    return String(name || "").split(/[\\/]/).pop();
  }

  function stem(name) {
    return fileBaseName(name).replace(/\.[^.]+$/, "").toUpperCase() || "TABLE";
  }

  /* ------------------------------------------------------------ field dialog */

  function openFieldDialog(field) {
    const state = App.state;
    if (!state.header) return;
    const isNew = !field;
    const dict = g.DBF_DICT;
    const fileName = state.source ? state.source.name : "";

    const nameInput = input({ value: field ? field.name : "", maxlength: "10", placeholder: T("dlg.field.namePh") });
    const typeSelect = select(TYPE_CHOICES, field ? field.type : "C");
    const lenInput = input({ type: "number", value: String(field ? field.length : 20), min: "1", max: "254" });
    const decInput = input({ type: "number", value: String(field ? field.decimals || 0 : 0), min: "0", max: "9" });
    const notesInput = el("textarea", { class: "textarea", rows: "3", placeholder: T("field.notesPlaceholder") });
    notesInput.value = state.notes[field ? field.name : ""] || "";

    const hint = el("div", { class: "dict-line" });
    const updateHint = () => {
      const name = nameInput.value.toUpperCase();
      const d = dict.describeField(fileName, name);
      hint.replaceChildren();
      if (d.cn) {
        hint.appendChild(el("b", { text: d.cn }));
        hint.appendChild(
          el("span", {
            class: "badge" + (d.confidence === "inferred" ? " warn" : ""),
            text: d.confidence === "spec" ? T("field.fromSpec") : d.confidence === "custom" ? T("field.custom") : T("field.inferred"),
          })
        );
      } else {
        hint.appendChild(el("span", { class: "dict-miss", text: T("field.dictMissing") }));
      }
      if (d.hint) hint.appendChild(el("span", { class: "dict-hint", text: d.hint }));
      if (d.prefix) hint.appendChild(el("span", { class: "dict-hint", text: T("field.prefix") + "：" + d.prefix }));
      if (d.family) hint.appendChild(el("span", { class: "dict-hint", text: d.family.label }));
    };
    nameInput.addEventListener("input", () => {
      nameInput.value = nameInput.value.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 10);
      updateHint();
    });
    typeSelect.addEventListener("change", () => {
      const range = LENGTH_RANGE[typeSelect.value] || [1, 254];
      lenInput.min = String(range[0]);
      lenInput.max = String(range[1]);
      if (range[0] === range[1]) lenInput.value = String(range[0]);
      else if (Number(lenInput.value) < range[0]) lenInput.value = String(range[0]);
      decInput.disabled = !(typeSelect.value === "N" || typeSelect.value === "F");
      if (decInput.disabled) decInput.value = "0";
    });
    decInput.disabled = !(typeSelect.value === "N" || typeSelect.value === "F");
    updateHint();

    const body = el("div", {});
    body.appendChild(formRow(T("dlg.field.name"), nameInput));
    body.appendChild(hint);
    const grid = el("div", { class: "form-grid three" });
    grid.appendChild(formRow(T("dlg.field.type"), typeSelect));
    grid.appendChild(formRow(T("dlg.field.length"), lenInput));
    grid.appendChild(formRow(T("dlg.field.decimals"), decInput));
    body.appendChild(grid);
    body.appendChild(formRow(T("field.notes"), notesInput));
    if (!isNew) body.appendChild(el("div", { class: "form-hint", text: T("dlg.field.warnData") }));

    const actions = [{ label: T("common.cancel") }];
    if (!isNew) {
      actions.push({
        label: T("field.drop"),
        danger: true,
        onClick: () => {
          dropField(field);
        },
      });
    }
    actions.push({
      label: T("common.save"),
      primary: true,
      onClick: () => {
        const name = nameInput.value.trim().toUpperCase();
        const type = typeSelect.value;
        const length = Number(lenInput.value) || (LENGTH_RANGE[type] || [1])[0];
        const decimals = Number(decInput.value) || 0;
        if (!/^[A-Z][A-Z0-9_]{0,9}$/.test(name)) {
          App.toast(T("dlg.field.invalidName"), "err");
          nameInput.classList.add("invalid");
          return false;
        }
        const clash = state.header.fields.some((f) => f.name === name && (!field || f.name !== field.name));
        if (clash) {
          App.toast(T("dlg.field.exists"), "err");
          return false;
        }
        const range = LENGTH_RANGE[type] || [1, 254];
        if (length < range[0] || length > range[1]) {
          App.toast(T("dlg.field.invalidLength") + " " + range[0] + "–" + range[1], "err");
          return false;
        }
        const next = state.header.fields.map((f) => ({
          name: f.name,
          type: f.type,
          length: f.length,
          decimals: f.decimals,
          from: f.name,
        }));
        if (field) {
          const at = next.findIndex((f) => f.name === field.name);
          if (at >= 0) next[at] = { name, type, length, decimals, from: field.name };
        } else {
          next.push({ name, type, length, decimals, from: "\u0000new" });
        }
        if (notesInput.value.trim()) state.notes[name] = notesInput.value.trim();
        else delete state.notes[name];
        App.rebuildWithFields(next);
        if (field && field.name !== name && state.notes[field.name]) {
          state.notes[name] = state.notes[field.name];
          delete state.notes[field.name];
        }
        App.setNotes(state.notes);
      },
    });

    App.modal({ title: isNew ? T("dlg.field.addTitle") : T("dlg.field.alterTitle"), body, actions });
  }

  function dropField(field) {
    const state = App.state;
    if (!state.header || !field) return;
    App.confirmDialog(T("field.drop"), field.name + " — " + T("dlg.field.warnData"), T("common.delete"), true).then((ok) => {
      if (!ok) return;
      const next = state.header.fields
        .filter((f) => f.name !== field.name)
        .map((f) => ({ name: f.name, type: f.type, length: f.length, decimals: f.decimals, from: f.name }));
      App.rebuildWithFields(next);
      delete state.notes[field.name];
      App.setNotes(state.notes);
    });
  }

  /* ----------------------------------------------------------- export dialog */

  function exportDialog() {
    if (!App.state.header) {
      App.toast(T("msg.pickFirst"), "warn");
      return;
    }
    const state = App.state;
    const base = stem(state.source ? state.source.name : "table");

    const formatSelect = select(
      [
        { id: "csv", label: () => T("export.csv") },
        { id: "json", label: () => T("export.json") },
        { id: "sql", label: () => T("export.sql") },
        { id: "html", label: () => T("export.html") },
        { id: "markdown", label: () => T("export.markdown") },
        { id: "xlsx", label: () => T("export.xlsx") },
        { id: "dbf", label: () => T("export.dbf") },
        { id: "txt", label: () => T("export.txt") },
      ],
      "csv"
    );
    const scopeSelect = select(
      [
        { id: "all", label: () => T("dlg.export.scopeAll") },
        { id: "filtered", label: () => T("dlg.export.scopeFiltered") },
        { id: "row", label: () => T("dlg.export.scopeRow") },
      ],
      state.view.filter ? "filtered" : "all"
    );
    const encSelect = select(
      DBF.ENCODING_CHOICES.map((c) => ({ id: c.id, label: c.label })),
      "utf-8"
    );
    const delimSelect = select(
      [
        { id: ",", label: ",  逗号" },
        { id: "\\t", label: "⇥ 制表符" },
        { id: ";", label: ";  分号" },
        { id: "|", label: "|  竖线" },
      ],
      ","
    );
    const bomCheck = el("input", { type: "checkbox", checked: "checked" });
    const delCheck = el("input", { type: "checkbox" });
    const nameInput = input({ value: base + ".csv" });

    formatSelect.addEventListener("change", () => {
      const ext = { csv: "csv", json: "json", sql: "sql", html: "html", markdown: "md", xlsx: "xml", dbf: "dbf", txt: "txt" }[formatSelect.value] || "txt";
      nameInput.value = base + "." + ext;
      const csv = formatSelect.value === "csv" || formatSelect.value === "txt";
      encSelect.parentElement.style.opacity = csv || formatSelect.value === "dbf" ? "1" : "0.45";
      delimSelect.parentElement.style.opacity = formatSelect.value === "csv" ? "1" : "0.45";
    });

    const body = el("div", {});
    const grid = el("div", { class: "form-grid" });
    grid.appendChild(formRow(T("dlg.export.format"), formatSelect));
    grid.appendChild(formRow(T("dlg.export.scope"), scopeSelect));
    body.appendChild(grid);
    const grid2 = el("div", { class: "form-grid" });
    grid2.appendChild(formRow(T("dlg.export.filename"), nameInput));
    grid2.appendChild(formRow(T("dlg.export.delimiter"), delimSelect));
    body.appendChild(grid2);
    body.appendChild(formRow(T("dlg.export.encoding"), encSelect));
    const checks = el("div", { style: "display:flex;gap:18px;flex-wrap:wrap" });
    const lbl1 = el("label", { class: "check-row" }, [bomCheck, el("span", { text: T("dlg.export.bom") })]);
    const lbl2 = el("label", { class: "check-row" }, [delCheck, el("span", { text: T("dlg.export.includeDeleted") })]);
    checks.appendChild(lbl1);
    checks.appendChild(lbl2);
    body.appendChild(checks);
    const preview = el("div", { class: "form-hint" });
    body.appendChild(preview);

    const refreshPreview = () => {
      let rows;
      if (scopeSelect.value === "all") rows = App.viewIndices();
      else if (scopeSelect.value === "filtered") rows = App.viewIndices();
      else rows = state.sel.row >= 0 ? [state.sel.row] : [];
      preview.textContent = T("export.preview", { rows: rows.length, fields: App.visibleFields().length });
    };
    scopeSelect.addEventListener("change", refreshPreview);
    refreshPreview();

    App.modal({
      title: T("dlg.export.title"),
      body,
      wide: true,
      actions: [
        { label: T("common.cancel") },
        {
          label: T("dlg.export.ok"),
          primary: true,
          onClick: () => {
            let rows;
            if (scopeSelect.value === "row") rows = state.sel.row >= 0 ? [state.sel.row] : [];
            else rows = App.viewIndices();
            App.exportTable({
              format: formatSelect.value,
              rows,
              includeDeleted: delCheck.checked,
              encoding: encSelect.value === "gbk" ? "gbk" : encSelect.value === "utf-16le" ? "utf-16le" : "utf-8",
              delimiter: delimSelect.value === "\\t" ? "\t" : delimSelect.value,
              bom: bomCheck.checked,
              filename: nameInput.value.trim() || base + ".csv",
              scope: scopeSelect.value,
            });
          },
        },
      ],
    });
  }

  /* ------------------------------------------------------------- CSV import */

  async function importCsvDialog() {
    let picked;
    try {
      picked = await App.host.pick(false);
    } catch (err) {
      App.toast(String(err.message || err), "err");
      return;
    }
    if (!picked || !picked.length) return;
    const src = picked[0];
    let bytes;
    try {
      const parts = [];
      let offset = 0;
      for (let i = 0; i < 512; i += 1) {
        const res = await src.read(offset, 4 * 1024 * 1024);
        const chunk = res.bytes || res;
        if (!chunk || !chunk.length) break;
        parts.push(chunk);
        offset += chunk.length;
        if (res.eof) break;
      }
      bytes = new Uint8Array(offset);
      let at = 0;
      for (const p of parts) {
        bytes.set(p, at);
        at += p.length;
      }
    } catch (err) {
      App.toast(String(err.message || err), "err");
      return;
    }

    const hasBom = bytes.length > 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    let text = "";
    let guessed = hasBom ? "utf-8" : "utf-8";
    if (hasBom) text = new TextDecoder("utf-8").decode(bytes.subarray(3));
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (e) {
        guessed = "gbk";
        text = DBF.decodeBytes(bytes, "gbk");
      }
    }

    const firstLine = text.split(/\r?\n/)[0] || "";
    const delimGuess = DBF.sniffDelimiter(firstLine);
    const delimSelect = select(
      [
        { id: ",", label: ",  逗号" },
        { id: "\t", label: "⇥ 制表符" },
        { id: ";", label: ";  分号" },
        { id: "|", label: "|  竖线" },
      ],
      delimGuess
    );
    const encSelect = select(DBF.ENCODING_CHOICES.map((c) => ({ id: c.id, label: c.label })), guessed);
    const headerCheck = el("input", { type: "checkbox", checked: "checked" });
    const inferCheck = el("input", { type: "checkbox", checked: "checked" });
    const nameInput = input({ value: stem(src.name) + ".dbf" });
    const preview = el("div", { class: "hex-view" });

    const body = el("div", {});
    const grid = el("div", { class: "form-grid" });
    grid.appendChild(formRow(T("dlg.import.file"), el("div", { class: "form-hint", text: fileBaseName(src.name) + " · " + App.fmtBytes(bytes.length) })));
    grid.appendChild(formRow(T("dlg.newTable.name"), nameInput));
    body.appendChild(grid);
    const grid2 = el("div", { class: "form-grid three" });
    grid2.appendChild(formRow(T("dlg.import.delimiter"), delimSelect));
    grid2.appendChild(formRow(T("dlg.import.encoding"), encSelect));
    body.appendChild(grid2);
    const checks = el("div", { style: "display:flex;gap:18px;flex-wrap:wrap" });
    checks.appendChild(el("label", { class: "check-row" }, [headerCheck, el("span", { text: T("dlg.import.firstRowHeader") })]));
    checks.appendChild(el("label", { class: "check-row" }, [inferCheck, el("span", { text: T("dlg.import.infer") })]));
    body.appendChild(checks);
    body.appendChild(formRow("preview", preview));

    const compute = () => {
      const sep = delimSelect.value === "\t" ? "\t" : delimSelect.value;
      const parsed = DBF.parseCsv(text, { separator: sep, hasHeader: headerCheck.checked });
      const fields = inferCheck.checked ? DBF.inferFields(parsed.header, parsed.rows, 500) : parsed.header.map((h) => ({ name: h, type: "C", length: 40, decimals: 0 }));
      return { parsed, fields };
    };
    const refresh = () => {
      const { parsed } = compute();
      const lines = [];
      lines.push(parsed.header.join(" | "));
      for (const r of parsed.rows.slice(0, 6)) lines.push(r.join(" | "));
      preview.textContent = lines.join("\n");
    };
    delimSelect.addEventListener("change", refresh);
    headerCheck.addEventListener("change", refresh);
    refresh();

    App.modal({
      title: T("dlg.import.title"),
      body,
      wide: true,
      actions: [
        { label: T("common.cancel") },
        {
          label: T("dlg.import.ok"),
          primary: true,
          onClick: () => {
            try {
              const { parsed, fields } = compute();
              const out = DBF.buildDbf({ fields, rows: parsed.rows, encoding: "gbk" });
              App.adopt(nameInput.value.trim() || "IMPORT.DBF", out.bytes);
              App.toast(T("msg.opened", { name: nameInput.value }), "ok");
            } catch (err) {
              App.toast(T("msg.importFail", { err: String(err.message || err) }), "err");
            }
          },
        },
      ],
    });

    void encSelect;
  }

  /* -------------------------------------------------------------- new table */

  const PRESETS = {
    blank: [
      { name: "ID", type: "C", length: 16, decimals: 0 },
      { name: "NAME", type: "C", length: 40, decimals: 0 },
    ],
    s68: [
      ["SBBH", 16], ["GXDM", 16], ["YWLX", 3], ["SBLX", 3], ["ZQZH", 20], ["XWH", 6],
      ["ZQDM", 8], ["ZQLB", 2], ["LTLX", 1], ["QYLB", 2], ["GPNF", 4], ["QYCS", 1],
      ["SBSL", 20], ["JG", 18], ["JE", 19], ["FZDM", 20], ["QSBH", 5], ["BZ", 40],
    ].map(([name, length]) => ({ name, type: "C", length, decimals: 0 })),
    req: [
      ["SBBH", 10], ["FWYM", 16], ["FWM", 16], ["FWLX", 2], ["WJBZ", 1], ["ZWJM", 24],
      ["CWJM", 24], ["SBRQ", 8], ["SBSJ", 6], ["ZDDCLSJ", 5], ["CLBZ", 1], ["JYLSH", 16],
      ["BY", 20], ["JYM", 4],
    ].map(([name, length]) => ({ name, type: "C", length, decimals: 0 })),
    t1: [
      ["SJLX", 2], ["XH", 8], ["ZQDM", 6], ["ZQJC", 12], ["QYDJR", 8], ["CYRMC", 64],
      ["YMTZHHM", 20], ["ZQZHHM", 10], ["ZJHM", 20], ["CYRLB", 4],
    ].map(([name, length]) => ({ name, type: "C", length, decimals: 0 })).concat([
      { name: "CYSL", type: "N", length: 15, decimals: 0 },
      { name: "CYBL", type: "N", length: 9, decimals: 4 },
      { name: "BZ", type: "C", length: 40, decimals: 0 },
    ]),
  };

  function dateStamp() {
    const d = new Date();
    return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  }

  function newTableDialog() {
    let fields = PRESETS.s68.map((f) => Object.assign({}, f));
    const nameInput = input({ value: "NEWTABLE_" + dateStamp() + ".DBF" });
    const presetSelect = select(
      [
        { id: "s68", label: () => T("dlg.newTable.presetS68") },
        { id: "req", label: () => T("dlg.newTable.presetReq") },
        { id: "t1", label: () => T("dlg.newTable.presetT1") },
        { id: "blank", label: () => T("dlg.newTable.presetBlank") },
      ],
      "s68"
    );
    const versionSelect = select(
      [
        { id: "3", label: () => T("version.3") },
        { id: "4", label: () => T("version.4") },
        { id: "5", label: () => T("version.5") },
      ],
      String((App.state && App.state.prefs && App.state.prefs.newVersion) || 3)
    );
    const table = el("table", { class: "field-table" });
    const thead = el("thead");
    const htr = el("tr");
    ["#", T("field.name"), T("field.type"), T("field.length"), T("field.decimals"), ""].forEach((h) => htr.appendChild(el("th", { text: h })));
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = el("tbody");
    table.appendChild(tbody);

    const render = () => {
      tbody.replaceChildren();
      fields.forEach((f, i) => {
        const tr = el("tr");
        tr.appendChild(el("td", { text: String(i + 1) }));
        const nameCell = el("td");
        const nameIn = input({ value: f.name, maxlength: "10", style: "height:26px" });
        nameIn.addEventListener("input", () => {
          f.name = nameIn.value.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 10);
          nameIn.value = f.name;
        });
        nameCell.appendChild(nameIn);
        tr.appendChild(nameCell);
        const typeCell = el("td");
        const ty = select(TYPE_CHOICES, f.type);
        ty.style.height = "26px";
        ty.addEventListener("change", () => {
          f.type = ty.value;
          const range = LENGTH_RANGE[f.type] || [1, 254];
          f.length = Math.min(Math.max(f.length, range[0]), range[1]);
          render();
        });
        typeCell.appendChild(ty);
        tr.appendChild(typeCell);
        const lenCell = el("td");
        const lenIn = input({ type: "number", value: String(f.length), style: "height:26px" });
        lenIn.addEventListener("input", () => (f.length = Number(lenIn.value) || 1));
        lenCell.appendChild(lenIn);
        tr.appendChild(lenCell);
        const decCell = el("td");
        const decIn = input({ type: "number", value: String(f.decimals || 0), style: "height:26px" });
        decIn.disabled = !(f.type === "N" || f.type === "F");
        decIn.addEventListener("input", () => (f.decimals = Number(decIn.value) || 0));
        decCell.appendChild(decIn);
        tr.appendChild(decCell);
        const actCell = el("td");
        const delBtn = el("button", { class: "btn tiny danger", type: "button", text: "✕" });
        delBtn.addEventListener("click", () => {
          fields.splice(i, 1);
          render();
        });
        actCell.appendChild(delBtn);
        tr.appendChild(actCell);
        tbody.appendChild(tr);
      });
    };
    render();

    presetSelect.addEventListener("change", () => {
      const p = PRESETS[presetSelect.value] || [];
      fields = p.map((f) => Object.assign({}, f));
      render();
    });

    const addBtn = el("button", { class: "btn tiny", type: "button", text: "+ " + T("field.add") });
    addBtn.addEventListener("click", () => {
      fields.push({ name: "FIELD" + (fields.length + 1), type: "C", length: 20, decimals: 0 });
      render();
    });

    const body = el("div", {});
    const grid = el("div", { class: "form-grid" });
    grid.appendChild(formRow(T("dlg.newTable.name"), nameInput));
    grid.appendChild(formRow(T("dlg.newTable.preset"), presetSelect));
    grid.appendChild(formRow(T("dlg.newTable.version"), versionSelect));
    body.appendChild(grid);
    const wrap = el("div", { style: "max-height:44vh;overflow:auto;border:1px solid var(--border);border-radius:7px" });
    wrap.appendChild(table);
    body.appendChild(wrap);
    body.appendChild(addBtn);

    App.modal({
      title: T("dlg.newTable.title"),
      body,
      wide: true,
      actions: [
        { label: T("common.cancel") },
        {
          label: T("common.ok"),
          primary: true,
          onClick: () => {
            if (!fields.length) {
              App.toast(T("dlg.field.invalidName"), "err");
              return false;
            }
            try {
              const version = Number(versionSelect.value) || 3;
              const out = DBF.buildDbf({ fields, rows: [], encoding: "gbk", version });
              if (App.state && App.state.prefs) {
                App.state.prefs.newVersion = version;
                if (App.savePrefsDebounced) App.savePrefsDebounced();
              }
              App.adopt(nameInput.value.trim() || "NEWTABLE_" + dateStamp() + ".DBF", out.bytes);
            } catch (err) {
              App.toast(String(err.message || err), "err");
              return false;
            }
            return true;
          },
        },
      ],
    });
  }

  /* ---------------------------------------------------------------- columns */

  function columnsMenu(anchor) {
    const state = App.state;
    if (!state.header) return;
    const items = [
      { text: T("col.showAll"), onClick: () => {
        state.view.hidden.clear();
        App.renderAll();
      } },
      { text: T("col.hideAll"), onClick: () => {
        state.view.hidden = new Set(state.header.fields.map((f) => f.name).slice(1));
        App.renderAll();
      } },
      { sep: true },
      { label: T("panel.structure") },
    ];
    for (const f of state.header.fields) {
      items.push({
        text: f.name,
        hint: f.type + f.length,
        checkable: true,
        checked: !state.view.hidden.has(f.name),
        onClick: () => {
          if (state.view.hidden.has(f.name)) state.view.hidden.delete(f.name);
          else state.view.hidden.add(f.name);
          App.renderAll();
        },
      });
    }
    items.push({ sep: true }, { text: T("col.fit"), onClick: () => {
      for (const f of App.visibleFields()) {
        let max = f.name.length + 4;
        for (const idx of App.pageRows().slice(0, 200)) {
          const v = String(state.rows[idx].v[f.index] || "");
          let w = 0;
          for (const ch of v) w += ch.charCodeAt(0) > 255 ? 2 : 1;
          if (w > max) max = w;
        }
        state.view.widths[f.name] = Math.max(52, Math.min(360, max * 7 + 22));
      }
      App.renderGrid();
    } });
    App.menu(anchor, items);
  }

  function columnsDialog() {
    columnsMenu(document.querySelector("#columnsBtn"));
  }

  /* --------------------------------------------------------------- encoding */

  /** decode the first text cells with a candidate encoding, for the dialog preview */
  function encodingSample(enc) {
    const state = App.state;
    const DBF = g.DBF;
    const header = state.header;
    if (!header || !state.buf) return [];
    const fields = header.fields.filter((f) => f.kind === "text" && f.length >= 2).slice(0, 4);
    if (!fields.length) return [];
    const count = Math.min(state.rows.length, 3);
    const out = [];
    for (let r = 0; r < count; r += 1) {
      const base = header.headerLength + r * header.recordLength;
      const cells = [];
      for (const f of fields) {
        let text = "";
        try {
          text = String(DBF.decodeBytes(state.buf.subarray(base + f.offset, base + f.offset + f.length), enc) || "").trim();
        } catch (err) {
          text = "";
        }
        cells.push(text || T("common.empty"));
      }
      out.push(cells.join("  ·  "));
    }
    return out;
  }

  function encName(id) {
    return id === "gbk" ? "GBK" : String(id || "").toUpperCase();
  }

  function encodingDialog() {
    const state = App.state;
    if (!state.header) return;
    const DBF = g.DBF;
    const autoEnc = DBF.normEncoding(state.autoEncoding || state.encoding);
    const fileName = state.source ? state.source.name : "";
    const remembered = (state.prefs.encodings || {})[fileName] || "";
    let pickd = state.manualEncoding || "auto";

    const body = el("div", { class: "form" });
    body.appendChild(el("p", { class: "form-hint", text: T("enc.dialogHint") }));

    const list = el("div", { class: "choice-list" });
    const preview = el("pre", { class: "enc-preview" });
    const previewWrap = el("div", { class: "enc-preview-wrap" });

    const renderPreview = () => {
      const enc = pickd === "auto" ? autoEnc : pickd;
      const lines = encodingSample(enc);
      preview.textContent = lines.length ? lines.join("\n") : T("enc.previewEmpty");
      preview.classList.toggle("is-empty", !lines.length);
      previewWrap.title = encName(enc);
    };

    const addChoice = (id, label, current) => {
      const row = el("label", { class: "choice-item" });
      const radio = el("input", { type: "radio", name: "encpick", value: id });
      radio.checked = id === pickd;
      radio.addEventListener("change", () => {
        pickd = id;
        renderPreview();
      });
      row.appendChild(radio);
      row.appendChild(el("span", { text: label }));
      if (current) row.appendChild(el("span", { class: "badge", text: T("dlg.version.current") }));
      list.appendChild(row);
    };

    addChoice("auto", T("enc.autoItem", { enc: encName(autoEnc) }), !state.manualEncoding);
    DBF.ENCODING_CHOICES.forEach((c) => {
      const id = DBF.normEncoding(c.id);
      addChoice(id, c.label, !!state.manualEncoding && state.manualEncoding === id);
    });
    body.appendChild(list);

    const rememberBox = el("label", { class: "check-row" });
    const rememberInput = el("input", { type: "checkbox" });
    rememberInput.checked = !!remembered || !!state.manualEncoding;
    if (state.manualEncoding) rememberInput.checked = true;
    rememberBox.appendChild(rememberInput);
    rememberBox.appendChild(el("span", { text: T("enc.remember") }));
    body.appendChild(rememberBox);

    if (remembered) {
      const forget = el("button", { class: "btn tiny ghost", type: "button", text: T("enc.forget") });
      forget.addEventListener("click", () => {
        App.rememberEncoding(fileName, "");
        forget.remove();
        App.toast(T("enc.forget"), "ok");
      });
      body.appendChild(forget);
    }

    body.appendChild(el("div", { class: "enc-preview-label", text: T("enc.preview") }));
    previewWrap.appendChild(preview);
    body.appendChild(previewWrap);
    renderPreview();

    App.modal({
      title: T("enc.dialogTitle"),
      body,
      actions: [
        { label: T("common.cancel"), onClick: () => {} },
        {
          label: T("enc.apply"),
          primary: true,
          onClick: async () => {
            const want = pickd === "auto" ? "auto" : DBF.normEncoding(pickd);
            const remember = rememberInput.checked;
            if (want === "auto" && !state.manualEncoding) {
              App.rememberEncoding(fileName, "");
              App.toast(T("enc.changed", { enc: encName(autoEnc) }), "ok");
              return;
            }
            await App.reopenWithEncoding(want, remember);
          },
        },
      ],
    });
  }

  /* ------------------------------------------------------------------ about */

  function aboutDialog() {
    const body = el("div", {});
    body.appendChild(el("p", { class: "form-hint", style: "font-size:12.5px;line-height:1.7", text: T("dlg.about.body") }));
    const dl = el("div", { class: "info-list", style: "padding:0" });
    const dict = g.DBF_DICT;
    const dictText = dict
      ? T("dlg.about.dictValue", { sz: dict.size, files: dict.gsssFiles, gsss: dict.gsssSize })
      : "";
    const repo = "https://github.com/qingkong9579/dbx.dbf";
    const rows = [
      [T("dlg.about.version"), "0.3.5"],
      [T("dlg.about.author"), T("dlg.about.authorName")],
      [T("dlg.about.source"), repo, true],
      [T("info.version"), "DBF II / III / IV / FoxPro 2.x / 2.5"],
      [T("dlg.about.dict"), dictText],
      [T("dlg.about.ref"), "EasyDBF · DBF Viewer Plus"],
    ];
    for (const [k, v, copyable] of rows) {
      const row = el("div", { class: "info-row" });
      row.appendChild(el("dt", { text: k }));
      const dd = el("dd", { text: v });
      if (copyable) {
        dd.style.display = "flex";
        dd.style.alignItems = "center";
        dd.style.gap = "8px";
        dd.style.wordBreak = "break-all";
        const text = el("span", { text: v });
        text.style.flex = "1";
        const btn = el("button", { class: "btn tiny ghost", type: "button", text: T("common.copy") });
        btn.addEventListener("click", async () => {
          const ok = await App.host.copy(v);
          if (ok) App.toast(T("common.copied"), "ok");
        });
        dd.replaceChildren(text, btn);
      }
      row.appendChild(dd);
      dl.appendChild(row);
    }
    body.appendChild(dl);
    App.modal({ title: T("dlg.about.title"), body, actions: [{ label: T("common.close"), primary: true }] });
  }

  /* ----------------------------------------------------------------- expose */

  App.openFieldDialog = openFieldDialog;
  App.dropField = dropField;
  App.exportDialog = exportDialog;
  App.importCsvDialog = importCsvDialog;
  App.newTableDialog = newTableDialog;
  App.columnsMenu = columnsMenu;
  App.columnsDialog = columnsDialog;
  App.encodingDialog = encodingDialog;
  App.aboutDialog = aboutDialog;
  App.__el = function (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      for (const c of Array.isArray(children) ? children : [children]) {
        if (c === null || c === undefined) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
