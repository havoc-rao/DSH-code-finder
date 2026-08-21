/**
 * cordis 插件 client 半：dev 构建时自动 `setupCodeFinder`，挂载即用、零代码。
 *
 * - 仅 dev 生效：`process.env.NODE_ENV !== 'production'`（打包器 define 替换为
 *   字面量；浏览器无 process 时 catch 后默认启用——被 DSH 插件 bundle 内联时
 *   由接入方的 define 决定，标准 DSH 构建都定义 NODE_ENV）；
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

/** client 半配置（web-app patch 的 dsh-code-finder 行 `config:`，`!!js` 在 node 端 loader 求值）。 */
export interface CodeFinderClientConfig {
  /** 显式关闭 overlay（生产部署用）：`CODE_FINDER=0` 时 loader 的
   *  `enabled: !!js process.env.CODE_FINDER !== '0'` 求值为 false。 */
  enabled?: boolean
}

/** 是否 dev 构建（见文件头注释）。`CODE_FINDER` 显式开关优先于 NODE_ENV。 */
function isDevBuild(): boolean {
  try {
    const flag = process.env.CODE_FINDER
    if (flag === '0' || flag === 'off' || flag === 'false') return false
    if (flag === '1' || flag === 'on' || flag === 'true') return true
    return process.env.NODE_ENV !== 'production'
  } catch {
    // 浏览器无 process（未经 define 替换）：按 dev 处理，调用方负责按环境加载。
    return true
  }
}

/** 插件主体。 */
export function apply(ctx: CodeFinderClientContext, config?: CodeFinderClientConfig): void {
  // 生产部署关闭：config.enabled === false（web-app 行
  // `enabled: !!js process.env.CODE_FINDER !== '0'`，node 端求值后传入）。
  if (config?.enabled === false) return
  if (!isDevBuild()) return
  if (typeof document !== 'undefined' && document.documentElement.dataset.codeFinder === 'off') return
  const handle = setupCodeFinder({ searchEndpoint: '/code-finder/api/search' })
  ctx.effect(() => () => handle.destroy(), 'dsh-code-finder: overlay teardown')
}
