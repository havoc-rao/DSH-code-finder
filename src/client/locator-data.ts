/**
 * `window.__LOCATOR_DATA__` 注册表读取/解析。
 *
 * 注册表由构建期注入写入：
 * - @locator/babel-jsx（JSX 模式，见 src/build/transform.ts）：`expressions`
 *   为数字 id 数组；
 * - 本包 createElement 插件（src/build/create-element.ts）：`expressionsCE`
 *   为 `c<n>` 字符串 id 对象——与 JSX 条目并排不互踩，读取时两者都查。
 * 形状：
 * - key 为文件绝对路径（projectPath + filePath）；
 * - value 为 `{ filePath, projectPath, expressions, components, styledDefinitions, expressionsCE? }`；
 * - expressions / expressionsCE 的每个条目是 `{ name, loc: { start, end }, wrappingComponentId }`
 *   （位置在 `loc` 里，babel 节点 loc 形状；顶层 `start`/`end` 仅作兼容）。
 * - components 的每个条目是 `{ name, locString, loc }`，表达式经
 *   `wrappingComponentId` 指向包裹它的组件。
 *
 * 多个接入方（宿主 + 插件）各自注入时按绝对路径隔离、天然不冲突，读取时合并
 * （plan §11）。data-locatorjs-id 的 id 格式为 `<fullPath>::<expressionId>`。
 */
import type { ChainNode } from './fiber'

export interface LocatorPosition {
  line: number
  column: number
}

/**
 * @locator/babel-jsx 注入的真实形状：位置在 `loc.start`/`loc.end`（babel 节点
 * loc，含 line/column/index）。顶层 `start`/`end` 保留作兼容旧形状/其他注入方。
 */
export interface LocatorExpression {
  name?: string
  loc?: { start?: LocatorPosition; end?: LocatorPosition }
  start?: LocatorPosition
  end?: LocatorPosition
  /** 包裹组件引用：@locator 的数字下标，或本插件的 `ce-N` key。 */
  wrappingComponentId?: number | string
}

/** 取表达式起始位置：真实形状在 `loc.start`，兼容顶层 `start`。 */
function expressionStart(expression: LocatorExpression): LocatorPosition | undefined {
  return expression.loc?.start ?? expression.start
}

/** components 条目（@locator 注入：{ name, locString, loc }；本插件：{ name, loc, wrappingComponentId }）。 */
export interface LocatorComponent {
  name?: string
  locString?: string
  loc?: { start?: LocatorPosition; end?: LocatorPosition }
  wrappingComponentId?: number | string
}

export interface LocatorFileEntry {
  filePath: string
  projectPath: string
  expressions: Record<string, LocatorExpression>
  components: Record<string, LocatorComponent>
  styledDefinitions: Record<string, unknown>
  /** createElement 插件的条目（`c<n>` 字符串 id，与 locator 数字 id 并排）。 */
  expressionsCE?: Record<string, LocatorExpression>
}

declare global {
  interface Window {
    __LOCATOR_DATA__?: Record<string, LocatorFileEntry>
  }
}

/** 合并读取所有注入方写入的注册表（key 按绝对路径隔离，天然无冲突）。 */
export function readLocatorData(): Record<string, LocatorFileEntry> {
  try {
    return window.__LOCATOR_DATA__ ?? {}
  } catch {
    return {}
  }
}

/** 通过 data-locatorjs-id 的 id（`<fullPath>::<expressionId>`）反查源码位置。 */
export function lookupLocatorData(
  id: string,
): { path: string; line: number; column: number; name?: string; chain?: ChainNode[] } | undefined {
  const data = readLocatorData()
  const sep = id.lastIndexOf('::')
  if (sep === -1) {
    // 没有表达式 id：整体当作路径 key（防御性处理，理论上不会出现）。
    return data[id] === undefined ? undefined : { path: id, line: 1, column: 0 }
  }
  const fullPath = id.slice(0, sep)
  const expressionId = id.slice(sep + 2)
  const entry = data[fullPath]
  if (entry === undefined) return undefined
  const expression = entry.expressions[expressionId] ?? entry.expressionsCE?.[expressionId]
  if (expression === undefined) return undefined
  const start = expressionStart(expression)
  const chain = componentChainForExpression(entry, expression)
  return {
    path: fullPath,
    line: start?.line ?? 1,
    column: start?.column ?? 0,
    name: expression.name,
    ...(chain === undefined || chain.length <= 1 ? {} : { chain }),
  }
}

