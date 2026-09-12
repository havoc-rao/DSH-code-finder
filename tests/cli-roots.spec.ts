/**
 * dcf roots 子命令 + roots.ts 文本手术测试。
 *
 * roots.ts 是纯文本手术（字节级保留用户内容、幂等）；runCli 层用临时
 * DSH_HOME 沙箱驱动 list → add → remove 的端到端路径，覆盖创建/追加/
 * 清空恢复默认、退出码与幂等契约。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureRoots,
  hasInvalidOverridesBlock,
  listRoots,
  normalizeLiteralRoot,
  removeRoots,
  RootsEditError,
} from '../src/cli/roots'
import { runCli } from '../src/cli/index'

const home = homedir()
// 种子默认根与 host 半 defaultRoots() 一致：homedir()/.dsh/source/current。
const seededHome = join(home, '.dsh', 'source', 'current')
const seededCwd = "!!js \"process.cwd() + '/src'\""

const dirs: string[] = []
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cf-roots-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('roots: ensureRoots 纯函数', () => {
  it('空源 → 创建整块并播种两条默认根 + 用户路径（全新补丁项）', () => {
    const cwd = sandbox()
    const result = ensureRoots('', ['/ui/src'], cwd)
    expect(result.changed).toBe(true)
    expect(result.added).toEqual(['/ui/src'])
    expect(result.source).toContain('- id: dsh-code-finder')
    expect(result.source).toContain('config:')
    expect(result.source).toContain('roots:')
    expect(result.source).toContain(`- ${seededHome}`)
    expect(result.source).toContain(`- ${seededCwd}`)
    expect(result.source).toContain('- /ui/src')
    // 头部注释标记存在（供整块删除时回收）。
    expect(result.source).toContain('# dsh-code-finder roots 覆盖')
  })

  it('幂等：同一加入物二次执行零改动', () => {
    const cwd = sandbox()
    const once = ensureRoots('', ['/ui/src'], cwd)
    const twice = ensureRoots(once.source, ['/ui/src'], cwd)
    expect(twice.source).toBe(once.source)
    expect(twice.changed).toBe(false)
    expect(twice.skipped).toEqual(['/ui/src'])
  })

  it('按归一化键去重：~ 展开 / 相对路径 / 尾斜杠都算同一个', () => {
    const cwd = sandbox()
    const first = ensureRoots('', [join(home, 'x')], cwd)
    const second = ensureRoots(first.source, ['~/x', `${cwd}/y/`, `${cwd}/y`], cwd)
    expect(second.added).toEqual([`${cwd}/y/`]) // 同一路径两种写法只加一次
    expect(second.changed).toBe(true)
    // 列表项里没有重复的 /Users/.../x。
    const items = listRoots(second.source)
    expect(items?.filter(i => i.key === join(home, 'x'))).toHaveLength(1)
    expect(second.source).toContain(`- ${cwd}/y`)
  })

  it('js 表达式按原文精确去重（与 cwd+src 种子互不干扰）', () => {
    const first = ensureRoots('', [], sandbox()) // 只有种子
    const second = ensureRoots(first.source, ['!!js process.cwd()', '!!js process.cwd()'], sandbox())
    expect(second.skipped).toEqual(['!!js process.cwd()']) // 重复输入只记 skipped
    const third = ensureRoots(second.source, ['!!js process.cwd()'], sandbox())
    expect(third.changed).toBe(false) // 已存在 → 幂等
    const keys = listRoots(third.source)?.map(i => i.key)
    expect(keys).toContain('process.cwd()')
    expect(keys).toContain("process.cwd() + '/src'") // 种子表达式不受影响
  })

  it('保留既有补丁项与注释，只追加缺失项（对齐既有条目缩进）', () => {
    const cwd = sandbox()
    const existing = [
      '# 用户注释',
      '- insert:',
      '    - id: ui-theme',
      "      name: '@deepseek-ai/dsh-client-ui-theme'",
      '- id: dsh-code-finder',
      '  config:',
      '    roots:',
      '      - /already',
      '',
    ].join('\n')
    const result = ensureRoots(existing, ['/already', '/new'], cwd)
    expect(result.added).toEqual(['/new'])
    expect(result.skipped).toEqual(['/already'])
    expect(result.source).toContain('# 用户注释')
    expect(result.source).toContain('- insert:')
    expect(result.source).toContain("name: '@deepseek-ai/dsh-client-ui-theme'")
    expect(result.source).toContain('      - /already\n      - /new')
  })

  it('已有 `- id:` 补丁项但无 config → 在该项内补齐 config/roots（不动其它键）', () => {
    const existing = [
      '- id: dsh-code-finder',
      "  name: '@havocrao/dsh-code-finder'",
      '  disabled: !!js "process.env.NODE_ENV !== \'development\'"',
      '- id: other',
      '  config: {}',
      '',
    ].join('\n')
    const result = ensureRoots(existing, ['/ui/src'], sandbox())
    expect(result.source).toContain("- id: dsh-code-finder\n  name: '@havocrao/dsh-code-finder'")
    expect(result.source).toContain('disabled: !!js')
    expect(result.source).toContain('  config:\n    roots:')
    // config/roots 插在 disabled 之后、下一个补丁项之前。
    expect(result.source.indexOf('disabled:')).toBeLessThan(result.source.indexOf('config:'))
    expect(result.source.indexOf('config:')).toBeLessThan(result.source.indexOf('- id: other'))
    expect(result.source).toContain('- /ui/src')
  })

  it('flow 风格 config 无法安全追加 → RootsEditError', () => {
    const existing = [
      '- id: dsh-code-finder',
      '  config: { exts: [".tsx"] }',
      '',
    ].join('\n')
    expect(() => ensureRoots(existing, ['/ui/src'], sandbox())).toThrow(RootsEditError)
  })

  it('已有 config（block 风格）但无 roots → 在 config 内补齐 roots（保留兄弟键）', () => {
    const existing = [
      '- id: dsh-code-finder',
      '  config:',
      '    exts:',
      "      - '.tsx'",
      '',
    ].join('\n')
    const result = ensureRoots(existing, ['/ui/src'], sandbox())
    expect(result.source).toContain("      - '.tsx'")
    expect(result.source).toContain('    roots:')
    expect(result.source).toContain('      - /ui/src')
    expect(listRoots(result.source)?.some(i => i.key === '/ui/src')).toBe(true)
  })
})

describe('roots: removeRoots 纯函数', () => {
  it('移除其中一个，保留其余与注释', () => {
    const cwd = sandbox()
    const seeded = ensureRoots('', ['/a', '/b'], cwd)
    const result = removeRoots(seeded.source, ['/a'], cwd)
    expect(result.removed).toEqual(['/a'])
    expect(result.source).toContain('- /b')
    expect(result.source).toContain(seededHome)
    expect(listRoots(result.source)?.some(i => i.key === '/a')).toBe(false)
  })

  it('清空 → 整块（含 dcf 头部注释）删除，恢复正常文件；用户上方注释保留', () => {
    const cwd = sandbox()
    let source = '# 我的文件头注释\n'
    source = ensureRoots(source, ['/a'], cwd).source
    // 移除全部条目（含 dcf 播种的两条默认根）→ 整块回收。
    const all = listRoots(source)?.map(i => i.value) ?? []
    const result = removeRoots(source, all, cwd)
    expect(result.removed).toHaveLength(3)
    expect(result.source).not.toContain('dsh-code-finder')
    expect(result.source).not.toContain('roots')
    expect(result.source).toContain('# 我的文件头注释')
  })

  it('移除不存在的项 → 零改动，missing 列出', () => {
    const cwd = sandbox()
    const seeded = ensureRoots('', ['/a'], cwd)
    const result = removeRoots(seeded.source, ['/nope'], cwd)
    expect(result.changed).toBe(false)
    expect(result.missing).toEqual(['/nope'])
  })

  it('无覆盖源 → 零改动', () => {
    expect(removeRoots('# 只有注释\n', ['/a'], sandbox()).changed).toBe(false)
  })
})

describe('roots: listRoots / hasInvalidOverridesBlock', () => {
  it('listRoots 返回原文；无覆盖返回 null', () => {
    expect(listRoots('# 空\n')).toBeNull()
    const seeded = ensureRoots('', ['/a'], sandbox())
    const items = listRoots(seeded.source)
    expect(items?.map(i => `- ${i.value}`)).toContain('- /a')
  })

  it('识别无效的 `- overrides:` 包裹写法（web profile 当前形态）', () => {
    const invalid = [
      '- overrides:',
      '    dsh-code-finder:',
      '      config:',
      '        roots:',
      '          - !!js process.cwd()',
      '',
    ].join('\n')
    expect(hasInvalidOverridesBlock(invalid)).toBe(true)
    expect(hasInvalidOverridesBlock('# 干净\n- insert:\n    - id: x\n')).toBe(false)
  })
})

describe('runCli: roots 端到端（临时 DSH_HOME）', () => {
  const previousHome = process.env.DSH_HOME

  afterEach(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  it('add → list → remove 全链路；重复 add 幂等；清空恢复默认', async () => {
    const home = sandbox()
    process.env.DSH_HOME = home
    const uiSrc = join(home, 'ui', 'src')

    expect(await runCli(['roots', 'add', 'web', uiSrc, '--quiet'])).toBe(0)
    const patch = join(home, 'profiles', 'web', 'cordis.patch.yml')
    expect(existsSync(patch)).toBe(true)
    let content = readFileSync(patch, 'utf8')
    expect(content).toContain('- id: dsh-code-finder')
    expect(content).toContain(`- ${seededHome}`)
    expect(content).toContain(`- ${uiSrc}`)

    // 幂等：再次 add 零改动。
    expect(await runCli(['roots', 'add', 'web', uiSrc, '--quiet'])).toBe(0)
    expect(readFileSync(patch, 'utf8')).toBe(content)

    // list 退出码 0 且能看到条目。
    expect(await runCli(['roots', 'list', 'web'])).toBe(0)

    // 相对路径按 --cwd 归一化。
    expect(await runCli(['roots', 'add', 'web', 'rel/src', '--cwd', home, '--quiet'])).toBe(0)
    content = readFileSync(patch, 'utf8')
    expect(content).toContain(`- ${join(home, 'rel', 'src')}`)

    // remove 全部条目（含播种的默认根）→ 整块删除（恢复默认）。
    const all = listRoots(readFileSync(patch, 'utf8'))?.map(i => i.value) ?? []
    expect(await runCli(['roots', 'remove', 'web', ...all, '--quiet'])).toBe(0)
    content = readFileSync(patch, 'utf8')
    expect(content).not.toContain('dsh-code-finder')
    expect(content).not.toContain('roots')
  })

  it('文件存在但用 .yaml 扩展名时照常管理', async () => {
    const home = sandbox()
    process.env.DSH_HOME = home
    const profile = join(home, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'cordis.patch.yaml'), '# yaml 形态\n')
    expect(await runCli(['roots', 'add', 'web', '/a', '--quiet'])).toBe(0)
    const content = readFileSync(join(profile, 'cordis.patch.yaml'), 'utf8')
    expect(content).toContain('- id: dsh-code-finder')
    expect(existsSync(join(profile, 'cordis.patch.yml'))).toBe(false)
  })

  it('用法错误与非法 profile 名 → 退出码 2', async () => {
    process.env.DSH_HOME = sandbox()
    expect(await runCli(['roots'])).toBe(2)
    expect(await runCli(['roots', 'frob', 'web'])).toBe(2)
    expect(await runCli(['roots', 'add', '../evil', '/a'])).toBe(2)
    expect(await runCli(['roots', 'list', 'web', 'extra'])).toBe(2)
  })
})