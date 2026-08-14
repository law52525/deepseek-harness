# Agent Note: P2 — Electron 壳、preload、BootSeams 与启动清单

Status: implemented

[English](2026-08-14-desktop-electron-shell.md) | 中文

## Problem

P0 提供 IPC 载体。[P1](./2026-08-14-desktop-profile-host.md) 提供带客户端图、无 HTTP 的 Host profile。还没有人创建窗口、加载 `dsh-web-frontend` dist、注入 `window.__DSH_BOOT__`，或拉取插件 bundle。Web 壳内核 [`AppWebEntry`](../../../../packages/client/web/README.md) 期望该清单在 `window` 上，并通过 `<script src="/plugins/…">` 加载插件。`file://` 的 origin 是 `'null'`，经典 script 标签无法使用 Host 的 `/plugins` 路由（根本没有这些路由），而 `WebApiClient` 会对这个空 origin 调用 `globalThis.fetch`。

`BootSeams.loadBundle` 已经在 jsdom 测试里替换脚本到达。connection 客户端的 `apply` 在未设置 `?fixture` 时构造的是 `WebApiClient`。

## Decision

**`apps/desktop`**（`@deepseek-ai/dsh-desktop`）是 Electron 应用组装，不是能力包。`pnpm run dev:desktop` 先跑 `pnpm run build` 再运行 `electron .`。生产打包属于 [P4](../process/2026-08-14-desktop-installer-packaging.md)。

### 进程模型

Electron main 用系统 Node 孵化子进程（`npm_node_execpath`、`NODE_BINARY` 或 `PATH` 上的 `node`——当 `process.execPath` 是 Electron 时绝不使用它，也绝不使用 `ELECTRON_RUN_AS_NODE`），`stdio: ['ignore', 'inherit', 'inherit', 'ipc']`，且 `windowsHide: true`。argv 为 `dsh --profile desktop`（存在 `apps/cli/src/bin.ts` 时用 source `tsx` 启动器，否则用构建出的 bin）。子进程在 `@deepseek-ai/dsh-desktop-app/ipc-host` 内运行 [`HostIpcGateway`](./2026-08-14-desktop-ipc-carrier.md)。main 是哑转发器：renderer ↔ preload ↔ main ↔ child。RPC payload 在 `rpc` 通道上保持不透明 JSON；main 从不解析 body。

子进程在 `loader.await()` 之后（没有 Loader 时立即）发送 `host-ready`。终端里的 `dsh desktop` 没有父进程 IPC 通道，因此 `ipc-host` 为空操作，P1 的 CLI 行为不变。

退出时，main 中止进行中的 IPC handler，对子进程 SIGTERM，等待，必要时再 SIGKILL。子进程崩溃则加载错误页；窗口不会继续挂在已死的端口上。打包后的构建会检查 GitHub Releases 做整应用更新（[P5](../process/2026-08-14-desktop-installer-release-ci.md)）；缺少 feed 不会退出应用。

### Control 与 RPC

进程 IPC 使用 `@deepseek-ai/dsh-desktop-app/ipc-protocol` 中的 `DesktopIpcEnvelope`：`{ channel: 'rpc', payload }` 或 `{ channel: 'control', payload }`。control 文档为 `host-ready`、`boot-graph-request` / `boot-graph-response`（图加上 `themePreference`）、`plugin-bytes-request` / `plugin-bytes-response` / `plugin-bytes-failure`，以及 `session-export-request` / `session-export-response` / `session-export-failure`。插件字节只来自组合表内的 `ctx.clientModules.clientPath(id)`，从不来自渲染进程提供的路径。

Session Header 的 `Session log` 控件仍对页面 origin 发 `HEAD` 再跟 `<a download>`。在 `dsh://app` 下该 URL 是 `/api/session.export`，不是前端 dist 文件。`dsh:` handler 只把该路径上的 GET/HEAD 转给 Host 子进程，作为 control 文档（`sessionId` 与 `includeDescendants` 查询字段，从不是任意 URL）。子进程跑现有的 `toFetchHandler` 下载；GET 正文写入临时 ZIP，路径经 control 返回。main 读入该文件作为 protocol Response 并删除它。JSON RPC 保持仅 UTF-8（[P0](./2026-08-14-desktop-ipc-carrier.md)）；ZIP 不走 `unary-response`。该路径上的其他方法应答 405。缺少 Host 子进程应答 503。

### Preload 与渲染进程

`contextIsolation: true`，`nodeIntegration: false`。preload 暴露 `window.__DSH_IPC_PORT__`（仅 `IpcPort` 的 post/subscribe）和 `window.__DSH_DESKTOP__`（经 `ipcRenderer.invoke` 的 `bootGraph`、`readPlugin`）。页面不能对任意通道做通用的 `ipcRenderer.send`。

渲染进程复用 `dsh-web-frontend` dist。main 注册特权 `dsh:` scheme（`standard`、`secure`、`supportFetchAPI`），并在 `dsh://app/` 提供该 dist，这样 Vite 的 `/assets/…` URL 无需改 web 的 `base`。同一 handler 按上文从 Host 子进程应答 `GET`/`HEAD` `/api/session.export`。`apps/web/src/main.ts` 根据 `__DSH_DESKTOP__` 分支：从 Host 图设置 `window.__DSH_BOOT__`，在不导入 `ui-theme` 的情况下应用插件前主题，并运行 `new AppWebEntry(el, { loadBundle })`。`loadBundle` 把 `/plugins/<id>/client.js?rev=…` 映射到 `readPlugin(id)`，并以与 jsdom assembled boot 相同的方式求值 factory。

