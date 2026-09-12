/**
 * React Fragment 补偿插件（JSX 模式）。
 *
 * @locator/babel-jsx 是第三方依赖、不可 fork：它自带的 isDisallowedComponent
 * 只覆盖字面 `<Fragment>` / `<React.Fragment>`（对 `<>...</>` 简写则完全不碰），
 * 没有覆盖别名形态——`const F = Fragment` 时的 `<F>`、`const FR = React` 时的
 * `<FR.Fragment>` 都会被注入 data-locatorjs 并写进 expressions 注册表。该依赖
 * 也没有官方开关能按绑定语义排除（ignoreComponentNames 只是按名字的全局名单，
 * 按名字跳过还会误伤同名普通组件），所以本插件在链上做补偿：
 *
 * - JSXElement 访问时：若元素名（含绑定链别名）解析为 react 的 Fragment，
 *   移除其 openingElement 上的 data-locatorjs / data-locatorjs-id 属性
 *   （上游刚注入的、或重复 transform 遗留的，一并清掉），并记录位置；
 * - Program.exit 时（本插件挂在插件链**首位**，babel 的 exit 逆序执行使它
 *   最后跑，此时上游的 __LOCATOR_DATA__ IIFE 已入 body）：按记录的位置清理
 *   注册表里对应的 expressions 条目（数组元素原位替换为空洞，保持数字 id
 *   的索引不变——id 模式属性值里的 `::N` 因此依旧指向正确条目），
 *   expressionsCE（本仓库 create-element 插件的老产物）同样按 loc 清理。
 *
 * 普通元素（div、普通组件等）完全不碰，行为与上游原样一致。
 */
import type { NodePath, PluginObj, PluginPass, types as BabelTypes } from '@babel/core'
import { identifierIsReactFragment, objectNameIsReact } from './fragment'

/** 插件 option（当前无配置项；保留类型以便将来透传）。 */
export interface JsxFragmentsPluginOptions {
  dataAttribute?: 'path' | 'id'
}

interface RemovedFragment {
  /** JSXElement 的 loc.start（与注册表条目 loc 同源，用于精确匹配）。 */
  line: number
  column: number
}

const LOCATOR_ATTRIBUTES: readonly string[] = ['data-locatorjs', 'data-locatorjs-id']

/** babel 插件工厂（与 create-element.ts 相同的 `(babel) => plugin` 形态）。 */
export function codeFinderJsxFragments(babel: { types: typeof BabelTypes }): PluginObj {
  const t = babel.types

  // 每文件的剥离记录（Program.enter 重置）。
  let removed: RemovedFragment[] = []

  return {
    name: 'dsh-code-finder:jsx-fragments',
    visitor: {
      Program: {
        enter() {
          removed = []
        },
        exit(path, state) {
          if (removed.length === 0) return
          pruneFragmentRegistryEntries(t, path, state, removed)
        },
      },
      JSXElement(path) {
        if (!jsxElementIsReactFragment(t, path)) return
        const attributes = path.node.openingElement.attributes
        const wasStripped = stripLocatorAttributes(t, attributes)
        if (wasStripped && path.node.loc !== null && path.node.loc !== undefined) {
          removed.push({ line: path.node.loc.start.line, column: path.node.loc.start.column })
        }
      },
    },
  }
}

/** JSXElement 名是否（经绑定解析后）是 react 的 Fragment。 */
function jsxElementIsReactFragment(t: typeof BabelTypes, path: NodePath<BabelTypes.JSXElement>): boolean {
  const name = path.node.openingElement.name
  if (t.isJSXIdentifier(name)) {
    // 字面 `<Fragment>`（含别名绑定链：`import { Fragment as F }` / `const F = Fragment`）。
    return identifierIsReactFragment(t, path.scope, name.name)
  }
  if (t.isJSXMemberExpression(name)) {
    // `<React.Fragment>` / `<FR.Fragment>`：属性必须是 Fragment，对象侧必须是 react。
    if (!t.isJSXIdentifier(name.property) || name.property.name !== 'Fragment') return false
    if (!t.isJSXIdentifier(name.object)) return false
    return objectNameIsReact(t, path.scope, name.object.name)
  }
  return false
}

/** 移除属性列表中的 data-locatorjs / data-locatorjs-id；返回是否真的有移除。 */
function stripLocatorAttributes(
  t: typeof BabelTypes,
  attributes: Array<BabelTypes.JSXAttribute | BabelTypes.JSXSpreadAttribute>,
): boolean {
  let stripped = false
  for (let i = attributes.length - 1; i >= 0; i -= 1) {
    const attribute = attributes[i]
    if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name)) continue
    if (LOCATOR_ATTRIBUTES.includes(attribute.name.name)) {
      attributes.splice(i, 1)
      stripped = true
    }
  }
  return stripped
}

/**
 * 清理 body 里注册表 IIFE 中对应片段元素的条目。
 * 匹配键是元素 loc.start（line + column），与上游 entry.loc 同源；
 * expressions（上游数组，数字 id）把命中的数组元素替换为空洞以保住其余 id
 * 的索引位置，expressionsCE（本仓库 c<n> 对象）直接删属性。
 */
