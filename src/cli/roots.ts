/**
 * dcf roots 命令 —— 管理一个 DSH profile 的 cordis.patch.yml 里针对
 * dcf 挂载行的 `config.roots` 覆盖。
 *
 * 背景（与 cordis-plugin-include 1.0.6 / dsh 0.1.2 实装对照，实证见
 * .dsh/delegations 复盘）：profile patch 层是**按 id 定位的补丁列表**
 * （`applyEntryPatches`），正确写法是顶层补丁项 `- id: <挂载行 id>`
 * + `config: { roots: [...] }`；`- overrides:` 包裹写法不被 loader 识别，
 * boot 时告警 "patch: id is required for non-insert patches" 并整体跳过
 * （静默 no-op）。
 *
 * 默认目标 id 是包内官方 bundle patch（cordis.patch.yml）挂载行的
 * `dsh-code-finder`（{@link ROOTS_TARGET_ID}）。**宿主侧若用了自定义 id 的
 * 挂载行**（如 deepseek-harness 接入时手写的 `dsh-code-finder-mount`，官方行
 * 会被其 double-mount 守卫禁用），补丁必须指向**实际生效的那一行**——用
 * `dcf roots add <profile> <path> --entry-id dsh-code-finder-mount`（或
 * `remove`/`list` 同款）。对已禁用行打补丁是静默 no-op：config 改了，行不挂载。
 *
 * 覆盖语义：`config.roots` 是**完全替换**（host 半 resolveHostConfig 只在
 * 完全没有 roots 键时回退默认 `~/.dsh/source/current` + `<host cwd>/src`
 * （+ monorepo packages/apps 补位），见 src/cordis/host.ts 的
 * `config?.roots ?? defaultRoots()`；patch 层也是整键赋值）。所以本 CLI 创建
 * 新覆盖块时**播种两条默认根**（写全、保持"无覆盖时的行为"），已有列表只做
 * 幂等追加，绝不改写用户条目。
 *
 * 全部为文本手术（与 config-edit.ts 同风格）：零运行时依赖、字节级保留
 * 用户内容、可重复执行（幂等）、不写任何备份文件。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** dcf 官方 bundle patch（随包发布的 cordis.patch.yml）挂载行的 entry id。 */
export const ROOTS_TARGET_ID = 'dsh-code-finder'

/** 创建新覆盖块时播种的默认根（与 host 半 defaultRoots() 一一对应）。 */
export const DEFAULT_ROOT_HOME = '.dsh/source/current'
export const DEFAULT_ROOT_CWD_SRC = "!!js \"process.cwd() + '/src'\""

/** 新块头部注释（也是后续整块删除时回收注释的标记）。 */
export const BLOCK_HEADER = [
  '# dsh-code-finder roots 覆盖 —— 由 `dcf roots add|remove|list <profile>` 维护。',
  '# config.roots 是**完全替换**（host 半只在完全没有 roots 覆盖时才回退默认），',
  '# 默认 roots（~/.dsh/source/current + <host cwd>/src）不会自动合并，需要保留',
  '# 就显式列在这里；下面两条默认根由 dcf 创建本块时播种，不需要可删除。',
]

export class RootsEditError extends Error {}

/** 解析后的一个 roots 列表项（保持原始文本）。 */
export interface RootsItem {
  /** 去缩进后的整行原文（含 `- ` 前缀）。 */
  raw: string
  /** 列表项内容文本（`- ` 之后的部分）。 */
  value: string
  /** 幂等比较键（literal 归一化绝对路径 / js 表达式原文）。 */
  key: string
  /** 是否是 `!!js <expr>` 表达式项。 */
  isJs: boolean
  /** 所在行号（0-based）。 */
  line: number
}

/** 定位到的 `- id: <entryId>` 补丁块结构。 */
export interface RootsBlock {
  /** `- id:` 行号（0-based）。 */
  entryIndex: number
  /** `- id:` 行缩进。 */
  entryIndent: string
  /** `config:` 子键行号（可无）。 */
  configIndex: number | undefined
  /** `roots:` 子键行号（可无）。 */
  rootsIndex: number | undefined
  /** roots 列表项的统一缩进（无列表时按 config 缩进推算）。 */
  itemIndent: string
  items: RootsItem[]
}

