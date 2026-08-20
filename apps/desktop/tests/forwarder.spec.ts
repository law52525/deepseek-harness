/** Main RPC forwarder: payloads stay opaque JSON; control documents are typed. */

import { describe, expect, it } from 'vitest'
import { controlEnvelope, controlFromChild, rpcEnvelope, rpcPayloadFromChild } from '../src/forwarder.ts'

describe('desktop IPC forwarder', () => {
  it('round-trips RPC payloads without decoding bodies', () => {
    const payload = { type: 'unary-request', body: '{"not":"parsed"}', raw: '\u0000binary-ish' }
    const envelope = rpcEnvelope(payload)
    expect(envelope).toEqual({ channel: 'rpc', payload })
    expect(rpcPayloadFromChild(envelope)).toBe(payload)
    expect(rpcPayloadFromChild({ channel: 'rpc', payload: 'still-opaque' })).toBe('still-opaque')
    expect(JSON.parse(JSON.stringify(envelope)).payload.body).toBe('{"not":"parsed"}')
  })

  it('ignores control documents on the RPC unwrap', () => {
    const control = controlEnvelope({ type: 'host-ready' })
    expect(rpcPayloadFromChild(control)).toBeUndefined()
    expect(controlFromChild(control)).toEqual({ type: 'host-ready' })
    expect(controlFromChild(rpcEnvelope({ type: 'unary-request' }))).toBeUndefined()
    expect(rpcPayloadFromChild('nope')).toBeUndefined()
    expect(controlFromChild(null)).toBeUndefined()
  })
})
