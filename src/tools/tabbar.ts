/**
 * mp_tabbar —— 配置底部 tab 栏。
 *
 * tabBar 是最容易「配了但跑不起来」的部分：数量必须 2–5、页面必须在主包、
 * 图标文件必须真实存在、app.json 里还得有对应 pages 声明。
 * 这个工具把「补注册页面 + 校验图标 + 写 tabBar + 写完自检」串成一步。
 */
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readAppJson } from '../lib/appjson.js'
import { collectPages, isFile, normalizePagePath } from '../lib/project.js'
import { mutateApp, resolveProject, textOutput, renderSelfCheck } from '../lib/toolkit.js'
import type { Config } from '../config.js'

interface TabSpec {
  pagePath: string
  text: string
  iconPath?: string
  selectedIconPath?: string
}

/** 解析 "页面:文字" 形式；也接受 "页面:文字:图标" 三段的简写 */
export function parseTabSpecs(input: string): { tabs: TabSpec[]; errors: string[] } {
  const tabs: TabSpec[] = []
  const errors: string[] = []
  const lines = input
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  for (const line of lines) {
    // 页面路径里不含冒号，文字里可能有，所以只按前两个冒号切
    const parts = line.split(/[:：|]/).map((part) => part.trim())
    const pagePath = parts[0] ?? ''
    if (pagePath === '') {
      errors.push(`「${line}」缺少页面路径`)
      continue
    }
    const text = parts[1] ?? ''
    if (text === '') errors.push(`「${line}」缺少按钮文字（写成 页面路径:文字）`)
    tabs.push({
      pagePath,
      text,
      iconPath: parts[2] !== undefined && parts[2] !== '' ? parts[2] : undefined,
      selectedIconPath: parts[3] !== undefined && parts[3] !== '' ? parts[3] : undefined,
    })
  }
  return { tabs, errors }
}

