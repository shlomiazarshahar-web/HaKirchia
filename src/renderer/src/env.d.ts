/** The app's version from package.json, set at build time (electron.vite.config.mts) */
declare const __APP_VERSION__: string
declare module '*.css'
declare module '*.svg' {
  const src: string
  export default src
}
declare module '*.png' {
  const src: string
  export default src
}
declare module '*?url' {
  const src: string
  export default src
}
