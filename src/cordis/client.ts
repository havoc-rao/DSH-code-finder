/**
 * cordis 插件 client 半：dev 构建时自动 `setupCodeFinder`，挂载即用、零代码。
 *
 * - 仅 dev 语义生效：`process.env.NODE_ENV === 'development'`（打包器 define
 *   替换为字面量；CODE_FINDER=1/on/true 强制开、0/off/false 强制关，与构建期
 *   codeFinderEnabled 完全对称；未设 NODE_ENV 视为非 dev，不启用）；
 * - 浏览器无 process 时 catch 后默认启用——被 DSH 插件 bundle 内联时由接入方
 *   的 define 决定，标准 DSH 构建都定义 NODE_ENV；
 * - 逃生门：`<html data-code-finder="off">` 可完全关闭（plan §11 热键冲突逃生门）；
 * - 搜索端点固定为 host 半的路由 `/code-finder/api/search`；
 * - fiber 释放（插件卸载 / HMR）时 destroy overlay。
 */
import { setupCodeFinder } from '../client/index'

/** 插件身份。 */
export const name = 'dsh-code-finder'

/** client 半不注入任何服务（仅依赖浏览器环境 + 可选 host 半的搜索路由）。 */
export const inject: string[] = []

/** client 半的 cordis 上下文结构子集。 */
export interface CodeFinderClientContext {
  effect(callback: () => (() => void) | void, label?: string): void
}

/** 是否 dev 语义（见文件头注释）。运行时挂载由宿主 patch 行的
 *  `disabled`（只读 env 的严格 NODE_ENV/CODE_FINDER 判定）在 node 端决定——
 *  非 dev 时 entry 根本不 apply，这里不会执行；本函数只作为打包器内联后的
 *  第二道防线，与构建侧 codeFinderEnabled 保持同一判定。 */
function isDevBuild(): boolean {
  try {
    const flag = process.env.CODE_FINDER
    if (flag === '0' || flag === 'off' || flag === 'false') return false
    if (flag === '1' || flag === 'on' || flag === 'true') return true
    return process.env.NODE_ENV === 'development'
  } catch {
    // 浏览器无 process（未经 define 替换）：无法判定，默认启用，
    // 调用方负责按环境加载（宿主 patch 行已按 NODE_ENV 把关）。
    return true
  }
}

/** 插件主体。 */
export function apply(ctx: CodeFinderClientContext): void {
  if (!isDevBuild()) return
  if (typeof document !== 'undefined' && document.documentElement.dataset.codeFinder === 'off') return
  const handle = setupCodeFinder({ searchEndpoint: '/code-finder/api/search' })
  ctx.effect(() => () => handle.destroy(), 'dsh-code-finder: overlay teardown')
}
