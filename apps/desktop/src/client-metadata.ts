/** Desktop client identity for Platform account calls and mandatory-update policy. */
import type { AccountClientMetadata } from '@deepseek-ai/dsh-deepseek-account/types'
import { DESKTOP_PRODUCT_VERSION_ENV } from './product-config.ts'

/**
 * Read the client build version inlined by the Desktop build.
 * @returns the version embedded in this application build.
 * @throws Error when the build carries no client version, instead of reporting a guessed one.
 */
export function desktopClientVersion(): string {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined || version === '') {
    throw new Error('desktop account: this application build carries no DSH_CLIENT_VERSION')
  }
  return version
}

function productVersionOverlay(env: NodeJS.ProcessEnv): string | undefined {
  const value = env[DESKTOP_PRODUCT_VERSION_ENV]?.trim()
  return value === undefined || value === '' ? undefined : value
}

/**
 * Version sent on mandatory-update policy requests.
 * `DSH_DESKTOP_PRODUCT_VERSION` uses that published version (packaged builds
 * hydrate it from extraMetadata.version, so a live process env cannot change it).
 * Unset, this is the inlined client build version.
 * @param env - Process environment; packaged callers pass the hydrated env.
 * @returns the version the policy service should compare.
 */
export function desktopPolicyClientVersion(env: NodeJS.ProcessEnv = process.env): string {
  return productVersionOverlay(env) ?? desktopClientVersion()
}

/**
 * Sample the Desktop client identity for one Platform request.
 * @param locale - current resolved Desktop language.
 * @returns this call's build version, the raw active language, and the UTC offset in whole seconds east.
 */
export function desktopClientMetadata(locale: string): AccountClientMetadata {
  return {
    version: desktopClientVersion(),
    locale,
    // Date.getTimezoneOffset reports minutes west of UTC; Platform wants seconds east.
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/**
 * Sample Desktop identity for one mandatory-update policy request.
 * Locale and timezone match `desktopClientMetadata`; version follows `desktopPolicyClientVersion`.
 * @param locale - current resolved Desktop language.
 * @param env - Process environment; packaged callers pass the hydrated env.
 */
export function desktopPolicyClientMetadata(
  locale: string,
  env: NodeJS.ProcessEnv = process.env,
): AccountClientMetadata {
  return { ...desktopClientMetadata(locale), version: desktopPolicyClientVersion(env) }
}
