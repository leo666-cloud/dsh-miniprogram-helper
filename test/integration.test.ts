/**
 * 端到端测试：用真实的 defineTool / schema 编译，把工具跑在临时工程上。
 *
 * 这里不 mock 文件系统，全部在 /tmp 下真实建目录、跑工具、读结果，
 * 所以「工具注册得了、参数 schema 编译得过、写出来的文件真能再解析」是被验证过的。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply, TOOL_NAMES } from '../lib/index.js'
import { parseJsonc, type JsonValue } from '../lib/lib/jsonc.js'

/** 测试里读 app.json：断言它确实是对象，省得每处都写类型收窄 */
function appObject(raw: string): Record<string, any> {
  const value = parseJsonc(raw).value
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'app.json 顶层不是对象')
  return value as Record<string, any>
}

interface Registered {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>, exec?: unknown) => Promise<unknown>
}

/** 极简的假 ctx：只为收下 ctx.tools.register 的工具定义 */
function makeCtx(): { ctx: any; tools: Map<string, Registered> } {
  const tools = new Map<string, Registered>()
  const ctx = {
    tools: {
      register(definition: Registered) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    logger: { info() {} },
  }
  return { ctx, tools }
}

const CONFIG = {
  projectRoot: '',
  useTypeScript: false,
  componentDirs: 'components',
  appId: '',
  devtoolsCli: '',
  devtoolsPort: '',
  devtoolsTimeoutSec: 90,
  previewDir: '',
}

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mp-test-'))
  await writeFile(
    path.join(root, 'app.json'),
    `{
  // 全局配置：注意这里故意写了注释，验证不会被抹掉
  "pages": [
    "pages/index/index", // 首页
  ],
  "window": {
    "navigationBarTitleText": "测试"
  }
}
`,
    'utf8',
  )
  await writeFile(path.join(root, 'app.js'), 'App({})\n', 'utf8')
  await mkdir(path.join(root, 'pages/index'), { recursive: true })
  await writeFile(path.join(root, 'pages/index/index.wxml'), '<view>hi</view>\n', 'utf8')
  await writeFile(path.join(root, 'pages/index/index.js'), 'Page({})\n', 'utf8')
  return root
}

async function run(root: string) {
  const { ctx, tools } = makeCtx()
  apply(ctx, CONFIG as never)
  return {
    tools,
    async call(name: string, args: Record<string, unknown> = {}): Promise<string> {
      const tool = tools.get(name)
      assert.ok(tool, `工具 ${name} 没有注册`)
      const result = await tool.execute({ root, ...args })
      assert.equal(typeof result, 'string', `${name} 应返回字符串`)
      return result as string
    },
  }
}

test('注册全部工具，且 schema 能编译', () => {
  const { ctx, tools } = makeCtx()
  apply(ctx, CONFIG as never)
  assert.deepEqual([...tools.keys()].sort(), [...TOOL_NAMES].sort())
  for (const [name, tool] of tools) {
    assert.equal(tool.parameters.type, 'object', `${name} 的参数根必须是 object`)
    assert.ok(tool.description.length > 30, `${name} 的描述太短，模型读不懂`)
  }
})

