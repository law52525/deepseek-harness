# Agent Note: 桌面产品 — 以 Electron 壳承载 Node Host

Status: implemented

[English](2026-08-14-desktop-installer-product.md) | 中文

## Problem

当前交付的 GUI 是 `dsh web`：一个 Node Host，外加浏览器里打开的回环 HTTP URL。想在 Windows 或 macOS 上当应用来用的操作者必须先安装 Node、跑一条 CLI（命令行界面），并让浏览器标签页一直连着该进程。Web UI 不是静态站点；没有 Host 就无法打开会话、读取工作区或运行工具。因此只包装 Vite dist 不能做出桌面产品。

[GUI 分层说明](./2026-07-19-gui-layering-and-rpc-protocol.md) 已经预留了一个 Electron 客户端：复用 `packages/client/*`，且不复用 `dsh-host-webserver`。JSON IPC 载体在 `dsh-host-apiproxy`（[P0](./2026-08-14-desktop-ipc-carrier.md)）。Python SDK 的 [single-exe 流水线](./2026-07-10-single-file-executable-sdk-runtime-distribution.md) 会为 linux-x64、linux-arm64 和 macos-arm64 物化一份 Node 运行时闭包；它是无头 JSON-RPC 对端，不是 GUI 壳，且 Windows 不在其目标之列。

## Decision

DeepSeek Harness 交付为桌面应用：窗口渲染现有 Web UI，Host 仍是真实的 Node 进程。安装包是 macOS arm64 `.dmg` 与 Windows x64 NSIS `.exe`。

### Process model

第一版采用**双进程**：

1. **Electron 壳** — `BrowserWindow`、preload、到渲染进程的 IPC，从 GitHub Releases 自动更新（[P5](../process/2026-08-14-desktop-installer-release-ci.md)）。
2. **Node Host 子进程** — 在 `dsh-base` 之上启动 `desktop` profile，不监听 HTTP。

原生 addon（`node-pty`、Windows 目录选择器的 `koffi`）继续使用 Node 的 ABI。为 Electron 的 Node 重建它们是后续收敛，不是发安装包的门槛。渲染进程从不对用户可见端口打 HTTP；每条 RPC 与下行帧都走 IPC。

Host 进 Electron main 的同进程方案允许作为后续简化，前提是 addon ABI 已得到验证。它不得阻塞安装包交付。

### What this product reuses

- `dsh-base` 与 Web 客户端名录（`packages/client/*`、`dsh-web-frontend` dist）。
- `dsh-host-apiproxy` 信封、`AbstractApiClient` 与 `toFetchHandler`。
- 已在 Node 中运行的原生目录选择与 `host.openPath`。
- Python SDK 部署根目录的运行时闭包纪律：一份 manifest（元数据清单）点名打进包的插件集合。

### What this product must not do

- 只打包前端 dist。
- 把在 `BrowserWindow` 里加载 `http://127.0.0.1:3080` 当作交付载体。
- 引入平行的 `packages/electron-*` UI 包族。
- 使用 Tauri 或非 Node Host。
- 替换或削弱 `dsh web`。
- 把开发者机器根目录 `.env` 或 `DEEPSEEK_API_KEY` 打进安装包；模型密钥在首次启动后于 Settings 中保存。

### Phase map

| Phase | Note | Delivers |
|---|---|---|
| P0 | [IPC 载体](./2026-08-14-desktop-ipc-carrier.md) | 消息协议、`IpcApiClient`、宿主网关、不含 Electron 的测试 |
| P1 | [Desktop profile](./2026-08-14-desktop-profile-host.md) | `desktop` profile、无 HTTP 的 Host、双面插件上可选的 `webServer` |
| P2 | [Electron 壳](./2026-08-14-desktop-electron-shell.md) | `apps/desktop`、preload、`BootSeams.loadBundle`、启动清单注入 |
| P3 | [原生壳能力](./2026-08-14-desktop-native-shell-capabilities.md) | 把选择器与打开路径接到壳上；WebView 预览保持后置 |
| P4 | [安装包打包](../process/2026-08-14-desktop-installer-packaging.md) | electron-builder、含 Windows 的 Node 闭包、`.dmg` / `.exe` |
| P5 | [发布 CI](../process/2026-08-14-desktop-installer-release-ci.md) | macOS 公证、Windows 不签、GitHub Releases、自动更新 |

### Done

在一台干净的 Windows x64 机器和一台干净的 macOS arm64 机器上，且没有系统 Node：

1. 用户安装交付的安装包（`.exe` / `.dmg`）。
2. 应用窗口打开现有 GUI。
3. 用户可以添加工作区、保存模型密钥并开始会话。

安装包不得含有开发者的 `DEEPSEEK_API_KEY`。步骤 3 才是第一次写入模型密钥。

在后续产品决策把安装包提升为默认入口之前，根目录 README 仍把 `dsh web` 作为开发者预览的默认入口。

GitHub Releases 上有已公证的 macOS arm64 `.dmg` 与明确未签名的 Windows x64 `.exe`。任何阶段都没有把用户可见的 HTTP URL 当作桌面载体。

## Alternatives considered

**用 Electron 包装 `dsh web` 的回环 URL。** 探针最快，且能沿用今天的 HTTP 信任栅栏。这会让桌面产品继承端口、LAN 信任、浏览器连接上限和 index.html 注入，违背「Electron 不复用 webserver」的分层规则。

**第一版就把 Host 放进 Electron main。** 符合分层清单里「零端口」的理想，但每次升级 Electron 都要为 `node-pty` 和 Windows `koffi` 按 Electron ABI 重建。该风险压过安装包交付。

**Tauri 或 Rust Host。** agent loop（智能体循环）、工具、沙箱和客户端插件 loader 都是 Node 插件。第二套运行时会分叉每一条 seam。

**pkg 单文件 exe，仍打开系统浏览器。** 去掉了安装 Node 的步骤，但不是桌面应用，也没有使用预留的 Electron 客户端。

**为 UI 新建以 electron 为名的包族。** 分层说明已否决：产品共享的是 host/client 能力；装配写在 `apps/`。

## Consequences

相对于 `dsh web`，双进程生命周期（子进程崩溃、孤儿窗口、关闭顺序）是新问题。P2 在退出前 dispose（资源释放）Host。

若桌面部署 manifest 被手改，打包插件闭包会与 `dsh-web-app` 漂移。P4 按 `verify-runtime-closure` 门禁 Python exe 的方式生成并校验该闭包。

开发者预览仍会破坏兼容性。从 GitHub Releases 做自动更新时整应用替换，以免 extraResources 写到一半。
