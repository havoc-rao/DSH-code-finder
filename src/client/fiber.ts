/**
 * DOM 节点 → React fiber 查找 + 组件 fiber 定位 + 组件名提取。
 *
 * 双路径（react-code-finder 同款思路）：
 * 1. DevTools hook：`window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers` 里找
 *    `findFiberByHostInstance`——跨 React 18/19 最稳，且天然支持多 React 实例；
 * 2. DOM 属性兜底：遍历元素自身的 `__reactFiber$*` / `__reactInternalInstance$*`
 *    （React 18/19 的属性名带随机后缀，只能前缀匹配）。
 *
 * 本模块不 import react——运行时通过 DOM fiber 键 / DevTools hook 交互，
 * 绝不 double-instance React（见 plan §3.2）。
 */

/** 最小化的 React fiber 结构（只读所需字段，避免依赖 react 类型）。 */
export interface FiberLike {
  /** 当前 fiber 的类型：host 组件为字符串（'div'），函数/类组件为函数或对象。 */
  type: unknown
  /** React 19 起，elementType 保留原始组件类型（displayName 更可靠）。 */
  elementType?: unknown
  /** 父 fiber（向上遍历用）。 */
  return: FiberLike | null
  /** React 18/19 dev 构建：创建该 fiber 的父组件 fiber（渲染树链上溯通道）。 */
  _debugOwner?: FiberLike | null
  /** React dev 构建才有：组件源码位置。 */
  _debugSource?: FiberDebugSource | null
  /** React 19 dev 构建：可能携带 `_debugSource` 的 owner 栈信息。 */
  _debugInfo?: unknown
}

/** fiber._debugSource 的结构子集。 */
export interface FiberDebugSource {
  fileName?: string
  lineNumber?: number
  columnNumber?: number
}

/** 内部用的 DevTools hook 结构子集。 */
interface DevToolsRenderer {
  findFiberByHostInstance?: (dom: Element) => unknown
}

interface DevToolsHook {
  renderers?: unknown
}

function findViaDevToolsHook(dom: Element): FiberLike | null {
  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook }).__REACT_DEVTOOLS_GLOBAL_HOOK__
  const renderers = hook?.renderers
  if (renderers === undefined || renderers === null) return null
  const tryRenderer = (renderer: unknown): FiberLike | null => {
    const find = (renderer as DevToolsRenderer | undefined)?.findFiberByHostInstance
    if (typeof find !== 'function') return null
    try {
      const fiber = find.call(renderer, dom)
      return fiber === null || fiber === undefined ? null : fiber as FiberLike
    } catch {
      return null
    }
  }
  // React DevTools 5+ 是 Map；旧版可能是普通对象；统一防御式遍历。
  if (renderers instanceof Map) {
    for (const renderer of renderers.values()) {
      const fiber = tryRenderer(renderer)
      if (fiber !== null) return fiber
    }
    return null
  }
  if (typeof renderers === 'object') {
    for (const renderer of Object.values(renderers as Record<string | number, unknown>)) {
      const fiber = tryRenderer(renderer)
      if (fiber !== null) return fiber
    }
  }
  return null
}

function findViaDomKeys(dom: Element): FiberLike | null {
  const record = dom as unknown as Record<string, unknown>
  for (const key of Object.keys(dom)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      const value = record[key]
      if (value !== null && typeof value === 'object') return value as FiberLike
    }
  }
  return null
}

/**
 * 找到 DOM 节点对应的最近 fiber（host 实例 fiber）。
 * 目标节点自身没有 fiber 时（如文本节点、无 fiber 的包装节点）沿 DOM 祖先上溯，
 * 第一个带 fiber 的元素即最内层宿主实例。
 */
export function findFiberByDomNode(dom: Element | null): FiberLike | null {
  let node: Element | null = dom
  while (node !== null && node.nodeType === 1) {
    const fiber = findViaDevToolsHook(node) ?? findViaDomKeys(node)
    if (fiber !== null) return fiber
    node = node.parentElement
  }
  return null
}

/** type 是否为组件（函数/类/forwardRef/memo 等对象包装），host 字符串与 symbol 排除。 */
function isComponentType(type: unknown): boolean {
  if (type === null || type === undefined) return false
  if (typeof type === 'string') return false // host 组件（'div' 等）
  if (typeof type === 'symbol') return false // Fragment / Suspense / Offscreen 等
  if (typeof type === 'number') return false
  return true
}

/** 从 host fiber 沿 return 链向上找最近的组件 fiber（渲染该节点的组件）。 */
export function findComponentFiber(fiber: FiberLike | null): FiberLike | null {
  let current: FiberLike | null = fiber
  while (current !== null) {
    if (isComponentType(current.type)) return current
    current = current.return
  }
  return null
}

