/**
 * Materialize a pnpm deploy of a closed-runtime workspace manifest into a
 * symlink-free directory. The four deploy flags were measured for the Python
 * exe pipeline; callers must assert the staged tree has no remaining links.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

/**
 * Measured `pnpm deploy` flags: `--legacy` is required with inject-workspace-packages
 * off; hoisted gives one flat instance layout; disabling automatic peer installation
 * keeps undeclared peers out of the closure; link-workspace-packages selects direct
 * workspace dependencies.
 */
const MEASURED_PNPM_DEPLOY_FLAGS = [
  '--legacy',
  '--prod',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.link-workspace-packages=true',
] as const

export interface StageRuntimeClosureOptions {
  /** Repository root (cwd for pnpm). */
  root: string
  /** Workspace package name passed to `pnpm --filter`. */
  filter: string
  /** Directory to clear and deploy into. */
  staging: string
  /** Source `node_modules` next to the deploy-root manifest, used to restore legacy hoists. */
  sourceNodeModules: string
  /** Print actions without executing them. */
  dryRun?: boolean
  /** Prefix each log line. */
  logPrefix: string
  /** Filenames to delete from the staged root after deploy (READMEs, pairing sidecars). */
  docsToRemove?: readonly string[]
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * pnpm executable for the host platform.
 * @returns `pnpm.cmd` on Windows, `pnpm` elsewhere.
 */
export function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/** Relative path of pnpm's workspace install-settings cache. */
const PNPM_WORKSPACE_STATE = join('node_modules', '.pnpm-workspace-state-v1.json')

/**
 * Run `action` and put back the pre-existing pnpm workspace state file.
 * `pnpm deploy --prod --config.node-linker=hoisted` writes `production: true`
 * into that file; the next `pnpm run` then executes `pnpm install --production`
 * and deletes workspace devDependencies such as `tsx`.
 * @param root - repository root that owns `node_modules`.
 * @param dryRun - skip filesystem writes.
 * @param logPrefix - log line prefix.
 * @param action - typically `pnpm deploy`.
 * @returns when `action` settles; always restores the snapshot.
 */
export async function preservePnpmWorkspaceState(
  root: string,
  dryRun: boolean,
  logPrefix: string,
  action: () => Promise<void>,
): Promise<void> {
  const path = join(root, PNPM_WORKSPACE_STATE)
  const snapshot = existsSync(path) ? await readFile(path) : undefined
  try {
    await action()
  } finally {
    if (dryRun) return
    if (snapshot === undefined) {
      await rm(path, { force: true })
      return
    }
    await writeFile(path, snapshot)
    console.log(`${logPrefix}: restored ${PNPM_WORKSPACE_STATE}`)
  }
}

/**
 * Run one subprocess with inherited stdio. Spawn and non-zero-exit errors include
 * the command; dry runs only print it.
 * @param options - cwd (defaults to `root`), dry-run, and log prefix.
 * @param label - the step name used in logs and error messages.
 * @param command - the executable.
 * @param args - its arguments.
 */
export async function runLogged(
  options: { root: string; dryRun: boolean; logPrefix: string; cwd?: string },
  label: string,
  command: string,
  args: readonly string[],
): Promise<void> {
  const printable = formatCommand(command, args)
  if (options.dryRun) {
    console.log(`${options.logPrefix}: [dry-run] ${printable}`)
    return
  }
  console.log(`${options.logPrefix}: ${label}: ${printable}`)
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? options.root,
      stdio: 'inherit',
    })
    child.once('error', (error) => {
      reject(new Error(`${options.logPrefix}: ${label} failed to spawn: ${error.message} (${printable})`))
    })
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
      reject(new Error(`${options.logPrefix}: ${label} failed (${cause}): ${printable}`))
    })
  })
}

/**
 * Return the first symbolic link below a directory, if one exists.
 * @param directory - absolute directory to walk.
 * @returns the first symlink path, or undefined.
 */
export async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Replace deploy-time package links with files and reject any remaining link.
 * @param nodeModules - staged `node_modules` directory.
 * @param dryRun - print only.
 * @param logPrefix - log line prefix.
 */
