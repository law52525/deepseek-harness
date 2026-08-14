# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

desktop profile 的 Electron 壳。main 用系统 Node 孵化带 stdio IPC 的 `dsh --profile desktop` 子进程，在 `dsh://app/` 提供 [`dsh-web-frontend`](../web/package.json) dist，并转发不透明 RPC。[`HostIpcGateway`](../../packages/host/apiproxy/README.md) 跑在子进程里；本包不解码 RPC body。渲染进程通过 `BootSeams.loadBundle` 复用 Web 壳内核。

`contextIsolation` 为 true，`nodeIntegration` 为 false。preload 暴露 `window.__DSH_IPC_PORT__`（`IpcPort`）和 `window.__DSH_DESKTOP__`（`bootGraph`、`readPlugin`）。插件字节只来自 Host 图内的 `clientPath`。

在仓库根目录运行 `pnpm run dev:desktop`（先跑 `pnpm run build`，再 `electron .`）。`pnpm run dist:desktop` 会暂存一份无符号链接的 Node Host 闭包和前端 dist，并在当前操作系统上运行 electron-builder（macOS arm64 的 `.dmg` 与 `.zip`，Windows x64 的 NSIS）。Windows 产物保持未签名。macOS 产物为 ad-hoc，除非在已有 Developer ID Application 身份和 `APPLE_*` 时运行 `pnpm run dist:mac:signed`。GitHub Releases 发布已公证的 `.dmg` 与未签名的 `.exe`；打包后的构建会检查该 Release 做整应用自动更新。

## 已知限制与延期工作

- **CI 中没有 Electron e2e** — jsdom 与 Node 子进程证明接线；尚无 Playwright Electron 套件。
- **Windows 包未签名** — SmartScreen 会警告。Intel Mac、Windows arm64、Linux、MAS 与 Authenticode 不在范围内。已公证的 Mac 包可直接打开，不会被 Gatekeeper 拦截。
- **原生 OS 对话框仍在 Node 子进程** — `host.pickDirectory` 打开 Node 侧的 `osascript` / Zenity / `IFileOpenDialog` 选择器；`host.openPath` 使用现有 opener。Electron `dialog.showOpenDialog` 与 WebView 预览属于后续阶段。孵化保持 `windowsHide: false`，以便 Windows 对话框仍能出现。测试用与 web e2e 拦截 `host.openPath` 相同的方式拦截这些命令，不启动 Electron 或真实应用。
- **原生 OS 对话框仍在 Node 子进程** — `host.pickDirectory` 打开 Node 侧的 `osascript` / Zenity / `IFileOpenDialog` 选择器；`host.openPath` 使用现有 opener。Electron `dialog.showOpenDialog` 与 WebView 预览属于后续阶段。孵化保持 `windowsHide: false`，以便 Windows 对话框仍能出现。测试用与 web e2e 拦截 `host.openPath` 相同的方式拦截这些命令，不启动 Electron 或真实应用。
