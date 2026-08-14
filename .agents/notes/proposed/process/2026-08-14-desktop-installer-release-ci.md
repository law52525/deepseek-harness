# Agent Note: P5 — macOS notarization, unsigned Windows, GitHub Releases

Status: proposed

English | [中文](2026-08-14-desktop-installer-release-ci.zh.md)

## Problem

[P4](../../implemented/process/2026-08-14-desktop-installer-packaging.md) emits an ad-hoc macOS arm64 `.dmg` and an unsigned Windows x64 NSIS `.exe`. Gatekeeper blocks the Mac package until the user right-clicks Open; SmartScreen warns on Windows. There is no GitHub Release, no auto-update, and no path that notarizes the nested Host `node` and `node-pty` `spawn-helper` beside the Electron app.

Windows Authenticode is unavailable. Intel Mac and store listings are out of this ship. A developer-machine root `.env` may contain `DEEPSEEK_API_KEY` and `APPLE_*`; those values must never enter extraResources. The model key is configured in the GUI after first launch.

## Proposal

P5 is **macOS Developer ID + notarization + staple**, **Windows explicitly unsigned**, artifacts on **GitHub Releases**, and **auto-update** against that Release. Follow the wandox-work `dist:mac:signed` pattern (electron-builder `notarize: true`, hardened runtime, entitlements, `APPLE_*` from env), adapted to this repo's two-process extraResources Host.

### Local macOS signed build

Add `pnpm run dist:mac:signed` (name may wrap `scripts/build-desktop-installer.ts` with a signed flag). On a Mac with the Developer ID Application identity in the login keychain:

1. Load `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD` from the gitignored root `.env` the way wandox-work's `dist-mac-signed.sh` loads `APPLE_*` / `CSC_*` only.
2. Set electron-builder `mac.identity` to that Developer ID (not `'-'`), `hardenedRuntime: true`, `notarize: true`, and the same class of entitlements wandox-work uses (JIT, unsigned executable memory, dyld env). Stop forcing `CSC_IDENTITY_AUTO_DISCOVERY=false` on this path.
3. Produce and staple an **arm64** `.dmg`. Keep unsigned/ad-hoc `pnpm run dist:desktop` for machines without the certificate.

### Nested Host binaries

Notarization is incomplete if only the Electron `.app` is signed. The packager must sign, then include in the notarized ticket:

- `extraResources/host/node`
- `extraResources/host/node-spawn-helper` (`node-pty` spawn-helper copied next to Node in P4)

A clean-machine check is the Host child actually starting, not only notary `Accepted`.

### Secrets and what must not ship

- Never commit `.env`, `APPLE_*`, or `DEEPSEEK_API_KEY`.
- Staging and electron-builder extraResources must not copy the repository root `.env` or any file whose name or contents are credential-shaped developer secrets. A packaging test fails if the staged `host/` tree or the unpacked `.dmg` contains `DEEPSEEK_API_KEY`, `APPLE_APP_SPECIFIC_PASSWORD`, or a root `.env`.
- After first launch the user enters the model key in Settings; the installer does not pre-seed it.

### GitHub Actions and Releases

