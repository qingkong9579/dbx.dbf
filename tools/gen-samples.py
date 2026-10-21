"""Generate the bundled demo tables and rebuild ui/js/samples.js.

Every value in these tables is synthetic: the field layouts follow the published
interface specifications (so the field dictionary can be demonstrated), but no
real account, security or holder data is shipped with the plugin.

Run from the plugin root:

    uv run --no-project --python 3.12 python tools/gen-samples.py
"""

import base64
import json
import os
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLES = os.path.join(ROOT, "ui", "samples")
OUT_JS = os.path.join(ROOT, "ui", "js", "samples.js")

# name, type, length, decimals — SZSE D-COM 申报表（18 个 C 字段）
S68_FIELDS = [
    ("SBBH", "C", 16, 0),
    ("GXDM", "C", 16, 0),
    ("YWLX", "C", 3, 0),
    ("SBLX", "C", 3, 0),
    ("ZQZH", "C", 20, 0),
    ("XWH", "C", 6, 0),
    ("ZQDM", "C", 8, 0),
    ("ZQLB", "C", 2, 0),
    ("LTLX", "C", 1, 0),
    ("QYLB", "C", 2, 0),
    ("GPNF", "C", 4, 0),
    ("QYCS", "C", 1, 0),
    ("SBSL", "C", 20, 0),
    ("JG", "C", 18, 0),
    ("JE", "C", 19, 0),
    ("FZDM", "C", 20, 0),
    ("QSBH", "C", 5, 0),
    ("BZ", "C", 40, 0),
]
S68_ROWS = [
    ["1", "A000000001", "H66", "HSB", "B000000001", "00001", "999999", "1", "1", "1",
     "2026", "1", "1000", "12.34", "12340.00", "00000000000000000001", "1", "示例数据"],
]

# 文件传输请求（14 个 C 字段）
REQ_FIELDS = [
    ("sbbh", "C", 10, 0),
    ("fwym", "C", 16, 0),
    ("fwm", "C", 16, 0),
    ("fwlx", "C", 2, 0),
    ("wjbz", "C", 1, 0),
    ("zwjm", "C", 24, 0),
    ("cwjm", "C", 24, 0),
    ("sbrq", "C", 8, 0),
    ("sbsj", "C", 6, 0),
    ("zddclsj", "C", 5, 0),
    ("clbz", "C", 1, 0),
    ("jylsh", "C", 16, 0),
    ("by", "C", 20, 0),
    ("jym", "C", 4, 0),
]
REQ_ROWS = [
    ["1", "DEMOAPP", "DEMODBF", "01", "1", "S68.DBF", "S68.DBF", "20260101", "101500", "0", "0", "", "", "0"],
]

# 上市公司版 T1（全体证券持有人名册）构造示例
T1_FIELDS = [
    ("SJLX", "C", 2, 0),
    ("XH", "C", 8, 0),
    ("ZQDM", "C", 6, 0),
    ("ZQJC", "C", 12, 0),
    ("QYDJR", "C", 8, 0),
    ("CYRMC", "C", 64, 0),
    ("YMTZHHM", "C", 20, 0),
    ("ZQZHHM", "C", 10, 0),
    ("ZJHM", "C", 20, 0),
    ("CYRLB", "C", 4, 0),
    ("CYSL", "N", 15, 0),
    ("CYBL", "N", 9, 4),
    ("BZ", "C", 40, 0),
]
T1_ROWS = [
    ["01", "00000001", "600001", "示例股份A", "20260710", "示例投资管理有限公司",
     "100000000001", "A100000001", "91310000MA1FL0001X", "02", "1250000", "12.5000", ""],
    ["01", "00000002", "600001", "示例股份A", "20260710", "张三",
     "100000000002", "A100000002", "310101199001010011", "01", "86000", "0.8600", ""],
    ["01", "00000003", "600001", "示例股份A", "20260710", "示例证券投资基金",
     "100000000003", "A100000003", "91310000MA1FL0002Y", "03", "2400000", "24.0000", ""],
]

META = {
    "S68.DBF": {
        "title": "深市登记结算申报",
        "note": "深市 D-COM 申报接口构造示例：18 个 C 字段，1 条记录，全部为虚构数据。",
    },
    "req.dbf": {
        "title": "文件传输请求",
        "note": "传输请求包装构造示例：指向 S68.DBF 的文件名与发送时间，14 个 C 字段，全部为虚构数据。",
    },
    "T1600001.DBF": {
        "title": "上市公司持有人名册",
        "note": "沪市上市公司版 T1（全体证券持有人名册）构造示例，演示按文件前缀分表的字段释义；字段宽度与数据均为虚构。",
    },
}
ORDER = ["S68.DBF", "req.dbf", "T1600001.DBF"]


def build(fields, rows, encoding="gbk"):
    header_len = 32 + 32 * len(fields) + 1
    record_len = 1 + sum(f[2] for f in fields)
    out = bytearray()
    out += struct.pack("<BBBBIHH", 0x03, 126, 1, 1, len(rows), header_len, record_len)
    out += b"\x00" * 20
    out[29] = 0x4D  # language driver: GBK
    offset = 1
    for name, ftype, length, decimals in fields:
        desc = bytearray(32)
        desc[0:len(name)] = name.encode("ascii")
        desc[11] = ord(ftype)
        desc[12:16] = struct.pack("<I", offset)
        desc[16] = length
        desc[17] = decimals
        out += desc
        offset += length
    out += b"\x0d"
    for row in rows:
        out += b" "
        for (name, ftype, length, _), value in zip(fields, row):
            raw = str(value).encode(encoding)
            raw = raw.rjust(length) if ftype == "N" else raw.ljust(length)
            out += raw[:length]
    out += b"\x1a"
    return bytes(out)


def main():
    tables = {
        "S68.DBF": (S68_FIELDS, S68_ROWS),
        "req.dbf": (REQ_FIELDS, REQ_ROWS),
        "T1600001.DBF": (T1_FIELDS, T1_ROWS),
    }
    os.makedirs(SAMPLES, exist_ok=True)
    files = {}
    for name in ORDER:
        fields, rows = tables[name]
        blob = build(fields, rows)
        path = os.path.join(SAMPLES, name)
        with open(path, "wb") as fh:
            fh.write(blob)
        print("wrote", path, len(blob), "bytes")
        files[name] = {
            "b64": base64.b64encode(blob).decode("ascii"),
            "label": name,
            "title": META[name]["title"],
            "note": META[name]["note"],
        }

    chunks = []
    for name, item in files.items():
        chunks.append(
            "    %s: {\n      b64: %s,\n      label: %s,\n      title: %s,\n      note: %s,\n    },"
            % (
                json.dumps(name, ensure_ascii=False),
                json.dumps(item["b64"]),
                json.dumps(item["label"], ensure_ascii=False),
                json.dumps(item["title"], ensure_ascii=False),
                json.dumps(item["note"], ensure_ascii=False),
            )
        )

    js = """/*!
 * DBF Studio — samples.js
 * Synthetic sample tables embedded as base64 so the workbench can open them inside
 * a sandboxed frame without any network access. No real exchange data is included.
 *   %s
 * Generated from ui/samples/*.DBF by tools/gen-samples.py — do not edit by hand.
 */
(function (g) {
  "use strict";
  g.DBF_SAMPLES = {
%s
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
""" % (
        "\n *   ".join("%s — %s" % (k, v["title"]) for k, v in files.items()),
        "\n".join(chunks),
    )
    with open(OUT_JS, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(js)
    print("wrote", OUT_JS, len(js), "bytes")


if __name__ == "__main__":
    main()
