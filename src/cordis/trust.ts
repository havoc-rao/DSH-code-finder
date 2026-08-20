/**
 * 浏览器信任 fence（cordis host 半自带同款轻量实现）。
 *
 * 行为与 better-sidebar 的 trust-fence.ts / @deepseek-ai/dsh-client-connection 的
 * /api 网关 fence 一致（BSD-3-Clause，原实现来自
 * dsh-client-connection src/api-request-trust.ts + src/loopback-hostname.ts；
 * 因该包不导出这些 helper，本包复制同款算法）：Host-header loopback 或配置的
 * trusted authority 通过，跨站浏览器标记拒绝。这是 DNS-rebinding / 跨站防御，
 * 不是认证（plan §7「轻量信任 fence，只读、只扫配置 roots、拒绝越权」）。
 */
import type { IncomingHttpHeaders } from 'node:http'

/** fence 读取的请求事实（IncomingMessage 的结构子集）。 */
interface ApiTrustRequest {
  headers: IncomingHttpHeaders
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** 归一化 Host-header authority 的 URL；解析失败返回 undefined。 */
function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/** hostname 是否为本地 loopback（localhost / [::1] / 127.x.x.x）。 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}

/** 规范化 authority 形式：hostname，或写了端口时的 hostname:port。 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/** 请求 authority 是否命中 trustedHosts 条目（精确或省端口）。 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * 判定一个搜索请求是否可到达插件路由：Host 是我们的（loopback 或 trusted）
 * 且浏览器标记同源。
 */
export function isTrustedApiRequest(
  request: ApiTrustRequest,
  trustedHosts: readonly string[],
): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