function pruneFragmentRegistryEntries(
  t: typeof BabelTypes,
  programPath: NodePath<BabelTypes.Program>,
  state: PluginPass,
  removed: readonly RemovedFragment[],
): void {
  const { absPath } = registryPaths(state)
  for (let i = 0; i < programPath.node.body.length; i += 1) {
    const statement = programPath.get(`body.${i}`) as NodePath<BabelTypes.Statement>
    if (!statement.isExpressionStatement()) continue
    const expression = statement.node.expression
    if (!t.isCallExpression(expression)) continue
    const fn = expression.callee
    if (!t.isArrowFunctionExpression(fn) && !t.isFunctionExpression(fn)) continue
    const fileEntry = findFileEntryObject(t, statement, absPath)
    if (fileEntry === null) continue
    pruneByLoc(t, fileEntry, 'expressions', removed)
    pruneByLoc(t, fileEntry, 'expressionsCE', removed)
  }
}

/** 在 IIFE 内找 `window.__LOCATOR_DATA__[absPath] = {...}` 的右侧对象。 */
function findFileEntryObject(
  t: typeof BabelTypes,
  statementPath: NodePath<BabelTypes.ExpressionStatement>,
  absPath: string,
): BabelTypes.ObjectExpression | null {
  let found: BabelTypes.ObjectExpression | null = null
  statementPath.traverse({
    AssignmentExpression(path) {
      if (found !== null) return
      const left = path.node.left
      if (!t.isMemberExpression(left) || !left.computed || !t.isStringLiteral(left.property)) return
      if (left.property.value !== absPath) return
      if (!t.isMemberExpression(left.object)) return
      const object = left.object
      if (object.computed || !t.isIdentifier(object.object) || object.object.name !== 'window') return
      if (!t.isIdentifier(object.property) || object.property.name !== '__LOCATOR_DATA__') return
      if (t.isObjectExpression(path.node.right)) found = path.node.right
    },
  })
  return found
}

/** 按 loc.start 匹配并删除注册表条目（expressions 数组 / expressionsCE 对象）。 */
function pruneByLoc(
  t: typeof BabelTypes,
  fileEntry: BabelTypes.ObjectExpression,
  key: string,
  removed: readonly RemovedFragment[],
): void {
  if (removed.length === 0) return
  const property = fileEntry.properties.find(
    (property): property is BabelTypes.ObjectProperty =>
      t.isObjectProperty(property) && !property.computed && t.isStringLiteral(property.key) && property.key.value === key,
  )
  if (property === undefined) return
  const value = property.value
  if (t.isArrayExpression(value)) {
    // 上游 expressions：数字 id 数组 —— 命中的元素替换为空洞，索引保持不变。
    for (let i = 0; i < value.elements.length; i += 1) {
      const element = value.elements[i]
      if (element === null || element === undefined || t.isSpreadElement(element)) continue
      if (entryLocMatches(t, element as BabelTypes.Expression, removed)) {
        value.elements[i] = null
      }
    }
  } else if (t.isObjectExpression(value) && key === 'expressionsCE') {
    // 本仓库 create-element 的 c<n> 对象：直接删属性。
    for (let i = value.properties.length - 1; i >= 0; i -= 1) {
      const entry = value.properties[i]
      if (!t.isObjectProperty(entry) || entry.value === undefined || entry.value === null) continue
      if (entryLocMatches(t, entry.value as BabelTypes.Expression, removed)) value.properties.splice(i, 1)
    }
  }
}

/** 条目的 loc.start 是否命中某个被剥离片段的记录。 */
function entryLocMatches(t: typeof BabelTypes, entry: BabelTypes.Expression, removed: readonly RemovedFragment[]): boolean {
  if (!t.isObjectExpression(entry)) return false
  const locProperty = entry.properties.find(
    (property): property is BabelTypes.ObjectProperty =>
      t.isObjectProperty(property) && !property.computed && t.isStringLiteral(property.key) && property.key.value === 'loc',
  )
  if (locProperty === undefined || !t.isObjectExpression(locProperty.value)) return false
  const startProperty = locProperty.value.properties.find(
    (property): property is BabelTypes.ObjectProperty =>
      t.isObjectProperty(property) && !property.computed && t.isStringLiteral(property.key) && property.key.value === 'start',
  )
  if (startProperty === undefined || !t.isObjectExpression(startProperty.value)) return false
  let line: number | undefined
  let column: number | undefined
  for (const property of startProperty.value.properties) {
    if (!t.isObjectProperty(property) || property.computed) continue
    const keyName = t.isIdentifier(property.key) ? property.key.name
      : t.isStringLiteral(property.key) ? property.key.value
        : undefined
    if (keyName === 'line' && t.isNumericLiteral(property.value)) line = property.value.value
    else if (keyName === 'column' && t.isNumericLiteral(property.value)) column = property.value.value
  }
  if (line === undefined || column === undefined) return false
  return removed.some((fragment) => fragment.line === line && fragment.column === column)
}

/** 文件级定位信息（与 create-element.ts / locator 相同的计算）。 */
function registryPaths(state: PluginPass): { absPath: string } {
  const projectPath = typeof state.cwd === 'string' ? state.cwd : ''
  const filename = typeof state.filename === 'string' ? state.filename : ''
  const filePath = filename.startsWith(projectPath) ? filename.slice(projectPath.length) : filename
  return { absPath: projectPath + filePath }
}