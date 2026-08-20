/**
 * `window.__LOCATOR_DATA__` 注册表读取/解析。
 *
 * 注册表由构建期注入（@locator/babel-jsx，见 src/build/transform.ts）写入：
 * - key 为文件绝对路径（projectPath + filePath）；
 * - value 为 `{ filePath, projectPath, expressions, components, styledDefinitions }`；
 * - expressions 的每个条目是 `{ name, loc: { start, end }, wrappingComponentId }`
 *   （位置在 `loc` 里，babel 节点 loc 形状；顶层 `start`/`end` 仅作兼容）。
 * - components 的每个条目是 `{ name, locString, loc }`，表达式经
 *   `wrappingComponentId` 指向包裹它的组件。
 *
 * 多个接入方（宿主 + 插件）各自注入时按绝对路径隔离、天然不冲突，读取时合并
 * （plan §11）。data-locatorjs-id 的 id 格式为 `<fullPath>::<expressionId>`。
 */

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
  wrappingComponentId?: number
}

/** 取表达式起始位置：真实形状在 `loc.start`，兼容顶层 `start`。 */
function expressionStart(expression: LocatorExpression): LocatorPosition | undefined {
  return expression.loc?.start ?? expression.start
}

/** components 条目（@locator 注入：{ name, locString, loc }；嵌套组件可有 wrappingComponentId）。 */
export interface LocatorComponent {
  name?: string
  locString?: string
  loc?: { start?: LocatorPosition; end?: LocatorPosition }
  wrappingComponentId?: number
}

export interface LocatorFileEntry {
  filePath: string
  projectPath: string
  expressions: Record<string, LocatorExpression>
  components: Record<string, LocatorComponent>
  styledDefinitions: Record<string, unknown>
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
): { path: string; line: number; column: number; name?: string } | undefined {
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
  const expression = entry.expressions[expressionId]
  if (expression === undefined) return undefined
  const start = expressionStart(expression)
  return {
    path: fullPath,
    line: start?.line ?? 1,
    column: start?.column ?? 0,
    name: expression.name,
  }
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
  let best: LocatorExpression | undefined
  let bestLineDistance = Number.POSITIVE_INFINITY
  let bestColumnDistance = Number.POSITIVE_INFINITY
  for (const expression of Object.values(entry.expressions)) {
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
  if (best === undefined) return undefined
  return componentNameForExpression(entry, best) ?? expressionName(best)
}

function expressionName(expression: LocatorExpression): string | undefined {
  const name = expression.name
  return name === undefined || name === '' ? undefined : name
}

/**
 * 沿表达式的 `wrappingComponentId` → `components` 链上溯到最外层包裹组件。
 * 返回最后一个有名字的组件名；链断裂/缺条目/成环时返回已找到的最近名字。
 */
function componentNameForExpression(
  entry: LocatorFileEntry,
  expression: LocatorExpression,
): string | undefined {
  const wrap = expression.wrappingComponentId
  if (wrap === undefined || wrap === null) return undefined
  const visited = new Set<number>()
  let currentId: number | undefined = wrap
  let lastNamed: string | undefined
  let guard = 0
  while (currentId !== undefined && guard < 20) {
    if (visited.has(currentId)) return lastNamed
    visited.add(currentId)
    const component: LocatorComponent | undefined = entry.components[String(currentId)]
    if (component === undefined) return lastNamed
    const name = expressionName(component)
    if (name !== undefined) lastNamed = name
    currentId = component.wrappingComponentId
    guard += 1
  }
  return lastNamed
}
