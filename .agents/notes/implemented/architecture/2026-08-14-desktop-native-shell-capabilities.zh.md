# Agent Note: P3 — 桌面壳上的原生能力

Status: implemented

[English](2026-08-14-desktop-native-shell-capabilities.md) | 中文

## Problem

GUI 已经通过 Host RPC 选择目录并打开路径。[`directory-picker-native`](../../../../packages/host/directory-picker-native/README.md) 在 Node 进程里运行操作系统选择器（`osascript`、Windows `IFileOpenDialog`、Linux Zenity/KDialog）。[`host.openPath`](../../../../packages/host/apiproxy/README.md) 把文件交给操作系统。两者都作为特权 / 回环操作门控。

[选择器 seam 说明](./2026-07-28-directory-picker-capability-seam.md) 写明 Electron 壳可以通过自己的对话框 API 提供 `native` 交互，作为又一个双面后端，而无需改网关或 ui-workspace。[工作区文件链接说明](../feature/2026-07-31-web-workspace-file-links.md) 把内嵌 WebView 记为产品内文件预览的正确隔离，并明确把它留给桌面壳。

P2 的 Node 子进程已经可以调用现有原生选择器。第一版安装包不需要 Electron 对话框。P3 的存在，是为了在 Electron 明显更好的地方由壳拥有平台 UX，并让预览工作有记录在案的归属，而不是在 Web 载体里膨胀。

## Decision

A 片已交付。desktop Host 子进程已经钉死 `@deepseek-ai/dsh-host-directory-picker-native` 与 `@deepseek-ai/dsh-client-ui-directory-picker-native`，因为 `directory-picker-auto` 会注入 `webServer`。本阶段保持这一钉死，并经窗口所用的同一条 IPC 证明 Node 选择器与 opener。

在运行中的桌面壳上：

- `host.pickDirectory` 打开 Node 原生选择器（不是应用内 browse 模态框），并返回路径或取消。
- `host.openPath` / 产出文件的「打开」使用现有 opener。
- 存在 `window.__DSH_IPC_PORT__` 时 `isLoopback` 保持为 true，以便这些操作仍然可见。
- 选择取消（Escape / abort）映射到现有的 `null` 取消结果；原生流程占用者上报 `onCancel`，ui-workspace 不会创建工作区。

没有新包。未改 ui-workspace。渲染进程从不调用 Electron `dialog`。

### Deferred: Electron dialog provider

B 片仍未实现：`@deepseek-ai/dsh-host-directory-picker-electron` 将作为双面后端，其 Host 的 `pick` 在 **Electron main** 进程调用 `dialog.showOpenDialog`（子进程经哑转发器询问 main；main 永不解析 RPC 信封）。客户端半边将复用与 `-native` 相同的无渲染占位模式。desktop 组合包将挂它**而不是** `-native`，二者不可同时挂载。

ui-workspace 保持不变。没有 `native` / `browse` 之外的 kind。

### Deferred: WebView preview

不进入第一版安装包。排期后由后续说明拥有一个加载 `file://` 工作区文档、且不与 GUI 渲染进程共享 origin 的 `BrowserView` / `webContents`。在此之前，在操作系统中打开仍是预览方式。

## Alternatives considered

**在 Electron 对话框交付之前阻塞 P4。** Node 选择器在 macOS 与 Windows 上已经能用。安装包交付不等第二个选择器。

**经 HTTP 提供工作区文件做预览。** Web 产品已否决；不要为桌面复活它。

**让渲染进程直接调用 Electron `dialog`。** 需要暴露额外 preload API，并绕过选择器 seam。

## Testing

`packages/bundle/desktop-app/tests/composition.spec.ts` 钉死 `-native` 的 Host 与 UI 行，并排除 `directory-picker-auto`。

`apps/desktop/tests/native-ops.e2e.ts`（built-bin-smoke）孵化真实的 `--profile desktop` 子进程（在客户端 bundle 存在之前以及在 Windows 上自跳过）。PATH shim 拦截 `osascript` / Zenity 与 `open` / `xdg-open`，因此 CI 不会弹出对话框或启动应用——与 web e2e 对 `host.openPath` 的 spy 同一拦截立场。该套件断言：启动图包含原生 UI 行；`host.describe.canOpenPath` 为 true；`host.listDirectory` 以 `capability: 'native'` 回答 `directory-picker-unavailable`；选择返回 shim 路径且 `workspace.create` 接纳它；取消返回 `null` 且不增加工作区；`host.openPath` 到达平台 opener 命令。

带 IPC 端口时 connection 客户端的 `isLoopback` 已由 `packages/client/connection/tests/client-apply.client.spec.ts` 钉住。NativeDirectoryFlow 把 `null` 映射到 `onCancel` 由 `packages/client/ui-directory-picker-native/tests/client-flow.client.spec.tsx` 覆盖。

Windows 的 COM `IFileOpenDialog` 无法在此用 PATH shim。[`directory-picker-native`](../../../../packages/host/directory-picker-native/README.md) 持有那些测试；孵化保持 `windowsHide: false`，以便用户会话中的对话框仍能出现。**CI 中的 Electron e2e 仍是具名缺口**（没有 Playwright Electron 套件；没有「选择工作区」的侧栏截图）。

## Consequences

desktop 组合包恰好挂一个 native 选择器后端。若把 `directory-picker-auto` overlay 到 desktop，会重新引入本 Host 无法满足的 `webServer` 注入。

B 片必须替换 `-native` 行，而不是再叠一个 native 后端，否则「选择工作区」会双重提示。

没有桌面会话的 Windows 子进程仍可能让 COM 失败；P2 的 `windowsHide: false` 让子进程留在用户会话中。在出现 Windows e2e runner 之前，Windows 上的证明是开发者机器上的窗口检查。

WebView 预览不进入本说明的代码。在后续说明拥有 `BrowserView` 之前，在操作系统中打开仍是预览方式。

## Related

- [桌面产品](../../proposed/architecture/2026-08-14-desktop-installer-product.md)
- [P0 IPC 载体](./2026-08-14-desktop-ipc-carrier.md)
- [P1 desktop profile Host](./2026-08-14-desktop-profile-host.md)
- [P2 Electron 壳](./2026-08-14-desktop-electron-shell.md)
- [目录选择器 seam](./2026-07-28-directory-picker-capability-seam.md)
- [工作区文件链接](../feature/2026-07-31-web-workspace-file-links.md)
