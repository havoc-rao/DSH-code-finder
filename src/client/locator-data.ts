/**
 * `window.__LOCATOR_DATA__` 注册表读取/解析。
 *
 * 注册表由构建期注入（@locator/babel-jsx，见 src/build/transform.ts）写入：
 * - key 为文件绝对路径（projectPath + filePath）；
 * - value 为 `{ filePath, projectPath, expressions, components, styledDefinitions }`；
 * - expressions 的每个条目是 `{ name, start: { line, column }, end: { line, column }, wrappingComponentId }`。
 *
 * 多个接入方（宿主 + 插件）各自注入时按绝对路径隔离、天然不冲突，读取时合并
 * （plan §11）。data-locatorjs-id 的 id 格式为 `<fullPath>::<expressionId>`。
 */

export interface LocatorPosition {
  line: number
  column: number
}

export interface LocatorExpression {
  name?: string
  start?: LocatorPosition
  end?: LocatorPosition
  wrappingComponentId?: number
}

export interface LocatorFileEntry {
  filePath: string
  projectPath: string
  expressions: Record<string, LocatorExpression>
  components: Record<string, unknown>
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
  return {
    path: fullPath,
    line: expression.start?.line ?? 1,
    column: expression.start?.column ?? 0,
    name: expression.name,
  }
}
