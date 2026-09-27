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
import { CORE_SCHEMA, defineScalarTag, load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureRoots,
  findDcfMountRowIds,
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

/** deepseek-harness loader 同款 `!!js` 表达式标签（load 校验只关心文档结构，
 *  表达式标量按原文保留；仅测试用，不参与 dump）。 */
const OVERLAY_JS_TAG = defineScalarTag('tag:yaml.org,2002:js', {
  resolve: (source: string) => source,
  identify: () => false,
  represent: (value: string) => value,
})
const OVERLAY_SCHEMA = CORE_SCHEMA.withTags(OVERLAY_JS_TAG)

/** 等价宿主 loader 行为的 js-yaml **单文档** load（默认 schema + `!!js` 标签）。
 *  多文档/空输入等任何非法形态都会抛 YAMLException —— 用于断言产物始终合法。 */
function loadOverlay(source: string): unknown {
  return load(source, { schema: OVERLAY_SCHEMA })
}

/** deepseek-harness profile 模板初始形态：模板注释 + `[]` 空数组文档。 */
const TEMPLATE = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries (id-targeted config',
  '# overrides, disables, and insert lists; `!!js` expressions allowed).',
  '[]',
].join('\n')

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
    // 剩余只有注释 → 补回模板形态空数组文档 []（宿主单文档 load 不抛空输入异常）。
    expect(loadOverlay(result.source)).toEqual([])
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

describe('roots: 模板 `[]` 文件与已损坏文件（harness 模板 bug 回归）', () => {
  it('模板（注释 + []）add → 剥离孤立 [] 行后追加，产物是合法单文档纯数组', () => {
    const cwd = sandbox()
    expect(loadOverlay(TEMPLATE)).toEqual([]) // 模板本身合法
    const result = ensureRoots(TEMPLATE, ['/app/src'], cwd, 'dsh-code-finder-mount')
    expect(result.changed).toBe(true)
    // 模板注释保留、孤立 [] 行消失。
    expect(result.source.startsWith('# Your patch layer for this dsh profile')).toBe(true)
    expect(result.source).not.toMatch(/^\[[ \t]*\]\s*$/mu)
    // 等价验收：移除孤立 [] 行后追加 → js-yaml 单文档 load 成功且是纯数组。
    const parsed = loadOverlay(result.source) as Array<{ id?: string, config?: { roots?: string[] } }>
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.id).toBe('dsh-code-finder-mount')
    expect(parsed[0]?.config?.roots).toContain(seededHome)
    expect(parsed[0]?.config?.roots).toContain('/app/src')
  })

  it('模板形态幂等：重复 add 零改动', () => {
    const cwd = sandbox()
    const once = ensureRoots(TEMPLATE, ['/app/src'], cwd, 'dsh-code-finder-mount')
    const twice = ensureRoots(once.source, ['/app/src'], cwd, 'dsh-code-finder-mount')
    expect(twice.changed).toBe(false)
    expect(twice.source).toBe(once.source)
  })

  it('三形态全覆盖：模板 [] / 空文件 / 已有 dcf 条目列表，add 后均为合法单文档', () => {
    const cwd = sandbox()
    // 1) 模板 [] 文件（本次 bug 形态）。
    const fromTemplate = ensureRoots(TEMPLATE, ['/a'], cwd, 'dsh-code-finder-mount')
    expect(Array.isArray(loadOverlay(fromTemplate.source))).toBe(true)
    // 2) 空文件（原有行为保持）。
    const fromEmpty = ensureRoots('', ['/a'], cwd, 'dsh-code-finder-mount')
    expect(Array.isArray(loadOverlay(fromEmpty.source))).toBe(true)
    // 3) 已有 dcf 条目列表（回归：列表内追加路径不受影响）。
    const existing = [
      '- insert:',
      '    - id: ui-theme',
      "      name: '@deepseek-ai/dsh-client-ui-theme'",
      '- id: dsh-code-finder-mount',
      '  config:',
      '    roots:',
      '      - /already',
      '',
    ].join('\n')
    const fromList = ensureRoots(existing, ['/new'], cwd, 'dsh-code-finder-mount')
    expect(fromList.added).toEqual(['/new'])
    const parsed = loadOverlay(fromList.source) as Array<{ id?: string, config?: { roots?: string[] } }>
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2) // insert 项 + dcf 补丁项
    expect(parsed[1]?.id).toBe('dsh-code-finder-mount')
    expect(parsed[1]?.config?.roots).toContain('/already')
    expect(parsed[1]?.config?.roots).toContain('/new')
  })

  it('已损坏旧文件（[] + 追加块，复现用户实机形态）→ add 一键修复，且修复后幂等', () => {
    const cwd = sandbox()
    const seeded = ensureRoots(TEMPLATE, ['/app/src'], cwd, 'dsh-code-finder-mount')
    // 人为制造旧版 bug 产物：模板 [] 之后直接跟 dcf 追加块（无 `---` 分隔）。
    const damaged = seeded.source.replace('\n\n# dsh-code-finder roots', '\n[]\n\n# dsh-code-finder roots')
    // 前提复现：该形态确实让 js-yaml 单文档 load 炸（宿主 boot exit 1 的根因）。
    expect(() => loadOverlay(damaged)).toThrow(/document separator/)
    // 再次 add（条目已存在、无可加项）→ 依赖剥离残留 [] 完成修复。
    const result = ensureRoots(damaged, ['/app/src'], cwd, 'dsh-code-finder-mount')
    expect(result.added).toEqual([])
    expect(result.skipped).toEqual(['/app/src'])
    expect(result.changed).toBe(true) // 修复本身就是一次变更
    expect(result.source).toBe(seeded.source) // 与从未损坏过的产物逐字节一致
    const parsed = loadOverlay(result.source) as Array<{ id?: string }>
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0]?.id).toBe('dsh-code-finder-mount')
    const again = ensureRoots(result.source, ['/app/src'], cwd, 'dsh-code-finder-mount')
    expect(again.changed).toBe(false)
  })

  it('损坏文件 remove 全清 → 恢复为原始模板（注释 + []），load 成功为空数组', () => {
    const cwd = sandbox()
    const seeded = ensureRoots(TEMPLATE, ['/app/src'], cwd, 'dsh-code-finder-mount')
    const damaged = seeded.source.replace('\n\n# dsh-code-finder roots', '\n[]\n\n# dsh-code-finder roots')
    expect(() => loadOverlay(damaged)).toThrow(/document separator/)
    const items = listRoots(damaged, cwd, 'dsh-code-finder-mount')?.map(i => i.value) ?? []
    expect(items).toHaveLength(3) // 两条播种默认根 + /app/src
    const removed = removeRoots(damaged, items, cwd, 'dsh-code-finder-mount')
    expect(removed.changed).toBe(true)
    expect(removed.removed).toHaveLength(3)
    expect(removed.source).toBe(TEMPLATE) // 逐字节恢复模板「无覆盖」形态
    expect(loadOverlay(removed.source)).toEqual([])
    // 恢复后 remove 零改动（幂等）。
    expect(removeRoots(removed.source, items, cwd, 'dsh-code-finder-mount').changed).toBe(false)
  })

  it('模板文件 add → remove 全 cycle：remove 后无覆盖、可再 add', () => {
    const cwd = sandbox()
    const seeded = ensureRoots(TEMPLATE, ['/app/src'], cwd, 'dsh-code-finder-mount')
    const items = listRoots(seeded.source, cwd, 'dsh-code-finder-mount')?.map(i => i.value) ?? []
    const removed = removeRoots(seeded.source, items, cwd, 'dsh-code-finder-mount')
    expect(removed.changed).toBe(true)
    expect(removed.source).not.toContain('dsh-code-finder')
    expect(removed.source).not.toContain('roots')
    expect(loadOverlay(removed.source)).toEqual([])
    // 再 add 重新成块（文件仍是合法单文档）。
    const again = ensureRoots(removed.source, ['/app/src'], cwd, 'dsh-code-finder-mount')
    expect(again.changed).toBe(true)
    expect(Array.isArray(loadOverlay(again.source))).toBe(true)
  })

  it('非列表文档形态 → RootsEditError 明确拒绝而非写出非法文件', () => {
    expect(() => ensureRoots('base: 42\n', ['/a'], sandbox())).toThrow(RootsEditError) // mapping 文档
    expect(() => ensureRoots('---\n- id: x\n', ['/a'], sandbox())).toThrow(RootsEditError) // `---` 多文档流
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

describe('roots: --entry-id 自定义挂载行 id（harness 型：官方行被守卫禁用）', () => {
  it('ensureRoots 支持自定义 entryId（全新补丁项用该 id）', () => {
    const cwd = sandbox()
    const result = ensureRoots('', ['/ui/src'], cwd, 'dsh-code-finder-mount')
    expect(result.changed).toBe(true)
    expect(result.source).toContain('- id: dsh-code-finder-mount')
    expect(result.source).not.toContain('- id: dsh-code-finder\n')
    const items = listRoots(result.source, cwd, 'dsh-code-finder-mount')
    expect(items?.map(i => i.value)).toContain('/ui/src')
    // 默认 id 视角看不到自定义块（补丁按 id 定位，两者互不影响）
    expect(listRoots(result.source, cwd)).toBeNull()
  })

  it('ensureRoots 按 entryId 幂等追加；不同 entryId 各自成块', () => {
    const cwd = sandbox()
    const once = ensureRoots('', ['/a'], cwd, 'mount-x')
    const twice = ensureRoots(once.source, ['/a'], cwd, 'mount-x')
    expect(twice.changed).toBe(false)
    expect(twice.skipped).toEqual(['/a'])
    // 另一种 entryId（如官方行）→ 新建独立块，互不覆盖
    const other = ensureRoots(once.source, ['/b'], cwd)
    expect(other.source).toContain('- id: dsh-code-finder')
    expect(other.source).toContain('- id: mount-x')
    expect(other.source).toContain('- /b')
  })

  it('removeRoots 按 entryId 清空整块', () => {
    const cwd = sandbox()
    const once = ensureRoots('', ['/a'], cwd, 'mount-x')
    const items = listRoots(once.source, cwd, 'mount-x')?.map(i => i.value) ?? []
    const removed = removeRoots(once.source, items, cwd, 'mount-x')
    expect(removed.changed).toBe(true)
    expect(removed.source).not.toContain('mount-x')
  })
})

describe('roots: findDcfMountRowIds（status 的自定义挂载行诊断）', () => {
  it('提取 insert 块与顶层补丁里的 dcf 挂载行 id（按行序，去重）', () => {
    const source = [
      '- insert:',
      '    - id: code-finder-mount',
      "      name: '@havocrao/dsh-code-finder'",
      '      disabled: !!js "process.env.NODE_ENV !== \'development\'"',
      '    - id: other-plugin',
      "      name: '@deepseek-ai/other'",
      '- id: dsh-code-finder',
      "  name: '@havocrao/dsh-code-finder'",
      '',
    ].join('\n')
    expect(findDcfMountRowIds(source)).toEqual(['code-finder-mount', 'dsh-code-finder'])
    // insert 容器的 group id 不会抢占（最近的 `- id:` 才是行 id）
    const nested = [
      '- id: web-app',
      '  insert:',
      '    - id: dsh-code-finder-mount',
      "      name: '@havocrao/dsh-code-finder'",
      '',
    ].join('\n')
    expect(findDcfMountRowIds(nested)).toEqual(['dsh-code-finder-mount'])
  })

  it('无 dcf 挂载行 → []', () => {
    expect(findDcfMountRowIds('# 无 dcf\n- insert:\n    - id: ui-theme\n')).toEqual([])
    expect(findDcfMountRowIds('')).toEqual([])
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

  it('真实踩坑复现：模板（注释+[]）上 add --entry-id → 文件为合法单文档纯数组；重复 add 幂等；remove 恢复 []', async () => {
    const home = sandbox()
    process.env.DSH_HOME = home
    const profile = join(home, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
    // deepseek-harness 生成 profile 时留下的模板文件（注释 + [] 空数组文档）。
    writeFileSync(join(profile, 'cordis.patch.yml'), `${TEMPLATE}\n`)

    expect(await runCli(['roots', 'add', 'web', '/app/src', '--entry-id', 'dsh-code-finder-mount', '--quiet'])).toBe(0)
    const patch = join(profile, 'cordis.patch.yml')
    let content = readFileSync(patch, 'utf8')
    // 产物必须能被 js-yaml 单文档 load（这就是宿主 loader 的解析方式）。
    const parsedAdd = loadOverlay(content) as Array<{ id?: string, config?: { roots?: string[] } }>
    expect(Array.isArray(parsedAdd)).toBe(true)
    expect(parsedAdd[0]?.id).toBe('dsh-code-finder-mount')
    expect(parsedAdd[0]?.config?.roots).toContain('/app/src')

    // 幂等：重复 add（同 id）文件零改动。
    expect(await runCli(['roots', 'add', 'web', '/app/src', '--entry-id', 'dsh-code-finder-mount', '--quiet'])).toBe(0)
    expect(readFileSync(patch, 'utf8')).toBe(content)

    // remove 全部（含播种默认根）→ 恢复模板空数组文档，load 成功为空数组。
    const all = listRoots(content, home, 'dsh-code-finder-mount')?.map(i => i.value) ?? []
    expect(await runCli(['roots', 'remove', 'web', ...all, '--entry-id', 'dsh-code-finder-mount', '--quiet'])).toBe(0)
    content = readFileSync(patch, 'utf8')
    expect(content).not.toContain('dsh-code-finder')
    expect(content).not.toContain('roots')
    expect(loadOverlay(content)).toEqual([])
    expect(content).toContain('[]')
  })

  it('用法错误与非法 profile 名 → 退出码 2', async () => {
    process.env.DSH_HOME = sandbox()
    expect(await runCli(['roots'])).toBe(2)
    expect(await runCli(['roots', 'frob', 'web'])).toBe(2)
    expect(await runCli(['roots', 'add', '../evil', '/a'])).toBe(2)
    expect(await runCli(['roots', 'list', 'web', 'extra'])).toBe(2)
    expect(await runCli(['roots', 'add', 'web', '/a', '--entry-id'])).toBe(2)
    expect(await runCli(['init', '--entry-id', 'x'])).toBe(2)
  })

  it('--entry-id：自定义挂载行 id 全链路（harness 型）', async () => {
    const home = sandbox()
    process.env.DSH_HOME = home
    const uiSrc = join(home, 'ui', 'src')

    expect(await runCli(['roots', 'add', 'web', uiSrc, '--entry-id', 'dsh-code-finder-mount', '--quiet'])).toBe(0)
    const patch = join(home, 'profiles', 'web', 'cordis.patch.yml')
    let content = readFileSync(patch, 'utf8')
    expect(content).toContain('- id: dsh-code-finder-mount')
    expect(content).not.toContain('- id: dsh-code-finder\n')
    expect(content).toContain(`- ${uiSrc}`)

    // 幂等：重复 add（同 id）零改动。
    expect(await runCli(['roots', 'add', 'web', uiSrc, '--entry-id', 'dsh-code-finder-mount', '--quiet'])).toBe(0)
    expect(readFileSync(patch, 'utf8')).toBe(content)

    // 默认 id 的 add 自成一块，不碰自定义块。
    expect(await runCli(['roots', 'add', 'web', '/other', '--quiet'])).toBe(0)
    content = readFileSync(patch, 'utf8')
    expect(content).toContain('- id: dsh-code-finder')
    expect(content).toContain('- id: dsh-code-finder-mount')

    // list 按各自 id 可见；remove 自定义块全清。
    expect(await runCli(['roots', 'list', 'web', '--entry-id', 'dsh-code-finder-mount', '--quiet'])).toBe(0)
    const all = listRoots(readFileSync(patch, 'utf8'), home, 'dsh-code-finder-mount')?.map(i => i.value) ?? []
    expect(await runCli(['roots', 'remove', 'web', ...all, '--entry-id', 'dsh-code-finder-mount', '--quiet'])).toBe(0)
    content = readFileSync(patch, 'utf8')
    expect(content).not.toContain('dsh-code-finder-mount')
    expect(content).toContain('- id: dsh-code-finder') // 官方行块原样保留
  })
})