/**
 * app.json / 页面 json 的读取与「保格式」编辑。
 *
 * 所有编辑都走 JSONC 的区间替换：注释、缩进、键顺序、CRLF 都原样保留。
 * 每次修改后重新解析，避免拿着过期偏移量改动文本。
 */
import path from 'node:path'
import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import {
  parseJsonc,
  parseLenient,
  arrayInsert,
  arrayRemove,
  objectSet,
  objectRemove,
  getProp,
  renderValue,
  type JsoncDocument,
  type JsoncNode,
  type JsonValue,
} from './jsonc.js'
import { APP_JSON, collectPages, isFile, type Project } from './project.js'

/** 读取 app.json（必须存在） */
export async function readAppJson(project: Project): Promise<AppJson> {
  const file = path.join(project.srcRoot, APP_JSON)
  if (!(await isFile(file))) {
    throw new Error(`找不到 ${file}，请确认项目/代码根目录是否正确（可用 mp_project_init 生成骨架）`)
  }
  const text = await readFile(file, 'utf8')
  return new AppJson(file, text)
}

/** 读取任意 json（宽松）；不存在或为空返回 {} */
export async function readJsonFile(file: string): Promise<JsonValue> {
  try {
    const raw = await readFile(file, 'utf8')
    if (raw.trim() === '') return {}
    return parseLenient(raw, path.basename(file))
  } catch (error) {
    if (error instanceof Error && error.message.includes('解析失败')) throw error
    return {}
  }
}

export { getProp, hasKey } from './jsonc.js'

export type RegisterOutcome = 'added' | 'exists' | 'moved'

/** 保格式地编辑一份 app.json 文本。 */
export class AppJson {
  constructor(
    readonly file: string,
    public text: string,
  ) {}

  get doc(): JsoncDocument {
    return parseJsonc(this.text)
  }

  get json(): JsonValue {
    return this.doc.value
  }

  pages(): string[] {
    return collectPages(this.json).all
  }

  /** 注册一个页面。subpackage 未指定时按已有分包声明自动判断归属。 */
  registerPage(pagePath: string, options: { prepend?: boolean; subpackage?: string } = {}): RegisterOutcome {
    const declared = collectPages(this.json)
    const subRoot = options.subpackage ?? this.findOwningSubpackage(pagePath, declared)
    if (subRoot !== undefined) {
      if (declared.all.includes(pagePath)) return 'exists'
      this.registerInSubpackage(subRoot, pagePath)
      return 'added'
    }
    if (declared.main.includes(pagePath)) return 'exists'
    this.insertIntoArray(['pages'], pagePath, options.prepend === true)
    return 'added'
  }

  private findOwningSubpackage(pagePath: string, declared: ReturnType<typeof collectPages>): string | undefined {
    const owner = declared.subs.find((sub) => sub.root !== '' && (pagePath === sub.root || pagePath.startsWith(`${sub.root}/`)))
    return owner?.root
  }

  /** 把页面从主包或所属分包中移除 */
  unregisterPage(pagePath: string): boolean {
    const doc = this.doc
    const root = doc.root
    const declared = collectPages(doc.value)
    const pagesProp = getProp(root, 'pages')
    if (pagesProp !== undefined && pagesProp.value.type === 'array') {
      const index = pagesProp.value.items.findIndex((item) => item.node.type === 'literal' && item.node.value === pagePath)
      if (index >= 0) {
        this.text = arrayRemove(this.text, pagesProp.value, index)
        return true
      }
    }
    for (const sub of declared.subs) {
      if (sub.root === '' || !pagePath.startsWith(`${sub.root}/`)) continue
      const rel = pagePath.slice(sub.root.length + 1)
      const subsProp = getProp(root, sub.key)
      if (subsProp === undefined || subsProp.value.type !== 'array') continue
      const entry = subsProp.value.items.find((item) => {
        const rec = item.node
        if (rec.type !== 'object') return false
        const rootProp = getProp(rec, 'root')
        return rootProp?.value.type === 'literal' && rootProp.value.value === sub.root
      })
      if (entry === undefined || entry.node.type !== 'object') continue
      const pagesNode = getProp(entry.node, 'pages')
      if (pagesNode === undefined || pagesNode.value.type !== 'array') continue
      const index = pagesNode.value.items.findIndex((item) => item.node.type === 'literal' && item.node.value === rel)
      if (index >= 0) {
        this.text = arrayRemove(this.text, pagesNode.value, index)
        return true
      }
    }
    return false
  }