export async function materializeStagedLinks(
  nodeModules: string,
  dryRun: boolean,
  logPrefix: string,
): Promise<void> {
  if (dryRun) {
    console.log(`${logPrefix}: [dry-run] materialize staged package links`)
    return
  }
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const segments = remaining.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
      remaining = await findSymlink(nodeModules)
      continue
    }
    const destination = remaining
    const source = await realpath(destination)
    const nestedNodeModules = join(source, 'node_modules')
    await rm(destination, { recursive: true, force: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    remaining = await findSymlink(nodeModules)
  }
  const leftover = await findSymlink(nodeModules)
  if (leftover !== undefined) {
    throw new Error(`${logPrefix}: staged tree still contains a symlink after materialization: ${leftover}`)
  }
}

/**
 * Restore direct packages that pnpm's legacy hoister places beside the deploy
 * source instead of in the target. The runtime manifest supplies every peer,
 * so package-local node_modules trees are omitted to preserve one flat Cordis
 * instance and a symlink-free packaged payload.
 * @param staging - deploy target directory.
 * @param sourceNodeModules - deploy-root `node_modules`.
 * @param dryRun - print only.
 * @param logPrefix - log line prefix.
 */
async function restoreLegacyHoists(
  staging: string,
  sourceNodeModules: string,
  dryRun: boolean,
  logPrefix: string,
): Promise<void> {
  if (dryRun) {
    console.log(`${logPrefix}: [dry-run] restore direct dependencies omitted by legacy deploy`)
    return
  }
  const manifestPath = join(staging, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const restored: string[] = []
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    const destination = join(staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceNodeModules, dependency)
    if (!existsSync(source)) {
      throw new Error(
        `${logPrefix}: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
      )
    }
    await mkdir(dirname(destination), { recursive: true })
    const nestedNodeModules = join(source, 'node_modules')
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    restored.push(dependency)
  }
  const stillMissing = Object.keys(manifest.dependencies ?? {})
    .filter(dependency => !existsSync(join(staging, 'node_modules', dependency)))
  if (stillMissing.length > 0) {
    throw new Error(`${logPrefix}: staged dependencies remain missing: ${stillMissing.join(', ')}.`)
  }
  if (restored.length > 0) {
    console.log(`${logPrefix}: restored legacy deploy hoists: ${restored.join(', ')}`)
  }
}

/**
 * Clear `staging`, run the measured pnpm deploy, restore legacy hoists, and
 * replace remaining package links with files.
 * @param options - deploy identity and destinations.
 */
export async function stageRuntimeClosure(options: StageRuntimeClosureOptions): Promise<void> {
  const dryRun = options.dryRun === true
  const prefix = options.logPrefix
  const staging = resolve(options.staging)
  const root = resolve(options.root)
  if (staging === root || root.startsWith(staging + sep)) {
    throw new Error(`${prefix}: refusing to clear staging dir ${staging}: it contains the repo root.`)
  }
  if (dryRun) console.log(`${prefix}: [dry-run] rm -rf ${staging}`)
  else await rm(staging, { recursive: true, force: true })
  await preservePnpmWorkspaceState(root, dryRun, prefix, async () => {
    await runLogged(
      { root, dryRun, logPrefix: prefix },
      'deploy',
      pnpmBin(),
      [
        '--filter',
        options.filter,
        'deploy',
        ...MEASURED_PNPM_DEPLOY_FLAGS,
        '--config.confirmModulesPurge=false',
        staging,
      ],
    )
  })
  await restoreLegacyHoists(staging, resolve(options.sourceNodeModules), dryRun, prefix)
  await materializeStagedLinks(join(staging, 'node_modules'), dryRun, prefix)
  const docs = options.docsToRemove ?? []
  if (dryRun) {
    for (const name of docs) console.log(`${prefix}: [dry-run] rm -f ${join(staging, name)}`)
    return
  }
  await Promise.all(docs.map(name => rm(join(staging, name), { force: true })))
  const leftover = await findSymlink(staging)
  if (leftover !== undefined) {
    throw new Error(`${prefix}: measured staged tree is not symlink-free: ${leftover}`)
  }
  console.log(`${prefix}: staged tree is symlink-free`)
}
