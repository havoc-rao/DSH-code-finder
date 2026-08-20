/**
 * vite transform plugin for dsh-code-finder.
 *
 * Usage (vite.config.ts):
 *   plugins: [react(), codeFinderVite()]
 *
 * Dev-only by default (NODE_ENV=development). Runs before react's own babel
 * pipeline is irrelevant — it only adds data attributes, never rewrites JSX
 * semantics (types stripped by preset-typescript only).
 */
import type { Plugin } from 'vite'
import { transformWithCodeFinder, type CodeFinderBuildOptions } from './transform'

export { codeFinderEnabled, shouldInstrument } from './transform'
export type { CodeFinderBuildOptions } from './transform'

/** vite transform plugin. */
export function codeFinderVite(options: CodeFinderBuildOptions = {}): Plugin {
  return {
    name: 'dsh-code-finder',
    enforce: 'pre',
    async transform(code, id) {
      const result = await transformWithCodeFinder(code, id, options)
      if (result === null) return null
      return { code: result.code, map: result.map }
    },
  }
}
