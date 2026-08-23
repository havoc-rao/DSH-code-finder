/**
 * Version stamp injected at build time via tsdown `define` (tsdown.config.ts),
 * mirroring shr's ldflags channel model: VERSION stays pure, the channel is
 * annotated at display time.
 *
 *   dev     → dsh-code-finder 0.1.0-dev.HHMM (commit <sha>, built <local ISO>)
 *   release → dsh-code-finder 0.1.0 (commit <sha>, built <local ISO>)
 *
 * Outside tsdown (vitest / raw source) the defines are absent; the typeof
 * guards fall back to a truthful "unbuilt" stamp instead of throwing, so
 * tests never explode on undefined identifiers.
 */
declare const __DCF_VERSION__: string | undefined
declare const __DCF_CHANNEL__: string | undefined
declare const __DCF_BUILD_TIME__: string | undefined
declare const __DCF_COMMIT__: string | undefined

const VERSION = typeof __DCF_VERSION__ === 'undefined' ? '0.0.0-unbuilt' : __DCF_VERSION__
const CHANNEL = typeof __DCF_CHANNEL__ === 'undefined' ? 'unknown' : __DCF_CHANNEL__
const BUILD_TIME = typeof __DCF_BUILD_TIME__ === 'undefined' ? 'unknown' : __DCF_BUILD_TIME__
const COMMIT = typeof __DCF_COMMIT__ === 'undefined' ? 'unknown' : __DCF_COMMIT__

/** `2026-08-23T09:25` → `0925`（与 shr 的 `-dev.HHMM` 一致，Version 本身保持纯净） */
function hhmm(built: string): string {
  const match = /T(\d{2}):(\d{2})/u.exec(built)
  return match === null ? '????' : `${match[1]}${match[2]}`
}

/** `dcf -v` / `dcf --version` 输出行。 */
export function cliVersion(): string {
  const suffix = CHANNEL === 'dev' ? `-dev.${hhmm(BUILD_TIME)}` : ''
  return `dsh-code-finder ${VERSION}${suffix} (commit ${COMMIT}, built ${BUILD_TIME})`
}