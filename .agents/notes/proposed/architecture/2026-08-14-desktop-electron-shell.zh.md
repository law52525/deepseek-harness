# Agent Note: P2 — Electron 壳、preload、BootSeams 与启动清单

Status: proposed

[English](2026-08-14-desktop-electron-shell.md) | 中文

## Problem

P0 提供 IPC 载体。P1 提供带客户端图、无 HTTP 的 Host profile。尚未有任何东西创建窗口、加载 `dsh-web-frontend` dist、注入 `window.__DSH_BOOT__` 或拉取插件 bundle。Web 壳内核 [`AppWebEntry`](../../../../packages/client/web/README.md) 期望该清单在 `window` 上，并经由 `<script src="/plugins/…">` 装载插件。`file://` 的 origin 是 `'null'`，经典 script 标签无法使用 Host 的 `/plugins` 路由（根本没有这些路由），而 `WebApiClient` 会对着该 null origin 调用 `globalThis.fetch`。

`BootSeams.loadBundle` 已经在 jsdom 测试里替换脚本到达。connection 客户端的 `apply` 除非设置了 `?fixture`，否则总是构造 `WebApiClient`。

## Proposal

新增 **`apps/desktop`**：Electron 应用装配。它不是能力包。

### Main process

- 用 `desktop` profile 孵化 Node Host 子进程（开发：`pnpm dsh --profile desktop` / 源码启动器；打包后：P4 捆入的 Node 入口）。
- 等到子进程就绪（一次 IPC 握手：Loader 结算后子进程 post `host-ready`）。
- 创建 `BrowserWindow`，`contextIsolation: true`、`nodeIntegration: false`，并带 preload 脚本。
- `loadFile` 已构建的 `dsh-web-frontend` `index.html`。
- 退出时中止进行中的 RPC，dispose（资源释放）Host 子进程，然后退出。子进程拆除遵循[防御模式](../../../../docs/defensive-patterns.md)。

main 进程把 Electron IPC + 子进程的 process IPC 适配为 `IpcPort`，并在**子进程**里运行 `HostIpcGateway`（子进程拥有 `ctx.apiProxy`）。main 是哑转发器：renderer ↔ main ↔ child。不要在 main 里重实现 RPC。

### Preload

通过 `contextBridge` 暴露结构化的 `IpcPort`（仅 post/subscribe，无 `require`，无文件系统）。页面不得使用通用的 `ipcRenderer.send` 发送任意通道。

### Renderer boot

一份薄 `main.ts`（或带 desktop 标志的现有 web 入口）运行 `new AppWebEntry(el, { loadBundle }).run()`：

- 启动前，从 Host 图设置 `window.__DSH_BOOT__`（preload 请求 `boot-graph` → 子进程 `ctx.clientModules.graph()`）。
- `loadBundle(url)` 把 `/plugins/<id>/client.js?rev=…` 映射为对 `clientPath(id)` 字节的 IPC 读取，再按 `apps/web/tests/assembled-boot.ts` 里 jsdom 接缝的同一方式执行 factory。
- 在没有 `tapIndex` 的情况下注入初始主题（经一元 RPC 读取偏好，或把它与启动图一起传入）。`ui-theme` 的 HTTP tap 根本不会运行。

### Connection client

当存在 preload 接缝（将其命名为实现 `IpcPort` 的 `window.__DSH_IPC_PORT__`）时，`dsh-client-connection` 客户端 `apply` 构造 `IpcApiClient` 而不是 `WebApiClient`。`?fixture` 仍然优先。没有该接缝时保持 `WebApiClient`，供 `dsh web` 使用。

把 `file://` 视为回环，以便 `isLoopback` 仍启用仅限原生的 UI（目录选择器、在文件夹中显示）。

### Dev versus packaged

开发：从仓库根目录运行 `pnpm run dev:desktop`，构建或复用前端 dist，启动 Electron，并孵化源码 `dsh --profile desktop` 子进程。生产打包属于 P4；P2 只需要在已有 Node 且执行过 `pnpm run build` 的开发者机器上让 `electron .` 能跑。

### Tests