/** path 相关处理：`~`/`~/x` 展开 + 相对路径按当前 cwd 解析 + 去尾斜杠。 */
export function normalizeLiteralRoot(value: string, cwd = process.cwd()): string {
  let input = value.trim()
  // 剥掉 YAML 引号后再归一化（已有文件里可能是带引号的条目）。
  input = unquote(input)
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return join(homedir(), input.slice(2))
  const abs = isAbsolute(input) ? input : resolve(cwd, input)
  if (abs.length > 1) return abs.replace(/[\\/]+$/u, '')
  return abs
}

/** 剥一对单/双引号（若整个字符串被包裹）。 */
function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    if ((first === '"' || first === "'") && trimmed.endsWith(first)) return trimmed.slice(1, -1)
  }
  return trimmed
}

/** 解析 roots 行的比较键：js 表达式取原文（精确去重），literal 取归一化路径。 */
export function rootsItemKey(value: string, cwd = process.cwd()): { key: string, isJs: boolean } {
  const trimmed = value.trim()
  if (trimmed.startsWith('!!js ')) {
    // `!!js "expr"` / `!!js 'expr'` / `!!js expr` 三种形态。
    let expr = trimmed.slice('!!js '.length).trim()
    expr = unquote(expr)
    return { key: expr, isJs: true }
  }
  return { key: normalizeLiteralRoot(trimmed, cwd), isJs: false }
}

/** 行是否为 `- id: <value>` 形态（顶层或缩进均可），返回 id 值。 */
function rowIdOf(line: string): string | undefined {
  const match = /^[ \t]*- id:\s*(?:'([^']+)'|"([^"]+)"|(\S+))/u.exec(line)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

/** 在 [start, end) 行区间内找第一个「缩进大于 parentIndent 且键为 key」的行。 */
function findChild(lines: string[], start: number, end: number, parentIndent: string, key: string): number | undefined {
  for (let i = start; i < end; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = /^[ \t]*/u.exec(line)?.[0] ?? ''
    if (indent.length <= parentIndent.length) return undefined // 已离开父块（只找紧邻子级）
    if (new RegExp(`^[ \t]*${key}:`).test(line)) return i
    // 只探测同层子键，避免深入别的子树 —— 无需继续：遇到与父同层的行即停。
  }
  return undefined
}

/** 行首非空白内容之后（冒号后）是否还有非注释内容（flow 风格判断）。 */
function hasInlineContent(line: string): boolean {
  const after = line.replace(/^[ \t]*\S+\s*:[ \t]*/u, '')
  return after !== '' && !after.startsWith('#')
}

/** 定位 profile patch 里的 dcf roots 覆盖块（无则返回 undefined）。
 *  @param entryId - 目标挂载行 id（默认官方行 {@link ROOTS_TARGET_ID}）。 */
export function findRootsBlock(lines: string[], cwd = process.cwd(), entryId = ROOTS_TARGET_ID): RootsBlock | undefined {
  let entryIndex: number | undefined
  for (let i = 0; i < lines.length; i += 1) {
    const id = rowIdOf(lines[i] ?? '')
    if (id === entryId) { entryIndex = i; break }
  }
  if (entryIndex === undefined) return undefined
  const entryIndent = /^[ \t]*/u.exec(lines[entryIndex] ?? '')?.[0] ?? ''
  // 补丁项结束：下一个缩进 <= entryIndent 的非空/非注释行。
  let end = lines.length
  for (let i = entryIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = /^[ \t]*/u.exec(line)?.[0] ?? ''
    if (indent.length <= entryIndent.length && /^[ \t]*- /u.test(line)) { end = i; break }
  }
  const configIndex = findChild(lines, entryIndex + 1, end, entryIndent, 'config')
  let rootsIndex: number | undefined
  let itemIndent = `${entryIndent}    `
  const items: RootsItem[] = []
  if (configIndex !== undefined) {
    const configIndent = /^[ \t]*/u.exec(lines[configIndex] ?? '')?.[0] ?? ''
    if (hasInlineContent(lines[configIndex] ?? '')) {
      throw new RootsEditError('config 为 flow 风格（单行内联），无法安全追加 roots；请手动展开后重试')
    }
    rootsIndex = findChild(lines, configIndex + 1, end, configIndent, 'roots')
    if (rootsIndex !== undefined) {
      const rootsIndent = /^[ \t]*/u.exec(lines[rootsIndex] ?? '')?.[0] ?? ''
      if (hasInlineContent(lines[rootsIndex] ?? '')) {
        throw new RootsEditError('roots 为 flow 风格（inline []），无法安全追加；请手动展开后重试')
      }
      itemIndent = `${rootsIndent}  `
      // 收集列表项：连续缩进 > rootsIndent 的 `- ` 行（注释/空行跳过但仍继续）。
      for (let i = rootsIndex + 1; i < end; i += 1) {
        const line = lines[i] ?? ''
        if (line.trim() === '' || line.trim().startsWith('#')) continue
        const indent = /^[ \t]*/u.exec(line)?.[0] ?? ''
        if (indent.length <= rootsIndent.length) break
        const match = /^[ \t]*- (.*)$/u.exec(line)
        if (match !== null) {
          const value = match[1] ?? ''
          items.push({ raw: line, value, ...rootsItemKey(value, cwd), line: i })
          itemIndent = indent
        }
      }
    } else {
      itemIndent = `${configIndent}    `
    }
  } else {
    itemIndent = `${entryIndent}    `
  }
  return { entryIndex, entryIndent, configIndex, rootsIndex, itemIndent, items }
}

