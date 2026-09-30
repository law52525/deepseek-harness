/** The explicit add-to-draft verb: reference chips and text fragments, non-throwing. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SessionInputShell } from '../src/client/input/facade.ts'

function shell(cwd = '/work/app', notice = () => 'nope'): SessionInputShell {
  return new SessionInputShell({
    actx: new Context(),
    defaultSink: vi.fn(async () => ({ kind: 'success' as const })),
    commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: () => '' },
    cwd: () => cwd,
    insertRefusedNotice: notice,
  })
}

it('adds a workspace file as an @path chip resolved against the session root', () => {
  const input = shell()
  try {
    expect(input.addToConversation({ kind: 'reference', path: '/work/app/src/a.ts', target: 'file', label: 'a.ts' }))
      .toBe('inserted')
    const state = input.state.getSnapshot()
    expect(state.draft).toContain('@src/a.ts')
    expect(state.occurrences).toHaveLength(1)
    expect(state.occurrences[0]).toMatchObject({ source: 'reference', ref: '@src/a.ts', appearance: 'file' })
  } finally { input.dispose() }
})

it('adds a directory with the trailing-slash folder grammar', () => {
  const input = shell()
  try {
    expect(input.addToConversation({ kind: 'reference', path: '/work/app/src', target: 'directory', label: 'src/' }))
      .toBe('inserted')
    expect(input.state.getSnapshot().occurrences[0]).toMatchObject({ ref: '@src/', appearance: 'folder' })
  } finally { input.dispose() }
})

it('quotes a path with whitespace through the shared reference grammar', () => {
  const input = shell()
  try {
    expect(input.addToConversation({ kind: 'reference', path: '/work/app/my file.txt', target: 'file', label: 'my file.txt' }))
      .toBe('inserted')
    expect(input.state.getSnapshot().occurrences[0]?.ref).toBe('@"my file.txt"')
  } finally { input.dispose() }
})

it('appends fragments without replacing an existing draft, in order', () => {
  const input = shell()
  try {
    input.setDraft('keep me')
    expect(input.addToConversation({ kind: 'fragment', text: 'one' })).toBe('inserted')
    expect(input.addToConversation({ kind: 'fragment', text: 'two' })).toBe('inserted')
    expect(input.state.getSnapshot().draft).toBe('keep meonetwo')
  } finally { input.dispose() }
})

it('refuses a path the reference grammar cannot represent, without throwing', () => {
  const input = shell()
  try {
    expect(input.addToConversation({ kind: 'reference', path: '/work/app/a"b', target: 'file', label: 'a' }))
      .toBe('conflict')
    expect(input.state.getSnapshot().draft).toBe('')
  } finally { input.dispose() }
})

it('refuses during a claimed submission and surfaces a notice instead of writing', () => {
  const notice = vi.fn(() => 'busy')
  const input = shell('/work/app', notice)
  try {
    input.setDraft('/x')
    const rev = input.state.getSnapshot().draftRev
    expect(input.beginCommand(
      { name: 'x', token: '/x ', submit: async () => ({ kind: 'success' }) },
      { start: 0, end: 2, draftRev: rev },
    )).toBe(true)
    input.submit('queue')
    expect(input.state.getSnapshot().phase).toBe('submitting')
    expect(input.addToConversation({ kind: 'fragment', text: 'x' })).toBe('unavailable')
    expect(input.state.getSnapshot().draft).toBe('/x ')
    expect(notice).toHaveBeenCalled()
    expect(input.notices.getSnapshot()).toMatchObject({ level: 'error', text: 'busy' })
  } finally { input.dispose() }
})

it('refuses after disposal', () => {
  const input = shell()
  input.dispose()
  expect(input.addToConversation({ kind: 'fragment', text: 'x' })).toBe('unavailable')
})
