/**
 * Generic auth window: open any URL, return when navigation hits a caller-supplied
 * prefix, or when the user closes / the timeout fires. No product-specific URLs
 * or field names live here — callers pass them in.
 */

export interface OpenAuthWindowOptions {
  url: string
  callbackUrlPrefix: string
  width?: number
  height?: number
  timeoutMs?: number
}

export type OpenAuthWindowResult = { callbackUrl: string } | { canceled: true }

export interface AuthWebContents {
  on(event: 'will-redirect' | 'will-navigate' | 'did-navigate' | 'did-navigate-in-page', listener: (event: unknown, url: string) => void): void
  on(event: 'did-create-window', listener: (child: AuthWindowHandle) => void): void
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void
}

export interface AuthWindowHandle {
  loadURL(url: string): Promise<void>
  close(): void
  isDestroyed(): boolean
  on(event: 'closed', listener: () => void): void
  webContents: AuthWebContents
}

export interface AuthWindowFactory {
  create(size: { width: number; height: number }): AuthWindowHandle
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export function matchesCallbackPrefix(url: string, prefix: string): boolean {
  return prefix.length > 0 && url.startsWith(prefix)
}

export async function openAuthWindow(
  options: OpenAuthWindowOptions,
  factory: AuthWindowFactory,
): Promise<OpenAuthWindowResult> {
  const width = options.width ?? 520
  const height = options.height ?? 680
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const win = factory.create({ width, height })

  return await new Promise((resolve) => {
    let settled = false
    const extraWindows: AuthWindowHandle[] = []
    const finish = (result: OpenAuthWindowResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
      for (const extra of extraWindows) {
        if (!extra.isDestroyed()) extra.close()
      }
      if (!win.isDestroyed()) win.close()
    }

    const timer = setTimeout(() => {
      finish({ canceled: true })
    }, timeoutMs)

    const tryCapture = (url: string): boolean => {
      if (!matchesCallbackPrefix(url, options.callbackUrlPrefix)) return false
      finish({ callbackUrl: url })
      return true
    }

    const attach = (wc: AuthWebContents): void => {
      wc.on('will-redirect', (_event, url) => { tryCapture(url) })
      wc.on('will-navigate', (_event, url) => { tryCapture(url) })
      wc.on('did-navigate', (_event, url) => { tryCapture(url) })
      wc.on('did-navigate-in-page', (_event, url) => { tryCapture(url) })
      wc.setWindowOpenHandler(({ url }) => {
        if (tryCapture(url)) return { action: 'deny' }
        return { action: 'allow' }
      })
      wc.on('did-create-window', (child) => {
        extraWindows.push(child)
        attach(child.webContents)
      })
    }

    attach(win.webContents)
    win.on('closed', () => {
      finish({ canceled: true })
    })
    void win.loadURL(options.url).catch(() => {
      finish({ canceled: true })
    })
  })
}
