/**
 * cordis 插件 host 半：注册 `POST /code-finder/api/search` 路由（源码搜索第④层）。
 *
 * 挂载即用（其他 DSH 插件一行接入，见 docs/README.md「cordis 纯 runtime」）：
 * - 轻量信任 fence（src/cordis/trust.ts，loopback / trustedHosts）拒绝越权；
 * - 只读、只扫配置 roots（默认 `~/.dsh/source/current` + 当前进程 cwd/src）；
 * - 不导出 Config schema（避免引入 schemastery 重依赖）：配置直接读
 *   `ctx.config` / apply 第二参，默认值在 {@link resolveHostConfig} 补齐
 *   （be-sider `resolveSidebarConfig` 同款「两种调用方式都默认」模式）。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createSourceIndex,
  handleSearchRequest,
  type CodeFinderHttpRequest,
  type CodeFinderHttpResponse,
  type SourceIndex,
  type SourceIndexOptions,
} from '../index'
import { isTrustedApiRequest } from './trust'

/** 插件身份（cordis.patch.yml / profile 挂载行用）。 */
export const name = 'dsh-code-finder'

/** 需要的宿主服务：webServer（路由）、webRuntime（trustedHosts 鉴权）。 */
export const inject = ['webServer', 'webRuntime']

/** host 半配置（可空：默认 roots 为 ~/.dsh/source/current + cwd/src）。 */
export interface CodeFinderHostConfig {
  /** 源码搜索根目录（绝对路径）。 */
  roots?: string[]
  /** 参与索引的扩展名；默认 ['.tsx', '.ts', '.jsx', '.js']。 */
  exts?: string[]
  /** 排除规则（路径片段或正则）；默认 node_modules + 常见产物目录。 */
  exclude?: Array<string | RegExp>
  /** 路由前缀；默认 '/code-finder/api'（POST /code-finder/api/search）。 */
  path?: string
}

/** host 半的 cordis 上下文结构子集（消费方 Context 结构性兼容）。 */
export interface CodeFinderHostContext {
  config?: CodeFinderHostConfig
  webServer: {
    register(route: {
      kind: 'prefix'
      path: string
      handler: (req: CodeFinderHttpRequest, res: CodeFinderHttpResponse) => void | Promise<void>
    }): void
  }
  webRuntime: { trustedHosts: string[] }
  effect(callback: () => (() => void) | void, label?: string): void
}

export interface ResolvedCodeFinderHostConfig {
  roots: string[]
  exts: string[]
  exclude: Array<string | RegExp>
  path: string
}

/** 默认 roots：~/.dsh/source/current（宿主源码）+ 当前仓库 src/（插件源码）。 */
function defaultRoots(): string[] {
  return [join(homedir(), '.dsh', 'source', 'current'), join(process.cwd(), 'src')]
}

/** 补齐默认值（目录不存在时 createSourceIndex 静默跳过，无需在此过滤）。 */
export function resolveHostConfig(config?: CodeFinderHostConfig): ResolvedCodeFinderHostConfig {
  return {
    roots: config?.roots ?? defaultRoots(),
    exts: config?.exts ?? ['.tsx', '.ts', '.jsx', '.js'],
    exclude: config?.exclude ?? ['node_modules', '.git', 'lib', 'dist', 'out', 'coverage'],
    path: config?.path ?? '/code-finder/api',
  }
}

/**
 * 插件主体：建源码索引 + 注册 fenced 搜索路由。索引挂在 ctx.effect 里，
 * fiber 释放（插件卸载 / HMR）时 dispose。
 */
export function apply(ctx: CodeFinderHostContext, config?: CodeFinderHostConfig): void {
  const resolved = resolveHostConfig(config ?? ctx.config)
  ctx.effect(() => {
    const index: SourceIndex = createSourceIndex({
      roots: resolved.roots,
      exts: resolved.exts,
      exclude: resolved.exclude,
      // roots 可能包含 ~/.dsh/source/current（可能很大）：懒建索引，插件启动不阻塞，
      // 首次搜索（dev 定位场景）再付扫描成本。
      lazy: true,
    } satisfies SourceIndexOptions)
    const fence = (req: CodeFinderHttpRequest): boolean => isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)
    ctx.webServer.register({
      kind: 'prefix',
      path: resolved.path,
      handler: (req, res) => handleSearchRequest(req, res, index, { isTrusted: fence }),
    })
    return () => index.dispose()
  }, 'dsh-code-finder: source index + search route')
}

/**
 * DSH/cordis 插件默认导出（cordis-loader 只认 `default` 或函数本身——
 * 命名导出 namespace 会被判为 invalid plugin）。命名导出保留供编程式挂载。
 */
export default { name, inject, apply }
