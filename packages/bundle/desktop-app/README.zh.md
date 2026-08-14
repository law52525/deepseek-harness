# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

dsh 桌面表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.md) 之上：设置与 [`dsh-web-app`](../web-app/README.md) 相同的 coding persona 与 Host 业务行（API 网关、workspace、投影缓存、存储、原生目录选择器、`dsh.client` 名录、api-remotes、agent-presets，以及同一套宿主平面工具禁用），并挂载本包的 `desktop-runtime` 粘合插件（配置为 `{surfaceContext}`）。该插件提供不含绑定地址的 `desktopRuntime`，在 `surfaceContext` 为 true 时注册 harness-source 提示词段落，且不打印 URL、不挂载 HTTP。本组合包还持有应用命令行：普通 `desktop-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（[`dsh-cmdline`](../../boot/cmdline/README.md)），解析 `--help`，再提供 `desktopStartup`。由 flag 门控的行会注入该服务，因此 `dsh --profile desktop --help` 不会启动服务器，也不会打开 Electron 窗口。

在存在可被两个组合包消费、且不含 HTTP 行的共享名录片段之前，往 web-app 增加 `dsh.client` 行必须同时加到本组合包。

## 模型体验

### Harness 源码上下文

#### 模型看到的内容

当 `surfaceContext` 为 true 时，`harness:source` 段落标明磁盘上的 Harness 实现，但不会声称它就是工作目录。当它为 false 时，该段落不会注册。

#### Token 影响

每个会话一行源码说明；每个进程内保持恒定。

#### KV Cache 影响

该提示词段落位于系统提示词靠前位置，且在进程整个生命周期内稳定，因此不会使跨轮次缓存失效。

## 已知限制与延期工作

- **没有 HTTP 监听** — 此 Host 不挂载 `dsh-host-webserver`，也不打印 URL；Electron 渲染进程通过进程 IPC（`desktop-app/ipc-host`）消费 `ctx.clientModules.graph()`。Session 日志下载走同一条 IPC：壳的 `dsh:` handler 把 `GET`/`HEAD` `/api/session.export` 转成 control 文档，GET 的 ZIP 字节作为 Host 写入的临时路径返回。
- **原生目录选择器已钉死** — `directory-picker-auto` 会注入 `webServer`，因此本组合包直接挂载 `-native` 的 Host 与 UI 行。`host.pickDirectory` 与 `host.openPath` 在 Node 子进程里经 IPC 运行；Electron 对话框后端后置。
- **客户端名录必须与 web-app 对齐** — 在两者共享一份不含 HTTP 行的片段之前，新增 `dsh.client` 行必须同时出现在两个组合包中。
