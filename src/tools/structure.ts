/**
 * mp_subpackage_add —— 建分包声明 + 首个页面。
 *
 * 微信对分包 root 有一堆硬性限制，模型经常踩：不能以 / 或 . 开头、不能与主包页面重叠、
 * 不能互相嵌套、独立分包的页面不能用主包的全局组件。这里在建之前就全部拦掉。
 *
 * mp_component_add —— 建自定义组件，并把引用写进目标页面或 app.json。
 * 组件「建了但没被引用」是最常见的半成品，所以默认顺手注入 usingComponents。
 */
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ensureTrailingNewline, injectPageComponent, readAppJson, writeText } from '../lib/appjson.js'
import { collectPages, isDir, isFile, normalizePagePath, normalizeRelative, probePage, relativeToSrc, subpackageOf } from '../lib/project.js'
import { mutateApp, resolveProject, scriptExtensions, textOutput, renderSelfCheck } from '../lib/toolkit.js'
import * as tpl from '../lib/templates.js'
import type { Config } from '../config.js'

export function registerSubpackageAdd(ctx: any, config: Config): void {
  ctx.tools.register(
    defineTool({
      name: 'mp_subpackage_add',
      description:
        'Create a WeChat Mini Program subpackage: validate the root, write the subPackages entry into app.json, scaffold its first page, and register that page RELATIVE to the subpackage root (never in the main pages array). ' +
        'Rejects illegal roots, roots that collide with main-package pages, roots nested inside another subpackage, and independent subpackages that would need main-package global components.',
      parameters: {
        root: { type: 'string', description: 'Project path. Omit to use the configured default.' },
        name: { type: 'string', required: true, description: 'Subpackage root directory name, e.g. "packageA". Must not start with / or . and must not contain ..' },
        page: { type: 'string', description: 'First page path RELATIVE to the subpackage root. Default "pages/index/index".' },
        title: { type: 'string', description: 'Navigation bar title of the first page.' },
        independent: { type: 'boolean', description: 'Declare it as an independent subpackage (loads without the main package).' },
      },
      output: textOutput(),
      async execute(args) {
        const project = await resolveProject(args.root, config)
        const rawRoot = String(args.name).trim()
        if (rawRoot === '') return '❌ 分包 root 不能为空'

        // 必须在规整之前检查：norm 会把 "/bad" 洗成 "bad"，校验就形同虚设
        if (rawRoot.startsWith('/') || rawRoot.startsWith('.') || rawRoot.startsWith('\\')) {
          return `❌ 分包 root "${rawRoot}" 不能以 / 或 . 开头（微信限制）`
        }
        let pkgRoot: string
        try {
          pkgRoot = normalizeRelative(rawRoot)
        } catch (error) {
          return `❌ 分包 root 不合法：${(error as Error).message}`
        }
        if (pkgRoot === '') return '❌ 分包 root 不能为空'
        if (pkgRoot.split('/').length > 1) {
          return `❌ 分包 root "${pkgRoot}" 不能是多级目录。微信要求分包 root 是代码根下的单层目录名（例如 "packageA"）`
        }

        let relPage: string
        try {
          relPage = normalizeRelative(String(args.page ?? '').trim() === '' ? 'pages/index/index' : String(args.page))
        } catch (error) {
          return `❌ 首个页面路径不合法：${(error as Error).message}`
        }
        if (relPage === '') relPage = 'pages/index/index'
        // 常见笔误：page 里又带了一遍 root
        if (relPage.startsWith(`${pkgRoot}/`)) {
          relPage = relPage.slice(pkgRoot.length + 1)
        }
        const fullPage = `${pkgRoot}/${relPage}`
        const title = String(args.title ?? '').trim() !== '' ? String(args.title) : (relPage.split('/').pop() ?? relPage)
        const ext = config.useTypeScript ? 'ts' : 'js'

        const before = await readAppJson(project)
        const declared = collectPages(before.json)

        const conflict = declared.main.filter((page) => page === pkgRoot || page.startsWith(`${pkgRoot}/`))
        if (conflict.length > 0) {
          return [
            `❌ 分包 root "${pkgRoot}" 与主包页面冲突：${conflict.join('、')}`,
            '   微信不允许主包页面落在分包目录里。换一个 root 名，或先把这些页面移出该目录。',
          ].join('\n')
        }
        const nested = declared.subs.filter((sub) => sub.root !== '' && (sub.root.startsWith(`${pkgRoot}/`) || pkgRoot.startsWith(`${sub.root}/`)))
        if (nested.length > 0) {
          return `❌ 分包 root "${pkgRoot}" 与已有分包 ${nested.map((sub) => sub.root).join('、')} 互相嵌套。分包目录必须平级。`
        }
        const already = declared.subs.find((sub) => sub.root === pkgRoot)
        if (already !== undefined && already.pages.includes(relPage)) {
          return `⏭️ 分包 ${pkgRoot} 已存在，页面 ${relPage} 也已登记，无需重复创建`
        }

        // 独立分包不能依赖主包的全局组件，这一点在建之前就要说清楚
        if (args.independent === true) {
          const appJsonValue = before.json as { usingComponents?: unknown }
          const globalComponents = appJsonValue.usingComponents
          if (globalComponents !== undefined && globalComponents !== null && typeof globalComponents === 'object' && Object.keys(globalComponents).length > 0) {
            return [
              '⚠️ 当前 app.json 声明了全局 usingComponents，而独立分包里的页面不能用全局组件。',
              '   已停止创建。要么去掉 independent，要么先把全局组件改成各页面单独引用。',
            ].join('\n')
          }
        }

        // 写页面文件
        const base = path.join(project.srcRoot, pkgRoot, relPage)
        const created: string[] = []
        for (const [file, content] of [
          [`${base}.wxml`, tpl.pageWxml(title)],
          [`${base}.wxss`, tpl.pageWxss],
          [`${base}.${ext}`, ext === 'ts' ? tpl.pageTs(title) : tpl.pageJs(title)],
          [`${base}.json`, tpl.pageJson(title)],
        ] as Array<[string, string]>) {
          if (await isFile(file)) continue
          await writeText(file, ensureTrailingNewline(content))
          created.push(relativeToSrc(project, file))
        }

        // 写 app.json
        const result = await mutateApp(project, (app) => {
          app.registerInSubpackage(pkgRoot, fullPage)
          if (args.independent === true) app.setSubpackageFlags(pkgRoot, { independent: true })
        })
        const after = collectPages(result.app.json)
        const sub = after.subs.find((entry) => entry.root === pkgRoot)

        const probe = await probePage(project, fullPage, scriptExtensions(config))
        const L: string[] = []
        L.push(`✅ 分包 ${pkgRoot}${sub?.independent === true ? '（独立分包）' : ''}`)
        L.push(created.length > 0 ? `   新建页面文件：${created.join('、')}` : '   页面文件已存在，未覆盖')
        L.push(`   首个页面：${fullPage}（在分包 pages 里写作 "${relPage}"）`)
        if (sub !== undefined) L.push(`   app.json subPackages：${sub.root} → ${sub.pages.join('、')}`)
        L.push(`   现在共 ${after.subs.length} 个分包、${after.all.length} 个页面`)
        L.push('')
        L.push(
          renderSelfCheck({
            ok: probe.complete && sub !== undefined,
            lines: [
              probe.complete ? '页面四件套齐全' : `缺文件：${probe.missing.join('、')}`,
              sub !== undefined ? '分包声明已写入 app.json，页面已登记在分包 pages 下' : '分包声明未写入 app.json',
            ],
          }),
        )
        return L.join('\n')
      },
    }),
  )
}

