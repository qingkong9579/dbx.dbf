# DBF Studio · DBX 插件

面向证券登记结算交换文件的 DBF 工作台：打开、阅读、编辑、校验、导出 DBF 数据表，内置深市 D-COM、沪市 PROP 与沪市上市公司版字段释义。

- 插件 ID：`com.dbx.dbf` · 版本 `0.3.6` · 前端工作台 + Go 原生 sidecar（CI 构建 windows-x64 / linux-x64 / linux-arm64 / darwin-x64 / darwin-arm64）
- 作者：微茫之心 · 仓库：[`qingkong9579/dbx.dbf`](https://github.com/qingkong9579/dbx.dbf) · 问题与建议请走仓库 Issues
- 宿主要求：DBX `>= 0.5.68`，Host API `1`，sidecar 协议 `stdio-jsonl` / protocol 1
- 参考实现：EasyDBF（Java，GBK/D-COM/PROP 支持）与 DBF Viewer Plus（Delphi，`DBFPlus.exe`，REA 静态分析，见 [`docs/analysis.md`](docs/analysis.md)）

两种进入方式：**直接打开本地 DBF**（工作台侧栏），或在 DBX **新建连接**里选择连接类型 **「DBF 数据文件」**，连接后可读写原文件。

## 功能

**打开与识别**

- 打开单个 DBF 或一次选中多个（含备注文件 `.DBT` / `.FPT`）；支持把文件或整个目录拖入窗口
- 识别 dBase II/III+/IV/V、Visual Objects、FoxBASE、FoxPro 2.x、Visual FoxPro 及其带备注变体，读取表头、字段描述区、删除标记与 MDX 标志
- 编码自动判定：按 LDID（0x4D=GBK 等）+ 严格 UTF-8 探测；中文交换表族（S68/req/SJS…）默认 GBK，保证回写编码一致
- 手动更换编码重新打开：顶栏编码按钮或「更多 ⋯ → 编码设置…」打开编码对话框，可从 GBK / UTF-8 / Big5 / Shift-JIS / 949 / 1252 / 437 / 866 中任选，右侧实时预览前三行文本；可勾选「记住此文件的编码」，下次打开同名文件自动套用（`storage` 持久化）。手动编码会在按钮与状态栏标出“手动”，保存时按该编码写入并同步写回 LDID
- 内置构造示例（全部为虚构数据）：`S68.DBF`（深市登记结算申报，18 字段）、`req.dbf`（沪市文件传输请求，14 字段）、`T1600001.DBF`（上市公司持有人名册，13 字段），点击即可加载

**字段结构**

- 侧栏字段列表：类型、长度、小数位、中文释义与「规范/推断」标记
- 添加、修改、重命名、删除字段；改结构时按字段名映射旧值、按新长度截断，重新计算记录偏移
- 字段对话框实时显示字典释义（中文名、格式提示、前缀、表族）

**数据浏览与编辑**

- 虚拟化网格 + 固定表头/行号列、列宽拖拽、自适应列宽、显示/隐藏列、紧凑模式
- 单元格双击/回车内联编辑，Tab 串列，Esc 取消；数值、日期、逻辑与超长文本即时校验
- 记录导航（首/上/下/尾、跳转记录号）、分页（100/200/500/1000/5000/全部）
- 搜索（任意字段或指定字段、上下循环）、过滤（输入关键字或 `字段=值`）、显示已删除记录
- 记录详情面板：逐字段值 + 中文名 + 复制；备注（M）与二进制（G/P）查看器；少量代码字段（如交易市场 SCDM）直接给出中文含义
- 全表校验面板：非数值、整数位/小数位超限、日期格式、非法日期、逻辑值、超出字段长度、含换行或控制字符；点击定位到单元格
- 文件信息面板识别「前缀_YYYYMMDD」命名约定，显示该文件的数据日期

**数据表工具**

- 保存（原地覆盖或另存为）、整理数据表（物理清除已删除记录）、清空数据表、切换表头版本（dBase III+/IV/V）
- 新建表：S68 模板（18 字段）、req 模板（14 字段）或空白表，可选表版本（dBase III+/IV/V，记住上次选择）；CSV 导入（分隔符嗅探、编码判定、类型推断）

**导出**

CSV、JSON、SQL（标准 / MySQL）、HTML、Markdown、Excel 2003 XML、DBF、定长文本；可选导出范围（全部 / 当前筛选 / 当前记录）、分隔符、输出编码、UTF-8 BOM、包含已删除记录。

**宿主集成**

- 主题跟随 DBX（浅色/深色/自动），外观可手动覆盖
- 中英文界面切换；`setTitle`、插件私有存储（偏好与字段笔记）、受控文件读写全部通过 Host API
- 快捷键：`Ctrl+S` 保存、`Ctrl+F` 搜索、`F2`/`Enter` 编辑、`Delete` 删除行、`Alt+←/→` 切换列、方向键导航、`Esc` 关闭菜单

## 连接类型（新建连接）

`manifest.json` 除工作台外，还声明了贡献点 `connection-provider`（`id = com.dbx.dbf.connection`，`database_type = dbf`），DBX 的「新建连接」中会出现 **DBF 数据文件** 类型，表单字段由宿主渲染：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| 连接名称 | text（`binding: name`） | 连接列表显示名 |
| 数据源 | radio | 单个 DBF 文件 / DBF 目录（批量） |
| DBF 文件 | text + 文件选择器 | 桌面端写入绝对路径；同目录 `.DBT`/`.FPT` 自动识别 |
| 数据目录 | text + 目录选择器 | 列出目录下（仅直接子项）的全部 DBF，可逐表切换 |
| 字符集 | select | auto / GBK / UTF-8 / Big5 / 932 / 949 / 1252 / 437 / 866 |
| 允许写回原文件 | boolean | 关闭时保存走「另存为」；开启时先备份 `.bak` 再替换 |

连接的生命周期由宿主驱动 `connection/test` → `connection/connect` → `connection/disconnect`，全部交给 `backend/bin/dbx-dbf-backend.exe` 处理；测试会返回形如 `S68.DBF · 1 条记录 · 18 个字段` 的结果。连接打开的是 `com.dbx.dbf.workbench` 工作台，宿主只传 `{connectionId, providerId, connectionType}`，工作台再用 `dbf/info` 取路径与表清单、用 `dbf/read` 分块（512 KiB）读取文件，因此大表也不会一次性占用 iframe 内存。

写回走 `dbf/write-begin | write-chunk | write-commit`：sidecar 写临时文件、备份原文件为 `.bak`、再原子替换；`allow_write=false` 或连接只读时 UI 直接禁用保存。

## 字段字典

字段释义分成**数据**与**规则**两层：

- `ui/js/columns-cn.js` —— 纯数据，`DBF_COLUMNS` 里只有「列名 → 中文名」的对应关系，以及少量代码字段的值域表（如交易市场）。重新生成或整体替换它不会影响任何逻辑。
- `ui/js/dict.js` —— 规则，负责文件族判定（按文件名前缀）、来源优先级（自定义 > 文件分表 > 同族规范并集 > 通用释义）、置信度与前后缀提示。
- 匹配规则：**列名不区分大小写**（`sbbh` 与 `SBBH` 等价），且**任何 DBF 文件都能命中**——文件族不匹配时回退到全量并集（深市 364 + 上市公司版 146 + 沪市 PROP 32），命中即标注「通用」；只有完全未收录的列名才给前缀/后缀提示。

`columns-cn.js` 收录：

| 来源 | 字段数 | 置信度 |
| --- | --- | --- |
| 《深市登记结算数据接口规范（结算参与人版 Ver 5.18）》 | 364 | 规范（spec） |
| 《登记结算数据接口规范（上市公司版 V3.19）》20 类文件（T1–T9、S6–S13、S11、S12、AGCC、BGCC、ZYDJ、H1） | 146（并集） | 规范（spec） |
| 沪市 PROP 交换文件（S68/req 样例推断） | 32 | 推断（inferred） |
| 用户导入的自定义释义（运行期，存于宿主存储） | 不限 | 自定义（custom） |

上市公司版按 **文件前缀** 识别表族：`前缀 + 证券代码(6 位)`，如 `t1600001all.dbf`（全体持有人名册）、`zydj60000020201215.dbf`（质押冻结）、`agcc60000120150604all.dbf`（送股登记持仓）。同一字段在不同文件中含义可能不同（例如 `CYSL` 在 `T1` 是「持有数量」、在 `S13` 是「减持数量」），因此每个前缀都有独立字段表；文件自身表中没有的字段依次回退到该规范并集、再回退到全量通用并集（任意文件的同名列），仍无则按前缀/后缀给出提示（如 `DM` → 代码、`JE` → 金额），并在界面标注「推断」。

`describeField(fileName, fieldName)` 返回 `{cn, confidence, source, prefix, hint, family, custom, shared, origin}`，信息面板同时显示表族与规范出处；`confidence` 取 `spec`（规范）/ `inferred`（推断）/ `shared`（通用）/ `custom`（自定义）。想给自己的一批表补中文名：桌面端在「更多 → 字段释义」里导出当前表字段释义 JSON（`字段名: 中文名`），编辑后导入即可；同名条目会覆盖内置释义并标为「自定义」，只影响显示，不改动 DBF 本身。

## 权限

`manifest.json` 仅申请三项权限：

| 权限 | 用途 |
| --- | --- |
| `host.workbench` | 打开工作台、设置标题 |
| `host.filesystem` | `fileTransfer.pick/read/beginSave/write`，即打开与保存 DBF |
| `host.storage` | 保存偏好（语言、列宽、页大小）与字段笔记 |

不申请网络、剪贴板读、数据/连接/计划读取权限。所有解析与导出都在沙箱 iframe 内本地完成，数据不出宿主。

## 开发与验证

需要 Node.js 22+（本仓库使用 `fnm` 提供的 v24.21.0）与 Go 1.22+（sidecar）：

```bash
cd backend && go build -o bin/dbx-dbf-backend.exe .   # 编译 sidecar（linux/macos 换 GOOS）
cd .. && dbx-plugin package .                          # 产出 dist/com.dbx.dbf-0.3.6-<target>.dbxp
dbx-plugin dev --path . --port 5190                    # 独立调试宿主（会启动 sidecar）
uv run --no-project --python 3.12 python tools/gen-samples.py   # 重新生成构造示例表
```

`dbx-plugin dev` 只提供调试外壳，插件 UI 在点击侧栏「DBF Studio」后才会在沙箱 iframe 中加载；宿主会把 `ui/index.html` 引用的脚本与样式内联进 `srcdoc`，因此调试时不要依赖外部 HTTP 资源（沙箱 CSP `connect-src 'none'`）。

示例表由 `tools/gen-samples.py` 生成，**全部字段值都是虚构的**：字段布局照规范填写以便演示字典释义，但仓库里不含任何真实账户、证券或持有人数据。用于对照磁盘字节的自动化回归脚本属于内部工具，未随仓库发布。

## 目录

```
manifest.json          插件清单（ID、权限、工作台 + 连接类型贡献点、zh-CN/en 本地化）
dbx-plugin.toml        打包配置（include = assets, ui, backend/bin）
assets/plugin.svg      插件图标
backend/main.go        Go sidecar：连接生命周期、dbf/info、分块读、原子写回
backend/dbxpluginsdk/  官方 Go SDK（stdio JSONL、plugin/initialize）
backend/bin/           编译产物 dbx-dbf-backend.exe（不提交）
tools/gen-samples.py   构造示例表生成器（字段布局按规范，数据全部虚构）
ui/index.html          应用外壳（工具条、网格、侧栏、详情、弹窗）
ui/styles.css          设计令牌 + 组件样式（浅色/深色）
ui/js/dbf-core.js      DBF 引擎：解析、写出、编码、备注、校验、导出
ui/js/gbk-table.js     GBK ⇄ Unicode 双字节表（TextEncoder 无法输出 GBK）
ui/js/columns-cn.js    列名 ↔ 中文名数据层（含值域表、用户自定义释义）
ui/js/dict.js          字段释义规则层：族判定、来源优先级、置信度、前缀/后缀提示
ui/js/i18n.js          中英文字典
ui/js/samples.js       内置示例表（base64）
ui/js/app.js           控制器：状态、渲染、编辑、保存、搜索、菜单、连接模式
ui/js/views.js         对话框：字段、导出、CSV 导入、新建表、列设置、关于
docs/analysis.md       REA 静态分析记录与设计取舍
```

## 已知限制

- 带备注字段（`.DBT`/`.FPT`）的表可读可查，但保存被禁用：备注块需要重写，当前版本不生成备注文件（连接模式下写回同样不会更新备注文件）。
- 连接模式写回只替换 `.dbf` 本身，目录模式仅允许目录的直接子文件，且文件名里不能出现路径分隔符。
- sidecar 按当前宿主平台打包（本仓库产物为 `windows-x64`）；跨平台发布需在对应平台重新 `go build` 并打包。
- 写出的注释型 VFP 表使用 dBase 风格字段描述区（10 字符短名），不含 VFP 长字段名与 `0x30` 序号表。
- 加密表头（`encrypted`）与索引（`.MDX`/`.CDX`）只做标记，不解析内容。
- 沪市 PROP 规范未随仓库提供，S68/req 字段释义为推断值，界面已标注。
- 上市公司版字段按文件前缀分表，文件名不符合「前缀+代码」约定时只能回退到并集或前缀提示。

## 发布

`dbx-plugin package .` 产出未签名 `dist/com.dbx.dbf-0.3.6-windows-x64.dbxp` 与 `.artifact.json`（`backend/bin` 会被改写成包内 `bin/windows-x64/dbx-dbf-backend.exe`）；本地安装需在插件中心开启「允许安装未签名开发包」。正式上架流程（`.dbx-store.json`、GitHub Release 候选包、DBX Store 审核与签名、上架要素清单）见 [`docs/store.md`](docs/store.md)。

## 变更

- `0.3.6`：字段释义改为「任意文件 + 列名大小写不敏感」匹配，文件族不匹配时回退到全量并集并标注「通用」；侧栏、字段对话框与信息面板同步显示该标记。
- `0.3.5`：把「DBF 列名 ↔ 中文名」的对应关系从代码中解耦为独立数据文件 `ui/js/columns-cn.js`，`dict.js` 只保留族判定、来源优先级与置信度等规则；新增「更多 → 字段释义」菜单：导出当前表字段释义 JSON、导入自定义释义（运行期合并、持久化、优先级最高）、清空自定义释义，侧栏与字段对话框会标注「自定义」。
- `0.3.4`：校验规则增加「整数位超出上限」与「含换行或控制字符」，问题列表随界面语言切换；详情面板为交易市场代码等少量代码字段给出中文含义；文件信息面板识别「前缀_YYYYMMDD」命名并显示数据日期；新建表可选表版本（dBase III+/IV/V）并记住上次选择。
- `0.3.3`：新增手动更换编码重新打开——编码按钮菜单提供「自动识别 + 8 种编码」，编码设置对话框带前三行实时预览与「记住此文件的编码」；修复自动识别在 LDID 为 0 时把编码对象当作字符串、导致回退 UTF-8 而乱码的问题（优先级改为 严格 UTF-8 探测 > LDID > 交换文件族 > 文件名），保存时按当前编码写入对应 LDID。
- `0.3.2`：全新插件图标（渐变徽章 + 数据表文档 + 折叠角），插件中心、商店与工作台内统一展示；功能与 0.3.1 一致。
- `0.3.1`：补充作者与开源地址（关于对话框可直接复制仓库链接），`manifest.json` 增加 `publisher` / `source` / `homepage`，新增商店元数据 `.dbx-store.json` 与上架说明 `docs/store.md`。
- `0.3.0`：接入《登记结算数据接口规范（上市公司版 V3.19）》20 类文件的字段字典（按文件前缀分表，146 个字段并集），新增 `T1600001.DBF` 构造示例与新建表模板；文件信息面板补充「数据类型 / 规范来源」，语言驱动与最后更新日期改为可读格式。
- `0.2.0`：新增 `connection-provider` 与 Go sidecar，可从 DBX「新建连接」以「DBF 数据文件」类型连接单文件或目录，支持分块读取与原子写回（`.bak` 备份）。
- `0.1.0`：纯前端工作台，支持打开/识别/编辑/校验/导出（8 种格式）与深市 D-COM、沪市 PROP 字段释义。

## 许可证

MIT，见 [`LICENSE`](LICENSE)；作者 微茫之心，仓库 [`qingkong9579/dbx.dbf`](https://github.com/qingkong9579/dbx.dbf)。
字段释义引用公开接口规范，规范原文版权归各交易所 / 登记结算机构所有；插件不包含任何接口规范原文。


