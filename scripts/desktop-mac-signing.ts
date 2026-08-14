/**
 * Developer ID identity and nested Host codesign argv for signed macOS builds.
 */

const LOG = 'build-desktop-installer'
const REQUIRED_APPLE_KEYS = ['APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_SPECIFIC_PASSWORD'] as const
/** electron-builder rejects this prefix on `mac.identity`; codesign accepts the remainder. */
const DEVELOPER_ID_PREFIX = 'Developer ID Application:'

/**
 * Strip `Developer ID Application:` so electron-builder can select the cert.
 * @param name - `security find-identity` quoted name or `CSC_NAME`.
 * @returns the certificate subject without the prefix.
 */
export function normalizeMacSigningIdentity(name: string): string {
  const trimmed = name.trim()
  if (trimmed.startsWith(DEVELOPER_ID_PREFIX)) {
    return trimmed.slice(DEVELOPER_ID_PREFIX.length).trim()
  }
  return trimmed
}

/**
 * Take the first Developer ID Application identity from `security find-identity`.
 * @param output - stdout of `security find-identity -v -p codesigning`.
 * @returns the certificate subject without the `Developer ID Application:` prefix, or undefined.
 */
export function parseDeveloperIdIdentity(output: string): string | undefined {
  for (const line of output.split('\n')) {
    const quoted = /"(Developer ID Application: [^"]+)"/.exec(line)?.[1]
    if (quoted !== undefined) return normalizeMacSigningIdentity(quoted)
  }
  return undefined
}

/**
 * Identity used for `mac.identity` and nested Host `codesign`.
 * `CSC_NAME` wins; otherwise the first Developer ID Application in `findIdentityOutput`.
 * @param env - builder environment.
 * @param findIdentityOutput - `security find-identity` stdout; ignored when `CSC_NAME` is set.
 * @returns the certificate subject without the `Developer ID Application:` prefix.
 */
export function resolveMacSigningIdentity(
  env: NodeJS.ProcessEnv,
  findIdentityOutput: string,
): string {
  const named = env.CSC_NAME?.trim()
  if (named !== undefined && named !== '' && named !== '-') {
    return normalizeMacSigningIdentity(named)
  }
  const parsed = parseDeveloperIdIdentity(findIdentityOutput)
  if (parsed !== undefined) return parsed
  throw new Error(
    `${LOG}: signed macOS builds need a Developer ID Application identity in the `
    + 'keychain, or CSC_NAME / CSC_LINK. Use unsigned `pnpm run dist:desktop` without a certificate.',
  )
}

/**
 * Fail when Apple notary credentials are missing.
 * @param env - builder environment after dotenv load.
 */
export function assertAppleNotaryEnv(env: NodeJS.ProcessEnv): void {
  const missing = REQUIRED_APPLE_KEYS.filter((key) => {
    const value = env[key]
    return value === undefined || value === ''
  })
  if (missing.length > 0) {
    throw new Error(
      `${LOG}: signed macOS builds require ${missing.join(', ')} `
      + '(gitignored root `.env` locally, or GitHub Actions secrets in CI).',
    )
  }
}

/**
 * electron-builder argv extras for a signed arm64 Mac pack.
 * Does not pass `identity: '-'` and does not disable CSC auto-discovery.
 * @param identity - Developer ID Application name.
 * @returns flags merged over `electron-builder.yml`.
 */
export function macSignedBuilderArgs(identity: string): string[] {
  return [
    `--config.mac.identity=${normalizeMacSigningIdentity(identity)}`,
    '--config.mac.hardenedRuntime=true',
    '--config.mac.notarize=true',
    '--config.mac.entitlements=resources/entitlements.mac.plist',
    '--config.mac.entitlementsInherit=resources/entitlements.mac.inherit.plist',
  ]
}

/**
 * `codesign` argv for one nested Host Mach-O binary.
 * @param identity - Developer ID Application name.
 * @param entitlements - path to `entitlements.mac.plist`.
 * @param binary - absolute path of `host/node` or `host/node-spawn-helper`.
 * @returns argv after `codesign`.
 */
export function hostBinaryCodesignArgs(
  identity: string,
  entitlements: string,
  binary: string,
): string[] {
  return [
    '--sign',
    normalizeMacSigningIdentity(identity),
    '--force',
    '--options',
    'runtime',
    '--timestamp',
    '--entitlements',
    entitlements,
    binary,
  ]
}

/** Nested Host binaries that must be in the notarized ticket. */
export const MAC_HOST_BINARIES = ['host/node', 'host/node-spawn-helper'] as const
