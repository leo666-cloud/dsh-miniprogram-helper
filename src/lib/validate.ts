/**
 * 工程静态校验。只做「不跑代码就能判定」的检查，运行时 / 真机行为不在范围内。
 *
 * 每条问题都带上「为什么」和「怎么修」，因为模型最需要的不是报错本身，
 * 而是知道下一步该动哪个文件。
 */
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { getProp, readJsonFile, type AppJson } from './appjson.js'
import { parseJsonc } from './jsonc.js'
import {
  collectPages,
  dirSize,
  fmtBytes,
  isDir,
  isFile,
  normalizePagePath,
  probePage,
  relativeToSrc,
  resolveComponentPath,
  scanPages,
  type PageProbe,
  type Project,
  type Subpackage,
} from './project.js'

export type IssueLevel = 'error' | 'warn' | 'info'

export interface Issue {
  level: IssueLevel
  code: string
  msg: string
  /** 修复建议 */
  fix?: string
}

export interface PackageSize {
  name: string
  bytes: number
  limit: number
}

export interface ScanReport {
  project: Project
  pages: ReturnType<typeof collectPages>
  probes: PageProbe[]
  orphans: string[]
  issues: Issue[]
  sizes: PackageSize[]
  totalBytes: number
  tabBar?: { count: number; custom: boolean }
}

const MAIN_LIMIT = 2 * 1024 * 1024
const SUB_LIMIT = 2 * 1024 * 1024
const TOTAL_LIMIT = 20 * 1024 * 1024

/** 分包根目录的命名限制：不能以 / 或 . 开头，不能是根目录本身 */
function checkSubpackageRoot(sub: Subpackage): Issue[] {
  const issues: Issue[] = []
  if (sub.root === '') {
    issues.push({
      level: 'error',
      code: 'sub.remote-empty-root',
      msg: `subPackages[${sub.index}] 没有 root`,
      fix: '每个分包都必须写 root（相对代码根的目录名，例如 "packageA"）',
    })
    return issues
  }
  if (/^[/.]/.test(sub.root)) {
    issues.push({
      level: 'error',
      code: 'sub.root-illegal',
      msg: `分包 root "${sub.root}" 不能以 / 或 . 开头`,
      fix: '改成不以 / 或 . 开头的普通目录名',
    })
  }
  if (sub.root.includes('..')) {
    issues.push({ level: 'error', code: 'sub.root-escape', msg: `分包 root "${sub.root}" 不允许包含 ..` })
  }
  if (sub.root === 'pages') {
    issues.push({
      level: 'warn',
      code: 'sub.root-pages',
      msg: `分包 root 用了 "pages"，这是主包最常用的目录名，容易与主包页面混淆`,
      fix: '改用 packageA 这类专用目录名',
    })
  }
  return issues
}

/**
 * 收集全部问题。这个函数是 mp_scan 的核心，也被所有写操作复用做「写完自检」。
 */
