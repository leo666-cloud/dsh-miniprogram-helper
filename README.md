# dsh-miniprogram-helper

一个 DSH（DeepSeek Harness）插件：让 Agent 能**扫描、生成、注册、校验**微信小程序页面与配置，并能直接调微信开发者工具出预览二维码。

解决的核心痛点：AI 生成小程序时最容易犯的错是**文件建好了但忘记写进 `app.json` 的 `pages`**，页面在开发者工具里根本打不开。这个插件把「建文件 + 注册」做成一次原子操作，并且写完立刻自检。

## 11 个工具

| 工具 | 作用 |
|---|---|
| `mp_scan` | 全面体检：页面清单、文件完整性、**未注册的孤儿页**、tabBar/分包/组件路径校验、包体积 |
| `mp_page_add` | 新建页面（wxml/wxss/脚本/json）+ 自动写进 `app.json` + **写完立即自检** |
| `mp_page_remove` | 注销页面（可连文件一起删），拦掉「删启动页 / 删 tab 页 / 删到最后一个」 |
| `mp_entry_set` | 改启动页，同步 `entryPagePath` |
| `mp_register` | 只补注册已存在的页面，不建文件 |
| `mp_fix` | 一键修复：把所有「磁盘上有但未注册」的页面补进 `app.json` |
| `mp_subpackage_add` | 创建分包：校验 root + 写 `subPackages` + 搭首个页面（**登记到分包，不是主包**） |
| `mp_component_add` | 创建自定义组件 + 自动注入目标页面的 `usingComponents` |
| `mp_tabbar` | 一行配置底部 tab：`页面:文字` 列表，自动补注册页面、校验图标与 2–5 数量限制 |
| `mp_project_init` | 生成可直接导入开发者工具的工程骨架（含 `miniprogramRoot` 结构） |
| `mp_devtools` | 调微信开发者工具 CLI：`detect` / `login` / `open` / `preview`（出二维码 PNG）/ `upload` |

## 几个「懂小程序」的细节（这些决定它好不好用）

- **区分「项目根」与「代码根」**。`project.config.json` 里的 `miniprogramRoot`（常见值是 `miniprogram/`）决定 `app.json` 在哪。插件的所有路径都相对代码根解析，也接受两种入参：项目根目录、或含 `app.json` 的代码根。搞混这两个概念，生成出来的页面就会落在开发者工具看不见的地方。
- **保格式改 JSON**。`app.json` 允许写注释，但 `JSON.parse` 不认，而 `JSON.stringify` 会把用户的注释、缩进、键顺序、行尾注释全抹掉。插件内置 JSONC 解析器 + 区间替换编辑器：只改目标片段，**注释和格式原样保留**，连 `"pages/a", // 首页` 这种行尾注释都留在原行。
- **必需文件只有脚本 + `.wxml`**，`.wxss` / `.json` 是可选的。很多校验器把四件套全当必需，对合法页面疯狂误报——这里分开报：必需缺失标 ❌，可选缺失只标 ℹ️。
- **组件不会被误当页面**。判断依据是同名 `.json` 里 `"component": true`，外加跳过 `components` 目录（可配置多个）。否则 `mp_fix` 会把组件路径塞进 `pages`，直接把工程搞坏。
- **页面路径最后一段是文件名基名**：`pages/detail/index` → `pages/detail/index.wxml`，**不是** `pages/detail/index/index.wxml`。写错成目录时，扫描会主动提示「磁盘上实际存在 `pages/detail/index`，把路径改成它」。
- **分包页面绝不能被写进主包**。`mp_page_add` 会先看路径是否落在某个已声明的分包 root 下，是的话登记到该分包的 `pages`（相对分包根），而不是主包 `pages`。这是原版最危险的 bug：分包页面被塞进主包会直接编译失败。
- **不覆盖用户代码**。目标文件已存在时 `mp_page_add` / `mp_component_add` 默认跳过并明确告诉你「已保留」，要覆盖必须显式传 `force` / `overwrite`。
- **拒绝路径穿越**。`../` 会被拦下，不能把文件写到项目目录外面。
- **tabBar 一次说清所有坑**：数量 2–5、`pagePath` 必须在主包、图标文件必须真实存在、顶部 tab 不支持图标、缺的页面自动补注册。
- **开发者工具失败了能归因**。CLI 只会回一句含糊的报错；插件把 `EPERM/EACCES`（权限）、`IDE 初始化失败`、`未登录`、`服务端口没开`、`超时` 分开识别，并给出各自的修复动作。所有 CLI 调用都带超时，不会把会话卡死。

