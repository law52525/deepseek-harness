# Agent Note: P3 — 桌面壳上的原生能力

Status: proposed

[English](2026-08-14-desktop-native-shell-capabilities.md) | 中文

## Problem

GUI 已经通过 Host RPC 选择目录并打开路径。[`directory-picker-native`](../../../../packages/host/directory-picker-native/README.md) 在 Node 进程里运行操作系统选择器（`osascript`、Windows `IFileOpenDialog`、Linux Zenity/KDialog）。[`host.openPath`](../../../../packages/host/apiproxy/README.md) 把文件交给操作系统。两者都作为特权 / 回环操作门控。

[选择器 seam 说明](../../implemented/architecture/2026-07-28-directory-picker-capability-seam.md) 写明 Electron 壳可以通过自己的对话框 API 提供 `native` 交互，作为又一个双面后端，而无需改网关或 ui-workspace。[工作区文件链接说明](../../implemented/feature/2026-07-31-web-workspace-file-links.md) 把内嵌 WebView 记为产品内文件预览的正确隔离，并明确把它留给桌面壳。

P2 的 Node 子进程已经可以调用现有原生选择器。第一版安装包不需要 Electron 对话框。P3 的存在，是为了在 Electron 明显更好的地方由壳拥有平台 UX，并让预览工作有记录在案的归属，而不是在 Web 载体里膨胀。

## Proposal

P3 分两片落地。P4 之前只要求 A 片。

### Slice A — required: confirm Node native ops through IPC

在运行中的桌面壳上：

- `host.pickDirectory` 打开现有的 Node 原生选择器（不是应用内 browse 模态框），并返回路径或取消。
- `host.openPath` / 产出文件的「打开」使用现有 opener。
- `isLoopback` 保持为 true，以便这些操作仍然可见。
- 选择取消（Escape / abort）映射到现有的 `null` 取消结果。

若 auto 选择器已经为本地桌面选了 `native`，则不需要新包。若自动探测把 Electron 孵化的子进程当成无头环境，则在 desktop-app 的 patch 里钉死 `directory-picker-native`。

### Slice B — optional before P4: Electron dialog provider

新增 `@deepseek-ai/dsh-host-directory-picker-electron` 作为双面后端：Host 的 `pick` 在 **Electron main** 进程调用 `dialog.showOpenDialog`（子进程经哑转发器询问 main；main 永不解析 RPC 信封）。客户端半边采用与 `-native` 相同的无渲染占位模式。B 片交付时由 desktop 组合包挂它，而不是 `-native`。

不要编辑 ui-workspace。不要在 `native` / `browse` 之外再加 kind。

### Deferred: WebView preview

不进入第一版安装包。排期后由后续说明拥有一个加载 `file://` 工作区文档、且不与 GUI 渲染进程共享 origin 的 `BrowserView` / `webContents`。在此之前，在操作系统中打开仍是预览方式。

### Out of scope

安装包、自动更新、为非桌面 profile 替换 `host.openPath`。

## Alternatives considered

**在 Electron 对话框交付之前阻塞 P4。** Node 选择器在 macOS 与 Windows 上已经能用。安装包交付不等第二个选择器。

**经 HTTP 提供工作区文件做预览。** Web 产品已否决；不要为桌面复活它。

**让渲染进程直接调用 Electron `dialog`。** 需要暴露额外 preload API，并绕过选择器 seam。

## Acceptance criteria

Slice A:

- 在桌面窗口中，选择工作区 → 操作系统原生文件夹对话框 → 工作区出现在侧栏。
- 产出文件的打开动作在操作系统中打开（或测试用与 web e2e 相同的方式拦截 opener）。
- 取消不会创建工作区。

Slice B（若包含）：

- desktop 组合包挂载 Electron 选择器后端；web profile 仍按今天使用 auto/native/browse。
- ui-workspace 没有 Electron 导入。

A 片交付后把本说明移到 `implemented/`，并在 Consequences 中把 B 片与 WebView 记为后置工作（若只落地了文档则保持 proposed — 在 A 进入代码之前不要移动它）。

## Risks

若子进程的 `windowsHide` 孵化方式破坏对话框，没有控制台/桌面会话的进程里的 Windows COM 选择器可能失败。P2 的孵化 flag 必须让子进程留在用户会话中；P3 在 Windows 上的测试是证据。

若 Electron 对话框从 main 弹出，而子进程也在跑 Node 选择器，同时挂两个后端会双重提示。desktop 组合包必须恰好挂一个 native 后端。

## Cursor prompt

粘贴到新的 Cursor agent：

1. 实施 `.agents/notes/proposed/architecture/2026-08-14-desktop-native-shell-capabilities.md` 中的 P3 A 片。P2 必须已经能跑出一个窗口。阅读该说明、[产品说明](./2026-08-14-desktop-installer-product.md)、`.agents/notes/implemented/architecture/2026-07-28-directory-picker-capability-seam.md`、`packages/host/directory-picker-native/README.md`，以及 `packages/client/ui-workspace` 的 directory-flow 占用。
2. 不要实现 WebView 预览。除非用户要求，否则不要实现 B 片。不要开始 P4–P5。
3. 至少在 macOS 上证明「选择工作区」经 IPC 使用原生对话框；若能跑 Windows 则补上说明或测试。若在 Electron 孵化下自动探测失败，把 `directory-picker-native` 钉在 desktop 组合包里。
4. 复用 web e2e 里现有的 opener 拦截，而不是在 CI 里启动真实应用。
5. 更新 README 与本 Agent Note（A 片交付后移到 `implemented/`）以及中文配对。
6. 遵循 `.agents/skills/dsh-pre-push-checks/SKILL.md`。