### Connection 客户端

当 `window.__DSH_IPC_PORT__` 具有 `post` 与 `subscribe` 时，`dsh-client-connection` 客户端 `apply` 构造 `IpcApiClient`，并把 `IpcApiClient.fetch` 传入通用 Connection RPC，使 `file:` / `dsh:` 页面不会打到 `globalThis.fetch`。`?fixture` 仍然优先。没有该端口时，`dsh web` 继续使用 `WebApiClient`。存在该端口、`location.protocol` 为 `file:`、或 hostname 为回环时，`isLoopback` 为 true。

Host 的 `desktop-ipc` 经 `connection.createSharedFetchHandler('/api', toFetchHandler(api))` 喂给 `HostIpcGateway`。已认领的 Typert Remote（例如 composer「+」命令菜单的 `commands/list`）在 API Proxy 回退之前分发。此载体不加 HTTP Host/Origin 栅栏，也不钉特权方法回环：IPC 对端已经是产品壳。

## Alternatives considered

**渲染进程 `loadURL('http://127.0.0.1:<port>')`。** 违反产品规则，并且跳过了非 HTTP origin 本来就需要的 BootSeams 工作。

**`nodeIntegration: true` 并在渲染进程里 require Host 模块。** 丢掉进程隔离，也无法运行浏览器客户端插件。

**在 Electron main 里进程内跑 Host。** 把 native addon ABI 拉进第一扇窗口。产品说明推迟了这一点。

**第二个 Vite 应用，静态打包每一个客户端插件。** 破坏 Host 编写的图与 HMR 模型；desktop 会分叉 GUI 其余部分使用的加载架构。

**对 `index.html` 使用 `loadFile` 并把 Vite `base` 改成 `'./'`。** 会迫使 `dsh web` 也消费该 `base`。特权 `dsh://app` origin 可以保留 `/assets` 绝对路径。

**在渲染进程里用 `IpcApiClient.fetch` 缓冲 ZIP 再走 blob URL。** JSON IPC 没有显式帧就不能承载二进制正文。control 通道上的临时文件可以继续使用浏览器下载管理器，并让 RPC 保持仅 JSON。

**在 desktop Host 上打开 TCP `/api` 监听。** 违反此 Host 没有 HTTP 的产品规则。

## Testing

单元测试覆盖 RPC 转发器（payload 同一性、不解码 body）、`loadBundle` factory 求值、主题 DOM 字段、`dsh:` 路径映射、Session 导出 URL 识别、GET 正文的临时路径约束、Node 与 Electron 的解析、`ipc-host` 在没有 `process.send` 时为空操作、针对 `HostIpcGateway` 的 host-ready / boot-graph / plugin-bytes / session-export / RPC、Connection interceptor 对 `commands/list` 这类已认领 Remote 的分发，以及 connection 客户端选择 `IpcApiClient` 加上 `file:` / IPC loopback。

`apps/desktop/tests/host-child.spec.ts` 用内存中的 child 把 `DesktopHostChild` 与 `attachDesktopIpcHost` 配对：`host.describe`、boot-graph 与 session-export control 在没有 Electron 的情况下成功。`apps/desktop/tests/host-child.e2e.ts` 孵化真实的 `--profile desktop` 子进程（在客户端 bundle 存在之前自跳过），并断言 host-ready、boot-graph、`host.describe` 以及两条下行流。

**CI 中的 Electron e2e 是具名缺口。** 本阶段没有 Playwright Electron 套件。jsdom 加上 Node 子进程证明这些接线；`pnpm run dev:desktop` 是开发者机器上的窗口检查。

## Consequences

在渲染进程中求值的插件字节，等价于受信路径上的 `/plugins` 提供。它们必须只来自打包闭包内的 `clientPath`。

`dsh://app` 下的 `location.origin` 不是 `'null'`，但通用 RPC 仍通过 `IpcApiClient.fetch` 使用 `http://dsh.internal`，因此页面 origin 不会变成一次 HTTP 跳转。Session 日志下载仍是对该 origin 上 `/api/session.export` 的浏览器 GET；壳从 Host 子进程应答它，而不是打开 HTTP。

双进程就绪握手使用显式的 `host-ready` 文档，而不是抓 stdout。

原生目录选择器保持 Node 的 `-native` 配对。[P3](./2026-08-14-desktop-native-shell-capabilities.md) 经子进程 IPC 证明 `host.pickDirectory` 与 `host.openPath`。子进程孵化使用 `windowsHide: true`，以免 Windows 打开 `node.exe` 控制台；Win32 选择器 worker 本身已经使用 `windowsHide: true`。

## Related

- [桌面产品](./2026-08-14-desktop-installer-product.md)
- [P0 IPC 载体](./2026-08-14-desktop-ipc-carrier.md)
- [P1 desktop profile Host](./2026-08-14-desktop-profile-host.md)
- [P3 原生壳能力](./2026-08-14-desktop-native-shell-capabilities.md)
- [P4 安装包打包](../process/2026-08-14-desktop-installer-packaging.md)
- [P5 发布 CI](../process/2026-08-14-desktop-installer-release-ci.md)
