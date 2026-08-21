# dsh 宿主（deepseek-harness）接入：dcf CLI 安装与构建

本文件记录 **deepseek-harness** 这类 dsh 宿主如何接入
`@havocrao/dsh-code-finder`，以及接入后的构建姿势。与 `docs/README.md` 的
通用三档（A/B/C）互补：那里讲"单项目怎么挂"，这里讲"整仓宿主怎么挂"。

> 以下路径以 deepseek-harness 仓库为例（2026-08-21 实测通过）。其他 dsh 宿主
> 结构类似时可直接套用；结构不同时按「有效层」的映射关系找对应位置。

## 0. 概览：有效层（实测）

| 层 | 目标 | 覆盖 | 命令 | 有效性 |
|---|---|---|---|---|
| ~~L1 构建期注入（shell）~~ | ~~`apps/web/vite.config.ts`~~ | apps/web 只有入口 `main.ts`，**无 .tsx 组件源码** | ~~`dcf init --cwd apps/web`~~ | ❌ **已废弃**（已 `dcf remove`） |
| L2 运行时 overlay | `packages/bundle/web-app/cordis.patch.yml` | **一切 hover 的展示端**（蓝框/fiber/搜索路由），全页生效 | `dcf init --cwd packages/bundle/web-app --link <cf>` | ✅ 有效 |
| L3 构建期注入（client UI，**主力**） | 共享 preset `packages/client/tsdown.client.ts` 的 `clientConfig()` plugins | 页面所有 UI 组件（conversation/settings/sidebar…，运行时 `/plugins/*/client.js` 加载） | 手动加一行（见 §3） | ✅ 有效 |

- **L2 是基线**：没有 overlay，`data-locatorjs` 静默躺在 DOM 里没人读。
- **L3 是注入主力**：页面 UI 组件全在 client plugin bundles。
- **注入通道是 `dev-web.ts`（tsdown src 直编），不是 `build:lib`**：harness
  client 包构建是两阶段——`tsc` 先把 src 编成 `lib/types/*.js`（JSX 已转成
  `_jsx` 调用），`tsdown` 再 bundle lib/types 产物 → **build:lib 路径无 JSX 可
  注入**（生产语义本就不注入，发布天然干净）；`dev-web.ts` 的 tsdown 用
  **src direct build**（JSX 在），`codeFinderTsdown()` 在此生效。
- L1 废弃原因：apps/web 无组件源码，vite 注入无对象（实测 transform 全跑
  但命中的都不是 JSX → 0 注入）。

## 1. 前置

```bash
# 构建 code-finder 本体（产物 lib/ 是 link 安装的解析目标）
cd ~/Documents/Projects/tools/DSH-code-finder
pnpm build
```

## 2. 有效 CLI 速览（从零到 hover 有信息，共 5 步）

```bash
# ① 构建 code-finder 本体（见 §1）
# ② L2：挂 overlay 插件（dcf 自处理：link 安装 + patch 注入 + 幂等）
dcf init --cwd packages/bundle/web-app --link ~/Documents/Projects/tools/DSH-code-finder
# ③ L3：共享 preset 一键注入（clientConfig 精准注入，覆盖所有 client 包）
dcf init --cwd packages/client --link ~/Documents/Projects/tools/DSH-code-finder
# ④ dev 语义构建（注入落进 client bundles）+ 启动
pnpm exec tsx scripts/dev-web.ts --once && pnpm dsh web
```

> harness 的 `apps/web` 不需要也**不要**再 `dcf init`——它无 .tsx 组件源码，
> vite 注入无对象（实测 0），已废弃。

## 3. L2：overlay 插件（唯一有效的 dcf init 注入）

`--link` 指向本地 code-finder 仓库——registry 未发布时以 `link:` 协议安装；
发布后去掉 `--link` 即可（`pnpm add @havocrao/dsh-code-finder`）。

```bash
# 在 harness 仓库根下：
dcf init --cwd packages/bundle/web-app --link /Users/havoc420/Documents/Projects/tools/DSH-code-finder
```

效果：`packages/bundle/web-app/cordis.patch.yml` 的 insert 块首行挂双面插件：

- id **刻意与包内官方 patch 错开**（`dsh-code-finder-mount` vs 官方的
  `dsh-code-finder`）：包声明 `dsh.bundle.patch`，被 bundle 栈 reconcile 时
  官方行随包自动应用，id 相同会在 load 期抛 `duplicate loader entry id`
  （`disabled` 是运行期评估，救不了 load 期重复 id）；错开后官方行表达式
  （同名异 id 启用时退避）让官方行让位，单一活跃；
- 依赖 link 到 `web-app` 子包的 `node_modules`。

幂等：重复执行显示「已接入（无改动）」。回滚：`dcf remove --cwd packages/bundle/web-app`
（`--keep-deps` 只回滚接线、保留依赖）。

