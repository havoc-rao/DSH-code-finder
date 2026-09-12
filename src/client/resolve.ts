/**
 * 解析链（核心）：hover 一个元素时按优先级取「源码位置」。
 *
 * ① `data-locatorjs` 属性（`<absPath>:<line>:<col>`，兼容 LocatorJS path 格式）
 *    或 `data-locatorjs-id`（注册表反查）——应用自己构建的组件，元素级精确；
 * ② fiber `_debugSource` / `_debugInfo`——dev React 宿主自动可用，零改动；
 * ③ 组件名兜底——任何 React 宿主至少拿到名字（生产宿主无 `_debugSource`，
 *    名字级是预期行为，见 plan §3.1 / README）；
 * ④ 源码搜索（searchEndpoint）在 src/client/index.ts 里异步补位，不阻塞本链；
 * ⑤ sourcemap 反查（sourcemapEndpoint）——①/② 给出的路径若指向构建产物
 *    （lib/**\/*.js 等），由 host 半用 `*.js.map` 映射回原始源码坐标，同样异步
 *    补位（src/sourcemap.ts / src/client/index.ts）。
 *
 * 组件名始终从 fiber 提取（属性里只有路径没有名字），与位置合并成完整 hit。
 */
import { getComponentName, getDebugSource, type FiberDebugSource, type FiberLike } from './fiber'
import { lookupComponentNameByPosition, lookupLocatorData } from './locator-data'

/** hit 的来源：①②③④⑤（④⑤ 由 index.ts 异步补位）。 */
export type HitSource = 'data' | 'fiber' | 'search' | 'sourcemap' | 'name-only'

export interface CodeFinderHit {
  /** 组件名（fiber 提取；没有时为空字符串）。 */
  name: string
  /** 文件绝对/相对路径。 */
  path?: string
  line?: number
  column?: number
  /** 该位置信息的来源。 */
  source: HitSource
}

/** 解析 `data-locatorjs` 的 `<absPath>:<line>:<col>` 值。 */
export function parseLocatorPath(value: string): { path: string; line: number; column: number } | undefined {
  if (value === '') return undefined
  // 从右往左找两个冒号：Windows 盘符（C:\...）里的冒号会干扰 naive 切分，
  // 因此要求「倒数第二个冒号到最后一个冒号」之间必须是纯数字（行号）。
  const lastColon = value.lastIndexOf(':')
  if (lastColon <= 0) return undefined
  const secondLastColon = value.lastIndexOf(':', lastColon - 1)
  if (secondLastColon <= 0) return undefined
  const linePart = value.slice(secondLastColon + 1, lastColon)
  const columnPart = value.slice(lastColon + 1)
  if (!/^\d+$/u.test(linePart) || !/^\d+$/u.test(columnPart)) return undefined
  return {
    path: value.slice(0, secondLastColon),
    line: Number(linePart),
    column: Number(columnPart),
  }
}

/**
 * 构建产物路径判定（第⑤层触发条件）：命中路径指向产物而非源码时，交给 host
 * 半做 sourcemap 反查。判定规则：
 * - 路径含产物段（lib/dist/out/build/coverage，Windows 反斜杠也覆盖）；
 * - 或以 .js/.cjs/.mjs 结尾且不在 src 目录下（真实的 src/foo.js 不误判）。
 */
export function isBuildArtifactPath(path: string): boolean {
  if (/[\\/](?:lib|dist|out|build|_build|coverage)[\\/]/u.test(path)) return true
  return /\.(?:[mc]?js)$/u.test(path) && !/[\\/]src[\\/]/u.test(path)
}

function hitFromDebugSource(name: string, source: FiberDebugSource): CodeFinderHit {
  const path = source.fileName
  return {
    name,
    ...(path !== undefined && path !== '' ? { path } : {}),
    ...(source.lineNumber !== undefined && source.lineNumber > 0 ? { line: source.lineNumber } : {}),
    ...(source.columnNumber !== undefined && source.columnNumber > 0 ? { column: source.columnNumber } : {}),
    source: 'fiber',
  }
}

/**
 * 对元素执行解析链 ①②③（同步部分）。返回 null 表示连名字都没有（overlay 隐藏）。
 * @param element - hover 目标元素（读 data 属性）。
 * @param fiber - 已定位的组件 fiber（由调用方用 src/client/fiber.ts 提前算好）。
 */
export function resolveHit(element: Element, fiber: FiberLike | null): CodeFinderHit | null {
  const name = fiber === null ? '' : (getComponentName(fiber) ?? '')

  // ① 构建期注入的属性（应用自己构建的组件，元素级精确）
  const pathAttr = element.getAttribute('data-locatorjs')
  if (pathAttr !== null) {
    const parsed = parseLocatorPath(pathAttr)
    if (parsed !== undefined) {
      // 生产 React 下 fiber 组件名被压缩（`af`），用注册表按位置反查「包裹组件
      // 名」覆盖——data-locatorjs 是 path 格式（无表达式 id），按位置匹配，再沿
      // wrappingComponentId → components 链上溯到最外层组件（hover 内部元素也
      // 显示 `<Sidebar>` 而非 `<button>`）。
      const registryName = lookupComponentNameByPosition(parsed.path, parsed.line, parsed.column)
      return {
        name: registryName ?? name,
        path: parsed.path,
        line: parsed.line,
        column: parsed.column,
        source: 'data',
      }
    }
  }
  const idAttr = element.getAttribute('data-locatorjs-id')
  if (idAttr !== null) {
    const located = lookupLocatorData(idAttr)
    if (located !== undefined) {
      return { name: located.name ?? name, path: located.path, line: located.line, column: located.column, source: 'data' }
    }
  }

  // ② fiber._debugSource（dev React 宿主）
  if (fiber !== null) {
    const debugSource = getDebugSource(fiber)
    if (debugSource !== undefined) return hitFromDebugSource(name, debugSource)
  }

  // ③ 组件名兜底（生产宿主：名字级是预期行为）
  if (name !== '') return { name, source: 'name-only' }
  return null
}
