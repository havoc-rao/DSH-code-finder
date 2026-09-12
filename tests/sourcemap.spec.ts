/**
 * sourcemap 反查层（第⑤层）测试：VLQ 解码、坐标反查（二分/跨行回退）、
 * map 文件读取 + sources 路径解析（tsc 相对形式 / 打包器改写形式 / roots 兜底）、
 * HTTP 处理器（fence / 参数校验 / 无 map 返回 null）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decodeVlqValues,
  handleSourcemapRequest,
  lookupSourcePosition,
  mapArtifactPosition,
  resolveSourcePath,
  type CodeFinderHttpRequest,
  type CodeFinderHttpResponse,
  type SourceMapLike,
} from '../src/index'

// ── 测试用 VLQ 编码器：把数值数组编码成 sourcemap mappings 片段 ─────────────
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeVlq(value: number): string {
  let v = value < 0 ? ((-value) << 1) | 1 : value << 1
  let out = ''
  do {
    let digit = v & 31
    v >>>= 5
    if (v > 0) digit |= 32
    out += BASE64[digit]
  } while (v > 0)
  return out
}

/** 按 sourcemap 相对增量语义编码（每行的第一段 genCol 是行内绝对值，source 字段跨行累积）。 */
function encodeMappings(rows: number[][][]): string {
  let srcIdx = 0
  let origLine = 0
  let origCol = 0
  return rows.map(row => row.map(fields => {
    if (fields.length >= 4) {
      srcIdx += fields[1] ?? 0
      origLine += fields[2] ?? 0
      origCol += fields[3] ?? 0
    }
    return fields.map(encodeVlq).join('')
  }).join(',')).join(';')
}

describe('decodeVlqValues', () => {
  it('解码正负整数与多组值', () => {
    expect(decodeVlqValues(encodeVlq(0))).toEqual([0])
    expect(decodeVlqValues(encodeVlq(1))).toEqual([1])
    expect(decodeVlqValues(encodeVlq(-1))).toEqual([-1])
    expect(decodeVlqValues(encodeVlq(16))).toEqual([16])
    expect(decodeVlqValues(encodeVlq(-12345))).toEqual([-12345])
    // 三组连续编码（genCol=10, srcIdx=0, origLine=5）
    expect(decodeVlqValues(encodeVlq(10) + encodeVlq(0) + encodeVlq(5))).toEqual([10, 0, 5])
  })
})

describe('lookupSourcePosition', () => {
  // 段字段是相对增量（genCol 行内、source 下标/行列跨行累积）。编码结果：
  // 行1：gc0→(4,8)、gc8→(5,10)；行2：gc0→(6,9)、gc6→(7,10)；行3：gc4→(8,10)（1-based）
  const map: SourceMapLike = {
    version: 3,
    sources: ['src/Card.tsx'],
    mappings: encodeMappings([
      [[0, 0, 3, 7], [8, 0, 1, 2]],
      [[0, 0, 1, -1], [6, 0, 1, 1]],
      [[4, 0, 1, 0]],
    ]),
  }

  it('反查 1-based 坐标：取「生成列 ≤ 目标列」的最后一个段', () => {
    expect(lookupSourcePosition(map, 1, 2)).toEqual({ source: 'src/Card.tsx', line: 4, column: 8 })
    expect(lookupSourcePosition(map, 1, 8)).toEqual({ source: 'src/Card.tsx', line: 5, column: 10 })
    expect(lookupSourcePosition(map, 1, 9)).toEqual({ source: 'src/Card.tsx', line: 5, column: 10 })
  })

  it('目标列精确落在段上时取该段', () => {
    expect(lookupSourcePosition(map, 2, 5)).toEqual({ source: 'src/Card.tsx', line: 6, column: 9 })
    expect(lookupSourcePosition(map, 2, 6)).toEqual({ source: 'src/Card.tsx', line: 7, column: 10 })
    expect(lookupSourcePosition(map, 3, 4)).toEqual({ source: 'src/Card.tsx', line: 8, column: 10 })
  })

  it('目标列早于行内首段：回退到前面最近非空行的末段（跨行续写）', () => {
    expect(lookupSourcePosition(map, 3, 2)).toEqual({ source: 'src/Card.tsx', line: 7, column: 10 })
  })

  it('行号超出 map / 非法坐标 / 无源码信息的段 → undefined', () => {
    expect(lookupSourcePosition(map, 99, 1)).toBeUndefined()
    expect(lookupSourcePosition(map, 0, 1)).toBeUndefined()
    expect(lookupSourcePosition(map, 1, 0)).toBeUndefined()
    // 只有生成列、没有源码信息的段（单字段段，如 'A' = genCol 0）
    const bare: SourceMapLike = { version: 3, sources: ['a.ts'], mappings: 'A' }
    expect(lookupSourcePosition(bare, 1, 1)).toBeUndefined()
    // 四字段首段（'AAAA' = 0,0,0,0）是真实 map 的常规起点：正常反查
    const full: SourceMapLike = { version: 3, sources: ['x.ts'], mappings: 'AAAA' }
    expect(lookupSourcePosition(full, 1, 1)).toEqual({ source: 'x.ts', line: 1, column: 1 })
  })
})

