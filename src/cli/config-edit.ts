/**
 * dsh-code-finder CLI — config edit primitives.
 *
 * Zero-dependency, byte-safe helpers for wiring / unwiring the injection
 * plugins in a target project's build config:
 *
 * - vite.config.*   → `codeFinderVite()` in the plugins array
 * - tsdown.config.* → `codeFinderTsdown()` in every plugins array
 * - cordis.patch.yml → a one-row mount of `@omdsh-dev/dsh-code-finder`
 *
 * Every edit is idempotent (a marker identifier already present → no-op)
 * and snapshots the file to `<file>.code-finder.bak` on first edit; remove()
 * restores the snapshot verbatim when present, so hand-written edits are
 * never mangled.
 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'

/** Marker identifiers used for idempotence and targeted removal. */
export const VITE_IDENTIFIER = 'codeFinderVite'
export const TSDOWN_IDENTIFIER = 'codeFinderTsdown'

function detectEol(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

function readUtf8(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function backupPath(path: string): string {
  return `${path}.code-finder.bak`
}

/** Snapshot the file if it has not been snapshotted yet. */
function snapshot(path: string, source: string): void {
  const backup = backupPath(path)
  if (readUtf8(backup) === undefined) writeFileSync(backup, source, 'utf8')
}

/**
 * Restore the snapshot into place and remove the backup file. No-op when no
 * snapshot exists. The restored content is byte-identical to what the backup
 * held, so keeping the backup around would only leave `.restored` litter in
 * the project after every init → remove cycle.
 */
export function restoreBackup(path: string): boolean {
  const backup = backupPath(path)
  const snapshotSource = readUtf8(backup)
  if (snapshotSource === undefined) return false
  writeFileSync(path, snapshotSource, 'utf8')
  try {
    unlinkSync(backup)
  } catch {
    /* best effort: a leftover backup file is harmless */
  }
  return true
}

/**
 * Insert `import { ... } from '@omdsh-dev/dsh-code-finder/...'` after the
 * last top-level import statement. Idempotent on the import statement text.
 */
export function ensureImport(source: string, importStatement: string): string {
  if (source.includes(importStatement)) return source
  const lines = source.split(/\r?\n/u)
  let lastImport = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (/^import\s/mu.test(lines[index] ?? '')) lastImport = index
  }
  const eol = detectEol(source)
  if (lastImport < 0) {
    // No imports at all: prepend after any leading comments / shebang lines.
    return `${importStatement}${eol}${eol}${source}`
  }
  lines.splice(lastImport + 1, 0, `  ${importStatement}`)
  return lines.join(eol)
}

/**
 * Remove the exact import line (single-line import statements only — the ones
 * this CLI writes). Hand-written multi-line imports are left for the user.
 */
export function removeImport(source: string, specifier: string): string {
  const lines = source.split(/\r?\n/u)
  const kept: string[] = []
  let removed = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (
      trimmed.startsWith('import') &&
      trimmed.includes(specifier) &&
      !trimmed.includes('\n') &&
      trimmed.includes('} from ') &&
      !trimmed.startsWith('//')
    ) {
      removed = true
      continue
    }
    kept.push(line)
  }
  return removed ? kept.join(detectEol(source)) : source
}

/**
 * Insert `<expression>,` into every `plugins: [` array of the file.
 * Idempotent per identifier. Returns the modified source and whether changed.
 */