export async function scanProject(project: Project, app: AppJson, scriptExtensions: string[]): Promise<ScanReport> {
  const issues: Issue[] = []
  const json = app.json
  const doc = parseJsonc(app.text)
  const pages = collectPages(json)
  const srcRoot = project.srcRoot

  // ── 1. pages 字段本身 ──
  if (doc.root.type !== 'object') {
    issues.push({ level: 'error', code: 'app.not-object', msg: 'app.json 顶层不是对象' })
  }
  const pagesProp = getProp(doc.root, 'pages')
  if (pagesProp === undefined) {
    issues.push({ level: 'error', code: 'app.no-pages', msg: 'app.json 缺少 pages 字段', fix: '至少要声明一个页面，第一个即为启动页' })
  } else if (pagesProp.value.type !== 'array') {
    issues.push({ level: 'error', code: 'app.pages-type', msg: 'app.json 的 pages 不是数组' })
  } else if (pages.main.length === 0) {
    issues.push({ level: 'error', code: 'app.pages-empty', msg: 'app.json 的 pages 是空数组，小程序无法启动' })
  }

  // ── 2. 页面路径写法 ──
  for (const page of pages.main) {
    const problem = pagePathProblem(page)
    if (problem !== undefined) {
      issues.push({
        level: 'error',
        code: 'page.path-format',
        msg: `pages 里的 "${page}" 写法不合法：${problem}`,
        fix: '页面路径应形如 "pages/home/index"：不带前导 /、不带扩展名、最后一段是文件名',
      })
    }
  }

  // ── 3. 主包与分包重复、分包之间冲突 ──
  const seen = new Map<string, string>()
  for (const page of pages.main) seen.set(page, '主包')
  for (const sub of pages.subs) {
    for (const rel of sub.pages) {
      const full = sub.root === '' ? rel : `${sub.root}/${rel}`
      const owner = seen.get(full)
      if (owner !== undefined) {
        issues.push({
          level: 'error',
          code: 'page.duplicate',
          msg: `页面 "${full}" 同时出现在 ${owner} 与分包 ${sub.root}`,
          fix: '同一个页面只能属于一个包',
        })
      } else {
        seen.set(full, `分包 ${sub.root}`)
      }
    }
  }

  // ── 4. 分包规则 ──
  const roots = new Set<string>()
  for (const sub of pages.subs) {
    issues.push(...checkSubpackageRoot(sub))
    if (sub.root !== '') {
      if (roots.has(sub.root)) {
        issues.push({ level: 'error', code: 'sub.root-duplicate', msg: `分包 root "${sub.root}" 重复声明` })
      }
      roots.add(sub.root)
      if (!(await isDir(path.join(srcRoot, sub.root)))) {
        issues.push({
          level: 'warn',
          code: 'sub.dir-missing',
          msg: `分包目录不存在：${sub.root}`,
          fix: '用 mp_subpackage_add 建目录与首个页面，或删掉这条分包声明',
        })
      }
      const conflict = pages.main.filter((page) => page === sub.root || page.startsWith(`${sub.root}/`))
      if (conflict.length > 0) {
        issues.push({
          level: 'error',
          code: 'sub.main-conflict',
          msg: `主包页面落在分包目录里：${conflict.join('、')}`,
          fix: '主包页面必须移到分包 root 之外，或把这些页面登记到分包里',
        })
      }
    }
    for (const rel of sub.pages) {
      const problem = pagePathProblem(rel)
      if (problem !== undefined) {
        issues.push({ level: 'error', code: 'page.path-format', msg: `分包 ${sub.root} 的页面 "${rel}" 写法不合法：${problem}` })
      }
      if (rel.startsWith(`${sub.root}/`) && sub.root !== '') {
        issues.push({
          level: 'warn',
          code: 'sub.page-has-root',
          msg: `分包 ${sub.root} 的页面 "${rel}" 又带了一遍 root`,
          fix: `分包 pages 里的路径相对分包根，应写成 "${rel.slice(sub.root.length + 1)}"`,
        })
      }
    }
  }
  // 分包互相嵌套：外层 root 覆盖内层会导致页面归属混乱
  const rootList = [...roots]
  for (const a of rootList) {
    for (const b of rootList) {
      if (a !== b && b.startsWith(`${a}/`)) {
        issues.push({
          level: 'error',
          code: 'sub.root-nested',
          msg: `分包 root "${b}" 嵌套在 "${a}" 里`,
          fix: '分包目录必须平级，不能互相包含',
        })
      }
    }
  }

  // ── 5. 声明页面文件是否齐全 ──
  const uniquePages = [...new Set(pages.all)]
  const probes = await Promise.all(uniquePages.map((page) => probePage(project, page, scriptExtensions)))
  for (const probe of probes) {
    if (!probe.complete) {
      const guess = await guessActualPage(project, probe.page, scriptExtensions)
      issues.push({
        level: 'error',
        code: 'page.files-missing',
        msg: `页面 "${probe.page}" 缺少必需文件：${probe.missing.join('、')}`,
        fix:
          guess !== undefined
            ? `磁盘上实际存在 "${guess}"，把 app.json 里的路径改成它（注意最后一段是文件名基名）`
            : `用 mp_page_add 创建 "${probe.page}"，或把这个页面从 app.json 里删掉`,
      })
    }
  }

  // ── 6. 孤儿页面：磁盘上有、app.json 里没有 ──
  const diskPages = await scanPages(project, { componentDirs: [] })
  const declaredSet = new Set(pages.all)
  const orphans = diskPages.filter((page) => !declaredSet.has(page))
  for (const orphan of orphans) {
    issues.push({
      level: 'warn',
      code: 'page.orphan',
      msg: `页面 "${orphan}" 在磁盘上存在但没写进 app.json`,
      fix: '在微信开发者工具里打不开 → 用 mp_register 补注册，或 mp_fix 一键修复',
    })
  }

  // ── 7. tabBar ──
  let tabBarInfo: { count: number; custom: boolean } | undefined
  const tabProp = getProp(doc.root, 'tabBar')
  if (tabProp !== undefined) {
    if (tabProp.value.type !== 'object') {
      issues.push({ level: 'error', code: 'tab.not-object', msg: 'app.json 的 tabBar 不是对象' })
    } else {
      const custom = getProp(tabProp.value, 'custom')?.value
      const isCustom = custom !== undefined && custom.type === 'literal' && custom.value === true
      const listProp = getProp(tabProp.value, 'list')
      const items =
        listProp !== undefined && listProp.value.type === 'array'
          ? listProp.value.items.map((item) => (item.node.type === 'object' ? item.node : undefined))
          : []
      tabBarInfo = { count: items.length, custom: isCustom }
      if (items.length < 2 || items.length > 5) {
        issues.push({
          level: 'error',
          code: 'tab.count',
          msg: `tabBar.list 有 ${items.length} 项，微信要求 2–5 项`,
          fix: '增加到 2 项以上，或删掉 tabBar（页面仍可用 wx.switchTab 之外的方式跳转）',
        })
      }
      const seenTab = new Set<string>()
      for (let index = 0; index < items.length; index++) {
        const item = items[index]
        if (item === undefined) continue
        const pagePath = getProp(item, 'pagePath')?.value
        const pageValue = pagePath?.type === 'literal' && typeof pagePath.value === 'string' ? pagePath.value : ''
        if (pageValue === '') {
          issues.push({ level: 'error', code: 'tab.no-page', msg: `tabBar.list[${index}] 缺少 pagePath` })
          continue
        }
        if (!pages.main.includes(pageValue)) {
          issues.push({
            level: 'error',
            code: 'tab.not-main',
            msg: `tabBar 的 pagePath "${pageValue}" 不在主包 pages 里`,
            fix: 'tabBar 页面必须放在主包；先把它从分包移出，或用 mp_tabbar 自动补注册到主包',
          })
        }
        if (seenTab.has(pageValue)) {
          issues.push({ level: 'warn', code: 'tab.duplicate', msg: `tabBar 里 "${pageValue}" 出现了多次` })
        }
        seenTab.add(pageValue)
        const text = getProp(item, 'text')?.value
        if (text === undefined || (text.type === 'literal' && typeof text.value === 'string' && text.value.trim() === '')) {
          issues.push({ level: 'warn', code: 'tab.no-text', msg: `tabBar "${pageValue}" 没有 text，按钮下面会显示空白` })
        }
        for (const [field, value] of [
          ['iconPath', getProp(item, 'iconPath')?.value],
          ['selectedIconPath', getProp(item, 'selectedIconPath')?.value],
        ] as const) {
          if (value === undefined || value.type !== 'literal' || typeof value.value !== 'string') continue
          const iconFile = path.join(srcRoot, value.value.replace(/^\/+/, ''))
          if (!(await isFile(iconFile))) {
            issues.push({
              level: 'warn',
              code: 'tab.icon-missing',
              msg: `tabBar "${pageValue}" 的 ${field} 文件不存在：${value.value}`,
              fix: '补上图片文件（81×81 像素 PNG），或删掉这个字段使用纯文字 tab',
            })
          }
        }
      }
    }
  }

  // ── 8. usingComponents 路径有效性 ──
  const globalUc = getProp(doc.root, 'usingComponents')
  if (globalUc !== undefined && globalUc.value.type === 'object') {
    for (const prop of globalUc.value.props) {
      const ref = prop.value.type === 'literal' && typeof prop.value.value === 'string' ? prop.value.value : ''
      if (ref === '') continue
      if (!(await componentExists(srcRoot, '', ref))) {
        issues.push({
          level: 'error',
          code: 'component.global-missing',
          msg: `app.json 全局组件 "${prop.key}" 的路径无效：${ref}`,
          fix: '检查路径是否相对代码根，且对应 .json 里写了 "component": true',
        })
      }
    }
  }
  for (const page of uniquePages) {
    const pageJson = path.join(srcRoot, `${page}.json`)
    if (!(await isFile(pageJson))) continue
    let pageValue: unknown
    try {
      pageValue = await readJsonFile(pageJson)
    } catch {
      issues.push({ level: 'error', code: 'page.json-broken', msg: `${relativeToSrc(project, pageJson)} 不是合法 JSON` })
      continue
    }
    if (pageValue === null || typeof pageValue !== 'object' || Array.isArray(pageValue)) continue
    const uc = (pageValue as Record<string, unknown>).usingComponents
    if (uc === null || typeof uc !== 'object' || Array.isArray(uc)) continue
    for (const [tag, ref] of Object.entries(uc as Record<string, unknown>)) {
      if (typeof ref !== 'string' || ref === '') continue
      if (!(await componentExists(srcRoot, page, ref))) {
        issues.push({
          level: 'error',
          code: 'component.page-missing',
          msg: `${page}.json 里的组件 "${tag}" 路径无效：${ref}`,
          fix: '以 / 开头的路径相对代码根，否则相对该页面所在目录',
        })
      }
    }
  }

  // ── 9. 工程配置 ──
  if (project.appId === '') {
    issues.push({
      level: 'info',
      code: 'project.no-appid',
      msg: 'project.config.json 里没有 appid，开发者工具里仍可「测试号」运行，但无法预览/上传',
      fix: '把 appid 填进 project.config.json，或改用 mp_devtools 的 open 打开后手动选择',
    })
  }

  // ── 10. 包体积 ──
  const sizes: PackageSize[] = []
  const subRootPaths = pages.subs.map((sub) => sub.root).filter((root) => root !== '')
  const mainBytes = await dirSizeExcluding(srcRoot, subRootPaths)
  sizes.push({ name: '主包', bytes: mainBytes, limit: MAIN_LIMIT })
  for (const sub of pages.subs) {
    if (sub.root === '') continue
    const dir = path.join(srcRoot, sub.root)
    if (!(await isDir(dir))) continue
    sizes.push({ name: `分包 ${sub.root}`, bytes: await dirSize(dir), limit: SUB_LIMIT })
  }
  const totalBytes = sizes.reduce((sum, size) => sum + size.bytes, 0)
  for (const size of sizes) {
    if (size.bytes > size.limit) {
      issues.push({
        level: 'error',
        code: 'size.over',
        msg: `${size.name} 体积 ${fmtBytes(size.bytes)}，超过 ${fmtBytes(size.limit)} 限制`,
        fix: '把页面/图片拆到分包，或压缩图片、把大文件放 CDN',
      })
    } else if (size.bytes > size.limit * 0.8) {
      issues.push({
        level: 'warn',
        code: 'size.near',
        msg: `${size.name} 体积 ${fmtBytes(size.bytes)}，已到 ${fmtBytes(size.limit)} 限制的 80%`,
      })
    }
  }
  if (totalBytes > TOTAL_LIMIT) {
    issues.push({ level: 'error', code: 'size.total', msg: `整包 ${fmtBytes(totalBytes)} 超过 ${fmtBytes(TOTAL_LIMIT)} 总上限` })
  }

  return { project, pages, probes, orphans, issues, sizes, totalBytes, tabBar: tabBarInfo }
}

