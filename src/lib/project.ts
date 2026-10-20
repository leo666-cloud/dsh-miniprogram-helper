/**
 * 小程序工程模型：定位工程根、解析 miniprogramRoot、路径规整与磁盘扫描。
 *
 * 微信开发者工具的「项目根」与「小程序代码根」不是一回事：
 * project.config.json 里的 miniprogramRoot 可能指向 miniprogram/ 之类的子目录，
 * app.json 在代码根里，而开发者工具打开的是项目根。搞混这两个概念，
 * 生成出来的页面就会落到开发者工具看不见的地方。
 */
import path from 'node:path'
import { readFile, readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { parseLenient, type JsonValue } from './jsonc.js'

export const DEVTOOLS_CONFIG = 'project.config.json'
export const DEVTOOLS_PRIVATE_CONFIG = 'project.private.config.json'
export const APP_JSON = 'app.json'

export class ProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}

export interface Project {
  /** 开发者工具打开的项目根目录（绝对路径） */
  root: string
  /** app.json 所在目录（绝对路径） */
  srcRoot: string
  /** miniprogramRoot 原始值，'' 表示代码根就是项目根 */
  miniprogramRoot: string
  /** 工程类型：普通小程序 / 插件 / 小游戏 */
  compileType: string
  appId: string
  /** project.config.json 解析结果（可能为 undefined） */
  config?: JsonValue
  privateConfig?: JsonValue
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

export { isFile, isDir }

async function readJsonIfExists(file: string): Promise<JsonValue | undefined> {
  try {
    const raw = await readFile(file, 'utf8')
    if (raw.trim() === '') return undefined
    return parseLenient(raw, path.basename(file))
  } catch {
    return undefined
  }
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined
}

/**
 * 打开一个工程。接受三种输入：
 *  - 项目根目录（含 project.config.json）
 *  - 代码根目录（含 app.json）
 *  - project.config.json 文件路径
 */
export async function openProject(input: string): Promise<Project> {
  const given = path.resolve(String(input).trim())
  if (given === '') throw new ProjectError('未提供项目路径')

  let root = given
  if (await isFile(given)) {
    if (path.basename(given) !== DEVTOOLS_CONFIG && path.basename(given) !== DEVTOOLS_PRIVATE_CONFIG) {
      throw new ProjectError(`传入的是文件而不是目录：${given}`)
    }
    root = path.dirname(given)
  } else if (!(await isDir(given))) {
    throw new ProjectError(`路径不存在或不是目录：${given}`)
  }

  let config = await readJsonIfExists(path.join(root, DEVTOOLS_CONFIG))
  let privateConfig = await readJsonIfExists(path.join(root, DEVTOOLS_PRIVATE_CONFIG))
  const privateRec = asRecord(privateConfig)
  if (privateRec !== undefined && privateRec.miniprogramRoot !== undefined) config = privateConfig

  let srcRoot = root
  let miniprogramRoot = ''
  const configRec = asRecord(config)
  if (configRec !== undefined && typeof configRec.miniprogramRoot === 'string' && configRec.miniprogramRoot.trim() !== '') {
    miniprogramRoot = normalizeRelative(configRec.miniprogramRoot)
    srcRoot = path.resolve(root, miniprogramRoot)
    if (!isInside(srcRoot, root)) {
      throw new ProjectError(`project.config.json 的 miniprogramRoot "${miniprogramRoot}" 指到了项目目录之外`)
    }
  }

  if (!(await isFile(path.join(srcRoot, APP_JSON)))) {
    // 没找到代码根时给出可执行的下一步，而不是只说一句“找不到 app.json”
    const hints: string[] = []
    hints.push(`已在 ${srcRoot} 查找 ${APP_JSON}`)
    if (config === undefined) hints.push(`项目根 ${root} 下没有 ${DEVTOOLS_CONFIG}`)
    const nested = await findAppJson(root, 3)
    if (nested.length > 0) hints.push(`在子目录里发现了 app.json：${nested.slice(0, 5).join('、')}，可能需要在 project.config.json 里配置 miniprogramRoot`)
    hints.push(`若这是尚未初始化的新工程，先用 mp_project_init 生成骨架`)
    throw new ProjectError(hints.join('；'))
  }

  return {
    root,
    srcRoot,
    miniprogramRoot,
    compileType: typeof configRec?.compileType === 'string' ? String(configRec.compileType) : 'miniprogram',
    appId: typeof configRec?.appid === 'string' ? String(configRec.appid) : '',
    config,
    privateConfig,
  }
}

async function findAppJson(root: string, depth: number): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, rel: string, left: number): Promise<void> => {
    if (left < 0) return
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const nextRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (await isFile(path.join(dir, entry.name, APP_JSON))) out.push(nextRel)
      await walk(path.join(dir, entry.name), nextRel, left - 1)
    }
  }
  await walk(root, '', depth)
  return out
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 归一化相对路径：统一分隔符、去首尾斜杠、拒绝对路径与 .. 逃逸。 */
export function normalizeRelative(input: string): string {
  const raw = String(input).trim().replace(/\\/g, '/')
  if (raw === '') return ''
  if (raw.startsWith('/')) throw new ProjectError(`路径不能以 / 开头（应相对项目根书写）：${input}`)
  const segments = raw.split('/').filter((segment) => segment !== '' && segment !== '.')
  for (const segment of segments) {
    if (segment === '..') throw new ProjectError(`路径不能包含 ..（会逃出项目目录）：${input}`)
  }
  return segments.join('/')
}