describe('resolveSourcePath', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'code-finder-sm-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('tsc 相对 sources：map 目录 + source 直接还原为绝对路径', () => {
    const mapFile = join(root, 'lib/types/client/chat/MessageItem.js.map')
    mkdirSync(join(root, 'lib/types/client/chat'), { recursive: true })
    mkdirSync(join(root, 'src/client/chat'), { recursive: true })
    writeFileSync(join(root, 'src/client/chat/MessageItem.tsx'), '')
    // tsc 产物 map 的 sources 是相对 map 文件的（../../../../src/... 从
    // lib/types/client/chat 上溯 4 级到包根）
    const resolved = resolveSourcePath('../../../../src/client/chat/MessageItem.tsx', mapFile, undefined, [])
    expect(resolved).toBe(join(root, 'src/client/chat/MessageItem.tsx'))
  })

  it('打包器改写过的浏览器 URL 形式（../../../packages/.../src/...）：按 roots 兜底拼接', () => {
    const repo = join(root, 'repo')
    const mapFile = join(repo, 'packages/client/ui-chat/lib/client.js.map')
    mkdirSync(join(repo, 'packages/client/ui-chat/lib'), { recursive: true })
    mkdirSync(join(repo, 'packages/client/ui-chat/src/client/chat'), { recursive: true })
    writeFileSync(join(repo, 'packages/client/ui-chat/src/client/chat/MessageItem.tsx'), '')
    const resolved = resolveSourcePath(
      '../../../packages/client/ui-chat/src/client/chat/MessageItem.tsx',
      mapFile,
      undefined,
      [repo],
    )
    expect(resolved).toBe(join(repo, 'packages/client/ui-chat/src/client/chat/MessageItem.tsx'))
  })

  it('sourceRoot 参与拼接；无法命中时返回 map 目录解析出的候选（尽力而为）', () => {
    const mapFile = join(root, 'lib/A.js.map')
    mkdirSync(join(root, 'lib'), { recursive: true })
    const existing = resolveSourcePath('src/A.tsx', mapFile, '', [root])
    expect(existing).toBe(join(root, 'lib/src/A.tsx'))
    // sourceRoot 是绝对路径/URL 时忽略（无法本地拼接）
    expect(resolveSourcePath('A.tsx', mapFile, 'https://cdn/x', [])).toBe(join(root, 'lib/A.tsx'))
  })
})

describe('mapArtifactPosition', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'code-finder-map-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const writeMap = (jsRelative: string, map: SourceMapLike): string => {
    const js = join(root, jsRelative)
    mkdirSync(join(root, jsRelative.split('/').slice(0, -1).join('/')), { recursive: true })
    writeFileSync(js, '// generated\n')
    writeFileSync(`${js}.map`, JSON.stringify(map))
    return js
  }

  it('lib 产物坐标 → src 源码坐标（tsc map，sources 相对 map 目录）', () => {
    const srcFile = join(root, 'src/client/chat/MessageItem.tsx')
    mkdirSync(join(root, 'src/client/chat'), { recursive: true })
    writeFileSync(srcFile, '')
    const js = writeMap('lib/types/client/chat/MessageItem.js', {
      version: 3,
      sources: ['../../../../src/client/chat/MessageItem.tsx'],
      mappings: encodeMappings([[[0, 0, 95, 5], [9, 0, 0, 0]]]),
    })
    const mapped = mapArtifactPosition({ path: js, line: 1, column: 4 }, { roots: [] })
    expect(mapped).toEqual({ path: srcFile, line: 96, column: 6 })
  })

  it('无 map 文件 → undefined；行号超出 → undefined', () => {
    const js = writeMap('lib/A.js', { version: 3, sources: ['../src/A.tsx'], mappings: encodeMappings([[[0, 0, 0, 0]]]) })
    expect(mapArtifactPosition({ path: js, line: 1, column: 1 }, {})).toEqual({
      path: join(root, 'src/A.tsx'),
      line: 1,
      column: 1,
    })
    expect(mapArtifactPosition({ path: join(root, 'lib/NoMap.js'), line: 1, column: 1 }, {})).toBeUndefined()
    expect(mapArtifactPosition({ path: js, line: 99, column: 1 }, {})).toBeUndefined()
    expect(mapArtifactPosition({ path: js, line: 0, column: 1 }, {})).toBeUndefined()
  })

  it('反查结果就是产物自身（source 指向产物）→ undefined，避免自引用', () => {
    const js = writeMap('lib/types/A.js', {
      version: 3,
      sources: ['A.js'],
      mappings: encodeMappings([[[0, 0, 0, 0]]]),
    })
    expect(mapArtifactPosition({ path: js, line: 1, column: 1 }, {})).toBeUndefined()
  })
})

