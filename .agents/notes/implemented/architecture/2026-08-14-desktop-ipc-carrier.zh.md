# Agent Note: P0 — 不含 Electron 的 IPC fetch 载体

Status: implemented

[English](2026-08-14-desktop-ipc-carrier.md) | 中文

## Problem

每个 GUI 客户端都必须说同一套四象限 RPC。`AbstractApiClient` 持有协议不变量；子类提供传输。[分层说明](./2026-07-19-gui-layering-and-rpc-protocol.md) 把 IPC 子类命名为 Electron 载体，并写明换载体不应改动基类。

`WebApiClient` 已经覆盖 `openMux` / `openHost`，而不是走进程内 SSE（Server-Sent Events）路径，因此只实现 `doFetch` 不足以支撑产品下行。若 IPC 载体依赖 Electron，协议就无法在 vitest 里测试。

## Decision

`@deepseek-ai/dsh-host-apiproxy` 在现有 fetch 家族旁持有一套 **JSON IPC 载体**，不引入 `electron` 依赖。类型与两端与 `AbstractApiClient` / `toFetchHandler` / `InProcessApiClient` 为邻。客户端从现有的浏览器安全 `./client` 子路径导出；`HostIpcGateway` 是仅宿主侧的根导出。

### Port

```text
interface IpcPort {
  post(message: IpcMessage): void
  subscribe(handler: (message: IpcMessage) => void): () => void
}
```

测试用 `MessageChannel` 或一对 `EventEmitter` 实现 `IpcPort`。[Electron 壳](./2026-08-14-desktop-electron-shell.md) 把 `ipcMain` / `ipcRenderer`（以及 Node 子进程的 `process` IPC）适配到该接口，不改消息类型。

### Messages

带判别标签的 JSON 文档，每次 `post` 一个对象：

```text
unary-request  { type, id, url, method, headers, body? }
unary-response { type, id, status, headers, body }
unary-failure  { type, id, message }
unary-abort    { type, id }
stream-open    { type, id, path }           // path is /api/events.mux or /api/events.host
stream-frame   { type, id, envelope }       // envelope is a ServerRequest
stream-end     { type, id, error? }
stream-abort   { type, id }
```

`id` 是客户端为每次一元调用和每条下行流签发的 `IpcId`，与 `RpcId` 不同。一元 `url` 相对 `http://dsh.internal` 解析，与 `InProcessApiClient` 相同。正文是 UTF-8 字符串（JSON RPC）。每个一元 POST 的头都带 `content-type: application/json`，以便宿主网关喂给 `toFetchHandler` 时 [媒体类型栅栏](./2026-07-28-api-browser-trust-boundary.md) 仍然成立。

载体保持**两条下行流**且无跨流顺序保证，与 `WebApiClient` 一致。mux 与 host 不复用到同一个通道标签上。

### Client: `IpcApiClient`

`AbstractApiClient` 的子类：

- `doFetch` 发送 `unary-request`，在 `unary-response` / `unary-failure` 上结算。`AbortSignal` 会发送 `unary-abort`，让 `host.pickDirectory` 这类用户节奏的一元调用能在宿主侧取消。
- `openMux` / `openHost` 发送 `stream-open`，从 `stream-frame` 产出已解析的 `RpcRequest<Frame>`，并在 `stream-end` 或中止时结束。

畸形帧丢弃并记日志，与 `WebApiClient` 一致。带 `error` 的 `stream-end` 按 WebSocket 关闭一样使该连接世代失败。`dispose()` 退订并对进行中的工作拒绝。

### Host: `HostIpcGateway`

用 Fetch handler 加上 `api.events` 构造。apiproxy 测试传入 `toFetchHandler(api)`；[Electron 壳](./2026-08-14-desktop-electron-shell.md) 在该回退之前组合 Connection interceptor 分发。对每个对端：

