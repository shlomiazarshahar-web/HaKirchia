import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { blocksToHtml, epubToHtml, sourceDocument, sourceKind, xhtmlToHtml } from '../src/shared/sourcefile'

async function makeEpub(): Promise<Uint8Array> {
  const z = new JSZip()
  z.file('mimetype', 'application/epub+zip')
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  z.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Test</dc:title><dc:language>en</dc:language></metadata>
    <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/><item id="img" href="images/orn.png" media-type="image/png"/></manifest>
    <spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`
  )
  z.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Contents</p></body></html>')
  z.file(
    'OEBPS/text/c1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head><body>
    <h1 class="ct">Chapter One</h1>
    <p>It was a <em>dark</em> night.</p>
    <div class="para">She walked &amp; talked.</div>
    <div><p>Nested one.</p><p>Nested two.</p></div>
    <p class="orn"><img src="../images/orn.png" alt=""/></p>
    <script>alert(1)</script>
    </body></html>`
  )
  z.file('OEBPS/text/c2.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h2>Chapter Two</h2><p>Second.</p><hr/><p>After.</p></body></html>')
  z.file('OEBPS/images/orn.png', new Uint8Array([137, 80, 78, 71]))
  return z.generateAsync({ type: 'uint8array' })
}

describe('source files (feature 52)', () => {
  it('knows the kinds by extension', () => {
    expect(sourceKind('a.PDF')).toBe('pdf')
    expect(sourceKind('book.epub')).toBe('epub')
    expect(sourceKind('x.docx')).toBe('docx')
    expect(sourceKind('x.doc')).toBeNull()
  })

  it('reads an ePub in spine order, skipping the table of contents', async () => {
    const r = await epubToHtml(await makeEpub())
    expect(r.dir).toBe('ltr')
    expect(r.lang).toBe('en')
    expect(r.title).toBe('The Test')
    expect(r.html).not.toContain('Contents')
    expect(r.html).not.toContain('alert')
    expect(r.html).toContain('<h1>Chapter One</h1>')
    expect(r.html).toContain('<p>It was a <i>dark</i> night.</p>')
    expect(r.html).toContain('<p>She walked &amp; talked.</p>')
    expect(r.html).toContain('<p>Nested one.</p>')
    expect(r.html).toContain('<p>Nested two.</p>')
    expect(r.html).toContain('src="data:image/png;base64,')
    expect(r.html).toContain('<p class="sc">* * *</p>')
    expect(r.html.indexOf('Chapter One')).toBeLessThan(r.html.indexOf('Chapter Two'))
    expect(r.html.match(/<section class="part">/g)?.length).toBe(2)
  })

  it('keeps text between blocks and treats loose text as paragraphs', () => {
    const h = xhtmlToHtml('<html xmlns="http://www.w3.org/1999/xhtml"><body><div>Loose <b>text</b><p>Block</p>tail</div></body></html>', 'a.xhtml', () => null)
    expect(h).toBe('<p>Loose <b>text</b></p>\n<p>Block</p>\n<p>tail</p>')
  })

  it('turns Word blocks into HTML', () => {
    const h = blocksToHtml([
      { type: 'heading', attrs: { level: 0 }, content: [{ type: 'text', text: 'Book' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'A ' }, { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [] },
      { type: 'heading', attrs: { level: 1, pageBreak: true }, content: [{ type: 'text', text: '<One>' }] }
    ])
    expect(h).toBe('<h1>Book</h1>\n<p>A <b>bold</b></p>\n<h1 class="pb">&lt;One&gt;</h1>')
  })

  it('builds a page that allows no scripts or outside requests', () => {
    const page = sourceDocument({ html: '<p>x</p>', dir: 'rtl', lang: '', title: 'ת' })
    expect(page).toContain('dir="rtl"')
    expect(page).toContain("default-src 'none'")
  })
})
