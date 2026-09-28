/** In-app authorization window: allow-listed origins, callback intercept, loopback forward. */
import { BrowserWindow, session as electronSession, type BrowserWindowConstructorOptions } from 'electron'
import type { DesktopInAppAuthConfig } from './product-config.ts'

/** Fetch used by the main process to hand the callback query to Host. */
export type InAppAuthFetch = (input: string, init?: RequestInit) => Promise<unknown>

/** Window factory so tests can supply a fake BrowserWindow. */
export type InAppAuthWindowFactory = (options: BrowserWindowConstructorOptions) => BrowserWindow

/**
 * Whether `authorizeUrl` should open in an embedded window.
 * @param authorizeUrl - Account attempt URL.
 * @param config - Build-time allow-list.
 */
export function authorizeUrlUsesInAppWindow(authorizeUrl: string, config: DesktopInAppAuthConfig): boolean {
  try {
    const origin = new URL(authorizeUrl).origin
    return config.origins.includes(origin)
  } catch {
    return false
  }
}

/**
 * Whether a navigation target is the callback the Host should receive.
 * @param url - Navigation or redirect URL.
 * @param config - Build-time allow-list.
 */
export function isInAppAuthCallback(url: string, config: DesktopInAppAuthConfig): boolean {
  return url.startsWith(config.callbackPrefix)
}

/**
 * Build the Host loopback request. Only the original query string is forwarded.
 * @param hostUrl - Desktop Host origin (any hostname; the request always uses 127.0.0.1).
 * @param forwardPath - Absolute pathname from the allow-list.
 * @param callbackUrl - Captured callback URL.
 */
export function inAppAuthForwardUrl(hostUrl: string, forwardPath: string, callbackUrl: string): string {
  const host = new URL(hostUrl)
  const port = host.port === '' ? (host.protocol === 'https:' ? '443' : '80') : host.port
  const query = new URL(callbackUrl).search
  return `http://127.0.0.1:${port}${forwardPath}${query}`
}

/** Isolated session partition prefix; each attempt gets its own suffix. */
export const IN_APP_AUTH_PARTITION_PREFIX = 'dsh-in-app-auth:'

/**
 * BrowserWindow options for the authorization guest. No preload, sandboxed, isolated session.
 * @param parent - Welcome or main window.
 * @param partition - Unique session partition for this attempt.
 */
export function inAppAuthWindowOptions(parent: BrowserWindow, partition: string): BrowserWindowConstructorOptions {
  return {
    parent,
    modal: true,
    width: 520,
    height: 680,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      session: electronSession.fromPartition(partition, { cache: false }),
    },
  }
}

export interface OpenInAppAuthWindowOptions {
  readonly parent: BrowserWindow
  readonly authorizeUrl: string
  readonly attemptId: string
  readonly hostUrl: string
  readonly config: DesktopInAppAuthConfig
  readonly fetch: InAppAuthFetch
  readonly onCancel: () => void
  readonly createWindow?: InAppAuthWindowFactory
}

/**
 * Open a sandboxed guest for an allow-listed authorization URL. Matching callback
 * navigations are cancelled, the original query is forwarded to Host, then the window
 * closes. User close cancels the attempt. New windows are refused.
 * @param options - Parent window, URLs, Host forward, and cancel callback.
 * @returns Disposer that closes the guest without cancelling (after a successful forward).
 */
export function openInAppAuthWindow(options: OpenInAppAuthWindowOptions): { close: () => void } {
  const create = options.createWindow ?? (opts => new BrowserWindow(opts))
  const partition = `${IN_APP_AUTH_PARTITION_PREFIX}${options.attemptId}`
  const window = create(inAppAuthWindowOptions(options.parent, partition))
  let settled = false
  const closeWithoutCancel = (): void => {
    settled = true
    if (!window.isDestroyed()) window.close()
  }
  const intercept = (url: string, preventDefault: () => void): boolean => {
    if (!isInAppAuthCallback(url, options.config)) return false
    preventDefault()
    if (settled) return true
    settled = true
    const target = inAppAuthForwardUrl(options.hostUrl, options.config.forwardPath, url)
    void Promise.resolve(options.fetch(target, { method: 'GET' })).catch(() => undefined)
      .finally(() => { if (!window.isDestroyed()) window.close() })
    return true
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-redirect', (event, url) => { intercept(url, () => { event.preventDefault() }) })
  window.webContents.on('will-navigate', (event, url) => { intercept(url, () => { event.preventDefault() }) })
  window.webContents.on('did-navigate', (_event, url) => {
    intercept(url, () => {
      if (!window.isDestroyed()) void window.webContents.stop()
    })
  })
  window.on('closed', () => { if (!settled) options.onCancel() })
  void window.loadURL(options.authorizeUrl).catch(() => {
    if (!settled && !window.isDestroyed()) window.close()
  })
  return { close: closeWithoutCancel }
}