/** 宿主外壳包装组件名（渲染树链噪音）：Slot 槽位注入层 / Root 级入口包装
 *  （DSH 的 Slot 结构 = SlotErrorBoundary + RootEntry + SlotOutlet 交替嵌套，
 *   会成串污染链）。名称精确匹配，不泛化（ErrorBoundary 等业务封装保留）。 */
const CHAIN_NOISE_NAMES = new Set([
  'SlotOutlet',
  'SlotErrorBoundary',
  'RootEntry',
  'RootOutlet',
])

/** 渲染链过滤名单：显示名匹配这些的 fiber 不进链（React/宿主外壳包装噪音）。 */
function isChainNoise(name: string | undefined): boolean {
  if (name === undefined || name === '') return true
  if (name.startsWith('Symbol(')) return true
  if (CHAIN_NOISE_NAMES.has(name)) return true
  // Context.Provider / Context.Consumer、React.memo 未设 displayName 时的显式标记
  return /Context\.(?:Provider|Consumer)$/u.test(name)
}

/** 链节点：组件名 + 组件声明位置（字段缺失时省略；path/line/column 与 hit 同级）。 */
export interface ChainNode {
  name: string
  /** 组件声明所在文件（dev React `_debugSource.fileName`；注册表通道为文件绝对路径）。 */
  path?: string
  line?: number
  column?: number
}

/**
 * 沿渲染树收集组件链（dev React 才有 `_debugOwner`）：
 * 从给定组件 fiber 开始逐层上溯到根，返回 `[最外层, …, 最内层]` 的组件节点，
 * 每层携带该组件的声明位置（`_debugSource`，dev React 注入的 `__source`）。
 * 通道：`_debugOwner` 优先；缺失时沿 `return` 链找最近组件 fiber（旧 React
 * /无损 owner 的宿主）。上限 24 层 + 环保护；全部噪音/空名则返回 undefined。
 */
export function collectFiberChain(fiber: FiberLike | null): ChainNode[] | undefined {
  if (fiber === null) return undefined
  const chain: ChainNode[] = []
  const visited = new Set<FiberLike>()
  let current: FiberLike | null = fiber
  let guard = 0
  while (current !== null && guard < 24) {
    if (visited.has(current)) break
    visited.add(current)
    // owner 为 null 时可退化为 return 链上溯（跳过 host/中间节点找组件）
    let owner: FiberLike | null = current._debugOwner ?? null
    if (owner === null || !isComponentType(owner.type)) {
      let parent: FiberLike | null = current.return
      while (parent !== null && !isComponentType(parent.type)) parent = parent.return
      owner = parent
    }
    const name = getComponentName(current)
    if (!isChainNoise(name) && name !== undefined) {
      const source = getDebugSource(current)
      const node: ChainNode = { name }
      if (source?.fileName !== undefined) node.path = source.fileName
      if (source?.lineNumber !== undefined) node.line = source.lineNumber
      if (source?.columnNumber !== undefined) node.column = source.columnNumber
      chain.unshift(node)
    }
    current = owner
    guard += 1
  }
  return chain.length === 0 ? undefined : chain
}

/** 从组件类型提取显示名（displayName 优先于 name）。 */
function nameOfType(type: unknown): string | undefined {
  if (typeof type === 'function') {
    const fn = type as { displayName?: unknown; name?: unknown }
    if (typeof fn.displayName === 'string' && fn.displayName !== '') return fn.displayName
    return typeof fn.name === 'string' && fn.name !== '' ? fn.name : undefined
  }
  if (typeof type === 'object' && type !== null) {
    const obj = type as {
      displayName?: unknown
      render?: unknown
      type?: unknown
      _payload?: { _result?: unknown }
    }
    if (typeof obj.displayName === 'string' && obj.displayName !== '') return obj.displayName
    // forwardRef → render 函数；memo → type 字段；lazy → _payload._result
    const inner = obj.render ?? obj.type ?? obj._payload?._result
    return nameOfType(inner)
  }
  return undefined
}

/** 提取组件名：elementType 优先（React 19 保留原始类型），其次 type。 */
export function getComponentName(fiber: FiberLike): string | undefined {
  const name = nameOfType(fiber.elementType ?? fiber.type)
  return name === '' || name === undefined ? undefined : name
}

function isDebugSource(value: unknown): value is FiberDebugSource {
  return value !== null && typeof value === 'object' && typeof (value as { fileName?: unknown }).fileName === 'string'
}

/**
 * 读 fiber 的 `_debugSource`（dev React 才有）。React 19 的 `_debugInfo`
 * 数组条目也可能带 `_debugSource`，一并兜底。
 */
export function getDebugSource(fiber: FiberLike): FiberDebugSource | undefined {
  if (isDebugSource(fiber._debugSource)) return fiber._debugSource
  const info = fiber._debugInfo
  if (Array.isArray(info)) {
    for (const entry of info) {
      if (entry === null || typeof entry !== 'object') continue
      const source = (entry as { _debugSource?: unknown })._debugSource
      if (isDebugSource(source)) return source
    }
  }
  return undefined
}
