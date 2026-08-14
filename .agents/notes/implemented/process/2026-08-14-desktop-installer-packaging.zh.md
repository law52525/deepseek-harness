# Agent Note: P4 — Windows 与 macOS 的桌面安装包打包

Status: implemented

[English](2026-08-14-desktop-installer-packaging.md) | 中文

## Problem

P2 在已经装有 Node、pnpm 且工作区已构建的开发者机器上给出 `electron .`。那不是安装包。Windows 与 macOS 上的操作者需要一份可下载的包，内含 Electron 壳、Node 运行时、desktop-profile 插件闭包、原生 addon 与前端 dist，并且能在没有系统 Node 的情况下启动 GUI。

Python SDK 的 [single-exe 流水线](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) 已经能物化无符号链接的 Node 闭包并暂存 `node-pty`，但其部署根目录是 JSON-RPC agent，目标里没有 Windows，产物是 stdio exe 而不是 Electron 应用。

## Decision

`pnpm run dist:desktop`（`scripts/build-desktop-installer.ts`）暂存一份 **desktop 部署根目录**，并在当前操作系统上运行 **electron-builder**。

### Contents of one install

| Piece | Source |
|---|---|
| Electron runtime + `apps/desktop` main/preload | electron-builder `app`（`lib/main.js`、`lib/preload.js`） |
| Node runtime for the Host child | 构建机的 Node（`process.execPath`），复制进 extraResources `host/` |
| Plugin closure | 对 [`desktop-runtime/package.json`](../../../../desktop-runtime/package.json)（`dsh-desktop-runtime`）做 pnpm deploy |
| Frontend dist | `@deepseek-ai/dsh-web-frontend` 导出，extraResources `frontend/` |
| Native addons | `node-pty`（以及 Windows 选择器的 `koffi`）按 **Node** ABI 暂存，不是 Electron 的 ABI |

Host 子进程是使用捆入的 Node 运行 `host/node node_modules/@deepseek-ai/dsh/lib/bin.js --profile desktop`。Host 是目录 extraResource，不是 pkg-SEA exe。未打包的 `electron .` 仍使用系统 Node。

### Deploy manifest

`dsh-desktop-runtime` 是零代码工作区 manifest，其依赖为 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-desktop-app` 以及它们拉取的每个工作区包。往安装包加插件就是加一行依赖再重新构建。[`scripts/verify-runtime-closure.ts`](../../../../scripts/verify-runtime-closure.ts) 检查该 manifest 与 `python/sdk-runtime/package.json`；`pnpm run hygiene` 和 desktop 构建会在打包前运行它。

### Staging

[`scripts/stage-runtime-closure.ts`](../../../../scripts/stage-runtime-closure.ts) 持有 Python exe 实测过的 pnpm deploy 标志（`--legacy --prod --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true`），恢复 legacy hoist，把剩余的包链接替换为文件，并在仍有任何符号链接时失败。deploy 之后会写回 `node_modules/.pnpm-workspace-state-v1.json`：这些标志否则会把 `production: true` 和 `nodeLinker: hoisted` 留在工作区里，下一次 `pnpm run dist:desktop` 就会执行 `pnpm install --production` 并删掉 `tsx`。desktop 构建器随后复制 Node，并在 macOS 上把 `node-pty` 的 `spawn-helper` 放到该二进制旁边，名为 `node-spawn-helper`。冒烟用 `--profile desktop --help` 和 `--dump-config` 启动暂存树，并要求没有 webserver 行。

### electron-builder

由 `apps/desktop`（`electron-builder.yml`）持有。`pnpm run dist:desktop` 是受支持的入口（校验、构建、暂存、冒烟、打包）。`pnpm --filter @deepseek-ai/dsh-desktop run dist` 只对已经暂存的树运行 electron-builder。`electron` 是 `apps/desktop` 的 `devDependency`：electron-builder 26 拒绝把它放在 `dependencies` 下；未打包的 `electron .` 仍通过该 devDependency 启动。

extraResources 复制整个 `apps/desktop/stage/`。electron-builder 的 `createFilter` 总会丢掉拷贝根目录下的 `node_modules`，因此 `from: stage/host` 会漏掉 Host 闭包。打包后，安装包脚本要求未打包 extraResources 里存在 `host/node_modules/@deepseek-ai/dsh/lib/bin.js` 与 `frontend/index.html`。脚本从 `node_modules/.bin` 运行 `electron-builder` 和 `tsx`。

| Platform | Artifact | Arch |
|---|---|---|
| macOS | `.dmg` | arm64 |
| Windows | NSIS `.exe` | x64 |

在目标操作系统上构建。Intel Mac、Windows arm64 与 Linux AppImage 不是 v1。产物落在 `apps/desktop/dist/`。

macOS 使用 electron-builder identity `-`（ad-hoc）。Windows 设置 `signAndEditExecutable: false`。[P5](../../proposed/process/2026-08-14-desktop-installer-release-ci.md) 公证 arm64 `.dmg`（Developer ID，外加嵌套 Host 的 `node` 与 `node-spawn-helper`）并发布到 GitHub Releases；Windows 保持未签名（不做 Authenticode）。暂存树是桌面部署根目录加上复制的 Node，不是仓库根目录；被 gitignore 的 `.env` 不是 extraResource。

## Alternatives considered

**electron-packager / Forge，而不写下选定的 builder。** 两种工具都能用；本说明选定 electron-builder，避免实施 PR（Pull Request）里再争论。改选需要编辑本决策。

**用 pkg-SEA 打 Host，只把 exe 放在 Electron 旁边。** 体积上有吸引力，但 pkg VFS 加 Electron extraResources 加 Windows 是三套打包系统。v1 更想要子进程能 `import` 的真实 `node_modules` 树。

**为 Electron 重建原生 addon 并丢掉 Node 子进程。** 那是同进程模型，已被[产品说明](../../proposed/architecture/2026-08-14-desktop-installer-product.md)后置。

**在安装包里塞 npm + `npx`。** 仍需要网络，也不是离线桌面包。

## Consequences

安装包体积会到数百 MB（Electron + Node + 闭包）。v1 接受这一点；裁剪属于后续 simplification 说明。

Windows Defender / SmartScreen 会对未签名 exe 发出警告。Gatekeeper 会拦截 ad-hoc 的 macOS 应用，直到用户从 Finder 打开。P5 公证是 Mac 路径；Windows 保持未签名，并把该警告写进文档。

捆入的 Node 是构建机的 `process.execPath`，与暂存的原生 addon ABI 匹配。可移植的官方二进制属于 P5 的 CI 问题（`actions/setup-node`）。

`dsh web` 仍是根目录 README 里的默认开发者预览入口。

## Testing

`scripts/runtime-closure.spec.ts` 与 `scripts/stage-runtime-closure.spec.ts` 钉住缺失 peer 失败、符号链接物化，以及 deploy 之后还原 pnpm workspace state。`apps/desktop/tests/packaged-paths.spec.ts` 钉住 extraResources 解析。`scripts/build-desktop-installer.spec.ts` 钉住宿主操作系统目标、`pnpm run` 转发 `--`、以及未打包 extraResources 路径。安装包脚本在 electron-builder 之前对暂存树冒烟 `--help` 与 `--dump-config`，随后要求未打包 extraResources 里有 Host bin 与前端 `index.html`。CI 中启动打包后的 Electron 仍属于 [P5](../../proposed/process/2026-08-14-desktop-installer-release-ci.md)。