const PAGE_EXTENSIONS = ['.wxml', '.wxss', '.js', '.ts', '.json', '.axml', '.acss', '.sjs', '.wxs']

/**
 * 规整页面路径。模型常见的几种写法都接受：
 *   "/pages/detail/index/"、"pages/detail/index.wxml"、"pages\\detail\\index"
 * 返回像 "pages/detail/index" 这样、最后一段是文件名基名的路径。
 */
export function normalizePagePath(input: string): string {
  let value = String(input).trim().replace(/\\/g, '/')
  if (value === '') throw new ProjectError('页面路径为空')
  value = value.replace(/^\/+/, '').replace(/\/+$/, '')
  for (const ext of PAGE_EXTENSIONS) {
    if (value.endsWith(ext)) {
      value = value.slice(0, -ext.length)
      break
    }
  }
  const normalized = normalizeRelative(value)
  if (normalized === '') throw new ProjectError(`页面路径不合法：${input}`)
  const last = normalized.split('/').pop() ?? ''
  if (last.includes('.')) throw new ProjectError(`页面路径最后一段不能带扩展名：${input}`)
  return normalized
}

/** 判断候选路径是否落在 subs 中某个分包根目录下，返回该分包。 */
export function subpackageOf(pagePath: string, subs: Subpackage[]): Subpackage | undefined {
  return subs.find((sub) => pagePath === sub.root || pagePath.startsWith(`${sub.root}/`))
}

export interface Subpackage {
  /** 在 app.json 中的写法：subPackages / subpackages */
  key: 'subPackages' | 'subpackages'
  /** 分包根目录（已归一化） */
  root: string
  /** 分包内页面，相对分包根 */
  pages: string[]
  independent: boolean
  index: number
}

export interface DeclaredPages {
  main: string[]
  subs: Subpackage[]
  /** 所有页面的完整路径（主包 + 分包展开） */
  all: string[]
}

/** 从 app.json 数据里收集页面声明。兼容 subPackages 与 subpackages 两种写法。 */
export function collectPages(json: JsonValue | undefined): DeclaredPages {
  const record = asRecord(json)
  const main = Array.isArray(record?.pages)
    ? (record.pages as JsonValue[]).filter((p): p is string => typeof p === 'string').map((p) => p.replace(/^\/+/, ''))
    : []
  let key: 'subPackages' | 'subpackages' = 'subPackages'
  let rawSubs: JsonValue | undefined = record?.subPackages
  if (rawSubs === undefined) {
    rawSubs = record?.subpackages
    key = 'subpackages'
  }
  const subs: Subpackage[] = []
  if (Array.isArray(rawSubs)) {
    rawSubs.forEach((entry, index) => {
      const rec = asRecord(entry)
      if (rec === undefined) return
      const rootValue = typeof rec.root === 'string' ? rec.root : ''
      let root: string
      try {
        root = normalizeRelative(rootValue)
      } catch {
        root = rootValue
      }
      const pages = Array.isArray(rec.pages)
        ? (rec.pages as JsonValue[]).filter((p): p is string => typeof p === 'string').map((p) => p.replace(/^\/+/, ''))
        : []
      subs.push({ key, root, pages, independent: rec.independent === true, index })
    })
  }
  const all = [...main, ...subs.flatMap((sub) => sub.pages.map((page) => (sub.root === '' ? page : `${sub.root}/${page}`)))]
  return { main, subs, all }
}

