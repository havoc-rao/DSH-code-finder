/**
 * tsdown build for dsh-code-finder: six artifacts.
 *
 * - lib/index.js          (node ESM)  — source index + component search (optional Node side)
 * - lib/client.js         (browser ESM) — setupCodeFinder runtime overlay (zero framework deps)
 * - lib/cordis.js         (node ESM)  — cordis plugin host half: /code-finder/api/search route
 * - lib/cordis-client.js  (browser ESM) — cordis plugin client half: auto setupCodeFinder
 * - lib/tsdown.js         (node ESM)  — tsdown/rolldown transform plugin (wraps @locator/babel-jsx)
 * - lib/vite.js           (node ESM)  — vite transform plugin (same transform core)
 *
 * Types ship from lib/types (tsc -p tsconfig.build.json). The browser entries
 * are plain ESM with no framework imports — the overlay talks to React
 * through DOM fiber keys / the DevTools hook, never through an import, so the
 * runtime stays usable from any bundler and never double-instantiates React.
 */
import type { UserConfig } from 'tsdown'

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
  },
  {
    entry: { cordis: 'src/cordis/host.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: { 'cordis-client': 'src/cordis/client.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
  },
  {
    entry: { tsdown: 'src/build/tsdown.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: { vite: 'src/build/vite.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
] satisfies UserConfig[]
