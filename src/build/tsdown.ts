/**
 * tsdown / rolldown transform plugin for dsh-code-finder.
 *
 * Usage (tsdown.config.ts, client bundle plugins array):
 *   plugins: [codeFinderTsdown()]
 *
 * Dev-only by default; production builds are untouched no-ops.
 */
import type { Plugin } from 'rolldown'
import { transformWithCodeFinder, type CodeFinderBuildOptions } from './transform'

export { codeFinderEnabled, shouldInstrument } from './transform'
export type { CodeFinderBuildOptions } from './transform'

/** rolldown transform plugin (works in tsdown). */
export function codeFinderTsdown(options: CodeFinderBuildOptions = {}): Plugin {
  return {
    name: 'dsh-code-finder',
    async transform(code, id) {
      const result = await transformWithCodeFinder(code, id, options)
      if (result === null) return null
      return { code: result.code, map: result.map }
    },
  }
}
