/**
 * React.createElement / jsx-runtime 调用注入插件。
 *
 * 与 @locator/babel-jsx（JSX 模式）语义完全对齐的兄弟实现，覆盖零构建/手写
 * classic script 场景（如 dsh-remote 的 lib/client.js：263 处 createElement、
 * 没有任何 JSX）——JSX 插件在这类文件上零命中，缺这一层注入就永远拿不到
 * 元素级行号（DCF 定位矩阵第①层）。
 *
 * 注入规则（与 JSX 模式一致）：
 * - 只命中 React 系工厂：`React.createElement`、裸 `createElement`、jsx-runtime
 *   的 `jsx`/`jsxs`/`jsxDEV`（含编译产物常用别名 `_jsx`/`_jsxs`/`_jsxDEV`、
 *   `jsx_runtime.jsx` 命名空间成员形式）；
 * - 命中判定带绑定守卫：标识符若在作用域内有绑定，必须是 react 系 import
 *   （`react` / `react/jsx-runtime` / `react/jsx-dev-runtime`）或
 *   `require('react')`、`const { createElement } = React` 解构；无绑定视为
 *   全局 React（classic script 无 import 的常态）。`document.createElement`
 *   与本文件自定义的 createElement 函数天然排除；
 * - props 为对象字面量时直接追加 key；缺失 / null / undefined 字面量时生成
 *   新对象（children 参数位不变）；其余表达式（标识符/成员/调用/spread）不
 *   注入——绝不产生坏 props；
 * - 幂等：props 已有 data-locatorjs / data-locatorjs-id key 的调用直接跳过
 *   （重复 instrument 不会重复注入，也保护用户手写的 key）；
 * - 注册表条目与 locator 数字 id 错开：本插件用 `c<n>` 字符串 id，写入
 *   expressionsCE（JSX 插件在同一文件时写 expressions——两套并排不互踩，
 *   见 src/client/locator-data.ts 的合并读取）；
 * - Program.exit 追加 `window.__LOCATOR_DATA__` IIFE（与 JSX 插件相同的
 *   文件级 key），已有条目则只补 expressionsCE，重新 instrument 不炸注册表。
 */
import type { NodePath, PluginObj, PluginPass, types as BabelTypes } from '@babel/core'

export interface CreateElementPluginOptions {
  /** data-locatorjs 属性格式；'path' 自描述（无需注册表），默认 'path'。 */
  dataAttribute?: 'path' | 'id'
}

/** 裸标识符工厂 → 允许的 import 来源（其它绑定一律不命中）。 */
const BARE_FACTORY_IMPORTS: Record<string, readonly string[]> = {
  createElement: ['react'],
  jsx: ['react', 'react/jsx-runtime'],
  jsxs: ['react', 'react/jsx-runtime'],
  jsxDEV: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  _jsx: ['react', 'react/jsx-runtime'],
  _jsxs: ['react', 'react/jsx-runtime'],
  _jsxDEV: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
}
/** jsx 运行时工厂名集合（成员/裸标识符两形态共用）。 */
const JSX_FACTORY_NAMES = new Set(['jsx', 'jsxs', 'jsxDEV', '_jsx', '_jsxs', '_jsxDEV'])
/** jsx-runtime 命名空间成员形态允许的对象名（`jsx_runtime.jsx(...)` 等）。 */
const RUNTIME_NAMESPACE_NAMES = new Set(['jsx_runtime', '_jsx_runtime', 'jsxRuntime'])
/** react 系 import 来源（命中判定用）。 */
const REACT_IMPORT_SOURCES: readonly string[] = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime']

/** 注册表条目形状（与 locator expressions 条目对齐：位置在 loc.start）。 */
interface LocatedEntry {
  name?: string
  loc: BabelTypes.SourceLocation
  /** 包裹函数在 locator components 数组里的序号（本插件按同一规则编号）。 */
  wrappingComponentId?: number
}

/**
 * babel 插件工厂（与 @locator/babel-jsx 相同的 `(babel) => plugin` 形态，
 * 由 transformWithCodeFinder 以 `[[plugin, { dataAttribute }]]` 挂进链）。
 */
