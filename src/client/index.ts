/**
 * `setupCodeFinder(options)`：运行时 overlay 入口。
 *
 * - **幂等单例**：重复调用先 destroy 旧的（HMR 友好）；
 * - **热键捕获**：keydown/keyup 记录按住状态；IME 组合输入、输入框内不触发
 *   （复用 better-sidebar ime-guard 的判定思路）；
 * - **mousemove** 按住热键 → 解析链 ①②③ → overlay.show；④ 源码搜索异步补位；
 * - **click** 按住热键 → 阻止默认行为 → `onClick(hit)`（默认复制
 *   `path:line:column`，无路径时复制组件名）；
 * - **destroy()** 解绑全部监听并移除 overlay。
 *
 * 生产防护：`isProductionRuntime()` 命中时返回空操作句柄（调用方按环境懒加载
 * 才是正解，这里是双保险）。本模块零框架依赖，不 import react。
 */
import { findComponentFiber, findFiberByDomNode } from './fiber'
import { createOverlay, type OverlayHandle } from './overlay'
import { resolveHit, type CodeFinderHit } from './resolve'

/** 热键组合。 */
export type CodeFinderHotkeys = 'alt+shift' | 'alt' | 'cmd+shift' | null

export interface CodeFinderOptions {
  /** 触发热键；默认 'alt+shift'；null 关闭热键（overlay 仍可手动调用）。 */
  hotkeys?: CodeFinderHotkeys
  /** 点击动作；默认复制 `path:line:column` 到剪贴板。 */
  onClick?: (hit: CodeFinderHit) => void
  /** 源码搜索端点（cordis host 半提供时传入）；默认 undefined = 关闭第④层。 */
  searchEndpoint?: string
  /** 无源码信息时是否显示组件名（默认 true）。 */
  showNamesOnly?: boolean
  /** 调试日志（默认 false）。 */
  debug?: boolean
}

export interface CodeFinderHandle {
  /** 解绑全部监听并移除 overlay（幂等）。 */
  destroy(): void
}

export type { CodeFinderHit, HitSource } from './resolve'

/** 搜索命中的候选结构（与 src/index.ts 的 SourceCandidate 对齐）。 */
interface SearchCandidate {
  file: string
  line?: number
  column?: number
  name?: string
}

/** 搜索缓存 TTL（ms）：同名组件短时间内不重复请求。 */
const SEARCH_CACHE_TTL_MS = 30_000

let active: { destroy(): void } | null = null

/** 是否为生产运行环境（打包器 define / vite MODE 双通道判定）。 */
function isProductionRuntime(): boolean {
  try {
    // 打包器 define 直接替换为字面量；浏览器无 process 时抛错走 catch。
    if (process.env.NODE_ENV === 'production') return true
  } catch {
    // 纯浏览器 ESM：无 process，继续看 import.meta.env
  }
  try {
    const mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE
    return mode === 'production'
  } catch {
    return false
  }
}

/** 目标是否处于文本编辑状态（输入框 / 文本域 / contentEditable）。 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof Element)) return false
  const element = target as HTMLElement
  if (element.isContentEditable) return true
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * 启动（或重启）code-finder 运行时。重复调用会先销毁上一次的实例。
 */
