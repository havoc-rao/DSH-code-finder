# dsh-code-finder

Dev-only **React 组件 → 源码定位**工具：按住 **Opt+Shift**（`Alt+Shift`）悬停页面上
任意 React 组件，overlay 显示组件名与 `文件:行:列`；点击即可打开源码
（IDE / 侧边栏编辑器 / 复制路径，动作可插拔）。

独立 npm 包，插入即用：

- **任意 React 项目**：vite / tsdown 构建插件（dev-only 注入）+ 一行 runtime；
- **DSH 插件生态**：cordis 包装，挂载即用、零代码（还提供源码搜索路由兜底宿主 UI）。

完整接入指南见 **[docs/README.md](./docs/README.md)**（vite / tsdown / cordis 纯
runtime 三档）。设计文档见 [docs/plans/2026-08-20-code-finder-tool-design.md](./docs/plans/2026-08-20-code-finder-tool-design.md)。

## 三层定位

hover 一个元素时按优先级取源码位置：

1. **构建期注入**（`data-locatorjs` 属性 + `__LOCATOR_DATA__` 注册表）——应用自己
   构建的组件，**元素级精确行号**，生产宿主环境下依然有效；
2. **fiber 遍历**（`_debugSource` / `_debugInfo`）——dev React 宿主（如 vite dev
   server）下自动可用，零改动覆盖宿主 UI；
3. **组件名兜底** + **源码搜索路由**（`/code-finder/api/search`）——生产宿主组件
   至少显示名字，搜索命中时给出位置。

> 注意：生产 React 构建没有 `_debugSource`，宿主 UI 的精确行号在**不修改宿主构建**
> 的前提下不可达——这是预期行为（名字级 + 搜索级）。

## 快速开始

### vite 项目

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { codeFinderVite } from '@omdsh-dev/dsh-code-finder/vite'

export default defineConfig({
  plugins: [react(), codeFinderVite()],
})
```

```ts
// 入口（仅 dev 生效，生产 tree-shake 掉）
if (import.meta.env.DEV) {
  const { setupCodeFinder } = await import('@omdsh-dev/dsh-code-finder/client')
  setupCodeFinder({})
}
```

### tsdown 项目（DSH 插件 client bundle 同款构建）

```ts
// tsdown.config.ts
import { codeFinderTsdown } from '@omdsh-dev/dsh-code-finder/tsdown'
// client bundle 的 plugins 数组里加：
// plugins: [codeFinderTsdown()],
```

### DSH 插件（cordis，零代码）

```yaml
# cordis.patch.yml
- insert:
    - id: code-finder
      name: '@omdsh-dev/dsh-code-finder'                    # host 半：搜索路由
      config: { roots: ['/abs/path/to/plugin/src'] }
    - id: code-finder-client
      name: '@omdsh-dev/dsh-code-finder/cordis/client'      # client 半：dev 自动启用
```

## 触发与动作

```ts
setupCodeFinder({
  hotkeys: 'alt+shift',          // 默认；'alt' | 'cmd+shift' | null（null 关闭）
  onClick: (hit) => { /* 打开/复制 hit.path */ },
  searchEndpoint: '/code-finder/api/search',
  showNamesOnly: true,
  debug: false,
})
// 返回 { destroy() }，HMR / 卸载时调用
```

## 包结构

单包多入口（`lib/*.js` + `lib/types/**/*.d.ts`）：

| 入口 | 内容 |
|---|---|
| `@omdsh-dev/dsh-code-finder` | Node 侧：`createSourceIndex` + `handleSearchRequest` |
| `.../client` | 运行时 overlay：`setupCodeFinder`（零框架依赖） |
| `.../cordis` | cordis 插件 host 半：`/code-finder/api/search` 路由 + 信任 fence |
| `.../cordis/client` | cordis 插件 client 半：dev 自动 `setupCodeFinder` |
| `.../tsdown` | tsdown/rolldown 构建期注入插件（`codeFinderTsdown`） |
| `.../vite` | vite 构建期注入插件（`codeFinderVite`） |

## 许可证

MIT
