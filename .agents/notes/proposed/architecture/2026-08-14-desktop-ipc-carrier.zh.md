# Agent Note: P0 — 不含 Electron 的 IPC fetch 载体

Status: proposed

[English](2026-08-14-desktop-ipc-carrier.md) | 中文

## Problem

每个 GUI 客户端都必须说同一套四象限 RPC。`AbstractApiClient` 持有协议不变量；子类提供传输。今天的子类是 `InProcessApiClient`（注入的 `fetch`）和 `WebApiClient`（HTTP 上行加两条 WebSocket 下行）。[分层说明](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) 把 IPC 子类命名为 Electron 载体，并写明换载体不应改动基类。

`WebApiClient` 已经覆盖 `openMux` / `openHost`，而不是走进程内 SSE（Server-Sent Events）路径，因此「只实现 `doFetch`」不足以支撑产品下行。IPC 消息类型、客户端子类和宿主网关都不存在；若协议要在 vitest 里测试，它们也不应依赖 Electron。

## Proposal

在现有 fetch 家族旁增加一套 **JSON IPC 载体**，不引入 `electron` 依赖。

把类型与两端放进 `@deepseek-ai/dsh-host-apiproxy`，与 `AbstractApiClient` / `toFetchHandler` / `InProcessApiClient` 为邻，并从现有的浏览器安全 `./client` 子路径导出客户端。

### Port

```text
interface IpcPort {
  post(message: IpcMessage): void
  subscribe(handler: (message: IpcMessage) => void): () => void
}
```

测试用 `MessageChannel` 或一对 `EventEmitter` 实现 `IpcPort`。P2 把 Electron 的 `ipcMain` / `ipcRenderer`（以及 Node 子进程的 `process` IPC）适配到该接口，不改消息类型。

### Messages

带判别标签的 JSON 文档，每次 `post` 一个对象：

```text
unary-request  { type, id, url, method, headers, body? }
unary-response { type, id, status, headers, body }
unary-failure  { type, id, message }
stream-open    { type, id, path }           // path is /api/events.mux or /api/events.host
stream-frame   { type, id, envelope }       // envelope is a ServerRequest
stream-end     { type, id, error? }
stream-abort   { type, id }
```

`id` 由客户端为每次一元调用和每条下行流签发。一元 `url` 相对 `http://dsh.internal` 解析，与 `InProcessApiClient` 相同。正文是 UTF-8 字符串（JSON RPC）。每个一元 POST 的头都带 `content-type: application/json`，以便宿主网关喂给 `toFetchHandler` 时 [媒体类型栅栏](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md) 仍然成立。

保持**两条下行流**且无跨流顺序保证，与 `WebApiClient` 一致。P0 不要把 mux 与 host 复用到同一个通道标签上。

### Client: `IpcApiClient`

继承 `AbstractApiClient`：

- `doFetch` 发送 `unary-request`，在 `unary-response` / `unary-failure` 上结算；`AbortSignal` 对一元调用不使用 `stream-abort`（丢掉挂起的 id 并在本地 post `unary-failure` 即可中止，或者若中止必须到达 handler 再加 `unary-abort`；优先通过 `unary-abort { type, id }` 中止网关中进行中的 fetch，以便 `host.pickDirectory` 的取消生效）。
- 增加 `unary-abort { type, id }`，让用户节奏的一元调用能在宿主侧取消。
- `openMux` / `openHost` 发送 `stream-open`，从 `stream-frame` 产出已解析的 `RpcRequest<Frame>`，并在 `stream-end` 或中止时结束。

畸形帧丢弃并记日志，与 `WebApiClient` 一致。带 `error` 的 `stream-end` 按 WebSocket 关闭一样使该连接世代失败。

### Host: `HostIpcGateway`

用 `toFetchHandler(api)` 加上 `api.events` 构造。对每个对端：

- `unary-request` → `handler.fetch` → `unary-response`；抛出的 fetch 错误 → `unary-failure`。
- 针对 mux/host 的 `stream-open` → 迭代 `api.events.mux` / `api.events.host` 并 post `stream-frame`；完成或抛出时 post `stream-end`。
- `unary-abort` / `stream-abort` 中止对应工作。

网关把 IPC 对端视为**回环、同源、且已认证的产品壳**。它不得监听 TCP 端口。该对端允许调用特权方法（`host.pickDirectory`、settings、credentials，以及 `dsh-client-connection` 中仅限回环的集合）。网页到达不了该网关。