export function setupCodeFinder(options: CodeFinderOptions = {}): CodeFinderHandle {
  if (active !== null) {
    active.destroy()
    active = null
  }
  if (isProductionRuntime()) {
    if (options.debug) console.debug('[dsh-code-finder] production runtime, overlay disabled')
    return { destroy() {} }
  }

  const hotkeys = options.hotkeys ?? 'alt+shift'
  const overlay = createOverlay()
  const debug = options.debug === true
  const log = (...args: unknown[]): void => {
    if (debug) console.debug('[dsh-code-finder]', ...args)
  }

  const keys = { alt: false, shift: false, meta: false, ctrl: false }
  let composing = false
  let lastHit: CodeFinderHit | null = null
  let lastElement: Element | null = null
  let generation = 0
  let searchController: AbortController | null = null
  const searchCache = new Map<string, { at: number; candidates: SearchCandidate[] }>()
  let destroyed = false

  /** 当前按键状态是否满足热键组合。 */
  const hotkeysActive = (): boolean => {
    if (hotkeys === null) return false
    switch (hotkeys) {
      case 'alt':
        return keys.alt && !keys.shift && !keys.meta && !keys.ctrl
      case 'cmd+shift':
        return keys.meta && keys.shift && !keys.alt && !keys.ctrl
      case 'alt+shift':
      default:
        return keys.alt && keys.shift && !keys.meta && !keys.ctrl
    }
  }

  const hide = (): void => {
    generation += 1
    lastHit = null
    lastElement = null
    searchController?.abort()
    searchController = null
    overlay.hide()
  }

  const applyCandidate = (hit: CodeFinderHit, candidates: SearchCandidate[]): CodeFinderHit => {
    const first = candidates.find(candidate => candidate !== undefined && candidate.file !== '')
    if (first === undefined) return hit
    return {
      ...hit,
      path: first.file,
      ...(first.line !== undefined && first.line > 0 ? { line: first.line } : {}),
      ...(first.column !== undefined && first.column > 0 ? { column: first.column } : {}),
      source: 'search',
    }
  }

  /** 第④层：把名字发到 searchEndpoint，用第一个命中补位路径/行号。 */
  const enrichWithSearch = async (hit: CodeFinderHit, gen: number): Promise<CodeFinderHit> => {
    const endpoint = options.searchEndpoint
    if (endpoint === undefined || hit.name === '' || hit.source !== 'name-only') return hit
    const cached = searchCache.get(hit.name)
    if (cached !== undefined && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) {
      return applyCandidate(hit, cached.candidates)
    }
    searchController?.abort()
    const controller = new AbortController()
    searchController = controller
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: hit.name }),
        signal: controller.signal,
      })
      if (!response.ok) return hit
      const body = (await response.json()) as unknown
      // 兼容两种出参：裸数组，或 { ok, data: [...] }（DSH writeOk 惯例）
      const candidates = Array.isArray(body) ? body : (body as { data?: unknown }).data
      if (!Array.isArray(candidates)) return hit
      const list = candidates as SearchCandidate[]
      searchCache.set(hit.name, { at: Date.now(), candidates: list })
      if (gen !== generation) return hit // 已经 hover 到别处/隐藏，丢弃过期结果
      log(`search "${hit.name}" →`, list)
      return applyCandidate(hit, list)
    } catch {
      return hit
    } finally {
      if (searchController === controller) searchController = null
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    keys.alt = event.altKey
    keys.shift = event.shiftKey
    keys.meta = event.metaKey
    keys.ctrl = event.ctrlKey
    composing = event.isComposing === true
    if (event.key === 'Escape') hide()
    else if (!hotkeysActive()) hide()
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    keys.alt = event.altKey
    keys.shift = event.shiftKey
    keys.meta = event.metaKey
    keys.ctrl = event.ctrlKey
    if (!hotkeysActive()) hide()
  }

  const onMouseMove = (event: MouseEvent): void => {
    if (destroyed) return
    if (!hotkeysActive() || composing || isEditableTarget(event.target)) {
      hide()
      return
    }
    const target = event.target
    if (!(target instanceof Element)) {
      hide()
      return
    }
    const gen = ++generation
    lastElement = target
    const fiber = findFiberByDomNode(target)
    const componentFiber = fiber === null ? null : findComponentFiber(fiber)
    const syncHit = resolveHit(target, componentFiber)
    if (syncHit === null || (syncHit.source === 'name-only' && options.showNamesOnly === false)) {
      hide()
      return
    }
    lastHit = syncHit
    overlay.show(target, syncHit)
    // ④ 搜索补位：仅当名字级命中且有搜索端点时异步升级
    if (syncHit.source === 'name-only' && options.searchEndpoint !== undefined) {
      void enrichWithSearch(syncHit, gen).then(upgraded => {
        if (gen !== generation || lastElement !== target) return
        lastHit = upgraded
        overlay.show(target, upgraded)
      })
    }
  }

  const onClick = (event: MouseEvent): void => {
    if (!hotkeysActive() || composing || isEditableTarget(event.target)) return
    // 用当前命中的 hit（mousemove 已解析）；事件目标不一致时重新解析一次。
    let hit = lastHit
    const target = event.target
    if (target instanceof Element && target !== lastElement) {
      const fiber = findFiberByDomNode(target)
      const componentFiber = fiber === null ? null : findComponentFiber(fiber)
      hit = resolveHit(target, componentFiber)
    }
    if (hit === null) return
    event.preventDefault()
    event.stopPropagation()
    hide()
    log('click →', hit)
    const handle = options.onClick
    if (handle !== undefined) {
      try {
        handle(hit)
      } catch (error) {
        console.error('[dsh-code-finder] onClick handler failed:', error)
      }
      return
    }
    // 默认动作：复制 path:line:column（无路径时复制组件名）
    const text = hit.path !== undefined
      ? `${hit.path}${hit.line !== undefined ? `:${hit.line}${hit.column !== undefined ? `:${hit.column}` : ''}` : ''}`
      : hit.name
    void copyText(text).then(ok => {
      overlay.toast(ok ? `已复制 ${text}` : '复制失败')
    })
  }

  const onCompositionStart = (): void => {
    composing = true
  }
  const onCompositionEnd = (): void => {
    composing = false
  }

  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('compositionstart', onCompositionStart, true)
  document.addEventListener('compositionend', onCompositionEnd, true)

  log('setupCodeFinder', { hotkeys, searchEndpoint: options.searchEndpoint ?? null })

  const handle: CodeFinderHandle = {
    destroy: () => {
      if (destroyed) return
      destroyed = true
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('mousemove', onMouseMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('compositionstart', onCompositionStart, true)
      document.removeEventListener('compositionend', onCompositionEnd, true)
      hide()
      overlay.destroy()
      if (active === handle) active = null
    },
  }
  active = handle
  return handle
}

/** 复制文本到剪贴板（navigator.clipboard 优先，execCommand 兜底）。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限/非安全上下文：走兜底
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}