describe('handleSourcemapRequest', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'code-finder-sm-http-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const makeRequest = (options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): CodeFinderHttpRequest => {
    const chunks: Uint8Array[] = []
    if (options.body !== undefined) chunks.push(new TextEncoder().encode(JSON.stringify(options.body)))
    return {
      method: options.method ?? 'POST',
      url: '/code-finder/api/sourcemap',
      headers: options.headers ?? { host: 'localhost:5147' },
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk
      },
    }
  }

  interface FakeResponse {
    readonly status: number
    readonly body: string
    res: CodeFinderHttpResponse
  }

  const makeResponse = (): FakeResponse => {
    let status = 0
    let body = ''
    const res: CodeFinderHttpResponse = {
      statusCode: 0,
      writeHead: (s) => { status = s },
      end: (b) => { body = typeof b === 'string' ? b : new TextDecoder().decode(b) },
    }
    return {
      get status() { return status },
      get body() { return body },
      res,
    }
  }

  it('200：产物坐标反查为 src 坐标（data.path 是非空对象）', async () => {
    const srcFile = join(root, 'src/Card.tsx')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(srcFile, '')
    const js = join(root, 'lib/Card.js')
    mkdirSync(join(root, 'lib'), { recursive: true })
    writeFileSync(js, '// x\n')
    writeFileSync(`${js}.map`, JSON.stringify({
      version: 3,
      sources: ['../src/Card.tsx'],
      mappings: encodeMappings([[[0, 0, 10, 2]]]),
    }))

    const response = makeResponse()
    await handleSourcemapRequest(
      makeRequest({ body: { path: js, line: 1, column: 3 } }),
      response.res,
      { roots: [root] },
    )
    expect(response.status).toBe(200)
    const payload = JSON.parse(response.body) as { ok: boolean; data: { path: string; line: number; column: number } }
    expect(payload.ok).toBe(true)
    expect(payload.data).toEqual({ path: srcFile, line: 11, column: 3 })
    expect(payload.data.path).not.toBe(js)
  })

  it('无 map / 无映射 → 200 且 data 为 null（client 保留产物路径）', async () => {
    const response = makeResponse()
    await handleSourcemapRequest(
      makeRequest({ body: { path: '/abs/lib/NoMap.js', line: 1, column: 1 } }),
      response.res,
    )
    expect(response.status).toBe(200)
    expect((JSON.parse(response.body) as { data: unknown }).data).toBeNull()
  })

  it('信任 fence：未通过 → 403', async () => {
    const response = makeResponse()
    await handleSourcemapRequest(
      makeRequest({ body: { path: '/abs/lib/A.js', line: 1, column: 1 } }),
      response.res,
      { isTrusted: () => false },
    )
    expect(response.status).toBe(403)
  })

  it('非 POST → 405；非法入参 → 400', async () => {
    const get = makeResponse()
    await handleSourcemapRequest(makeRequest({ method: 'GET' }), get.res)
    expect(get.status).toBe(405)

    for (const bad of [
      { path: '', line: 1, column: 1 },
      { line: 1, column: 1 },
      { path: '/abs/A.js', line: 0, column: 1 },
      { path: '/abs/A.js', line: 1.5, column: 1 },
      { path: '/abs/A.js', line: 1 },
      { path: '/'.repeat(5000), line: 1, column: 1 },
    ]) {
      const res = makeResponse()
      await handleSourcemapRequest(makeRequest({ body: bad }), res.res)
      expect(res.status).toBe(400)
    }
  })
})