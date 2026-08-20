# Agent Note: P5 — macOS 公证、Windows 明确不签、GitHub Releases

Status: implemented

[English](2026-08-14-desktop-installer-release-ci.md) | 中文

## Problem

[P4](./2026-08-14-desktop-installer-packaging.md) 发出 ad-hoc 签名的 macOS arm64 `.dmg` 和未签名的 Windows x64 NSIS `.exe`。Gatekeeper 会拦住 Mac 包直到用户右键打开；SmartScreen 会在 Windows 上警告。没有 GitHub Release，没有自动更新，也没有把嵌套 Host 的 `node` 与 `node-pty` 的 `spawn-helper` 连同 Electron 应用一起公证的路径。

Windows Authenticode 不可用。Intel Mac 与商店上架不在本轮交付。开发者机器根目录 `.env` 里可能有 `DEEPSEEK_API_KEY` 和 `APPLE_*`；这些值绝不能进入 extraResources。模型密钥在首次启动后由用户在 GUI 里配置。

## Decision

P5 是 **macOS Developer ID + 公证 + staple**、**Windows 明确不签名**、产物放到 **GitHub Releases**，以及对着该 Release 的**自动更新**。本地签名路径对齐 wandox-work（`notarize: true`、hardened runtime、JIT / unsigned executable memory / dyld env entitlements、从环境读取 `APPLE_*` / `CSC_*`），并签署本仓库 extraResources 里的 Host 二进制。

### Local macOS signed build

`pnpm run dist:mac:signed` 即 `scripts/build-desktop-installer.ts --signed`。在登录钥匙串已有 Developer ID Application 身份的 Mac 上：

