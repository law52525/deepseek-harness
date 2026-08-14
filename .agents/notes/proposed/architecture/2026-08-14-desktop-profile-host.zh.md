# Agent Note: P1 — 无 HTTP 的 Desktop profile Host

Status: proposed

[English](2026-08-14-desktop-profile-host.md) | 中文

## Problem

`dsh web` 启动 `dsh-base` 加上 [`dsh-web-app`](../../../../packages/bundle/web-app/README.md)，后者插入 `dsh-host-webserver`、`frontend-static`、`web-startup`（`--host` / `--port`），以及打印 URL 的 `web-runtime`。双面客户端包硬性注入该服务器：`dsh-client-modules`（`static inject = ['webServer', 'loader']`）注册 `/plugins` 并用 index.html tap 注入 `window.__DSH_BOOT__`；`dsh-client-connection`（`inject = ['webServer']`）绑定 `/api` 与 WebSocket upgrade。没有 webserver 时这些 fiber 永远不会激活。

桌面产品需要同一套 Host 业务插件和同一份客户端名录图，但[不得监听 HTTP](./2026-08-14-desktop-installer-product.md)。`ClientModuleRegistry` 已经暴露 `graph()` 与 `clientPath(id)` 给非 HTTP 消费者；HTTP 注册却混在构造函数里。

## Proposal

新增 **`desktop` profile**，其第二层组合包是叠在 `dsh-base` 上的新包 `@deepseek-ai/dsh-desktop-app`。

### Bundle contents

复制 web-app 中属于 Host 业务与客户端名录的行（api-gateway、workspace、storage、directory-picker-auto、`dsh.client` 名录、api-remotes，以及 web 组合包设定的同一套 persona/tools 默认值）。

**不要**插入：

- `dsh-host-webserver`
- `dsh-host-frontend-static`
- `web-startup` / `--host` / `--port` / `--trusted-host`
- `web-runtime` 的 URL 打印与 LAN 信任采样
- `dsh-client-hmr`（保持禁用；桌面加载已构建 bundle）

插入一个由 desktop-app 包持有的小型 **desktop-runtime** 插件（装配胶水，对标 web-runtime）：配置 `{surfaceContext}` 在为 true 时注册 harness-source 提示词段落，提供不含任何绑定地址含义的 `desktopRuntime` 服务，且不打印 URL。

### Make HTTP optional on dual-face node halves

`dsh-client-modules`：只注入 `loader`。无论有无服务器都组合图并提供 `clientModules`。仅在 `ctx.inject(['webServer'], …)` 内注册 `/plugins` 与 `tapIndex`，以便存在服务器时今天的 `dsh web` 行为不变。

`dsh-client-connection`：去掉硬性 `inject = ['webServer']`。仅在存在 `webServer` 时注册 `/api` 与 upgrade。当没有 HTTP 时，node 半边仍须提供客户端名录需要的任何宿主侧 RPC 辅助（若宿主侧唯一工作就是注册路由，则该 fiber 除已有服务外可以是空操作）。

`dsh-client-hmr` 已经要求 `webServer`；desktop 组合包直接省略或禁用该行即可。`dsh-client-ui-theme` 已经可选注入 `webServer`；保持不变。

### Launcher

增加 `dsh desktop` 作为 `--profile desktop` 的别名，对标 `dsh web`。首次使用时从随附模板自动初始化该 profile，与 web/headless 相同。`dsh --profile desktop --help` 不得启动服务器，也不得打开 Electron 窗口。

`dsh --profile desktop --dump-config` 不得出现 webserver 行或端口表达式。

### Boot graph without HTTP

desktop-runtime（或 P2 的 Electron main）在 Loader 结算后读取 `ctx.clientModules.graph()`。P1 证明在 Node 中 dump/boot 能得到完整图，且在 `pnpm run build` 之后 `clientPath(id)` 指向已存在的 `lib/client.js`。P2 再把该图注入渲染进程。

### P0 dependency

P1 不实例化 `IpcApiClient`。仅当冒烟测试要在进程内驱动一元 RPC 时才可导入 `HostIpcGateway` 类型；该冒烟可选。只有在接线网关时 P1 才必须在 P0 之后或与之同栈；纯组合的 P1 可与 P0 并行。

