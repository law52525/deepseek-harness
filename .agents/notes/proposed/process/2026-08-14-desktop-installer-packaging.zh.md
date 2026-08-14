# Agent Note: P4 — Windows 与 macOS 的桌面安装包打包

Status: proposed

[English](2026-08-14-desktop-installer-packaging.md) | 中文

## Problem

P2 在已经装有 Node、pnpm 且工作区已构建的开发者机器上给出 `electron .`。那不是安装包。Windows 与 macOS 上的操作者需要一份可下载的包，内含 Electron 壳、Node 运行时、desktop-profile 插件闭包、原生 addon 与前端 dist，并且能在没有系统 Node 的情况下启动 GUI。

Python SDK 的 [single-exe 流水线](../../implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) 已经能物化无符号链接的 Node 闭包并暂存 `node-pty`，但其部署根目录是 JSON-RPC agent，目标里没有 Windows，产物是 stdio exe 而不是 Electron 应用。

## Proposal

增加一份 **desktop 部署根目录** 和一条 **electron-builder** 流水线，用于发出各平台安装包。

### Contents of one install

| Piece | Source |
|---|---|
| Electron runtime + `apps/desktop` main/preload/renderer | electron-builder `app` |
| Node runtime for the Host child | platform Node matching the engines range (`^22.19 \|\| >=24`), shipped beside the app, not Electron's Node |
| Plugin closure | pnpm deploy of a new workspace manifest (pattern of `python/sdk-runtime/package.json`) whose dependencies are `dsh-base` + `dsh-desktop-app` + every package those pull |
| Frontend dist | `@deepseek-ai/dsh-web-frontend` export, extraResource |
| Native addons | `node-pty` (and Windows picker `koffi`) staged for the **Node** ABI, not Electron's |

Host 子进程可执行文件是使用捆入的 Node 运行 `node path/to/dsh/bin --profile desktop`。v1 不要用 pkg-SEA 打包 Host，除非 Python exe 闭包被证明比目录树更好复用；目录 extraResource 可以接受。

### Deploy manifest

新建零代码依赖 manifest 的工作区包（名称待定，例如 `dsh-desktop-runtime`）。`scripts/verify-runtime-closure.ts`（或其 desktop 兄弟）在缺少必需工作区 peer 时让构建失败。往安装包加插件就是加一行依赖再重新构建。

### electron-builder

由 `apps/desktop` 持有。脚本：

- `pnpm --filter <desktop-app> run dist` 构建当前平台。
- CI（P5）在原生 runner 上跑同一条命令。

产物：

| Platform | Artifact | Arch first ship |
|---|---|---|
| macOS | `.dmg` (zip optional) | arm64 |
| Windows | NSIS `.exe` | x64 |

Intel Mac 与 Windows arm64 是明确的后续，不是 v1 门槛。Linux AppImage 不在 v1。

在目标操作系统上构建。官方产物不要求从 macOS 交叉编译 Windows。

### Signing in P4

P4 可以发出**未签名**（Windows）和 **ad-hoc 签名**（macOS，与 pkg 对 Python exe 的做法相同）的产物，以便开发者在 Gatekeeper 覆盖 / SmartScreen 警告下本地安装。README 必须写明。公证、Developer ID 与 Authenticode 放在 [P5](./2026-08-14-desktop-installer-release-ci.md)。

### CLI / docs

根目录 README 在产物存在后增加「Desktop (preview)」小节并链到安装说明，同时不删除 `npx @deepseek-ai/dsh web`。`dsh web` 仍是默认。

### Tests

- 闭包校验门禁（hygiene 或 desktop 构建脚本）。
- 冒烟：从暂存闭包解包/运行 Host 子进程，带 `--profile desktop --help` 与 `--dump-config`（无窗口）。
- 可选：在 CI 里启动一次打包后的 Electron（若 P4 只做暂存，P5 可以拥有它）。

### Out of scope

自动更新、公证、发布 GitHub Releases（P5）。P3 的 B 片 Electron 对话框。

## Alternatives considered

**electron-packager / Forge，而不写下选定的 builder。** 两种工具都能用；本说明选定 electron-builder，避免实施 PR（Pull Request）里再争论。改选需要编辑本决策。

**用 pkg-SEA 打 Host，只把 exe 放在 Electron 旁边。** 体积上有吸引力，但 pkg VFS 加 Electron extraResources 加 Windows 是三套打包系统。v1 更想要子进程能 `import` 的真实 `node_modules` 树。

**为 Electron 重建原生 addon 并丢掉 Node 子进程。** 那是同进程模型，已被[产品说明](../architecture/2026-08-14-desktop-installer-product.md)后置。

**在安装包里塞 npm + `npx`。** 仍需要网络，也不是离线桌面包。

## Acceptance criteria

- 在 macOS arm64 上 `pnpm run dist:desktop`（或等价 filter）产出一份 `.dmg`，安装后的应用能在没有系统 Node 的情况下打开 GUI。
- 同一流水线在 Windows x64 上产出具有相同性质的 NSIS `.exe`。
- 暂存的 Host 闭包能启动 `--profile desktop --dump-config` 且没有 webserver 行。
- `verify-runtime-closure`（或兄弟脚本）接到 desktop 构建上，并在缺少 peer 时失败。
- 未签名/ad-hoc 状态已文档化。当两个平台的产物至少在原生机器上各产出过一次后，把本说明移到 `implemented/`（CI 仍可以属于 P5）。

## Risks

安装包体积会到数百 MB（Electron + Node + 闭包）。v1 接受这一点；裁剪属于后续 simplification 说明。

Windows Defender / SmartScreen 会对未签名 exe 发出警告。若这在内部挡住用户「能装上」的目标，P5 签名必须立刻跟上。

macOS 上的 `node-pty` spawn-helper 必须放在捆入的 Node 二进制旁边，这是 Python exe 流水线已经学到的。

## Cursor prompt

粘贴到新的 Cursor agent：

1. 只实施 `.agents/notes/proposed/process/2026-08-14-desktop-installer-packaging.md` 中的 P4。P2 必须已经能未打包运行。阅读该说明、[产品说明](../architecture/2026-08-14-desktop-installer-product.md)、`.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md`、`scripts/build-exe-for-python-sdk.ts`、`scripts/verify-runtime-closure.ts`、`python/sdk-runtime/package.json` 与 `apps/desktop`。
2. 不要实现自动更新、公证或 GitHub Release 上传。不要切到 Host-in-Electron-main。不要丢掉 Node 子进程。
3. 增加 desktop 部署根工作区包，暂存 Node + 闭包 + 前端 dist，为 macOS dmg（arm64）与 Windows NSIS（x64）配置 electron-builder，并添加 `dist:desktop`。
4. 复用 Python exe 的闭包校验思路；不要复制一套未经核实的第二份 deploy flag — 测量无符号链接的输出。
5. 更新根目录 README（两种语言），写上预览安装步骤和 Gatekeeper/SmartScreen 警告。产物存在后把本说明移到 `implemented/`，并更新中文配对。
6. 对暂存树运行闭包校验以及 `--profile desktop --help`。遵循 `.agents/skills/dsh-pre-push-checks/SKILL.md`。
7. 除非同一条用户请求把签名密钥也划进范围，否则不要开始 P5。
