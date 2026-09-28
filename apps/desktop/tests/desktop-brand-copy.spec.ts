import { describe, expect, it } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import { resolveDesktopProductName } from '../src/product-config.ts'

const PRODUCT = 'Wandox Work'
const env = { DSH_DESKTOP_PRODUCT_NAME: PRODUCT }

describe('D-19 branded menu / about / quit copy', () => {
  it('renders the application menu labels from the product name', () => {
    const zh = resolveDesktopLocale('zh', env).messages
    const en = resolveDesktopLocale('en', env).messages
    expect(en.aboutMenu).toBe('About Wandox Work')
    expect(en.hideApplication).toBe('Hide Wandox Work')
    expect(en.quitApplication).toBe('Quit Wandox Work')
    expect(zh.aboutMenu).toBe('关于 Wandox Work')
    expect(zh.hideApplication).toBe('隐藏 Wandox Work')
    expect(zh.quitApplication).toBe('退出 Wandox Work')
  })

  it('renders the about panel applicationName and Windows about dialog copy', () => {
    expect(resolveDesktopProductName(env)).toBe('Wandox Work')
    const zh = resolveDesktopLocale('zh', env).messages
    const en = resolveDesktopLocale('en', env).messages
    expect(en.aboutProduct).toBe('Wandox Work')
    expect(zh.aboutProduct).toBe('Wandox Work')
    expect(en.aboutMenu).toBe('About Wandox Work')
    expect(zh.aboutMenu).toBe('关于 Wandox Work')
    expect(en.aboutVersion.replace('{version}', '3.0.0')).toBe('Version V3.0.0')
    expect(zh.aboutVersion.replace('{version}', '3.0.0')).toBe('版本 V3.0.0')
  })

  it('renders the quit confirmation title and body', () => {
    const zh = resolveDesktopLocale('zh', env).messages
    const en = resolveDesktopLocale('en', env).messages
    expect(en.quitTitle).toBe('Quit Wandox Work?')
    expect(zh.quitTitle).toBe('退出 Wandox Work？')
    expect(en.aboutProduct).toBe('Wandox Work')
    expect(zh.aboutProduct).toBe('Wandox Work')
    expect(en.quitActiveAndScheduledTasks).toBe(
      'Running tasks will be interrupted, and scheduled tasks will not run while the app is closed.',
    )
    expect(zh.quitActiveAndScheduledTasks).toBe(
      '当前正在运行的任务将会中断，且应用关闭期间，定时任务不会运行',
    )
  })
})