export function ensurePluginsEntry(source: string, identifier: string, expression: string): { source: string, changed: boolean } {
  // 幂等判断必须用完整调用表达式（带括号）：import 行也含 identifier
  // （`import { codeFinderVite }`），仅按 identifier 判断会把「已加 import
  // 但还没加调用」误判成已注入。
  if (source.includes(expression)) return { source, changed: false }
  const eol = detectEol(source)
  // Match every `plugins:` property followed by an array opener.
  const pattern = /plugins\s*:\s*\[/gmu
  let match: RegExpExecArray | null
  let cursor = 0
  let out = ''
  let changed = false
  while ((match = pattern.exec(source)) !== null) {
    const index = match.index
    const comma = match.index + match[0].length
    out += source.slice(cursor, comma)
    const rest = source.slice(comma)
    const nextChar = rest[0]
    if (nextChar === '\n' || nextChar === '\r' || nextChar === undefined) {
      // Array opener at line end: insert on the next line with +2 indent.
      const lineStart = source.lastIndexOf('\n', index) + 1
      const indentMatch = /^[ \t]*/u.exec(source.slice(lineStart, index))
      const indent = indentMatch?.[0] ?? ''
      out += `${eol}${indent}  ${expression},`
    } else {
      // Inline array: splice right after the opener WITHOUT consuming the
      // next character of `rest` — cursor stays at `comma` so the untouched
      // rest (e.g. `react()]`) survives in the final slice below.
      out += `${expression}, `
    }
    cursor = comma
    changed = true
  }
  out += source.slice(cursor)
  return { source: out, changed }
}

/** Remove `<identifier>(),` entries from every plugins array (line and inline forms). */
export function removePluginsEntry(source: string, identifier: string): string {
  const eol = detectEol(source)
  const lines = source.split(/\r?\n/u)
  const kept: string[] = []
  let changed = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === `${identifier}(),` || (trimmed.startsWith(`${identifier}(),`) && trimmed.endsWith(','))) {
      changed = true
      continue
    }
    // Inline form on its own element: drop it, then clean up leftover commas.
    const inline = new RegExp(`\\b${identifier}\\(\\),?\\s*`, 'gu')
    const cleaned = line.replace(inline, '').replace(/,\s*\]/gu, ']')
    if (cleaned !== line) {
      changed = true
      kept.push(cleaned)
      continue
    }
    kept.push(line)
  }
  return changed ? kept.join(eol) : source
}

/**
 * Insert a one-row mount of `@omdsh-dev/dsh-code-finder` into the first
 * top-level `- insert:` block of a cordis.patch.yml.
 *
 * Idempotence is by PACKAGE NAME, not by row id: any existing row whose
 * `name:` references the same package (whatever its id: the official
 * `dsh-code-finder` or a profile's own id) makes the insert a no-op. A
 * second mount would register /code-finder/api twice and fail the boot.
 *
 * `rowCode` is a multi-line template whose FIRST line starts with `- id:`
 * and whose child lines carry NO leading indentation; each child line is
 * aligned at `indent + 2` spaces, matching the insert block's own child
 * indentation (detected from the first existing child row).
 */
export function ensureCordisRow(source: string, rowCode: string, _rowId: string): { source: string, changed: boolean } {
  const packageName = cordisRowPackageName(rowCode)
  if (packageName !== null && source.includes(packageName)) return { source, changed: false }
  const lines = source.split(/\r?\n/u)
  const insertIndex = lines.findIndex(line => line.trim() === '- insert:' || line.trim().startsWith('- insert'))
  if (insertIndex < 0) return { source, changed: false }
  const eol = detectEol(source)
  // Detect the child indentation of the insert block (or 2 spaces by default).
  let indent = '  '
  for (let index = insertIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const match = /^([ \t]*)-\s/u.exec(line)
    if (match !== null) { indent = match[1] ?? indent; break }
  }
  const aligned = rowCode.split(/\r?\n/u).map((line, index) =>
    index === 0 ? `${indent}${line}` : `${indent}  ${line}`,)
  lines.splice(insertIndex + 1, 0, ...aligned)
  return { source: lines.join(eol), changed: true }
}

/** Remove the row whose `name:` references this package (any row id). */
export function removeCordisRow(source: string, rowCode: string): string {
  const packageName = cordisRowPackageName(rowCode)
  const lines = source.split(/\r?\n/u)
  const kept: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const isRowStart = /^[ \t]*- id:/u.test(line)
    if (isRowStart && packageName !== null) {
      // Peek ahead for the row's `name:` (or a second `- id:` line meaning
      // this row has no name here). The row is a contiguous block of
      // indented lines; comments directly above it belong to the row too.
      let j = index + 1
      const block: string[] = [line]
      let nameFound = false
      while (j < lines.length) {
        const next = lines[j] ?? ''
        if (/^[ \t]*- id:/u.test(next) || next.trim() === '') break
        block.push(next)
        if (new RegExp(`name\\s*:\\s*['"]${escapeRegExp(packageName)}['"]`, 'u').test(next)) nameFound = true
        j += 1
      }
      if (nameFound) {
        index = j
        continue // drop the whole block
      }
    }
    kept.push(line)
    index += 1
  }
  return kept.join(detectEol(source))
}

/** Extract the package name from a row template's `name:` line. */
function cordisRowPackageName(rowCode: string): string | null {
  const match = /name\s*:\s*['"]([^'"]+)['"]/u.exec(rowCode)
  return match?.[1] ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}