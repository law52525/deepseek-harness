// @vitest-environment jsdom
/**
 * Queue-mode ModuleLoader facade installer shared by served HTML and desktop boot.
 */

import { afterEach, describe, expect, it } from 'vitest'
import * as modulesClient from '../src/client/index.ts'
import { PARSER_PRELOAD_IDS, installBootstrapFacade } from '../src/client/bootstrap-facade.ts'
import type { DshWindow, WebBootGraph } from '../src/client/index.ts'

const MODULES_ID = '@deepseek-ai/dsh-client-modules'
const win = globalThis as DshWindow

afterEach(() => {
  delete win.__ModuleLoader__
})

const graph = (): WebBootGraph => ({
  rev: 'graph',
  entries: PARSER_PRELOAD_IDS.map(id => ({ id, url: `/plugins/${id}/client.js?rev=g`, rev: 'g' })),
})

describe('installBootstrapFacade', () => {
  it('installs a queue-mode facade that create() promotes after the modules factory arrives', () => {
    const target = installBootstrapFacade()
    expect(target.mode).toBe('queue')
    expect(win.__ModuleLoader__).toBe(target)

    target.load({ id: MODULES_ID, factory: () => modulesClient })
    const system = target.create({ boot: graph(), staticModules: {} })

    expect(target.mode).toBe('live')
    expect(system.manifest.rev).toBe('graph')
  })

  it('rejects create() when the modules factory was not parser-preloaded', () => {
    const target = installBootstrapFacade()
    expect(() => target.create({ boot: graph(), staticModules: {} }))
      .toThrow(`HTML did not preload ${MODULES_ID}/client.js`)
  })
})
