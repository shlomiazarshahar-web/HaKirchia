import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { cpSync, readFileSync } from 'fs'

const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version as string

/** The PDF reader (feature 12) needs some data files next to the page: fonts the PDF does not
 *  include, character maps, and decoders for scanned pages. Copied as they are from pdfjs-dist. */
const pdfjsData = () => ({
  name: 'pdfjs-data',
  writeBundle(options: { dir?: string }) {
    for (const d of ['cmaps', 'standard_fonts', 'wasm']) cpSync(resolve('node_modules/pdfjs-dist', d), resolve(options.dir ?? 'out/renderer', 'pdfjs', d), { recursive: true })
  }
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), pdfjsData()],
    // shown on the home screen under the name
    define: { __APP_VERSION__: JSON.stringify(version) }
  }
})
