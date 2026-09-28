import { describe, expect, it } from 'vitest'
import { DEFAULT_DESKTOP_PRODUCT_NAME } from '../src/product-config.ts'
import { en, formatDesktopMessage, resolveDesktopLocale, resolveDesktopStartupLocale, zh } from '../src/locale.ts'

describe('desktop locale dictionaries', () => {
  it('ships the same key set in English and Chinese', () => {
    expect(Object.keys(zh)).toEqual(Object.keys(en))
    expect(Object.keys(resolveDesktopLocale('zh-Hans-CN').messages)).toEqual(Object.keys(zh))
    expect(resolveDesktopLocale('zh-Hans-CN').messages.aboutProduct).toBe(DEFAULT_DESKTOP_PRODUCT_NAME)
    expect(resolveDesktopLocale('en-US').messages.aboutProduct).toBe(DEFAULT_DESKTOP_PRODUCT_NAME)
    expect(resolveDesktopLocale('fr-FR').messages.aboutProduct).toBe(DEFAULT_DESKTOP_PRODUCT_NAME)
  })

  it('formats named values without consuming unknown placeholders', () => {
    expect(formatDesktopMessage('{name}@{version} {missing}', { name: 'plugin', version: '1.2.3' }))
      .toBe('plugin@1.2.3 {missing}')
  })

  it('prefers an explicit supported choice, then the first supported system language', () => {
    expect(resolveDesktopStartupLocale('zh', ['en-US']).id).toBe('zh-CN')
    expect(resolveDesktopStartupLocale('EN', ['zh-CN']).id).toBe('en')
    expect(resolveDesktopStartupLocale(null, ['ja-JP', 'zh-Hant', 'en-US']).id).toBe('zh-CN')
    expect(resolveDesktopStartupLocale(null, ['en-US', 'zh-CN']).id).toBe('en')
    expect(resolveDesktopStartupLocale(null, ['ja-JP']).id).toBe('en')
    expect(resolveDesktopStartupLocale(null, []).id).toBe('en')
    expect(resolveDesktopStartupLocale('ja', ['zh-CN']).id).toBe('zh-CN')
  })

  it('substitutes the configured product name and drops official-model copy', () => {
    const env = { DSH_DESKTOP_PRODUCT_NAME: 'Wandox Work' }
    const branded = resolveDesktopLocale('en', env).messages
    expect(branded.aboutProduct).toBe('Wandox Work')
    expect(branded.quitTitle).toBe('Quit Wandox Work?')
    expect(branded.welcomeKeyDescription).toBe('Configure official models to start using the app')
    expect(branded.aboutProduct).not.toContain('DeepSeek')
    const brandedZh = resolveDesktopLocale('zh', env).messages
    expect(brandedZh.aboutProduct).toBe('Wandox Work')
    expect(brandedZh.welcomeKeyDescription).toBe('配置官方模型，即可开始使用')
  })
})
