import { describe, expect, it } from 'vitest'
import { compareVersions, pickRelease, type GhRelease } from '@shared/update'

describe('version order', () => {
  it('sorts test versions below the real one, by number', () => {
    const list = ['1.3.0', '1.3.0-test.10', '1.2.0', '1.3.0-test.9', '1.4.0-test.1', '1.3.1']
    expect([...list].sort(compareVersions)).toEqual(['1.2.0', '1.3.0-test.9', '1.3.0-test.10', '1.3.0', '1.3.1', '1.4.0-test.1'])
    expect(compareVersions('v1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.3.0', '1.3.0')).toBe(0)
  })
})

const rel = (tag: string, version: string, prerelease = false, yml = true): GhRelease => ({
  tag_name: tag,
  draft: false,
  prerelease,
  assets: [{ name: `HaKirchia-Setup-${version}.exe` }, ...(yml ? [{ name: 'latest.yml' }] : [])]
})

describe('which release to update to', () => {
  const list = [rel('test-pr-20', '1.4.0-test.60', true), rel('v1.3.0', '1.3.0'), rel('test-pr-9', '0.9.0', true, false), rel('v1.2.0', '1.2.0')]
  it('takes only normal releases unless test versions were asked for', () => {
    expect(pickRelease(list, false)).toEqual({ tag: 'v1.3.0', version: '1.3.0' })
    expect(pickRelease(list, true)).toEqual({ tag: 'test-pr-20', version: '1.4.0-test.60' })
  })
  it('prefers the real version over its own test versions', () => {
    expect(pickRelease([rel('test-pr-20', '1.4.0-test.60', true), rel('v1.4.0', '1.4.0')], true)?.tag).toBe('v1.4.0')
  })
  it('skips releases without the update file', () => {
    expect(pickRelease([rel('v1.0.0', '1.0.0', false, false)], true)).toBeNull()
  })
})
