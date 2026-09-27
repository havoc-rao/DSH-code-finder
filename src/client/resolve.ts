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
import { collectFiberChain, getComponentName, getDebugSource, type ChainNode, type FiberDebugSource, type FiberLike } from './fiber'
import { componentChainByPosition, lookupComponentNameByPosition, lookupLocatorData } from './locator-data'

/** hit 的来源：①②③④⑤（④⑤ 由 index.ts 异步补位）。 */
export type HitSource = 'data' | 'fiber' | 'search' | 'sourcemap' | 'name-only'

export interface CodeFinderHit {
  /** 组件名（fiber 提取；没有时为空字符串）。 */
  name: string
  /** 完整组件路径 `[最外层, …, 最内层包裹组件]`（每层含组件声明位置；无链时不带）。 */
  chain?: ChainNode[]
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

/**
 * 沿 DOM 祖先找「最近一个带构建期注入属性（data-locatorjs / data-locatorjs-id）
 * 的元素」（含自身）。
 *
 * 为什么需要：注入属性只存在于该 JSX 元素本体上，其内部子元素（文本节点、
 * `<span>` 等）没有属性。生产 React 宿主没有 fiber 键（无
 * `_debugSource`、无组件名）时，hover 内部元素会直接落到「连名字都没有 →
 * overlay 隐藏」。上溯到最近注入祖先后，生产宿主下 hover 组件任意内部元素
 * 都能拿到该 JSX 元素的元素级坐标（蓝框框住注入祖先，与 LocatorJS 扩展行为
 * 一致）；dev React 宿主下 fiber 本就能给出位置，上溯只改变框选范围（更大
 * 的注入边界，同样是预期行为）。
 *
 * @param element - hover 目标元素。
 * @param maxDepth - 上溯深度上限（防御异常 DOM 深度；默认 64 足够覆盖
 *   嵌套组件栈，同时防止病态 DOM 的线性开销）。
 * @returns 带属性的最近祖先（含自身）；找不到返回 null。
 */
export function findLocatorElement(element: Element, maxDepth = 64): Element | null {
  let current: Element | null = element
  let depth = 0
  while (current !== null && depth < maxDepth) {
    if (current.hasAttribute('data-locatorjs') || current.hasAttribute('data-locatorjs-id')) {
      return current
    }
    current = current.parentElement
    depth += 1
  }
  return null
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
  // 渲染树链（dev React 的 _debugOwner 上溯，跨文件真实组件树；生产宿主无
  // fiber 数据 → undefined）。链长 >1 时优先于注册表声明链显示。
  const renderChain = fiber === null ? undefined : collectFiberChain(fiber)

  // ① 构建期注入的属性（应用自己构建的组件，元素级精确）
  const pathAttr = element.getAttribute('data-locatorjs')
  if (pathAttr !== null) {
    const parsed = parseLocatorPath(pathAttr)
    if (parsed !== undefined) {
      // 生产 React 下 fiber 组件名被压缩（`af`），用注册表按位置反查「包裹组件
      // 名」覆盖——data-locatorjs 是 path 格式（无表达式 id），按位置匹配，再沿
      // wrappingComponentId → components 链上溯到最外层组件（hover 内部元素也
      // 显示 `<Sidebar>` 而非 `<button>`）。完整链（多层组件 path）随 chain 返回。
      const registryName = lookupComponentNameByPosition(parsed.path, parsed.line, parsed.column)
      const declarationChain = componentChainByPosition(parsed.path, parsed.line, parsed.column)
      // 渲染树链只在「>1 层且带位置」时优先：production React 无 _debugSource，
      // 沿 return 链兜底出的裸名链（压缩名、无 loc）不压制带位置的声明链。
      const renderChainLocated = renderChain !== undefined && renderChain.length > 1
        && renderChain.some(node => node.path !== undefined)
      const chain = renderChainLocated ? renderChain : declarationChain
      return {
        name: registryName ?? name,
        ...(chain !== undefined && chain.length > 1 ? { chain } : {}),
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
      const chain = renderChain !== undefined && renderChain.length > 1 ? renderChain : located.chain
      return {
        name: located.name ?? name,
        ...(chain !== undefined && chain.length > 1 ? { chain } : {}),
        path: located.path, line: located.line, column: located.column, source: 'data',
      }
    }
  }

  // ② fiber._debugSource（dev React 宿主）
  if (fiber !== null) {
    const debugSource = getDebugSource(fiber)
    if (debugSource !== undefined) {
      const hit = hitFromDebugSource(name, debugSource)
      return renderChain !== undefined && renderChain.length > 1 ? { ...hit, chain: renderChain } : hit
    }
  }

  // ③ 组件名兜底（生产宿主：名字级是预期行为）
  if (name !== '') {
    return renderChain !== undefined && renderChain.length > 1
      ? { name, chain: renderChain, source: 'name-only' }
      : { name, source: 'name-only' }
  }
  return null
}