推荐栈：先 P0 再 P1，因为 P2 两者都要。

### Out of scope

Electron、IPC 接线、安装包、改变 Web profile 的默认绑定。

## Alternatives considered

**保持硬性 `webServer` 注入，并挂一个绑在 `127.0.0.1`、端口 0 的桩服务器。** 这仍是 HTTP 载体。桌面渲染进程离误用它只差一次泄漏，Electron 也会「复用 webserver」。

**把 `dsh-client-modules` 分叉成 desktop-modules 包。** 会重复图组合，而那正是桌面唯一需要的部分。

**让 `dsh-web-app` 自身通过配置变成 HTTP 可选。** 把两个产品混在一个组合包里，并使 `dsh web --dump-config` 依赖一个针对 web 产品行的 flag。

## Acceptance criteria

- `@deepseek-ai/dsh-desktop-app` 存在，含 `dsh.bundle.patch`、README、invariant 配套，以及一份先列 `dsh-base` 再列 `dsh-desktop-app` 的 profile 模板。
- `dsh --profile desktop --dump-config`（以及 `--dump-default-config`）包含客户端名录与 api-gateway，且不含 `dsh-host-webserver` 或监听端口。
- `dsh desktop --help` 与 `dsh --profile desktop --help` 以 0 退出且不绑定端口。
- modules 与 connection 在 web profile 下仍注册 HTTP 路由；现有 web 测试保持绿。
- 对 desktop profile 做一次无 Electron 的 Node 启动，能提供与 web 相同 immediately 档位包的 `ctx.clientModules.graph()`，且构建后这些 id 的 `clientPath` 在磁盘上存在。
- 交付后把本说明移到 `implemented/`。

## Risks

modules/connection 上可选的 `webServer` 会改变加载顺序：一份忘了 webserver 行的错误 web overlay 现在会启动一个 GUI 沉默的 Host，而不是在 inject 时失败。Web profile 模板仍必须包含 webserver；`dsh web` 的 REAL 组合测试仍是守卫。

desktop-app 会与 web-app 的名录漂移。写明：在存在可被两个组合包消费、且不含 HTTP 行的共享名录片段之前，往 web-app 增加 `dsh.client` 行必须同时加到 desktop-app（P1 不要发明该片段，除非两者都能消费它）。

## Cursor prompt

粘贴到新的 Cursor agent：

1. 只实施 `.agents/notes/proposed/architecture/2026-08-14-desktop-profile-host.md` 中的 P1。阅读[产品说明](./2026-08-14-desktop-installer-product.md)、[P0](./2026-08-14-desktop-ipc-carrier.md)、`packages/bundle/web-app/cordis.patch.yml`、`packages/bundle/web-app/README.md`、`packages/client/modules/src/index.ts`、`packages/client/connection/src/index.ts`、`apps/cli/src/args.ts`、`docs/cookbook/adding-a-package.md`、`AGENTS.md` 与 `packages/AGENTS.md`。
2. 不要添加 Electron 或安装包打包。不要从 web profile 移除 HTTP。不要实现 `apps/desktop`。
3. 在 `packages/bundle/desktop-app/` 按 web-app 组合包模式添加 `@deepseek-ai/dsh-desktop-app`。把它登记进 tsconfig、constraints 与 CLI profile 模板。
4. 按说明把 modules 与 connection 的 node 半边改成 `webServer` 可选。用现有测试证明 web 的 HTTP 注册；用新测试证明 desktop 的 dump-config 与 help。
5. 若 P0 尚未合入，不要阻塞在 `IpcApiClient` 上；让本 PR（Pull Request）保持为纯组合。
6. 更新 README、`apps/cli` 帮助文本，以及本 Agent Note（交付后移到 `implemented/`）和中文配对。
7. 不要开始 P2–P5。
8. 运行聚焦的组合包/CLI/modules/connection 测试以及针对该 diff 的文档门禁。遵循 `.agents/skills/dsh-pre-push-checks/SKILL.md`。