test('mp_page_add 建页面并写进 app.json，且保留注释', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    const out = await t.call('mp_page_add', { pagePath: 'pages/detail/index', title: '详情' })
    assert.match(out, /自检通过/)
    for (const ext of ['wxml', 'wxss', 'js', 'json']) {
      const file = path.join(root, 'pages/detail/index.' + ext)
      assert.ok((await readFile(file, 'utf8')).length > 0, `${ext} 没生成`)
    }
    const raw = await readFile(path.join(root, 'app.json'), 'utf8')
    assert.match(raw, /全局配置/, '注释被抹掉了')
    assert.match(raw, /pages\/detail\/index/)
    assert.deepEqual(appObject(raw).pages, ['pages/index/index', 'pages/detail/index'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_page_add 幂等，且不覆盖已有文件', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    const first = await t.call('mp_page_add', { pagePath: 'pages/order/index' })
    assert.match(first, /自检通过/)
    await writeFile(path.join(root, 'pages/order/index.wxml'), '<view>用户手写的内容</view>\n', 'utf8')
    const second = await t.call('mp_page_add', { pagePath: 'pages/order/index' })
    assert.match(second, /已有文件已保留/)
    assert.equal(await readFile(path.join(root, 'pages/order/index.wxml'), 'utf8'), '<view>用户手写的内容</view>\n')
    const pages = appObject(await readFile(path.join(root, 'app.json'), 'utf8')).pages
    assert.deepEqual(pages, ['pages/index/index', 'pages/order/index'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_fix 只补孤儿页，且不会把组件当页面', async () => {
  const root = await makeProject()
  try {
    // 一个真正的孤儿页
    await mkdir(path.join(root, 'pages/orphan'), { recursive: true })
    await writeFile(path.join(root, 'pages/orphan/orphan.wxml'), '<view/>\n')
    await writeFile(path.join(root, 'pages/orphan/orphan.js'), 'Page({})\n')
    // 一个自定义组件：有 component: true，绝不能被注册成页面
    await mkdir(path.join(root, 'components/my-card'), { recursive: true })
    await writeFile(path.join(root, 'components/my-card/my-card.wxml'), '<view/>\n')
    await writeFile(path.join(root, 'components/my-card/my-card.json'), '{"component": true}\n')

    const t = await run(root)
    const out = await t.call('mp_fix')
    assert.match(out, /已补注册 1 个孤儿页面/)
    const pages = appObject(await readFile(path.join(root, 'app.json'), 'utf8')).pages
    assert.ok(pages.includes('pages/orphan/orphan'))
    assert.ok(!pages.includes('components/my-card/my-card'), '组件被误注册成了页面')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_scan 报出孤儿页与缺失文件', async () => {
  const root = await makeProject()
  try {
    await mkdir(path.join(root, 'pages/broken'), { recursive: true })
    await writeFile(path.join(root, 'pages/broken/broken.wxml'), '<view/>\n')
    await mkdir(path.join(root, 'pages/ghost'), { recursive: true })
    await writeFile(path.join(root, 'pages/ghost/ghost.wxml'), '<view/>\n')
    await writeFile(path.join(root, 'pages/ghost/ghost.js'), 'Page({})\n')
    await writeFile(
      path.join(root, 'app.json'),
      JSON.stringify({ pages: ['pages/index/index', 'pages/broken/broken'], window: {} }, null, 2),
      'utf8',
    )
    const t = await run(root)
    const out = await t.call('mp_scan')
    assert.match(out, /未在 app\.json 注册的页面/)
    assert.match(out, /pages\/ghost\/ghost/)
    assert.match(out, /缺脚本文件|缺少必需文件|缺:/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_subpackage_add 把页面登记到分包，而不是主包', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    const out = await t.call('mp_subpackage_add', { name: 'packageA' })
    assert.match(out, /分包 packageA/)
    const json = appObject(await readFile(path.join(root, 'app.json'), 'utf8'))
    assert.deepEqual(json.pages, ['pages/index/index'], '分包页面被错误地写进了主包 pages')
    assert.equal(json.subPackages[0].root, 'packageA')
    assert.deepEqual(json.subPackages[0].pages, ['pages/index/index'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_subpackage_add 拦掉非法 root', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    assert.match(await t.call('mp_subpackage_add', { name: '/bad' }), /不能以 \/ 或 \. 开头/)
    assert.match(await t.call('mp_subpackage_add', { name: '../escape' }), /不能以 \/ 或 \. 开头|不能包含/)
    const json = appObject(await readFile(path.join(root, 'app.json'), 'utf8'))
    assert.equal(json.subPackages, undefined, '非法 root 不应写入 app.json')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_component_add 注入 usingComponents 且路径可解析', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    const out = await t.call('mp_component_add', { name: 'my-card', injectInto: 'pages/index/index' })
    assert.match(out, /自检通过/)
    const pageJson = JSON.parse(await readFile(path.join(root, 'pages/index/index.json'), 'utf8'))
    assert.equal(pageJson.usingComponents['my-card'], '/components/my-card/my-card')
    const compJson = JSON.parse(await readFile(path.join(root, 'components/my-card/my-card.json'), 'utf8'))
    assert.equal(compJson.component, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_tabbar 写 tabBar 并自动补注册主包页面', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    await t.call('mp_page_add', { pagePath: 'pages/mine/index', title: '我的' })
    const out = await t.call('mp_tabbar', { tabs: 'pages/index/index:首页,pages/mine/index:我的' })
    assert.match(out, /tabBar 已写入/)
    const json = appObject(await readFile(path.join(root, 'app.json'), 'utf8'))
    assert.equal(json.tabBar.list.length, 2)
    assert.equal(json.tabBar.list[0].pagePath, 'pages/index/index')
    assert.deepEqual(json.pages, ['pages/index/index', 'pages/mine/index'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_tabbar 拒绝 1 项与 6 项', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    assert.match(await t.call('mp_tabbar', { tabs: 'pages/index/index:首页' }), /需要 2–5 个/)
    const six = Array.from({ length: 6 }, (_, i) => `pages/p${i}/index:页${i}`).join(',')
    assert.match(await t.call('mp_tabbar', { tabs: six }), /需要 2–5 个/)
    const json = appObject(await readFile(path.join(root, 'app.json'), 'utf8'))
    assert.equal(json.tabBar, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_entry_set 换启动页', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    await t.call('mp_page_add', { pagePath: 'pages/home/index' })
    const out = await t.call('mp_entry_set', { pagePath: 'pages/home/index' })
    assert.match(out, /启动页已改为/)
    const json = appObject(await readFile(path.join(root, 'app.json'), 'utf8'))
    assert.equal(json.pages[0], 'pages/home/index')
    assert.equal(json.entryPagePath, 'pages/home/index')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_page_remove 不许删启动页', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    const out = await t.call('mp_page_remove', { pagePath: 'pages/index/index' })
    assert.match(out, /不能注销/)
    assert.match(out, /启动页/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_page_remove 注销后可选择删文件', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    await t.call('mp_page_add', { pagePath: 'pages/temp/index' })
    const out = await t.call('mp_page_remove', { pagePath: 'pages/temp/index', deleteFiles: true })
    assert.match(out, /已从 app\.json 注销/)
    const rest = await readdir(path.join(root, 'pages'))
    assert.ok(!rest.includes('temp'), '页面目录没被清掉')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mp_project_init 生成可被开发者工具打开的工程，且不覆盖已有工程', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'mp-init-'))
  try {
    const t = await run(base)
    const out = await t.call('mp_project_init', { root: path.join(base, 'demo'), name: 'demo', appId: 'wx123', firstPage: 'pages/index/index', title: '首页' })
    assert.match(out, /已生成小程序工程/)
    assert.match(out, /自检通过/)
    for (const file of ['project.config.json', 'miniprogram/app.json', 'miniprogram/app.js', 'miniprogram/app.wxss', 'miniprogram/sitemap.json', 'miniprogram/pages/index/index.wxml', 'README.md']) {
      assert.ok((await readFile(path.join(base, 'demo', file), 'utf8')).length > 0, `缺少 ${file}`)
    }
    const project = JSON.parse(await readFile(path.join(base, 'demo', 'project.config.json'), 'utf8'))
    assert.equal(project.miniprogramRoot, 'miniprogram')
    assert.equal(project.appid, 'wx123')

    // 再来一次应当被拒绝
    const again = await t.call('mp_project_init', { root: path.join(base, 'demo') })
    assert.match(again, /已经有 app\.json/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('miniprogramRoot 工程里所有工具都落在代码根', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'mp-src-'))
  try {
    await mkdir(path.join(base, 'miniprogram/pages/index'), { recursive: true })
    await writeFile(path.join(base, 'project.config.json'), JSON.stringify({ miniprogramRoot: 'miniprogram/', appid: 'wx1' }))
    await writeFile(path.join(base, 'miniprogram/app.json'), JSON.stringify({ pages: ['pages/index/index'] }))
    await writeFile(path.join(base, 'miniprogram/pages/index/index.wxml'), '<view/>\n')
    await writeFile(path.join(base, 'miniprogram/pages/index/index.js'), 'Page({})\n')
    const t = await run(base)
    const out = await t.call('mp_page_add', { pagePath: 'pages/other/index' })
    assert.match(out, /自检通过/)
    assert.ok(await readFile(path.join(base, 'miniprogram/pages/other/index.wxml'), 'utf8').then(() => true).catch(() => false))
    // 绝不能落到项目根
    const rootPages = await readdir(path.join(base, 'pages')).catch(() => [] as string[])
    assert.deepEqual(rootPages, [], '文件被写到了项目根而不是代码根')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('mp_devtools detect 能跑通（没装 IDE 也要给出可用信息）', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    const out = await t.call('mp_devtools', { action: 'detect' })
    assert.match(out, /开发者工具 CLU|开发者工具 CLI/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('路径穿越被拒绝', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    const out = await t.call('mp_page_add', { pagePath: '../../escape/index' })
    assert.match(out, /不能包含|不合法/)
    const outside = await readFile(path.join(path.dirname(root), 'escape/index.wxml'), 'utf8').catch(() => undefined)
    assert.equal(outside, undefined, '文件逃出了项目目录')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CLI 失败归因：EPERM 优先于笼统的「IDE 未正确安装」', async () => {
  const { classifyCliFailure, explainReason } = await import('../lib/lib/devtools.js')
  const result = (stdout: string, stderr = '') => ({ ok: false, code: 1, stdout, stderr, timedOut: false, command: 'cli' })
  assert.equal(classifyCliFailure(result('', "✖ 初始化错误: Error: EPERM: operation not permitted, open '/x/.cli'")), 'permission')
  assert.equal(classifyCliFailure(result('[error] 请确保 IDE 已正确安装')), 'ide-init')
  assert.equal(classifyCliFailure(result('not logged in')), 'not-logged-in')
  assert.equal(classifyCliFailure(result('ECONNREFUSED 127.0.0.1:9420')), 'port-closed')
  assert.equal(classifyCliFailure({ ...result(''), timedOut: true }), 'timeout')
  assert.match(explainReason('permission'), /权限|EPERM/)
})

test('前导 / 的页面路径按微信惯例归一化到代码根内', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    const out = await t.call('mp_page_add', { pagePath: '/pages/leading/index' })
    assert.match(out, /自检通过/)
    // 绝不能因为带 / 就写到项目根之外
    const pages = appObject(await readFile(path.join(root, 'app.json'), 'utf8')).pages
    assert.ok(pages.includes('pages/leading/index'), '归一化后的路径没写进 app.json')
    assert.ok(!pages.some((page: string) => page.startsWith('/')), 'app.json 里不应出现带前导 / 的路径')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('工具抛出的可读中文错误会变成 ❌ 提示而不是异常', async () => {
  const root = await makeProject()
  try {
    const t = await run(root)
    const out = await t.call('mp_page_add', { pagePath: 'pages/detail/index.min' })
    assert.match(out, /^❌/)
    assert.match(out, /不能带扩展名/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('工程路径不存在时给出可读错误', async () => {
  const { ctx, tools } = makeCtx()
  apply(ctx, CONFIG as never)
  const out = (await tools.get('mp_scan')!.execute({ root: '/tmp/definitely-not-a-project-xyz' })) as string
  assert.match(out, /^❌/)
  assert.match(out, /路径不存在/)
})
