/**
 * React Fragment 识别（JSX 与工厂调用两条插入链共用）。
 *
 * 语义：`data-locatorjs` / `data-locatorjs-id` 永远不该落到 React Fragment
 * 上——开发版 React 会对 Fragment 做 prop 校验并刷
 * `Invalid prop ... supplied to React.Fragment`（Fragment 只能有 key/children），
 * 而且插桩语义上 Fragment 是透明容器，也没有可定位的意义。
 *
 * 本模块把「这是一个 React Fragment」判定收敛到一处，覆盖：
 * - 字面形态：`Fragment` 标识符、`React.Fragment` 成员表达式
 *   （含 `window.React.Fragment` / `globalThis.React.Fragment`）；
 * - 别名形态：只要绑定可溯源就沿绑定链解析——`const F = Fragment`、
 *   `import { Fragment as F } from 'react'`、`const { Fragment: F } = React`、
 *   `const FR = React` / `const FR = require('react')` / 命名空间
 *   `import * as React from 'react'`、`const R = window.React` 等；
 * - 遮蔽守卫：某名字若绑定到非 react 系来源（本文件自定义的 Fragment 组件、
 *   其它 import），不当作 React Fragment——普通元素插桩行为不变。
 * 查不到绑定的裸 `Fragment` / `React` 视为全局（classic script 形态），跳过。
 */
import type { NodePath, types as BabelTypes } from '@babel/core'

/** react 系 import 来源（命中判定用，与 create-element.ts 一致）。 */
const REACT_IMPORT_SOURCES: readonly string[] = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime']

/** 显式全局宿主名（window.React / globalThis.React / global.React）。 */
const GLOBAL_HOSTS: readonly string[] = ['window', 'globalThis', 'global']

/**
 * 作用域/绑定的结构子集：@babel/core 的类型没有导出 Scope / Binding
 * （@babel/traverse 虽在依赖树里但不是本包直接依赖，不走 phantom import），
 * 这里按使用面声明结构类型，NodePath 运行时对象天然满足。
 */
export interface ScopeLike {
  getBinding(name: string): BindingLike | undefined
}
export interface BindingLike {
  path: NodePath
  scope: ScopeLike
}

function isReactSource(source: string | undefined): boolean {
  return source !== undefined && REACT_IMPORT_SOURCES.includes(source)
}

/** 溯源绑定到 import 来源；无法溯源返回 undefined。 */
function importSourceOf(t: typeof BabelTypes, binding: BindingLike): string | undefined {
  const path = binding.path
  if (path.isImportSpecifier() || path.isImportDefaultSpecifier() || path.isImportNamespaceSpecifier()) {
    const declaration = path.parentPath?.isImportDeclaration()
      ? path.parentPath
      : path.findParent((parent: NodePath) => parent.isImportDeclaration())
    if (declaration === null) return undefined
    return t.isImportDeclaration(declaration.node) ? declaration.node.source.value : undefined
  }
  if (!path.isVariableDeclarator()) return undefined
  const init = path.node.init
  if (init === undefined || init === null) return undefined
  // const React = require('react')
  if (t.isCallExpression(init) && t.isIdentifier(init.callee) && init.callee.name === 'require') {
    const argument = init.arguments[0]
    return argument !== undefined && t.isStringLiteral(argument) ? argument.value : undefined
  }
  // var React = window.React（或 globalThis / global）
  if (t.isMemberExpression(init) && !init.computed && t.isIdentifier(init.property) && init.property.name === 'React'
    && t.isIdentifier(init.object) && GLOBAL_HOSTS.includes(init.object.name)) {
    return 'react'
  }
  return undefined
}

/** 解构形态：`const { Fragment } = React` / `const { Fragment: F } = React`。 */
function objectPatternHasFragmentKey(t: typeof BabelTypes, pattern: BabelTypes.ObjectPattern): boolean {
  return pattern.properties.some((property): boolean => {
    if (!t.isObjectProperty(property) || property.computed) return false
    const key = property.key
    if (t.isIdentifier(key)) return key.name === 'Fragment'
    return t.isStringLiteral(key) && key.value === 'Fragment'
  })
}

/** 表达式是否解析为 react 的 Fragment（标识符/成员表达式；别名链按绑定递归）。 */
function expressionIsReactFragment(
  t: typeof BabelTypes,
  scope: ScopeLike,
  expression: BabelTypes.Expression | null | undefined,
  seen: Set<BabelTypes.Node> = new Set(),
): boolean {
  if (expression === null || expression === undefined) return false
  if (seen.has(expression)) return false // 循环绑定（let a = b; let b = a）守卫
  seen.add(expression)
  if (t.isIdentifier(expression)) {
    const binding = scope.getBinding(expression.name)
    if (binding !== undefined && binding.path.isVariableDeclarator()) {
      const declarator = binding.path.node
      if (t.isObjectPattern(declarator.id) && objectPatternHasFragmentKey(t, declarator.id)) {
        // const { Fragment: F } = React —— F 是 react 的 Fragment iff React 是真 react。
        return objectIsReact(t, binding.scope, declarator.init, seen)
      }
      // 别名链：const F = Fragment / const F = React.Fragment / const F2 = F
      return expressionIsReactFragment(t, binding.scope, declarator.init, seen)
    }
    if (binding !== undefined && binding.path.isImportSpecifier()) {
      // `import { Fragment as _Fragment }`（tsc jsx-runtime 产物形态）：别名
      // 的本地名与 imported 名不同，必须按 imported 名判定。
      return bindingIsReactFragment(t, binding)
    }
    if (expression.name !== 'Fragment') return false
    return bindingIsReactFragment(t, binding) // undefined 绑定 → 全局 Fragment
  }
  if (t.isMemberExpression(expression)) {
    if (expression.computed || !t.isIdentifier(expression.property) || expression.property.name !== 'Fragment') {
      return false
    }
    return objectIsReact(t, scope, expression.object, seen)
  }
  return false
}

