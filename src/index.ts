/**
 * Node 侧源码索引（可选第④层）：扫「组件声明名 → {file, line}」。
 *
 * - `createSourceIndex({ roots, exts, exclude })`：启动时扫目录建
 *   「组件声明名 → {file, line, column}」Map（function / const 箭头 / class，
 *   组件名以大写开头——React 组件命名约定），带 mtime 增量更新；
 * - `search(name)`：**精确名优先、包含名次之**，同名多文件全部返回
 *   （overlay 里可切换）；
 * - `handleSearchRequest(req, res, index, deps)`：HTTP 薄封装，供
 *   src/cordis/host.ts 与接入方（be-sider）复用；只读、只扫配置 roots、
 *   信任 fence 拒绝越权。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

export interface SourceIndexOptions {
  /** 扫描根目录（绝对路径；不存在的目录静默跳过）。 */
  roots: string[]
  /** 参与扫描的扩展名；默认 ['.tsx', '.ts', '.jsx', '.js']。 */
  exts?: string[]
  /** 排除规则（路径片段或正则）；默认 node_modules + 常见产物目录。 */
  exclude?: Array<string | RegExp>
  /** 单个文件大小上限（字节），超过跳过；默认 1MB。 */
  maxFileSize?: number
  /**
   * 懒建索引：创建时不扫描，第一次 search()/refresh() 才建表。
   * 适合 roots 可能很大（如 ~/.dsh/source/current）的宿主——插件启动不阻塞，
   * 首次搜索（dev 工具场景）再付扫描成本。
   */
  lazy?: boolean
}

export interface SourceCandidate {
  /** 文件绝对路径。 */
  file: string
  line: number
  column: number
  /** 声明名。 */
  name: string
}

export interface SourceIndex {
  /** 按名称搜索：精确名优先、包含名次之；同名多文件全部返回。 */
  search(name: string): SourceCandidate[]
  /** 增量刷新：重走目录树，只重解析 mtime 变化的文件（新增/修改/删除都覆盖）。 */
  refresh(): void
  /** 释放资源（当前无 watcher，保留接口供未来 fs.watch 使用）。 */
  dispose(): void
}

/** 默认扩展名（plan §7）。 */
const DEFAULT_EXTS = ['.tsx', '.ts', '.jsx', '.js']
/** 默认排除：node_modules + 常见产物目录 + 隐藏目录。 */
const DEFAULT_EXCLUDES: Array<string | RegExp> = ['node_modules', '.git', 'lib', 'dist', 'out', 'coverage']
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024

interface IndexedFile {
  mtimeMs: number
  size: number
  /** 该文件里声明的组件（file 维度去重）。 */
  candidates: SourceCandidate[]
}

interface IndexState {
  /** 声明名 → 候选（搜索时再排序/过滤，保序稳定）。 */
  byName: Map<string, SourceCandidate[]>
  /** 绝对路径 → 已索引文件（mtime 增量更新用）。 */
  files: Map<string, IndexedFile>
}

/**
 * 组件声明正则（整文件匹配，跨行箭头函数也覆盖）：
 * - `(export )?(default )?function Foo(`
 * - `(export )?(default )?(const|let|var) Foo = (…) =>`（可跨行）
 * - `(export )?(default )?(const|let|var) Foo = (async )?function(`
 * - `(export )?(default )?class Foo`
 * 只收大写开头的名字（React 组件命名约定），过滤掉工具函数。
 */
