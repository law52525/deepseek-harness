/**
 * Keep developer `.env` credentials out of desktop extraResources.
 * Filename and assignment-line checks are independent of the builder env;
 * env-value checks catch a copied secret whose name is not on an assignment line.
 */

import { lstat, readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const LOG = 'build-desktop-installer'
/** Assignment lines that would ship a real credential if copied from a developer `.env`. */
const SECRET_ASSIGNMENT = /^(?:DEEPSEEK_API_KEY|APPLE_APP_SPECIFIC_PASSWORD|APPLE_ID|CSC_KEY_PASSWORD|CSC_LINK)=(\S+)/
const SECRET_ENV_KEYS = [
  'DEEPSEEK_API_KEY',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_ID',
  'CSC_KEY_PASSWORD',
  'CSC_LINK',
] as const
const SIGNING_KEY = /^(APPLE_|CSC_)/
/** Skip Mach-O / Node binaries; credential files are small text. */
const MAX_TEXT_BYTES = 1_048_576

/**
 * Parse only `APPLE_*` / `CSC_*` assignments from a dotenv body.
 * Other keys such as `DEEPSEEK_API_KEY` are ignored.
 * @param contents - file text.
 * @returns signing keys present in the file.
 */
export function parseSigningEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const hash = rawLine.indexOf('#')
    const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim()
    if (line === '' || !SIGNING_KEY.test(line)) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

/**
 * Copy parsed signing keys into `target` when the key is unset or empty.
 * @param target - usually `process.env`.
 * @param parsed - keys from a gitignored dotenv file.
 */
export function applySigningEnv(target: NodeJS.ProcessEnv, parsed: Record<string, string>): void {
  for (const [key, value] of Object.entries(parsed)) {
    const current = target[key]
    if (current === undefined || current === '') target[key] = value
  }
}

/**
 * True when a basename is a dotenv file that must never be an extraResource.
 * @param name - file basename.
 * @returns whether packaging must fail.
 */
export function isDotenvBasename(name: string): boolean {
  return name === '.env' || name.startsWith('.env.')
}

/**
 * Secret values from the builder environment that must not appear in staged files.
 * Short or empty values are skipped so a public team id cannot false-positive.
 * @param env - builder environment.
 * @returns values of at least 8 characters.
 */
export function leakableSecretValues(env: NodeJS.ProcessEnv): string[] {
  const values: string[] = []
  for (const key of SECRET_ENV_KEYS) {
    const value = env[key]
    if (value !== undefined && value.length >= 8) values.push(value)
  }
  return values
}

/**
 * Fail when `text` is a credential assignment or contains a builder secret value.
 * Mentions of the variable name in documentation are allowed.
 * @param text - UTF-8 file contents.
 * @param secretValues - `leakableSecretValues` result.
 * @returns a reason, or undefined when clean.
 */
export function credentialLeakInText(text: string, secretValues: readonly string[]): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = SECRET_ASSIGNMENT.exec(line.trim())
    if (match !== null && match[1] !== undefined && match[1].length >= 8) {
      return `credential assignment ${match[0].slice(0, match[0].indexOf('=') + 1)}`
    }
  }
  for (const value of secretValues) {
    if (text.includes(value)) return 'builder secret value'
  }
  return undefined
}

/**
 * Walk extraResources and fail on dotenv filenames or credential contents.
 * @param staging - `apps/desktop/stage` or an unpacked Resources directory.
 * @param env - builder environment for value-leak checks.
 */
export async function assertStagingHasNoSecrets(
  staging: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const secretValues = leakableSecretValues(env)
  const leaked = await findSecretLeak(staging, secretValues)
  if (leaked !== undefined) {
    throw new Error(`${LOG}: extraResources must not contain developer secrets (${leaked})`)
  }
}

async function findSecretLeak(
  directory: string,
  secretValues: readonly string[],
): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findSecretLeak(path, secretValues)
      if (nested !== undefined) return nested
      continue
    }
    if (entry.isSymbolicLink()) continue
    if (!entry.isFile()) continue
    if (isDotenvBasename(entry.name)) return `dotenv file ${path}`
    const metadata = await lstat(path)
    if (metadata.size === 0 || metadata.size > MAX_TEXT_BYTES) continue
    let text: string
    try {
      const bytes = await readFile(path)
      if (bytes.includes(0)) continue
      text = bytes.toString('utf8')
    } catch {
      continue
    }
    const reason = credentialLeakInText(text, secretValues)
    if (reason !== undefined) return `${reason} in ${basename(path)}`
  }
  return undefined
}