/** 已解析到名字后的判定：react 的 Fragment 具名导出（或全局）。 */
function bindingIsReactFragment(t: typeof BabelTypes, binding: BindingLike | undefined): boolean {
  if (binding === undefined) return true // 无绑定：全局 Fragment（classic script 形态）
  if (!binding.path.isImportSpecifier()) return false // 本地组件/其它导出：不算 react Fragment
  const imported = binding.path.node.imported
  const importedName = t.isIdentifier(imported) ? imported.name : imported.value
  return importedName === 'Fragment' && isReactSource(importSourceOf(t, binding))
}

/** 成员表达式对象侧：X.Fragment 的 X 是否为 react 命名空间（React / 别名 / 全局）。 */
function objectIsReact(t: typeof BabelTypes, scope: ScopeLike, object: BabelTypes.Expression | null | undefined, seen: Set<BabelTypes.Node>): boolean {
  if (t.isIdentifier(object)) {
    const binding = scope.getBinding(object.name)
    if (binding === undefined) return object.name === 'React' // 全局 React
    if (binding.path.isVariableDeclarator()) return variableDeclaratorIsReact(t, binding, seen)
    return isReactSource(importSourceOf(t, binding)) // import React / import * as React
  }
  // window.React / globalThis.React / global.React 显式全局取用。
  return t.isMemberExpression(object) && !object.computed
    && t.isIdentifier(object.property) && object.property.name === 'React'
    && t.isIdentifier(object.object) && GLOBAL_HOSTS.includes(object.object.name)
}

/** VariableDeclarator 的 init 是否为 react 命名空间（含别名链递归）。 */
function variableDeclaratorIsReact(
  t: typeof BabelTypes,
  binding: BindingLike,
  seen: Set<BabelTypes.Node> = new Set(),
): boolean {
  if (!binding.path.isVariableDeclarator()) return false // 类型收窄：node 为 VariableDeclarator
  const init = binding.path.node.init
  if (init === null || init === undefined) return false
  if (seen.has(init)) return false
  seen.add(init)
  if (t.isIdentifier(init)) {
    if (init.name === 'React') {
      const chain = binding.scope.getBinding(init.name)
      if (chain === undefined) return true // 全局 React 取别名
      if (chain.path.isVariableDeclarator()) return variableDeclaratorIsReact(t, chain, seen)
      return isReactSource(importSourceOf(t, chain))
    }
    // 别名链：const FR = ReactNS（命名空间 import）→ 沿 FR 的 init 名字再解析。
    const chain = binding.scope.getBinding(init.name)
    if (chain === undefined) return false
    if (chain.path.isVariableDeclarator()) return variableDeclaratorIsReact(t, chain, seen)
    return isReactSource(importSourceOf(t, chain))
  }
  // const FR = window.React / require('react')
  return isReactSource(importSourceOf(t, binding))
}

/**
 * 工厂调用 tag 判定入口：`createElement(Fragment, ...)`、`jsx(Fragment, {...})`、
 * `jsx(F, {...})`（F 的绑定链末端为 react 的 Fragment）、
 * `React.createElement(Fragment, ...)`、`window.React.createElement(Fragment, ...)`。
 * @param tag - 调用第一参数（可能是占位符/spread，非标识符/成员表达式直接不算）。
 */
export function isReactFragmentTag(
  t: typeof BabelTypes,
  scope: ScopeLike,
  tag: BabelTypes.Node | null | undefined,
): boolean {
  if (tag === null || tag === undefined) return false
  if (!t.isIdentifier(tag) && !t.isMemberExpression(tag)) return false
  return expressionIsReactFragment(t, scope, tag)
}

/**
 * 裸标识符形态（JSX 的 JSXIdentifier 名字复用）：
 * `Fragment` 字面、`F` 别名（绑定链末端是 react 的 Fragment）。
 */
export function identifierIsReactFragment(t: typeof BabelTypes, scope: ScopeLike, name: string): boolean {
  return expressionIsReactFragment(t, scope, t.identifier(name))
}

/** 成员形态的对象侧（JSX 的 JSXMemberExpression 用）：`FR.Fragment` 的 FR 是否 react。 */
export function objectNameIsReact(t: typeof BabelTypes, scope: ScopeLike, name: string): boolean {
  return objectIsReact(t, scope, t.identifier(name), new Set())
}