> **monorepo 根跑会提示，不会越界**：`dcf init --cwd <harness 根>` 因为根是
> 条件式 tsdown orchestrator（无字面 `plugins: [` 数组）会如实报告未注入，
> 并列出检测到的深层 `cordis.patch.yml` + 对应 `--cwd` 命令（harness 有 5 个
> patch，自动注入有歧义，故 CLI 只提示、不自动改）。

## 4. L3：client bundles 共享 preset 注入（主力，dcf 一键）

页面大多数组件来自 client 插件包（`packages/client/*`），它们共享
`packages/client/tsdown.client.ts` 的 `clientBundle()` preset 构建。dcf 检测到
`clientConfig()` 共享 preset 时**只精准注入该函数的 plugins 数组**（其余数组
如 `staticLinkedConfig` 不动），**所有 client 包同时获得元素级注入**：

```bash
# 一键：workspace 子目录安装（--workspace-root 自动重试）+ import + clientConfig 精准注入
dcf init --cwd packages/client --link /Users/havoc420/Documents/Projects/tools/DSH-code-finder
# 幂等：重复执行「已接入（无改动）」；回滚：dcf remove --cwd packages/client
```

效果（实测）：`tsdown.client.ts` 仅 2 处改动——顶部 import + `clientConfig()`
的 `plugins: [codeFinderTsdown(), {`；`staticLinkedConfig` 等数组零污染；
`dev-web.ts --once` 后 client bundles 注入 402 处/包。

## 5. 构建姿势

注入开关：`NODE_ENV === 'development' || CODE_FINDER === '1'`
（`src/build/transform.ts` 的 `codeFinderEnabled`）。

| 场景 | 命令 | 注入 |
|---|---|---|
| dev 一次性重建（推荐开发/验证） | `pnpm exec tsx scripts/dev-web.ts --once` | ✓（脚本内置 `NODE_ENV=development` + **src 直编**，client bundles 注入） |
| dev watch 循环 | `pnpm run dev:web` | ✓ |
| serve（只 serve 不构建） | `pnpm dsh web` | 无关（读已烘焙属性） |
| 全量生产构建 | `pnpm run build` | ✗ 0 处（发布正确行为） |
| 只重编前端 shell | `pnpm run build:web` | ✗（vite 默认 production） |
| 强制注入逃生门 | `CODE_FINDER=1` | ✓（临时验证用，不推荐发布） |

**陷阱**：root 的 `build:dev` 用的是 `NODE_ENV=developer`（**不是**
`development`）→ 不会注入，别被名字误导。`pnpm run build` 会把 dev 产物
覆盖回无注入版本——dev 中途手滑跑过，hover 退回「只有组件名」，重跑
`dev-web.ts --once` 恢复。

## 6. 验证

```bash
dcf status --cwd packages/bundle/web-app     # cordis.patch.yml 已接线 + 依赖已安装
# dev 重建后抽查产物（L3 生效的硬证据）：
grep -rl data-locatorjs packages/client/*/lib/client.js | head   # client UI 注入
grep -c data-locatorjs packages/client/ui-conversation/lib/client.js   # 实测 402
# 浏览器：pnpm dsh web → Opt+Shift 悬停组件 → 蓝框 + `<组件名> path:line:col`
```

## 7. 卸载

```bash
dcf remove --cwd packages/bundle/web-app
# L3：删掉 preset 里加的那一行 + 根级 pnpm remove @havocrao/dsh-code-finder
```

`remove` 只精确移除 CLI 自己加的 import / plugins / cordis 行，其余修改保留；
连带卸载依赖（`--keep-deps` 保留）。

## 8. 常见坑

- **`--link` 只解决本地开发**：`link:` 协议写进子包 `package.json`
  （`"@havocrao/dsh-code-finder": "link:/abs/path"`）。提交前要么发布到
  registry 后重跑 `dcf init`（去 `--link`），要么按 better-sidebar 先例把
  `../../DSH-code-finder` 加进 `pnpm-workspace.yaml` 作为 workspace 成员。
- **L3 依赖必须在根**：client preset 的 import 由仓库根启动的 tsdown 解析，
  link 在子包下根级解析不到。
- **`prepare`/`postinstall` 陷阱**：安装触发重建会以生产语义覆盖 dev 产物，
  install 后 hover 变无信息——`grep -c data-locatorjs <bundle>` 自查，被覆盖
  就重跑 `dev-web.ts --once`。
- **monorepo 多 patch**：harness 有 5 个 `cordis.patch.yml`，dcf 只对
  `--cwd` 明确指向的那个动手；根跑只提示。
- **`ctx.config` 不可读**：cordis 4 中插件 apply 读 `ctx.config` 会抛
  "cannot get property config without inject"——host 半只用 apply 第二参
  （无 Config schema 时 loader 原样传 entry config）。
