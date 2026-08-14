/**
 * Desktop runtime glue: harness-source prompt when surfaceContext is true,
 * and a desktopRuntime marker with no bind address.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply, Config } from '../src/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('desktop-app runtime glue', () => {
  it('provides the surface marker, registers harness-source, and prints no URL', async () => {
    const ctx = new Context()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx, new Config({ surfaceContext: true }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(ctx.get('desktopRuntime')).toEqual({ surface: 'desktop' })
    expect(log).not.toHaveBeenCalled()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'harness:source')?.text)
      .toContain('DeepSeek Harness implementation checkout')
    expect(assembly.sections.some(entry => entry.name === 'app:web-surface')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('skips the harness-source section when surfaceContext is false', async () => {
    const ctx = new Context()
    apply(ctx, new Config({ surfaceContext: false }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.get('desktopRuntime')).toEqual({ surface: 'desktop' })
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'harness:source')).toBe(false)
    await ctx.fiber.dispose()
  })
})
