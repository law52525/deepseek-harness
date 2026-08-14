/**
 * Stage the desktop Host Node closure and run electron-builder for the host
 * platform. Layout and unsigned/ad-hoc policy are owned by
 * .agents/notes/implemented/process/2026-08-14-desktop-installer-packaging.md.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { chmod, copyFile, cp, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'
import { pnpmBin, runLogged, stageRuntimeClosure } from './stage-runtime-closure.ts'

const root = resolve(import.meta.dirname, '..')

/** Workspace package name of the desktop deploy root. */
const DEPLOY_ROOT_PACKAGE = 'dsh-desktop-runtime'
/** Host child entry inside the staged closure. */
const ENTRY_BIN = 'node_modules/@deepseek-ai/dsh/lib/bin.js'
const DESKTOP_DIR = 'apps/desktop'
/** Must match `DESKTOP_HOST_RESOURCE` in apps/desktop/src/packaged-resources.ts and electron-builder extraResources. */
const HOST_RESOURCE = 'host'
/** Must match `DESKTOP_FRONTEND_RESOURCE` in apps/desktop/src/packaged-resources.ts and electron-builder extraResources. */
const FRONTEND_RESOURCE = 'frontend'
const STAGE_DIR = join(DESKTOP_DIR, 'stage')
const HOST_STAGE = join(STAGE_DIR, HOST_RESOURCE)
const FRONTEND_STAGE = join(STAGE_DIR, FRONTEND_RESOURCE)
/** Must match `productName` in apps/desktop/electron-builder.yml. */
const PRODUCT_NAME = 'DeepSeek Harness'
const DEPLOY_SOURCE_NODE_MODULES = 'desktop-runtime/node_modules'
const DEPLOY_ONLY_DOCS = ['README.md', 'README.zh.md', 'README.i18n.yaml']
const LOG = 'build-desktop-installer'

export type PackagerTarget = { os: 'mac'; arch: 'arm64' } | { os: 'win'; arch: 'x64' }

/**
 * Drop a lone `--` so `pnpm run dist:desktop -- --skip-build` reaches parseArgs
 * as flags rather than a positional.
 * @param argv - `process.argv.slice(2)`.
 * @returns argv without end-of-options markers.
 */
export function installerCliArgv(argv: readonly string[]): string[] {
  return argv.filter(argument => argument !== '--')
}

/**
 * Validated CLI configuration; construction owns help and parse-error exits.
 */
export class DesktopInstallerCli {
  private constructor(
    /** Skip `pnpm run build`; lib/ and frontend dist must already exist. */
    readonly skipBuild: boolean,
    /** Stage and smoke only; do not invoke electron-builder. */
    readonly skipPackager: boolean,
    /** Print every command without executing. */
    readonly dryRun: boolean,
  ) {}

  /**
   * Parse argv. Help exits 0; malformed flags exit 1.
   * @param argv - `process.argv.slice(2)`.
   * @returns the parsed configuration.
   */
  static parse(argv: string[]): DesktopInstallerCli {
    let values: ReturnType<typeof DesktopInstallerCli.parseRaw>
    try {
      values = DesktopInstallerCli.parseRaw(argv)
    } catch (error) {
      console.error(`${LOG}: ${error instanceof Error ? error.message : String(error)}\n`)
      console.error(DesktopInstallerCli.usage())
      process.exit(1)
    }
    if (values.help) {
      console.log(DesktopInstallerCli.usage())
      process.exit(0)
    }
    return new DesktopInstallerCli(values['skip-build'], values['skip-packager'], values['dry-run'])
  }

