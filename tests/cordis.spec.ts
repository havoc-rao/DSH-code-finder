/**
 * cordis 包装测试（plan §8）：host 半路由（fence / 搜索 / 参数校验）+ client 半开关。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply as applyHost, resolveHostConfig, type CodeFinderHostConfig, type CodeFinderHostContext } from '../src/cordis/host'
import type { CodeFinderHttpRequest, CodeFinderHttpResponse } from '../src/index'

// ── client 半：mock 掉 setupCodeFinder，只验证开关与生命周期 ──────────────────
vi.mock('../src/client/index', () => ({
  setupCodeFinder: vi.fn(() => ({ destroy: vi.fn() })),
}))
import { setupCodeFinder } from '../src/client/index'
import { apply as applyClient, parseClientHotkeys, type CodeFinderClientContext } from '../src/cordis/client'

const setupMock = vi.mocked(setupCodeFinder)

// ── host 半的假 ctx / req / res ─────────────────────────────────────────────
interface FakeHostCtx {
  ctx: CodeFinderHostContext
  route(): { kind: string; path: string; handler: (req: CodeFinderHttpRequest, res: CodeFinderHttpResponse) => void | Promise<void> } | undefined
  dispose(): void
}

function makeHostCtx(trustedHosts: string[] = []): FakeHostCtx {
  let route: { kind: string; path: string; handler: (req: CodeFinderHttpRequest, res: CodeFinderHttpResponse) => void | Promise<void> } | undefined
  let disposer: (() => void) | undefined
  const ctx: CodeFinderHostContext = {
    webServer: { register: (r) => { route = r } },
    webRuntime: { trustedHosts },
    effect: (callback) => { disposer = callback() ?? undefined },
  }
  return { ctx, route: () => route, dispose: () => disposer?.() }
}

function makeRequest(options: { method?: string; url?: string; body?: unknown; headers?: Record<string, string> } = {}): CodeFinderHttpRequest {
  const chunks: Uint8Array[] = []
  if (options.body !== undefined) {
    chunks.push(new TextEncoder().encode(JSON.stringify(options.body)))
  }
  return {
    method: options.method ?? 'POST',
    url: options.url ?? '/code-finder/api/search',
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

function makeResponse(): FakeResponse {
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

let tmpRoot: string

function writeSource(relative: string, content: string): string {
  const file = join(tmpRoot, relative)
  mkdirSync(join(tmpRoot, relative.split('/').slice(0, -1).join('/')), { recursive: true })
  writeFileSync(file, content)
  return file
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'code-finder-'))
  setupMock.mockClear()
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
  vi.unstubAllEnvs()
  delete document.documentElement.dataset.codeFinder
  delete document.documentElement.dataset.codeFinderHotkeys
})

const HOST_CONFIG: CodeFinderHostConfig = { roots: [], exts: ['.tsx', '.ts'], exclude: ['node_modules'] }

// ── sourcemap fixture 用的小型 VLQ 编码器（与 sourcemap.spec.ts 同款）───────
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

describe('host 半：/code-finder/api/search 路由', () => {
  it('默认 roots：monorepo 布局（cwd/packages、cwd/apps）自动补位并命中（harness 型布局 e2e）', async () => {
    // deepseek-harness 型布局：源码全在 packages/<name>/src 下，cwd/src 不存在。
    writeSource('packages/client/ui-conversation/src/input/ReferenceChip.tsx',
      'export function ReferenceChip() { return <span/> }\n')
    writeSource('apps/web/src/App.tsx', 'export function App() { return <div/> }\n')
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpRoot)
    try {
      const { ctx, route, dispose } = makeHostCtx()
      applyHost(ctx) // 无 config → 走 defaultRoots()
      const response = makeResponse()
      await route()!.handler(makeRequest({ body: { name: 'ReferenceChip' } }), response.res)
      expect(response.status).toBe(200)
      const data = (JSON.parse(response.body) as { data: Array<{ file: string; line: number }> }).data
      expect(data.some(d => d.file.includes('packages/client/ui-conversation/src/input/ReferenceChip.tsx'))).toBe(true)
      const appResponse = makeResponse()
      await route()!.handler(makeRequest({ body: { name: 'App' } }), appResponse.res)
      const appData = (JSON.parse(appResponse.body) as { data: Array<{ file: string }> }).data
      expect(appData.some(d => d.file.includes('apps/web/src/App.tsx'))).toBe(true)
      dispose()
    } finally {
      cwdSpy.mockRestore()
    }
  })

  it('resolveHostConfig 默认 roots：目录存在才加入 packages/apps，~/.dsh 与 cwd/src 恒定在场', () => {
    mkdirSync(join(tmpRoot, 'packages'), { recursive: true })
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpRoot)
    try {
      const resolved = resolveHostConfig()
      expect(resolved.roots).toContain(join(tmpRoot, 'src'))
      expect(resolved.roots).toContain(join(tmpRoot, 'packages'))
      expect(resolved.roots).not.toContain(join(tmpRoot, 'apps'))
      // 显式配置仍是完全替换（默认 roots 不再并入）
      const explicit = resolveHostConfig({ roots: [join(tmpRoot, 'custom')] })
      expect(explicit.roots).toEqual([join(tmpRoot, 'custom')])
    } finally {
      cwdSpy.mockRestore()
    }
  })

  it('注册 prefix 路由并按 roots 建索引', async () => {
    writeSource('src/components/Sidebar.tsx', 'export function Sidebar() { return <div/> }\nconst Toolbar = () => <span/>\n')
    writeSource('src/App.tsx', 'const Sidebar = (props) => <div/>\n')
    const { ctx, route, dispose } = makeHostCtx()
    applyHost(ctx, { ...HOST_CONFIG, roots: [tmpRoot] })
    expect(route()).toBeDefined()
    expect(route()!.kind).toBe('prefix')
    expect(route()!.path).toBe('/code-finder/api')

    const response = makeResponse()
    await route()!.handler(makeRequest({ body: { name: 'Sidebar' } }), response.res)
    expect(response.status).toBe(200)
    const payload = JSON.parse(response.body) as { ok: boolean; data: Array<{ file: string; line: number }> }
    expect(payload.ok).toBe(true)
    expect(payload.data).toHaveLength(2)
    // 同名多文件全部返回（扫描顺序与目录序相关，只断言集合）
    const files = payload.data.map(d => d.file.split('/').pop())
    expect(files).toContain('Sidebar.tsx')
    expect(files).toContain('App.tsx')
    expect(payload.data.every(d => d.line > 0)).toBe(true)
    dispose()
  })

  it('精确名优先、包含名次之', async () => {
    writeSource('src/A.tsx', 'export function Sidebar() { return <div/> }\nexport function SidebarList() { return <ul/> }\n')
    const { ctx, route, dispose } = makeHostCtx()
    applyHost(ctx, { ...HOST_CONFIG, roots: [tmpRoot] })
    const response = makeResponse()
    await route()!.handler(makeRequest({ body: { name: 'Sidebar' } }), response.res)
    const data = (JSON.parse(response.body) as { data: Array<{ file: string }> }).data
    expect(data).toHaveLength(2)
    dispose()
  })

  it('信任 fence：跨站 / 未知 Host 拒绝 403', async () => {
    writeSource('src/A.tsx', 'export function Foo() { return <div/> }\n')
    const { ctx, route } = makeHostCtx([])
    applyHost(ctx, { ...HOST_CONFIG, roots: [tmpRoot] })

    const crossSite = makeResponse()
    await route()!.handler(makeRequest({ headers: { host: 'localhost:5147', 'sec-fetch-site': 'cross-site' } }), crossSite.res)
    expect(crossSite.status).toBe(403)

    const unknownHost = makeResponse()
    await route()!.handler(makeRequest({ headers: { host: 'evil.example.com' } }), unknownHost.res)
    expect(unknownHost.status).toBe(403)

    const noHost = makeResponse()
    await route()!.handler(makeRequest({ headers: {} }), noHost.res)
    expect(noHost.status).toBe(403)
  })

  it('loopback Host（含 127.x）放行', async () => {
    writeSource('src/A.tsx', 'export function Foo() { return <div/> }\n')
    const { ctx, route } = makeHostCtx()
    applyHost(ctx, { ...HOST_CONFIG, roots: [tmpRoot] })
    const response = makeResponse()
    await route()!.handler(makeRequest({ headers: { host: '127.0.0.1:8080' }, body: { name: 'Foo' } }), response.res)
    expect(response.status).toBe(200)
  })

  it('非 POST → 405；非法 name → 400', async () => {
    writeSource('src/A.tsx', 'export function Foo() { return <div/> }\n')
    const { ctx, route, dispose } = makeHostCtx()
    applyHost(ctx, { ...HOST_CONFIG, roots: [tmpRoot] })

    const get = makeResponse()
    await route()!.handler(makeRequest({ method: 'GET' }), get.res)
    expect(get.status).toBe(405)

    for (const bad of ['', '../../etc/passwd', 'a/b', 'x'.repeat(200)]) {
      const res = makeResponse()
      await route()!.handler(makeRequest({ body: { name: bad } }), res.res)
      expect(res.status).toBe(400)
    }
    dispose()
  })

  it('/code-finder/api/sourcemap 路由：产物坐标反查为当前 roots 下的 src 坐标', async () => {
    // tsc 两段式产物的最小形状：lib/types/Card.js + 同级 .js.map（sources 相对 map）
    writeSource('src/components/Card.tsx', 'export function Card() { return <div/> }\n')
    const js = writeSource('lib/types/components/Card.js', '// generated\n')
    writeFileSync(`${js}.map`, JSON.stringify({
      version: 3,
      sources: ['../../../../src/components/Card.tsx'],
      mappings: encodeMappings([[[0, 0, 0, 0]]]),
    }))
    const { ctx, route, dispose } = makeHostCtx()
    applyHost(ctx, { ...HOST_CONFIG, roots: [tmpRoot] })

    const response = makeResponse()
    await route()!.handler(makeRequest({
      url: '/code-finder/api/sourcemap',
      body: { path: js, line: 1, column: 3 },
    }), response.res)
    expect(response.status).toBe(200)
    const payload = JSON.parse(response.body) as { ok: boolean; data: { path: string; line: number; column: number } }
    expect(payload.ok).toBe(true)
    expect(payload.data.path).toBe(join(tmpRoot, 'src/components/Card.tsx'))
    expect(payload.data.line).toBe(1)
    // 反查路由同样受 fence 保护
    const denied = makeResponse()
    await route()!.handler(makeRequest({
      url: '/code-finder/api/sourcemap',
      headers: { host: 'evil.example.com' },
      body: { path: js, line: 1, column: 3 },
    }), denied.res)
    expect(denied.status).toBe(403)
    dispose()
  })
})

describe('client 半：dev 自动 setupCodeFinder', () => {
  it('dev 构建自动启用，fiber 释放时 destroy', () => {
    vi.stubEnv('NODE_ENV', 'development')
    let disposer: (() => void) | undefined
    const ctx: CodeFinderClientContext = {
      effect: (callback) => { disposer = callback() ?? undefined },
    }
    applyClient(ctx)
    expect(setupMock).toHaveBeenCalledWith({
      searchEndpoint: '/code-finder/api/search',
      sourcemapEndpoint: '/code-finder/api/sourcemap',
    })
    disposer?.()
    expect(setupMock.mock.results[0]?.value.destroy).toHaveBeenCalled()
  })

  it('生产构建不启用（零 runtime）', () => {
    vi.stubEnv('NODE_ENV', 'production')
    applyClient({ effect: () => undefined })
    expect(setupMock).not.toHaveBeenCalled()
  })

  it('未设 NODE_ENV（非 dev 语义）不启用——空壳 overlay 不存在', () => {
    vi.stubEnv('NODE_ENV', '')
    applyClient({ effect: () => undefined })
    expect(setupMock).not.toHaveBeenCalled()
  })

  it('逃生门 data-code-finder="off" 完全关闭', () => {
    vi.stubEnv('NODE_ENV', 'development')
    document.documentElement.dataset.codeFinder = 'off'
    applyClient({ effect: () => undefined })
    expect(setupMock).not.toHaveBeenCalled()
  })

  it('data-code-finder-hotkeys 逃生门：换热键 / 关热键 / 非法值回落默认', () => {
    vi.stubEnv('NODE_ENV', 'development')
    document.documentElement.dataset.codeFinderHotkeys = 'cmd+shift'
    applyClient({ effect: () => undefined })
    expect(setupMock).toHaveBeenCalledWith(
      expect.objectContaining({ hotkeys: 'cmd+shift' }),
    )
    setupMock.mockClear()
    document.documentElement.dataset.codeFinderHotkeys = 'off'
    applyClient({ effect: () => undefined })
    expect(setupMock).toHaveBeenCalledWith(
      expect.objectContaining({ hotkeys: null }),
    )
    setupMock.mockClear()
    document.documentElement.dataset.codeFinderHotkeys = 'bogus'
    applyClient({ effect: () => undefined })
    expect(setupMock).toHaveBeenCalledWith(
      expect.objectContaining({ hotkeys: undefined }),
    )
  })

  it('parseClientHotkeys：undefined/空 → undefined；off/null/false → null；非法值 → undefined', () => {
    expect(parseClientHotkeys(undefined)).toBeUndefined()
    expect(parseClientHotkeys('')).toBeUndefined()
    expect(parseClientHotkeys('  ')).toBeUndefined()
    expect(parseClientHotkeys('off')).toBeNull()
    expect(parseClientHotkeys('null')).toBeNull()
    expect(parseClientHotkeys('FALSE')).toBeNull()
    expect(parseClientHotkeys('alt')).toBe('alt')
    expect(parseClientHotkeys('alt+shift')).toBe('alt+shift')
    expect(parseClientHotkeys('cmd+shift')).toBe('cmd+shift')
    expect(parseClientHotkeys('Alt+Shift')).toBe('alt+shift')
    expect(parseClientHotkeys('shift')).toBeUndefined()
  })
})