/** YAML 标量转义（仅在必要时加单引号；单引号内 `'` 翻倍）。 */
function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_./+~-]+$/.test(value) && !value.includes(':')) return value
  return `'${value.replace(/'/gu, "''")}'`
}

/** 列 0 的孤立 `[]` 空数组文档行（deepseek-harness 的 profile 模板形态）。
 *  trim 后整行就是 flow 风格空序列（容忍 `[ ]` 与尾部注释）。只认列 0 ——
 *  缩进的 `  []` 可能是映射值的合法续行（如 `roots:` 下换行写空列表），不能动。 */
const STRAY_EMPTY_ARRAY_DOC = /^\[[ \t]*\](?:[ \t]+#.*)?$/u

/** 从源行中移除「列 0 孤立 `[]` 空数组文档」行：模板遗留 / 旧版 bug 直接在
 *  模板文件上追加块留下的非法多文档残留（`[]` 之后无 `---` 就跟列表条目，
 *  js-yaml 单文档 load 必抛 YAMLException）。返回清理后的行数组与移除行数。
 *  零依赖纯文本手术，与其它读写一致。 */
function stripStrayEmptyArrayDocs(lines: readonly string[]): { cleaned: string[], removed: number } {
  const cleaned: string[] = []
  let removed = 0
  for (const line of lines) {
    if (line.startsWith('[') && STRAY_EMPTY_ARRAY_DOC.test(line.trim())) {
      removed += 1
      continue
    }
    cleaned.push(line)
  }
  return { cleaned, removed }
}

/**
 * 确保 patch 源里存在 dcf 的 roots 覆盖：
 * - 目标补丁项/列表不存在 → 追加新补丁项并**播种两条默认根**（写全语义）；
 * - 列表已存在 → 只追加缺失项（按归一化键幂等，js 表达式按原文精确去重）。
 * 绝不改写既有条目；返回变更后的源码与逐项结果。
 *
 * 文件安全（bug 回归）：写入前先剥离「列 0 孤立 `[]` 空数组文档」行——模板
 * 文件的 `[]`（或旧版 bug 在其后追加块留下的残留）会让产物变成无 `---` 分隔
 * 的多文档流，宿主 js-yaml 单文档 load 必炸；剥离后再追加/更新，产物始终是
 * 合法单文档纯数组。空文件/纯注释/`- ` 条目列表之外的非列表文档形态追加必
 * 然错位，改为抛出 {@link RootsEditError} 明确拒绝，绝不写出非法文件。
 * @param entryId - 目标挂载行 id（默认官方行 {@link ROOTS_TARGET_ID}；
 *   宿主自定义挂载行 id 时传入，如 dsh-code-finder-mount）。
 */
export function ensureRoots(
  source: string,
  additions: readonly string[],
  cwd = process.cwd(),
  entryId = ROOTS_TARGET_ID,
): { source: string, changed: boolean, added: string[], skipped: string[] } {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const { cleaned: lines, removed: stripped } = stripStrayEmptyArrayDocs(source.split(/\r?\n/u))
  const requested = additions.map(value => ({ value: value.trim(), ...rootsItemKey(value, cwd) }))
  const seen = new Set<string>()
  const added: string[] = []
  const skipped: string[] = []
  const block = findRootsBlock(lines, cwd, entryId)
  if (block !== undefined && block.rootsIndex !== undefined) {
    const existing = new Set(block.items.map(item => item.key))
    // 在列表末尾追加（保留列表内注释；对齐已有条目缩进）。
    const insertAt = block.items.length > 0
      ? (block.items[block.items.length - 1]?.line ?? 0) + 1
      : block.rootsIndex + 1
    for (const item of requested) {
      if (seen.has(item.key)) { skipped.push(item.value); continue }
      seen.add(item.key)
      if (existing.has(item.key)) { skipped.push(item.value); continue }
      const text = item.isJs ? item.value : yamlScalar(normalizeLiteralRoot(item.value, cwd))
      lines.splice(insertAt, 0, `${block.itemIndent}- ${text}`)
      existing.add(item.key)
      added.push(item.value)
    }
    if (added.length === 0) {
      // 无可加条目：若剥离了孤立 `[]`（旧版 bug 的损坏文件），提交修复。
      return { source: stripped > 0 ? lines.join(eol) : source, changed: stripped > 0, added, skipped }
    }
    return { source: lines.join(eol), changed: true, added, skipped }
  }
  // 无 roots 列表（覆盖块不存在 / 只有补丁项无 config / 有 config 无 roots）：
  // 创建列表并播种两条默认根（写全语义：无覆盖时 host 本会用默认 roots）。
  const seeds: string[] = [join(homedir(), DEFAULT_ROOT_HOME), DEFAULT_ROOT_CWD_SRC]
  const items: string[] = []
  for (const seed of seeds) {
    const parsed = rootsItemKey(seed)
    if (!items.some(existing => rootsItemKey(existing).key === parsed.key)) items.push(seed)
  }
  for (const item of requested) {
    if (seen.has(item.key)) { skipped.push(item.value); continue }
    seen.add(item.key)
    if (items.some(existing => rootsItemKey(existing, cwd).key === item.key)) { skipped.push(item.value); continue }
    items.push(item.value)
    added.push(item.value)
  }
  const itemLines = items.map(item => {
    const parsed = rootsItemKey(item)
    return `      - ${parsed.isJs ? item : yamlScalar(normalizeLiteralRoot(item, cwd))}`
  })
  if (block !== undefined) {
    // 已有 `- id:` 补丁项：在项内补齐 config / roots（继承既有子键缩进风格）。
    const baseIndent = block.entryIndent
    const configIndent = block.configIndex !== undefined
      ? /^[ \t]*/u.exec(lines[block.configIndex] ?? '')?.[0] ?? `${baseIndent}  `
      : `${baseIndent}  `
    const rootsIndent = `${configIndent}  `
    const gap = block.configIndex === undefined
      ? blockEnd(lines, block.entryIndex, block.entryIndent)
      : blockEnd(lines, block.configIndex, configIndent)
    const inserted: string[] = []
    if (block.configIndex === undefined) {
      inserted.push(`${configIndent}config:`, `${rootsIndent}roots:`)
    } else if (block.rootsIndex === undefined) {
      inserted.push(`${rootsIndent}roots:`)
    }
    inserted.push(...itemLines.map(line => line.replace(/^ {6}/u, `${rootsIndent}  `)))
    lines.splice(gap, 0, ...inserted)
    return { source: lines.join(eol), changed: true, added, skipped }
  }
  // 全新补丁项：整块追加到文件末尾（带回车分隔与 dcf 头部注释）。只有文件
  // 为空/纯注释（孤立 `[]` 已在上方剥离），或本身就是 `- ` 块序列时追加才是
  // 合法的单文档；其它文档形态（mapping/标量/`---` 多文档流）追加必然错位，
  // 明确报错而不是写出宿主 loader 解析失败的文件。
  const out = [...lines]
  while (out.length > 0 && (out[out.length - 1] ?? '').trim() === '') out.pop()
  const firstContent = out.find(line => line.trim() !== '' && !line.trim().startsWith('#'))
  if (firstContent !== undefined && !/^[ \t]*- /u.test(firstContent)) {
    throw new RootsEditError(
      `patch 文件首条内容不是补丁列表项（"${firstContent.trim().slice(0, 48)}"），无法安全追加 roots 覆盖块；`
      + '请把文件整理为条目列表或空数组 `[]` 后重试',
    )
  }
  const tail = out.length > 0 && (out[out.length - 1] ?? '').trim() !== '' ? [''] : []
  const final = [...out, ...tail, ...BLOCK_HEADER, `- id: ${entryId}`, '  config:', '    roots:', ...itemLines, '']
  return { source: final.join(eol), changed: true, added, skipped }
}

/** 一个块（自 startIndex 起的子键区）的结束行：下一个缩进 <= 父缩进的非空行。 */
function blockEnd(lines: string[], startIndex: number, parentIndent: string): number {
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = /^[ \t]*/u.exec(line)?.[0] ?? ''
    if (indent.length <= parentIndent.length) return i
  }
  return lines.length
}

