/**
 * Build-time instrumentation core: runs @locator/babel-jsx over an app's own
 * JSX/TSX so every element carries a `data-locatorjs` attribute (path format:
 * `<absFile>:<line>:<col>`) plus a `window.__LOCATOR_DATA__` registry entry.
 *
 * Dev-only by default (NODE_ENV=development or CODE_FINDER=1): in production
 * the transform is a no-op returning the original code, so published bundles
 * carry zero locator payload.
 *
 * The injected attributes are plain DOM data — they survive production React
 * (no _debugSource needed), which is exactly the gap the runtime's resolve
 * chain (src/client/resolve.ts) fills for components the app built itself.
 */
import { createRequire } from 'node:module'
import { transformAsync } from '@babel/core'
import babelJsx from '@locator/babel-jsx'

// babel 的 preset/plugin 若以裸包名写字符串，会在运行时从「宿主项目」解析
// （babel 的 cwd/filename 解析规则）——宿主没装 @babel/* 时 transform 静默
// 失败（catch → null → 0 注入）。改从本包自己的 node_modules 定位绝对路径，
// 让注入不依赖宿主是否安装 babel。createRequire(import.meta.url) 在打包后
// 指向 lib/tsdown.js / lib/vite.js，上溯到本包 node_modules 即可命中。
const require = createRequire(import.meta.url)
const TYPESCRIPT_PRESET = require.resolve('@babel/preset-typescript')

export interface CodeFinderBuildOptions {
  /** Force on/off; default: process.env.NODE_ENV === 'development' || CODE_FINDER=1 */
  enabled?: boolean
  /** Extra include filter (tested against the resolved absolute file id). */
  include?: RegExp
  /** Extra exclude filter (tested against the resolved absolute file id). */
  exclude?: RegExp
  /** Babel project root for path rebasing; default process.cwd(). */
  projectRoot?: string
  /** data-locatorjs attribute format; 'path' is self-describing (no registry needed). */
  dataAttribute?: 'path' | 'id'
}

/**
 * Whether instrumentation is on for this build. `CODE_FINDER` is the complete
 * master switch: `0`/`off`/`false` forces off (even under a dev build),
 * `1`/`on`/`true` forces on (even under a production build), otherwise follow
 * the build semantics (`NODE_ENV === 'development'`).
 */
export function codeFinderEnabled(enabled: boolean | undefined): boolean {
  if (enabled !== undefined) return enabled
  const flag = process.env.CODE_FINDER
  if (flag === '0' || flag === 'off' || flag === 'false') return false
  if (flag === '1' || flag === 'on' || flag === 'true') return true
  return process.env.NODE_ENV === 'development'
}

/** Should this module id be instrumented (own source only)? */
export function shouldInstrument(id: string, options: CodeFinderBuildOptions): boolean {
  if (id.includes('node_modules')) return false
  if (!/\.(tsx|jsx|ts|js)$/u.test(id)) return false
  if (options.include && !options.include.test(id)) return false
  if (options.exclude && options.exclude.test(id)) return false
  return true
}

/** babel transform 产出的 sourcemap（RawSourceMap 结构子集，下游只透传给打包器）。 */
export interface CodeFinderSourceMap {
  version: number
  sources: string[]
  names: string[]
  mappings: string
  file?: string
  sourcesContent?: Array<string | null>
  sourceRoot?: string
}

/** 一次 transform 的结果（map 为 undefined 表示无产物 map，插件返回 null 原样透传）。 */
export interface CodeFinderTransformResult {
  code: string
  map?: CodeFinderSourceMap | null
}

/**
 * Transform one module. Returns null when instrumentation is off, the module
 * is not own source, or babel fails (a transform failure must never break the
 * build — the module is passed through untouched and the error is surfaced
 * via console.warn).
 */
export async function transformWithCodeFinder(
  code: string,
  id: string,
  options: CodeFinderBuildOptions = {},
): Promise<CodeFinderTransformResult | null> {
  if (!codeFinderEnabled(options.enabled)) return null
  if (!shouldInstrument(id, options)) return null
  try {
    const result = await transformAsync(code, {
      filename: id,
      cwd: options.projectRoot ?? process.cwd(),
      babelrc: false,
      configFile: false,
      sourceMaps: true,
      compact: false,
      // TSX is parsed (types stripped); JSX is left for the bundler's own
      // pipeline (rolldown/vite handle it), only the locator attributes and
      // the __LOCATOR_DATA__ IIFE are added. TYPESCRIPT_PRESET is an absolute
      // path resolved from THIS package (see the top of the file) so hosts
      // without a babel install still get instrumentation.
      presets: [[TYPESCRIPT_PRESET, { isTSX: true, allExtensions: true, allowDeclareFields: true }]],
      plugins: [[babelJsx, { dataAttribute: options.dataAttribute ?? 'path' }]],
    })
    if (!result?.code) return null
    return { code: result.code, map: result.map ?? undefined }
  } catch (error) {
    console.warn(`[dsh-code-finder] transform failed for ${id}:`, (error as Error).message)
    return null
  }
}