/** 最近位置匹配：jsx（数字 id）与 createElement（c<n> id）条目都参与，互不冲突。 */
function nearestExpressionAt(
  entry: LocatorFileEntry,
  line: number,
  column: number,
): LocatorExpression | undefined {
  let best: LocatorExpression | undefined
  let bestLineDistance = Number.POSITIVE_INFINITY
  let bestColumnDistance = Number.POSITIVE_INFINITY
  const expressions = [
    ...Object.values(entry.expressions),
    ...Object.values(entry.expressionsCE ?? {}),
  ]
  for (const expression of expressions) {
    const start = expressionStart(expression)
    if (start === undefined) continue
    const lineDistance = Math.abs(start.line - line)
    const columnDistance = Math.abs(start.column - column)
    if (lineDistance < bestLineDistance
      || (lineDistance === bestLineDistance && columnDistance < bestColumnDistance)) {
      bestLineDistance = lineDistance
      bestColumnDistance = columnDistance
      best = expression
    }
  }
  return best
}

/**
 * 沿表达式的 `wrappingComponentId` → `components` 链上溯，返回
 * `[最外层, …, 最内层包裹组件]` 的完整组件路径（不含元素表达式的名字）。
 * 每层携带组件声明位置（components 条目注入的 `loc.start`，声明链同文件，
 * path 取文件绝对路径；loc 缺失时仅名字）。
 * 链断裂/缺条目/成环时返回已解析到的部分链；无包裹组件时返回 undefined。
 */
export function componentChainForExpression(
  entry: LocatorFileEntry,
  expression: LocatorExpression,
): ChainNode[] | undefined {
  const wrap = expression.wrappingComponentId
  if (wrap === undefined || wrap === null) return undefined
  const visited = new Set<string | number>()
  const chain: ChainNode[] = []
  // 防御两种注入形状：本插件的是相对 filePath（projectPath + filePath）；
  // 其他注入方/测试数据可能直接给绝对 filePath，此时不再拼 projectPath。
  const fullPath = entry.filePath.startsWith(entry.projectPath)
    ? entry.filePath
    : `${entry.projectPath}${entry.filePath}`
  let currentId: number | string | undefined = wrap
  let guard = 0
  while (currentId !== undefined && guard < 20) {
    if (visited.has(currentId)) break
    visited.add(currentId)
    const component: LocatorComponent | undefined = entry.components[String(currentId)]
    if (component === undefined) break
    const name = expressionName(component)
    if (name !== undefined) {
      const node: ChainNode = { name, path: fullPath }
      const start = component.loc?.start
      if (start?.line !== undefined) node.line = start.line
      if (start?.column !== undefined) node.column = start.column
      chain.unshift(node)
    }
    currentId = component.wrappingComponentId
    guard += 1
  }
  return chain.length === 0 ? undefined : chain
}

/**
 * 按 (path, line, column) 反查「包裹组件的名字」（data-locatorjs 的 path 格式
 * 没有表达式 id，用位置匹配）——用它覆盖生产 React 下被压缩的 fiber 函数名
 * （`af` → `Sidebar`）。
 *
 * 匹配规则：先取「start.line 与目标行最接近、行同再比列」的表达式；然后沿
 * 表达式的 `wrappingComponentId` → `components` 链上溯到最外层包裹组件，返回
 * 其 name（hover 内部元素显示 `<Sidebar>` 而非 `<button>`）；无包裹组件（或链
 * 断裂，如箭头函数组件）时回退表达式的 name（元素级）。该文件无注册表条目或
 * 找不到表达式时返回 undefined（调用方回退 fiber 名）。
 */
export function lookupComponentNameByPosition(
  path: string,
  line: number,
  column: number,
): string | undefined {
  const data = readLocatorData()
  const entry = data[path]
  if (entry === undefined) return undefined
  const best = nearestExpressionAt(entry, line, column)
  if (best === undefined) return undefined
  // 链为 [最外层, …, 最内层包裹组件]：单名查询取最外层（与原行为一致）——
  // chain 现为节点对象，取 .name。
  return componentChainForExpression(entry, best)?.at(0)?.name ?? expressionName(best)
}

/**
 * 按 (path, line, column) 反查完整组件路径 `[最外层, …, 最内层包裹组件]`
 * （多层组件定位：hover 任意元素拿到它所在的整条组件链）。
 * 无注册表条目/无表达式/无包裹链时返回 undefined。
 */
export function componentChainByPosition(
  path: string,
  line: number,
  column: number,
): ChainNode[] | undefined {
  const data = readLocatorData()
  const entry = data[path]
  if (entry === undefined) return undefined
  const best = nearestExpressionAt(entry, line, column)
  if (best === undefined) return undefined
  return componentChainForExpression(entry, best)
}

function expressionName(expression: LocatorExpression): string | undefined {
  const name = expression.name
  return name === undefined || name === '' ? undefined : name
}
