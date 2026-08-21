/**
 * CLI + config-edit unit / integration tests.
 *
 * The config-edit layer is pure text surgery (assert byte-exact results); the
 * runCli layer drives real tempdir sandboxes through init → status → remove,
 * covering every wiring target (vite / tsdown / cordis) and the rollback +
 * idempotence contracts.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureCordisRow,
  ensureImport,
  ensurePluginsEntry,
  removeCordisRow,
  removeImport,
  removePluginsEntry,
} from '../src/cli/config-edit'
import { runCli } from '../src/cli/index'

const VITE_SAMPLE = [
  "import { defineConfig } from 'vite'",
  "import { defineConfig } from 'vite'",
  "import react from '@vitejs/plugin-react'",
  '',
  'export default defineConfig({',
  '  plugins: [react()],',
  '})',
  '',
].join('\n')

const dirs: string[] = []
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cf-cli-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('config-edit: ensureImport / removeImport', () => {
  const specifier = "'@havocrao/dsh-code-finder/vite'"

  it('inserts after the last import', () => {
    const out = ensureImport(VITE_SAMPLE, `import { codeFinderVite } from ${specifier}`)
    expect(out).toContain(`import { codeFinderVite } from ${specifier}`)
    expect(out).toContain("import react from '@vitejs/plugin-react'\n  import { codeFinderVite }")
  })

  it('prepends when there are no imports', () => {
    const out = ensureImport('// banner\nexport default {}', `import x from ${specifier}`)
    expect(out).toContain(`import x from ${specifier}`)
  })

  it('is idempotent', () => {
    const statement = `import { codeFinderVite } from ${specifier}`
    const once = ensureImport(VITE_SAMPLE, statement)
    const twice = ensureImport(once, statement)
    expect(twice).toBe(once)
  })

  it('removes only exact single-line imports', () => {
    const withImport = ensureImport(VITE_SAMPLE, `import { codeFinderVite } from ${specifier}`)
    const out = removeImport(withImport, specifier)
    expect(out).not.toContain('codeFinderVite')
    expect(out).toContain("import react from '@vitejs/plugin-react'")
  })

  it('leaves hand-written multi-line imports alone', () => {
    const handWritten = "import {\n  codeFinderVite,\n} from 'x'\n" + VITE_SAMPLE
    const out = removeImport(handWritten, specifier)
    expect(out).toContain('codeFinderVite')
  })
})

describe('config-edit: ensurePluginsEntry / removePluginsEntry', () => {
  it('inlines after an inline array opener without eating characters', () => {
    const { source } = ensurePluginsEntry('plugins: [react()],', 'codeFinderVite', 'codeFinderVite()')
    expect(source).toBe('plugins: [codeFinderVite(), react()],')
  })

  it('inserts on the next line for a multiline array', () => {
    const input = 'export default defineConfig({\n  plugins: [\n    react(),\n  ],\n})'
    const { source, changed } = ensurePluginsEntry(input, 'codeFinderVite', 'codeFinderVite()')
    expect(changed).toBe(true)
    expect(source).toBe('export default defineConfig({\n  plugins: [\n    codeFinderVite(),\n    react(),\n  ],\n})')
  })

  it('wires every plugins array in a file', () => {
    const input = ['defineConfig([{', '  name: "a",', '  plugins: [a],', '}, {', '  name: "b",', '  plugins: [b],', '}])'].join('\n')
    const { source } = ensurePluginsEntry(input, 'codeFinderTsdown', 'codeFinderTsdown()')
    expect(source.match(/codeFinderTsdown\(\)/gu)).toHaveLength(2)
  })

  it('does not treat an import line as already-wired', () => {
    const input = "import { codeFinderVite } from 'x'\nplugins: []"
    const { source, changed } = ensurePluginsEntry(input, 'codeFinderVite', 'codeFinderVite()')
    expect(changed).toBe(true)
    expect(source).toContain('codeFinderVite(),')
  })

  it('removes single-line call entries', () => {
    const input = 'plugins: [\n  codeFinderVite(),\n  react(),\n],'
    const out = removePluginsEntry(input, 'codeFinderVite')
    expect(out).not.toContain('codeFinderVite')
    expect(out).toContain('react(),')
  })
})

describe('config-edit: ensureCordisRow / removeCordisRow', () => {
  const row = "- id: dsh-code-finder\nname: '@havocrao/dsh-code-finder'"
  const sample = [
    '# profile patch',
    '- insert:',
    '    - id: ui-theme',
    "      name: '@deepseek-ai/dsh-client-ui-theme'",
    '',
  ].join('\n')

  it('aligns child indentation to the insert block', () => {
    const { source, changed } = ensureCordisRow(sample, row, 'dsh-code-finder')
    expect(changed).toBe(true)
    expect(source).toContain("- id: dsh-code-finder\n      name: '@havocrao/dsh-code-finder'")
    expect(source).toMatch(/^    - id: dsh-code-finder$/m) // row starts at the block's child indent (4 spaces)
  })

  it('is idempotent by package name, not row id', () => {
    const once = ensureCordisRow(sample, row, 'dsh-code-finder').source
    const twice = ensureCordisRow(once, row, 'dsh-code-finder')
    expect(twice.source).toBe(once)
    // An existing row under a DIFFERENT id referencing the same package also
    // blocks the insert (duplicate /code-finder/api registration otherwise).
    const foreignId = sample.replace('ui-theme', 'whatever')
      .replace("'@deepseek-ai/dsh-client-ui-theme'", "'@havocrao/dsh-code-finder'")
    const blocked = ensureCordisRow(foreignId, row, 'dsh-code-finder')
    expect(blocked.changed).toBe(false)
  })

  it('removes the row (by name) without touching neighbours', () => {
    const wired = ensureCordisRow(sample, row, 'dsh-code-finder').source
    const out = removeCordisRow(wired, row)
    expect(out).not.toContain('code-finder')
    expect(out).toContain('ui-theme')
  })

  it('removes a row under a foreign id too', () => {
    const foreign = sample.replace('ui-theme', 'cf-extra')
      .replace("'@deepseek-ai/dsh-client-ui-theme'", "'@havocrao/dsh-code-finder'")
    const out = removeCordisRow(foreign, row)
    expect(out).not.toContain('cf-extra')
    expect(out).not.toContain("'@havocrao/dsh-code-finder'")
    expect(out).toContain('- insert:')
  })
})

describe('runCli: end-to-end wiring', () => {
  it('init wires a vite project; remove removes only its own injections', async () => {
    const dir = sandbox()
    writeFileSync(join(dir, 'vite.config.ts'), VITE_SAMPLE)
    writeFileSync(join(dir, 'package.json'), '{}\n')

    const initCode = await runCli(['init', '--cwd', dir, '--no-install', '--quiet'])
    expect(initCode).toBe(0)
    const wired = readFileSync(join(dir, 'vite.config.ts'), 'utf8')
    expect(wired).toContain("import { codeFinderVite } from '@havocrao/dsh-code-finder/vite'")
    expect(wired).toContain('plugins: [codeFinderVite(), react()]')

    // idempotent second init
    await runCli(['init', '--cwd', dir, '--no-install', '--quiet'])
    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toBe(wired)

    expect(await runCli(['status', '--cwd', dir])).toBe(0)

    const removeCode = await runCli(['remove', '--cwd', dir, '--quiet'])
    expect(removeCode).toBe(0)
    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toBe(VITE_SAMPLE)
    // No backup file is ever created or left behind.
    expect(() => readFileSync(`${join(dir, 'vite.config.ts')}.code-finder.bak`, 'utf8')).toThrow()
  })

  it('remove preserves user edits made after init (no stale backup to restore)', async () => {
    const dir = sandbox()
    writeFileSync(join(dir, 'vite.config.ts'), VITE_SAMPLE)
    writeFileSync(join(dir, 'package.json'), '{}\n')
    await runCli(['init', '--cwd', dir, '--no-install', '--quiet'])

    // User edits the file after wiring: adds a plugin and a comment.
    const edited = readFileSync(join(dir, 'vite.config.ts'), 'utf8')
      .replace('plugins: [codeFinderVite(), react()]', 'plugins: [codeFinderVite(), react(), userPlugin()]')
      .replace('import react from', '// my later edit\nimport react from')
    writeFileSync(join(dir, 'vite.config.ts'), edited)

    await runCli(['remove', '--cwd', dir, '--no-install', '--quiet'])
    const clean = readFileSync(join(dir, 'vite.config.ts'), 'utf8')
    // User's additions survive; only the CLI injection is gone.
    expect(clean).toContain('userPlugin()')
    expect(clean).toContain('// my later edit')
    expect(clean).not.toContain('codeFinderVite')
  })

  it('init wires every tsdown plugins array; remove exact-deletes', async () => {
    const dir = sandbox()
    const tsdown = [
      "import { defineConfig, type UserConfig } from 'tsdown'",
      '',
      'export default defineConfig([{',
      '  name: "a",',
      '  plugins: [a()],',
      '}, {',
      '  name: "b",',
      '  plugins: [b()],',
      '}])',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'tsdown.config.ts'), tsdown)
    writeFileSync(join(dir, 'package.json'), '{}\n')

    await runCli(['init', '--cwd', dir, '--no-install', '--quiet'])
    const wired = readFileSync(join(dir, 'tsdown.config.ts'), 'utf8')
    expect(wired.match(/codeFinderTsdown\(\)/gu)).toHaveLength(2)
    expect(wired).toContain("import { codeFinderTsdown } from '@havocrao/dsh-code-finder/tsdown'")

    await runCli(['remove', '--cwd', dir, '--quiet'])
    const clean = readFileSync(join(dir, 'tsdown.config.ts'), 'utf8')
    expect(clean).not.toContain('codeFinderTsdown')
    expect(clean).toContain('plugins: [a()]')
    expect(clean).toContain('plugins: [b()]')
  })

  it('init wires a cordis patch and remove strips the row', async () => {
    const dir = sandbox()
    const patch = [
      '# profile patch',
      '- overrides:',
      '    ui-terminal:',
      '      config: {}',
      '- insert:',
      '    - id: ui-theme',
      "      name: '@deepseek-ai/dsh-client-ui-theme'",
      '',
    ].join('\n')
    writeFileSync(join(dir, 'cordis.patch.yml'), patch)
    writeFileSync(join(dir, 'package.json'), '{}\n')

    await runCli(['init', '--cwd', dir, '--no-install', '--quiet'])
    const wired = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(wired).toContain('- id: dsh-code-finder')
    expect(wired).toContain("name: '@havocrao/dsh-code-finder'")
    expect(wired).toContain('ctx.loader.entries()') // 双挂防护 disabled 表达式随行

    await runCli(['remove', '--cwd', dir, '--quiet'])
    const clean = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(clean).not.toContain('code-finder')
    expect(clean).toContain('ui-theme')
  })

  it('rejects unknown subcommands with exit code 2', async () => {
    expect(await runCli(['frobnicate'])).toBe(2)
  })

  it('handles a project with no wiring targets gracefully (exit 1)', async () => {
    const dir = sandbox()
    writeFileSync(join(dir, 'package.json'), '{}\n')
    expect(await runCli(['init', '--cwd', dir, '--no-install', '--quiet'])).toBe(1)
  })

  it('reports truthfully when a tsdown config has no literal plugins array (conditional expression)', async () => {
    const dir = sandbox()
    const conditional = [
      "import { defineConfig } from 'tsdown'",
      '',
      'export default defineConfig(({ env }) => ({',
      '  plugins: env?.face === "client" ? [] : [typertPlugin()],',
      '}))',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'tsdown.config.ts'), conditional)
    writeFileSync(join(dir, 'package.json'), '{}\n')

    const code = await runCli(['init', '--cwd', dir, '--no-install', '--quiet'])
    expect(code).toBe(0)
    const after = readFileSync(join(dir, 'tsdown.config.ts'), 'utf8')
    // 条件式插件列表无法安全注入：不得改动文件（import 也要回滚）
    expect(after).toBe(conditional)
  })

  it('init on a project whose tsdown config already carries the call is a no-op', async () => {
    const dir = sandbox()
    const already = [
      "import { codeFinderTsdown } from '@havocrao/dsh-code-finder/tsdown'",
      '',
      'export default { plugins: [codeFinderTsdown()] }',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'tsdown.config.ts'), already)
    writeFileSync(join(dir, 'package.json'), '{}\n')
    await runCli(['init', '--cwd', dir, '--no-install', '--quiet'])
    expect(readFileSync(join(dir, 'tsdown.config.ts'), 'utf8')).toBe(already)
  })
})