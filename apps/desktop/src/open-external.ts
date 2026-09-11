/**
 * Open an https: URL with the OS default browser. Other schemes are refused.
 */

export type OpenExternalResult = { ok: true } | { ok: false; detail: string }

/**
 * @param url - candidate URL
 * @param openExternal - Electron `shell.openExternal`
 */
export async function openHttpsExternal(
  url: string,
  openExternal: (target: string) => Promise<void>,
): Promise<OpenExternalResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, detail: 'invalid url' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, detail: 'only https:' }
  }
  try {
    await openExternal(parsed.toString())
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true }
}
