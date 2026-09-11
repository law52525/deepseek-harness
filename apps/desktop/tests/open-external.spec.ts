/** openHttpsExternal allows https: only. */

import { describe, expect, it, vi } from 'vitest'
import { openHttpsExternal } from '../src/open-external.ts'

describe('open-external', () => {
  it('opens https: URLs and refuses other schemes', async () => {
    const open = vi.fn(async () => undefined)
    await expect(openHttpsExternal('https://example.com/download', open))
      .resolves.toEqual({ ok: true })
    expect(open).toHaveBeenCalledWith('https://example.com/download')

    open.mockClear()
    await expect(openHttpsExternal('http://example.com/x', open))
      .resolves.toEqual({ ok: false, detail: 'only https:' })
    await expect(openHttpsExternal('file:///tmp/x', open))
      .resolves.toEqual({ ok: false, detail: 'only https:' })
    await expect(openHttpsExternal('javascript:alert(1)', open))
      .resolves.toEqual({ ok: false, detail: 'only https:' })
    expect(open).not.toHaveBeenCalled()
  })
})
