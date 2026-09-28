import { describe, expect, it, vi } from 'vitest'

const { verifyDesktopRuntime } = vi.hoisted(() => ({
  verifyDesktopRuntime: vi.fn<(root: string, expected: string) => Promise<void>>(async () => undefined),
}))
// The hook imports the built tree, which a clean checkout has not produced; this is the path it resolves.
vi.mock('/apps/desktop/lib/types/runtime-tree.js', () => ({ verifyDesktopRuntime }))
vi.mock('../scripts/windows-asar-unpack.mjs', async importOriginal => ({
  ...await importOriginal<typeof import('../scripts/windows-asar-unpack.mjs')>(),
  verifyWindowsAsarUnpack: async () => undefined,
}))

const ENVIRONMENT = {
  DSH_DESKTOP_APP_ID: 'com.example.installer',
  DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
  DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }),
  DSH_DESKTOP_TARGET_PLATFORM: 'win32',
  DSH_DESKTOP_TARGET_ARCH: 'x64',
  DSH_DESKTOP_UNSIGNED: '1',
  DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
  DOWNLOAD_TEST_RELEASE_ID: '0123456789abcdef0123456789abcdef',
}

const CONTEXT = { appOutDir: 'out', packager: { getResourcesDir: () => 'out/resources' } }

/**
 * Run the packaging hook that verifies the bundled runtime.
 * @returns The version that hook required the runtime to declare.
 */
async function requiredRuntimeVersion(preparedRuntime?: string, preparedRuntimeVersion?: string): Promise<unknown> {
  verifyDesktopRuntime.mockClear()
  const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
  const config = createElectronBuilderConfig(ENVIRONMENT, 'win32', 'x64', preparedRuntime, preparedRuntimeVersion)
  await config.afterPack(CONTEXT as never)
  return verifyDesktopRuntime.mock.calls[0]?.[1]
}

describe('packaged runtime verification', () => {
  it('requires the product version when the target tree supplies the runtime', async () => {
    const productVersion = (JSON.parse(
      await import('node:fs/promises').then(async fs => fs.readFile(new URL('../package.json', import.meta.url), 'utf8')),
    ) as { version: string }).version
    expect(await requiredRuntimeVersion()).toBe(productVersion)
  })

  it('requires the version installed-update qualification wrote into its private runtime', async () => {
    // Qualification rewrites the runtime's own version, so comparing against the product version would always fail.
    expect(await requiredRuntimeVersion('/qualification/dsh', '0.1.6-alpha.2.20260921.1')).toBe('0.1.6-alpha.2.20260921.1')
  })

  it('does not let a build version change what the bundled runtime must declare', async () => {
    const productVersion = (JSON.parse(
      await import('node:fs/promises').then(async fs => fs.readFile(new URL('../package.json', import.meta.url), 'utf8')),
    ) as { version: string }).version
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    verifyDesktopRuntime.mockClear()
    const config = createElectronBuilderConfig(
      { ...ENVIRONMENT, DSH_DESKTOP_BUILD_VERSION: `${productVersion}.20260921.1` }, 'win32', 'x64')
    expect(config.extraMetadata).toMatchObject({ version: `${productVersion}.20260921.1` })
    await config.afterPack(CONTEXT as never)
    expect(verifyDesktopRuntime.mock.calls[0]?.[1]).toBe(productVersion)
  })

  it('omits product identity extras when they are not configured', async () => {
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const config = createElectronBuilderConfig(ENVIRONMENT, 'win32', 'x64')
    expect(config.extraMetadata).not.toHaveProperty('version')
    expect(config.extraMetadata).not.toHaveProperty('name')
    expect(config.extraMetadata).not.toHaveProperty('dshDesktopProfileName')
    expect(config.extraMetadata).not.toHaveProperty('dshDesktopExtraBundles')
    expect(config.extraMetadata).not.toHaveProperty('dshDesktopInAppAuth')
    expect(config.extraMetadata).not.toHaveProperty('dshDesktopWelcomeApiKey')
    expect(config.appId).toBe(ENVIRONMENT.DSH_DESKTOP_APP_ID)
  })

  it('publishes a product version override without changing the bundled runtime version', async () => {
    const declaredVersion = (JSON.parse(
      await import('node:fs/promises').then(async fs => fs.readFile(new URL('../package.json', import.meta.url), 'utf8')),
    ) as { version: string }).version
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    verifyDesktopRuntime.mockClear()
    const config = createElectronBuilderConfig(
      { ...ENVIRONMENT, DSH_DESKTOP_PRODUCT_VERSION: '3.0.0', DSH_DESKTOP_PACKAGE_NAME: 'product-harness',
        DSH_DESKTOP_PROFILE_NAME: 'product-desktop', DSH_DESKTOP_EXTRA_BUNDLES: 'extra-bundle',
        DSH_DESKTOP_PRODUCT_APP_ID: 'com.example.product' }, 'win32', 'x64')
    expect(config.appId).toBe('com.example.product')
    expect(config.extraMetadata).toMatchObject({
      version: '3.0.0',
      name: 'product-harness',
      dshDesktopProfileName: 'product-desktop',
      dshDesktopExtraBundles: ['extra-bundle'],
      dshDesktopAppId: 'com.example.product',
    })
    await config.afterPack(CONTEXT as never)
    expect(verifyDesktopRuntime.mock.calls[0]?.[1]).toBe(declaredVersion)
  })

  it('bakes in-app authorization and the welcome API Key switch into extraMetadata', async () => {
    const auth = {
      origins: ['https://sso.example.test'],
      callbackPrefix: 'https://sso.example.test/callback',
      forwardPath: '/auth/callback',
    }
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    const config = createElectronBuilderConfig({
      ...ENVIRONMENT,
      DSH_DESKTOP_IN_APP_AUTH: JSON.stringify(auth),
      DSH_DESKTOP_WELCOME_API_KEY: '0',
    }, 'win32', 'x64')
    expect(config.extraMetadata).toMatchObject({
      dshDesktopInAppAuth: auth,
      dshDesktopWelcomeApiKey: '0',
    })
  })
})