/** 移除指定 roots（literal 按归一化键、js 按表达式原文匹配）；列表清空时整个
 *  补丁项连同 dcf 头部注释一起删除（恢复「无覆盖 → 默认 roots」）。若清空后
 *  文件只剩注释/空行，补回模板形态的空数组文档 `[]`（空输入会让宿主 js-yaml
 *  单文档 load 抛 "expected a document"）。写入前同样先剥离孤立 `[]` 行，
 *  因此对旧版 bug 损坏的文件（`[]` + 追加块）执行 remove 也能一键修复。
 *  @param entryId - 目标挂载行 id（默认官方行 {@link ROOTS_TARGET_ID}）。 */
export function removeRoots(
  source: string,
  removals: readonly string[],
  cwd = process.cwd(),
  entryId = ROOTS_TARGET_ID,
): { source: string, changed: boolean, removed: string[], missing: string[] } {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  // 先剥离「列 0 孤立 `[]` 空数组文档」行再分析；只有文件里确实涉及 dcf
  // 补丁块（旧版 bug 的损坏残留：`[]` + 追加块）时才提交这次剥离修复——
  // 无 dcf 块的纯净模板/无覆盖文件保持逐字节原样（剥离只会让宿主 load 更糟）。
  const { cleaned: lines, removed: stripped } = stripStrayEmptyArrayDocs(source.split(/\r?\n/u))
  let block: RootsBlock | undefined
  try {
    block = findRootsBlock(lines, cwd, entryId)
  } catch {
    return { source: stripped > 0 ? lines.join(eol) : source, changed: stripped > 0, removed: [], missing: removals.map(r => r.trim()) }
  }
  if (block === undefined || block.rootsIndex === undefined) {
    return { source, changed: false, removed: [], missing: removals.map(r => r.trim()) }
  }
  const targets = removals.map(value => ({ value: value.trim(), ...rootsItemKey(value, cwd) }))
  const dead = new Set<number>()
  for (const item of block.items) {
    if (targets.some(t => t.key === item.key)) dead.add(item.line)
  }
  const removed = targets.filter(t => dead.size > 0 && block?.items.some(item => item.key === t.key)).map(t => t.value)
  const missing = targets.filter(t => !removed.includes(t.value)).map(t => t.value)
  if (dead.size === 0) {
    return { source: stripped > 0 ? lines.join(eol) : source, changed: stripped > 0, removed, missing }
  }
  let next = lines.filter((_, i) => !dead.has(i))
  const remainingItems = block.items.filter(item => !dead.has(item.line))
  if (remainingItems.length === 0) {
    // 清空：删除 roots 键 + config 键 + `- id:` 补丁项 + 上方 dcf 头部注释。
    const entryEnd = (() => {
      for (let i = block.entryIndex + 1; i < next.length; i += 1) {
        const line = next[i] ?? ''
        if (line.trim() === '' || line.trim().startsWith('#')) continue
        const indent = /^[ \t]*/u.exec(line)?.[0] ?? ''
        if (indent.length <= block.entryIndent.length && /^[ \t]*- /u.test(line)) return i
      }
      return next.length
    })()
    next = next.filter((_, i) => i < block.entryIndex || i >= entryEnd)
    // 回收正上方的连续注释块中属于 dcf 的部分：只从包含标记 `dsh-code-finder roots`
    // 的那一行往下删，标记之上的用户注释原样保留。
    let k = block.entryIndex - 1
    const run: number[] = []
    while (k >= 0 && (next[k] ?? '').trim().startsWith('#')) { run.unshift(k); k -= 1 }
    const marker = run.findIndex(i => (next[i] ?? '').includes('dsh-code-finder roots'))
    if (marker !== -1) {
      const dropFrom = run[marker] ?? 0
      next = [...next.slice(0, dropFrom), ...next.slice(block.entryIndex)]
    } else {
      next = [...next.slice(0, block.entryIndex), ...next.slice(entryEnd)]
    }
    while (next.length > 0 && (next[next.length - 1] ?? '').trim() === '') next.pop()
    // 剩余只有注释/空行 → 补回模板形态的空数组文档 `[]`（恢复「无覆盖」的
    // 模板状态；也为宿主 loader 兜底：空输入会让 js-yaml 单文档 load 抛
    // "expected a document, but the input is empty"）。
    if (!next.some(line => line.trim() !== '' && !line.trim().startsWith('#'))) next.push('[]')
  }
  return { source: next.join(eol), changed: true, removed, missing }
}

