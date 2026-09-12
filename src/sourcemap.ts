/**
 * Sourcemap 反查层（第⑤层）：把「产物坐标」映射回「原始源码坐标」。
 *
 * 背景：构建产物（tsc 编译后的 lib/**\/*.js、tsdown/vite 打包输出）被 dcf 注入
 * `data-locatorjs = <产物文件>:<line>:<col>` 后，hover 拿到的是产物路径
 * （如 .../lib/types/client/chat/MessageItem.js:96），不是源码路径。tsc/打包器
 * 通常会在产物旁生成 `*.js.map`——本模块读取它、VLQ 解码 mappings，把
 * `{产物文件, 行, 列}` 反查成 `{源码文件, 行, 列}`。
 *
 * 与 transform 侧的关系：src/build/transform.ts 只把 map 透传给打包器（供
 * 浏览器 devtools 使用），运行时从不消费；本模块是它的运行期补位——host 半
 * 路由 `POST /code-finder/api/sourcemap` 即调用 {@link handleSourcemapRequest}，
 * client 半在 resolve 链拿到产物路径后异步升级为源码路径。
 *
 * 约定：
 * - 坐标 1-based（与 babel loc / data-locatorjs 一致）；
 * - sources 优先按「map 文件所在目录 + sourceRoot + source」解析为绝对路径，
 *   失败时兜底（打包器改写过的浏览器 URL 形式，如
 *   `../../../packages/client/ui-chat/src/...`）：去掉前导 `../` 后按配置 roots
 *   重新拼接，命中磁盘存在性校验；
 * - map 文件按 mtime+size 缓存（多次 hover 同一文件不重复读盘）；
 * - 零依赖：VLQ 解码器手写（~40 行），不引入 @jridgewell/trace-mapping。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'
import { readJsonBody, writeError, writeJson, type CodeFinderHttpRequest, type CodeFinderHttpResponse } from './http'

/** 兼容 RawSourceMap 子集（下游只消费 sources/mappings/sourceRoot）。 */
export interface SourceMapLike {
  version: number
  sources: string[]
  names?: string[]
  mappings: string
  sourceRoot?: string
  file?: string
}

/** 反查结果：原始源码文件（绝对/相对）与 1-based 行列。 */
export interface OriginalPosition {
  source: string
  line: number
  column: number
}

/** 反查入口入参：产物文件路径 + 1-based 行列。 */
export interface ArtifactPosition {
  path: string
  line: number
  column: number
}

/** 反查入口选项。roots 用于 sources 无法按 map 目录解析时的兜底拼接。 */
export interface SourcemapLookupOptions {
  roots?: string[]
}

// ── VLQ 解码（sourcemap mappings 字段格式）───────────────────────────────────

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_VALUES = new Int8Array(128).fill(-1)
for (let i = 0; i < BASE64_CHARS.length; i += 1) {
  BASE64_VALUES[BASE64_CHARS.charCodeAt(i)] = i
}

/** 解码一段 VLQ 编码的整数序列（每个整数小端 5-bit 分组，最高位为续位）。 */
export function decodeVlqValues(text: string): number[] {
  const values: number[] = []
  let shift = 0
  let value = 0
  for (const char of text) {
    const digit = BASE64_VALUES[char.charCodeAt(0)] ?? -1
    if (digit < 0) continue // 非法字符：跳过（map 损坏时不要抛）
    const continuation = (digit & 32) !== 0
    value += (digit & 31) << shift
    if (continuation) {
      shift += 5
    } else {
      values.push((value & 1) !== 0 ? -(value >> 1) : value >> 1)
      shift = 0
      value = 0
    }
  }
  return values
}

/** 解码后的一行：按生成列升序的段。 */
interface DecodedSegment {
  /** 生成列（0-based，行内绝对值）。 */
  genCol: number
  /** sources 下标（有源码信息时存在）。 */
  sourceIndex?: number
  /** 原始行（0-based 累积值）。 */
  origLine?: number
  /** 原始列（0-based 累积值）。 */
  origCol?: number
}

const DECODED_CACHE = new WeakMap<SourceMapLike, DecodedSegment[][]>()