export function registerTabbar(ctx: any, config: Config): void {
  ctx.tools.register(
    defineTool({
      name: 'mp_tabbar',
      description:
        'Configure the bottom tabBar from a compact list, e.g. "pages/home/index:首页,pages/mine/index:我的". ' +
        'Validates the 2–5 item limit, registers tab pages into the MAIN package when missing (tab pages cannot live in a subpackage), checks that icon files exist, writes the tabBar into app.json, and self-verifies. ' +
        'Pass an empty list to remove the tabBar.',
      parameters: {
        root: { type: 'string', description: 'Project path. Omit to use the configured default.' },
        tabs: {
          type: 'string',
          description:
            'Comma/newline separated items "pagePath:text", optionally "pagePath:text:iconPath:selectedIconPath". Pass an empty string to remove the tabBar.',
        },
        color: { type: 'string', description: 'Default text color, e.g. "#8a8a8a".' },
        selectedColor: { type: 'string', description: 'Selected text color, e.g. "#07c160".' },
        backgroundColor: { type: 'string', description: 'Tab bar background, e.g. "#ffffff".' },
        position: { type: 'string', description: '"bottom" (default) or "top" (top only supports text, no icons).' },
      },
      output: textOutput(),
      async execute(args) {
        const project = await resolveProject(args.root, config)
        const raw = String(args.tabs ?? '').trim()
        const app = await readAppJson(project)
        const declared = collectPages(app.json)

        if (raw === '') {
          if (app.tabBarList().length === 0) return 'ℹ️ app.json 里本来就没有 tabBar，无需删除'
          const result = await mutateApp(project, (mutable) => mutable.removeRootKey('tabBar'))
          return result.changed ? '✅ 已移除 app.json 的 tabBar（页面文件保留，仍可通过普通跳转访问）' : 'ℹ️ 没有可以移除的 tabBar'
        }

        const { tabs, errors } = parseTabSpecs(raw)
        if (errors.length > 0 && tabs.length === 0) return `❌ 解析失败：\n   ${errors.join('\n   ')}`
        if (tabs.length < 2 || tabs.length > 5) {
          return [
            `❌ tabBar 需要 2–5 个按钮，现在给了 ${tabs.length} 个。`,
            '   少于 2 个：底部栏没有意义；多于 5 个：微信直接不给配置。',
          ].join('\n')
        }

        // 页面路径规整 + 主包检查
        const normalized: TabSpec[] = []
        const problems: string[] = []
        for (const tab of tabs) {
          let pagePath: string
          try {
            pagePath = normalizePagePath(tab.pagePath)
          } catch (error) {
            problems.push(`「${tab.pagePath}」路径不合法：${(error as Error).message}`)
            continue
          }
          const owner = declared.subs.find((sub) => pagePath === sub.root || pagePath.startsWith(`${sub.root}/`))
          if (owner !== undefined) {
            problems.push(`「${pagePath}」在分包 ${owner.root} 里，tabBar 页面必须在主包`)
            continue
          }
          normalized.push({ ...tab, pagePath })
        }
        const missingPages = normalized.filter((tab) => !declared.main.includes(tab.pagePath)).map((tab) => tab.pagePath)
        const missingFiles: string[] = []
        for (const tab of normalized) {
          for (const [field, value] of [
            ['iconPath', tab.iconPath],
            ['selectedIconPath', tab.selectedIconPath],
          ] as const) {
            if (value === undefined) continue
            if (!(await isFile(path.join(project.srcRoot, value.replace(/^\/+/, ''))))) {
              missingFiles.push(`${tab.pagePath} 的 ${field}: ${value}（文件不存在）`)
            }
          }
          if (args.position === 'top' && (tab.iconPath !== undefined || tab.selectedIconPath !== undefined)) {
            problems.push(`顶部 tabBar 不支持图标：${tab.pagePath} 去掉了 iconPath`)
          }
        }
        if (problems.length > 0) {
          return ['❌ 无法写入 tabBar：', ...problems.map((problem) => `   · ${problem}`)].join('\n')
        }

        // 缺失的主包页面自动补注册（页面文件有没有由自检单独报）
        const result = await mutateApp(project, (mutable) => {
          for (const tab of normalized) {
            const current = collectPages(mutable.json)
            if (!current.main.includes(tab.pagePath)) mutable.registerPage(tab.pagePath, {})
          }
          mutable.setTabBar(
            normalized.map((tab) =>
              args.position === 'top'
                ? { pagePath: tab.pagePath, text: tab.text }
                : {
                    pagePath: tab.pagePath,
                    text: tab.text,
                    ...(tab.iconPath !== undefined ? { iconPath: tab.iconPath } : {}),
                    ...(tab.selectedIconPath !== undefined ? { selectedIconPath: tab.selectedIconPath } : {}),
                  },
            ),
          )
          if (typeof args.color === 'string' && args.color !== '') mutable.setTabBarValue('color', args.color)
          if (typeof args.selectedColor === 'string' && args.selectedColor !== '') mutable.setTabBarValue('selectedColor', args.selectedColor)
          if (typeof args.backgroundColor === 'string' && args.backgroundColor !== '') mutable.setTabBarValue('backgroundColor', args.backgroundColor)
          if (args.position === 'top') mutable.setTabBarValue('position', 'top')
        })

        const after = collectPages(result.app.json)
        const finalList = result.app.tabBarList()
        const L: string[] = [`✅ tabBar 已写入 ${path.basename(result.app.file)}（${finalList.length} 项）`]
        for (const item of finalList) {
          L.push(`   ${String(item.text ?? '')}  →  ${String(item.pagePath ?? '')}`)
        }
        if (missingPages.length > 0) {
          L.push('')
          L.push(`ℹ️ 这些 tab 页面此前没注册，已自动补进主包 pages：${missingPages.join('、')}`)
        }

        const pageFileProblems: string[] = []
        for (const tab of normalized) {
          if (!(await isFile(path.join(project.srcRoot, `${tab.pagePath}.wxml`)))) {
            pageFileProblems.push(`${tab.pagePath}.wxml 不存在`)
          }
        }
        L.push('')
        L.push(
          renderSelfCheck({
            ok: finalList.length >= 2 && finalList.length <= 5 && pageFileProblems.length === 0 && missingFiles.length === 0,
            lines: [
              finalList.length >= 2 && finalList.length <= 5 ? `数量 ${finalList.length} 在 2–5 之间` : `数量 ${finalList.length} 不合法`,
              pageFileProblems.length === 0 ? '所有 tab 页面的 wxml 都存在' : pageFileProblems.join('；'),
              missingFiles.length === 0 ? '图标文件检查通过' : missingFiles.join('；'),
              `主包共 ${after.main.length} 个页面，tab 页都在主包`,
            ],
          }),
        )
        if (pageFileProblems.length > 0) L.push('   → 用 mp_page_add 建出这些页面，否则运行时点 tab 会白屏')
        if (missingFiles.length > 0) L.push('   → 补上 81×81 的 PNG 图标，或去掉 iconPath 用纯文字 tab')
        return L.join('\n')
      },
    }),
  )
}