  private static parseRaw(argv: string[]) {
    return parseArgs({
      args: installerCliArgv(argv),
      options: {
        'skip-build': { type: 'boolean', default: false },
        'skip-packager': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    }).values
  }

  private static usage(): string {
    return [
      'Usage: pnpm exec tsx scripts/build-desktop-installer.ts [flags]',
      '',
      '  --skip-build      skip `pnpm run build` (lib/ and frontend dist must already exist).',
      '  --skip-packager   stage the Host closure and smoke it; do not run electron-builder.',
      '  --dry-run         print every command without executing.',
      '  --help            print this help.',
      '',
      'Host targets: macOS arm64 (.dmg) and Windows x64 (NSIS). Build on the target OS.',
      'See .agents/notes/implemented/process/2026-08-14-desktop-installer-packaging.md.',
    ].join('\n')
  }
}

/**
 * Resolve the v1 packager target for this host, or throw.
 * @param platform - `process.platform`.
 * @param arch - `process.arch`.
 * @returns mac arm64 or win x64.
 */
export function packagerTarget(platform: NodeJS.Platform, arch: string): PackagerTarget {
  if (platform === 'darwin' && arch === 'arm64') return { os: 'mac', arch: 'arm64' }
  if (platform === 'win32' && arch === 'x64') return { os: 'win', arch: 'x64' }
  throw new Error(
    `${LOG}: v1 ships macOS arm64 dmg and Windows x64 NSIS; build on the target OS `
    + `(host is ${platform}-${arch}). Pass --skip-packager to stage without electron-builder.`,
  )
}

/**
 * Unpacked extraResources directories electron-builder writes before the dmg/NSIS wrap.
 * @param desktopDist - `apps/desktop/dist`.
 * @param target - host packager target.
 * @param productName - electron-builder `productName`.
 * @returns candidate Resources directories, first existing wins.
 */
export function packedResourcesCandidates(
  desktopDist: string,
  target: PackagerTarget,
  productName: string,
): string[] {
  if (target.os === 'mac') {
    return [join(desktopDist, `mac-${target.arch}`, `${productName}.app`, 'Contents', 'Resources')]
  }
  return [
    join(desktopDist, 'win-unpacked', 'resources'),
    join(desktopDist, `win-${target.arch}-unpacked`, 'resources'),
  ]
}

/**
 * Workspace `.bin` shim. Prefer this over `pnpm exec` after `pnpm deploy --prod`:
 * `pnpm exec` with `CI=true` can reinstall the workspace as production-only.
 */
function workspaceBin(name: string, fromDir = '.'): string {
  const bin = process.platform === 'win32' ? `${name}.cmd` : name
  return join(root, fromDir, 'node_modules', '.bin', bin)
}

class DesktopInstallerBuild {
  readonly hostStaging = resolve(root, HOST_STAGE)
  readonly frontendStaging = resolve(root, FRONTEND_STAGE)

  constructor(private readonly cli: DesktopInstallerCli) {}

  private run(label: string, command: string, args: readonly string[]): Promise<void> {
    return runLogged(
      { root, dryRun: this.cli.dryRun, logPrefix: LOG },
      label,
      command,
      args,
    )
  }

  async verifyClosure(): Promise<void> {
    await this.run('runtime dependency closure', workspaceBin('tsx'), [
      'scripts/verify-runtime-closure.ts',
      '--manifest',
      'desktop-runtime/package.json',
    ])
  }

  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log(`${LOG}: skipping pnpm run build (--skip-build)`)
      return
    }
    await this.run('build', pnpmBin(), ['run', 'build'])
  }

  async deployHost(): Promise<void> {
    await stageRuntimeClosure({
      root,
      filter: DEPLOY_ROOT_PACKAGE,
      staging: this.hostStaging,
      sourceNodeModules: resolve(root, DEPLOY_SOURCE_NODE_MODULES),
      dryRun: this.cli.dryRun,
      logPrefix: LOG,
      docsToRemove: DEPLOY_ONLY_DOCS,
    })
  }

  /** Copy the builder Node into the staged Host tree and, on macOS, the pty helper. */
  async bundleNode(): Promise<void> {
    const destName = process.platform === 'win32' ? 'node.exe' : 'node'
    const destination = join(this.hostStaging, destName)
    const source = await realpath(process.execPath)
    if (this.cli.dryRun) {
      console.log(`${LOG}: [dry-run] cp ${source} ${destination}`)
      if (process.platform === 'darwin') {
        console.log(`${LOG}: [dry-run] cp node-pty spawn-helper ${destination}-spawn-helper`)
      }
      return
    }
    await copyFile(source, destination)
    await chmod(destination, 0o755)
    if (process.platform !== 'darwin') return
    const helperSource = join(
      this.hostStaging,
      'node_modules',
      'node-pty',
      'prebuilds',
      `darwin-${process.arch}`,
      'spawn-helper',
    )
    if (!existsSync(helperSource)) {
      throw new Error(`${LOG}: node-pty spawn-helper missing at ${helperSource}`)
    }
    const helperDest = `${destination}-spawn-helper`
    await copyFile(helperSource, helperDest)
    await chmod(helperDest, 0o755)
  }

  async stageFrontend(): Promise<void> {
    const require = createRequire(import.meta.url)
    let index: string
    try {
      index = require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
    } catch {
      throw new Error(`${LOG}: frontend dist not built; run without --skip-build so apps/web dist exists.`)
    }
    const source = resolve(index, '..')
    if (this.cli.dryRun) {
      console.log(`${LOG}: [dry-run] cp ${source} ${this.frontendStaging}`)
      return
    }
    await rm(this.frontendStaging, { recursive: true, force: true })
    await mkdir(this.frontendStaging, { recursive: true })
    await cp(source, this.frontendStaging, { recursive: true })
  }

  /**
   * Boot the staged Host with `--help` and `--dump-config` (no window).
   */
  async smokeHost(): Promise<void> {
    const node = join(this.hostStaging, process.platform === 'win32' ? 'node.exe' : 'node')
    const bin = join(this.hostStaging, ENTRY_BIN)
    if (this.cli.dryRun) {
      console.log(`${LOG}: [dry-run] ${node} ${bin} --profile desktop --help`)
      console.log(`${LOG}: [dry-run] ${node} ${bin} --profile desktop --dump-config`)
      return
    }
    if (!existsSync(node)) throw new Error(`${LOG}: staged Node missing at ${node}`)
    if (!existsSync(bin)) throw new Error(`${LOG}: staged dsh bin missing at ${bin}`)
    const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-stage-'))
    try {
      const help = await runCaptured(node, [bin, '--profile', 'desktop', '--help'], home)
      if (help.code !== 0) {
        throw new Error(`${LOG}: staged --help exited ${String(help.code)}\n${help.stderr}`)
      }
      const dump = await runCaptured(node, [bin, '--profile', 'desktop', '--dump-config'], home)
      if (dump.code !== 0) {
        throw new Error(`${LOG}: staged --dump-config exited ${String(dump.code)}\n${dump.stderr}`)
      }
      if (dump.stdout.includes("name: '@deepseek-ai/dsh-host-webserver'")) {
        throw new Error(`${LOG}: staged --dump-config contains a webserver row`)
      }
      if (!dump.stdout.includes("name: '@deepseek-ai/dsh-desktop-app'")) {
        throw new Error(`${LOG}: staged --dump-config is missing the desktop-app row`)
      }
      console.log(`${LOG}: staged Host --help and --dump-config passed`)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }

  async pack(): Promise<void> {
    if (this.cli.skipPackager) {
      console.log(`${LOG}: skipping electron-builder (--skip-packager)`)
      return
    }
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    const target = packagerTarget(process.platform, process.arch)
    const builder = workspaceBin('electron-builder', DESKTOP_DIR)
    const args = ['--publish', 'never', `--${target.os}`, `--${target.arch}`]
    await runLogged(
      {
        root,
        cwd: resolve(root, DESKTOP_DIR),
        dryRun: this.cli.dryRun,
        logPrefix: LOG,
      },
      'electron-builder',
      builder,
      args,
    )
    if (this.cli.dryRun) return
    const dist = resolve(root, DESKTOP_DIR, 'dist')
    if (!existsSync(dist)) {
      throw new Error(`${LOG}: electron-builder produced no ${dist}`)
    }
    assertPackedClosure(dist, target)
    console.log(`${LOG}: artifacts:`)
    await printArtifacts(dist)
  }
}