### Connection plugin in P0

P0 不改 `dsh-client-connection` 的 HTTP 路由。导出 `IpcApiClient` 供 P2 构造。可选地在 P2 再识别已文档化的 `globalThis` 接缝；P0 测试直接构造该类。

### Out of scope

Electron、`desktop` profile、`file://` 插件装载、安装包。

## Alternatives considered

**只把 `IpcApiClient` 放在 `apps/desktop`。** P0 将没有可测试的包，Electron 应用会拥有所有载体测试都需要的协议类型。

**新建 `dsh-client-ipc` 包。** 只有一个消费者，是无主的混合物。分层说明把装配放在 `apps/`，把共享传输放在 `AbstractApiClient` 旁边。

**渲染进程继续对 localhost 使用 HTTP，IPC 只做窗口铬。** 交付的桌面仍停在 webserver 上，而本产品禁止这一点。

**全双工单通道 RPC（一元调用与帧走同一套接字）。** 会重写 HTTP 上行加两条下行已经解决的超时、中止与关联。IPC 没有浏览器六连接上限，但与 `IApiClient` 同构才是 P0 的目的。

**在 apiproxy 里依赖 Electron `ipcMain`。** 单元测试会拖进 Electron，并把宿主库耦合到壳上。

## Acceptance criteria

- `IpcApiClient`、`HostIpcGateway` 与 `IpcPort` 存在于 `dsh-host-apiproxy`，且 `packages/` 中没有 `electron` 导入。
- 在进程内 `IpcPort` 对上的载体测试证明：一元成功与 `rpcId` 回显；对挂起 handler 的一元中止；mux 与 host 帧在独立流中；中止一条活着的流；畸形 `stream-frame` 被丢弃且不杀死兄弟流；网关的 `unary-failure` 变成传输抛错。
- 一条特权一元调用（`host.pickDirectory` 或测试替身）能通过网关成功，且不需要来自浏览器的 HTTP `Host`/`Origin` 头。
- `pnpm --filter @deepseek-ai/dsh-host-apiproxy test` 为绿。尚无 `apps/desktop`。

## Risks

把 `Request`/`Response` 序列化成 JSON 字符串无法承载二进制正文。当前 RPC 仅有 JSON；若后续方法需要字节，本载体必须增加显式二进制帧，而不是悄悄做 base64。

把每个 IPC 对端都当作回环，只有在 Node 子进程只接受孵化它的 Electron main 连接时才正确。P2 不得打开 TCP 回退。

## Cursor prompt

粘贴到新的 Cursor agent：

1. 只实施 `.agents/notes/proposed/architecture/2026-08-14-desktop-ipc-carrier.md` 中的 P0。同时阅读 `.agents/notes/proposed/architecture/2026-08-14-desktop-installer-product.md`、`.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md`、`.agents/notes/implemented/architecture/2026-08-04-websocket-downlink-carrier.md`、`packages/host/apiproxy/src/fetch/client.ts`、`packages/host/apiproxy/src/fetch/` 的 handler 与 `toFetchHandler`、`packages/client/connection/src/client/web-api-client.ts`、`AGENTS.md`、`packages/AGENTS.md`，以及 `.agents/skills/dsh-prose-standard/SKILL.md`。
2. 不要添加 Electron、desktop profile、`apps/desktop` 或安装包脚本。不要改 `dsh-host-webserver` 或 Connection 的 HTTP 路由。
3. 在 `@deepseek-ai/dsh-host-apiproxy` 中添加 `IpcPort`、消息联合、`IpcApiClient` 与 `HostIpcGateway`。从现有 `./client` 子路径导出客户端。把协议不变量留在 `AbstractApiClient`。
4. 用 `MessageChannel` 或 EventEmitter、`toFetchHandler` 打在假的 `ApiProxy` 上、且不监听套接字的聚焦测试覆盖 Acceptance criteria。
5. 在同一次变更中更新该包 README 与 JSDoc。当行为与提案一致时，把本 Agent Note 移到 `implemented/architecture/`，把 Proposal 改写成 Decision、Acceptance criteria 改写成 Consequences，保留 Alternatives considered，并更新中文配对。
6. 不要开始 P1–P5。
7. 为该 diff 运行最窄检查（apiproxy 测试、覆盖 Agent Note 的 `doc-sync`（文档同步门禁）片段、`git diff --check`）。遵循 `.agents/skills/dsh-pre-push-checks/SKILL.md`。
