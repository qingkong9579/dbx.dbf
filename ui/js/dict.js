/*!
 * DBF Studio — dict.js（逻辑层）
 *
 * 只负责「怎么解释一个字段名」：文件族判定、来源与置信度、前缀/后缀提示。
 * 列名 ↔ 中文名的数据全部在 columns-cn.js（g.DBF_COLUMNS）：
 *   sz / s68 / req / gsss{spec,order,union,files} / markets / user
 * 想加字段释义：改数据文件（或运行期导入 JSON），不需要动这里的规则。
 */
(function (g) {
  "use strict";

  const FAMILIES = [
    { test: /^SJSJG/i, id: "SJSJG", label: "结算明细结果库", spec: "深市 D-COM" },
    { test: /^SJSMX/i, id: "SJSMX", label: "清算明细库", spec: "深市 D-COM" },
    { test: /^SJSQS/i, id: "SJSQS", label: "清算数据文件", spec: "深市 D-COM" },
    { test: /^SJSZJ/i, id: "SJSZJ", label: "资金交收数据文件", spec: "深市 D-COM" },
    { test: /^SJSYE/i, id: "SJSYE", label: "资金余额数据文件", spec: "深市 D-COM" },
    { test: /^SJSGB/i, id: "SJSGB", label: "广播类信息库", spec: "深市 D-COM" },
    { test: /^SJSFW/i, id: "SJSFW", label: "综合数据服务库", spec: "深市 D-COM" },
    { test: /^SJSDZ/i, id: "SJSDZ", label: "对账数据文件", spec: "深市 D-COM" },
    { test: /^SJSJX/i, id: "SJSJX", label: "交易数据文件", spec: "深市 D-COM" },
    { test: /^SJSKS/i, id: "SJSKS", label: "扣收数据文件", spec: "深市 D-COM" },
    { test: /^SJSFX/i, id: "SJSFX", label: "费用数据文件", spec: "深市 D-COM" },
    { test: /^SJSDP/i, id: "SJSDP", label: "解冻/批次数据文件", spec: "深市 D-COM" },
    { test: /^ZSMXSB/i, id: "ZSMXSB", label: "征税明细申报库", spec: "深市 股息红利差别化征税" },
    { test: /^ZSMXFK/i, id: "ZSMXFK", label: "征税明细反馈库", spec: "深市 股息红利差别化征税" },
    { test: /^ZSMX/i, id: "ZSMX", label: "征税明细信息库", spec: "深市 股息红利差别化征税" },
    { test: /^SZSDS/i, id: "SZSDS", label: "个人股东转让限售股所得税明细", spec: "深市" },
    { test: /^SZYCTZ/i, id: "SZYCTZ", label: "临时停市延迟清算通知库", spec: "深市" },
    { test: /^DSFQS/i, id: "DSFQS", label: "代收付清算数据", spec: "深市 代收付" },
    { test: /^DSFMX/i, id: "DSFMX", label: "代收付明细数据", spec: "深市 代收付" },
    { test: /^DSFFK/i, id: "DSFFK", label: "代收付反馈数据", spec: "深市 代收付" },
    { test: /^BHJG/i, id: "BHJG", label: "备付金结果数据", spec: "深市" },
    { test: /^BHDZ/i, id: "BHDZ", label: "备付金对账数据", spec: "深市" },
    { test: /^LOFJS/i, id: "LOFJS", label: "LOF 基金清算数据", spec: "深市" },
    { test: /^FJYBS/i, id: "FJYBS", label: "非交易过户申报数据", spec: "深市" },
    { test: /^S68/i, id: "S68", label: "登记结算申报文件", spec: "沪市 PROP（描述为推断）" },
    { test: /^REQ$/i, id: "REQ", label: "文件传输请求表", spec: "沪市 PROP（描述为推断）" },
    { test: /^GH\d+/i, id: "GH", label: "竞价过户数据文件", spec: "沪市 IS124" },
  ];

  /* 字段名前缀（深市/沪市 通用约定） */
  const PREFIXES = {
    MX: "明细",
    JG: "结果",
    ZJ: "资金",
    QS: "清算",
    DZ: "对账",
    YE: "余额",
    GB: "广播",
    FW: "服务",
    KS: "扣收",
    FX: "费用",
    DP: "解冻",
    SB: "申报",
    FK: "反馈",
    JS: "结算",
    PC: "批次",
    TZ: "通知",
    BS: "标识",
    QY: "权益",
    ZS: "征税",
    BH: "备付金",
  };

  /* 除中文名外的通用语义提示：字段名后缀 -> 期望格式 */
  const SUFFIX_HINTS = [
    { test: /RQ$|DATE$/, hint: "日期 YYYYMMDD" },
    { test: /SJ$|TIME$/, hint: "时间 HHMMSS" },
    { test: /JE$|AMT$|AMOUNT$/, hint: "金额，两位小数" },
    { test: /SL$|QTY$|NUM$|COUNT$/, hint: "数量" },
    { test: /JG$|PRICE$/, hint: "价格" },
    { test: /DM$|CODE$/, hint: "代码，左补零" },
    { test: /ZH$|ACCT$|ACCOUNT$/, hint: "账户号码" },
    { test: /BZ$|MEMO$|REMARK$/, hint: "备注" },
    { test: /PC$|BATCH$/, hint: "批次号" },
    { test: /LSH$|SEQ$/, hint: "流水号" },
  ];

  const EMPTY = { sz: {}, s68: {}, req: {}, gsss: { spec: "", order: [], union: {}, files: {} }, markets: {}, user: {}, meta: {} };

  function data() {
    return g.DBF_COLUMNS || EMPTY;
  }

  function gsss() {
    const d = data();
    return d.gsss || EMPTY.gsss;
  }

  function userMap() {
    const d = data();
    if (!d.user || typeof d.user !== "object") d.user = {};
    return d.user;
  }

  function baseName(fileName) {
    return String(fileName || "")
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, "");
  }

  /* 上市公司版文件：前缀 + 证券代码（5~6 位）+ [股份性质][日期][其它] */
  function gsssOf(base) {
    const up = String(base || "").toUpperCase();
    const order = gsss().order || [];
    for (const code of order) {
      if (!up.startsWith(code)) continue;
      if (/^\d{5}/.test(up.slice(code.length))) return code;
    }
    return null;
  }

  function familyOf(fileName) {
    const base = baseName(fileName);
    const code = gsssOf(base);
    if (code) {
      const f = (gsss().files || {})[code];
      return { id: "GSSS:" + code, label: f ? f.label : code, spec: gsss().spec, gsss: code };
    }
    for (const f of FAMILIES) if (f.test.test(base)) return f;
    return null;
  }

  /* 字段名 -> 值域解码（仅用于少量含义明确的代码字段） */
  function describeValue(fieldName, value) {
    const up = String(fieldName || "").toUpperCase();
    const raw = String(value === null || value === undefined ? "" : value).trim();
    if (!raw) return "";
    const markets = data().markets || {};
    if (up === "SCDM" || up === "SCDM_1" || up === "MARKET") {
      if (markets[raw]) return markets[raw];
      const up2 = raw.toUpperCase();
      if (markets[up2]) return markets[up2];
      return "";
    }
    return "";
  }

  function describeField(fileName, fieldName) {
    const up = String(fieldName || "").toUpperCase();
    const d = data();
    const fam = familyOf(fileName);
    const spec = gsss();
    let entry = null;
    let source = "";
    const custom = userMap()[up];
    if (custom) {
      entry = { cn: String(custom), confidence: "custom" };
      source = "自定义释义";
    } else if (fam && fam.gsss) {
      const own = ((spec.files || {})[fam.gsss] || {}).fields || {};
      if (own[up]) {
        entry = { cn: own[up], confidence: "spec" };
        source = spec.spec || "";
      } else if ((spec.union || {})[up]) {
        entry = { cn: spec.union[up], confidence: "spec" };
        source = (spec.spec || "") + "（同类文件）";
      }
    } else if (fam && fam.id === "S68" && d.s68[up]) {
      entry = { cn: d.s68[up], confidence: "inferred" };
      source = "沪市 PROP 推断";
    } else if (fam && fam.id === "REQ" && d.req[up]) {
      entry = { cn: d.req[up], confidence: "inferred" };
      source = "沪市 PROP 推断";
    } else if (d.sz[up]) {
      entry = { cn: d.sz[up], confidence: "spec" };
      source = "深市接口规范 5.18";
    }
    const prefix = up.slice(0, 2);
    const suffixHint = (SUFFIX_HINTS.find((s) => s.test.test(up)) || {}).hint || "";
    const known = !!entry;
    return {
      cn: entry ? entry.cn : "",
      confidence: entry ? entry.confidence : "",
      source,
      prefix: known ? "" : PREFIXES[prefix] || "",
      hint: known ? "" : suffixHint,
      family: fam ? { label: fam.label, spec: fam.spec } : null,
      custom: !!(entry && entry.confidence === "custom"),
    };
  }

  /* ---- 运行期自定义释义（导入 JSON / 手工维护） ---- */

  function normalizeName(name) {
    return String(name || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "")
      .slice(0, 10);
  }

  /* 接受 {NAME:"中文"} / {columns:{NAME:"中文"}} / [{name,cn}] 三种形状 */
  function parseColumns(input) {
    const out = {};
    if (!input) return out;
    if (Array.isArray(input)) {
      for (const row of input) {
        if (!row || typeof row !== "object") continue;
        const name = normalizeName(row.name || row.field || row.column);
        const cn = String(row.cn || row.label || row.title || "").trim();
        if (name && cn) out[name] = cn;
      }
      return out;
    }
    if (typeof input !== "object") return out;
    const src = input.columns && typeof input.columns === "object" ? input.columns : input.fields && typeof input.fields === "object" ? input.fields : input;
    for (const [k, v] of Object.entries(src)) {
      if (k === "meta" || k === "$schema") continue;
      const name = normalizeName(k);
      const cn = typeof v === "string" ? v.trim() : v && typeof v === "object" ? String(v.cn || v.label || "").trim() : "";
      if (name && cn) out[name] = cn;
    }
    return out;
  }

  function setUser(input, mode) {
    const parsed = parseColumns(input);
    if (mode === "replace") {
      Object.keys(userMap()).forEach((k) => delete userMap()[k]);
    }
    Object.assign(userMap(), parsed);
    return Object.keys(parsed).length;
  }

  function clearUser() {
    const map = userMap();
    Object.keys(map).forEach((k) => delete map[k]);
  }

  function userColumns() {
    return Object.assign({}, userMap());
  }

  g.DBF_DICT = {
    FAMILIES,
    PREFIXES,
    get MARKETS() {
      return data().markets || {};
    },
    get SZ_FIELDS() {
      return data().sz || {};
    },
    get S68_FIELDS() {
      return data().s68 || {};
    },
    get REQ_FIELDS() {
      return data().req || {};
    },
    get GSSS_FILES() {
      return gsss().files || {};
    },
    get GSSS_ORDER() {
      return gsss().order || [];
    },
    get GSSS_UNION() {
      return gsss().union || {};
    },
    get GSSS_SPEC() {
      return gsss().spec || "";
    },
    familyOf,
    describeField,
    describeValue,
    parseColumns,
    setUser,
    clearUser,
    userColumns,
    get size() {
      return Object.keys(data().sz || {}).length;
    },
    get gsssSize() {
      return Object.keys(gsss().union || {}).length;
    },
    get gsssFiles() {
      return (gsss().order || []).length;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