/** 把 mappings 字符串解码为「生成行 → 段列表」（列的相对增量展开为绝对值；下标/行列跨行累积）。 */
export function decodeMappings(mappings: string): DecodedSegment[][] {
  const lines: DecodedSegment[][] = []
  let sourceIndex = 0
  let origLine = 0
  let origCol = 0
  for (const lineText of mappings.split(';')) {
    const segments: DecodedSegment[] = []
    let genCol = 0 // 生成列每行重置；sourceIndex/origLine/origCol 跨行累积
    if (lineText !== '') {
      for (const segmentText of lineText.split(',')) {
        if (segmentText === '') continue
        const values = decodeVlqValues(segmentText)
        const first = values[0]
        if (first === undefined) continue
        genCol += first
        const segment: DecodedSegment = { genCol }
        if (values.length >= 4) {
          sourceIndex += values[1] ?? 0
          origLine += values[2] ?? 0
          origCol += values[3] ?? 0
          segment.sourceIndex = sourceIndex
          segment.origLine = origLine
          segment.origCol = origCol
        }
        segments.push(segment)
      }
    }
    lines.push(segments)
  }
  return lines
}

/**
 * 反查：给定 map 与生成坐标（1-based），返回原始坐标。
 * 命中规则与浏览器 devtools 一致：取「生成列 ≤ 目标列」的最后一个段；目标列
 * 早于本行首段时回退到前面最近一个有段的非空行的末段（跨行续写的表达式）。
 * 行号超出 map / 该位置无源码信息时返回 undefined。
 */
export function lookupSourcePosition(
  map: SourceMapLike,
  line: number,
  column: number,
): OriginalPosition | undefined {
  if (line < 1 || column < 1) return undefined
  let decoded = DECODED_CACHE.get(map)
  if (decoded === undefined) {
    decoded = decodeMappings(map.mappings)
    DECODED_CACHE.set(map, decoded)
  }
  const lineIndex = line - 1
  if (lineIndex >= decoded.length) return undefined
  let segment: DecodedSegment | undefined
  const segments = decoded[lineIndex]
  if (segments !== undefined && segments.length > 0) {
    // 二分：最后一个 genCol ≤ column 的段
    let low = 0
    let high = segments.length - 1
    let best = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      const candidate = segments[mid]
      if (candidate !== undefined && candidate.genCol <= column) {
        best = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    if (best >= 0) {
      segment = segments[best]
    } else {
      // 目标列早于本行首段：回退到前面最近的非空行末段
      for (let prev = lineIndex - 1; prev >= 0 && segment === undefined; prev -= 1) {
        const prevSegments = decoded[prev]
        segment = prevSegments !== undefined && prevSegments.length > 0 ? prevSegments[prevSegments.length - 1] : undefined
      }
    }
  }
  if (segment === undefined || segment.sourceIndex === undefined
    || segment.origLine === undefined || segment.origCol === undefined) {
    return undefined
  }
  const source = map.sources[segment.sourceIndex]
  if (source === undefined) return undefined
  return { source, line: segment.origLine + 1, column: segment.origCol + 1 }
}

// ── map 文件读取（mtime+size 缓存）与 sources 解析 ───────────────────────────

interface CachedMap {
  mtimeMs: number
  size: number
  map: SourceMapLike
}

const MAP_CACHE = new Map<string, CachedMap>()
const MAP_CACHE_MAX = 200

/** 读取并校验 `<jsPath>.map`（缓存按 mtime+size 失效）；无 map 文件/损坏返回 undefined。 */
export function loadSourcemap(jsPath: string): SourceMapLike | undefined {
  const mapPath = `${jsPath}.map`
  let cached = MAP_CACHE.get(mapPath)
  try {
    const stat = statSync(mapPath)
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.map
    }
    const raw = JSON.parse(readFileSync(mapPath, 'utf8')) as Partial<SourceMapLike>
    if (!Array.isArray(raw.sources) || typeof raw.mappings !== 'string') return undefined
    const map: SourceMapLike = {
      version: typeof raw.version === 'number' ? raw.version : 3,
      sources: raw.sources.filter((source): source is string => typeof source === 'string'),
      mappings: raw.mappings,
      ...(typeof raw.sourceRoot === 'string' ? { sourceRoot: raw.sourceRoot } : {}),
      ...(typeof raw.file === 'string' ? { file: raw.file } : {}),
    }
    cached = { mtimeMs: stat.mtimeMs, size: stat.size, map }
    if (MAP_CACHE.size >= MAP_CACHE_MAX) MAP_CACHE.clear()
    MAP_CACHE.set(mapPath, cached)
    return map
  } catch {
    return undefined
  }
}