const DECLARATION_PATTERN =
  /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:function[ \t]+([A-Z][A-Za-z0-9_$]*)[ \t]*(?:<[^>]*>)?[ \t]*\(|(?:const|let|var)[ \t]+([A-Z][A-Za-z0-9_$]*)[ \t]*=[ \t]*(?:async[ \t]+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)[ \t]*=>|(?:const|let|var)[ \t]+([A-Z][A-Za-z0-9_$]*)[ \t]*=[ \t]*(?:async[ \t]+)?function[ \t]*\(|class[ \t]+([A-Z][A-Za-z0-9_$]*))/g

/** 从代码文本中提取组件声明（含行/列）。 */
export function extractComponentDeclarations(code: string): SourceCandidate[] {
  const candidates: SourceCandidate[] = []
  DECLARATION_PATTERN.lastIndex = 0
  let line = 1
  let lineStart = 0
  for (const match of code.matchAll(DECLARATION_PATTERN)) {
    const name = (match[1] ?? match[2] ?? match[3] ?? match[4])
    if (name === undefined) continue
    const nameIndex = (match.index ?? 0) + match[0].indexOf(name)
    // 线性推进行计数：match 按文件顺序出现，只需前进到 name 所在行。
    while (lineStart < nameIndex) {
      const nextNewline = code.indexOf('\n', lineStart)
      if (nextNewline === -1 || nextNewline >= nameIndex) break
      lineStart = nextNewline + 1
      line += 1
    }
    candidates.push({ file: '', line, column: nameIndex - lineStart + 1, name })
  }
  return candidates
}

/** 路径是否命中排除规则：字符串规则按「路径段」精确匹配（避免 'out'/'lib' 误伤
 *  layout.css、about/ 这类含子串的合法路径），正则规则对完整路径测试。 */
function excludedPath(fullPath: string, excludes: Array<string | RegExp>): boolean {
  const segments = fullPath.split(/[\\/]/u)
  for (const rule of excludes) {
    if (typeof rule === 'string') {
      if (segments.includes(rule)) return true
    } else if (rule.test(fullPath)) {
      return true
    }
  }
  return false
}

function shouldParse(file: string, options: Required<Pick<SourceIndexOptions, 'exts' | 'maxFileSize'>>): boolean {
  const ext = extname(file)
  if (!options.exts.includes(ext)) return false
  try {
    const info = statSync(file)
    return info.isFile() && info.size <= options.maxFileSize
  } catch {
    return false
  }
}

/** 解析单个文件为 IndexedFile（读取失败静默跳过——构建中途生成的文件不致命）。 */
function parseFile(file: string): IndexedFile | null {
  try {
    const info = statSync(file)
    let code: string
    try {
      code = readFileSync(file, 'utf8')
    } catch {
      return null
    }
    const candidates = extractComponentDeclarations(code).map(candidate => ({ ...candidate, file }))
    return { mtimeMs: info.mtimeMs, size: info.size, candidates }
  } catch {
    return null
  }
}

/** 递归收集 roots 下所有待解析文件（相对 roots 的路径用于排除判断）。 */
function collectFiles(roots: string[], excludes: Array<string | RegExp>, exts: string[]): string[] {
  const files: string[] = []
  const visit = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return // 目录不可读/不存在：跳过
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      // 用绝对路径做包含判断（node_modules / .git / lib 等片段即可命中）。
      if (excludedPath(full, excludes)) continue
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile() && exts.includes(extname(full))) files.push(full)
    }
  }
  for (const root of roots) visit(root)
  return files
}

