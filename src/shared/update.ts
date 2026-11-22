/** Where the app stands with updating itself (auto-update, version 1.1) */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  /** No newer version; `at` = when it was checked */
  | { kind: 'latest'; at: number }
  | { kind: 'downloading'; version: string; percent: number }
  /** Downloaded; installs when the app closes, or now with "restart" */
  | { kind: 'ready'; version: string }
  /** The portable copy cannot replace itself: it only says a new version exists, with a link */
  | { kind: 'available-portable'; version: string; url: string }
  | { kind: 'error'; message: string }
  /** Running from the development tools, not an installed copy */
  | { kind: 'dev' }

/** The public page with the installers (the repository is public, so the app can read it without a password) */
export const RELEASES_PAGE = 'https://github.com/shlomiazarshahar-web/HaKirchia/releases/latest'