Publish from the repository that `origin` tracks (the operator's fork when that is the push remote). A release workflow (`workflow_dispatch` and/or version tags) on `macos-14` (arm64):

- Reads GitHub Actions secrets `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`.
- Also needs the Developer ID material on the runner (`CSC_LINK` + `CSC_KEY_PASSWORD`, or an equivalent p12 import). `APPLE_*` alone authenticates `notarytool`; they do not put a signing identity in a GitHub-hosted keychain.
- Builds the signed notarized `.dmg`, then uploads it to a GitHub Release.

A Windows job on `windows-2025` builds the **unsigned** NSIS `.exe` (`signAndEditExecutable: false`) and uploads it to the same Release. Do not add Authenticode. PR CI may stay label-gated and unsigned on both platforms.

### Auto-update

Ship `electron-updater` (or the electron-builder equivalent) against GitHub Releases. Fail closed: a missing feed must not crash the app. Use full-app updates, not a partial extraResource patch, so the Host closure is never half-written. No private update server, no OSS mirror in this phase.

### Windows

Keep `signAndEditExecutable: false`. README states that the Windows package is unsigned and SmartScreen will warn, and that auto-update applies to installed builds.

### Out of scope

Intel Mac, Windows arm64, Linux packages, MAS App Store, Microsoft Store, Windows Authenticode.

When this ships, move this note and the [product note](../architecture/2026-08-14-desktop-installer-product.md) to `implemented/`.

## Alternatives considered

**Skip notarization and tell users to disable Gatekeeper.** That fails the clean-machine Mac criterion.

**Windows Authenticode in the same phase.** No certificate exists; faking a signature is forbidden. Unsigned exe plus a README warning is the explicit Windows posture.

**APPLE_* in the gitignored `.env` only, never in Actions.** Local `dist:mac:signed` would work, but GitHub Releases would still be hand-uploaded. This phase puts `APPLE_*` (and the p12 secrets CI needs) in Actions so the Release is produced on the runner.

**Bake `DEEPSEEK_API_KEY` from the developer's `.env` into extraResources.** The key is a per-user Settings value after first launch. Shipping it would leak the packager's credential into every install.

**Sparkle instead of electron-updater.** Extra macOS-only stack while Windows still needs a feed. electron-updater covers both against GitHub Releases.

**Store distribution.** Review lag and sandbox rules conflict with a Node child that runs a coding agent over the user's disk.

## Acceptance criteria

- `pnpm run dist:mac:signed` on a Mac with Developer ID + `APPLE_*` produces a stapled arm64 `.dmg` whose Electron app, `host/node`, and `host/node-spawn-helper` are signed; a clean macOS arm64 machine opens it without a Gatekeeper block and the Host child starts.
- `pnpm run dist:desktop` on Windows still emits an unsigned NSIS `.exe`; no Authenticode step exists.
- The staged Host tree and the packed artifacts contain neither repository `.env` nor `DEEPSEEK_API_KEY` / `APPLE_*` values; first launch still requires the user to save a model key.
- A GitHub Actions release workflow, using Actions secrets (not files in git), uploads the notarized `.dmg` and the unsigned `.exe` to a GitHub Release.
- Auto-update checks that Release and does not crash when the feed is missing.
- Root README (both languages) says: the Mac notarized package opens directly; the Windows package is unsigned and SmartScreen will warn; auto-update is enabled. `dsh web` remains documented.

## Risks

GitHub Actions secrets (`APPLE_*`, `CSC_LINK`, `CSC_KEY_PASSWORD`) are a leak surface. Use environment protection; never log them. A GitHub-hosted `macos-14` runner has no local keychain identity until the p12 is imported.

Hardened Runtime on the nested Node may deny pty/spawn until entitlements are proven on a clean Mac. Notary `Accepted` is not that proof.

Gatekeeper will show the Developer ID organization name (the certificate subject), which may differ from the DeepSeek copyright string in the app.

Auto-update that replaces extraResources must use a full-app update so `host/node_modules` is never half-written.

## Cursor prompt

Paste into a new Cursor agent:

1. Implement P5 from `.agents/notes/proposed/process/2026-08-14-desktop-installer-release-ci.md`. P4 must already produce local artifacts. Read that note, the [product note](../architecture/2026-08-14-desktop-installer-product.md), [P4](../../implemented/process/2026-08-14-desktop-installer-packaging.md), `scripts/build-desktop-installer.ts`, `apps/desktop/electron-builder.yml`, and `.github/AGENTS.md`.
2. Do not change the two-process model. Do not add Intel Mac, Linux, or store targets. Do not add Windows Authenticode. Do not commit `.env` or any `APPLE_*` / `DEEPSEEK_API_KEY` values.
3. Add `dist:mac:signed`: Developer ID, hardened runtime, notarize, staple arm64 `.dmg`; sign `host/node` and `host/node-spawn-helper`. Keep unsigned `dist:desktop` for machines without a certificate.
4. Fail the pack if staged extraResources contain `.env` or `DEEPSEEK_API_KEY`. The GUI still collects the model key after first launch.
5. Add a release workflow that reads GitHub Actions secrets `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, plus `CSC_LINK` / `CSC_KEY_PASSWORD` (or equivalent) on `macos-14`, and uploads the notarized `.dmg` plus the unsigned Windows `.exe` to a GitHub Release. Implement electron-updater against that Release.
6. Update README as in Acceptance criteria. Move this note and the product note to `implemented/` when shipped; keep Chinese pairs in sync.
7. Follow `.agents/skills/dsh-pre-push-checks/SKILL.md`. Do not claim notarization works without a successful notary log and a Host-child start on a clean Mac.