## 快速开始

### 0. 前置环境

- Node.js `^22.19` 或 `>=24`
- pnpm（`dsh plugin add` 内部转发给 pnpm）
- DSH 已装好，终端能跑 `dsh --help`

### 1. 构建

```bash
cd dsh-miniprogram-helper
pnpm install
pnpm run build          # tsc -> lib/index.js
pnpm test               # 21 个端到端测试，全部在临时目录里真跑
```

### 2. 装进 profile 并验证

```bash
# 在【父目录】执行，相对路径会锚定到你运行命令的目录
dsh plugin --profile web add ./dsh-miniprogram-helper

# 先确认插件进了配置树（这一步不 boot，很快）
dsh --profile web --dump-config | grep -A2 miniprogram
# 预期看到：
# == dsh-miniprogram-helper
# - id: miniprogram-helper
#   name: dsh-miniprogram-helper
```

**然后重启 `dsh web`，并开一个新会话** —— 客户端模块注册表在进程生命周期内缓存元数据，不重启不生效。

> Desktop 版（DeepSeek Harness.app）用的是 `desktop` profile，且该 profile 由 App 独占管理，命令行 `dsh --profile desktop` 会被拒绝。桌面版请在 App 的插件市场/插件页安装，或把插件目录链接进 `~/.dsh/profiles/desktop/node_modules` 并在 `cordis.patch.yml` 里加一行 `- insert: [{ id: miniprogram-helper, name: dsh-miniprogram-helper }]`，再重启 App。

### 3. 在会话里用

```
用 mp_scan 扫一下 ~/project/miniprogram，看看有什么问题
```

```
帮我加一个"我的订单"页面 pages/order/index，导航标题叫"我的订单"
```

```
把扫描出来的孤儿页面都注册进 app.json
```

```
加一个底部导航：首页 / 订单 / 我的
```

```
生成预览二维码，我扫码看看效果
```

也可以在插件设置里配好 `projectRoot`，之后就不用每次传路径。可配置项：

| 配置 | 默认 | 说明 |
|---|---|---|
| `projectRoot` | 空 | 默认项目路径，留空则每次由模型传 |
| `useTypeScript` | `false` | 生成 `.ts` 而非 `.js` |
| `componentDirs` | `components` | 组件目录（逗号分隔多个），扫描页面时跳过 |
| `appId` | 空 | `mp_project_init` 写入的 AppID，留空用 `touristappid` 占位 |
| `devtoolsCli` | 空 | 开发者工具 CLI 路径，留空自动探测 |
| `devtoolsPort` | 空 | IDE 服务端口；IDE 已用其它端口启动时必须填同一个 |
| `devtoolsTimeoutSec` | `90` | CLI 超时秒数 |
| `previewDir` | 空 | 预览二维码落盘目录，留空用系统临时目录 |

**微信开发者工具准备**（只在用 `mp_devtools` 时需要）：