- `unary-request` → `handler.fetch` → `unary-response`；抛出的 fetch 错误 → `unary-failure`。
- 针对 mux/host 的 `stream-open` → 迭代 `api.events.mux` / `api.events.host` 并 post `stream-frame`；完成或抛出时 post `stream-end`。
- `unary-abort` / `stream-abort` 中止对应工作。先于对应登记到达的中止会被记住，使该工作不会开始。

网关把 IPC 对端视为**回环、同源、且已认证的产品壳**。它不监听 TCP 端口，也不施加浏览器 Host/Origin 栅栏。该对端允许调用特权方法（`host.pickDirectory`、settings、credentials，以及 `dsh-client-connection` 中仅限回环的集合）。网页到达不了该网关。`dispose()` 等待进行中的工作结束。

### Connection plugin

`dsh-client-connection` 的 HTTP 路由未改。非 HTTP 载体调用 `connection.createSharedFetchHandler('/api', toFetchHandler(api))`。[Electron 壳](./2026-08-14-desktop-electron-shell.md) 识别 `window.__DSH_IPC_PORT__` 并构造已导出的客户端；测试也直接构造 `IpcApiClient`。

### Out of scope

安装包属于 [P4](../process/2026-08-14-desktop-installer-packaging.md)。[Electron 壳](./2026-08-14-desktop-electron-shell.md) 适配本载体；apiproxy 没有 `electron` 依赖。

## Alternatives considered

**只把 `IpcApiClient` 放在 `apps/desktop`。** 将没有可测试的包，Electron 应用会拥有所有载体测试都需要的协议类型。

**新建 `dsh-client-ipc` 包。** 只有一个消费者，是无主的混合物。分层说明把装配放在 `apps/`，把共享传输放在 `AbstractApiClient` 旁边。

**渲染进程继续对 localhost 使用 HTTP，IPC 只做窗口铬。** 交付的桌面仍停在 webserver 上，而本产品禁止这一点。

**全双工单通道 RPC（一元调用与帧走同一套接字）。** 会重写 HTTP 上行加两条下行已经解决的超时、中止与关联。IPC 没有浏览器六连接上限，但与 `IApiClient` 同构才是本载体的目的。

**在 apiproxy 里依赖 Electron `ipcMain`。** 单元测试会拖进 Electron，并把宿主库耦合到壳上。

## Testing

`packages/host/apiproxy/tests/ipc-carrier.spec.ts` 把 `IpcApiClient` 与 `HostIpcGateway` 配在进程内 `IpcPort` 上（`MessageChannel` 外加同步 mock 端口，不监听套接字）。它钉住：一元成功与 `rpcId` 回显；对挂起 `host.pickDirectory` 的一元中止；mux 与 host 帧在独立流中；中止一条活着的流且不杀死兄弟流；畸形 `stream-frame` 被丢弃且不杀死兄弟流；网关的 `unary-failure` 变成传输抛错；特权一元调用无需来自浏览器的 HTTP `Host`/`Origin` 头；包清单中没有 `electron` 依赖。

## Consequences

四象限 RPC 可以在不含 Electron 的情况下经 IPC 测试，因此 [Electron 壳](./2026-08-14-desktop-electron-shell.md) 把 `ipcMain` / `ipcRenderer`（以及 Node 子进程的 `process` IPC）适配到 `IpcPort` 时不必改消息类型。`dsh-client-connection` 仍持有浏览器 HTTP/WebSocket 载体；本包没有 `electron` 依赖。[desktop profile](./2026-08-14-desktop-profile-host.md) 组合 Host；壳在子进程中实例化网关。

JSON 序列化无法承载二进制正文。当前 RPC 仅有 JSON；若后续 RPC 方法需要字节，本载体必须增加显式二进制帧，而不是悄悄做 base64。桌面壳上的 Session 日志 ZIP 字节作为 Host 写入的临时路径走 [control 通道](./2026-08-14-desktop-electron-shell.md)，不走 `unary-response` 正文。

把每个 IPC 对端都当作回环，只有在 Node 子进程只接受孵化它的 Electron main 连接时才正确。壳不得打开 TCP 回退。