/** 列出当前覆盖块里的 roots（原始文本），无覆盖返回 null。
 *  @param entryId - 目标挂载行 id（默认官方行 {@link ROOTS_TARGET_ID}）。 */
export function listRoots(source: string, cwd = process.cwd(), entryId = ROOTS_TARGET_ID): RootsItem[] | null {
  const lines = source.split(/\r?\n/u)
  try {
    const block = findRootsBlock(lines, cwd, entryId)
    return block?.rootsIndex !== undefined ? block.items : null
  } catch {
    return null
  }
}

/**
 * 检测「无效的 `- overrides:` 包裹写法」（早期文档/手工编辑常见；当前 loader
 * 不识别，boot 会告警并跳过）。返回 true 表示发现一个含 dcf 键的无效块。
 */
export function hasInvalidOverridesBlock(source: string): boolean {
  const lines = source.split(/\r?\n/u)
  let inOverrides = false
  let overridesIndent = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = /^[ \t]*/u.exec(line)?.[0] ?? ''
    if (/^[ \t]*- overrides:/u.test(line)) { inOverrides = true; overridesIndent = indent; continue }
    if (inOverrides) {
      if (indent.length <= overridesIndent.length) inOverrides = false
      else if (trimmed === `${ROOTS_TARGET_ID}:` || trimmed.startsWith(`${ROOTS_TARGET_ID}: `)) return true
    }
  }
  return false
}

