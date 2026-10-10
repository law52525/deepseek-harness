/** Host-owned, explicitly authorized control of one Work content window. */
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'

export interface RemoteWindowDependencies {
  account(): Promise<string | undefined>
  getWindow(): BrowserWindow | undefined
  confirm(window: BrowserWindow, seconds: number): Promise<boolean>
  indicator(stop: () => void, until: number): () => void
  now?: () => number
}
type Binding = {
  account: string
  window: BrowserWindow
  id: string
  generation: string
  until: number
  heartbeat: number
  sequence: number
  frames?: { id: string; width: number; height: number; zoom: number; at: number }[]
  off: () => void
}
/** Never exposes native window references to its caller. */
export class RemoteWindowController {
  private binding: Binding | undefined
  private revision = 0
  private pending = false
  private locked = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly now: () => number
  constructor(private readonly deps: RemoteWindowDependencies) { this.now = deps.now ?? Date.now }
  /** End authorization, including any pending confirmation. */
  close(): void { this.revision++; const b = this.binding; this.binding = undefined; b?.off() }
  /** Called by the shell on lock/suspend; unlock never restores a grant. */
  setLocked(value: boolean): void { this.locked = value; if (value) this.close() }
  /** Sweep heartbeat even when there are no remote requests. */
  sweep(): void { if (this.binding && (this.now() >= this.binding.until || this.now() - this.binding.heartbeat > 10_000)) this.close() }
  private check(id: unknown): Binding {
    this.sweep(); const b = this.binding
    if (!b || b.id !== id || this.locked) throw new Error('UNAUTHORIZED')
    if (b.window !== this.deps.getWindow() || b.window.isDestroyed() || b.window.webContents.isDestroyed() || !b.window.webContents.getURL().startsWith('dsh-app://app/')) { this.close(); throw new Error('WINDOW_CHANGED') }
    return b
  }
  private async authorized(id: unknown): Promise<Binding> {
    const b = this.check(id), account = await this.deps.account()
    if (this.binding !== b) throw new Error('UNAUTHORIZED')
    if (!account || account !== b.account) { this.close(); throw new Error('ACCOUNT_CHANGED') }
    return this.check(id)
  }
  /** Open only after a fresh shell-owned confirmation, never from a boolean flag. */
  async open(seconds: unknown): Promise<object> {
    if (this.pending || this.locked || !Number.isSafeInteger(seconds) || (seconds as number) < 60 || (seconds as number) > 28_800) throw new Error('INVALID_AUTHORIZATION')
    this.close(); const revision = this.revision; const window = this.deps.getWindow()
    if (!window || window.isDestroyed()) throw new Error('UNAVAILABLE')
    this.pending = true
    try {
      const account = await this.deps.account()
      if (!account) throw new Error('ACCOUNT_UNAVAILABLE')
      if (!await this.deps.confirm(window, seconds as number)) throw new Error('CONSENT_REQUIRED')
      if (revision !== this.revision || window !== this.deps.getWindow() || window.isDestroyed() || this.locked) throw new Error('WINDOW_CHANGED')
      if (await this.deps.account() !== account) throw new Error('ACCOUNT_CHANGED')
      if (revision !== this.revision || window !== this.deps.getWindow() || window.isDestroyed() || this.locked) throw new Error('WINDOW_CHANGED')
      const until = this.now() + (seconds as number) * 1000
      const b: Binding = {
        account, window, id: randomUUID(), generation: randomUUID(),
        until, heartbeat: this.now(), sequence: 0, off: () => {},
      }
      this.binding = b
      const stop = (): void => { this.close() }
      window.once('closed', stop)
      const stopIndicator = this.deps.indicator(stop, until)
      b.off = () => { window.removeListener('closed', stop); stopIndicator() }
      this.check(b.id)
      return { controlId: b.id, windowGeneration: b.generation, until }
    } finally { this.pending = false }
  }
  /** Liveness refresh; authorized child must stop this on logout or transport loss. */
  async status(id: unknown): Promise<object> {
    const b = await this.authorized(id)
    b.heartbeat = this.now()
    return { active: true, until: b.until, windowGeneration: b.generation, lastInputSequence: b.sequence }
  }
  /** Capture only the bound webContents; delayed output is discarded after revocation. */
  async capture(id: unknown): Promise<object> {
    const b = await this.authorized(id), [width, height] = b.window.getContentSize(), zoom = b.window.webContents.getZoomFactor()
    const picture = await b.window.webContents.capturePage()
    if (await this.authorized(id) !== b) throw new Error('WINDOW_CHANGED')
    const [newWidth, newHeight] = b.window.getContentSize()
    if (width !== newWidth || height !== newHeight || zoom !== b.window.webContents.getZoomFactor()) throw new Error('STALE_FRAME')
    const bytes = picture.toJPEG(65)
    if (bytes.length > 2_000_000) throw new Error('FRAME_TOO_LARGE')
    if (width === undefined || height === undefined || width <= 0 || height <= 0) throw new Error('INVALID_VIEWPORT')
    const frame = { id: randomUUID(), width, height, zoom, at: this.now() }
    b.frames = [...(b.frames ?? []).filter(f => this.now() - f.at <= 3000), frame].slice(-4)
    const size = picture.getSize()
    return { frameId: frame.id, windowGeneration: b.generation, viewportWidth: width, viewportHeight: height, pixelWidth: size.width, pixelHeight: size.height, DPR: size.width / width, capturedAt: frame.at, mime: 'image/jpeg', data: bytes.toString('base64') }
  }
  /** Serialize, validate against a recent frame, and consume before native execution. */
  input(id: unknown, q: Record<string, unknown>): Promise<object> {
    const execute = async (): Promise<object> => {
      const b = await this.authorized(id), f = b.frames?.find(frame => frame.id === q.frameId)
      const wc = b.window.webContents, [width, height] = b.window.getContentSize()
      if (!f || q.frameId !== f.id || q.windowGeneration !== b.generation || this.now() - f.at > 3000 || width !== f.width || height !== f.height || wc.getZoomFactor() !== f.zoom) throw new Error('STALE_FRAME')
      if (!Number.isSafeInteger(q.sequence) || q.sequence !== b.sequence + 1) throw new Error('OUT_OF_ORDER')
      if (!b.window.isFocused()) throw new Error('WINDOW_NOT_FOCUSED')
      const keyMap: Record<string, string> = { Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab', Escape: 'Escape', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }
      if (q.type === 'text') { if (typeof q.text !== 'string' || !q.text.length || q.text.length > 4096) throw new Error('INVALID_INPUT') }
      else if (q.type === 'key') { if (typeof q.key !== 'string' || !Object.hasOwn(keyMap, q.key)) throw new Error('INVALID_INPUT') }
      else if (q.type === 'click' || q.type === 'scroll') {
        if (typeof q.x !== 'number' || typeof q.y !== 'number' || !Number.isFinite(q.x) || !Number.isFinite(q.y) || q.x < 0 || q.x >= 1 || q.y < 0 || q.y >= 1) throw new Error('INVALID_INPUT')
        if (q.type === 'scroll' && (!Number.isSafeInteger(q.dy) || Math.abs(q.dy as number) > 1200)) throw new Error('INVALID_INPUT')
      } else throw new Error('INVALID_INPUT')
      b.sequence = q.sequence as number
      try {
        if (q.type === 'text') await wc.insertText(q.text as string)
        else if (q.type === 'key') {
          const keyCode = keyMap[q.key as string]
          if (keyCode === undefined) throw new Error('INVALID_INPUT')
          wc.sendInputEvent({ type: 'keyDown', keyCode }); wc.sendInputEvent({ type: 'keyUp', keyCode })
        }
        else { const x = Math.floor((q.x as number) * width), y = Math.floor((q.y as number) * height)
          if (q.type === 'click') { wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }) }
          else wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: q.dy as number })
        }
        if (await this.authorized(id) !== b) throw new Error('WINDOW_CHANGED')
        return { acknowledgedSequence: b.sequence }
      } catch { if (this.binding === b) this.close(); throw new Error('EXECUTION_UNKNOWN') }
    }
    const result = this.queue.then(execute, execute); this.queue = result.catch(() => {}); return result
  }
  /** Dispatch a bounded set of owned-host operations. */
  async request(q: Record<string, unknown>): Promise<object> {
    switch (q.action) {
      case 'capabilities': return { version: 1, available: true, mode: 'work-window', authorization: 'native-confirmation-required' }
      case 'open': return this.open(q.seconds)
      case 'status': return this.status(q.controlId)
      case 'capture': return this.capture(q.controlId)
      case 'input': return this.input(q.controlId, q)
      case 'close': if (this.binding) this.check(q.controlId); this.close(); return { closed: true }
      default: throw new Error('INVALID_ACTION')
    }
  }
}
