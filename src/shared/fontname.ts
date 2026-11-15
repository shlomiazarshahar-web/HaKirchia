// Reads the family name stored inside a font file (ttf, otf, ttc, woff), so a font added from a file
// gets its real name, the same name Word uses. woff2 is not read (its tables are transformed);
// for it the caller falls back to the file name.

type Inflate = (data: Uint8Array) => Uint8Array

const tag = (b: DataView, o: number) => String.fromCharCode(b.getUint8(o), b.getUint8(o + 1), b.getUint8(o + 2), b.getUint8(o + 3))

function readNameTable(t: DataView): string | null {
  const count = t.getUint16(2)
  const strings = t.getUint16(4)
  let best: { score: number; name: string } | null = null
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12
    if (r + 12 > t.byteLength) break
    const platform = t.getUint16(r)
    const lang = t.getUint16(r + 4)
    const id = t.getUint16(r + 6)
    const len = t.getUint16(r + 8)
    const off = strings + t.getUint16(r + 10)
    if (id !== 1 || off + len > t.byteLength) continue
    let name = ''
    if (platform === 3 || platform === 0) {
      for (let k = 0; k + 1 < len; k += 2) name += String.fromCharCode(t.getUint16(off + k))
    } else if (platform === 1) {
      for (let k = 0; k < len; k++) name += String.fromCharCode(t.getUint8(off + k))
    } else continue
    name = name.replace(/\0/g, '').trim()
    if (!name) continue
    // Windows English name first (that's the name Word saves), then any Windows name, then Mac
    const score = platform === 3 ? (lang === 0x409 ? 3 : 2) : 1
    if (!best || score > best.score) best = { score, name }
  }
  return best?.name ?? null
}

function fromSfnt(v: DataView, start: number): string | null {
  const numTables = v.getUint16(start + 4)
  for (let i = 0; i < numTables; i++) {
    const r = start + 12 + i * 16
    if (tag(v, r) === 'name') {
      const off = v.getUint32(r + 8)
      const len = v.getUint32(r + 12)
      return readNameTable(new DataView(v.buffer, v.byteOffset + off, Math.min(len, v.byteLength - off)))
    }
  }
  return null
}

export function fontFamilyName(bytes: Uint8Array, inflate?: Inflate): string | null {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const sig = tag(v, 0)
    if (sig === 'ttcf') return fromSfnt(v, v.getUint32(12))
    if (sig === '\0\x01\0\0' || sig === 'OTTO' || sig === 'true') return fromSfnt(v, 0)
    if (sig === 'wOFF') {
      const numTables = v.getUint16(12)
      for (let i = 0; i < numTables; i++) {
        const r = 44 + i * 20
        if (tag(v, r) !== 'name') continue
        const off = v.getUint32(r + 4)
        const comp = v.getUint32(r + 8)
        const orig = v.getUint32(r + 12)
        let data = bytes.subarray(off, off + comp)
        if (comp < orig) {
          if (!inflate) return null
          data = inflate(data)
        }
        return readNameTable(new DataView(data.buffer, data.byteOffset, data.byteLength))
      }
    }
    return null
  } catch {
    return null
  }
}

/** "David Bold (TrueType)" → "David". Names from the Windows fonts list in the registry. */
export function familyFromRegistryName(name: string): string[] {
  const STYLE =
    /\s+(Regular|Bold|Italic|Oblique|Light|Medium|Semibold|SemiBold|Semilight|SemiLight|Demibold|DemiBold|Black|Heavy|Thin|ExtraLight|Extra Light|ExtraBold|Extra Bold|UltraLight|UltraBold|Condensed|Cond|Narrow|Book|Roman)$/i
  return name
    .replace(/\s*\((TrueType|OpenType|All res|VGA res|[^)]*)\)\s*$/i, '')
    .split('&')
    .map((part) => {
      let f = part.trim()
      for (let k = 0; k < 4; k++) f = f.replace(STYLE, '')
      return f.trim()
    })
    .filter((f) => f && !/^[\d\s]+$/.test(f))
}
