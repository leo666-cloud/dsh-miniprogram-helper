/**
 * mp_page_remove —— 从 app.json 注销页面，可选连文件一起删。
 *
 * 删除页面是个「容易删一半」的操作：文件删了但 app.json 还留着会直接编译失败。
 * 这里把两次改动按「先改配置、再删文件」的顺序做，并且默认只注销不删文件。
 *
 * mp_entry_set —— 改启动页。
 */
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readAppJson } from '../lib/appjson.js'
import { collectPages, isDir, isFile, normalizePagePath } from '../lib/project.js'
import { mutateApp, resolveProject, textOutput } from '../lib/toolkit.js'
import type { Config } from '../config.js'

export function registerPageRemove(ctx: any, config: Config): void {
  ctx.tools.register(
    defineTool({
      name: 'mp_page_remove',
      description:
        'Unregister a page from app.json (main package or subpackage). Optionally delete its page files too. ' +
        'Refuses to remove the launch page, tabBar pages, and the last remaining page, because those break the project immediately. ' +
        'Deleting files only happens after app.json was written successfully, so a failure cannot leave a half-deleted page.',
      parameters: {
        root: { type: 'string', description: 'Project path. Omit to use the configured default.' },
        pagePath: { type: 'string', required: true, description: 'Page path relative to the code root, e.g. "pages/order/index".' },
        deleteFiles: { type: 'boolean', description: 'Also delete <page>.{wxml,wxss,js,ts,json}. Default false.' },
      },
      output: textOutput(),
      async execute(args) {
        const project = await resolveProject(args.root, config)
        const pagePath = normalizePagePath(args.pagePath)
        const app = await readAppJson(project)
        const declared = collectPages(app.json)
        if (!declared.all.includes(pagePath)) {
          return `ℹ️ ${pagePath} 不在 app.json 里，无需注销${args.deleteFiles === true ? '；如需清理文件，请手动删除或先确认路径' : ''}`
        }
        const blockers: string[] = []
        const entry = declared.main[0]
        if (entry === pagePath) blockers.push('它是启动页（app.json pages 的第一项）')
        for (const item of app.tabBarList()) {
          if (item.pagePath === pagePath) blockers.push('它在 tabBar.list 里')
        }
        if (declared.all.length <= 1) blockers.push('这是工程里仅剩的页面')
        if (blockers.length > 0) {
          return [`❌ 不能注销 ${pagePath}：`, ...blockers.map((reason) => `   · ${reason}`)].join('\n') + '\n   → 先换掉启动页 / 从 tabBar 移除 / 新建替代页面，再删除'
        }

        const result = await mutateApp(project, (mutable) => {
          mutable.unregisterPage(pagePath)
          // tabBar 里若残留该页面，一并清理，避免留下必然报错的配置
          const list = mutable.tabBarList()
          if (list.some((item) => item.pagePath === pagePath)) {
            mutable.setTabBar(
              list
                .filter((item) => item.pagePath !== pagePath)
                .map((item) => ({
                  pagePath: String(item.pagePath ?? ''),
                  text: String(item.text ?? ''),
                  iconPath: typeof item.iconPath === 'string' ? item.iconPath : undefined,
                  selectedIconPath: typeof item.selectedIconPath === 'string' ? item.selectedIconPath : undefined,
                })),
            )
          }
        })

        const after = collectPages(result.app.json)
        const removed = !after.all.includes(pagePath)

        const L: string[] = []
        L.push(removed ? `✅ 已从 app.json 注销 ${pagePath}` : `❌ 注销失败：${pagePath} 仍在 app.json 中`)
        if (removed) {
          const files = [`${pagePath}.wxml`, `${pagePath}.wxss`, `${pagePath}.js`, `${pagePath}.ts`, `${pagePath}.json`]
          const present: string[] = []
          for (const rel of files) {
            if (await isFile(path.join(project.srcRoot, rel))) present.push(rel)
          }
          if (args.deleteFiles === true) {
            for (const rel of present) await rm(path.join(project.srcRoot, rel), { force: true })
            const dir = path.dirname(path.join(project.srcRoot, pagePath))
            if ((await isDir(dir)) && dir !== project.srcRoot) {
              const { readdir } = await import('node:fs/promises')
              const rest = await readdir(dir)
              if (rest.length === 0) await rm(dir, { recursive: true, force: true })
            }
            L.push(`   已删除文件：${present.join('、') || '（无）'}`)
          } else if (present.length > 0) {
            L.push(`   页面文件仍保留在磁盘上：${present.join('、')}`)
            L.push('   想一起删掉就再调用一次并带 deleteFiles=true；保留文件不会影响编译')
          }
        }
        L.push('')
        L.push(`app.json 现有 ${after.main.length} 个主包页面、${after.subs.length} 个分包、共 ${after.all.length} 个页面`)
        return L.join('\n')
      },
    }),
  )
}

export function registerEntrySet(ctx: any, config: Config): void {
  ctx.tools.register(
    defineTool({
      name: 'mp_entry_set',
      description:
        'Change the launch page (the first entry of app.json pages) and keep entryPagePath in sync. ' +
        'The launch page must be registered already and must live in the main package — subpackage pages cannot be launch pages.',
      parameters: {
        root: { type: 'string', description: 'Project path. Omit to use the configured default.' },
        pagePath: { type: 'string', required: true, description: 'Page path to launch, e.g. "pages/home/index".' },
      },
      output: textOutput(),
      async execute(args) {
        const project = await resolveProject(args.root, config)
        const pagePath = normalizePagePath(args.pagePath)
        const before = await readAppJson(project)
        const declared = collectPages(before.json)
        if (!declared.main.includes(pagePath)) {
          if (declared.all.includes(pagePath)) {
            return `❌ ${pagePath} 属于分包，不能作为启动页。启动页必须在主包 pages 里。`
          }
          return `❌ ${pagePath} 还没在 app.json 的主包 pages 里声明。先用 mp_page_add 或 mp_register 注册它。`
        }
        if (declared.main[0] === pagePath) return `ℹ️ ${pagePath} 已经是启动页，无需修改`
        const result = await mutateApp(project, (app) => app.setEntryPage(pagePath))
        const after = collectPages(result.app.json)
        return [
          `✅ 启动页已改为 ${pagePath}`,
          `   app.json pages 首项：${after.main[0]}，并已写入 entryPagePath`,
          `   现有 ${after.main.length} 个主包页面、共 ${after.all.length} 个页面`,
        ].join('\n')
      },
    }),
  )
}
