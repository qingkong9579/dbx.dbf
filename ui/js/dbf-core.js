/*!
 * DBF Studio — dbf-core.js
 * Pure DBF/dBase/FoxPro/VFP reader, writer, exporter and validator.
 * No DOM, no host APIs: usable from the plugin UI and from Node for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DBF = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------------------------------------------------------------- types */

  const VERSIONS = {
    0x02: { name: "dBase II", memo: null, long: false },
    0x03: { name: "dBase III+", memo: "dbt", long: false },
    0x04: { name: "dBase IV", memo: null, long: false },
    0x05: { name: "dBase V", memo: null, long: false },
    0x07: { name: "Visual Objects", memo: "dbt", long: false },
    0x30: { name: "Visual FoxPro", memo: "fpt", long: true },
    0x31: { name: "Visual FoxPro (autoinc)", memo: "fpt", long: true },
    0x32: { name: "Visual FoxPro (varchar)", memo: "fpt", long: true },
    0x43: { name: "dBase IV SQL table", memo: "dbt", long: false },
    0x63: { name: "dBase IV SQL system", memo: "dbt", long: false },
    0x83: { name: "dBase III+ (memo)", memo: "dbt", long: false },
    0x8b: { name: "dBase IV (memo)", memo: "dbt", long: false },
    0x8e: { name: "dBase IV SQL (memo)", memo: "dbt", long: false },
    0xf5: { name: "FoxPro 2.x (memo)", memo: "fpt", long: false },
    0xfb: { name: "FoxBASE", memo: "dbt", long: false },
  };

  const TYPE_INFO = {
    C: { kind: "text", label: "Character", fixed: false },
    N: { kind: "number", label: "Numeric", fixed: true },
    F: { kind: "number", label: "Float", fixed: true },
    D: { kind: "date", label: "Date", fixed: true },
    L: { kind: "logical", label: "Logical", fixed: true },
    M: { kind: "memo", label: "Memo", fixed: false },
    B: { kind: "binary", label: "Double/Binary", fixed: true },
    G: { kind: "binary", label: "General/OLE", fixed: true },
    I: { kind: "integer", label: "Integer", fixed: true },
    T: { kind: "datetime", label: "DateTime", fixed: true },
    Y: { kind: "currency", label: "Currency", fixed: true },
    P: { kind: "binary", label: "Picture", fixed: false },
    O: { kind: "binary", label: "Double", fixed: true },
    V: { kind: "text", label: "Varchar", fixed: false },
    X: { kind: "binary", label: "NullFlags", fixed: true },
    "@": { kind: "datetime", label: "Timestamp", fixed: true },
    "+": { kind: "integer", label: "AutoIncrement", fixed: true },
  };

  const LDID = {
    0x01: { enc: "cp437", label: "US MS-DOS (437)" },
    0x02: { enc: "cp850", label: "International MS-DOS (850)" },
    0x03: { enc: "windows-1252", label: "Windows ANSI (1252)" },
    0x04: { enc: "macintosh", label: "Standard Macintosh" },
    0x08: { enc: "cp865", label: "Danish MS-DOS (865)" },
    0x09: { enc: "cp437", label: "Dutch MS-DOS (437)" },
    0x0a: { enc: "cp850", label: "Dutch MS-DOS (850)" },
    0x0b: { enc: "cp437", label: "Finnish MS-DOS (437)" },
    0x0d: { enc: "cp437", label: "French MS-DOS (437)" },
    0x0e: { enc: "cp850", label: "French MS-DOS (850)" },
    0x0f: { enc: "cp437", label: "German MS-DOS (437)" },
    0x10: { enc: "cp850", label: "German MS-DOS (850)" },
    0x11: { enc: "cp437", label: "Italian MS-DOS (437)" },
    0x12: { enc: "cp850", label: "Italian MS-DOS (850)" },
    0x13: { enc: "cp932", label: "Japanese Shift-JIS (932)" },
    0x14: { enc: "cp850", label: "Spanish MS-DOS (850)" },
    0x15: { enc: "cp437", label: "Swedish MS-DOS (437)" },
    0x16: { enc: "cp850", label: "Swedish MS-DOS (850)" },
    0x17: { enc: "cp865", label: "Norwegian MS-DOS (865)" },
    0x18: { enc: "cp437", label: "Spanish MS-DOS (437)" },
    0x19: { enc: "cp437", label: "English MS-DOS (437)" },
    0x1a: { enc: "cp850", label: "English MS-DOS (850)" },
    0x1b: { enc: "cp437", label: "Czech MS-DOS (437)" },
    0x1c: { enc: "cp850", label: "Czech MS-DOS (850)" },
    0x1d: { enc: "cp437", label: "French MS-DOS (437)" },
    0x1f: { enc: "cp852", label: "Polish MS-DOS (852)" },
    0x22: { enc: "cp852", label: "Turkish MS-DOS (852)" },
    0x23: { enc: "cp852", label: "Turkish MS-DOS (852)" },
    0x24: { enc: "cp860", label: "Portuguese MS-DOS (860)" },
    0x25: { enc: "cp850", label: "Portuguese MS-DOS (850)" },
    0x26: { enc: "cp866", label: "Russian MS-DOS (866)" },
    0x37: { enc: "cp850", label: "English ANSI (1252)" },
    0x40: { enc: "cp852", label: "Roman MS-DOS (852)" },
    0x4d: { enc: "gbk", label: "Chinese GBK / CP936" },
    0x50: { enc: "cp874", label: "Thai (874)" },
    0x57: { enc: "windows-1252", label: "ANSI (1252)" },
    0x58: { enc: "windows-1252", label: "Western European ANSI (1252)" },
    0x59: { enc: "windows-1252", label: "Spanish ANSI (1252)" },
    0x64: { enc: "cp852", label: "Eastern European MS-DOS (852)" },
    0x65: { enc: "cp865", label: "Nordic MS-DOS (865)" },
    0x66: { enc: "cp866", label: "Russian MS-DOS (866)" },
    0x67: { enc: "cp861", label: "Icelandic MS-DOS (861)" },
    0x6a: { enc: "cp737", label: "Greek MS-DOS (737)" },
    0x6b: { enc: "cp857", label: "Turkish MS-DOS (857)" },
    0x6c: { enc: "cp863", label: "Canadian French MS-DOS (863)" },
    0x78: { enc: "cp950", label: "Chinese Traditional Big5 (950)" },
    0x79: { enc: "cp949", label: "Korean (949)" },
    0x7a: { enc: "cp936", label: "Chinese GBK (936)" },
    0x7b: { enc: "cp932", label: "Japanese Shift-JIS (932)" },
    0x7c: { enc: "cp874", label: "Thai (874)" },
    0x7d: { enc: "windows-1255", label: "Hebrew (1255)" },
    0x7e: { enc: "windows-1256", label: "Arabic (1256)" },
    0x86: { enc: "cp737", label: "Greek MS-DOS (737)" },
    0x87: { enc: "cp852", label: "Slavic MS-DOS (852)" },
    0x88: { enc: "cp857", label: "Turkish MS-DOS (857)" },
    0xc8: { enc: "windows-1250", label: "Eastern European Windows (1250)" },
    0xc9: { enc: "windows-1251", label: "Russian Windows (1251)" },
    0xca: { enc: "windows-1254", label: "Turkish Windows (1254)" },
    0xcb: { enc: "windows-1253", label: "Greek Windows (1253)" },
    0xcc: { enc: "windows-1257", label: "Baltic Windows (1257)" },
  };

  const ENCODING_CHOICES = [
    { id: "gbk", label: "简体中文 GBK / GB18030", ldid: 0x4d },
    { id: "utf-8", label: "UTF-8", ldid: 0x00 },
    { id: "cp950", label: "繁體中文 Big5 (950)", ldid: 0x78 },
    { id: "cp932", label: "日本語 Shift-JIS (932)", ldid: 0x7b },
    { id: "cp949", label: "한국어 (949)", ldid: 0x79 },
    { id: "windows-1252", label: "Western ANSI (1252)", ldid: 0x03 },
    { id: "cp437", label: "US MS-DOS (437)", ldid: 0x01 },
    { id: "cp866", label: "Русский (866)", ldid: 0x26 },
  ];

  /** language driver id for an encoding id (falls back to 0x00 = unspecified) */
  function encodingLdid(enc) {
    const id = normEncoding(enc);
    for (let i = 0; i < ENCODING_CHOICES.length; i += 1) {
      if (ENCODING_CHOICES[i].id === id) return ENCODING_CHOICES[i].ldid;
    }
    return 0x00;
  }

  const ENC_ALIAS = {
    "cp936": "gbk",
    "gb2312": "gbk",
    "gb18030": "gbk",
    "x-gbk": "gbk",
    "ansi": "windows-1252",
    "latin1": "windows-1252",
    "iso-8859-1": "windows-1252",
    "ascii": "windows-1252",
  };

  function normEncoding(enc) {
    if (!enc) return "windows-1252";
    const e = String(enc).toLowerCase();
    return ENC_ALIAS[e] || e;
  }

  const decoderCache = new Map();
  function decoder(enc) {
    const name = normEncoding(enc);
    if (!decoderCache.has(name)) {
      let d = null;
      try {
        d = new TextDecoder(name);
      } catch (_) {
        d = new TextDecoder("utf-8");
      }
      decoderCache.set(name, d);
    }
    return decoderCache.get(name);
  }

  function decodeBytes(bytes, enc) {
    if (!bytes || bytes.length === 0) return "";
    return decoder(enc).decode(bytes);
  }

  /* ------------------------------------------------------------- encoding */

  let gbkReverse = null;

  function gbkTable() {
    const src = (typeof globalThis !== "undefined" && (globalThis.__DBF_GBK_B64__ || null)) || null;
    if (!src) return null;
    if (!gbkReverse) {
      const bin = typeof atob === "function" ? atob(src) : Buffer.from(src, "base64").toString("binary");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i) & 0xff;
      const text = new TextDecoder("utf-16le").decode(bytes);
      gbkReverse = new Map();
      for (let i = 0; i < text.length; i += 1) {
        const ch = text.charCodeAt(i);
        if (!ch || ch === 0xffff || ch === 0xfffd) continue;
        const lead = 0x81 + Math.floor(i / 191);
        const trail = 0x40 + (i % 191);
        if (lead > 0xfe || trail > 0xfe) break;
        gbkReverse.set(ch, [lead, trail]);
      }
      // single byte ASCII plane
      for (let c = 0x20; c < 0x80; c += 1) gbkReverse.set(c, [c]);
    }
    return gbkReverse;
  }

  function encodeText(str, enc) {
    const s = str == null ? "" : String(str);
    const name = normEncoding(enc);
    if (name === "utf-8") {
      const out = [];
      for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (cp < 0x80) out.push(cp);
        else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
        else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
      return Uint8Array.from(out);
    }
    if (name === "gbk") {
      const table = gbkTable();
      if (table) {
        const out = [];
        for (const ch of s) {
          const cp = ch.codePointAt(0);
          const hit = table.get(cp);
          if (hit) { for (let k = 0; k < hit.length; k += 1) out.push(hit[k]); }
          else out.push(0x3f); // '?'
        }
        return Uint8Array.from(out);
      }
      // fall through to utf-8 when the table is unavailable
      return encodeText(s, "utf-8");
    }
    if (name === "windows-1252") {
      const out = [];
      for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
        else out.push(0x3f);
      }
      return Uint8Array.from(out);
    }
    // unsupported encoder: keep what survives as UTF-8 bytes is wrong for the
    // target charset, so degrade to '?' per non-ASCII char (data stays readable
    // in ASCII and the UI warns before saving).
    const out = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      out.push(cp < 0x80 ? cp : 0x3f);
    }
    return Uint8Array.from(out);
  }

  function canEncode(enc) {
    const name = normEncoding(enc);
    if (name === "utf-8" || name === "windows-1252") return true;
    if (name === "gbk") return !!gbkTable();
    return false;
  }

  /* ---------------------------------------------------------------- dates */

  function pad(n, w) {
    let s = String(n);
    while (s.length < w) s = "0" + s;
    return s;
  }

  function julianToDate(days) {
    // VFP DateTime/T: days since 4713-01-01 BC (Julian day number)
    let j = Math.floor(days) + 1721425 + 1;
    let a = j;
    if (j > 2299160) {
      const alpha = Math.floor((j - 1867216.25) / 36524.25);
      a = j + 1 + alpha - Math.floor(alpha / 4);
    }
    const b = a + 1524;
    const c = Math.floor((b - 122.1) / 365.25);
    const d = Math.floor(365.25 * c);
    const e = Math.floor((b - d) / 30.6001);
    const day = b - d - Math.floor(30.6001 * e);
    const month = e < 14 ? e - 1 : e - 13;
    const year = month > 2 ? c - 4716 : c - 4715;
    return { y: year, m: month, d: day };
  }

  function dateToYmd(s) {
    const v = String(s || "").trim();
    if (/^\d{8}$/.test(v)) {
      const y = +v.slice(0, 4);
      const m = +v.slice(4, 6);
      const d = +v.slice(6, 8);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d };
    }
    const m2 = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m2) return { y: +m2[1], m: +m2[2], d: +m2[3] };
    return null;
  }

  function fmtDate(raw) {
    const p = dateToYmd(raw);
    return p ? `${pad(p.y, 4)}-${pad(p.m, 2)}-${pad(p.d, 2)}` : String(raw || "").trim();
  }

  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  function isValidDate(y, m, d) {
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }

  /* --------------------------------------------------------------- header */

  function sniffTrue(buf) {
    // true when the payload looks like strict UTF-8 and contains non-ASCII
    const sample = buf.length > 65536 ? buf.subarray(0, 65536) : buf;
    let nonAscii = 0;
    for (let i = 0; i < sample.length; i += 1) if (sample[i] & 0x80) { nonAscii += 1; }
    if (!nonAscii) return null;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample);
      return "utf-8";
    } catch (_) {
      return null;
    }
  }

  function parseHeader(buf) {
    if (!buf || buf.length < 32) throw new Error("File is too small to be a DBF table");
    const version = buf[0];
    const vs = VERSIONS[version] || { name: "Unknown (" + version.toString(16) + ")", memo: null, long: false };
    const headerLength = u16(buf, 8);
    const recordLength = u16(buf, 10);
    if (headerLength < 33 || headerLength > buf.length) {
      throw new Error("Invalid DBF header length (" + headerLength + ")");
    }
    if (recordLength < 1) throw new Error("Invalid DBF record length");
    const ldid = buf[29];
    const ldidInfo = LDID[ldid] || null;
    const fields = [];
    let p = 32;
    let offset = 1;
    while (p + 32 <= headerLength && p + 32 <= buf.length) {
      if (buf[p] === 0x0d) break;
      let nameEnd = p;
      while (nameEnd < p + 11 && buf[nameEnd] !== 0) nameEnd += 1;
      const rawName = decodeBytes(buf.subarray(p, nameEnd), "windows-1252");
      const name = rawName.trim();
      const type = String.fromCharCode(buf[p + 11] || 0x20).toUpperCase();
      const length = buf[p + 16];
      const decimals = buf[p + 17];
      const flags = buf[p + 18];
      if (!name) break;
      const info = TYPE_INFO[type] || { kind: "unknown", label: type };
      fields.push({
        index: fields.length,
        name,
        type,
        kind: info.kind,
        typeLabel: info.label,
        length,
        decimals,
        offset,
        flags,
        nullable: !!(flags & 0x02),
        binary: !!(flags & 0x04),
        system: !!(flags & 0x01),
        rawName,
      });
      offset += length;
      p += 32;
    }
    if (!fields.length) throw new Error("No field descriptors found in header");
    const sumLen = fields.reduce((a, f) => a + f.length, 0) + 1;
    return {
      version,
      versionName: vs.name,
      memoExt: vs.memo,
      lastUpdate: { y: buf[1] ? buf[1] + 1900 : 0, m: buf[2], d: buf[3] },
      recordCount: u32(buf, 4),
      headerLength,
      recordLength,
      ldid,
      ldidLabel: ldidInfo ? ldidInfo.label : "Unspecified (0x" + pad(ldid.toString(16), 2) + ")",
      ldidEncoding: ldidInfo ? ldidInfo.enc : null,
      fields,
      declaredLength: sumLen,
      layoutValid: sumLen === recordLength,
      encrypted: buf[15] !== 0,
      mdx: buf[28] !== 0,
      hasMemo: fields.some((f) => f.kind === "memo"),
    };
  }

  function detectEncoding(header, recordBytes) {
    const sniffed = sniffTrue(recordBytes);
    if (sniffed) return { encoding: sniffed, source: "content" };
    if (header.ldidEncoding) {
      const enc = normEncoding(header.ldidEncoding);
      const supported = ["cp932", "cp950", "cp949", "cp874", "cp866", "cp852", "cp437", "cp850",
        "windows-1250", "windows-1251", "windows-1253", "windows-1254", "windows-1257", "gbk"];
      if (supported.indexOf(enc) >= 0) return { encoding: enc, source: "header" };
      return { encoding: enc, source: "header" };
    }
    // Unspecified LDID: this is what most Chinese exporters produce (GBK bytes
    // with ldid=0). Prefer GBK when high bytes are present in pairs.
    let high = 0;
    const lim = Math.min(recordBytes.length, 262144);
    for (let i = 0; i < lim; i += 1) if (recordBytes[i] & 0x80) high += 1;
    if (high / Math.max(1, lim) > 0.002) return { encoding: "gbk", source: "heuristic" };
    return { encoding: "windows-1252", source: "default" };
  }

  /* --------------------------------------------------------------- values */

  function dvOf(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function u16(bytes, offset) {
    return dvOf(bytes).getUint16(offset, true);
  }

  function u32(bytes, offset) {
    return dvOf(bytes).getUint32(offset, true);
  }

  function readDoubleLE(bytes) {
    return dvOf(bytes).getFloat64(0, true);
  }

  function readInt32LE(bytes) {
    return dvOf(bytes).getInt32(0, true);
  }

  function formatNumber(num, decimals) {
    if (!isFinite(num)) return "";
    if (!decimals) {
      // keep integers exact, avoid exponent notation
      return Math.abs(num) < 1e21 ? String(Math.round(num)) : String(num);
    }
    return num.toFixed(decimals);
  }

  function rawToDisplay(field, bytes, encoding) {
    switch (field.kind) {
      case "text":
        return decodeBytes(bytes, encoding).replace(/\u0000+$/g, "").replace(/\s+$/g, "");
      case "number": {
        const s = decodeBytes(bytes, encoding).trim();
        return s;
      }
      case "date":
        return fmtDate(decodeBytes(bytes, encoding).trim());
      case "logical": {
        const c = String.fromCharCode(bytes[0] || 0x20).toUpperCase();
        return c === "T" || c === "Y" ? "T" : c === "F" || c === "N" ? "F" : c === "?" ? "?" : "";
      }
      case "integer":
        return bytes.length >= 4 ? String(readInt32LE(bytes.subarray(0, 4))) : "";
      case "datetime": {
        if (bytes.length < 8) return "";
        const days = readInt32LE(bytes.subarray(0, 4));
        const ms = readInt32LE(bytes.subarray(4, 8));
        if (!days) return "";
        const d = julianToDate(days);
        const secs = Math.floor(ms / 1000);
        return `${pad(d.y, 4)}-${pad(d.m, 2)}-${pad(d.d, 2)} ${pad(Math.floor(secs / 3600), 2)}:${pad(Math.floor((secs % 3600) / 60), 2)}:${pad(secs % 60, 2)}`;
      }
      case "currency": {
        if (bytes.length < 8) return "";
        const lo = readInt32LE(bytes.subarray(0, 4));
        const hi = readInt32LE(bytes.subarray(4, 8));
        const v = (hi * 4294967296 + (lo >>> 0)) / 10000;
        return v.toFixed(4);
      }
      case "memo": {
        const s = decodeBytes(bytes, "windows-1252").replace(/\u0000/g, "").trim();
        return s;
      }
      default:
        return decodeBytes(bytes, encoding).replace(/\s+$/g, "");
    }
  }

  function memoPointer(field, bytes) {
    const s = decodeBytes(bytes, "windows-1252").replace(/[^\d]/g, "");
    if (!s) return 0;
    const n = parseInt(s, 10);
    return isFinite(n) ? n : 0;
  }

  /* ----------------------------------------------------------------- memo */

  function createMemoReader(kind, readRange) {
    // readRange(offset, length) -> Promise<Uint8Array>
    let state = null;
    return {
      kind,
      async init() {
        if (state) return state;
        if (kind === "fpt") {
          const head = await readRange(0, 512);
          if (!head || head.length < 12) throw new Error("Empty FPT memo file");
          // FoxPro FPT block header: nextFree(u32 BE), blockSize(u16 BE)
          const blockSize = (head[6] << 8) | head[7];
          state = { blockSize: blockSize >= 32 ? blockSize : 64, headerSize: 512 };
        } else {
          const head = await readRange(0, 512);
          let blockSize = 512;
          if (head && head.length >= 20) {
            const bs = u16(head, 20);
            if (bs >= 32 && bs <= 65535) blockSize = bs;
          }
          state = { blockSize, headerSize: 512 };
        }
        return state;
      },
      async read(blockNo) {
        if (!blockNo) return "";
        const st = await this.init();
        const offset = blockNo * st.blockSize;
        if (kind === "fpt") {
          const head = await readRange(offset, 8);
          if (!head || head.length < 8) return "";
          const type = (head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3];
          const len = (head[4] << 24) | (head[5] << 16) | (head[6] << 8) | head[7];
          if (type !== 1 && type !== 0) return "";
          if (!len || len > 8 * 1024 * 1024) return "";
          const body = await readRange(offset + 8, len);
          return decodeBytes(body, "windows-1252");
        }
        const chunk = await readRange(offset, Math.min(st.blockSize, 4096));
        if (!chunk || !chunk.length) return "";
        let end = chunk.length;
        for (let i = 0; i + 1 < chunk.length; i += 1) {
          if (chunk[i] === 0x1a && chunk[i + 1] === 0x1a) { end = i; break; }
        }
        const body = chunk.subarray(0, end);
        return decodeBytes(body, "windows-1252").replace(/\u0000/g, "").replace(/\s+$/, "");
      },
    };
  }

  /* --------------------------------------------------------------- writer */

  function makeDescriptor(field, offset) {
    const d = new Uint8Array(32);
    const name = encodeText(String(field.name || "").slice(0, 10), "windows-1252");
    d.set(name.subarray(0, 10), 0);
    d[11] = (field.type || "C").charCodeAt(0);
    d.set([offset & 0xff, (offset >> 8) & 0xff, (offset >> 16) & 0xff, (offset >> 24) & 0xff], 12);
    d[16] = field.length & 0xff;
    d[17] = (field.decimals || 0) & 0xff;
    d[18] = field.flags || 0;
    return d;
  }

  const MIN_BY_SIZE = {
    C: 1, N: 1, F: 1, D: 8, L: 1, M: 10, I: 4, T: 8, Y: 8, B: 8, G: 10, P: 10, V: 1,
  };

  /**
   * Build a DBF file from a plain table description.
   * rows: array of arrays of string|number|null (same order as fields)
   */
  function buildDbf(spec) {
    const fields = spec.fields.map((f, i) => {
      const type = (f.type || "C").toUpperCase();
      const info = TYPE_INFO[type] || TYPE_INFO.C;
      let length = f.length;
      if (!length) length = MIN_BY_SIZE[type] || 10;
      if (type === "D") length = 8;
      if (type === "L") length = 1;
      if (type === "M") length = 10;
      if (type === "I" || type === "Y" || type === "T" || type === "B") length = 4;
      if (type === "T" || type === "Y") length = 8;
      return {
        index: i,
        name: (f.name || "FIELD" + (i + 1)).toUpperCase(),
        type,
        kind: info.kind,
        length,
        decimals: type === "N" || type === "F" ? (f.decimals || 0) : 0,
        flags: 0,
      };
    });
    let offset = 1;
    for (const f of fields) { f.offset = offset; offset += f.length; }
    const recordLength = offset;
    const headerLength = 32 + fields.length * 32 + 1;
    const rows = spec.rows || [];
    const encoding = normEncoding(spec.encoding || "gbk");
    const total = headerLength + rows.length * recordLength + 1;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    out[0] = spec.version || (spec.hasMemo ? 0x83 : 0x03);
    const now = new Date();
    out[1] = (now.getFullYear() % 100) & 0xff;
    out[2] = now.getMonth() + 1;
    out[3] = now.getDate();
    dv.setUint32(4, rows.length, true);
    dv.setUint16(8, headerLength, true);
    dv.setUint16(10, recordLength, true);
    out[29] = spec.ldid != null ? spec.ldid : 0x4d;
    let p = 32;
    for (const f of fields) {
      out.set(makeDescriptor(f, f.offset), p);
      p += 32;
    }
    out[p] = 0x0d;
    p = headerLength;
    for (const row of rows) {
      const deleted = spec.deleted && spec.deleted[rows.indexOf(row)];
      out[p] = deleted ? 0x2a : 0x20;
      for (let fi = 0; fi < fields.length; fi += 1) {
        const f = fields[fi];
        const cell = row[fi];
        const at = p + f.offset;
        out.fill(0x20, at, at + f.length);
        if (cell == null || cell === "") {
          if (f.type === "D" || f.type === "L") out.fill(0x20, at, at + f.length);
          continue;
        }
        const bytes = cellToFieldBytes(f, cell, encoding);
        out.set(bytes.subarray(0, f.length), at);
      }
      p += recordLength;
    }
    out[p] = 0x1a;
    return { bytes: out, header: parseHeader(out), fields, recordLength, headerLength };
  }

  function cellToFieldBytes(field, cell, encoding) {
    const type = field.type;
    if (type === "N" || type === "F") {
      let s = String(cell).trim();
      const num = Number(s.replace(/,/g, ""));
      if (!isFinite(num)) return encodeText("", "windows-1252");
      s = field.decimals ? num.toFixed(field.decimals) : String(Math.round(num));
      if (s.length > field.length) s = field.decimals ? num.toFixed(Math.max(0, field.length - 2)) : s.slice(-field.length);
      return encodeText(s.padStart(field.length, " ").slice(0, field.length), "windows-1252");
    }
    if (type === "D") {
      const p = dateToYmd(cell);
      const s = p ? `${pad(p.y, 4)}${pad(p.m, 2)}${pad(p.d, 2)}` : "        ";
      return encodeText(s.slice(0, 8), "windows-1252");
    }
    if (type === "L") {
      const c = String(cell).trim().toUpperCase();
      const v = c === "T" || c === "Y" || c === "1" || c === "TRUE" ? "T"
        : c === "F" || c === "N" || c === "0" || c === "FALSE" ? "F" : " ";
      return encodeText(v, "windows-1252");
    }
    if (type === "I" || type === "Y" || type === "T") {
      const b = new Uint8Array(8);
      const dv = new DataView(b.buffer);
      if (type === "I") dv.setInt32(0, parseInt(cell, 10) || 0, true);
      if (type === "Y") dv.setFloat64(0, Number(cell) || 0, true);
      if (type === "T") dv.setFloat64(0, Number(cell) || 0, true);
      return b;
    }
    const s = String(cell);
    const bytes = encodeText(s, encoding);
    return bytes;
  }

  /* ------------------------------------------------------------- exports */

  function csvCell(v, sep, quoteAll) {
    const s = v == null ? "" : String(v);
    const mustQuote = quoteAll || s.indexOf(sep) >= 0 || s.indexOf('"') >= 0 ||
      s.indexOf("\n") >= 0 || s.indexOf("\r") >= 0 || /^\s|\s$/.test(s);
    if (!mustQuote) return s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCsv(table, opts) {
    const o = Object.assign({ separator: ",", header: true, encoding: "utf-8", bom: false, quoteAll: false, eol: "\r\n" }, opts || {});
    const cols = o.fields || table.fields.map((_, i) => i);
    const lines = [];
    if (o.header) lines.push(cols.map((i) => csvCell(table.fields[i].name, o.separator, o.quoteAll)).join(o.separator));
    for (const r of o.rows || table.rows) {
      lines.push(cols.map((i) => csvCell(table.value(r, i), o.separator, o.quoteAll)).join(o.separator));
    }
    let text = lines.join(o.eol) + (lines.length ? o.eol : "");
    if (o.encoding === "utf-16le") {
      const buf = new Uint8Array(2 + text.length * 2);
      buf[0] = 0xff; buf[1] = 0xfe;
      for (let i = 0; i < text.length; i += 1) {
        buf[2 + i * 2] = text.charCodeAt(i) & 0xff;
        buf[3 + i * 2] = text.charCodeAt(i) >> 8;
      }
      return buf;
    }
    const body = encodeText(text, o.encoding === "gbk" ? "gbk" : "utf-8");
    if (!o.bom || o.encoding !== "utf-8") return body;
    const withBom = new Uint8Array(body.length + 3);
    withBom.set([0xef, 0xbb, 0xbf], 0);
    withBom.set(body, 3);
    return withBom;
  }

  function toJson(table, opts) {
    const o = Object.assign({ pretty: true, includeDeleted: false }, opts || {});
    const list = [];
    for (const r of o.rows || table.rows) {
      if (!o.includeDeleted && table.deleted(r)) continue;
      const obj = {};
      for (let i = 0; i < table.fields.length; i += 1) obj[table.fields[i].name] = table.value(r, i);
      list.push(obj);
    }
    return new TextEncoder().encode(JSON.stringify(list, null, o.pretty ? 2 : 0));
  }

  function sqlIdent(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  function toSql(table, opts) {
    const o = Object.assign({ table: "table1", rows: null, includeDeleted: false, dialect: "standard", chunk: 200 }, opts || {});
    const name = o.table.replace(/[^\w$#]/g, "_") || "table1";
    const cols = table.fields.map((f) => f.name);
    const out = [];
    out.push(`-- ${table.fields.length} columns, generated by DBF Studio`);
    if (o.dialect === "mysql") {
      const defs = table.fields.map((f) => `  \`${f.name}\` ${sqlType(f, "mysql")}`).join(",\n");
      out.push(`CREATE TABLE IF NOT EXISTS \`${name}\` (\n${defs}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    } else {
      const defs = table.fields.map((f) => `  ${sqlIdent(f.name)} ${sqlType(f, "standard")}`).join(",\n");
      out.push(`CREATE TABLE ${sqlIdent(name)} (\n${defs}\n);`);
    }
    let batch = [];
    const flush = () => {
      if (!batch.length) return;
      out.push(batch.join("\n"));
      batch = [];
    };
    for (const r of o.rows || table.rows) {
      if (!o.includeDeleted && table.deleted(r)) continue;
      const vals = table.fields.map((f, i) => sqlLiteral(f, table.value(r, i)));
      if (o.dialect === "mysql") {
        batch.push(`INSERT INTO \`${name}\` (${cols.map((c) => "`" + c + "`").join(", ")}) VALUES (${vals.join(", ")});`);
      } else {
        batch.push(`INSERT INTO ${sqlIdent(name)} (${cols.map(sqlIdent).join(", ")}) VALUES (${vals.join(", ")});`);
      }
      if (batch.length >= o.chunk) flush();
    }
    flush();
    return new TextEncoder().encode(out.join("\n") + "\n");
  }

  function sqlType(f, dialect) {
    const t = f.type;
    if (t === "N") return f.decimals ? `DECIMAL(${f.length},${f.decimals})` : "BIGINT";
    if (t === "F") return `DECIMAL(${f.length},${f.decimals || 2})`;
    if (t === "D") return "DATE";
    if (t === "L") return "BOOLEAN";
    if (t === "I") return "INTEGER";
    if (t === "Y") return "DECIMAL(19,4)";
    if (t === "T") return "TIMESTAMP";
    if (t === "M") return dialect === "mysql" ? "LONGTEXT" : "TEXT";
    return `VARCHAR(${Math.max(1, Math.min(f.length, 65535))})`;
  }

  function sqlLiteral(f, v) {
    const s = v == null ? "" : String(v);
    if (f.type === "N" || f.type === "F") {
      return s.trim() === "" ? "NULL" : s.replace(/,/g, "");
    }
    if (f.type === "I" || f.type === "Y") return s.trim() === "" ? "NULL" : s;
    if (f.type === "L") return s === "T" ? "TRUE" : s === "F" ? "FALSE" : "NULL";
    if (f.type === "D") return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `'${s}'` : "NULL";
    return "'" + s.replace(/'/g, "''") + "'";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function toHtml(table, opts) {
    const o = Object.assign({ title: "DBF export", rows: null, maxRows: 5000 }, opts || {});
    const rows = o.rows || table.rows;
    const head = table.fields.map((f) => `<th>${escapeHtml(f.name)}<span class="t">${f.type}${f.length ? f.length : ""}</span></th>`).join("");
    const body = rows.slice(0, o.maxRows).map((r) => {
      const cls = table.deleted(r) ? ' class="del"' : "";
      const tds = table.fields.map((f, i) => {
        const v = table.value(r, i);
        const align = f.kind === "number" || f.kind === "integer" || f.kind === "currency" ? ' class="n"' : "";
        return `<td${align}>${escapeHtml(v)}</td>`;
      }).join("");
      return `<tr${cls}>${tds}</tr>`;
    }).join("\n");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(o.title)}</title>
<style>body{font:13px/1.5 -apple-system,Segoe UI,sans-serif;color:#1f2328;margin:24px}
h1{font-size:18px;margin:0 0 4px}.meta{color:#656d76;font-size:12px;margin-bottom:16px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f6f8fa;position:sticky;top:0}th .t{display:block;font-weight:400;color:#8c959f;font-size:10px}
td.n{text-align:right;font-variant-numeric:tabular-nums}tr.del td{background:#fff5f5;color:#8b949e;text-decoration:line-through}
tr:nth-child(even) td{background:#fcfcfd}tr.del:nth-child(even) td{background:#fff5f5}</style></head>
<body><h1>${escapeHtml(o.title)}</h1><div class="meta">${rows.length} records · ${table.fields.length} fields · generated by DBF Studio</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    return new TextEncoder().encode(html);
  }

  function toMarkdown(table, opts) {
    const o = Object.assign({ rows: null, maxRows: 2000, includeDeleted: false }, opts || {});
    const rows = (o.rows || table.rows).slice(0, o.maxRows);
    const esc = (v) => String(v == null ? "" : v).replace(/\|/g, "\\|").replace(/\n/g, " ");
    const head = "| # | " + table.fields.map((f) => f.name).join(" | ") + " |";
    const sep = "|--:|" + table.fields.map((f) => (f.kind === "number" ? "--:|" : "---|")).join("");
    const body = rows.map((r, i) => "| " + (i + 1) + " | " + table.fields.map((f, ci) => esc(table.value(r, ci))).join(" | ") + " |").join("\n");
    return new TextEncoder().encode([head, sep, body].join("\n") + "\n");
  }

  function toSpreadsheetXml(table, opts) {
    // Excel 2003 XML — opens natively in Excel/WPS without any library
    const o = Object.assign({ title: "Sheet1", rows: null, maxRows: 200000 }, opts || {});
    const rows = (o.rows || table.rows).slice(0, o.maxRows);
    const head = table.fields.map((f) => `<Cell ss:StyleID="h"><Data ss:Type="String">${escapeHtml(f.name)}</Data></Cell>`).join("");
    const body = rows.map((r) => "<Row>" + table.fields.map((f, i) => {
      const v = table.value(r, i);
      const num = f.kind === "number" || f.kind === "integer" || f.kind === "currency";
      const isNum = num && v !== "" && /^-?\d+(\.\d+)?$/.test(v.trim());
      return isNum
        ? `<Cell><Data ss:Type="Number">${v.trim()}</Data></Cell>`
        : `<Cell><Data ss:Type="String">${escapeHtml(v)}</Data></Cell>`;
    }).join("") + "</Row>").join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#F2F4F7" ss:Pattern="Solid"/></Style></Styles>
 <Worksheet ss:Name="${escapeHtml(o.title).slice(0, 28)}"><Table>
  <Row>${head}</Row>
${body}
 </Table></Worksheet></Workbook>`;
    return new TextEncoder().encode(xml);
  }

  /* ----------------------------------------------------------- csv import */

  function parseCsv(text, opts) {
    const o = Object.assign({ separator: ",", hasHeader: true, limit: 0 }, opts || {});
    const rows = [];
    let row = [];
    let cell = "";
    let i = 0;
    let inQuotes = false;
    const sep = o.separator;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        cell += ch; i += 1; continue;
      }
      if (ch === '"') { inQuotes = true; i += 1; continue; }
      if (ch === sep) { row.push(cell); cell = ""; i += 1; continue; }
      if (ch === "\r") { i += 1; continue; }
      if (ch === "\n") {
        row.push(cell); rows.push(row); row = []; cell = ""; i += 1;
        if (o.limit && rows.length >= o.limit) break;
        continue;
      }
      cell += ch; i += 1;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    const header = o.hasHeader && rows.length ? rows.shift() : (rows[0] || []).map((_, k) => "COLUMN" + (k + 1));
    return { header: header.map((h, k) => (h.trim() || "COLUMN" + (k + 1)).toUpperCase().slice(0, 10)), rows };
  }

  function inferFields(header, rows, sampleSize) {
    const n = header.length;
    const lim = Math.min(rows.length, sampleSize || 500);
    return header.map((name, c) => {
      let maxLen = 1;
      let allNum = true;
      let allDate = true;
      let allInt = true;
      let maxDec = 0;
      for (let r = 0; r < lim; r += 1) {
        const v = (rows[r][c] || "").trim();
        if (!v) continue;
        maxLen = Math.max(maxLen, v.length);
        if (!/^-?\d+(\.\d+)?$/.test(v)) allNum = false;
        else {
          const dec = (v.split(".")[1] || "").length;
          maxDec = Math.max(maxDec, dec);
          if (dec) allInt = false;
        }
        if (!/^\d{4}[-/.]?\d{2}[-/.]?\d{2}$/.test(v)) allDate = false;
      }
      if (allDate && maxLen >= 8) return { name, type: "D", length: 8, decimals: 0 };
      if (allNum && maxLen > 0) {
        const dec = allInt ? 0 : maxDec;
        return { name, type: "N", length: Math.max(4, Math.min(maxLen + (dec ? 1 : 0), 19)), decimals: Math.min(dec, 9) };
      }
      return { name, type: "C", length: Math.max(1, Math.min(maxLen, 254)), decimals: 0 };
    });
  }

  /* ----------------------------------------------------------- validation */

  function validateTable(table, opts) {
    const o = Object.assign({ maxIssues: 500, limit: 20000 }, opts || {});
    const issues = [];
    let rowsChecked = 0;
    const counts = {};
    const seen = new Set();
    const rows = o.rows || table.rows;
    for (const r of rows) {
      if (rowsChecked >= o.limit || issues.length >= o.maxIssues) break;
      rowsChecked += 1;
      for (let i = 0; i < table.fields.length; i += 1) {
        const f = table.fields[i];
        const v = table.value(r, i);
        const t = (v || "").trim();
        counts[f.name] = counts[f.name] || { empty: 0, filled: 0 };
        if (!t) { counts[f.name].empty += 1; continue; }
        counts[f.name].filled += 1;
        let problem = null;
        if (f.type === "N" || f.type === "F") {
          if (!/^-?\d+(\.\d+)?$/.test(t.replace(/,/g, ""))) problem = "非数值";
          else if (f.decimals && (t.split(".")[1] || "").length > f.decimals) problem = "小数位超限";
        } else if (f.type === "D") {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) problem = "日期格式应为 YYYYMMDD";
          else {
            const p = dateToYmd(t);
            if (!p || !isValidDate(p.y, p.m, p.d)) problem = "非法日期";
          }
        } else if (f.type === "L") {
          if (t !== "T" && t !== "F" && t !== "?") problem = "逻辑值应为 T/F";
        } else if (t.length > f.length) {
          problem = `超出字段长度 ${f.length}`;
        }
        if (problem) {
          if (issues.length < o.maxIssues) {
            issues.push({ row: r, field: f.name, fieldIndex: i, value: t.slice(0, 80), problem });
          }
        } else if (o.dupCheck && o.dupCheck.indexOf(f.name) >= 0) {
          const key = (seen.has(r) ? "" : "") + t;
          if (counts[f.name]) counts[f.name].dups = counts[f.name].dups || new Map();
          const m = counts[f.name].dups;
          m.set(t, (m.get(t) || 0) + 1);
          void key;
        }
      }
    }
    const dupes = [];
    if (o.dupCheck) {
      for (const name of o.dupCheck) {
        const c = counts[name] && counts[name].dups;
        if (!c) continue;
        for (const [v, n] of c) if (n > 1) dupes.push({ field: name, value: v, count: n });
      }
    }
    return { issues, rowsChecked, stats: counts, dupes };
  }

  function columnStats(table, fieldIndex, rows) {
    const f = table.fields[fieldIndex];
    const list = rows || table.rows;
    let empties = 0;
    const distinct = new Set();
    let min = null;
    let max = null;
    let sum = 0;
    let numeric = 0;
    let minDate = null;
    let maxDate = null;
    for (const r of list) {
      const v = (table.value(r, fieldIndex) || "").trim();
      if (!v) { empties += 1; continue; }
      if (distinct.size < 5000) distinct.add(v);
      if (f.kind === "number" || f.kind === "integer" || f.kind === "currency") {
        const n = Number(v.replace(/,/g, ""));
        if (isFinite(n)) {
          numeric += 1;
          sum += n;
          if (min === null || n < min) min = n;
          if (max === null || n > max) max = n;
        }
      } else if (f.kind === "date") {
        const p = dateToYmd(v);
        if (p) {
          const key = p.y * 10000 + p.m * 100 + p.d;
          if (minDate === null || key < minDate) minDate = key;
          if (maxDate === null || key > maxDate) maxDate = key;
        }
      }
    }
    return {
      count: list.length,
      empties,
      filled: list.length - empties,
      distinct: distinct.size,
      numericCount: numeric,
      sum,
      min,
      max,
      minDate,
      maxDate,
    };
  }

  /* ------------------------------------------------------------- helpers */

  function sniffDelimiter(text) {
    const firstLine = text.slice(0, 4096).split(/\r?\n/)[0] || "";
    const cands = [",", ";", "\t", "|"];
    let best = ",";
    let bestN = 0;
    for (const c of cands) {
      const n = firstLine.split(c).length - 1;
      if (n > bestN) { bestN = n; best = c; }
    }
    return best;
  }

  function splitBytesToRows(buf, encoding) {
    return decodeBytes(buf, encoding);
  }

  return {
    VERSIONS,
    TYPE_INFO,
    LDID,
    ENCODING_CHOICES,
    parseHeader,
    detectEncoding,
    rawToDisplay,
    memoPointer,
    createMemoReader,
    buildDbf,
    cellToFieldBytes,
    toCsv,
    toJson,
    toSql,
    toHtml,
    toMarkdown,
    toSpreadsheetXml,
    parseCsv,
    inferFields,
    validateTable,
    columnStats,
    decodeBytes,
    encodeText,
    canEncode,
    normEncoding,
    encodingLdid,
    fmtDate,
    dateToYmd,
    isValidDate,
    pad,
    sniffDelimiter,
    splitBytesToRows,
    escapeHtml,
    gbkReady: () => !!gbkTable(),
  };
});