/** 解析 sources 条目为绝对路径：map 目录 + sourceRoot + source → 存在性兜底（roots 拼接）。 */
export function resolveSourcePath(
  source: string,
  mapFile: string,
  sourceRoot: string | undefined,
  roots: string[],
): string {
  const mapDir = resolve(mapFile, '..')
  const root = typeof sourceRoot === 'string' && sourceRoot !== '' && !isAbsolute(sourceRoot)
    && !/^[a-z][a-z0-9+.-]*:/iu.test(sourceRoot)
    ? sourceRoot
    : ''
  const candidate = resolve(mapDir, root, source)
  if (existsSync(candidate)) return candidate
  // 兜底：打包器改写过的 sources（浏览器 URL 相对形式，如
  // ../../../packages/.../src/...）——去掉前导 ../ 后按配置 roots 拼接。
  if (!isAbsolute(source)) {
    const suffix = normalize(source).replace(/^\.\.\/(?:\.\.\/)*/u, '').replace(/^\.\//u, '')
    if (suffix !== '' && suffix !== '..') {
      for (const r of roots) {
        const fromRoot = resolve(r, suffix)
        if (existsSync(fromRoot)) return fromRoot
      }
    }
  }
  return candidate
}

/**
 * 反查入口：给定产物坐标与可选 roots，返回源码坐标（绝对路径形式）。
 * 无 map / 无对应段 / 反查结果就是产物自身时返回 undefined（调用方保留原路径）。
 */
export function mapArtifactPosition(
  position: ArtifactPosition,
  options: SourcemapLookupOptions = {},
): ArtifactPosition | undefined {
  if (position.line < 1 || position.column < 1) return undefined
  const jsPath = resolve(position.path)
  const map = loadSourcemap(jsPath)
  if (map === undefined) return undefined
  const original = lookupSourcePosition(map, position.line, position.column)
  if (original === undefined) return undefined
  const source = resolveSourcePath(original.source, `${jsPath}.map`, map.sourceRoot, options.roots ?? [])
  if (source === '' || source === jsPath) return undefined
  return { path: source, line: original.line, column: original.column }
}

// ── HTTP 薄封装（供 cordis host 半注册 /code-finder/api/sourcemap）───────────

export interface SourcemapRequestDeps {
  /** 信任 fence：返回 false 直接 403（与 search 同款；cordis host 半自带 loopback fence）。 */
  isTrusted?: (req: CodeFinderHttpRequest) => boolean
  /** sources 兜底拼接用的扫描根（host 半的配置 roots）。 */
  roots?: string[]
}

const MAX_PATH_LENGTH = 4096

/**
 * 处理 `POST /code-finder/api/sourcemap`。入参 `{ path, line, column }`
 * （prod 产物坐标），出参 `{ ok: true, data: { path, line, column } | null }`
 * ——data 为 null 表示无反查结果（无 map / 坐标无映射），client 保留原产物路径。
 */
export async function handleSourcemapRequest(
  req: CodeFinderHttpRequest,
  res: CodeFinderHttpResponse,
  deps: SourcemapRequestDeps = {},
): Promise<void> {
  if (deps.isTrusted !== undefined && !deps.isTrusted(req)) {
    writeError(res, 403, 'forbidden', 'forbidden')
    return
  }
  if (req.method !== 'POST') {
    writeError(res, 405, 'method-error', 'method not allowed')
    return
  }
  const body = (await readJsonBody(req)) as { path?: unknown; line?: unknown; column?: unknown } | undefined
  const path = body?.path
  const line = body?.line
  const column = body?.column
  if (typeof path !== 'string' || path === '' || path.length > MAX_PATH_LENGTH
    || typeof line !== 'number' || !Number.isInteger(line) || line < 1
    || typeof column !== 'number' || !Number.isInteger(column) || column < 1) {
    writeError(res, 400, 'bad-request', 'path/line/column must be a path and positive integers')
    return
  }
  const mapped = mapArtifactPosition({ path, line, column }, { roots: deps.roots ?? [] })
  writeJson(res, 200, { ok: true, data: mapped ?? null })
}