export function codeFinderCreateElement(babel: { types: typeof BabelTypes }): PluginObj {
  const t = babel.types

  // 每文件的注入状态（Program.enter 重置）。
  let entries: Array<{ key: string; entry: LocatedEntry }> = []
  let nextId = 0
  // 包裹组件栈：与 @locator/babel-jsx 的 components 编号（含 id 的 FunctionDeclaration
  // 按文档序从 0 递增）保持同一套序号，给条目补 wrappingComponentId——hover 时
  // 客户端能沿 components 链解析出包裹组件名（与 JSX 模式行为一致）。
  let componentSeq = 0
  let componentStack: number[] = []

  return {
    name: 'dsh-code-finder:create-element',
    visitor: {
      Program: {
        enter() {
          entries = []
          nextId = 0
          componentSeq = 0
          componentStack = []
        },
        exit(path, state) {
          if (entries.length === 0) return
          path.node.body.push(buildRegistryStatement(t, state, entries))
        },
      },
      FunctionDeclaration: {
        enter(path) {
          if (path.node.id !== null && path.node.loc !== null && path.node.loc !== undefined) {
            componentStack.push(componentSeq)
            componentSeq += 1
          }
        },
        exit(path) {
          if (path.node.id !== null && path.node.loc !== null && path.node.loc !== undefined) {
            componentStack.pop()
          }
        },
      },
      CallExpression(path, state) {
        if (!elementFactoryName(t, path)) return
        injectCall(t, path, state, entries, () => `c${nextId++}`, componentStack)
      },
    },
  }
}

/** 命中规则：React 系工厂调用（成员形态 + 裸标识符形态，带绑定守卫）。 */
function elementFactoryName(t: typeof BabelTypes, path: NodePath<BabelTypes.CallExpression>): boolean {
  const callee = path.node.callee
  if (t.isMemberExpression(callee)) {
    if (callee.computed || !t.isIdentifier(callee.property)) return false
    const name = callee.property.name
    if (name === 'createElement') {
      // React.createElement / window.React.createElement 形态。
      if (t.isMemberExpression(callee.object)) {
        // window.React / globalThis.React / global.React：显式全局取用。
        return isReactReference(t, callee.object)
      }
      if (!t.isIdentifier(callee.object)) return false
      // 对象标识符（React 或别名）：无绑定仅放行 React；有绑定溯源到 react 系。
      const binding = path.scope.getBinding(callee.object.name)
      if (binding === undefined) return callee.object.name === 'React'
      const source = importSourceOf(t, binding)
      return source !== undefined && REACT_IMPORT_SOURCES.includes(source)
    }
    if (JSX_FACTORY_NAMES.has(name)
      && t.isIdentifier(callee.object)
      && RUNTIME_NAMESPACE_NAMES.has(callee.object.name)) {
      return reactBindingAllowed(t, path, callee.object.name)
    }
    return false
  }
  if (t.isIdentifier(callee)) {
    const binding = path.scope.getBinding(callee.name)
    const known = BARE_FACTORY_IMPORTS[callee.name]
    if (binding === undefined) return known !== undefined // 无绑定：仅已知工厂名放行全局
    const source = importSourceOf(t, binding)
    if (source === undefined) return false
    if (known !== undefined) return known.includes(source)
    // 未知名字（如 var h = React.createElement）：仅放行显式工厂别名绑定——
    // 避免 useState({...}) 这类 react 具名导入被调用时误注入。
    return isFactoryAliasBinding(t, binding)
  }
  return false
}

/** 绑定是否为显式工厂别名（var h = React.createElement / var { createElement: h } = React）。 */
function isFactoryAliasBinding(t: typeof BabelTypes, binding: { path: NodePath | null }): boolean {
  const path = binding.path
  if (path === null || !path.isVariableDeclarator()) return false
  const init = path.node.init
  if (init === undefined || init === null) return false
  return (t.isMemberExpression(init) && !init.computed && t.isIdentifier(init.property) && init.property.name === 'createElement')
    || (t.isIdentifier(init) && init.name === 'React')
}

/** `window.React` / `globalThis.React` / `global.React` 显式全局取用形态。 */
function isReactReference(t: typeof BabelTypes, object: BabelTypes.Expression): boolean {
  if (!t.isMemberExpression(object) || object.computed) return false
  return t.isIdentifier(object.property) && object.property.name === 'React'
    && t.isIdentifier(object.object)
    && (object.object.name === 'window' || object.object.name === 'globalThis' || object.object.name === 'global')
}

/** 成员形态守卫：React / jsx_runtime 命名空间的绑定必须是 react 系 import；
 *  无绑定视为全局 React（classic script）。 */
function reactBindingAllowed(t: typeof BabelTypes, path: NodePath, name: string): boolean {
  const binding = path.scope.getBinding(name)
  if (binding === undefined) return true
  const source = importSourceOf(t, binding)
  return source !== undefined && REACT_IMPORT_SOURCES.includes(source)
}

