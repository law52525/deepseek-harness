# Agent Note: P5 — macOS 公证、Windows 明确不签、GitHub Releases

Status: proposed

[English](2026-08-14-desktop-installer-release-ci.md) | 中文

## Problem

[P4](../../implemented/process/2026-08-14-desktop-installer-packaging.md) 发出 ad-hoc 签名的 macOS arm64 `.dmg` 和未签名的 Windows x64 NSIS `.exe`。Gatekeeper 会拦住 Mac 包直到用户右键打开；SmartScreen 会在 Windows 上警告。没有 GitHub Release，没有自动更新，也没有把嵌套 Host 的 `node` 与 `node-pty` 的 `spawn-helper` 连同 Electron 应用一起公证的路径。

Windows Authenticode 不可用。Intel Mac 与商店上架不在本轮交付。开发者机器根目录 `.env` 里可能有 `DEEPSEEK_API_KEY` 和 `APPLE_*`；这些值绝不能进入 extraResources。模型密钥在首次启动后由用户在 GUI 里配置。

## Proposal

P5 是 **macOS Developer ID + 公证 + staple**、**Windows 明确不签名**、产物放到 **GitHub Releases**，以及对着该 Release 的**自动更新**。对齐 wandox-work 的 `dist:mac:signed`（electron-builder `notarize: true`、hardened runtime、entitlements、从环境读取 `APPLE_*`），并适配本仓库双进程 extraResources Host。

### Local macOS signed build

增加 `pnpm run dist:mac:signed`（名称可以包一层带签名开关的 `scripts/build-desktop-installer.ts`）。在登录钥匙串已有 Developer ID Application 身份的 Mac 上：

1. 按 wandox-work 的 `dist-mac-signed.sh` 只加载 `APPLE_*` / `CSC_*` 的方式，从 gitignore 的根目录 `.env` 读取 `APPLE_ID`、`APPLE_TEAM_ID` 与 `APPLE_APP_SPECIFIC_PASSWORD`。
2. 把 electron-builder 的 `mac.identity` 设为该 Developer ID（不是 `'-'`），`hardenedRuntime: true`，`notarize: true`，以及与 wandox-work 同类的 entitlements（JIT、unsigned executable memory、dyld env）。本路径停止强制 `CSC_IDENTITY_AUTO_DISCOVERY=false`。
3. 产出并 staple 一份 **arm64** `.dmg`。没有证书的机器继续用未签名/ad-hoc 的 `pnpm run dist:desktop`。

### Nested Host binaries

若只签 Electron `.app`，公证就不完整。打包器必须签名并纳入公证票据：

- `extraResources/host/node`
- `extraResources/host/node-spawn-helper`（P4 复制到 Node 旁边的 `node-pty` spawn-helper）

干净机器上的验收是 Host 子进程真正启动，而不仅是 notary 的 `Accepted`。

### Secrets and what must not ship

- 永不提交 `.env`、`APPLE_*` 或 `DEEPSEEK_API_KEY`。
- 暂存与 electron-builder extraResources 不得复制仓库根目录 `.env`，也不得复制文件名或内容呈凭证形态的开发者密钥。若暂存的 `host/` 树或解开的 `.dmg` 含有 `DEEPSEEK_API_KEY`、`APPLE_APP_SPECIFIC_PASSWORD` 或根目录 `.env`，打包测试必须失败。
- 首次启动后用户在 Settings 里填写模型密钥；安装包不预置该密钥。

### GitHub Actions and Releases

从 `origin` 跟踪的仓库发布（当推送远程是操作者的 fork 时即该 fork）。在 `macos-14`（arm64）上的发布工作流（`workflow_dispatch` 和/或版本标签）：

- 读取 GitHub Actions secrets：`APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_APP_SPECIFIC_PASSWORD`。
- runner 上还需要 Developer ID 材料（`CSC_LINK` + `CSC_KEY_PASSWORD`，或等价的 p12 导入）。单有 `APPLE_*` 只能登录 `notarytool`，不会把签名身份放进 GitHub 托管的钥匙串。
- 构建已签名并公证的 `.dmg`，再上传到 GitHub Release。

`windows-2025` 上的 Windows job 构建**未签名** NSIS `.exe`（`signAndEditExecutable: false`），并上传到同一 Release。不要加 Authenticode。PR CI 可以继续用标签门控，两平台都打未签名包。

### Auto-update

对着 GitHub Releases 交付 `electron-updater`（或 electron-builder 的等价物）。失败时关闭：缺少 feed 不得让应用崩溃。使用整应用更新，而不是部分 extraResource 补丁，以免 Host 闭包写到一半。本阶段不要私有更新服务器，也不要 OSS 镜像。

### Windows

保持 `signAndEditExecutable: false`。README 写明 Windows 包未签名、SmartScreen 会警告，以及已安装构建启用自动更新。

### Out of scope

Intel Mac、Windows arm64、Linux 包、MAS App Store、Microsoft Store、Windows Authenticode。

