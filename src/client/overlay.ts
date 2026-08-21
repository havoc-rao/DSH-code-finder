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
      top: -46px;
      left: -2px;
      display: flex;
      flex-direction: column;
      gap: 1px;
      max-width: min(80vw, 720px);
      padding: 4px 8px;
      border-radius: 4px;
      background: #2563eb;
      color: #fff;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      pointer-events: none;
    }
    .cf-label.under { top: auto; bottom: -46px; }
    .cf-name {
      font-weight: 600;
      white-space: nowrap;
    }
    /* 完整路径 + 行号。direction: rtl 让 text-overflow 的省略号出现在左端，
       保留尾部「文件名:行」始终可见（路径再长也不丢行号）；plaintext
       避免中文路径/数字被 RTL 打乱分段。 */
    .cf-path {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      direction: rtl;
      unicode-bidi: plaintext;
      opacity: 0.92;
    }
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
  const nameEl = document.createElement('div')
  nameEl.className = 'cf-name'
  const pathEl = document.createElement('div')
  pathEl.className = 'cf-path'
  label.append(nameEl, pathEl)
  const toast = document.createElement('div')
  toast.className = 'cf-toast'
  // label 必须挂在 box 内：.cf-label 的 absolute 定位（top:-46px/left:-2px）以
  // 最近的定位祖先为包含块——box 是 absolute 定位，挂 box 内才贴边框左上角；
  // 此前误挂 shadow 根，包含块变成 fixed host（整个视口），标签被定在视口
  // 顶部上方永远不可见，只剩蓝框（.click 复制走 toast，不受影响）。
  box.append(label)
  shadow.append(box, toast)

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

    // 标签两行：第一行 <组件名>，第二行 完整路径:行（不显示列，列仅用于内部
    // 组件名反查与跳转载荷；无位置时提示无源码信息）。
    // 完整路径直接可见（不再只显示 basename，完整路径此前仅在 title tooltip）。
    nameEl.textContent = `<${hit.name === '' ? '未知组件' : hit.name}>`
    if (hit.path !== undefined) {
      const location = `${hit.path}${hit.line !== undefined ? `:${hit.line}` : ''}`
      pathEl.textContent = location
      pathEl.style.opacity = '0.92'
    } else {
      pathEl.textContent = '（无源码信息）'
      pathEl.style.opacity = '0.7'
    }
    label.title = hit.path ?? ''
    label.classList.toggle('under', rect.top < 50)
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
