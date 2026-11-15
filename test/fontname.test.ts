import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { inflateSync } from 'zlib'
import { familyFromRegistryName, fontFamilyName } from '../src/shared/fontname'

describe('font names', () => {
  it('reads the family name from a woff file', () => {
    const bytes = new Uint8Array(readFileSync('node_modules/@fontsource/alef/files/alef-hebrew-400-normal.woff'))
    expect(fontFamilyName(bytes, (d) => new Uint8Array(inflateSync(d)))).toBe('Alef')
  })
  it('returns null for something that is not a font', () => {
    expect(fontFamilyName(new TextEncoder().encode('not a font at all'))).toBeNull()
  })
  it('turns Windows registry names into families', () => {
    expect(familyFromRegistryName('David Bold (TrueType)')).toEqual(['David'])
    expect(familyFromRegistryName('Cambria & Cambria Math (TrueType)')).toEqual(['Cambria', 'Cambria Math'])
    expect(familyFromRegistryName('Segoe UI Semibold Italic (TrueType)')).toEqual(['Segoe UI'])
  })
})
