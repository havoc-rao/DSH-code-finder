# 需求描述：DSH web + 插件 前端组件定位工具（dsh-code-finder）

> 整理日期：2026-08-20
> 关联：`docs/plans/2026-08-20-code-finder-tool-design.md`（设计方案）、be-sider 实测记录

## 1. 背景与目标

DSH web（`dsh web`，生产 React 构建）上装载了 be-sider 等插件。开发时需要一种
**前端调试手段**：按住 **Opt+Shift** 悬停页面上任意 React 组件，overlay 显示该组件
**真实组件名 + 精确源码位置（文件:行:列）**；点击可打开源码（本地 IDE / 侧边栏编辑器 /
复制路径）。

目标：**同时覆盖宿主 UI 组件与插件组件**（如 be-sider），并且**不要求插件做任何
运行时编辑**——插件只需在构建时打上标记，宿主侧注入的 runtime 即可识别。

## 2. 核心需求

1. **Opt+Shift 悬停定位**：按住 Opt+Shift，overlay 显示 `<组件名> 文件:行:列`；
2. **真实组件名**：生产 React 下 fiber 函数名被压缩（`Sidebar` → `af`），必须能显示
   真实组件名（如 `<Sidebar>`），而非 minified 名；
3. **精确行号**：插件组件（be-sider）必须有元素级精确行号（`src/client/Sidebar.tsx:1106`），
   不依赖 `_debugSource`（生产 React 无此字段）；
4. **宿主侧注入、插件零运行时编辑**：在 dsh web 侧注入 runtime，直接对**所有已打标记**
   的插件组件生效——插件无需挂 runtime，只需构建时打标记；
5. **点击动作可插拔**：打开本地 IDE CLI / 侧边栏编辑器 / 复制路径；
6. **仅 dev 构建生效**，生产构建零负担（零注入、零 runtime 体积）。

## 3. 架构机制（分层，已实现并实测验证）

```
┌─ 构建期（打标记，数据）──────────────────────────────────────┐
│ 插件自己的 tsdown 构建挂 codeFinderTsdown()                    │
│  → 每个 JSX 元素注入 data-locatorjs="<absPath>:<line>:<col>"   │
│  → 写 window.__LOCATOR_DATA__ 注册表（含真实组件名）           │
└────────────────────────────────────────────────────────────────┘
┌─ 运行时（注入，交互）─────────────────────────────────────────┐
│ dsh web / 任意一方 setupCodeFinder()                           │
│  → overlay document 级全局监听（Opt+Shift hover/click）        │
│  → 读 window.__LOCATOR_DATA__ + DOM 属性（跨 bundle 共享）     │
│  → 解析链：data 属性 → fiber _debugSource → 组件名 → 搜索兜底  │
└────────────────────────────────────────────────────────────────┘
┌─ host 半（可选，搜索兜底）────────────────────────────────────┐
│ /code-finder/api/search：组件名 → 源码搜索（roots 可配置）     │
└────────────────────────────────────────────────────────────────┘
```

关键解耦：**标记（构建期）与 runtime（运行时）互相独立**。标记写入
`window.__LOCATOR_DATA__` 与 DOM 属性（共享空间），overlay 全局监听——
因此**宿主侧注入的 runtime 天然能读到所有插件构建时打的标记**，
插件无需任何运行时编辑。

## 4. 实测现状（be-sider + dsh web，已运行验证）

| 检查项 | 结果 |
|---|---|
| `window.__LOCATOR_DATA__` 注册表 | 67 条，全部为 be-sider 条目（`src/client/breakpoints.ts` 等） |
| DOM 上 be-sider `data-locatorjs` 属性 | 223 个（sidebar 面板内） |
| be-sider 构建注入 | `tsdown.config.ts:151` 已挂 `codeFinderTsdown()` |
| 真实 hover（Playwright 键盘+鼠标） | `<af> Sidebar.tsx:1106:12`——行号精确 ✅，组件名被压缩 ❌ |
| react-code-finder 对照 | 频繁 "no source info"——生产 React 无 `_debugSource`，不可用 ❌ |

## 5. 待办 / 已知问题

1. **真实组件名**（`<af>` → `<Sidebar>`）：已实现按 (path, line, column) 反查
   `__LOCATOR_DATA__` 注册表表达式名覆盖 minified fiber 名（`lookupComponentNameByPosition`，
   改动在 `src/client/locator-data.ts` / `src/client/resolve.ts` / `tests/resolve.spec.ts`），
   **已验证（2026-08-20）：`pnpm test` 66 个全绿（resolve.spec 新增 4 个用例）+
   `pnpm build` + `pnpm typecheck` 全过**；真实浏览器复测按 docs/README.md
   「be-sider case 端到端试用」流程执行（详见 plan §12 偏差记录 #17）；
2. **宿主 UI（dsh-client-web / dsh-client-ui-* 包）精确行号**：这些 workspace 包以
   预构建 lib 产物（`lib/index.js`）进 vite，`apps/web` 的 vite transform 碰不到源码——
   **要精确行号需给 `packages/client/tsdown.client.ts` 的共享 preset 挂 `codeFinderTsdown()`**
   （改 DSH 官方源码构建，违反 AGENTS.md「禁止修改 DSH 源码」约束，**需用户决策**）；
   不改则宿主 UI 组件只有 minified 名 + 搜索兜底（名字级）；
3. **搜索路由冲突**：be-sider 与 dsh-code-finder 的 host 半都注册 `/code-finder/api/search`，
   同时挂载会冲突——建议搜索统一由 dsh-code-finder host 半提供，be-sider 移除自身搜索路由。

## 6. 验收标准

- [ ] dev 构建下，Opt+Shift 悬停 be-sider 组件显示 `<Sidebar> src/client/Sidebar.tsx:1106:12`
      （真实组件名 + 精确行号）；
- [ ] 悬停宿主 UI 组件显示组件名（minified 名 + 搜索兜底位置）；
- [ ] 点击 → 本地 IDE（`open.local`）或侧边栏编辑器打开对应源码，失败回退复制路径；
- [ ] 生产构建产物无 `data-locatorjs` 注入、无 runtime 代码（零负担）；
- [ ] be-sider / dsh-code-finder 全量测试通过，`dsh web` 挂载冒烟无回归；
- [ ] （可选，需决策）宿主 UI 组件精确行号：workspace 包构建挂注入后同样满足。

## 7. 交付形态

- 独立项目：`/Users/havoc420/Documents/Projects/tools/DSH-code-finder`（npm `@omdsh-dev/dsh-code-finder`）；
- 多入口：`./client`（runtime）/ `./tsdown` / `./vite`（构建插件）/ `./cordis`（DSH 生态包装）/ `.`（host 搜索）；
- be-sider 为第一个接入 case（workspace link 已在 `pnpm-workspace.yaml` 配置）。