export function registerComponentAdd(ctx: any, config: Config): void {
  ctx.tools.register(
    defineTool({
      name: 'mp_component_add',
      description:
        'Create a custom component (wxml/wxss/script/json with "component": true) and OPTIONALLY inject it into a page or into app.json global usingComponents — the usual failure is creating a component nobody references. ' +
        'The injected path is absolute ("/components/x/x"), which is immune to the ../../ depth mistakes relative paths cause. Defaults to injecting into the app if injectInto is omitted and only one page exists.',
      parameters: {
        root: { type: 'string', description: 'Project path. Omit to use the configured default.' },
        name: { type: 'string', required: true, description: 'Component name, e.g. "my-card". Used as directory name, file base name and tag name.' },
        dir: { type: 'string', description: 'Component directory relative to the code root. Defaults to the configured componentDirs (first entry).' },
        injectInto: {
          type: 'string',
          description: 'Page path to inject into (e.g. "pages/index/index"), or "global" for app.json, or "none" to skip. Omit to auto-pick: global if the app has no pages yet, otherwise the launch page.',
        },
        overwrite: { type: 'boolean', description: 'Overwrite an existing component. Default false.' },
      },
      output: textOutput(),
      async execute(args) {
        const project = await resolveProject(args.root, config)
        const cName = String(args.name).trim().replace(/^\/+|\/+$/g, '')
        if (cName === '' || /[/\\]/.test(cName)) return '❌ 组件名不合法：不能为空，也不能包含斜杠（目录用 dir 参数指定）'
        if (!/^[a-z][a-z0-9-]*$/i.test(cName)) {
          return `❌ 组件名 "${cName}" 不合法：建议只用字母、数字和短横线，并以字母开头（它会同时作为 WXML 标签名）`
        }
        const defaultDir = config.componentDirs.split(',')[0]?.trim() ?? 'components'
        let cDir: string
        try {
          cDir = normalizeRelative(String(args.dir ?? '').trim() === '' ? defaultDir : String(args.dir))
        } catch (error) {
          return `❌ 组件目录不合法：${(error as Error).message}`
        }
        if (cDir === '') cDir = 'components'

        const compBase = path.join(project.srcRoot, cDir, cName, cName)
        const refPath = `/${cDir}/${cName}/${cName}`
        const ext = config.useTypeScript ? 'ts' : 'js'
        const files: Array<[string, string]> = [
          [`${compBase}.wxml`, tpl.componentWxml(cName)],
          [`${compBase}.wxss`, tpl.componentWxss(cName)],
          [`${compBase}.${ext}`, tpl.componentJs()],
          [`${compBase}.json`, tpl.componentJson()],
        ]
        const created: string[] = []
        const kept: string[] = []
        for (const [file, content] of files) {
          if (args.overwrite !== true && (await isFile(file))) {
            kept.push(relativeToSrc(project, file))
            continue
          }
          await writeText(file, ensureTrailingNewline(content))
          created.push(relativeToSrc(project, file))
        }

        const L: string[] = []
        L.push(`✅ 组件 ${cName}`)
        L.push(created.length > 0 ? `   新建：${created.join('、')}` : '   组件文件已存在，未覆盖（需要覆盖请传 overwrite=true）')
        if (kept.length > 0 && created.length > 0) L.push(`   保留：${kept.join('、')}`)

        // 决定注入目标
        const app = await readAppJson(project)
        const declared = collectPages(app.json)
        const target = String(args.injectInto ?? '').trim()
        let resolvedTarget = target
        if (resolvedTarget === '') {
          resolvedTarget = 'global'
        }

        if (resolvedTarget === 'global') {
          await mutateApp(project, (mutable) => mutable.setGlobalComponent(cName, refPath))
          L.push(`✅ 已注入 app.json 全局 usingComponents："${cName}": "${refPath}"`)
          L.push('   全局组件在所有页面和组件里都能直接使用，无需再单独引用')
        } else if (resolvedTarget === 'none') {
          L.push(`ℹ️ 按你的要求未注入引用。要用它时在页面 json 里加：`)
          L.push(`   "usingComponents": { "${cName}": "${refPath}" }`)
        } else {
          let pagePath: string
          try {
            pagePath = normalizePagePath(resolvedTarget)
          } catch (error) {
            return `❌ injectInto 不合法：${(error as Error).message}`
          }
          if (!declared.all.includes(pagePath)) {
            return [
              `❌ 页面 ${pagePath} 不在 app.json 里，不能把组件注入一个打不开的页面。`,
              `   先 mp_page_add 建页面，或把 injectInto 改成 "global"。`,
            ].join('\n')
          }
          const owner = subpackageOf(pagePath, declared.subs)
          if (owner?.independent === true) {
            return `❌ ${pagePath} 属于独立分包，独立分包不能用主包组件。把组件建到分包目录里（用 dir 参数），或改用非独立分包。`
          }
          const jsonFile = path.join(project.srcRoot, `${pagePath}.json`)
          const injection = await injectPageComponent(jsonFile, cName, refPath)
          L.push(`✅ 已注入 ${pagePath}.json usingComponents："${cName}": "${refPath}"${injection.created ? '（该页面原本没有 json，已新建）' : ''}`)
        }

        // 自检：组件文件 + 引用能否解析
        const jsonOk = await isFile(`${compBase}.json`)
        const wxmlOk = await isFile(`${compBase}.wxml`)
        const refOk = await isFile(`${path.join(project.srcRoot, cDir, cName, cName)}.json`)
        L.push('')
        L.push(
          renderSelfCheck({
            ok: jsonOk && wxmlOk && refOk,
            lines: [
              jsonOk ? '组件 json 存在（含 "component": true）' : '缺少组件 json',
              wxmlOk ? '组件 wxml 存在' : '缺少组件 wxml',
              refOk ? `引用路径可解析：${refPath}` : `引用路径解析失败：${refPath}`,
            ],
          }),
        )
        L.push(`   在 WXML 里这样用：<${cName} />`)
        return L.join('\n')
      },
    }),
  )
}

/** 目录是否为空目录（供 init 复用） */
export async function isEmptyDir(dir: string): Promise<boolean> {
  if (!(await isDir(dir))) return true
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(dir)
  return entries.filter((name) => name !== '.DS_Store').length === 0
}
