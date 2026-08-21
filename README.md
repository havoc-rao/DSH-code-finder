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

## 一键接入（npx CLI）

发布后可用 `npx` 免安装自动接线 / 诊断 / 回滚：

```bash
npx @havocrao/dsh-code-finder init      # 自动装依赖(pnpm/yarn/npm) + 接线 vite/tsdown/cordis
npx @havocrao/dsh-code-finder status    # 诊断接线状态 + 产物注入抽查
npx @havocrao/dsh-code-finder remove    # 完整卸载：精确移除注入 + 移除依赖
# 可选: --cwd <dir>  --no-install  --keep-deps  --link <path>  --quiet
```

- 不产生任何备份文件（副作用零残留）
- `remove` 是**完整卸载**：只精确移除 CLI 自己加的 import/plugins 条目/cordis 行
  （接线后你的手动修改原样保留），并连带移除依赖
- 幂等：重复 init 无副作用；支持 vite.config.* / tsdown.config.* / cordis.patch.yml
- 接线后仍需 **dev 语义构建**（`NODE_ENV=development` 或 vite dev）才产生注入，见 docs/README「构建期注入生效机制」

### 发布前：本地 link 安装（包未上 registry 时）

未发布到 npm registry 前，`init` 的依赖安装会 404；CLI 会如实提示（不再降级到 yarn/npm 卡交互）。用 `link:` 协议走本地仓库：

```bash
# ① 全局安装 CLI（可选，等价于 npx；任意目录可用 dcf / dsh-code-finder）
cd <DSH-code-finder 仓库路径> && npm link

# ② 目标项目一键安装（自动 pnpm add -D link:<仓库> + 接线 vite/tsdown/cordis）
cd <目标项目>
dcf init --cwd . --link <DSH-code-finder 仓库路径>
# 等价手动两步：
#   pnpm add -D link:<DSH-code-finder 仓库路径>
#   dcf init --cwd . --no-install
```

- `--link <path>`：以 `link:` 协议安装依赖（`pnpm add -D link:<path>`），绕过 registry
- 已安装检测只查目标项目自身 `node_modules`（不会沿上级目录链误命中源码仓库而跳过安装）
- 本地开发改 cf 源码后，目标项目重建即读到新产物（link 直指源码仓库）
- 发布后无需任何 `--link`，`dcf init --cwd .` 一条命令走 registry 自动装依赖 + 接线；`npx dcf init` 免安装即用

## 快速开始

### vite 项目

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { codeFinderVite } from '@havocrao/dsh-code-finder/vite'

export default defineConfig({
  plugins: [react(), codeFinderVite()],
})
```

```ts
// 入口（仅 dev 生效，生产 tree-shake 掉）
if (import.meta.env.DEV) {
  const { setupCodeFinder } = await import('@havocrao/dsh-code-finder/runtime')
  setupCodeFinder({})
}
```

### tsdown 项目（DSH 插件 client bundle 同款构建）

```ts
// tsdown.config.ts
import { codeFinderTsdown } from '@havocrao/dsh-code-finder/tsdown'
// client bundle 的 plugins 数组里加：
// plugins: [codeFinderTsdown()],
```

### DSH 插件（cordis，零代码，一行双面）

```yaml
# cordis.patch.yml —— 一行同时挂 host 半（搜索路由）与 client 半（overlay）：
# host 半来自包主入口（re-export cordis/host.ts 的 apply），client 半来自包
# package.json 的 dsh.client 声明 → 宿主扫描后 serve /plugins/.../client.js
# wire bundle（window.__ModuleLoader__.load 契约），浏览器 kernel 自动加载。
- insert:
    - id: code-finder
      name: '@havocrao/dsh-code-finder'
      config: { roots: ['/abs/path/to/plugin/src'] }
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
| `@havocrao/dsh-code-finder` | Node 侧：`createSourceIndex` + `handleSearchRequest` + **cordis host 插件**（`name`/`apply`/`inject` re-export） |
| `.../client` | **cordis 插件 client 半（harness-wire bundle）**：`window.__ModuleLoader__.load({id, factory})` 契约，宿主 `/plugins/.../client.js` 端点直接 serve |
| `.../runtime` | 运行时 overlay（ESM）：`setupCodeFinder`（零框架依赖）——直接集成 / 自定义宿主用 |
| `.../cordis` | cordis 插件 host 半独立入口（包根已 re-export，一般用不着） |
| `.../cordis/client` | cordis 插件 client 半独立入口（ESM；wire bundle 在 `.../client`） |
| `.../tsdown` | tsdown/rolldown 构建期注入插件（`codeFinderTsdown`） |
| `.../vite` | vite 构建期注入插件（`codeFinderVite`） |

> 根 `package.json` 带 `dsh.client` 声明（`{ inject: [], platform: 'web' }`）：cordis 宿主
> （如 deepseek-harness web-app）在 patch 挂载本包时自动发现浏览器半并注入 bootstrap
> roster——外部工程无需任何 client 接线。构建期 `data-locatorjs` 注入仍走各工程的
> bundler 插件（`.../tsdown`、`.../vite`），或靠 host 半的 `roots` 名字搜索兜底。

## 许可证

MIT
