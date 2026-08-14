# Agent Note: P5 — Desktop installer updates, notarization, and CI

Status: proposed

English | [中文](2026-08-14-desktop-installer-release-ci.zh.md)

## Problem

P4 produces unsigned or ad-hoc-signed installers on a developer machine. That does not satisfy "download and open on a clean Mac/Windows box" for anyone who cannot override Gatekeeper or SmartScreen. There is also no CI matrix that rebuilds those artifacts on pull requests or tags, and no update path once a user has installed a preview build.

macOS requires Developer ID signing plus notarization for Gatekeeper to allow a downloaded `.dmg` without right-click Open. Windows requires Authenticode to reduce SmartScreen friction (it does not eliminate reputation delay). Auto-update needs a published feed and a signed delta or full-package story.

## Proposal

After P4 artifacts exist, add **release engineering** for the desktop app. Three tracks; they may land as separate PRs under this note.

### Track 1 — CI matrix

GitHub Actions (and the existing Windows native job patterns in `.github/AGENTS.md`):

- `macos-14` (arm64): `pnpm run dist:desktop`, upload `.dmg`.
- `windows-2025` (x64): `pnpm run dist:desktop`, upload NSIS `.exe`.
- Optional PR label (like `build-exe`) to avoid paying the full matrix on every GUI typo.

A packaged smoke (install or `--app` launch, `host.describe` over IPC, quit) belongs here once it is cheaper than a full GUI e2e.

### Track 2 — Signing and notarization

- macOS: Developer ID Application, `notarytool`, staple the `.dmg`. Secrets live in the release environment, not in the PR fork matrix.
- Windows: Authenticode with the org's certificate. If the certificate is not available, keep shipping unsigned and keep the README warning; do not fake a signature.

PRs build unsigned artifacts. Tags / `workflow_dispatch` on `master` (or the release workflow) sign.

### Track 3 — Auto-update

`electron-updater` (or equivalent that electron-builder already supports) against GitHub Releases for developer preview. Update channel is opt-in in Settings if that UI exists; otherwise document that preview builds check GitHub. Fail closed: a missing feed must not crash the app.

Do not implement a private update server in v1.

### Publication

GitHub Releases attach the two first-ship artifacts. Root README links the latest preview release. `npx @deepseek-ai/dsh web` remains documented.

When P5's tracks that the project actually enabled have shipped, move this note and the [product note](../architecture/2026-08-14-desktop-installer-product.md) to `implemented/`.

### Out of scope

Linux packages, Mac Intel, Windows arm64, in-process Electron Host, MAS App Store, Microsoft Store.

## Alternatives considered

**Skip notarization and tell users to disable Gatekeeper.** That fails the clean-machine Done criterion for macOS.

**Sparkle instead of electron-updater.** Extra macOS-only stack while Windows still needs a different updater. electron-updater covers both.

**Required CI on every PR without a label.** Desktop dist is slow and large; the Python exe already uses a label plus a required linux-x64 subset. Desktop should follow that pattern: a cheaper Host-closure smoke may be required; full dmg/exe is label- or tag-gated until it is cheap.

**Store distribution in v1.** Review lag and sandbox rules conflict with a Node child that runs a coding agent over the user's disk.

## Acceptance criteria

- Documented commands produce a notarized macOS arm64 `.dmg` (when secrets exist) and a signed Windows x64 `.exe` (when the certificate exists).
- CI can build unsigned artifacts for both platforms.
- A GitHub Release (or draft) can attach those artifacts.
- Auto-update either ships against that Release or is explicitly deferred in Consequences with the README stating that preview users re-download.
- Clean-machine install from the signed artifacts opens the GUI without a system Node and without a Gatekeeper block (macOS) or with documented SmartScreen status (Windows).

## Risks

Notary and Authenticode secrets in GitHub Environments are a new leak surface. Use environment protection rules; never log `codesign` passwords.

Auto-update that replaces the bundled Node closure must not leave a half-written `node_modules` tree. Use electron-builder's full-app updates in v1, not a partial extraResource patch.

A required Windows packaging job on every PR will fail the "Windows under Wine" job's purpose; keep desktop-windows dist on `windows-2025` native, not Wine.

## Cursor prompt

Paste into a new Cursor agent:

1. Implement P5 from `.agents/notes/proposed/process/2026-08-14-desktop-installer-release-ci.md`. P4 must already produce local artifacts. Read that note, the [product note](../architecture/2026-08-14-desktop-installer-product.md), [P4](./2026-08-14-desktop-installer-packaging.md), `.github/AGENTS.md`, `.agents/notes/implemented/process/2026-07-26-ci-failover-runbook.md` if touching Windows runners, and `.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md` (CI pattern).
2. Do not change the two-process model. Do not add Linux/Store targets. Do not put signing secrets in the repo.
3. Add CI jobs for unsigned macOS arm64 and Windows x64 desktop dist (label- or workflow_dispatch-gated unless a cheap smoke is required). Add release-workflow signing/notarization **only** if the user confirms secrets are available; otherwise implement the unsigned CI path and document the secret-gated track.
4. Implement auto-update only if the user asks in the same session; otherwise leave Track 3 deferred in the implemented note.
5. Update README install links. Move this note and the product note to `implemented/` when the enabled tracks ship; keep Chinese pairs in sync.
6. Follow `.agents/skills/dsh-pre-push-checks/SKILL.md`. Do not claim notarization works without a successful notary log.