/** profile patch 文件路径（profile 目录下 cordis.patch.yml，仅存在 .yaml 时用 .yaml）。 */
export function profilePatchPath(profileDir: string): string {
  const yml = join(profileDir, 'cordis.patch.yml')
  const yaml = join(profileDir, 'cordis.patch.yaml')
  return existsSync(yaml) && !existsSync(yml) ? yaml : yml
}

/**
 * 从一份 cordis.patch.yml 源码里提取所有「挂载
 * `@havocrao/dsh-code-finder` 的行」的 entry id（行级扫描：name 行向前找最近
 * 的 `- id:` 行；insert 容器的 group id 在更远处，不会抢占）。
 *
 * 用于 status 诊断：宿主/聚合层可能用自定义 id 挂载（如 deepseek-harness 的
 * `dsh-code-finder-mount`），此时 roots 补丁若仍按官方行 id 写，会落到被
 * double-mount 守卫禁用（或不存在）的行上静默失效——诊断出非官方 id 就提示
 * `--entry-id`。
 */
export function findDcfMountRowIds(source: string): string[] {
  const ids: string[] = []
  let lastEntryId: string | undefined
  for (const line of source.split(/\r?\n/u)) {
    const id = rowIdOf(line)
    if (id !== undefined) {
      lastEntryId = id
      continue
    }
    const nameMatch = /^[ \t]*name:\s*['"]?@havocrao\/dsh-code-finder['"]?\s*$/u.exec(line)
    if (nameMatch !== null && lastEntryId !== undefined && !ids.includes(lastEntryId)) {
      ids.push(lastEntryId)
    }
  }
  return ids
}