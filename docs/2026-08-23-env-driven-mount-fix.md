# 2026-08-23 修复：运行时挂载与构建期判定完全对称（env 驱动动态装/卸）

本文件记录一次三连环排障 + 修复，最终确立了 **NODE_ENV 单变量驱动**的运行时
语义：**构建侧与运行侧判定完全对称，非 dev 语义下 code-finder 完全不存在
（无注入数据、无 overlay、无路由）**。与 `docs/2026-08-21-dsh-host-installation.md`
（接入姿势）互补：那里讲"怎么接入"，这里讲"接入后的语义边界与本次修什么"。

## 0. TL;DR

| # | 症状 | 根因 | 修复 |
|---|---|---|---|
| 1 | 未设 `NODE_ENV` 时：无注入数据却有 overlay 空壳蓝框 | 运行侧判定宽松（`=== 'production'` 才关），与构建侧（`=== 'development'` 才注入）不对称 | mount 行/官方 patch 行/client 半/`isProductionRuntime` 全部收严为与 `codeFinderEnabled` 对称 |
| 2 | `pnpm run dev:web` 启动即 `ERR_MODULE_NOT_FOUND`（L3 通道） | 根级 `link:` 依赖被后续 `pnpm install` 对账清成孤儿（文档 §8 陷阱应验） | `pnpm add -D link:… -w` 重装到根 |
| 3 | 双终端都带 `NODE_ENV=development` 仍无 overlay；服务端全绿 | wire bundle 是 CJS，rolldown 把 `import.meta` 替换成 `{}` → `isProductionRuntime` 的 MODE 兜底通道 `undefined !== 'development'` 恒 true → 误判生产 → `setupCodeFinder` no-op | 移除 MODE 兜底：无 `process` 的未知环境默认启用（node 端 mount 行已把关） |

## 1. 三态心智模型（本次确立的核心语义）

把"数据"和"显示"解耦，只有一个变量 `NODE_ENV`：

| 场景 | 终端 A 构建（`dev:web`） | 终端 B 运行（`dsh web`） | 结果 |
|---|---|---|---|
| 开发 | `NODE_ENV=development`（烘焙 `data-locatorjs` 数据） | `NODE_ENV=development` | 数据 ✓ + overlay ✓ |
| 临时关闭 | 不用动（数据仍在 bundle） | `production` 或不设 | 数据在但 overlay 完全不存在（**零构建切换**） |
| 发布 | `pnpm run build`（production 语义） | production | 数据 0 + overlay 无 → 零负担 |

- 注入数据一旦烘焙，**切换显示只需重启 `dsh web`（换 env），不碰构建**；
- cordis 是启动期装配，`disabled` 在 node 端 loader boot 时求值——"动态装/卸"
  的代价 = `Ctrl+C` + 一条命令。

## 2. 问题 1：空壳 overlay（不对称判定）

### 症状
不设 `NODE_ENV` 跑 `dev:web` + `dsh web`：hover 无组件信息（构建没注入），
但 Alt+Shift 蓝框还在（overlay 空转）。

### 根因
| 端 | 旧判定 | 未设 NODE_ENV 时 |
|---|---|---|
| 构建期 `codeFinderEnabled`（`src/build/transform.ts`） | `=== 'development'`（严格） | 不注入 ✓ |
| 运行期 mount 行 `disabled` | `=== 'production'` 才关（宽松） | `undefined !== 'production'` → **照挂** ✗ |

### 修复（对称化，4 处 + 2 层挂载行）
运行侧判定全部镜像 `codeFinderEnabled` 语义（`CODE_FINDER` 强制开/关同义）：

1. **dcf 生成的 mount 行 + 包内官方 patch 行**（`cordis.patch.yml`）——官方行
   也必须改：它只是"同名退避"逻辑，mount 行退场后官方行会复活挂载，两处不变
   则修复失效：

```yaml
disabled: !!js "(process.env.NODE_ENV !== 'development' || ['0','off','false'].includes(process.env.CODE_FINDER)) && !['1','on','true'].includes(process.env.CODE_FINDER)"
```

   9 种 env 组合全量验证通过：未设/production/CODE_FINDER=0/off/false →
   `disabled=true`；development / CODE_FINDER=1/on/true → `disabled=false`。

2. **client 半 `isDevBuild`**（`src/cordis/client.ts`）：`!== 'production'` →
   `=== 'development'`（`CODE_FINDER` 优先，与构建侧同优先级）。

3. **`isProductionRuntime`**（`src/client/index.ts`）：见问题 3。

## 3. 问题 2：L3 依赖丢失（`ERR_MODULE_NOT_FOUND`）

### 症状
`pnpm run dev:web` 启动即失败：`Cannot find package '@havocrao/dsh-code-finder'
imported from packages/client/tsdown.client.ts`。

### 根因
文档 §8 陷阱应验：`dcf init --cwd packages/client` 装的根级 `link:` 依赖被后续
`pnpm install` 对账清成孤儿；该 import 由**仓库根**启动的 tsdown 解析
（"L3 依赖必须在根"），子包/`.pnpm` 里都没有 → 模块解析失败。

