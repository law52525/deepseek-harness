/**
 * Generic blocking overlay for the Electron shell.
 *
 * Dismissal is a whitelist, not a blacklist of exits (D-08 §3.4 / §3.8).
 * The fallback window may be closed only from this module, and only after
 * disarm(reason) with reason ∈ { 'update-install', 'host-dead', 'gate-satisfied' }.
 */

export const DEFAULT_BLOCKING_OVERLAY_TIMEOUT_MS = 10_000

export const DISARM_REASONS = ['update-install', 'host-dead', 'gate-satisfied'] as const
export type DisarmReason = (typeof DISARM_REASONS)[number]

/** After these, the overlay is terminal: later arm() is ignored. Only host-dead. */
export const TERMINAL_DISARM_REASONS = ['host-dead'] as const
export type TerminalDisarmReason = (typeof TERMINAL_DISARM_REASONS)[number]

export type OverlayPhase = 'idle' | 'armed' | 'disarmed'

export interface BlockingCloseEvent {
  preventDefault(): void
}

export interface BlockingOverlayWindow {
  close(): void
  isDestroyed(): boolean
  on(event: 'close', listener: (event: BlockingCloseEvent) => void): void
  loadURL?(url: string): Promise<void>
  setParentWindow?(parent: unknown): void
}

export interface BlockingOverlayFactory {
  create(opts: { title: string; body: string }): BlockingOverlayWindow
}

export interface BlockingOverlayTimers {
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

export interface ArmBlockingOverlayOptions {
  id: string
  timeoutMs: number
  title: string
  body: string
  failedInstallTitle?: string
  failedInstallBody?: string
}

function isDisarmReason(value: string): value is DisarmReason {
  return (DISARM_REASONS as readonly string[]).includes(value)
}

export function isTerminalDisarmReason(value: string): value is TerminalDisarmReason {
  return (TERMINAL_DISARM_REASONS as readonly string[]).includes(value)
}

/**
 * While armed, every in-app lifecycle request is denied.
 * OS-level exits are out of scope (D-08 §3.8).
 */
export function allowLifecycleRequest(armed: boolean): boolean {
  return !armed
}

export function shouldBlockAppQuit(armed: boolean): boolean {
  return armed
}

/** Overlay / armed main window: deny every keyDown. No per-key blacklist. */
export function shouldBlockShortcut(input: { type: string }): boolean {
  return input.type === 'keyDown'
}

export function shouldRespawnHostOnActivate(hostFailed: boolean): boolean {
  return !hostFailed
}

export function shouldQuitWhenLastWindowClosed(hostFailed: boolean, platform: string): boolean {
  return hostFailed || platform !== 'darwin'
}

export function shouldAllowRendererNavigation(armed: boolean, hostFailed: boolean): boolean {
  return !armed && !hostFailed
}

export class BlockingOverlayController {
  private timer: ReturnType<typeof setTimeout> | undefined
  private fallback: BlockingOverlayWindow | undefined
  private armedId: string | undefined
  private dismissed = true
  /** idle → armed → disarmed(reason). Terminal reasons never leave disarmed. */
  private phase: OverlayPhase = 'idle'
  private lastDisarmReason: DisarmReason | undefined
  /** Only closeFallback may set this; callers outside this file must not close the window. */
  private programmaticClose = false
  private pluginRendered = false
  private failedInstallTitle: string | undefined
  private failedInstallBody: string | undefined
  fallbackShown = false
  /** How many arm() calls were dropped because the overlay is already terminal. */
  ignoredArmCount = 0

  constructor(
    private readonly factory: BlockingOverlayFactory,
    private readonly timers: BlockingOverlayTimers = { setTimeout, clearTimeout },
    private readonly onArmedChange?: (armed: boolean) => void,
  ) {}

