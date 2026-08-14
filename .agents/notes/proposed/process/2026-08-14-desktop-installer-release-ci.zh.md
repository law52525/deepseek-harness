# Agent Note: P5 — 桌面安装包的更新、公证与 CI

Status: proposed

[English](2026-08-14-desktop-installer-release-ci.md) | 中文

## Problem

P4 在开发者机器上产出未签名或 ad-hoc 签名的安装包。这并不能满足「在干净的 Mac/Windows 盒子上下载并打开」，因为操作者未必能覆盖 Gatekeeper 或 SmartScreen。也没有在 pull request 或标签上重建这些产物的 CI 矩阵，用户装上预览构建之后也没有更新路径。

macOS 需要 Developer ID 签名外加公证，Gatekeeper 才会允许下载的 `.dmg` 无需右键打开。Windows 需要 Authenticode 来降低 SmartScreen 摩擦（它并不能消除声誉等待）。自动更新需要已发布的 feed，以及签名的增量或整包方案。

## Proposal

在 P4 产物存在之后，为桌面应用补上**发布工程**。三条轨道；它们可以在本说明下作为独立 PR（Pull Request）落地。

### Track 1 — CI matrix

GitHub Actions（以及 `.github/AGENTS.md` 中现有的 Windows 原生 job 模式）：

- `macos-14`（arm64）：`pnpm run dist:desktop`，上传 `.dmg`。
- `windows-2025`（x64）：`pnpm run dist:desktop`，上传 NSIS `.exe`。
- 可选的 PR 标签（类似 `build-exe`），避免每个 GUI 错字都付完整矩阵的成本。

一旦比完整 GUI e2e 更便宜，这里就应有一次打包冒烟（安装或 `--app` 启动、经 IPC 的 `host.describe`、退出）。

### Track 2 — Signing and notarization

- macOS：Developer ID Application、`notarytool`、钉住 `.dmg`。密钥放在 release 环境里，不放进 PR fork 矩阵。
- Windows：用组织证书做 Authenticode。若证书不可用，继续发未签名包并保留 README 警告；不要伪造签名。

PR 构建未签名产物。标签 / 在 `master` 上的 `workflow_dispatch`（或发布工作流）负责签名。

### Track 3 — Auto-update

用 `electron-updater`（或 electron-builder 已支持的等价物）对着开发者预览的 GitHub Releases。若设置 UI 存在，则更新通道在 Settings 里选择加入；否则写明预览构建会检查 GitHub。失败时关闭：缺少 feed 不得让应用崩溃。

v1 不要实现私有更新服务器。

### Publication

GitHub Releases 附上两份首发产物。根目录 README 链到最新预览 release。`npx @deepseek-ai/dsh web` 仍被文档记录。

当本项目实际启用的 P5 轨道已经交付后，把本说明和[产品说明](../architecture/2026-08-14-desktop-installer-product.md)移到 `implemented/`。

### Out of scope

Linux 包、Mac Intel、Windows arm64、同进程 Electron Host、MAS App Store、Microsoft Store。

## Alternatives considered

**跳过公证，告诉用户关闭 Gatekeeper。** 这会使 macOS 无法满足干净机器上的 Done 标准。

**用 Sparkle 代替 electron-updater。** 多出一套仅限 macOS 的栈，而 Windows 仍需要另一种更新器。electron-updater 覆盖两端。

**每个 PR 都无标签地作为必需 CI。** 桌面 dist 又慢又大；Python exe 已经使用标签外加必需的 linux-x64 子集。桌面应沿用该模式：更便宜的 Host 闭包冒烟可以是必需的；在完整 dmg/exe 变便宜之前，用标签或 tag 门控。

**v1 走商店分发。** 审核滞后与沙箱规则，与在用户磁盘上跑 coding agent（编程智能体）的 Node 子进程冲突。

## Acceptance criteria

- 已文档化的命令能产出经公证的 macOS arm64 `.dmg`（当密钥存在时）和已签名的 Windows x64 `.exe`（当证书存在时）。
- CI 能为两个平台构建未签名产物。
- GitHub Release（或草稿）能附上这些产物。
- 自动更新要么对着该 Release 交付，要么在 Consequences 中明确后置，并由 README 写明预览用户需重新下载。
- 从已签名产物在干净机器上安装，能在没有系统 Node、且没有 Gatekeeper 拦截（macOS）的情况下打开 GUI，或带有已文档化的 SmartScreen 状态（Windows）。

## Risks

GitHub Environments 里的 notary 与 Authenticode 密钥是新的泄漏面。使用环境保护规则；永远不要把 `codesign` 密码打进日志。

替换捆入 Node 闭包的自动更新不得留下写到一半的 `node_modules` 树。v1 使用 electron-builder 的整应用更新，而不是部分 extraResource 补丁。

每个 PR 都作为必需的 Windows 打包 job 会打乱「Wine 下的 Windows」job 的目的；把 desktop-windows dist 放在原生 `windows-2025` 上，而不是 Wine。

## Cursor prompt

粘贴到新的 Cursor agent：

1. 实施 `.agents/notes/proposed/process/2026-08-14-desktop-installer-release-ci.md` 中的 P5。P4 必须已经能在本地产出产物。阅读该说明、[产品说明](../architecture/2026-08-14-desktop-installer-product.md)、[P4](./2026-08-14-desktop-installer-packaging.md)、`.github/AGENTS.md`、若会碰到 Windows runner 则阅读 `.agents/notes/implemented/process/2026-07-26-ci-failover-runbook.md`，以及 `.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md`（CI 模式）。
2. 不要改变双进程模型。不要增加 Linux/商店目标。不要把签名密钥放进仓库。
3. 为未签名的 macOS arm64 与 Windows x64 desktop dist 增加 CI job（用标签或 workflow_dispatch 门控，除非有便宜的必需冒烟）。**仅当**用户确认密钥可用时才加入发布工作流的签名/公证；否则实施未签名 CI 路径，并文档化由密钥门控的轨道。
4. 仅当用户在同一会话中要求时才实现自动更新；否则在 implemented 说明里把 Track 3 留为后置。
5. 更新 README 安装链接。在已启用的轨道交付后，把本说明和产品说明移到 `implemented/`；保持中文配对同步。
6. 遵循 `.agents/skills/dsh-pre-push-checks/SKILL.md`。没有成功的 notary 日志就不要声称公证可用。
