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

export const REPO_API = 'https://api.github.com/repos/shlomiazarshahar-web/HaKirchia/releases?per_page=60'
export const downloadBase = (tag: string) => `https://github.com/shlomiazarshahar-web/HaKirchia/releases/download/${encodeURIComponent(tag)}`

/** Version order (semver): 1.3.0-test.9 < 1.3.0-test.10 < 1.3.0 < 1.3.1. Negative when a is older. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split(/-(.*)/s)
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre ? pre.split('.') : [] }
  }
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
  // a version without a test suffix is newer than its test versions
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) - (y.pre.length ? -1 : 0)
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn && +p !== +q) return +p - +q
    if (pn !== qn) return pn ? -1 : 1
    if (!pn && p !== q) return p < q ? -1 : 1
  }
  return 0
}

/** What the GitHub releases list gives (only the parts used here) */
export interface GhRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: { name: string }[]
}

/**
 * The newest release the app can update to: normal releases, plus the test versions of open
 * pull requests (pre-releases "test-pr-N") when the writer asked for them. Only releases that
 * carry latest.yml (the file the updater reads) count, so older ones are skipped.
 */
export function pickRelease(list: GhRelease[], includeTests: boolean): { tag: string; version: string } | null {
  let best: { tag: string; version: string } | null = null
  for (const r of list) {
    if (r.draft || !r.assets.some((a) => a.name === 'latest.yml')) continue
    if (r.prerelease && !(includeTests && r.tag_name.startsWith('test-pr-'))) continue
    const versions = r.assets.map((a) => /^HaKirchia-Setup-(.+)\.exe$/.exec(a.name)?.[1]).filter((v): v is string => !!v)
    if (!versions.length) continue
    const setup = versions.sort(compareVersions)[versions.length - 1]
    if (!best || compareVersions(setup, best.version) > 0) best = { tag: r.tag_name, version: setup }
  }
  return best
}
