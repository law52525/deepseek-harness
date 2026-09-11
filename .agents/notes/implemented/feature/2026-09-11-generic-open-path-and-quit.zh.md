# Agent Note: 通用 open-path-and-quit 与仅 https 的 open-external

Status: implemented

[English](2026-09-11-generic-open-path-and-quit.md) | 中文

## 问题

Host 插件可以下载安装包并知道绝对路径，但不能退出 Electron 应用，也不能用系统默认方式打开该文件。打开 `https:` 下载页或版本说明链接同样做不到。`app.quit`、`shell.openPath`、`shell.openExternal` 和 detached `spawn` 只存在于主进程。若 packaged 启动仍调用 `startDesktopAutoUpdate`，会与插件弹窗并行跑第二套更新并抢下载。

## 决定

桌面壳新增两条通用 Host → 父进程消息，新代码不含产品名、版本号或下载域名：

- **`open-path-and-quit { id, path }`** — `path` 必须是绝对路径。Windows 以 detached 子进程启动 exe 后，等下一 tick 没有 `error` 事件才 `app.quit()`（ENOENT 不得退出）。macOS / `openPath` 返回空串后退出。`quit` 回调先 `disarm('update-install')`，避免强制闸门挡住退出。任何失败都回 `open-path-result { id, ok: false, detail }` 且**不退出**。成功则直接退出、不回消息。
- **`open-external { id, url }`** — 仅 `https:` 调用 `shell.openExternal`；其他 scheme 一律拒绝。父进程总是回 `open-external-result { id, ok, detail? }`。

`apps/desktop/src/main.ts` 的 packaged `whenReady` 不再调用 `startDesktopAutoUpdate`。`auto-update.ts` 与 `check-for-updates` 分发保留，以便仍发送该消息的老客户端有路可走；新的 Host 代码不再发送。

## 考虑过的替代方案

- **继续只靠 electron-updater 装包** — 否决。历史上 Mac `latest-mac.yml` 优先列 dmg，`MacUpdater` 从未装成功，且静默更新没有 UI。
- **Host `child_process` / 渲染进程 `window.open`** — 否决。Host 子进程退不出壳，渲染进程也无法可靠地拉起 NSIS 安装程序再退出应用。
- **`open-external` 放行 `http:` / `file:`** — 否决。版本说明和下载页都是 https；其他 scheme 是不必要的跳转面。

## 后果

插件拥有 feed URL、文案和 sha512。壳只负责打开路径或 https URL。切到官方壳时，把这两条消息映射到官方等价 IPC，或继续留在 fork。packaged 启动不再静默检查 yml；应用内检查 + 弹窗是唯一更新入口。