export interface PageProbe {
  page: string
  /** 必需文件（脚本 + 模板）是否齐全 */
  complete: boolean
  missing: string[]
  optionalMissing: string[]
  files: string[]
}

export interface ScanOptions {
  /** 组件目录（相对代码根），扫描页面时跳过 */
  componentDirs: string[]
  /** 脚本扩展名，默认 ['js', 'ts'] */
  scriptExtensions?: string[]
}

const ALWAYS_SKIP = new Set(['node_modules', 'miniprogram_npm', '.git', '.DS_Store', 'dist', 'miniprogram_dist', '__MACOSX'])

/**
 * 递归找页面：以 .wxml 为锚点。
 * 排除自定义组件（同名 json 里 "component": true），否则 mp_fix 会把组件塞进 pages 把工程搞坏。
 */
export async function scanPages(project: Project, options: ScanOptions): Promise<string[]> {
  const skipDirs = new Set(options.componentDirs.map((dir) => normalizeRelativeSafely(dir)).filter((dir) => dir !== ''))
  const found: string[] = []
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name)) continue
        if (skipDirs.has(relPath)) continue
        await walk(path.join(dir, entry.name), relPath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.wxml')) continue
      const pagePath = relPath.replace(/\.wxml$/, '')
      const jsonFile = path.join(project.srcRoot, `${pagePath}.json`)
      if (await isFile(jsonFile)) {
        const meta = asRecord(await readJsonIfExists(jsonFile))
        if (meta?.component === true) continue
      }
      found.push(pagePath)
    }
  }
  await walk(project.srcRoot, '')
  return found.sort()
}

function normalizeRelativeSafely(input: string): string {
  try {
    return normalizeRelative(input)
  } catch {
    return ''
  }
}

/** 探针：检查页面文件是否齐全。微信只强制要求脚本 + 模板，wxss/json 可选。 */
export async function probePage(project: Project, pagePath: string, scriptExtensions: string[]): Promise<PageProbe> {
  const base = path.join(project.srcRoot, pagePath)
  const script = scriptExtensions.find((ext) => !ext.startsWith('.')) ?? 'js'
  const required = [`${base}.${script}`, `${base}.wxml`]
  const optional = [`${base}.wxss`, `${base}.json`]
  const missing: string[] = []
  const optionalMissing: string[] = []
  const files: string[] = []
  for (const file of required) {
    if (await isFile(file)) files.push(file)
    else missing.push(path.basename(file))
  }
  for (const file of optional) {
    if (await isFile(file)) files.push(file)
    else optionalMissing.push(path.basename(file))
  }
  // TypeScript 工程里也可能存在 .js，存在即视为有效脚本
  if (missing.length === 1 && missing[0] === `${path.basename(base)}.${script}`) {
    for (const ext of scriptExtensions) {
      if (await isFile(`${base}.${ext}`)) {
        missing.pop()
        files.push(`${base}.${ext}`)
        break
      }
    }
  }
  return { page: pagePath, complete: missing.length === 0, missing, optionalMissing, files }
}

/** 计算目录体积（字节）。跳过依赖与隐藏缓存目录。 */
export async function dirSize(dir: string, skipNames: Set<string> = new Set()): Promise<number> {
  let total = 0
  const walk = async (current: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (skipNames.has(entry.name)) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name)) continue
        await walk(full)
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size
        } catch {
          /* 读不到就跳过，别因为一个坏文件让体检整体失败 */
        }
      }
    }
  }
  await walk(dir)
  return total
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * 解析 usingComponents 里的组件路径。
 * 以 / 开头相对代码根，否则相对当前页面所在目录（微信的规则）。
 */
export function resolveComponentPath(srcRoot: string, fromPagePath: string, ref: string): string {
  const clean = ref.replace(/\\/g, '/')
  if (clean.startsWith('/')) return path.join(srcRoot, clean.replace(/^\/+/, ''))
  const fromDir = path.dirname(fromPagePath)
  return path.join(srcRoot, fromDir === '.' ? '' : fromDir, clean)
}

/** 相对代码根书写一个绝对路径（用于在报告里展示） */
export function relativeToSrc(project: Project, absolute: string): string {
  return path.relative(project.srcRoot, absolute).split(path.sep).join('/')
}

/** 相对项目根书写（开发者工具里看到的路径） */
export function relativeToRoot(project: Project, absolute: string): string {
  return path.relative(project.root, absolute).split(path.sep).join('/')
}
