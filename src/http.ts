/**
 * 共享 HTTP 薄封装：请求/响应结构子集 + JSON 读写。
 *
 * 供两个 fenced 路由复用（src/index.ts 的 search 与 src/sourcemap.ts 的
 * sourcemap 反查），避免 cordis 内部结构泄漏到业务模块。
 */

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

export async function readJsonBody(req: CodeFinderHttpRequest): Promise<unknown> {
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

export function writeJson(res: CodeFinderHttpResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(body))
}

export function writeError(res: CodeFinderHttpResponse, status: number, code: string, message: string): void {
  writeJson(res, status, { ok: false, error: { code, message } })
}