- 单元：preload/main 转发器不解码 RPC 正文（对 JSON 字符串足够二进制安全）；`loadBundle` 执行一份 fixture（测试前置数据）factory。
- 无密钥组装冒烟：Electron 或使用 `IpcApiClient` + `HostIpcGateway` + desktop profile 的 jsdom 替身，断言加载页结算。若 CI 里启动 Electron 尚未接线，完整 Playwright Electron 套件可等到 P4；那时 P2 必须用 jsdom 加 Node 子进程证明该接缝，并点名 Electron e2e 缺口。

### Out of scope

electron-builder、代码签名、自动更新、Electron `dialog.showOpenDialog`（P3）、WebView 文件预览。

## Alternatives considered

**渲染进程 `loadURL('http://127.0.0.1:<port>')`。** 违反产品规则，且跳过 `file://` 本来就需要的 BootSeams 工作。

**`nodeIntegration: true` 并在渲染进程里 require Host 模块。** 丢掉进程隔离，也无法运行浏览器客户端插件。

**P2 就把 Host 放进 Electron main。** 把原生 addon ABI 拖进第一扇窗口。产品说明已将其后置。

**第二个 Vite 应用，静态打包每一个客户端插件。** 会打破宿主编写的图和 HMR（热模块替换）模型；桌面会分叉其余 GUI 使用的装载架构。

## Acceptance criteria

- 在 macOS（开发者机器）上 `apps/desktop` 能打开窗口，对着 desktop-profile 子进程显示真实 GUI 壳，且不打印、不绑定 webserver 端口。
- 插件 bundle 经 `BootSeams.loadBundle` 到达，而不是经 HTTP 的 `<script src="/plugins/…">`。
- 一元 `host.describe` 与两条下行流都经 `IpcApiClient` 工作。
- `dsh web` 仍使用 `WebApiClient` 与 HTTP；web e2e/replay 保持绿。
- 关闭窗口会拆除子进程；子进程崩溃呈现错误页，而不是带着死 IPC 端口的僵尸窗口。
- 上述成立后把本说明移到 `implemented/`，并记录 Electron e2e 是在 CI 中运行还是仍为点名缺口。

## Risks

`file://` 加上对插件字节的 `eval`/脚本注入，其信任路径等价于提供 `/plugins`。这些字节必须只来自打包闭包内的 `clientPath`，绝不能来自工作区。

`location.origin === 'null'` 不得禁用回环 UI。测试必须钉死 IPC 接缝下 `isLoopback === true`。

若子进程只打日志而不 post `host-ready`，双进程就绪握手可能死锁。使用显式消息，不要刮 stdout。

## Cursor prompt

粘贴到新的 Cursor agent：

1. 只实施 `.agents/notes/proposed/architecture/2026-08-14-desktop-electron-shell.md` 中的 P2。P0 与 P1 必须已在该分支上。阅读那些说明、[产品说明](./2026-08-14-desktop-installer-product.md)、`packages/client/web/src/boot.tsx`、`packages/client/connection/src/client/index.ts`、`apps/web/tests/assembled-boot.ts`、`packages/client/modules/src/index.ts`（`graph`、`clientPath`）、`docs/defensive-patterns.md`、`AGENTS.md` 与 `packages/client/AGENTS.md`。
2. 不要添加 electron-builder、签名或自动更新。不要在 desktop profile 里绑定 `dsh-host-webserver`。不要实现 P3 的 WebView 预览。
3. 创建带 Electron main、preload `IpcPort`、孵化 `--profile desktop` 子进程、`AppWebEntry` + `loadBundle`、以及经 `window.__DSH_IPC_PORT__` 选择 `IpcApiClient` 的 connection 客户端的 `apps/desktop`。
4. `contextIsolation: true`，`nodeIntegration: false`。main 转发 IPC；`HostIpcGateway` 跑在 Node 子进程里。
5. 添加 Acceptance criteria 中点名的测试。若 Electron CI 尚未就绪，优先 jsdom/Node 证明；把本说明移到 `implemented/` 时在说明中记录该缺口。
6. 更新 README 与双语 Agent Note。不要开始 P3–P5，除非留下 P3 将挂钩的接口（不要把 TODO 写进产品 UI）。
7. 运行聚焦测试；若 connection 客户端行为有变，再加任何 `test:web` replay。遵循 `.agents/skills/dsh-pre-push-checks/SKILL.md`。
