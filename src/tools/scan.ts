/**
 * mp_scan —— 小程序工程体检。
 *
 * 这是整个插件的入口工具：模型在动手改任何东西之前先跑它，
 * 拿到「现在有什么问题、下一步该用哪个工具」的完整上下文。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readAppJson } from '../lib/appjson.js'
import { resolveProject, scriptExtensions, textOutput } from '../lib/toolkit.js'
import { formatIssues, scanProject, summarize } from '../lib/validate.js'
import { fmtBytes } from '../lib/project.js'
import type { Config } from '../config.js'

export function registerScan(ctx: any, config: Config): void {
  ctx.tools.register(
    defineTool({
      name: 'mp_scan',
      description:
        'Scan a native WeChat Mini Program project and report: page list (main package + subpackages), missing page files, pages that exist on disk but are NOT declared in app.json (the classic "invisible page" bug), invalid pages/tabBar/subPackages config, broken usingComponents references, and package sizes vs the 2MB/20MB limits. ' +
        'Run this BEFORE writing any page, and AGAIN after generating code to verify. ' +
        'Accepts either the project root (containing project.config.json) or the code root (containing app.json); miniprogramRoot is resolved automatically.',
      parameters: {
        root: { type: 'string', description: 'Project path. Omit to use the configured default projectRoot.' },
        verbose: { type: 'boolean', description: 'Also list every page with its file status, not just problems.' },
      },
      output: textOutput(),
      isConcurrencySafe: () => true,
      async execute(args) {
        const project = await resolveProject(args.root, config)
        const app = await readAppJson(project)
        const report = await scanProject(project, app, scriptExtensions(config))
        const counts = summarize(report.issues)
        const L: string[] = []

        L.push(`项目根   ${project.root}`)
        if (project.miniprogramRoot !== '') L.push(`代码根   ${project.srcRoot}（miniprogramRoot: ${project.miniprogramRoot}）`)
        else L.push(`代码根   ${project.srcRoot}`)
        L.push(`工程类型 ${project.compileType}${project.appId !== '' ? ` · AppID ${project.appId}` : ' · 未填 AppID'}`)
        L.push('')

        const main = report.pages.main
        const subs = report.pages.subs
        L.push(`主包页面 ${main.length} 个${main.length > 0 ? `：${main.join('、')}` : ''}`)
        for (const sub of subs) {
          const full = sub.pages.map((page) => `${sub.root}/${page}`)
          L.push(`分包 ${sub.root || '(空)'} ${sub.pages.length} 个${full.length > 0 ? `：${full.join('、')}` : ''}${sub.independent ? ' · 独立分包' : ''}`)
        }

        if (report.orphans.length > 0) {
          L.push('')
          L.push(`⚠️ 磁盘上存在但未在 app.json 注册的页面 ${report.orphans.length} 个：`)
          L.push(...report.orphans.map((page) => `   ${page}`))
          L.push('   这些页面在微信开发者工具里打不开 → mp_register 补注册，或 mp_fix 一键修复')
        }

        const broken = report.probes.filter((probe) => !probe.complete)
        const partial = report.probes.filter((probe) => probe.complete && probe.optionalMissing.length > 0)
        if (broken.length === 0 && partial.length === 0 && report.pages.all.length > 0) {
          L.push('')
          L.push(`✅ ${report.probes.length} 个已声明页面的必需文件（脚本 + wxml）齐全`)
        }
        if (partial.length > 0) {
          L.push('')
          L.push(`ℹ️ 缺可选文件（不影响运行）：${partial.map((probe) => `${probe.page}(缺 ${probe.optionalMissing.join('/')})`).join('、')}`)
        }

        L.push('')
        L.push(`包体积：主包 ${fmtBytes(report.sizes[0]?.bytes ?? 0)} / 合计 ${fmtBytes(report.totalBytes)}（限制：主包、单个分包 ≤ 2MB，总计 ≤ 20MB）`)
        for (const size of report.sizes.slice(1)) {
          L.push(`        ${size.name} ${fmtBytes(size.bytes)}`)
        }

        L.push('')
        if (report.issues.length === 0) {
          L.push('✅ 配置检查通过：pages / tabBar / 分包 / usingComponents / 文件齐全性 均未发现问题')
        } else {
          L.push(`检查结果：${counts.errors} 个错误、${counts.warnings} 个警告${counts.infos > 0 ? `、${counts.infos} 条提示` : ''}`)
          L.push(...formatIssues(report.issues, { limit: args.verbose === true ? 200 : 40 }))
        }

        if (args.verbose === true && report.pages.all.length > 0) {
          L.push('')
          L.push('页面明细：')
          for (const probe of report.probes) {
            const mark = probe.complete ? '✅' : '❌'
            L.push(`  ${mark} ${probe.page}  (${probe.files.length} 个文件${probe.missing.length > 0 ? `，缺 ${probe.missing.join('、')}` : ''})`)
          }
        }

        L.push('')
        L.push('下一步：')
        if (report.orphans.length > 0) L.push('  · 补注册孤儿页：mp_fix（全自动）或 mp_register（指定页面）')
        if (broken.length > 0) L.push('  · 补缺失文件：mp_page_add 会创建文件并注册；只想补注册用 mp_register')
        if (counts.errors > 0) L.push('  · 按上面每条 ❌ 的「→」修复后再跑一次 mp_scan')
        L.push('  · 想在开发者工具里看效果：mp_devtools（action=preview，输出二维码图片路径）')
        L.push(`  · 项目根为 ${project.root}`)
        return L.join('\n')
      },
    }),
  )
}