/** 溯源绑定到 import 来源；非 react 系来源返回 undefined。 */
function importSourceOf(t: typeof BabelTypes, binding: { path: NodePath | null }): string | undefined {
  const path = binding.path
  if (path === null) return undefined
  if (path.isImportSpecifier() || path.isImportDefaultSpecifier() || path.isImportNamespaceSpecifier()) {
    const declaration = path.parentPath?.isImportDeclaration()
      ? path.parentPath
      : path.findParent((parent) => parent.isImportDeclaration())
    if (declaration === null) return undefined
    return t.isImportDeclaration(declaration.node) ? declaration.node.source.value : undefined
  }
  if (path.isVariableDeclarator()) {
    const init = path.node.init
    if (init === undefined || init === null) return undefined
    // React 15/16 CJS：const React = require('react')
    if (t.isCallExpression(init)
      && t.isIdentifier(init.callee) && init.callee.name === 'require') {
      const argument = init.arguments[0]
      return argument !== undefined && t.isStringLiteral(argument) ? argument.value : undefined
    }
    // classic script 全局取用：var React = window.React（或 globalThis/global）
    if (t.isMemberExpression(init) && !init.computed && t.isIdentifier(init.property) && init.property.name === 'React'
      && t.isIdentifier(init.object)
      && (init.object.name === 'window' || init.object.name === 'globalThis' || init.object.name === 'global')) {
      return 'react'
    }
    // 解构取用别名：const createElement = React.createElement —— 溯源到 React。
    if (t.isMemberExpression(init) && !init.computed && t.isIdentifier(init.property) && init.property.name === 'createElement'
      && t.isIdentifier(init.object) && init.object.name === 'React') {
      const reactBinding = path.scope.getBinding('React')
      if (reactBinding === undefined) return 'react' // 全局 React 取成员
      return importSourceOf(t, reactBinding)
    }
    // 解构：const { createElement } = React —— 溯源到 React 本身的绑定。
    if (t.isIdentifier(init) && init.name === 'React') {
      const reactBinding = path.scope.getBinding('React')
      if (reactBinding === undefined) return 'react' // 全局 React 解构
      return importSourceOf(t, reactBinding)
    }
  }
  return undefined
}

/** 注入单次调用：props 对象字面量加 key；缺失/null/undefined 生成新对象；
 *  其余表达式跳过。返回是否注入（幂等：已有 key 的调用跳过）。 */
function injectCall(
  t: typeof BabelTypes,
  path: NodePath<BabelTypes.CallExpression>,
  state: PluginPass,
  entries: Array<{ key: string; entry: LocatedEntry }>,
  nextKey: () => string,
  componentStack: readonly number[],
): boolean {
  const node = path.node
  const loc = node.loc
  if (loc === null || loc === undefined) return false
  const args = node.arguments
  const props = args[1]
  const opts = state.opts as { dataAttribute?: 'path' | 'id' } | undefined
  const dataAttribute = opts?.dataAttribute === 'id' ? 'id' : 'path'

  if (props !== undefined && !t.isObjectExpression(props)) {
    // null / undefined 字面量允许替换生成新对象；其余表达式不碰。
    if (!(t.isNullLiteral(props) || (t.isIdentifier(props) && props.name === 'undefined'))) return false
  }
  if (t.isObjectExpression(props)) {
    const keyed = props.properties.some((property): boolean =>
      t.isObjectProperty(property)
      && !property.computed
      && t.isStringLiteral(property.key)
      && (property.key.value === 'data-locatorjs' || property.key.value === 'data-locatorjs-id'))
    if (keyed) return false // 幂等：已注入（或用户手写）的调用不再注入
  }

  // 一个调用位一个 key：属性值与注册表条目共用（id 从 c0 起，
  // 与 locator 的数字表达式 id 天然错开）。
  const key = nextKey()
  const { absPath } = registryPaths(state)
  const keyName = dataAttribute === 'id' ? 'data-locatorjs-id' : 'data-locatorjs'
  const value = dataAttribute === 'id'
    ? `${absPath}::${key}`
    : `${absPath}:${loc.start.line}:${loc.start.column}`
  const property = t.objectProperty(t.stringLiteral(keyName), t.stringLiteral(value))

  if (t.isObjectExpression(props)) {
    props.properties.push(property)
  } else if (props === undefined) {
    args.splice(1, 0, t.objectExpression([property])) // createElement(Tag) 插入 props 位
  } else {
    args[1] = t.objectExpression([property]) // null/undefined 字面量：原位替换
  }

  const first = args[0]
  const name = first !== undefined && !t.isArgumentPlaceholder(first) && !t.isSpreadElement(first)
    ? tagName(t, first)
    : undefined
  const wrappingComponentId = componentStack[componentStack.length - 1]
  const entry: LocatedEntry = {
    ...(name === undefined ? {} : { name }),
    ...(wrappingComponentId === undefined ? {} : { wrappingComponentId }),
    loc,
  }
  entries.push({ key, entry })
  return true
}