  /** 把页面放到首位并写 entryPagePath */
  setEntryPage(pagePath: string): void {
    const doc = this.doc
    const declared = collectPages(doc.value)
    if (!declared.main.includes(pagePath) && !declared.all.includes(pagePath)) {
      this.registerPage(pagePath, { prepend: true })
    } else if (declared.main.includes(pagePath) && declared.main[0] !== pagePath) {
      const pagesProp = getProp(this.doc.root, 'pages')
      if (pagesProp !== undefined && pagesProp.value.type === 'array') {
        const index = pagesProp.value.items.findIndex((item) => item.node.type === 'literal' && item.node.value === pagePath)
        if (index > 0) {
          this.text = arrayRemove(this.text, pagesProp.value, index)
          this.insertIntoArray(['pages'], pagePath, true)
        }
      }
    }
    this.setRootKey('entryPagePath', pagePath)
  }

  /** 声明或补全一个分包，并把页面登记进去 */
  registerInSubpackage(root: string, pagePath: string): void {
    const rel = pagePath.startsWith(`${root}/`) ? pagePath.slice(root.length + 1) : pagePath
    let doc = this.doc
    let rootNode = doc.root
    let subsProp = getProp(rootNode, 'subPackages') ?? getProp(rootNode, 'subpackages')
    if (subsProp === undefined) {
      this.setRootKey('subPackages', [])
      doc = this.doc
      rootNode = doc.root
      subsProp = getProp(rootNode, 'subPackages')
    }
    if (subsProp === undefined || subsProp.value.type !== 'array') {
      throw new Error('app.json 的 subPackages 不是数组，已停止修改以免破坏配置')
    }
    const subsArray = subsProp.value
    const entryIndex = subsArray.items.findIndex((item) => {
      const node = item.node
      if (node.type !== 'object') return false
      const rootProp = getProp(node, 'root')
      return rootProp?.value.type === 'literal' && rootProp.value.value === root
    })
    if (entryIndex < 0) {
      const indent = this.indentAt(subsArray.items[0]?.start ?? subsArray.end - 1) || '    '
      const entryText = renderValue({ root, pages: [rel] }, indent)
      this.text = arrayInsert(this.text, subsArray, entryText, false)
      return
    }
    const entry = subsArray.items[entryIndex]!
    if (entry.node.type !== 'object') throw new Error(`subPackages[${entryIndex}] 不是对象，已停止修改`)
    const pagesProp = getProp(entry.node, 'pages')
    if (pagesProp === undefined) {
      this.text = objectSet(this.text, entry.node, 'pages', [rel])
      return
    }
    if (pagesProp.value.type !== 'array') throw new Error(`分包 ${root} 的 pages 不是数组，已停止修改`)
    if (pagesProp.value.items.some((item) => item.node.type === 'literal' && item.node.value === rel)) return
    this.text = arrayInsert(this.text, pagesProp.value, JSON.stringify(rel), false)
  }

  /** 设置 tabBar：list 为 [{pagePath, text, iconPath?, selectedIconPath?}] */
  setTabBar(list: Array<{ pagePath: string; text: string; iconPath?: string; selectedIconPath?: string }>): void {
    const doc = this.doc
    const tabProp = getProp(doc.root, 'tabBar')
    if (tabProp === undefined) {
      this.setRootKey('tabBar', { list })
      return
    }
    if (tabProp.value.type !== 'object') throw new Error('app.json 的 tabBar 不是对象，已停止修改')
    const normalized = list.map((item) => cleanUndefined(item))
    this.text = objectSet(this.text, tabProp.value, 'list', normalized as unknown as JsonValue)
  }

  tabBarList(): Array<Record<string, JsonValue>> {
    const doc = this.doc
    const tabProp = getProp(doc.root, 'tabBar')
    if (tabProp === undefined || tabProp.value.type !== 'object') return []
    const listProp = getProp(tabProp.value, 'list')
    if (listProp === undefined || listProp.value.type !== 'array') return []
    const out: Array<Record<string, JsonValue>> = []
    for (const item of listProp.value.items) {
      if (item.node.type === 'object') out.push(item.node.type === 'object' ? (parseJsonc(this.text.slice(item.start, item.end)).value as Record<string, JsonValue>) : {})
    }
    return out
  }

