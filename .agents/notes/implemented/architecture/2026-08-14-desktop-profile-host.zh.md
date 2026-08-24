# Agent Note: P1 — 无 HTTP 的 Desktop profile Host

Status: implemented

[English](2026-08-14-desktop-profile-host.md) | 中文

## Problem

已交付的 GUI 是 `dsh web`：`dsh-base` 加上 [`dsh-web-app`](../../../../packages/bundle/web-app/README.zh.md)，后者插入 `dsh-host-webserver`、`frontend-static`、`web-startup`（`--host` / `--port`），以及打印 URL 的 `web-runtime`。双面客户端包把 HTTP 注册混进了构造：`dsh-client-modules` 只有在注入 `webServer` 之后才组合启动图，`dsh-client-connection` 也以同样方式绑定 `/api`。没有 webserver 时这些 fiber 永远不会激活。

[桌面产品](./2026-08-14-desktop-installer-product.zh.md) 需要同一套 Host 业务插件和同一份客户端名录图，但不得监听 HTTP。`ClientModuleRegistry` 已经暴露 `graph()` 与 `clientPath(id)` 给非 HTTP 消费者。

## Decision

**`desktop` profile** 作为模板随附交付，其第二层组合包是叠在 `dsh-base` 上的 `@deepseek-ai/dsh-desktop-app`。`dsh desktop` 是 `--profile desktop` 的硬编码别名，对标 `dsh web`。首次使用时从该模板自动初始化。

### Bundle contents

desktop-app 的 patch 复制 web-app 中属于 Host 业务与客户端名录的行（api-gateway、workspace、storage、`dsh.client` 名录、api-remotes，以及 web 组合包设定的同一套 persona/tools 默认值）。

它**不**插入 `dsh-host-webserver`、`dsh-host-frontend-static`、`web-startup` / `--host` / `--port` / `--trusted-host`、`web-runtime` 的 URL 打印与 LAN 信任采样，也不插入 `dsh-client-hmr`。

它**不**使用会注入 `webServer` 的 `directory-picker-auto`。patch 在 Host 上钉死 `@deepseek-ai/dsh-host-directory-picker-native`，并把 `@deepseek-ai/dsh-client-ui-directory-picker-native` 作为静态 `dsh.client` 行。[P3](./2026-08-14-desktop-native-shell-capabilities.zh.md) 保持这一钉死；Electron 对话框后端仍后置。

由 desktop-app 包持有的小型 **desktop-runtime** 插件（装配胶水，对标 web-runtime）接受 `{surfaceContext}`：为 true 时注册 harness-source 提示词段落；提供不含绑定地址的 `desktopRuntime`（`{ surface: 'desktop' }`），且不打印 URL。

普通 **desktop-startup** 提供方解析 `--help`，并把未知多余参数当作用法错误，再把 `desktopStartup` 提供为 `{}`。没有绑定 flag。

### Make HTTP optional on dual-face node halves

`dsh-client-modules`：`static inject = ['loader']`。无论有无服务器都组合图并提供 `clientModules`。仅在 `ctx.inject(['webServer'], …)` 内注册 `/plugins` 与 `tapIndex`，以便存在服务器时 `dsh web` 行为不变。

`dsh-client-connection`：`export const inject: string[] = []`。始终构造 `HostConnectionService`。仅在 `ctx.inject(['webServer'], …)` 内注册 `/api` 与 upgrade。

`dsh-client-hmr` 已经要求 `webServer`；desktop 组合包省略该行。`dsh-client-ui-theme` 已经可选注入 `webServer`。

### YAML startup inject for `--help`

仅有插件级的 `loader` 注入不足以阻止 `--help` 扫描客户端 bundle：`appExit` 是异步关闭，不是同步 `process.exit`。因此 web-app 的 `modules` 行注入 `[webStartup]`。desktop-app 的 `modules` 与 `connection` 行注入 `[desktopStartup]`。`dsh --profile desktop --help` 不提供该服务，这些行保持挂起。

### Composition only

无 HTTP 的组装不绑定监听器。[Electron 壳](./2026-08-14-desktop-electron-shell.zh.md) 在存在父进程 IPC 通道时，通过 `desktop-app/ipc-host` 在 Node 子进程中实例化 `HostIpcGateway`。安装包属于 [P4](../process/2026-08-14-desktop-installer-packaging.zh.md)。web profile 仍然挂载 HTTP。

