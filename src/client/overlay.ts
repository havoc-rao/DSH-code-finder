/**
 * 悬浮 overlay：shadow DOM 隔离的边框 + 标签 + toast，`pointer-events: none`。
 * 零框架依赖、纯 DOM 操作；z-index 取接近最大值但不遮交互（比宿主错误条低 1）。
 * 固定定位的宿主节点不占文档流，滚动/缩放时自动隐藏（下一次 mousemove 重新定位）。
 */
import type { CodeFinderHit } from './resolve'

/** overlay 的宿主与内部元素。 */
export interface OverlayHandle {
  /** 在元素四周画边框 + 左上角标签。 */
  show(element: Element, hit: CodeFinderHit): void
  /** 右下角 toast（点击反馈用），自动淡出。 */
  toast(text: string): void
  hide(): void
  destroy(): void
}

const HOST_Z_INDEX = 2147482999 // 2147483000 是 be-sider 错误条的 z-index，让 1 保持在其下
const TOAST_DURATION_MS = 1800

export function createOverlay(): OverlayHandle {
  const host = document.createElement('div')
  host.style.cssText = `position: fixed; inset: 0; z-index: ${HOST_Z_INDEX}; pointer-events: none;`
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }
    .cf-box {
      position: absolute;
      border: 2px solid #2563eb;
      border-radius: 3px;
      box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.35), 0 2px 8px rgba(0, 0, 0, 0.25);
      pointer-events: none;
      box-sizing: border-box;
      display: none;
    }
    .cf-box.visible { display: block; }
    .cf-label {
      position: absolute;
      top: -26px;
      left: -2px;
      max-width: 70vw;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 3px 8px;
      border-radius: 4px;
      background: #2563eb;
      color: #fff;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      pointer-events: none;
    }
    .cf-label.under { top: auto; bottom: -26px; }
    .cf-toast {
      position: fixed;
      right: 16px;
      bottom: 16px;
      padding: 6px 12px;
      border-radius: 6px;
      background: rgba(17, 24, 39, 0.92);
      color: #e5e7eb;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.18s ease, transform 0.18s ease;
      pointer-events: none;
    }
    .cf-toast.visible { opacity: 1; transform: translateY(0); }
  `
  shadow.appendChild(style)

  const box = document.createElement('div')
  box.className = 'cf-box'
  const label = document.createElement('div')
  label.className = 'cf-label'
  const toast = document.createElement('div')
  toast.className = 'cf-toast'
  shadow.append(box, label, toast)

  let toastTimer: number | undefined
  let disposed = false

  const hide = (): void => {
    box.classList.remove('visible')
  }

  const show = (element: Element, hit: CodeFinderHit): void => {
    if (disposed) return
    if (!element.isConnected) {
      hide()
      return
    }
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      hide()
      return
    }
    box.style.left = `${rect.left - 2}px`
    box.style.top = `${rect.top - 2}px`
    box.style.width = `${rect.width + 4}px`
    box.style.height = `${rect.height + 4}px`
    box.classList.add('visible')

    // 标签文案：<组件名> 文件名:行:列（无位置时提示无源码信息）
    const location = hit.path !== undefined
      ? `${baseNameOf(hit.path)}${hit.line !== undefined ? `:${hit.line}${hit.column !== undefined ? `:${hit.column}` : ''}` : ''}`
      : '（无源码信息）'
    label.textContent = `<${hit.name === '' ? '未知组件' : hit.name}> ${location}`
    label.title = hit.path ?? ''
    label.classList.toggle('under', rect.top < 30)
  }

  const toastShow = (text: string): void => {
    if (disposed) return
    if (toastTimer !== undefined) window.clearTimeout(toastTimer)
    toast.textContent = text
    toast.classList.add('visible')
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('visible')
      toastTimer = undefined
    }, TOAST_DURATION_MS)
  }

  // 滚动/缩放会让边框定位失效：直接隐藏，下一次 mousemove 再定位。
  const hideOnLayoutChange = (): void => hide()
  window.addEventListener('scroll', hideOnLayoutChange, true)
  window.addEventListener('resize', hideOnLayoutChange)

  document.body.appendChild(host)

  return {
    show,
    toast: toastShow,
    hide,
    destroy: () => {
      disposed = true
      if (toastTimer !== undefined) window.clearTimeout(toastTimer)
      window.removeEventListener('scroll', hideOnLayoutChange, true)
      window.removeEventListener('resize', hideOnLayoutChange)
      host.remove()
    },
  }
}

/** 取路径的 basename（兼容正反斜杠）。 */
function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]/u)
  return parts[parts.length - 1] ?? path
}
