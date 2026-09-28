import { officePackageDirectories } from '../../../scripts/libreoffice-packages.mjs'
import { X509Certificate } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  resolveDesktopAppId,
  resolveMacOSNotarizationEnvironment,
  resolveMacOSSigningEnvironment,
} from './desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from './notarize-macos-disk-images.mjs'
import { verifyMacOSSignatureAfterSign } from './verify-macos-signature.mjs'
import {
  createWindowsTokenSigner,
  installWindowsNsisBootstrapSigner,
  resolveWindowsUpdatePublisher,
  scrubWindowsSigningEnvironment,
} from './windows-sign.mjs'
import { resolveDesktopAutoUpdateConfig } from './desktop-auto-update-environment.mjs'
import { resolveDesktopBuildCommit } from './desktop-build-commit.mjs'
import { resolveDesktopBuildVersion, resolveDesktopProductVersion } from './desktop-build-version.mjs'
import { resolveDesktopPolicyEnvironment } from './desktop-policy-environment.mjs'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { installWindowsDirectoryInstaller } from './windows-directory-installer.mjs'
import { preserveWindowsRuntimeSignature, signWindowsCode } from './windows-runtime-signature.mjs'
import { prepareWindowsAsarUnpack, verifyWindowsAsarUnpack } from './windows-asar-unpack.mjs'
import { recordPackagingEvent } from './packaging-run.mjs'
import {
  resolveMacOSAppUpdateFeed,
  verifyMacOSAppUpdateConfig,
  writeMacOSAppUpdateConfig,
} from './macos-app-update-config.mjs'

const PRODUCT_APP_ID_ENV = 'DSH_DESKTOP_PRODUCT_APP_ID'
const PACKAGE_NAME_ENV = 'DSH_DESKTOP_PACKAGE_NAME'
const PROFILE_NAME_ENV = 'DSH_DESKTOP_PROFILE_NAME'
const EXTRA_BUNDLES_ENV = 'DSH_DESKTOP_EXTRA_BUNDLES'
const PRODUCT_NAME_ENV = 'DSH_DESKTOP_PRODUCT_NAME'
const PROTOCOL_SCHEME_ENV = 'DSH_DESKTOP_PROTOCOL_SCHEME'
const ARTIFACT_PREFIX_ENV = 'DSH_DESKTOP_ARTIFACT_PREFIX'
const BRAND_RESOURCES_ENV = 'DSH_DESKTOP_BRAND_RESOURCES'
const IN_APP_AUTH_ENV = 'DSH_DESKTOP_IN_APP_AUTH'
const WELCOME_API_KEY_ENV = 'DSH_DESKTOP_WELCOME_API_KEY'
const DEFAULT_PRODUCT_NAME = 'DeepSeek Harness'
const DEFAULT_PROTOCOL_SCHEME = 'dsh'
const DEFAULT_ARTIFACT_PREFIX = 'deepseek-harness'
const ARTIFACT_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PROTOCOL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/