### 修复
```bash
cd <harness 根>
pnpm add -D link:/Users/havoc/Documents/Projects/tools/DSH-code-finder -w
```

### 排查要点（服务端可验证点清单）
以下全部通过但问题仍在 → 问题必在浏览器侧（见问题 3）：
- `node -e "import('@havocrao/dsh-code-finder/tsdown')"` OK；
- `ls node_modules/@havocrao` 链接存在；
- `NODE_ENV=development pnpm run dev:web` 启动无错、tsdown 正常产包；
- `grep -c data-locatorjs packages/client/<pkg>/lib/client.js` → 398（注入在盘）。

## 4. 问题 3：wire bundle 误判生产（本轮回合最深的坑）

### 症状
构建/运行两端都带 `NODE_ENV=development`，重新 kill & restart 后依旧无
overlay；服务端排查全绿（路由 200、注入 398、wire 200+语法 OK、boot entries
含 code-finder）。

### 根因（编译产物实锤）
`isProductionRuntime` 双通道"兜底"被严格化后组合出误判：

```js
// wire bundle 实际编译产物（lib/client.js）：
function isProductionRuntime() {
  try { return process.env.NODE_ENV !== "development" }
  catch {
    try { return {}.env?.MODE !== "development" }   // ← import.meta 被 rolldown 替换成 {}
    catch { return false }
  }
}
```

浏览器执行链：`process` 未定义 → catch → `{}.env?.MODE` = `undefined`
→ `undefined !== 'development'` → **true → 判生产 → `setupCodeFinder` no-op →
overlay 永不创建**。宽松版时代该通道是 `=== 'production'` → false → 一直启用
（这正是问题 1 里"空壳蓝框"能出现的另一半原因）。

### 修复：MODE 兜底彻底移除
```ts
function isProductionRuntime(): boolean {
  try {
    // 打包器 define 直接替换为字面量；浏览器无 process 抛错走 catch → 启用。
    return process.env.NODE_ENV !== 'development'
  } catch {
    return false
  }
}
```

- **显式环境**（process 可读 / 被 define）：`development` 才运行（对称）；
- **未知环境**（浏览器 wire bundle 无 process 无 MODE）：**默认启用**——wire
  bundle 能被浏览器加载并执行 apply，本身已由 node 端 mount 行（disabled 按
  NODE_ENV 求值）把过关，浏览器端无需再防御生产；
- vite/webpack 宿主都会 define `process.env.NODE_ENV`，第一通道即可判定。

三态验证（node 模拟）：浏览器无 process → 启用 ✓；vite production → 禁用 ✓；
vite development → 启用 ✓；node 生产 → 禁用 ✓。

## 5. 排查方法论（本轮沉淀）

- **node 端 vs 浏览器端二分**：先证 node 端——`POST /code-finder/api/search`
  返回 200 即 entry 已 apply（mount 行 disabled 求值正确的最强证据）；
- **boot 数据**：浏览器只认 `window.__DSH_BOOT__`（HTML 内联 JSON）里的
  `entries`——`id`/`url`/`rev` 三件套齐全才可能 import wire bundle；
- **wire bundle 直接读编译产物**：`sed -n '/function isProductionRuntime/,/^	}/p'`
  看 rolldown/tsdown 替换后的真实代码——`import.meta → {}` 的替换痕迹是本次
  破案关键；
- **缓存/rev**：wire bundle 内容变化后必须重启 `dsh web`（rev 是 boot 时烘焙
  的），浏览器硬刷新 `Cmd+Shift+R`。

## 6. 回归防护

- `tests/client.spec.ts`：新增「MODE=production 不影响启用」回归用例
  （直击 MODE 兜底 bug）；`beforeEach` 显式 `NODE_ENV=development` + afterEach
  `unstubAllEnvs/unstubAllGlobals`；
- `tests/cordis.spec.ts`：新增「未设 NODE_ENV（非 dev 语义）不启用」；
- `tests/cli.spec.ts`：断言新 disabled 表达式（含 `NODE_ENV !== 'development'`
  与 `CODE_FINDER` 强制开关）；
- 别用 `vi.stubGlobal('process', undefined)` 模拟浏览器无 process——会把
  vitest 自身的 process 干掉（rpc 全崩，`process.nextTick` 级联失败）；
  用「MODE 回归」+「编译产物三态 node 验证」代替。

## 7. 状态

- 测试 94/94 通过；typecheck 干净；`pnpm build` 正常；
- harness 侧：mount 行已 re-init 为新表达式；根级 link 依赖已装；
  `NODE_ENV=development pnpm dsh web` + 浏览器硬刷后 overlay 恢复（实测）；
- 文档同步：`docs/2026-08-21-dsh-host-installation.md` §2⑤/§5/§5.1/§6 已更新
  为严格 dev 语义（`NODE_ENV=development pnpm dsh web` 等）。