/**
 * Fail if extraResources omitted the Host closure or frontend dist.
 * @param dist - `apps/desktop/dist`.
 * @param target - host packager target.
 */
function assertPackedClosure(dist: string, target: PackagerTarget): void {
  const candidates = packedResourcesCandidates(dist, target, PRODUCT_NAME)
  const resources = candidates.find(candidate => existsSync(candidate))
  if (resources === undefined) {
    throw new Error(
      `${LOG}: packed extraResources directory missing under ${dist} `
      + `(looked for ${candidates.join(', ')})`,
    )
  }
  const nodeName = target.os === 'win' ? 'node.exe' : 'node'
  const required = [
    join(HOST_RESOURCE, nodeName),
    join(HOST_RESOURCE, ENTRY_BIN),
    join(FRONTEND_RESOURCE, 'index.html'),
  ]
  for (const relative of required) {
    const absolute = join(resources, relative)
    if (!existsSync(absolute)) {
      throw new Error(`${LOG}: packed extraResources missing ${relative} at ${absolute}`)
    }
  }
  console.log(`${LOG}: packed extraResources include Host closure and frontend dist`)
}

async function printArtifacts(directory: string): Promise<void> {
  const { readdir } = await import('node:fs/promises')
  for (const name of await readdir(directory)) {
    if (!/\.(dmg|exe|zip)$/i.test(name)) continue
    const path = join(directory, name)
    const megabytes = statSync(path).size / (1024 * 1024)
    console.log(`  ${path}  (${megabytes.toFixed(1)} MB)`)
  }
}

function runCaptured(
  command: string,
  args: string[],
  home: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, DSH_HOME: home, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${LOG}: smoke timed out after 60s`))
    }, 60_000)
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`${LOG}: smoke failed to spawn: ${error.message}`))
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

async function main(): Promise<void> {
  const cli = DesktopInstallerCli.parse(process.argv.slice(2))
  const pipeline = new DesktopInstallerBuild(cli)
  console.log(`${LOG}: host staging: ${pipeline.hostStaging}`)
  await pipeline.verifyClosure()
  await pipeline.build()
  await pipeline.deployHost()
  await pipeline.bundleNode()
  await pipeline.stageFrontend()
  await pipeline.smokeHost()
  await pipeline.pack()
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) await main()
