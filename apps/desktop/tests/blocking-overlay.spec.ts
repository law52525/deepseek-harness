import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  BlockingOverlayController,
  overlayDataUrl,
  allowLifecycleRequest,
  shouldBlockAppQuit,
  shouldBlockShortcut,
  shouldQuitWhenLastWindowClosed,
  shouldRespawnHostOnActivate,
  shouldAllowRendererNavigation,
  type BlockingOverlayWindow,
} from '../src/blocking-overlay.ts'

class FakeWindow extends EventEmitter implements BlockingOverlayWindow {
  destroyed = false
  closeCalls = 0
  close(): void {
    this.closeCalls += 1
    const event = {
      prevented: false,
      preventDefault(): void {
        this.prevented = true
      },
    }
    this.emit('close', event)
    if (event.prevented) return
    this.destroyed = true
    this.emit('closed')
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

describe('blocking overlay controller', () => {
  it('shows a non-bypassable fallback when the plugin overlay never confirms', () => {
    vi.useFakeTimers()
    const created: FakeWindow[] = []
    const controller = new BlockingOverlayController({
      create: () => {
        const win = new FakeWindow()
        created.push(win)
        return win
      },
    })
    controller.arm({ id: 'g1', timeoutMs: 10_000, title: 'Update required', body: 'Please update' })
    expect(controller.fallbackShown).toBe(false)
    vi.advanceTimersByTime(9_999)
    expect(controller.fallbackShown).toBe(false)
    vi.advanceTimersByTime(1)
    expect(controller.fallbackShown).toBe(true)
    expect(created).toHaveLength(1)
    const prevented: boolean[] = []
    created[0]?.emit('close', { preventDefault: () => { prevented.push(true) } })
    expect(prevented).toEqual([true])
    vi.useRealTimers()
  })

  it('does not stack a fallback once the plugin overlay confirms rendered', () => {
    vi.useFakeTimers()
    const created: FakeWindow[] = []
    const controller = new BlockingOverlayController({
      create: () => {
        const win = new FakeWindow()
        created.push(win)
        return win
      },
    })
    controller.arm({ id: 'g1', timeoutMs: 10_000, title: 't', body: 'b' })
    controller.markRendered('g1')
    vi.advanceTimersByTime(20_000)
    expect(controller.fallbackShown).toBe(false)
    expect(created).toHaveLength(0)
    vi.useRealTimers()
  })

  it('closes an already-shown fallback when the plugin overlay later confirms', () => {
    vi.useFakeTimers()
    const created: FakeWindow[] = []
    const controller = new BlockingOverlayController({
      create: () => {
        const win = new FakeWindow()
        created.push(win)
        return win
      },
    })
    controller.arm({ id: 'g1', timeoutMs: 10, title: 't', body: 'b' })
    vi.advanceTimersByTime(10)
    expect(controller.fallbackShown).toBe(true)
    controller.markRendered('g1')
    expect(controller.fallbackShown).toBe(false)
    expect(created[0]?.destroyed).toBe(true)
    vi.useRealTimers()
  })

  it('disarm lets the window close (post-update restart path)', () => {
    vi.useFakeTimers()
    const created: FakeWindow[] = []
    const controller = new BlockingOverlayController({
      create: () => {
        const win = new FakeWindow()
        created.push(win)
        return win
      },
    })
    controller.arm({ id: 'g1', timeoutMs: 5, title: 't', body: 'b' })
    vi.advanceTimersByTime(5)
    controller.disarm('gate-satisfied', 'g1')
    expect(controller.fallbackShown).toBe(false)
    expect(controller.tryClose({ preventDefault: () => { throw new Error('should allow close') } })).toBe(true)
    vi.useRealTimers()
  })

  it('denies every keyDown including close and fullscreen shortcuts; keyUp is not a close path', () => {
    expect(shouldBlockShortcut({ type: 'keyDown' })).toBe(true)
    expect(shouldBlockShortcut({ type: 'keyUp' })).toBe(false)
  })

  it('blocks app quit while armed; only disarm lifts the default deny', () => {
    expect(shouldBlockAppQuit(true)).toBe(true)
    expect(allowLifecycleRequest(true)).toBe(false)
    expect(shouldBlockAppQuit(false)).toBe(false)
    expect(allowLifecycleRequest(false)).toBe(true)
    expect(shouldRespawnHostOnActivate(true)).toBe(false)
    expect(shouldQuitWhenLastWindowClosed(true, 'darwin')).toBe(true)
    expect(shouldAllowRendererNavigation(true, false)).toBe(false)
    expect(shouldAllowRendererNavigation(false, true)).toBe(false)
    expect(shouldAllowRendererNavigation(false, false)).toBe(true)
  })

  it('unknown disarm reason throws and leaves the overlay armed', () => {
    vi.useFakeTimers()
    const controller = new BlockingOverlayController({ create: () => new FakeWindow() })
    controller.arm({ id: 'g1', timeoutMs: 1, title: 't', body: 'b' })
    vi.advanceTimersByTime(1)
    expect(() => { controller.disarm('please-close') }).toThrow(/unknown disarm reason/)
    expect(controller.armed).toBe(true)
    const prevented: boolean[] = []
    expect(controller.tryClose({ preventDefault: () => { prevented.push(true) } })).toBe(false)
    expect(prevented).toEqual([true])
    vi.useRealTimers()
  })

  it('update-install is a whitelist reason and is not terminal', () => {
    vi.useFakeTimers()
    const created: FakeWindow[] = []
    const controller = new BlockingOverlayController({
      create: () => {
        const win = new FakeWindow()
        created.push(win)
        return win
      },
    })
    controller.arm({ id: 'g1', timeoutMs: 1, title: 't', body: 'b' })
    vi.advanceTimersByTime(1)
    expect(controller.tryClose({ preventDefault: () => {} })).toBe(false)
    controller.disarm('update-install')
    expect(controller.armed).toBe(false)
    expect(controller.terminal).toBe(false)
    expect(controller.tryClose({ preventDefault: () => { throw new Error('should allow') } })).toBe(true)
    controller.arm({ id: 'retry', timeoutMs: 1, title: 'failed', body: 'reinstall' })
    vi.advanceTimersByTime(1)
    expect(controller.armed).toBe(true)
    expect(controller.fallbackShown).toBe(true)
    expect(controller.ignoredArmCount).toBe(0)
    vi.useRealTimers()
  })

  it('gate-satisfied is not terminal; a later arm is accepted', () => {
    vi.useFakeTimers()
    const created: FakeWindow[] = []
    const controller = new BlockingOverlayController({
      create: () => {
        const win = new FakeWindow()
        created.push(win)
        return win
      },
    })
    controller.arm({ id: 'g1', timeoutMs: 1, title: 't', body: 'b' })
    vi.advanceTimersByTime(1)
    controller.disarm('gate-satisfied', 'g1')
    expect(controller.terminal).toBe(false)
    controller.arm({ id: 'g2', timeoutMs: 1, title: 't', body: 'b' })
    vi.advanceTimersByTime(1)
    expect(controller.armed).toBe(true)
    expect(controller.fallbackShown).toBe(true)
    expect(created).toHaveLength(2)
    vi.useRealTimers()
  })

  it('tears down fallback whenever overlay-rendered arrives, including after it was shown', () => {
    vi.useFakeTimers()
    const created: FakeWindow[] = []
    const controller = new BlockingOverlayController({
      create: () => {
        const win = new FakeWindow()
        created.push(win)
        return win
      },
    })
    controller.arm({ id: 'g1', timeoutMs: 10, title: 't', body: 'b' })
    vi.advanceTimersByTime(10)
    expect(controller.fallbackShown).toBe(true)
    controller.markRendered('g1')
    expect(controller.fallbackShown).toBe(false)
    expect(created[0]?.destroyed).toBe(true)
    controller.markRendered('g1')
    vi.advanceTimersByTime(20)
    expect(controller.fallbackShown).toBe(false)
    vi.useRealTimers()
  })

  it('reattaches a fallback created before the main window existed', () => {
    vi.useFakeTimers()
    const parents: unknown[] = []
    class ParentAwareWindow extends FakeWindow {
      setParentWindow(parent: unknown): void {
        parents.push(parent)
      }
    }
    const controller = new BlockingOverlayController({
      create: () => new ParentAwareWindow(),
    })
    controller.arm({ id: 'g1', timeoutMs: 1, title: 't', body: 'b' })
    vi.advanceTimersByTime(1)
    const parent = { id: 'main' }
    controller.attachParent(parent)
    expect(parents).toEqual([parent])
    vi.useRealTimers()
  })

  it('overlay HTML escapes caller-supplied copy', () => {
    const url = overlayDataUrl('<script>', 'a & b')
    expect(url).toContain('data:text/html')
    expect(decodeURIComponent(url)).toContain('&lt;script&gt;')
    expect(decodeURIComponent(url)).toContain('a &amp; b')
  })
})
