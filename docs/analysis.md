# 逆向分析与设计记录

本文件记录插件开发的证据来源、分析方法与由此产生的设计取舍。所有结论都能在仓库中找到对应实现或原始材料。

## 1. 参考目标

| 目标 | 类型 | 结论 |
| --- | --- | --- |
| `DBFPlus.exe`（2.90 MB，第三方商业软件，未随仓库分发） | 原生 PE，i386 | **DBF Viewer Plus**（作者 Alex Nolan），Delphi 7 + VCL 编译，非 .NET / 非 Go / 未加壳 |
| `S68.DBF`、`req.dbf` | DBF 样例（仓库内为构造数据） | dBase III+（版本字节 `0x03`）、GBK（LDID `0x4D`）、单记录 |
| 《深市登记结算数据接口规范（结算参与人版 Ver 5.18）》 | PDF，255 页 | 提供 364 个字段释义，构成本插件字典主体 |
| 《IS124 上海证券交易所市场数据文件交换接口规格说明书 3.60》 | PDF，185 页 | 只覆盖 `.txt`/`.xml` 交换文件与 `ghXXXXX.dbf`，**不含** S68/req 的字段定义 |
| [EasyDBF](https://github.com/buerxixi/EasyDBF) | Java 库源码 | 读写 dBase III / DBF 2.5 / FoxPro 2.5，默认 GBK，"完美支持中登格式 D-COM / PROP" |

### 1.1 为什么没有用 REA 的语义分析

REA CLI（`rea-agents@6.5.0`）的 `analyze` / `decompile` / `function` 子命令依赖可用的反汇编后端，实测：

```json
{"error":"Analysis failed","code":"provider_unavailable",
 "candidate_ids":["ghidra","hopper","ida"],
 "rejections":[
  {"provider_id":"ghidra","code":"not_configured","reason":"Set GHIDRA_INSTALL_DIR to an extracted Ghidra 12.1.x release directory."},
  {"provider_id":"hopper","code":"unsupported_host"}]}
```

本机只有 JDK 17，而 Ghidra 12.1.4 需要 JDK 21；IDA/Hopper 不可用，因此 REA 的代码级反编译路径阻塞。**改用 REA 的静态工件取证思路**：把 exe 当作可解析的发布产物，从 PE 结构、资源表、导入表、DFM 资源中恢复证据。这条路径对该样本极其有效，因为 Delphi 把全部窗体以二进制 DFM（`TPF0`）形式放在 `#10 RCDATA` 资源里，控件的 `Caption`/`Text`/`Hint` 都是明文字符串。

### 1.2 PE 结构

| 项 | 值 |
| --- | --- |
| 机器 / 子系统 | `0x014C`（i386）/ GUI |
| ImageBase | `0x400000` |
| 入口 | RVA `0x1DC568`（`push ebp; mov ebp, esp` 的 Delphi 启动桩） |
| 节 | CODE `0x1000`/`0x1DB830`、DATA `0x1DD000`/`0xA034`、BSS、`.idata`、`.tls`、`.rdata`、`.reloc`、`.rsrc` `0x215000`/`0xB9800` |
| 导入 | kernel32、user32(216)、gdi32(101)、comctl32(24)、comdlg32（`GetOpenFileNameA`、`PrintDlgA`）、winspool（`OpenPrinterA`、`DocumentPropertiesA`）、shell32、ole32/oleaut32、advapi32、`WritePrivateProfileStringA` |
| 未导入 | ADO / Excel / riched20 / urlmon / msvcrt → 纯本地 VCL，打印走 Winspool |

资源表：`#10 RCDATA` 48 项 / 654 KB、`#2` 位图 107、`#6` 字符串表 36（UTF-16）、`#3` 图标 5、`#24` manifest 1、`#12` 加速键 7、`#5` 对话框 1。48 个 RCDATA 中有 46 个是窗体（`TPF0` 开头，类名与组件名以 1 字节长度前缀编码），最大的是主窗体 `TForm1`（162,581 B），其次是 `TfrmTableInfo`（83,247 B）、`TfrmIndexes`（67,728 B）、`TfrmRecordView`（29,346 B）。

全文件 GBK 与 UTF-16 中文扫描只得到噪声，说明该工具 **UI 全英文**；其商业价值在表格浏览与导入导出，而非中文字段释义。

### 1.3 从 DFM 恢复出的功能面

| 区域 | 能力 |
| --- | --- |
| 工具条 | Open / Reopen / Form（记录视图）/ Search / Word Search / Table Info / Indexes / Add Index / New / Add Field / Alter Field / Delete / Rename / Show-Hide Columns / Resize All / Export / Import / Print / Exit |
| 状态区 | `Count:`、`Index:`、`Version:`、`Record:`、`Current Table`、`Apply Filter`/`Cancel Filter`、`Show field panel` |
| File 菜单 | New Table、Open、Quick Open、Close、Save as…、Import、Export、Export to CSV、Print、Print Preview、Exit |
| Edit 菜单 | First / Previous / Next / Last、Insert、Delete、Save、Cancel、View-Edit Memo Field、Search Value、Word Search、Apply Filter、Cancel Filter、Find |
| View 菜单 | Goto Column、Resize All Column Widths、Show Toolbar、Show Statusbar、Change Font、Form View、Show Deleted、Change Index、Enlarge/Reduce |
| Record 菜单 | Undelete Record、Record Count、Visual Count、Record Size、Print Record、Copy Column/Row/Field Value to Clipboard、Is Deleted |
| Column / Table / Index 菜单 | Add Field、Remove Field；New Table、Add Field、Alter Field、Rename Field、Delete Field、Table Info、Open Table Folder、**Pack Table（清除已删除记录）**、**Zap（清空）**、**Set Table Type**、Refresh；Create Index、Reindex、Show Indexes |
| 数据区 | `TDBGrid`/`TTntDBGrid` + `TDBNavigator`；页签 `Memo Field`（TDBMemo + 字段下拉）、`Bitmap Field`（Load/Save Bitmap）、`JPG Field`（Show + Load/Save Jpg） |
| 导出格式 | SMExport 4.77：Paradox、dBase、Text、HTML、XLS、Excel、Word、SYLK、DIF、WKS、Quattro、SQL |
| 其他窗体 | `TfrmNewTable`、`TfrmAddField`、`TfrmAltField`、`TfrmRenameColumn`、`TfrmRemoveColumn`、`TfrmCreateIndex`、`TfrmIndexes`、`TfrmCSVOptions`、`TfrmExportDlg`、`TfrmExportOptions`、`TfrmRecordView`、`TfrmMemo`、`TfrmPicture`、`TfrmSearch`、`TfrmWordSearch`、`TfrmKeySearch`、`TfrmQuickOpen`、`TfrmRecent`、`TfrmSetTableType`、`TfrmTableInfo`、`TfrmSpecs`、`TLoginDialog`、`TPasswordDialog`、`TAboutBox`、SME/SMI 导入导出向导、QuickReport 4 设计期窗体 |

### 1.4 采纳与放弃

**采纳**（保证"打开交易所 DBF 能干活"的闭环）：结构网格 + 记录导航、内联编辑与删除标记、字段增删改、备注/二进制查看、搜索/过滤、记录详情视图、Pack / Zap / Set Table Type、导出（CSV/JSON/SQL/HTML/Markdown/Excel XML/DBF/定长）。

**放弃并有理由**：

- NDX/MDX 索引创建与重建：交换文件按整表交付，索引对下游无用；只识别表头 MDX 标志并在 UI 提示。
- QuickReport 打印与预览：宿主是浏览器 iframe，用 `@media print` 输出 A4 横向表格更贴合，且不引入二进制依赖。
- SMExport 的 Paradox / DIF / SYLK / WKS / Quattro：目标用户（结算数据核对）不用，改为 JSON / Markdown / SQL 这些更常用的核对与入库格式。
- 登录/口令对话框：DBF Viewer Plus 用它做注册校验，与插件无关。

## 2. 交换文件与字段字典

- `S68.DBF`：`0x03`、表头 609 B、记录 205 B、1 条记录、18 个 `C` 字段（`SBBH16, GXDM16, YWLX3, SBLX3, ZQZH20, XWH6, ZQDM8, ZQLB2, LTLX1, QYLB2, GPNF4, QYCS1, SBSL20, JG18, JE19, FZDM20, QSBH5, BZ40`）。
- `req.dbf`：`0x03`、表头 481 B、记录 154 B、1 条记录、14 个 `C` 字段（`sbbh10, fwym16, fwm16, fwlx2, wjbz1, zwjm24, cwjm24, sbrq8, sbsj6, zddclsj5, clbz1, jylsh16, by20, jym4`）；内容是把 `S68.DBF` 作为报文净荷的传输请求。
- 深市规范中的字段表按 `字段名 / 中文名 / 类型 / 长度 / 说明` 抽取，得到 364 条，写入 `columns-cn.js` 的 `sz`（置信度 `spec`）。
- 释义匹配分三级：① 文件族命中（按文件名前缀，含上市公司版「前缀+证券代码」）→ `spec`/`inferred`；② 未命中则回退到**全量并集**（sz ∪ s68 ∪ req ∪ gsss.union）→ `shared`（界面徽标「通用」），任何 DBF 只要列名一致都能显示中文名；③ 仍未命中才给前缀/后缀格式提示。列名比较一律 `trim + toUpperCase`，数据表内的键也做大小写不敏感索引，因此 `sbbh`/`SBBH`/`Sbbh` 等价。
- 《登记结算数据接口规范（上市公司版 V3.19）》（沪-JS-KFB-JKGF-03-2026/A，2026-07-13 发布，FOXPRO 2.5 格式）共 20 类文件：`T1`–`T9`、`S6`–`S9`、`S11`、`S12`、`S13`、`AGCC`、`BGCC`、`ZYDJ`、`H1`，抽取到 355 行、并集 146 个字段（`dict.js` 的 `GSSS_FILES`）。
  - 文件名规则为 `文件前缀 + 证券代码(6 位) + [股份性质] + [日期] + [其它].mdd/.dbf`（如 `t1600001all.dbf`、`agcc60000120150604all.dbf`、`zydj60000020201215.dbf`），因此按**前缀分表**：同一字段在不同文件中含义不同（`CYSL` 在 `T1` 为「持有数量」、在 `S13` 为「减持数量」），识别函数 `gsssOf()` 要求前缀后紧跟 5 位以上数字，避免 `S68` 被 `S6` 误命中。
  - 抽取时表格单元格顺序不稳定（合列/换行），中文名统一用「取最长的合法中文片段」规则，字段名列优先取紧邻中文名的 ASCII 字段名，并对 `GDDM`/`SCDM`/`XH`/`TZRMC` 四个人工核对项做覆盖。
  - 文件自身表中缺失的字段回退到该规范的并集（`GSSS_UNION`），仍无则退到前后缀提示。
- 沪市两份样例的 32 个字段在 IS124 中查不到定义，只能按命名规则与取值推断（`SBBH`→申报编号、`GXDM`→股东/客户代码、`WJBZ`→文件标志…），置信度 `inferred`，界面用「推断」徽标区分，字段笔记可用于人工订正。
- 字典对未收录字段做前后缀提示（`DM` 代码、`JE` 金额、`RQ` 日期、`SJ` 时间、`ZH` 账户…），但**只要命中字典就不再追加猜测**，避免"文件标志 → 备注"这类错误提示。
- `ui/samples/T1600001.DBF` 是按 `T1` 字段名构造的演示表（13 字段 / 3 行 / GBK / `ldid=0x4D`），字段宽度与数据为示意值，用于演示「文件前缀 → 表族 → 分表释义」链路。

## 3. 引擎实现要点

- `dbf-core.js` 自实现解析/写出，不依赖第三方库：表头 → 字段描述区（32 字节/字段，名称 0-10、类型 11、偏移 12、长度 16、小数 17、标志 18）→ 记录区；写出时重算 `headerLength`、`recordLength`、记录数、`0x0D` 终止符与 `0x1A` EOF。
- 编码：浏览器 `TextEncoder` 不支持 GBK，因此内置 `gbk-table.js`（24,066 个双字节映射，base64 存放），解码用 `TextDecoder("gbk")` 优先、失败回退查表；编码走反向表。ASCII 曾因按双字节存储写出 `0\u0000` 而损坏，已修正为逐字节追加。
- 数字/日期语义：读取时保留定宽字符串语义（不做本地化），日期显示为 `YYYY-MM-DD`、写回 `YYYYMMDD`；数值右补空格、日期与逻辑字段按 DBF 规则补齐。
- 校验复用同一套字段元数据：`validateTable()` 输出 `{row, field, fieldIndex, value, problem}`，UI 点击可直接定位单元格。
- 备注：`createMemoReader("dbt"|"fpt", readRange)` 按需分块读取，`.dbt` 512 字节块 + `0x1A 0x1A` 终止，`.fpt` 大端块头 + 类型 1；带备注的表保存被禁用（不生成新备注文件）。

## 4. 平台契约与踩坑

- `dbx-plugin dev` 只提供 Vue 调试外壳：`GET /` 不是插件页面，点击侧栏工作台条目后宿主才用 `srcdoc` 注入插件 HTML，并把 `<script src>`、`<link>` **内联**，沙箱 `allow-scripts`、CSP `connect-src 'none'`。因此示例数据不能靠 `fetch("samples/S68.DBF")`，改为 `samples.js` 内嵌 base64，`readAssetUrl` 也只作为兜底。
- iframe 为不透明源，`localStorage` 不可靠；偏好与字段笔记改走 `host.storage`（256 KiB/值），失败再退回 `localStorage`。
- 主题令牌由宿主以 CSS 变量注入；`data-dbx-theme` 必须写在 `<html>` 上且**只写一次**。早期版本同时写 `<html>` 和 `<body>`，结果浅色规则命中 `<body>`、覆盖了深色继承，出现"白底 + 深色网格"的半截主题。
- 宿主的 `--color-*` 描述的是**宿主外壳**，不一定是插件被要求渲染的那一侧：`theme.appearance` 与注入的 token 可能不一致（开发外壳就是深浅声明与浅色 token 混用）。因此调色板改为插件自带的浅/深两套，宿主只决定选哪一侧；两者混用会产生低对比度的控件。
- `:root { --font-sans: var(--font-sans, …) }` 这类同元素自引用会被 CSS 判定为循环，变量变成 guaranteed-invalid，所有 `font: … var(--font-sans)` 简写随之失效——表现为字号回落到 16px、字体变成默认字体（本次实测 `--font-sans` 取值为空、`body` 计算字号 16px）。改为字面量字体栈后 `--font-sans` 才有值。
- 元素 id 与脚本顺序敏感：`gbk-table → dbf-core → i18n → dict → samples → app → views`，`App` 必须在 `views.js` 之前定义，`App.init` 必须出现在导出对象里（否则启动即抛错）。
- 调试外壳持有 SSE 长连接，`msedge --dump-dom` 会挂起；截图与交互验证统一用 Puppeteer 连接 `about:srcdoc` 子帧完成。

## 5. 连接类型（0.2.0 追加）

最初按「纯前端、无原生后端」落地（0.1.0），因为沙箱已能覆盖打开/保存/导出。要进入 DBX 的「新建连接」流程后，方案改为 **connection-provider + Go sidecar**，理由与约束如下：

- 连接的生命周期归宿主：`connection/test|connect|disconnect` 只能由 sidecar 应答，前端 iframe 无法参与；连接打开工作台时宿主只传 `{connectionId, providerId, connectionType}`，**不传配置路径**，所以读取/写回都必须回到 sidecar。
- 因此 `backend/main.go` 承担三件事：解析宿主下发的连接配置、按 `dbf/read` 分块供数（≤1 MiB/次，UI 用 512 KiB）、按 `dbf/write-begin|chunk|commit` 原子落盘（临时文件 + `.bak` + rename）。配置持久化到 `DBX_PLUGIN_DATA_DIR/connections.json`，工作台刷新时可用连接 ID 反查。
- Go SDK 的 `Handler.Handle` 会对非 `plugin/initialize` 方法**并发**执行，同一连接上的 `connect` 与 `info` 不保证顺序；UI 侧改为 `connect` 成功后再拉 `dbf/info`，sidecar 侧对 `conns` 加锁。
- 打包：`dbx-plugin package` 只认 `dbx-plugin.toml` 的 `[package].include`，sidecar 必须位于 include 内；产物里的二进制被改写到 `bin/<target>/`，manifest 中的 `entrypoints.backend.executable` 在打包时同步改写（源清单里写 `backend/bin/dbx-dbf-backend.exe`，包内是 `bin/windows-x64/dbx-dbf-backend.exe`）。
- 表单字段的 `picker` 在桌面端写绝对路径、在网页端转成上传（写入 `content_field`）；`accept` 是数组而非字符串，`visible_when` 的 `one_of` 同样必须是数组。

## 6. 复现材料

分析脚本、规范文本抽取与自动化回归工具留在作者本地工作区，未随插件仓库分发（其中包含对第三方二进制与规范原文的处理产物）。下表仅作复现索引：

| 材料 | 内容 |
| --- | --- |
| `dfm_strings.py` / `dfm_strings.txt` | 46 个 DFM 的可打印字符串（含窗体偏移与大小） |
| `dfm_ui.py` / `dfm_ui.txt` | 主窗体过滤后的 UI 文案（功能清单来源） |
| `pe_rsrc_types.py` | 资源类型普查 |
| `is124.txt` / `szs.txt` / `ssgs.txt` | 三份 PDF 的文本抽取（上交所 IS124、深市 5.18、上市公司版 3.19），不对外分发 |
| `gsss_extract.py` / `gsss_fields.json` | 上市公司版分表抽取（20 类文件、355 行） |
| `gen_dict.py` | 从规范文本生成 `ui/js/dict.js`（仓库中只保留生成结果） |
| `tools/gen-samples.py` | 仓库内：生成三张构造示例表并重建 `ui/js/samples.js` |
| `verify*.js` | 无头浏览器回归脚本（编辑、GBK 回写、连接模式读写、切表），内部使用 |
| `rpc.ps1` | 向 sidecar 串行灌 JSONL 的协议冒烟脚本 |

## 7. 数据脱敏

发布前对仓库做了以下处理，确保不含真实业务数据与本机信息：

1. 三张示例表（`S68.DBF`、`req.dbf`、`T1600001.DBF`）全部由 `tools/gen-samples.py` **重新构造**：字段名/类型/长度按规范保留，所有字段值替换为虚构值（如 `A000000001`、`DEMOAPP`、`示例股份A`），不再包含任何真实账户、证券代码、金额或持有人信息。
2. `ui/js/samples.js` 由同一脚本重建为内嵌 base64，避免旧数据残留。
3. 文档中的本机绝对路径（工作目录、`C:\Users\…`、可执行文件路径）改为中性描述；`docs/store.md` 的自检命令改为相对路径。
4. 仓库不含规范 PDF 原文、`DBFPlus.exe`、分析脚本输出、`dist/`、`.dbx-dev/`、`backend/bin/` 与本机截图（`.gitignore` 已覆盖构建产物）。
5. 字段字典只保留「字段名 + 中文释义 + 类型/长度」这类事实性信息，不复制规范正文、表格排版或说明全文。