本阶段交付后，把本说明和[产品说明](../architecture/2026-08-14-desktop-installer-product.md)移到 `implemented/`。

## Alternatives considered

**跳过公证，告诉用户关闭 Gatekeeper。** 这会使 Mac 无法满足干净机器标准。

**同一阶段做 Windows Authenticode。** 没有证书；伪造签名被禁止。未签名 exe 外加 README 警告就是明确的 Windows 姿态。

**只把 `APPLE_*` 放在 gitignore 的 `.env` 里，永不进 Actions。** 本地 `dist:mac:signed` 能工作，但 GitHub Releases 仍要手传。本阶段把 `APPLE_*`（以及 CI 需要的 p12 密钥）放进 Actions，以便在 runner 上产出 Release。

**把开发者 `.env` 里的 `DEEPSEEK_API_KEY` 打进 extraResources。** 该密钥是首次启动后的每用户 Settings 值。打进去会把打包者的凭证泄漏到每一份安装里。

**用 Sparkle 代替 electron-updater。** 多出一套仅限 macOS 的栈，而 Windows 仍需要 feed。electron-updater 对着 GitHub Releases 覆盖两端。

**商店分发。** 审核滞后与沙箱规则，与在用户磁盘上跑 coding agent（编程智能体）的 Node 子进程冲突。

## Acceptance criteria

- 在带有 Developer ID 与 `APPLE_*` 的 Mac 上，`pnpm run dist:mac:signed` 产出已 staple 的 arm64 `.dmg`，其中 Electron 应用、`host/node` 与 `host/node-spawn-helper` 均已签名；干净的 macOS arm64 机器能直接打开且 Host 子进程能启动。
- Windows 上的 `pnpm run dist:desktop` 仍发出未签名 NSIS `.exe`；不存在 Authenticode 步骤。
- 暂存的 Host 树与打好的产物既不含仓库 `.env`，也不含 `DEEPSEEK_API_KEY` / `APPLE_*` 的值；首次启动仍要求用户保存模型密钥。
- GitHub Actions 发布工作流使用 Actions secrets（不是 git 里的文件），把已公证 `.dmg` 与未签名 `.exe` 上传到 GitHub Release。
- 自动更新检查该 Release，并在缺少 feed 时不崩溃。
- 根目录 README（两种语言）写明：Mac 公证包可直接打开；Windows 包未签名且 SmartScreen 会警告；已启用自动更新。`dsh web` 仍被文档记录。

## Risks

GitHub Actions secrets（`APPLE_*`、`CSC_LINK`、`CSC_KEY_PASSWORD`）是泄漏面。使用环境保护；永远不要把它们打进日志。在导入 p12 之前，GitHub 托管的 `macos-14` runner 没有本地钥匙串身份。

嵌套 Node 上的 Hardened Runtime 可能在 entitlements 于干净 Mac 上得到验证之前拒绝 pty/spawn。Notary 的 `Accepted` 不是该证明。

Gatekeeper 会显示 Developer ID 的组织名（证书主体），它可能与应用里的 DeepSeek copyright 字符串不同。

替换 extraResources 的自动更新必须用整应用更新，以免 `host/node_modules` 写到一半。

## Cursor prompt

粘贴到新的 Cursor agent：

1. 实施 `.agents/notes/proposed/process/2026-08-14-desktop-installer-release-ci.md` 中的 P5。P4 必须已经能在本地产出产物。阅读该说明、[产品说明](../architecture/2026-08-14-desktop-installer-product.md)、[P4](../../implemented/process/2026-08-14-desktop-installer-packaging.md)、`scripts/build-desktop-installer.ts`、`apps/desktop/electron-builder.yml` 与 `.github/AGENTS.md`。
2. 不要改变双进程模型。不要增加 Intel Mac、Linux 或商店目标。不要加 Windows Authenticode。不要提交 `.env` 或任何 `APPLE_*` / `DEEPSEEK_API_KEY` 值。
3. 增加 `dist:mac:signed`：Developer ID、hardened runtime、公证、staple arm64 `.dmg`；签署 `host/node` 与 `host/node-spawn-helper`。没有证书的机器保留未签名的 `dist:desktop`。
4. 若暂存 extraResources 含 `.env` 或 `DEEPSEEK_API_KEY` 则打包失败。GUI 仍在首次启动后收集模型密钥。
5. 增加发布工作流：在 `macos-14` 上读取 GitHub Actions secrets `APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_APP_SPECIFIC_PASSWORD`，外加 `CSC_LINK` / `CSC_KEY_PASSWORD`（或等价物），并把已公证 `.dmg` 与未签名 Windows `.exe` 上传到 GitHub Release。对着该 Release 实现 electron-updater。
6. 按 Acceptance criteria 更新 README。交付后把本说明和产品说明移到 `implemented/`；保持中文配对同步。
7. 遵循 `.agents/skills/dsh-pre-push-checks/SKILL.md`。没有成功的 notary 日志以及干净 Mac 上 Host 子进程启动，就不要声称公证可用。
