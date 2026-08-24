import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureProfileFromTemplate, PROFILE_STAMP_NAME, copyTreeSync } from '../src/profile-bootstrap.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

describe('ensureProfileFromTemplate', () => {
  it('copies a template whose path contains CJK characters', () => {
    const root = tmp('dsh-profile-中文-')
    const template = join(root, '模板')
    mkdirSync(join(template, 'node_modules'), { recursive: true })
    writeFileSync(join(template, 'package.json'), '{"name":"dsh-profile-desktop"}\n')
    writeFileSync(join(template, PROFILE_STAMP_NAME), 'stamp-cjk\n')
    const home = join(root, '用户主目录')
    expect(ensureProfileFromTemplate({ dshHome: home, templateRoot: template })).toBe('copied')
    expect(readFileSync(join(home, 'profiles', 'desktop', PROFILE_STAMP_NAME), 'utf8').trim()).toBe('stamp-cjk')
  })

  it('refuses to copy a symlink in the template', () => {
    const root = tmp('dsh-profile-symlink-')
    const template = join(root, 'template')
    mkdirSync(template, { recursive: true })
    writeFileSync(join(template, 'real.txt'), 'ok\n')
    try {
      symlinkSync(join(template, 'real.txt'), join(template, 'link.txt'))
    } catch {
      return
    }
    expect(() => copyTreeSync(template, join(root, 'dest'))).toThrow(/symlink/)
  })

  it('skips when no template is packaged', () => {
    expect(ensureProfileFromTemplate({})).toBe('skipped')
  })

  it('copies on stamp mismatch and is a no-op when the stamp matches', () => {
    const root = tmp('dsh-profile-boot-')
    const template = join(root, 'template')
    mkdirSync(join(template, 'node_modules', 'example'), { recursive: true })
    writeFileSync(join(template, 'package.json'), '{"name":"dsh-profile-desktop"}\n')
    writeFileSync(join(template, 'node_modules', 'example', 'index.js'), 'export {}\n')
    writeFileSync(join(template, PROFILE_STAMP_NAME), 'stamp-a\n')
    const home = join(root, 'home')

    expect(ensureProfileFromTemplate({ dshHome: home, templateRoot: template })).toBe('copied')
    const dest = join(home, 'profiles', 'desktop')
    expect(readFileSync(join(dest, PROFILE_STAMP_NAME), 'utf8').trim()).toBe('stamp-a')
    expect(readFileSync(join(dest, 'node_modules', 'example', 'index.js'), 'utf8')).toContain('export')

    expect(ensureProfileFromTemplate({ dshHome: home, templateRoot: template })).toBe('unchanged')

    writeFileSync(join(template, 'node_modules', 'example', 'index.js'), 'export const n = 1\n')
    writeFileSync(join(template, PROFILE_STAMP_NAME), 'stamp-b\n')
    expect(ensureProfileFromTemplate({ dshHome: home, templateRoot: template })).toBe('copied')
    expect(readFileSync(join(dest, 'node_modules', 'example', 'index.js'), 'utf8')).toContain('n = 1')
    expect(readFileSync(join(dest, PROFILE_STAMP_NAME), 'utf8').trim()).toBe('stamp-b')
  })

  it('throws when the template stamp is missing or empty', () => {
    const root = tmp('dsh-profile-boot-bad-')
    const template = join(root, 'template')
    mkdirSync(template, { recursive: true })
    expect(() => ensureProfileFromTemplate({
      dshHome: join(root, 'home'),
      templateRoot: template,
    })).toThrow(/missing version-stamp/)
    writeFileSync(join(template, PROFILE_STAMP_NAME), '   \n')
    expect(() => ensureProfileFromTemplate({
      dshHome: join(root, 'home'),
      templateRoot: template,
    })).toThrow(/empty/)
  })

  it('replaces a dest tree that has no stamp', () => {
    const root = tmp('dsh-profile-boot-nostamp-')
    const template = join(root, 'template')
    mkdirSync(join(template, 'node_modules'), { recursive: true })
    writeFileSync(join(template, 'package.json'), '{"name":"dsh-profile-desktop"}\n')
    writeFileSync(join(template, PROFILE_STAMP_NAME), 'fresh\n')
    const home = join(root, 'home')
    const dest = join(home, 'profiles', 'desktop')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'stale.txt'), 'old\n')
    expect(ensureProfileFromTemplate({ dshHome: home, templateRoot: template })).toBe('copied')
    expect(readFileSync(join(dest, PROFILE_STAMP_NAME), 'utf8').trim()).toBe('fresh')
  })

  it('keeps .previous until dest is the new tree after a mid-swap crash', () => {
    const root = tmp('dsh-profile-boot-retry-')
    const template = join(root, 'template')
    mkdirSync(join(template, 'node_modules'), { recursive: true })
    writeFileSync(join(template, 'package.json'), '{"name":"dsh-profile-desktop"}\n')
    writeFileSync(join(template, 'node_modules', 'keep.js'), 'new\n')
    writeFileSync(join(template, PROFILE_STAMP_NAME), 'stamp-new\n')
    const home = join(root, 'home')
    const dest = join(home, 'profiles', 'desktop')
    const previous = `${dest}.previous`
    const staging = `${dest}.installing`
    mkdirSync(previous, { recursive: true })
    writeFileSync(join(previous, 'only-copy.js'), 'old\n')
    mkdirSync(staging, { recursive: true })
    writeFileSync(join(staging, 'half.js'), 'partial\n')
    expect(ensureProfileFromTemplate({ dshHome: home, templateRoot: template })).toBe('copied')
    expect(readFileSync(join(dest, 'node_modules', 'keep.js'), 'utf8')).toContain('new')
    expect(() => readFileSync(join(previous, 'only-copy.js'))).toThrow()
  })

  it('does not mention a product name', () => {
    const src = readFileSync(new URL('../src/profile-bootstrap.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/wandox/i)
  })
})