function commaSeparatedNames(value) {
  if (value === undefined) return []
  const names = []
  const seen = new Set()
  for (const part of value.split(',')) {
    const name = part.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function parseInAppAuthMetadata(env) {
  const raw = trimmed(env, IN_APP_AUTH_ENV)
  if (raw === undefined) return undefined
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`desktop package: ${IN_APP_AUTH_ENV} must be JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || !Array.isArray(parsed.origins) || parsed.origins.length === 0
    || typeof parsed.callbackPrefix !== 'string' || typeof parsed.forwardPath !== 'string') {
    throw new Error(`desktop package: ${IN_APP_AUTH_ENV} must include origins, callbackPrefix, and forwardPath`)
  }
  return {
    origins: parsed.origins.map((item) => {
      if (typeof item !== 'string') {
        throw new Error(`desktop package: ${IN_APP_AUTH_ENV} origins must be https origins`)
      }
      return item.trim()
    }),
    callbackPrefix: parsed.callbackPrefix.trim(),
    forwardPath: parsed.forwardPath.trim(),
  }
}

function trimmed(env, name) {
  const value = env[name]?.trim()
  return value === undefined || value === '' ? undefined : value
}

function resolveProductName(env) {
  return trimmed(env, PRODUCT_NAME_ENV) ?? DEFAULT_PRODUCT_NAME
}

function resolveProtocolScheme(env) {
  const value = trimmed(env, PROTOCOL_SCHEME_ENV)
  if (value === undefined) return DEFAULT_PROTOCOL_SCHEME
  if (!PROTOCOL_SCHEME_PATTERN.test(value)) {
    throw new Error(`desktop package: ${PROTOCOL_SCHEME_ENV} must be a lowercase URI scheme`)
  }
  return value
}

function resolveArtifactPrefix(env) {
  const value = trimmed(env, ARTIFACT_PREFIX_ENV)
  if (value === undefined) return DEFAULT_ARTIFACT_PREFIX
  if (!ARTIFACT_PREFIX_PATTERN.test(value)) {
    throw new Error(`desktop package: ${ARTIFACT_PREFIX_ENV} must be a file-name token`)
  }
  return value
}

function resourcePath(env, official, name) {
  const brand = trimmed(env, BRAND_RESOURCES_ENV)
  return brand === undefined
    ? fileURLToPath(new URL(`../resources/${official}`, import.meta.url))
    : join(brand, name)
}

/**
 * Create electron-builder configuration from one release environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no explicit target is present.
 * @param {string} hostArch - Build-host architecture used when no explicit target is present.
 * @param {string | undefined} preparedRuntime - Verified private dsh tree for installed-update qualification; ordinary releases use the target tree.
 * @param {string | undefined} preparedRuntimeVersion - Version that private tree declares, which qualification rewrites away from the product version.
 * @returns {object} electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
  preparedRuntime = undefined,
  preparedRuntimeVersion = undefined,
) {
  const productAppId = env[PRODUCT_APP_ID_ENV]?.trim()
  const appId = resolveDesktopAppId({
    ...env,
    ...productAppId === undefined || productAppId === '' ? {} : { DSH_DESKTOP_APP_ID: productAppId },
  })
  const policy = resolveDesktopPolicyEnvironment(env)
  const targetPlatform = env.DSH_DESKTOP_TARGET_PLATFORM
  const resolvedPlatform = targetPlatform ?? hostPlatform
  const resolvedArch = env.DSH_DESKTOP_TARGET_ARCH ?? hostArch
  if (env.DSH_DESKTOP_UNSIGNED !== undefined && !['0', '1'].includes(env.DSH_DESKTOP_UNSIGNED)) {
    throw new Error('desktop package: DSH_DESKTOP_UNSIGNED must be 0 or 1')
  }
  const unsigned = env.DSH_DESKTOP_UNSIGNED === '1'
  if (unsigned && resolvedPlatform !== 'win32') throw new Error('desktop package: unsigned builds require Windows')
  const packagesMacOS = targetPlatform === 'darwin' || (targetPlatform === undefined && hostPlatform === 'darwin')
  const packagesWindows = resolvedPlatform === 'win32'
  if (resolvedPlatform === 'win32') installWindowsDirectoryInstaller()
  const macOSSigning = packagesMacOS ? resolveMacOSSigningEnvironment(env) : undefined
  if (packagesMacOS) resolveMacOSNotarizationEnvironment(env)
  const buildPaths = desktopTargetBuildPaths(resolveDesktopBuildTarget(env, hostPlatform, hostArch))
  let primaryRuntimeDestination
  let dshDestination
  let windowsCode = []
  const unpack = ['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep-*/bin/rg',
    `**/node_modules/@deepseek-ai/libreoffice-kit-${resolvedPlatform}-${resolvedArch}/**/*`]
  const windowsSigner = packagesWindows && !unsigned
    ? createWindowsTokenSigner({
        certificateFile: env.DSH_DESKTOP_WINDOWS_CER_FILE,
        signTool: env.DSH_DESKTOP_WINDOWS_SIGNTOOL,
        tokenPin: env.DSH_DESKTOP_WINDOWS_TOKEN_PIN,
        keyContainer: env.DSH_DESKTOP_WINDOWS_KEY_CONTAINER,
        preserveSignature: async path => {
          for (const [sourceRoot, destinationRoot] of [[join(buildPaths.runtime, 'primary-runtime'), primaryRuntimeDestination], [buildPaths.dsh, dshDestination]]) {
            if (destinationRoot !== undefined && await preserveWindowsRuntimeSignature(path, {
              sourceRoot, destinationRoot, runDirectory: env.DSH_DESKTOP_PACKAGING_RUN_DIR,
            })) return true
          }
          return false
        },
      })
    : undefined
  if (windowsSigner !== undefined) {
    installWindowsNsisBootstrapSigner({ sign: windowsSigner })
  }
  const update = unsigned ? undefined : resolveDesktopAutoUpdateConfig(env, resolvedPlatform, resolvedArch)
  if (preparedRuntime !== undefined) buildPaths.dsh = preparedRuntime
  // electron-builder merges extraMetadata into the packaged manifest, so a build version here reaches
  // the artifact names, the update feed, and the installed app.getVersion() the updater compares against.
  const declaredVersion = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version
  const productVersion = resolveDesktopProductVersion(env, declaredVersion)
  const buildVersion = resolveDesktopBuildVersion(env, productVersion)
  const packaged = resolveDesktopBuildCommit(env)
  const packageName = env[PACKAGE_NAME_ENV]?.trim()
  const profileName = env[PROFILE_NAME_ENV]?.trim()
  const extraBundles = commaSeparatedNames(env[EXTRA_BUNDLES_ENV])
  const productName = resolveProductName(env)
  const protocolScheme = resolveProtocolScheme(env)
  const artifactPrefix = resolveArtifactPrefix(env)
  const iconMacos = resourcePath(env, 'icon-macos.png', 'icon-macos.png')
  const iconWindows = resourcePath(env, 'icon-windows.png', 'icon-windows.png')
  const trayWindows = resourcePath(env, 'tray-windows.ico', 'tray-windows.ico')
  const welcomeBrand = trimmed(env, BRAND_RESOURCES_ENV) === undefined
    ? undefined
    : join(trimmed(env, BRAND_RESOURCES_ENV), 'welcome-brand.svg')
  const rendererFiles = welcomeBrand === undefined
    ? ['renderer/**/*']
    : [
      { from: 'renderer', to: 'renderer', filter: ['**/*', '!assets/welcome-brand.svg'] },
      // `files` FileSet `from` is a directory; mapping a single file path is ignored.
      { from: dirname(welcomeBrand), to: 'renderer/assets', filter: [basename(welcomeBrand)] },
    ]
  const installerSidebar = trimmed(env, BRAND_RESOURCES_ENV) === undefined
    ? join(buildPaths.root, 'installer-ui', 'uninstaller-sidebar.bmp')
    : join(trimmed(env, BRAND_RESOURCES_ENV), 'uninstaller-sidebar.bmp')
  const inAppAuth = parseInAppAuthMetadata(env)
  const welcomeApiKey = trimmed(env, WELCOME_API_KEY_ENV)
  return {
    appId,
    protocols: [{ name: productName, schemes: [protocolScheme] }],
    extraMetadata: {
      dshDesktopAppId: appId,
      dshMandatoryUpdatePolicy: policy,
      ...buildVersion === declaredVersion ? {} : { version: buildVersion },
      ...packageName === undefined || packageName === '' ? {} : { name: packageName },
      ...profileName === undefined || profileName === '' || profileName === 'desktop'
        ? {}
        : { dshDesktopProfileName: profileName },
      ...extraBundles.length === 0 ? {} : { dshDesktopExtraBundles: extraBundles },
      ...productName === DEFAULT_PRODUCT_NAME ? {} : { dshDesktopProductName: productName },
      ...protocolScheme === DEFAULT_PROTOCOL_SCHEME ? {} : { dshDesktopProtocolScheme: protocolScheme },
      ...inAppAuth === undefined ? {} : { dshDesktopInAppAuth: inAppAuth },
      ...welcomeApiKey === undefined ? {} : { dshDesktopWelcomeApiKey: welcomeApiKey },
      ...packaged === undefined ? {} : { dshBuildCommit: packaged.commit, dshBuildDirty: packaged.dirty },
    },
    productName,
    // Unsigned builds carry their own suffix so a shared file can never pass for a release artifact.
    artifactName: `${artifactPrefix}-\${version}-\${os}-\${arch}${unsigned ? '-unsigned' : ''}.\${ext}`,
    directories: { output: unsigned ? buildPaths.unsignedArtifacts : buildPaths.artifacts },
    asar: true,
    electronDist: buildPaths.electron,
    electronFuses: { runAsNode: true },
    beforeBuild: async () => {
      if (resolvedPlatform !== 'win32') return true
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        fileURLToPath(new URL('./prepare-windows-installer.ps1', import.meta.url)),
        '-OutputDirectory', join(buildPaths.root, 'installer-ui')], {
        env: scrubWindowsSigningEnvironment(env), windowsHide: true,
      })
      if (productName !== DEFAULT_PRODUCT_NAME) {
        const source = readFileSync(fileURLToPath(new URL('../installer/strings.nsh', import.meta.url)), 'utf8')
        writeFileSync(
          join(buildPaths.root, 'installer-ui', 'strings.nsh'),
          source.split(DEFAULT_PRODUCT_NAME).join(productName),
        )
      }
      if (windowsSigner !== undefined) {
        await windowsSigner({ path: join(buildPaths.root, 'installer-ui', 'window-frame.dll'), hash: 'sha256', isNest: false })
      }
      // A falsy result tells electron-builder to omit its production node_modules collection.
      return true
    },
    files: [
      'lib/main.js',
      'lib/welcome/**/*',
      'lib/preload-app.cjs',
      'lib/preload-mandatory.cjs',
      'lib/preload-platform-account.cjs',
      'lib/preload-update-dialog.cjs',
      'lib/preload-welcome.cjs',
      ...rendererFiles,
      'package.json',
      { from: buildPaths.dsh, to: 'dsh', filter: ['**/*'] },
      // electron-builder excludes a source directory's root node_modules.
      { from: join(buildPaths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] },
    ],
    asarUnpack: unpack,
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      { from: iconWindows, to: 'icon.png' },
      // Windows tray bitmaps; macOS keeps the Dock and ships no menu bar icon.
      ...(packagesWindows ? [{ from: trayWindows, to: 'tray.ico' }] : []),
    ],
    mac: {
      icon: iconMacos,
      category: 'public.app-category.developer-tools',
      identity: macOSSigning?.signingIdentity,
      forceCodeSigning: true,
      hardenedRuntime: true,
      // macOS matches the application locale against this bundle, not Electron Framework resources.
      extendInfo: {
        CFBundleLocalizations: ['en', 'zh_CN'],
        NSMicrophoneUsageDescription: `${productName} uses your microphone to transcribe speech into message drafts.`,
      },
      // ASAR-unpacked native runtime files are pre-signed; PAK resources are sealed by their enclosing bundle.
      signIgnore: ['/Contents/Resources/app\\.asar\\.unpacked/dsh(?:/|$)', '/Contents/Resources/runtime/primary-runtime(?:/|$)', '\\.pak$'],
      notarize: true,
      target: ['dmg', 'zip'],
    },
    dmg: {
      sign: true,
      writeUpdateInfo: false,
    },
    beforePack: async context => {
      const office = await officePackageDirectories(buildPaths.dsh, { platform: resolvedPlatform, arch: resolvedArch })
      const patterns = office.map(directory => `**/${relative(buildPaths.dsh, directory).split(sep).join('/')}/**/*`)
      const existing = context.packager.config.asarUnpack ?? []
      context.packager.config.asarUnpack = [...(typeof existing === 'string' ? [existing] : existing), ...patterns]
      if (packagesWindows) windowsCode = await prepareWindowsAsarUnpack(context, buildPaths.dsh)
      if (windowsSigner !== undefined) {
        primaryRuntimeDestination = join(context.appOutDir, 'resources', 'runtime', 'primary-runtime')
        dshDestination = join(context.appOutDir, 'resources', 'app.asar.unpacked', 'dsh')
      }
      if (policy === undefined) return
      const { resolveDesktopPolicyConfig } = await import('../lib/types/mandatory-update-policy.js')
      resolveDesktopPolicyConfig(policy)
    },
    afterPack: async context => {
      const { verifyDesktopRuntime } = await import('../lib/types/runtime-tree.js')
      const resourcesDir = context.packager.getResourcesDir(context.appOutDir)
      if (resolvedPlatform === 'darwin' && update !== undefined) {
        await writeMacOSAppUpdateConfig(resourcesDir, resolveMacOSAppUpdateFeed(context.packager.config.publish),
          context.packager.appInfo.updaterCacheDirName)
      }
      // The bundled runtime declares the dsh version, not the published product version.
      await verifyDesktopRuntime(buildPaths.dsh,
        preparedRuntimeVersion ?? declaredVersion, { platform: resolvedPlatform, arch: resolvedArch })
      // Unsigned Windows builds skip electron-builder's afterSign hook.
      if (packagesWindows && unsigned) await verifyWindowsAsarUnpack(buildPaths.dsh, resourcesDir, windowsCode)
    },
    afterSign: async context => {
      if (windowsSigner !== undefined) {
        await signWindowsCode(context.appOutDir, {
          thumbprint: new X509Certificate(await readFile(env.DSH_DESKTOP_WINDOWS_CER_FILE)).fingerprint.replaceAll(':', ''),
          sign: windowsSigner,
          record: event => recordPackagingEvent(env.DSH_DESKTOP_PACKAGING_RUN_DIR, event),
        })
        await verifyWindowsAsarUnpack(buildPaths.dsh, context.packager.getResourcesDir(context.appOutDir), windowsCode)
      }
      if (context.electronPlatformName !== 'darwin') return
      const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
      if (update !== undefined) {
        await verifyMacOSAppUpdateConfig(appPath, resolveMacOSAppUpdateFeed(context.packager.config.publish),
          context.packager.appInfo.updaterCacheDirName)
      }
      verifyMacOSSignatureAfterSign(context, macOSSigning ?? resolveMacOSSigningEnvironment(env))
    },
    artifactBuildCompleted: artifact => {
      if (!artifact.file.endsWith('.dmg')) return
      return notarizeMacOSDiskImageArtifact(
        artifact,
        env,
        macOSSigning ?? resolveMacOSSigningEnvironment(env),
      )
    },
    win: {
      icon: iconWindows,
      forceCodeSigning: !unsigned,
      signtoolOptions: {
        sign: windowsSigner,
        publisherName: windowsSigner === undefined ? undefined : resolveWindowsUpdatePublisher(env.DSH_DESKTOP_WINDOWS_CER_FILE),
        signingHashAlgorithms: ['sha256'],
      },
      target: ['nsis'],
    },
    linux: {
      category: 'Development',
      target: ['AppImage'],
    },
    nsis: {
      installerSidebar,
      uninstallerSidebar: installerSidebar,
      include: fileURLToPath(new URL('./installer.nsh', import.meta.url)),
      oneClick: false,
      perMachine: false,
      allowElevation: false,
      allowToChangeInstallationDirectory: false,
      installerLanguages: ['en_US', 'zh_CN'],
      differentialPackage: true,
    },
    detectUpdateChannel: false,
    publish: update === undefined ? null : [{ provider: 'generic', url: update.publicUrl, channel: 'nightly' }],
  }
}