在存在可被两个组合包消费、且不含 HTTP 行的共享名录片段之前，往 web-app 增加 `dsh.client` 行必须同时加到 desktop-app。本阶段不发明该片段。

## Alternatives considered

**保持硬性 `webServer` 注入，并挂一个绑在 `127.0.0.1`、端口 0 的桩服务器。** 这仍是 HTTP 载体。桌面渲染进程离误用它只差一次泄漏，Electron 也会复用 webserver。

**把 `dsh-client-modules` 分叉成 desktop-modules 包。** 会重复图组合，而那正是桌面唯一需要的部分。

**让 `dsh-web-app` 自身通过配置变成 HTTP 可选。** 把两个产品混在一个组合包里，并使 `dsh web --dump-config` 依赖一个针对 web 产品行的 flag。

**不做 YAML 层的 `desktopStartup` / `webStartup` 门控，只靠插件级 inject。** `--help` 仍会激活 modules 并扫描客户端 bundle，因为关闭是异步的。YAML 行 inject 才让图保持挂起。

**改 `directory-picker-auto`，让它不再注入 `webServer`。** 不在本阶段范围内；[P3](./2026-08-14-desktop-native-shell-capabilities.zh.md) 保持钉死原生选择器，而不是让 auto 在没有 HTTP 的情况下运行。钉死原生 Host 与 UI 行，避免经 auto 把 HTTP 拉进来。

## Testing

`packages/bundle/desktop-app/tests/composition.spec.ts` 组合 base 与 desktop-app，断言客户端名录与 api-gateway 存在，且不含 `dsh-host-webserver`、`directory-picker-auto`、HMR 或端口表达式。它还把 `dsh-client-*` 行与去掉 HMR 的 web-app 对比（desktop 保留原生选择器行）。`tests/startup.spec.ts` 证明 `--help` 与未知 `--port` 不会提供 `desktopStartup`。`tests/desktop-app.spec.ts` 证明运行时标记与可选的 harness-source 段落，且不打印 URL。

`packages/client/modules/tests/node-half.client.spec.ts` 与 `packages/client/connection/tests/node-half.host.spec.ts` 证明无 HTTP 时仍有图 / `connection`；现有 web 测试在存在 `webServer` 时仍注册路由。

`apps/cli/tests/args.spec.ts` 与 `packages/boot/app-boot/tests/profile.spec.ts` 钉住 `desktop` 别名与模板。`apps/cli/tests/built-bin.e2e.ts` dump desktop profile 时不含 webserver 行，打印 `--help` 时不含 `--port`。`packages/bundle/desktop-app/tests/host-graph.e2e.ts`（built-bin-smoke，在 `pnpm run build` 产出客户端 bundle 之前自跳过）在 Node 中启动 desktop 组合，断言 immediately 档位图以及磁盘上的 `clientPath`，且没有 `webServer`。

## Consequences

modules/connection 上可选的 `webServer` 会改变加载顺序：一份忘了 webserver 行的错误 web overlay 现在会启动一个 GUI 沉默的 Host，而不是在 inject 时失败。Web profile 模板仍必须包含 webserver；`dsh web` 的 REAL 组合测试仍是守卫。

在共享片段出现之前，desktop-app 会与 web-app 的名录漂移。`packages/client/AGENTS.md` 要求每条新的 `dsh.client` 行同时出现在两个组合包中。

原生目录选择器保持钉死。若操作者把 `directory-picker-auto` overlay 到 desktop，会重新引入本 Host 无法满足的 `webServer` 注入。[P3](./2026-08-14-desktop-native-shell-capabilities.zh.md) 经子进程 IPC 证明 Node 选择器与 opener。

`dsh --profile desktop --dump-config` 与 `--help` 不启动服务器，也不打开 Electron 窗口。[Electron 壳](./2026-08-14-desktop-electron-shell.zh.md) 读取的就是此 Host 已经组合好的同一份图。

## Related

- [桌面产品](./2026-08-14-desktop-installer-product.zh.md)
- [P0 IPC 载体](./2026-08-14-desktop-ipc-carrier.zh.md)
- [P2 Electron 壳](./2026-08-14-desktop-electron-shell.zh.md)
- [P3 原生壳能力](./2026-08-14-desktop-native-shell-capabilities.zh.md)
- [P4 安装包打包](../process/2026-08-14-desktop-installer-packaging.zh.md)
- [P5 发布 CI](../process/2026-08-14-desktop-installer-release-ci.zh.md)
- [Profile 插件组合包](./2026-08-05-profile-plugin-bundles.zh.md)