function pagePathProblem(page: string): string | undefined {
  if (page === '') return '空字符串'
  if (page.startsWith('/')) return '不要以 / 开头'
  if (page.includes('..')) return '不要包含 ..'
  const ext = /\.(wxml|wxss|js|ts|json|axml|acss)$/.exec(page)
  if (ext !== null) return `不要带扩展名 ${ext[0]}`
  return undefined
}

async function componentExists(srcRoot: string, fromPage: string, ref: string): Promise<boolean> {
  const base = resolveComponentPath(srcRoot, fromPage, ref)
  if (await isFile(`${base}.json`)) return true
  if (await isFile(`${base}.wxml`)) return true
  return false
}

/**
 * 猜模型真正想指的页面：常见错误是把 "pages/detail" 写成目录，
 * 而磁盘上是 "pages/detail/index.wxml"。
 */
async function guessActualPage(project: Project, page: string, scriptExtensions: string[]): Promise<string | undefined> {
  const dir = path.join(project.srcRoot, page)
  if (!(await isDir(dir))) return undefined
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.wxml')) continue
    const candidate = `${page}/${entry.name.replace(/\.wxml$/, '')}`
    const probe = await probePage(project, candidate, scriptExtensions)
    if (probe.complete) return candidate
  }
  return undefined
}