1. 打开 IDE → 设置 → 安全设置 → **打开服务端口**
2. 扫码登录（`mp_devtools action=login` 可查）
3. macOS 的 CLI 在 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`，插件会自动探测

## 推荐工作流

```
用 mp_scan 扫一遍项目，告诉我有什么问题
→ 帮我加一个订单页 pages/order/index
→ 加个底部导航：首页 / 订单 / 我的
→ 跑一次 mp_fix 确认没有漏注册的页面
→ 再 mp_scan 复核
→ 出预览二维码
```

## 本地调试（免编译，改完立刻生效）

不想每次改代码都 build + 重装，用 `--patch` 覆盖层直接挂 `.ts` 源码：

1. 在 DSH 源码检出根建 `scratch-plugin/src/`，把本项目的 `src/` 拷过去
2. 写 `scratch-plugin/cordis.yml`，**`name` 必须填绝对路径**：

```yaml
- insert:
    - id: miniprogram-helper
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/index.ts'
```

3. 启动：`pnpm dsh web --patch ./scratch-plugin/cordis.yml`

看到终端打印 `[miniprogram-helper] 已注册 11 个工具…` 就说明装上了。

## 插件的四个约定（写 DSH 插件必须先懂）

```ts
export const name = 'miniprogram-helper'   // 插件唯一标识
export const inject = ['tools']            // 依赖声明，硬门槛
export const Config = Schema.object({...}) // 可选：可配置项
export function apply(ctx: Context, config: Config) { ... }  // 唯一入口
```

- **`inject` 不是可选的**。Cordis 的 `ctx` 是 Proxy，没在 `inject` 里声明的服务，访问属性会**直接抛异常**（不是返回 undefined）。用了 `ctx.tools` 就必须写 `export const inject = ['tools']`。
- **注册即 effect**。`ctx.tools.register()` 返回的清理函数会自动挂到插件生命周期，卸载时自动执行。定时器、网络连接这类手动资源必须自己用 `ctx.effect()` 包一层并返回清理函数。
- **`ctx` 是唯一入口**。不要 import 框架内部对象，也不需要写注册表。
- 函数式（上面的写法）覆盖 90% 场景；只有要「给别的插件提供服务」时才用类式（`class X extends Service`）。

## 打包成可安装的 bundle

三个关键文件：

```
package.json      →  声明 dsh.bundle.patch
cordis.patch.yml  →  声明以什么 id 插进配置树
lib/index.js      →  编译产物（main 指向它）
```

`package.json` 里必须有：

```json
{
  "type": "module",
  "main": "./lib/index.js",
  "files": ["lib", "cordis.patch.yml", "README.md"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

**没有 `dsh.bundle` 声明，装成功也只是一个普通 npm 依赖，不会进入 DSH 的组合层。**

## ⚠️ 版本陷阱：dsh-tools 的 latest 是坏的

`@deepseek-ai/dsh-tools` 有两个 dist-tag：

- `latest` = `0.0.1-rc.1`（**stale，装了就是废的**）
- `next` = `0.2.1-rc.2`（真正的线）

直接 `npm i @deepseek-ai/dsh-tools` 会装到那条坏的线上。本项目已显式钉 `0.2.1-rc.2`。

## 代码结构

```
src/
  index.ts             插件入口：name / inject / Config / apply，注册 11 个工具
  config.ts            Schemastery 配置定义
  lib/
    jsonc.ts           JSONC 解析 + 保格式编辑（区间替换，保留注释）
    project.ts         工程模型：项目根 vs 代码根、miniprogramRoot、路径规整、扫描、探针
    appjson.ts         app.json 读写：注册页面 / 分包 / tabBar / 全局组件
    validate.ts        静态校验：pages、tabBar、分包、组件路径、包体积
    templates.ts       页面 / 组件 / 工程骨架模板
    devtools.ts        微信开发者工具 CLI 封装：探测、超时、失败归因
    toolkit.ts         工具公共件：项目解析、原子写、自检渲染
  tools/
    scan.ts             mp_scan
    page-add.ts         mp_page_add
    page-remove.ts      mp_page_remove / mp_entry_set
    register.ts         mp_register / mp_fix
    structure.ts        mp_subpackage_add / mp_component_add
    tabbar.ts           mp_tabbar
    project-init.ts     mp_project_init
    devtools.ts         mp_devtools
test/
  integration.test.ts  21 个端到端测试（真建目录、真跑工具、真解析结果）
```

## 测试

```bash
pnpm test
```

测试会真在临时目录里建工程、调工具、再把写出来的 `app.json` 解析回来断言，覆盖：

- 工具全部注册、参数 schema 能编译
- 建页面并注册、注释保留、幂等、不覆盖手写文件
- `mp_fix` 只补孤儿页、不把组件当页面
- 分包页面登记到分包而非主包、非法 root 被拦
- tabBar 数量限制、组件注入路径可解析
- 删启动页被拦、`miniprogramRoot` 工程里文件落在代码根
- 路径穿越被拒、错误信息可读
- CLI 失败归因优先级

## 常见报错速查

| 报错 | 原因 / 解决 |
|---|---|
| `Cannot get property "tools" without inject` | 忘了 `export const inject = ['tools']` |
| 插件装了但 `--dump-config` 里没有 | `package.json` 缺 `dsh.bundle` 声明 |
| `dsh plugin add` 报 workspace 错误 | 命令后补 `-w` |
| 工具在会话里调不到 | 没重启 `dsh web`，或没开新会话 |
| `找不到 …/app.json` | 传的是项目根但代码在 `miniprogram/` 子目录；插件会读 `miniprogramRoot`，也可直接传代码根 |
| `❌ 预览失败：开发者工具 CLI 没有写权限` | 手动打开一次 IDE 让它完成初始化，或检查 `~/Library/Application Support/微信开发者工具` 权限 |
| `❌ 预览失败：服务端口没开` | IDE → 设置 → 安全设置 → 打开服务端口 |
| 路径含空格导致安装失败 | dsh CLI 转发绝对路径不加引号。把仓库放到无空格路径 |

## 许可

MIT
