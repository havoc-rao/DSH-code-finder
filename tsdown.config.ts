/**
 * tsdown build for dsh-code-finder: seven artifacts.
 *
 * - lib/index.js          (node ESM)  — source index + component search + cordis host half (name/apply/inject re-export)
 * - lib/client.js         (browser CJS + __ModuleLoader__) — cordis plugin client half in the DSH
 *                               module-table wire format (window.__ModuleLoader__.load({id, factory}));
 *                               served by harness /plugins/<id>/client.js when the package declares dsh.client
 * - lib/runtime.js        (browser ESM) — setupCodeFinder runtime overlay (zero framework deps); direct
 *                               consumers import @havocrao/dsh-code-finder/runtime
 * - lib/cordis.js         (node ESM)  — cordis plugin host half (explicit subpath; also re-exported at ".")
 * - lib/cordis-client.js  (browser ESM) — cordis plugin client half (explicit subpath; the harness-wire
 *                               copy lives at lib/client.js)
 * - lib/tsdown.js         (node ESM)  — tsdown/rolldown transform plugin (wraps @locator/babel-jsx)
 * - lib/vite.js           (node ESM)  — vite transform plugin (same transform core)
 *
 * Types ship from lib/types (tsc -p tsconfig.build.json). The browser runtime
 * entry is plain ESM with no framework imports — the overlay talks to React
 * through DOM fiber keys / the DevTools hook, never through an import, so the
 * runtime stays usable from any bundler and never double-instantiates React.
 * The harness-wire client entry bundles the same runtime + cordis skeleton in
 * the exact banner/footer/intro shape @deepseek-ai/dsh-client tsdown presets
 * emit (see tsdown.client.ts clientConfig), so any cordis loader with that
 * wire format loads this package as a browser plugin with zero adaptation.
 *
 * Define note: the wire bundle intentionally does NOT define process.env.NODE_ENV.
 * The cordis client half treats a missing global process as dev (browser), so
 * dev hosts load an active overlay while release profiles (which never patch
 * this row in) ship nothing to execute; the old ESM runtime kept the same
 * semantics via the same catch.
 */
import type { UserConfig } from 'tsdown'

export default [
  {
    // CLI: npx @havocrao/dsh-code-finder <init|status|remove>
    entry: { cli: 'src/cli/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
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
    // Harness-wire cordis client half: /plugins/<id>/client.js 字节契约
    // （@deepseek-ai/dsh-client tsdown presets 的 banner/footer/intro 三段式）。
    entry: { client: 'src/cordis/client.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    // isProductionRuntime() 在无 process 的浏览器里读 import.meta.env.MODE；
    // wire 产物固定 MODE=development（宿主只在 dev patch 挂载本行），避免
    // cjs 格式把 import.meta 替换成空对象时留下警告。
    define: {
      'import.meta.env.MODE': JSON.stringify('development'),
      'import.meta.env': JSON.stringify({ MODE: 'development' }),
    },
    outputOptions: {
      // 固定 lib/client.js：harness /plugins/<id>/client.js 端点按包 exports
      // 的 "./client" 文件字节服务，cjs 默认 .cjs 扩展名会让端点 404。
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@havocrao/dsh-code-finder", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  {
    // Direct ESM runtime (setupCodeFinder): 零框架依赖的 overlay，任意 bundler
    // 直接 import @havocrao/dsh-code-finder/runtime。
    entry: { runtime: 'src/client/index.ts' },
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