/** 从 tag 参数提取可读名字（host 元素名 / 组件名；无则省略）。 */
function tagName(
  t: typeof BabelTypes,
  tag: BabelTypes.Expression | BabelTypes.JSXNamespacedName | undefined,
): string | undefined {
  if (tag === undefined) return undefined
  if (t.isStringLiteral(tag)) return tag.value
  if (t.isIdentifier(tag)) return tag.name
  if (t.isMemberExpression(tag) && !tag.computed) {
    const object = tagName(t, tag.object)
    const property = t.isIdentifier(tag.property) ? tag.property.name : undefined
    if (object !== undefined && property !== undefined) return `${object}.${property}`
  }
  return undefined
}

/** 文件级定位信息（与 locator 完全相同：projectPath = cwd，filePath = 相对 cwd）。 */
function registryPaths(state: PluginPass): { absPath: string; filePath: string; projectPath: string } {
  const projectPath = typeof state.cwd === 'string' ? state.cwd : ''
  const filename = typeof state.filename === 'string' ? state.filename : ''
  const filePath = filename.startsWith(projectPath) ? filename.slice(projectPath.length) : filename
  return { absPath: projectPath + filePath, filePath, projectPath }
}

/** `window.__LOCATOR_DATA__` 注册表 IIFE：文件无条目时写完整文件项（含
 *  expressionsCE），已有条目（JSX 插件写过）时只补 expressionsCE。 */
function buildRegistryStatement(
  t: typeof BabelTypes,
  state: PluginPass,
  entries: Array<{ key: string; entry: LocatedEntry }>,
): BabelTypes.ExpressionStatement {
  const { absPath, filePath, projectPath } = registryPaths(state)
  const entriesObject = t.objectExpression(
    entries.map(({ key, entry }) => t.objectProperty(t.stringLiteral(key), jsonToNode(t, entry))),
  )
  const fileEntry = t.objectExpression([
    t.objectProperty(t.stringLiteral('filePath'), t.stringLiteral(filePath)),
    t.objectProperty(t.stringLiteral('projectPath'), t.stringLiteral(projectPath)),
    t.objectProperty(t.stringLiteral('expressions'), t.objectExpression([])),
    t.objectProperty(t.stringLiteral('components'), t.objectExpression([])),
    t.objectProperty(t.stringLiteral('styledDefinitions'), t.objectExpression([])),
    t.objectProperty(t.stringLiteral('expressionsCE'), entriesObject),
  ])
  const registry = (): BabelTypes.MemberExpression =>
    t.memberExpression(t.identifier('window'), t.identifier('__LOCATOR_DATA__'))
  const lookup = t.memberExpression(registry(), t.stringLiteral(absPath), true)
  const entryRef = t.identifier('entry')
  const body = t.blockStatement([
    t.ifStatement(
      t.binaryExpression('===', t.unaryExpression('typeof', t.identifier('window')), t.stringLiteral('undefined')),
      t.returnStatement(),
    ),
    t.ifStatement(
      t.unaryExpression('!', registry()),
      t.expressionStatement(t.assignmentExpression('=', registry(), t.objectExpression([]))),
    ),
    t.variableDeclaration('var', [t.variableDeclarator(entryRef, lookup)]),
    t.ifStatement(
      t.unaryExpression('!', entryRef),
      t.expressionStatement(t.assignmentExpression('=', lookup, fileEntry)),
      t.ifStatement(
        t.unaryExpression('!', t.memberExpression(entryRef, t.identifier('expressionsCE'))),
        t.expressionStatement(
          t.assignmentExpression('=', t.memberExpression(entryRef, t.identifier('expressionsCE')), entriesObject),
        ),
      ),
    ),
  ])
  return t.expressionStatement(t.callExpression(t.arrowFunctionExpression([], body), []))
}

/** JSON 形数据 → babel 节点（undefined 字段省略）。 */
function jsonToNode(t: typeof BabelTypes, value: unknown): BabelTypes.Expression {
  if (value === null) return t.nullLiteral()
  if (typeof value === 'string') return t.stringLiteral(value)
  if (typeof value === 'number') return t.numericLiteral(value)
  if (typeof value === 'boolean') return t.booleanLiteral(value)
  if (Array.isArray(value)) return t.arrayExpression(value.map((item) => jsonToNode(t, item)))
  if (typeof value === 'object') {
    const properties: BabelTypes.ObjectProperty[] = []
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue
      properties.push(t.objectProperty(t.stringLiteral(key), jsonToNode(t, item)))
    }
    return t.objectExpression(properties)
  }
  return t.nullLiteral()
}