1. 脚本从 gitignore 的根目录 `.env` / `.env.signing` 加载 `APPLE_ID`、`APPLE_TEAM_ID` 与 `APPLE_APP_SPECIFIC_PASSWORD`（以及任何 `CSC_*`），不加载 `DEEPSEEK_API_KEY`。
2. 保持 CSC 自动发现，把 electron-builder 的 `mac.identity` 设为证书主体、去掉 `Developer ID Application:` 前缀（electron-builder 会拒绝该前缀；不是 `'-'`），`hardenedRuntime: true`，`notarize: true`，以及 `apps/desktop/resources/entitlements.mac.plist`。
3. 产出并 staple 一份 **arm64** `.dmg`（外加供 electron-updater 使用的 `.zip`）。没有证书的机器继续用未签名/ad-hoc 的 `pnpm run dist:desktop`；该路径仍传入 `identity: '-'` 并设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`。

### Nested Host binaries

`apps/desktop/after-pack.cjs` 仅在 `DSH_MAC_SIGNED=1` 时运行，并以 hardened runtime 和上述 entitlements 签署：

- `extraResources/host/node`
- `extraResources/host/node-spawn-helper`

干净机器上的验收是 Host 子进程真正启动，而不仅是 notary 的 `Accepted`。本变更不记录 notary 日志。

### Secrets and what must not ship

若暂存或未打包 extraResources 含有 `.env` 文件名、凭证赋值行（`DEEPSEEK_API_KEY=…`、`APPLE_APP_SPECIFIC_PASSWORD=…` 以及其他构建机密钥键），或构建进程自身的密钥值，打包失败。正文里提到变量名是允许的。首次启动后用户在 Settings 里填写模型密钥；安装包不预置该密钥。

### GitHub Actions and Releases

[`.github/workflows/desktop-release.yml`](../../../../.github/workflows/desktop-release.yml) 在 `workflow_dispatch` 与 `desktop-v*` 标签上运行。从 `origin` 跟踪的仓库发布（当推送远程是操作者的 fork 时即该 fork）。环境 `desktop-release` 持有密钥。

`macos-14` job 导入 Developer ID p12（base64 的 `CSC_LINK` 外加 `CSC_KEY_PASSWORD`），读取 `APPLE_ID`、`APPLE_TEAM_ID` 与 `APPLE_APP_SPECIFIC_PASSWORD`，运行 `dist:mac:signed`，并把 `.dmg`、`.zip` 与 `latest-mac.yml` 上传到名为 `desktop-v<apps/desktop 版本>` 的 GitHub Release。

`windows-2025` job（pwsh）运行未签名的 `dist:desktop`（`signAndEditExecutable: false`），并把 `.exe` 与 `latest.yml` 上传到同一 Release。没有 Authenticode 步骤。拉取请求 CI 不打包安装包。

### Auto-update

打包后的 `apps/desktop` main 用 `electron-updater` 对着该 GitHub Release（`publish.provider: github`，在已设置时用 `GITHUB_REPOSITORY` 的 owner/repo）。缺少 feed 只记日志，不退出应用。更新整应用替换，以免 extraResources 写到一半。没有私有更新服务器，也没有 OSS 镜像。

### Windows

`electron-builder.yml` 保持 `signAndEditExecutable: false`。README 写明 Windows 包未签名、SmartScreen 会警告，以及已安装构建启用自动更新。

### Out of scope

Intel Mac、Windows arm64、Linux 包、MAS App Store、Microsoft Store、Windows Authenticode。

## Alternatives considered

**跳过公证，告诉用户关闭 Gatekeeper。** 这会使 Mac 无法满足干净机器标准。

**同一阶段做 Windows Authenticode。** 没有证书；伪造签名被禁止。未签名 exe 外加 README 警告就是明确的 Windows 姿态。

**只把 `APPLE_*` 放在 gitignore 的 `.env` 里，永不进 Actions。** 本地 `dist:mac:signed` 能工作，但 GitHub Releases 仍要手传。本阶段把 `APPLE_*`（以及 CI 需要的 p12 密钥）放进 Actions，以便在 runner 上产出 Release。

**把开发者 `.env` 里的 `DEEPSEEK_API_KEY` 打进 extraResources。** 该密钥是首次启动后的每用户 Settings 值。打进去会把打包者的凭证泄漏到每一份安装里。

**用 Sparkle 代替 electron-updater。** 多出一套仅限 macOS 的栈，而 Windows 仍需要 feed。electron-updater 对着 GitHub Releases 覆盖两端。

**商店分发。** 审核滞后与沙箱规则，与在用户磁盘上跑 coding agent（编程智能体）的 Node 子进程冲突。

## Consequences

GitHub Actions secrets（`APPLE_*`、`CSC_LINK`、`CSC_KEY_PASSWORD`）是泄漏面。工作流使用环境 `desktop-release`，永不把它们 echo 出来。在导入 p12 之前，GitHub 托管的 `macos-14` runner 没有本地钥匙串身份。

嵌套 Node 上的 Hardened Runtime 可能在 entitlements 于干净 Mac 上得到验证之前拒绝 pty/spawn。Notary 的 `Accepted` 不是该证明。

Gatekeeper 会显示 Developer ID 的组织名（证书主体），它可能与应用里的 DeepSeek copyright 字符串不同。

自动更新只作为整应用更新的一部分替换 extraResources，以免 `host/node_modules` 写到一半。

## Testing

`scripts/desktop-installer-secrets.spec.ts` 钉住 dotenv 解析（不加载 `DEEPSEEK_API_KEY`）、拒绝 `.env` 文件名、拒绝赋值行，以及允许正文提到密钥变量名。`scripts/desktop-mac-signing.spec.ts` 钉住去掉 `Developer ID Application:` 前缀的 Developer ID 解析、notary 环境缺失失败、签名构建参数（没有 `identity: '-'`），以及未签名 Windows argv。`apps/desktop/tests/auto-update.spec.ts` 钉住未打包时不操作，以及缺少 feed 时检查不抛错。`scripts/ci-workflow.spec.ts` 钉住 `macos-14`、`windows-2025`、Apple / `CSC_*` 密钥名、`dist:mac:signed`、未签名 `dist:desktop`，以及不存在 Authenticode。

Notary 的 `Accepted` 加上干净 Mac 上 Host 子进程启动，仍是存在 `desktop-release` 密钥时的操作者证据；本变更不记录该日志。