/** 计算主包体积：整体减去各分包目录 */
async function dirSizeExcluding(root: string, excludedRel: string[]): Promise<number> {
  const total = await dirSize(root)
  let excluded = 0
  for (const rel of excludedRel) {
    const dir = path.join(root, rel)
    if (await isDir(dir)) excluded += await dirSize(dir)
  }
  return Math.max(0, total - excluded)
}

/** 把问题列表渲染成一段人读的报告（工具输出用） */
export function formatIssues(issues: Issue[], options: { limit?: number } = {}): string[] {
  const order: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 }
  const sorted = [...issues].sort((a, b) => order[a.level] - order[b.level])
  const limit = options.limit ?? 40
  const shown = sorted.slice(0, limit)
  const lines: string[] = []
  for (const issue of shown) {
    const icon = issue.level === 'error' ? '❌' : issue.level === 'warn' ? '⚠️' : 'ℹ️'
    lines.push(`${icon} ${issue.msg}`)
    if (issue.fix !== undefined) lines.push(`   → ${issue.fix}`)
  }
  if (sorted.length > shown.length) lines.push(`… 还有 ${sorted.length - shown.length} 条问题未列出（可先用 mp_scan 的 verbose 参数查看）`)
  return lines
}

export function summarize(issues: Issue[]): { errors: number; warnings: number; infos: number } {
  return {
    errors: issues.filter((issue) => issue.level === 'error').length,
    warnings: issues.filter((issue) => issue.level === 'warn').length,
    infos: issues.filter((issue) => issue.level === 'info').length,
  }
}

export { normalizePagePath }
