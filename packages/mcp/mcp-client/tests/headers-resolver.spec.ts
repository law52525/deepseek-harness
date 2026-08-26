/**
 * Tests for the Streamable HTTP `headers` resolver (function form): each
 * transport creation re-evaluates the resolver so a credential that appears
 * after startup is picked up by the next reconnect, while a static object
 * keeps its original semantics. Isolated file so vi.mock of the MCP SDK does
 * not pollute other suites.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

// ---- Mock MCP SDK ----

// vi.mock factories are hoisted above every import/const, so the mock fns and
// class must be created inside vi.hoisted to exist when the factories run.
const { mockStreamableCtor, mockConnect, mockClose, mockListTools, mockCallTool, MockClient, instances } = vi.hoisted(() => {
  const mockStreamableCtor = vi.fn()
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<(_params?: Record<string, unknown>) => Promise<unknown>>()
  const mockCallTool = vi.fn<(
    _params?: Record<string, unknown>, _compatibilitySchema?: unknown, _options?: unknown,
  ) => Promise<unknown>>()
  const mockSetNotificationHandler = vi.fn()
  const mockRequest = vi.fn(async (
    request: { method: string; params?: Record<string, unknown> },
    _schema: unknown,
    options?: unknown,
  ): Promise<unknown> => {
    if (request.method === 'tools/list') return await mockListTools(request.params)
    if (request.method === 'tools/call') return await mockCallTool(request.params, undefined, options)
    throw new Error(`unexpected MCP request: ${request.method}`)
  })
  class MockClient {
    onclose: (() => void) | undefined
    connect = mockConnect
    close = mockClose
    request = mockRequest
    setNotificationHandler = mockSetNotificationHandler
    constructor() { instances.push(this) }
  }
  const instances: MockClient[] = []
  return { mockStreamableCtor, mockConnect, mockClose, mockListTools, mockCallTool, MockClient, instances }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mockStreamableCtor,
}))

import { createTransport } from '@deepseek-ai/dsh-mcp-client/src/transport.ts'
import { apply } from '@deepseek-ai/dsh-mcp-client/src/index.ts'

// ---- Helpers ----

type Headers = Record<string, string> | (() => Record<string, string>)

function httpConfig(headers: Headers, reconnect?: Config['reconnect']): Config {
  return {
    transport: 'streamable-http',
    serverName: 'srv',
    url: 'http://localhost:3000/mcp',
    headers,
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
    ...(reconnect === undefined ? {} : { reconnect }),
  }
}

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** The tool list the mock server advertises after a successful (re)connect. */
function listing(...names: string[]): { tools: { name: string; inputSchema: { type: string } }[]; nextCursor: undefined } {
  return {
    tools: names.map(name => ({ name, inputSchema: { type: 'object' } })),
    nextCursor: undefined,
  }
}

/** The headers argument passed to the Nth StreamableHTTPClientTransport construction. */
function headersAt(callIndex: number): Record<string, string> {
  const call = mockStreamableCtor.mock.calls[callIndex]
  if (call === undefined) throw new Error(`no transport construction at index ${callIndex}`)
  const opts = call[1] as { requestInit?: { headers?: Record<string, string> } }
  return opts?.requestInit?.headers ?? {}
}

// ---- Tests ----

describe('createTransport headers resolver', () => {
  beforeEach(() => {
    mockStreamableCtor.mockClear()
  })

  it('AC-2: passes a static headers object through unchanged', () => {
    const headers = { Authorization: 'Bearer x' }
    createTransport(httpConfig(headers))
    expect(mockStreamableCtor).toHaveBeenCalledTimes(1)
    expect(headersAt(0)).toEqual(headers)
  })

  it('AC-1: calls a function resolver and uses its return value', () => {
    const resolver = vi.fn(() => ({ 'X-Wandox-Admin-Token': 'tok-1' }))
    createTransport(httpConfig(resolver))
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(headersAt(0)).toEqual({ 'X-Wandox-Admin-Token': 'tok-1' })
  })

  it('AC-1: re-evaluates the resolver on every transport creation', () => {
    let token = 'first'
    const config = httpConfig(() => ({ 'X-Wandox-Admin-Token': token }))
    createTransport(config)
    token = 'second'
    createTransport(config)
    expect(mockStreamableCtor).toHaveBeenCalledTimes(2)
    expect(headersAt(0)).toEqual({ 'X-Wandox-Admin-Token': 'first' })
    expect(headersAt(1)).toEqual({ 'X-Wandox-Admin-Token': 'second' })
  })

  it('falls back to empty headers when the resolver throws', () => {
    createTransport(httpConfig(() => { throw new Error('read failed') }))
    expect(headersAt(0)).toEqual({})
  })

  it('falls back to empty headers when the resolver returns null', () => {
    createTransport(httpConfig(() => null as unknown as Record<string, string>))
    expect(headersAt(0)).toEqual({})
  })
})

describe('headers resolver on reconnect', () => {
  let ctx: Context

  beforeEach(async () => {
    vi.clearAllMocks()
    instances.length = 0
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockImplementation(function (this: { onclose?: () => void }) {
      this.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockResolvedValue(listing('remote'))
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    ctx = await mountRegistry()
  })

  it('AC-1: re-evaluates the resolver on each reconnect generation', async () => {
    let token = 'first'
    const resolver = vi.fn(() => ({ 'X-Wandox-Admin-Token': token }))
    await apply(ctx, httpConfig(resolver, { initialDelayMs: 5, maxDelayMs: 40, maxAttempts: 5 }))
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(headersAt(0)).toEqual({ 'X-Wandox-Admin-Token': 'first' })

    token = 'second'
    instances[0]!.onclose?.()
    await vi.waitFor(() => { expect(instances).toHaveLength(2) })
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })
    expect(resolver).toHaveBeenCalledTimes(2)
    expect(headersAt(1)).toEqual({ 'X-Wandox-Admin-Token': 'second' })
  })

  it('AC-6: failOnStartupError: false does not reject on an empty-token connect failure', async () => {
    mockConnect.mockRejectedValue(new Error('401: missing token'))
    // apply resolves (does not throw) because failOnStartupError is false;
    // the supervisor keeps retrying in the background instead of failing startup.
    await apply(ctx, httpConfig(() => ({ 'X-Wandox-Admin-Token': '' }), { initialDelayMs: 5, maxDelayMs: 40, maxAttempts: 3 }))
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()
    expect(mockConnect).toHaveBeenCalled()
  })

  it('AC-7: an empty token fails the first attempt and a later token connects without restart', async () => {
    let token = ''
    // Simulate the MCP server rejecting a request that lacks the auth header.
    mockConnect.mockImplementation(async () => {
      if (token === '') throw new Error('401: missing X-Wandox-Admin-Token')
    })
    await apply(ctx, httpConfig(() => ({ 'X-Wandox-Admin-Token': token }), { initialDelayMs: 5, maxDelayMs: 40, maxAttempts: 100 }))
    await vi.waitFor(() => { expect(mockConnect).toHaveBeenCalled() })
    expect(ctx.tools.get('mcp__srv__remote')).toBeUndefined()
    const attemptsBefore = mockConnect.mock.calls.length

    // Login writes the token; the next reconnect re-evaluates the resolver and
    // connects without any explicit reconnect trigger.
    token = 'real-token'
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__remote')).toBeDefined() })
    expect(mockConnect.mock.calls.length).toBeGreaterThan(attemptsBefore)
    const lastTransport = mockStreamableCtor.mock.calls.length - 1
    expect(headersAt(lastTransport)).toEqual({ 'X-Wandox-Admin-Token': 'real-token' })
  })
})
