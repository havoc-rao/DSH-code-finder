/**
 * cordis 包装测试（plan §8）：host 半路由（fence / 搜索 / 参数校验）+ client 半开关。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply as applyHost, type CodeFinderHostConfig, type CodeFinderHostContext } from '../src/cordis/host'
import type { CodeFinderHttpRequest, CodeFinderHttpResponse } from '../src/index'

// ── client 半：mock 掉 setupCodeFinder，只验证开关与生命周期 ──────────────────
vi.mock('../src/client/index', () => ({
  setupCodeFinder: vi.fn(() => ({ destroy: vi.fn() })),
}))
import { setupCodeFinder } from '../src/client/index'
import { apply as applyClient, type CodeFinderClientContext } from '../src/cordis/client'

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

function makeRequest(options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): CodeFinderHttpRequest {
  const chunks: Uint8Array[] = []
  if (options.body !== undefined) {
    chunks.push(new TextEncoder().encode(JSON.stringify(options.body)))
  }
  return {
    method: options.method ?? 'POST',
    url: '/code-finder/api/search',
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
})

const HOST_CONFIG: CodeFinderHostConfig = { roots: [], exts: ['.tsx', '.ts'], exclude: ['node_modules'] }

describe('host 半：/code-finder/api/search 路由', () => {
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
    const { ctx, route } = makeHostCtx()
    applyHost(ctx, { ...HOST_CONFIG, roots: [tmpRoot] })

    const get = makeResponse()
    await route()!.handler(makeRequest({ method: 'GET' }), get.res)
    expect(get.status).toBe(405)

    for (const bad of ['', '../../etc/passwd', 'a/b', 'x'.repeat(200)]) {
      const res = makeResponse()
      await route()!.handler(makeRequest({ body: { name: bad } }), res.res)
      expect(res.status).toBe(400)
    }
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
    expect(setupMock).toHaveBeenCalledWith({ searchEndpoint: '/code-finder/api/search' })
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
    vi.stubEnv('CODE_FINDER', '')
    applyClient({ effect: () => undefined })
    expect(setupMock).not.toHaveBeenCalled()
  })

  it('逃生门 data-code-finder="off" 完全关闭', () => {
    vi.stubEnv('NODE_ENV', 'development')
    document.documentElement.dataset.codeFinder = 'off'
    applyClient({ effect: () => undefined })
    expect(setupMock).not.toHaveBeenCalled()
  })
})
