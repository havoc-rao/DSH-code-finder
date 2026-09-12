/**
 * dcf 宿主探测 —— `dcf ensure` / `dcf status --profile` 的端到端验证支撑。
 *
 * 只读探测，永不写宿主：
 * - `/plugins/<name>/client.js`：插件的 client wire bundle 是否已被当前 boot 挂载
 *   （旧 boot / 未挂该插件时 404）；
 * - `POST /code-finder/api/search`：dcf host 半的源码搜索路由是否可达，以及
 *   探测组件名能否命中索引（命中即「code-ref path 信息可见」的直接证据）。
 *
 * 纯字符串层（joinHostUrl）可单测；HTTP 层用 Node 20 全局 fetch +
 * AbortSignal.timeout(5s) 兜底，探测失败一律降级为「未知 / 不可达」结果而非抛错。
 */

/** 宿主探测超时（毫秒）。 */
const PROBE_TIMEOUT_MS = 5000

/** 单个 GET 探测结果。 */
export interface BundleProbe {
  /** 探测 URL。 */
  url: string
  /** 200 即视为已挂载。 */
  ok: boolean
  /** 实际 HTTP 状态码；超时/网络错误为 undefined。 */
  status: number | undefined
}

/** 单个 search API 探测命中。 */
export interface SearchHit {
  file: string
  line: number
  column?: number
}

/** search API POST 探测结果。 */
export interface SearchProbe {
  ok: boolean
  status: number | undefined
  /** 命中条目（ok:true 时按服务端 data 顺序）。 */
  hits: SearchHit[]
  /** 人读摘要（状态码 / 命中数 / 错误码）。 */
  detail: string
}

/** 合并后的宿主探测结果。 */
export interface HostProbe {
  base: string
  client: BundleProbe
  search: SearchProbe
}

/** 去掉 base 的尾部斜杠后拼路径（保持用户给的协议/host 原样）。 */
export function joinHostUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/u, '')}/${path.replace(/^\/+/u, '')}`
}

/** GET 宿主上的插件 client bundle URL，200 = 当前 boot 已挂该插件 client。 */
export async function probeClientBundle(base: string, pluginName: string): Promise<BundleProbe> {
  const url = joinHostUrl(base, `plugins/${encodeURIComponent(pluginName)}/client.js`)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: 'follow' })
    return { url, ok: res.status === 200, status: res.status }
  } catch {
    return { url, ok: false, status: undefined }
  }
}

/**
 * POST /code-finder/api/search 探测：路由可达（ok:true）即 host 半在跑；
 * hits 非空 = 组件名 → file:line 索引命中（path 可见的真实证据）。
 */
export async function probeSearchApi(base: string, componentName: string): Promise<SearchProbe> {
  const url = joinHostUrl(base, 'code-finder/api/search')
  const empty: SearchProbe['hits'] = []
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: componentName }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (res.status !== 200) {
      return { ok: false, status: res.status, hits: empty, detail: `HTTP ${res.status}` }
    }
    let body: { ok?: unknown, data?: unknown, error?: { code?: unknown } }
    try {
      body = await res.json() as typeof body
    } catch {
      return { ok: false, status: 200, hits: empty, detail: 'HTTP 200 但响应非 JSON' }
    }
    if (body?.ok !== true) {
      const code = (body as { error?: { code?: string } })?.error?.code
      return { ok: false, status: 200, hits: empty, detail: `路由返回 ${code ?? '非 ok 响应'}` }
    }
    const data = Array.isArray(body.data) ? body.data as SearchHit[] : []
    return {
      ok: true,
      status: 200,
      hits: data.filter(hit => typeof hit?.file === 'string'),
      detail: `HTTP 200 ok，${data.length} 个命中`,
    }
  } catch {
    return { ok: false, status: undefined, hits: empty, detail: '不可达（超时/网络错误）' }
  }
}

/** 依次探测 client bundle 与 search API。 */
export async function probeHost(base: string, pluginName: string, componentName: string): Promise<HostProbe> {
  const [client, search] = await Promise.all([
    probeClientBundle(base, pluginName),
    probeSearchApi(base, componentName),
  ])
  return { base, client, search }
}