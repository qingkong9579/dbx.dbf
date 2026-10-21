# 上架 DBX 官方插件商店

本文说明 `com.dbx.dbf`（DBF Studio）从本地目录到官方商店的完整路径，依据
[DBX 插件开发文档 · 提交官方商店的完整流程](https://dbxio.com/cn/docs/plugin-development) 与
`t8y2/dbx` 的 `plugin-release-reusable.yml`（2026-10 版本）整理。

## 0. 上架前必须成立的前提

| 项目 | 本项目状态 |
| --- | --- |
| `manifest.json` 的 `id` / `name` / `publisher` / `version` / `permissions` | ✅ `com.dbx.dbf` / `DBF Studio` / `qingkong9579` / `0.3.1` / 3 项 |
| 源码公开可访问，并带版本 Tag | ⬜ 需推送到 `https://github.com/qingkong9579/dbx.dbf` 并打 `v0.3.1` |
| 每个平台各一个**未签名** `.dbxp` + 同名 `.artifact.json` | ⬜ 由 GitHub Release 工作流产出（本地只出当前平台） |
| `release-candidates.json` | ⬜ 由可复用工作流自动合并生成，不需手写 |
| `.dbx-store.json`（商店文案：名称/简介/标签/许可证/主页） | ✅ 已提供，仅首次登记或改文案时才需要 |
| 许可证 | ✅ MIT（`LICENSE`，可按需替换） |
| 不提交二进制与私钥 | ✅ `.gitignore` 已忽略 `dist/`、`.dbx-dev/`、`bin/` |

| 不提交二进制与私钥 | ✅ `.gitignore` 已忽略 `dist/`、`.dbx-dev/`、`backend/bin/`、`*.log` |

> 仓库根目录就是插件目录本身（`manifest.json`、`ui/`、`backend/`、`tools/`、`docs/`）。
> 不要发布规范 PDF 原文、`DBFPlus.exe`、分析脚本输出或本机截图；示例表都是 `tools/gen-samples.py` 生成的虚构数据。
> 若日后改为「外层仓库 + 子目录」结构，需要在 `.github/workflows/plugin-release.yml` 里额外传
> `working-directory`，并把 `package-path` / `metadata-path` 改成相对该目录的路径。

## 1. 发布源码 Tag 与候选 Release

1. 递增 `manifest.json` 的 `version`（本项目当前 `0.3.1`），同步 `backend/main.go` 的
   `pluginVersion`，让宿主 `plugin/initialize` 回报的版本与 manifest 一致。
2. 提交并打 Tag：`git tag v0.3.1 && git push origin v0.3.1`。
3. 在 GitHub 创建 Release（`published`），工作流
   [`.github/workflows/plugin-release.yml`](../.github/workflows/plugin-release.yml) 会自动触发。

工作流做的事（`plugin-release-reusable.yml`）：

- 按 `build-matrix` 在 5 个 runner 上分别执行 `DBX_PLUGIN_TARGET=<target> dbx-plugin package .`，
  产出 `dist/com.dbx.dbf-0.3.1-<target>.dbxp` 与 `.artifact.json`；
- 校验：target 名合法性、`sha256` 为 64 位十六进制、`size` 与包字节一致、
  候选包**不含** `signature.json`、候选 metadata **不含** `signingKeyId`、
  5 个平台的 manifest 身份（id/name/description/publisher/version/permissions）完全一致；
- 合并出 `release-candidates.json`（`{plugin:{…}, artifacts:[{target,url,sha256,size}]}`），
  与所有 `.dbxp` 一起 `gh release upload --clobber` 到该 Release。

本插件含 Go sidecar，**不能**只出 `universal` 包——`bin/<target>/dbx-dbf-backend(.exe)`
是平台原生二进制。当前 matrix 为 `windows-x64`、`linux-x64`、`linux-arm64`、
`darwin-x64`、`darwin-arm64`；若只想先上 Windows，可临时删掉其余条目（商店允许只登记部分平台）。

## 2. 首次登记：发布者 + 候选

商店候选目录在 [`t8y2/dbx-store`](https://github.com/t8y2/dbx-store)，不是 `t8y2/dbx`。

- **自动同步**：维护者在 `dbx-store/automation/plugin-sources.json` 注册
  `{仓库, publisher, autoUpdate:true}` 后，同步 Workflow 会读取最新 Release 的
  `release-candidates.json`，自动创建/更新 `candidates/com.dbx.dbf.json` 候选 PR。
  作者无需每版手工建 Issue/PR，也不需要商店签名 Secret。
- **手动首登**：Fork `dbx-store`，向 `main` 提一个 PR，包含
  `publishers/qingkong9579.json`（发布者首次登记）与 `candidates/com.dbx.dbf.json`。
  candidate 结构：

```json
{
  "schemaVersion": 1,
  "id": "com.dbx.dbf",
  "publisher": "qingkong9579",
  "version": "0.3.1",
  "name": "DBF Studio",
  "source": "https://github.com/qingkong9579/dbx.dbf/tree/v0.3.1",
  "license": "MIT",
  "targets": [
    {
      "target": "windows-x64",
      "url": "https://github.com/qingkong9579/dbx.dbf/releases/download/v0.3.1/com.dbx.dbf-0.3.1-windows-x64.dbxp",
      "sha256": "<包文件的 64 位 SHA-256>",
      "size": 2400000
    }
  ]
}
```

`sha256` / `size` 直接取自 Release 上的 `.artifact.json`；候选文件只引用自己仓库的未签名资产，
**不能**填 `signingKeyId`，也不要手改生成出的 `plugins/` 与 `catalog/index.json`。

CI 在签名前会保持红色，提示 `open candidate(s) awaiting DBX Store signing`——这是预期行为。

## 3. 审核 → 签名 → 合并

维护者审核源码、manifest、权限、原生行为与哈希/大小，然后运行受保护的签名 Workflow：

1. 按已审核的 `sha256` + `size` 下载候选包；
2. 确认无既有签名，核对插件 ID 与版本；
3. 用 DBX Store 仓库密钥（Ed25519）签名，产出最终 `.dbxp`、artifact metadata、signing receipt；
4. 把 `plugins/com.dbx.dbf.json` 与 `catalog/index.json` 回写到同一个 PR。

通过后维护者合并 PR，插件出现在官方商店目录。作者全程不接触官方私钥，
也不需要 `dbx-plugin keygen`（那是自建私有仓库才用的）。

## 4. 后续版本

1. 改代码 → 递增 `version`（禁止覆盖旧 Release 资产）→ 打新 Tag → 发布新 Release；
2. 等同步 Workflow 生成 `<plugin-id>/<version>` 候选 PR；
3. 维护者审核、签名、合并。

只有目录信息、审核状态、下载地址、哈希、大小或商店文案变化才进 `dbx-store`；
功能问题在插件源码仓库修。

## 5. 提交前本地自检清单

```powershell
# 1) 语法与后端
node --check ui/js/app.js; node --check ui/js/views.js; node --check ui/js/i18n.js
cd backend; go vet ./...; go build -trimpath -ldflags "-s -w" -o bin/dbx-dbf-backend.exe .

# 2) 本地调试宿主（带 sidecar 构建）
dbx-plugin dev --path . --port 5190

# 3) 打包当前平台并核对包内容
dbx-plugin package .
tar -tf dist/com.dbx.dbf-0.3.1-windows-x64.dbxp
Get-Content dist/com.dbx.dbf-0.3.1-windows-x64.artifact.json
```

- 包内不应出现 `ui/samples` 之外的开发文件、`.dbx-dev/`、`dist/`、`_ref/`；
- 版本号三处一致：`manifest.json`、`backend/main.go` 的 `pluginVersion`、`About` 对话框；
- 未签名包安装需在插件中心开启「允许安装未签名开发包」，该开关不放宽商店校验；
- 权限申请要能在 UI 里找到对应动作（本插件：工作台、文件读写、偏好存储），审核会逐项核对。

## 6. 常见拒审 / 失败原因

| 现象 | 原因 |
| --- | --- |
| `Candidate metadata must not declare signingKeyId` | 候选文件里提前写了官方密钥 ID |
| `manifest identity differs from other targets` | 各平台包 manifest 不一致（常见于 CI 里临时改版本号） |
| `Candidate package must be unsigned` | 上传了已签名包（自定义仓库签名混入候选） |
| 候选 PR CI 一直红 | 正常，等签名 Workflow 回写 |
| 商店里缺某个平台 | 该 target 未产出，或 matrix 未包含（Go sidecar 必须逐平台构建） |
| `dbx-plugin.toml and manifest.json must either both declare a backend` | 只改了一处 backend 声明 |
