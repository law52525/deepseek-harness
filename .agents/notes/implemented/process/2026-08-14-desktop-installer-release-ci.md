# Agent Note: P5 — macOS notarization, unsigned Windows, GitHub Releases

Status: implemented

English | [中文](2026-08-14-desktop-installer-release-ci.zh.md)

## Problem

[P4](./2026-08-14-desktop-installer-packaging.md) emits an ad-hoc macOS arm64 `.dmg` and an unsigned Windows x64 NSIS `.exe`. Gatekeeper blocks the Mac package until the user right-clicks Open; SmartScreen warns on Windows. There is no GitHub Release, no auto-update, and no path that notarizes the nested Host `node` and `node-pty` `spawn-helper` beside the Electron app.

Windows Authenticode is unavailable. Intel Mac and store listings are out of this ship. A developer-machine root `.env` may contain `DEEPSEEK_API_KEY` and `APPLE_*`; those values must never enter extraResources. The model key is configured in the GUI after first launch.

## Decision

P5 is **macOS Developer ID + notarization + staple**, **Windows explicitly unsigned**, artifacts on **GitHub Releases**, and **auto-update** against that Release. The local signed path follows wandox-work (`notarize: true`, hardened runtime, JIT / unsigned-executable-memory / dyld-env entitlements, `APPLE_*` / `CSC_*` from env) and signs this repo's extraResources Host binaries.

### Local macOS signed build

`pnpm run dist:mac:signed` is `scripts/build-desktop-installer.ts --signed`. On a Mac with a Developer ID Application identity in the login keychain:

1. The script loads `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD` (and any `CSC_*`) from the gitignored root `.env` / `.env.signing`, and does not load `DEEPSEEK_API_KEY`.
2. It leaves CSC auto-discovery on, sets electron-builder `mac.identity` to the certificate subject without the `Developer ID Application:` prefix (electron-builder rejects that prefix; not `'-'`), `hardenedRuntime: true`, `notarize: true`, and `apps/desktop/resources/entitlements.mac.plist`.
3. It produces and staples an **arm64** `.dmg` (and a `.zip` for electron-updater). Unsigned/ad-hoc `pnpm run dist:desktop` remains for machines without the certificate; that path still passes `identity: '-'` and `CSC_IDENTITY_AUTO_DISCOVERY=false`.

### Nested Host binaries

`apps/desktop/after-pack.cjs` runs only when `DSH_MAC_SIGNED=1` and codesigns, with hardened runtime and those entitlements:

- `extraResources/host/node`
- `extraResources/host/node-spawn-helper`

A clean-machine check is the Host child actually starting, not only notary `Accepted`. This change does not record a notary log.

### Secrets and what must not ship

Staging and unpacked extraResources fail the pack when they contain a `.env` basename, a credential assignment line (`DEEPSEEK_API_KEY=…`, `APPLE_APP_SPECIFIC_PASSWORD=…`, and the other builder secret keys), or the builder process's own secret values. Documenting the variable name in prose is allowed. After first launch the user enters the model key in Settings; the installer does not pre-seed it.

### GitHub Actions and Releases

[`.github/workflows/desktop-release.yml`](../../../../.github/workflows/desktop-release.yml) runs on `workflow_dispatch` and `desktop-v*` tags. Publish from the repository that `origin` tracks (the operator's fork when that is the push remote). Environment `desktop-release` holds the secrets.

The `macos-14` job imports the Developer ID p12 (`CSC_LINK` as base64 plus `CSC_KEY_PASSWORD`), reads `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD`, runs `dist:mac:signed`, and uploads the `.dmg`, `.zip`, and `latest-mac.yml` to a GitHub Release named `desktop-v<apps/desktop version>`.

The `windows-2025` job (pwsh) runs unsigned `dist:desktop` (`signAndEditExecutable: false`) and uploads the `.exe` and `latest.yml` to the same Release. There is no Authenticode step. Pull-request CI does not pack installers.

### Auto-update

Packaged `apps/desktop` main calls `electron-updater` against that GitHub Release (`publish.provider: github`, owner/repo from `GITHUB_REPOSITORY` when set). A missing feed is logged and does not quit the app. Updates replace the whole app so extraResources is never half-written. There is no private update server and no OSS mirror.

### Windows

`signAndEditExecutable: false` stays in `electron-builder.yml`. README states that the Windows package is unsigned and SmartScreen will warn, and that auto-update applies to installed builds.

### Out of scope

Intel Mac, Windows arm64, Linux packages, MAS App Store, Microsoft Store, Windows Authenticode.

## Alternatives considered

**Skip notarization and tell users to disable Gatekeeper.** That fails the clean-machine Mac criterion.

**Windows Authenticode in the same phase.** No certificate exists; faking a signature is forbidden. Unsigned exe plus a README warning is the explicit Windows posture.

**APPLE_* in the gitignored `.env` only, never in Actions.** Local `dist:mac:signed` would work, but GitHub Releases would still be hand-uploaded. This phase puts `APPLE_*` (and the p12 secrets CI needs) in Actions so the Release is produced on the runner.

**Bake `DEEPSEEK_API_KEY` from the developer's `.env` into extraResources.** The key is a per-user Settings value after first launch. Shipping it would leak the packager's credential into every install.

**Sparkle instead of electron-updater.** Extra macOS-only stack while Windows still needs a feed. electron-updater covers both against GitHub Releases.

**Store distribution.** Review lag and sandbox rules conflict with a Node child that runs a coding agent over the user's disk.

## Consequences

GitHub Actions secrets (`APPLE_*`, `CSC_LINK`, `CSC_KEY_PASSWORD`) are a leak surface. The workflow uses environment `desktop-release` and never echoes them. A GitHub-hosted `macos-14` runner has no local keychain identity until the p12 is imported.

Hardened Runtime on the nested Node may deny pty/spawn until entitlements are proven on a clean Mac. Notary `Accepted` is not that proof.

Gatekeeper will show the Developer ID organization name (the certificate subject), which may differ from the DeepSeek copyright string in the app.

Auto-update replaces extraResources only as part of a full-app update, so `host/node_modules` is never half-written.

## Testing

`scripts/desktop-installer-secrets.spec.ts` pins dotenv parse (no `DEEPSEEK_API_KEY` load), `.env` filename rejection, assignment-line rejection, and allowing the key name in prose. `scripts/desktop-mac-signing.spec.ts` pins Developer ID parse without the `Developer ID Application:` prefix, notary-env failure, signed builder args (no `identity: '-'`), and unsigned Windows argv. `apps/desktop/tests/auto-update.spec.ts` pins unpackaged no-op and a missing-feed check that does not throw. `scripts/ci-workflow.spec.ts` pins `macos-14`, `windows-2025`, the Apple / `CSC_*` secret names, `dist:mac:signed`, unsigned `dist:desktop`, and the absence of Authenticode.

Notary `Accepted` plus Host-child start on a clean Mac remain operator evidence when `desktop-release` secrets exist; this change does not record that log.