  /** 追加/覆盖一个全局组件 */
  setGlobalComponent(tag: string, ref: string): void {
    const doc = this.doc
    const ucProp = getProp(doc.root, 'usingComponents')
    if (ucProp === undefined) {
      this.setRootKey('usingComponents', { [tag]: ref })
      return
    }
    if (ucProp.value.type !== 'object') throw new Error('app.json 的 usingComponents 不是对象，已停止修改')
    this.text = objectSet(this.text, ucProp.value, tag, ref)
  }

  /** 设置 tabBar 上的单个属性（color / selectedColor / backgroundColor / position） */
  setTabBarValue(key: string, value: JsonValue): void {
    const doc = this.doc
    const tabProp = getProp(doc.root, 'tabBar')
    if (tabProp === undefined || tabProp.value.type !== 'object') throw new Error('app.json 的 tabBar 不是对象，已停止修改')
    this.text = objectSet(this.text, tabProp.value, key, value)
  }

  /** 移除根级键 */
  removeRootKey(key: string): void {
    const doc = this.doc
    if (doc.root.type !== 'object') return
    this.text = objectRemove(this.text, doc.root, key)
  }

  /** 给某个分包补上独立分包等标志 */
  setSubpackageFlags(root: string, flags: { independent?: boolean }): void {
    const doc = this.doc
    if (doc.root.type !== 'object') return
    const subsProp = getProp(doc.root, 'subPackages') ?? getProp(doc.root, 'subpackages')
    if (subsProp === undefined || subsProp.value.type !== 'array') return
    const entry = subsProp.value.items.find((item) => {
      const node = item.node
      if (node.type !== 'object') return false
      const rootProp = getProp(node, 'root')
      return rootProp?.value.type === 'literal' && rootProp.value.value === root
    })
    if (entry === undefined || entry.node.type !== 'object') return
    if (flags.independent !== undefined) this.text = objectSet(this.text, entry.node, 'independent', flags.independent)
  }

  /** 设置根级键（保持文件其余部分不变） */
  setRootKey(key: string, value: JsonValue): void {
    const doc = this.doc
    if (doc.root.type !== 'object') throw new Error('app.json 顶层不是对象，已停止修改')
    this.text = objectSet(this.text, doc.root, key, value)
  }

  private insertIntoArray(keyPath: string[], value: string, prepend: boolean): void {
    const doc = this.doc
    let node: JsoncNode = doc.root
    for (const key of keyPath) {
      const prop = getProp(node, key)
      if (prop === undefined) {
        this.setRootKey(keyPath[0] ?? key, [])
        return this.insertIntoArray(keyPath, value, prepend)
      }
      node = prop.value
    }
    if (node.type !== 'array') throw new Error(`app.json 的 ${keyPath.join('.')} 不是数组，已停止修改`)
    const text = JSON.stringify(value)
    this.text = arrayInsert(this.text, node, text, prepend)
  }

  private indentAt(pos: number): string {
    const start = this.text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
    const line = this.text.slice(start, pos)
    return /^[ \t]*$/.test(line) ? line : ''
  }
}

function cleanUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    if (val !== undefined) out[key] = val
  }
  return out as T
}

/** 原子写入文本：先写临时文件再 rename，避免中途崩溃留下半个文件。 */
export async function writeText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, text, 'utf8')
  try {
    await rename(tmp, file)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}

/** 页面 json 里注入组件引用（文件不存在则新建） */
export async function injectPageComponent(pageJsonFile: string, tag: string, ref: string): Promise<{ created: boolean; text: string }> {
  const exists = await isFile(pageJsonFile)
  if (!exists) {
    const text = `${JSON.stringify({ usingComponents: { [tag]: ref } }, null, 2)}\n`
    await writeText(pageJsonFile, text)
    return { created: true, text }
  }
  const raw = await readFile(pageJsonFile, 'utf8')
  const app = new AppJson(pageJsonFile, raw.trim() === '' ? '{}\n' : raw)
  const doc = app.doc
  if (doc.root.type !== 'object') throw new Error(`${path.basename(pageJsonFile)} 顶层不是对象，已停止修改`)
  const ucProp = getProp(doc.root, 'usingComponents')
  if (ucProp === undefined) {
    app.setRootKey('usingComponents', { [tag]: ref })
  } else if (ucProp.value.type !== 'object') {
    throw new Error(`${path.basename(pageJsonFile)} 的 usingComponents 不是对象，已停止修改`)
  } else {
    app.text = objectSet(app.text, ucProp.value, tag, ref)
  }
  await writeText(pageJsonFile, ensureTrailingNewline(app.text))
  return { created: false, text: app.text }
}

export function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}