/** 创建源码索引（同步建表；`lazy: true` 时延后到首次 search/refresh）。 */
export function createSourceIndex(options: SourceIndexOptions): SourceIndex {
  const exts = options.exts ?? DEFAULT_EXTS
  const excludes = options.exclude ?? DEFAULT_EXCLUDES
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
  const state: IndexState = { byName: new Map(), files: new Map() }

  const indexFile = (file: string): void => {
    const parsed = parseFile(file)
    if (parsed === null) {
      removeFile(file)
      return
    }
    const previous = state.files.get(file)
    if (previous !== undefined && previous.mtimeMs === parsed.mtimeMs && previous.size === parsed.size) return
    // 替换旧条目：先删旧候选再插入新的（文件内声明可能增删）。
    removeFile(file)
    state.files.set(file, parsed)
    for (const candidate of parsed.candidates) {
      const list = state.byName.get(candidate.name)
      if (list === undefined) state.byName.set(candidate.name, [candidate])
      else list.push(candidate)
    }
  }

  const removeFile = (file: string): void => {
    const previous = state.files.get(file)
    if (previous === undefined) return
    for (const candidate of previous.candidates) {
      const list = state.byName.get(candidate.name)
      if (list === undefined) continue
      const index = list.indexOf(candidate)
      if (index !== -1) list.splice(index, 1)
      if (list.length === 0) state.byName.delete(candidate.name)
    }
    state.files.delete(file)
  }

  const refresh = (): void => {
    for (const file of collectFiles(options.roots, excludes, exts)) indexFile(file)
    // 清理已被删除/移出 roots 的索引条目。
    for (const file of [...state.files.keys()]) {
      const previous = state.files.get(file)
      if (previous === undefined) continue
      try {
        const info = statSync(file)
        if (info.mtimeMs === previous.mtimeMs && info.size === previous.size) continue
        indexFile(file)
      } catch {
        removeFile(file)
      }
    }
  }

  if (options.lazy !== true) refresh()

  const search = (name: string): SourceCandidate[] => {
    if (name === '') return []
    // 首次调用（lazy 模式）或增量检查都走 refresh：重走目录树，只重解析变化的文件。
    refresh()
    // 精确名优先、包含名次之（plan §7）；同名多文件全部返回，overlay 里可切换。
    const exact = state.byName.get(name) ?? []
    const includes: SourceCandidate[] = []
    for (const [candidateName, candidates] of state.byName) {
      if (candidateName !== name && candidateName.includes(name)) includes.push(...candidates)
    }
    return [...exact, ...includes]
  }

  return { search, refresh, dispose: () => { /* 无 watcher，暂无资源 */ } }
}

// ── HTTP 薄封装（供 cordis host 半与接入方复用）──────────────────────────────

/** 路由处理器收到的请求结构子集（与宿主 webServer 的 req 一致，见 be-sider SidebarHttpRequest）。 */
export interface CodeFinderHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

/** 响应结构子集（writeHead/end）。 */
export interface CodeFinderHttpResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

export interface SearchRequestDeps {
  /** 信任 fence：返回 false 直接 403（拒绝越权；cordis host 半自带 loopback fence）。 */
  isTrusted?: (req: CodeFinderHttpRequest) => boolean
  /** 返回候选上限；默认 20。 */
  limit?: number
}

/** 组件名合法性：只允许标识符字符，杜绝路径穿越/注入类输入。 */
const NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u
const MAX_NAME_LENGTH = 120

async function readJsonBody(req: CodeFinderHttpRequest): Promise<unknown> {
  try {
    const chunks: Uint8Array[] = []
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
    }
    if (chunks.length === 0) return undefined
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    const buffer = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder().decode(buffer)
    if (text.trim() === '') return undefined
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function writeJson(res: CodeFinderHttpResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(body))
}

function writeError(res: CodeFinderHttpResponse, status: number, code: string, message: string): void {
  writeJson(res, status, { ok: false, error: { code, message } })
}

/**
 * 处理 `POST /code-finder/api/search`。入参 `{ name }`，出参
 * `{ ok: true, data: [{ file, line, column? }] }`。只读、只扫配置 roots、
 * fence 拒绝越权（fence 判定失败返回 403）。
 */
export async function handleSearchRequest(
  req: CodeFinderHttpRequest,
  res: CodeFinderHttpResponse,
  index: SourceIndex,
  deps: SearchRequestDeps = {},
): Promise<void> {
  if (deps.isTrusted !== undefined && !deps.isTrusted(req)) {
    writeError(res, 403, 'forbidden', 'forbidden')
    return
  }
  if (req.method !== 'POST') {
    writeError(res, 405, 'method-error', 'method not allowed')
    return
  }
  const body = await readJsonBody(req)
  const name = (body as { name?: unknown } | undefined)?.name
  if (typeof name !== 'string' || name === '' || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
    writeError(res, 400, 'bad-request', 'name must be a component identifier')
    return
  }
  const candidates = index.search(name).slice(0, deps.limit ?? 20)
  writeJson(res, 200, {
    ok: true,
    data: candidates.map(({ file, line, column }) => ({ file, line, column })),
  })
}