  arm(opts: ArmBlockingOverlayOptions): void {
    if (this.terminal) {
      this.ignoredArmCount += 1
      console.warn(
        `[desktop] blocking-overlay: ignoring arm after terminal disarm (${this.lastDisarmReason ?? ''})`,
      )
      return
    }
    this.reset()
    this.dismissed = false
    this.pluginRendered = false
    this.lastDisarmReason = undefined
    this.phase = 'armed'
    this.armedId = opts.id
    if (opts.failedInstallTitle !== undefined && opts.failedInstallBody !== undefined) {
      this.failedInstallTitle = opts.failedInstallTitle
      this.failedInstallBody = opts.failedInstallBody
    }
    const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_BLOCKING_OVERLAY_TIMEOUT_MS
    this.timer = this.timers.setTimeout(() => {
      this.showFallback(opts.title, opts.body)
    }, timeoutMs)
    this.notifyArmed()
  }

  markRendered(id: string): void {
    if (this.armedId !== id) return
    this.pluginRendered = true
    this.clearTimer()
    this.closeFallback()
  }

  /**
   * Sole public way to lift the overlay. `reason` is the whitelist;
   * anything else throws. Optional `id` must match the current arm.
   */
  disarm(reason: string, id?: string): void {
    if (!isDisarmReason(reason)) {
      throw new Error(`blocking-overlay: unknown disarm reason ${String(reason)}`)
    }
    if (this.terminal) return
    if (id !== undefined && this.armedId !== undefined && id !== this.armedId) return
    this.dismissed = true
    this.lastDisarmReason = reason
    this.phase = 'disarmed'
    this.reset()
    this.notifyArmed()
  }

  tryClose(event: BlockingCloseEvent): boolean {
    if (this.programmaticClose || this.dismissed) return true
    event.preventDefault()
    return false
  }

  get armed(): boolean {
    return this.phase === 'armed'
  }

  get terminal(): boolean {
    return this.phase === 'disarmed' && this.lastDisarmReason !== undefined
      && isTerminalDisarmReason(this.lastDisarmReason)
  }

  /** Copy the caller supplied for a failed quitAndInstall re-arm. Survives disarm. */
  get failedInstallOverlay(): { title: string; body: string } | undefined {
    if (this.failedInstallTitle === undefined || this.failedInstallBody === undefined) return undefined
    return { title: this.failedInstallTitle, body: this.failedInstallBody }
  }

  attachParent(parent: unknown): void {
    const win = this.fallback
    if (win === undefined || win.isDestroyed()) return
    win.setParentWindow?.(parent)
  }

  private showFallback(title: string, body: string): void {
    if (this.dismissed || this.pluginRendered || this.fallbackShown) return
    this.fallbackShown = true
    const win = this.factory.create({ title, body })
    this.fallback = win
    win.on('close', (event) => {
      this.tryClose(event)
    })
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    this.timers.clearTimeout(this.timer)
    this.timer = undefined
  }

  private closeFallback(): void {
    const win = this.fallback
    this.fallback = undefined
    this.fallbackShown = false
    if (win === undefined || win.isDestroyed()) return
    this.programmaticClose = true
    try {
      win.close()
    } finally {
      this.programmaticClose = false
    }
  }

  private notifyArmed(): void {
    this.onArmedChange?.(this.armed)
  }

  private reset(): void {
    this.clearTimer()
    this.closeFallback()
    this.armedId = undefined
    this.pluginRendered = false
  }
}

export function overlayDataUrl(title: string, body: string): string {
  const escapedTitle = escapeHtml(title)
  const escapedBody = escapeHtml(body)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapedTitle}</title>
<style>html,body{margin:0;height:100%;font:16px/1.5 system-ui,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center}
main{max-width:36rem;padding:2rem;text-align:center}h1{font-size:1.4rem}</style></head>
<body><main><h1>${escapedTitle}</h1><p>${escapedBody}</p></main></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    if (ch === '"') return '&quot;'
    return '&#39;'
  })
}
