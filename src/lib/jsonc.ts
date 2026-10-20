/**
 * JSONC（带注释的 JSON）解析与「保格式」编辑。
 *
 * 微信小程序的 app.json / 页面 json 在工程里经常被手写注释，而 JSON.parse 不认注释。
 * 这里实现一个带位置信息的解析器，编辑时只改动目标片段，其余文本（注释、缩进、键顺序、
 * 换行风格）原样保留 —— 而不是整份 JSON.stringify 覆盖掉用户的心血。
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface JsoncLiteralNode {
  type: 'literal'
  start: number
  end: number
  value: JsonValue
}

export interface JsoncItem {
  /** 值节点起点 */
  start: number
  /** 值节点终点（不含） */
  end: number
  node: JsoncNode
}

export interface JsoncArrayNode {
  type: 'array'
  start: number
  end: number
  items: JsoncItem[]
}

export interface JsoncProp {
  key: string
  keyStart: number
  keyEnd: number
  /** 整个属性的起点（键的左引号） */
  start: number
  /** 整个属性的终点（值的结尾） */
  end: number
  value: JsoncNode
}

export interface JsoncObjectNode {
  type: 'object'
  start: number
  end: number
  props: JsoncProp[]
}

export type JsoncNode = JsoncLiteralNode | JsoncArrayNode | JsoncObjectNode

export class JsoncError extends Error {
  readonly offset: number
  readonly line: number
  readonly column: number

  constructor(message: string, text: string, offset: number) {
    const { line, column } = locate(text, offset)
    super(`${message}（第 ${line} 行，第 ${column} 列）`)
    this.name = 'JsoncError'
    this.offset = offset
    this.line = line
    this.column = column
  }
}

function locate(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let column = 1
  const stop = Math.min(Math.max(offset, 0), text.length)
  for (let i = 0; i < stop; i++) {
    if (text[i] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}

const isWs = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\uFEFF' || c === '\u00A0'

/** 解析结果：语法树 + 纯数据。语法树只用于定位编辑区间。 */
export interface JsoncDocument {
  text: string
  root: JsoncNode
  value: JsonValue
}

class Parser {
  private i = 0

  constructor(private readonly text: string) {}

  parse(): JsoncNode {
    this.skip()
    const node = this.parseValue()
    this.skip()
    if (this.i !== this.text.length) this.fail('文件末尾存在多余内容', this.i)
    return node
  }

  private fail(message: string, at: number): never {
    throw new JsoncError(message, this.text, at)
  }

  private skip(): void {
    const text = this.text
    for (;;) {
      const c = text[this.i]
      if (isWs(c)) {
        this.i += 1
        continue
      }
      if (c === '/' && text[this.i + 1] === '/') {
        this.i += 2
        while (this.i < text.length && text[this.i] !== '\n') this.i += 1
        continue
      }
      if (c === '/' && text[this.i + 1] === '*') {
        const close = text.indexOf('*/', this.i + 2)
        if (close < 0) this.fail('块注释没有闭合', this.i)
        this.i = close + 2
        continue
      }
      return
    }
  }

  private parseValue(): JsoncNode {
    const text = this.text
    const c = text[this.i]
    if (c === '{') return this.parseObject()
    if (c === '[') return this.parseArray()
    if (c === '"') return this.parseString()
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return this.parseNumber()
    if (text.startsWith('true', this.i)) return this.literal(4, true)
    if (text.startsWith('false', this.i)) return this.literal(5, false)
    if (text.startsWith('null', this.i)) return this.literal(4, null)
    this.fail(this.i >= text.length ? '内容意外结束' : `无法识别的值（从 ${JSON.stringify(c)} 开始）`, this.i)
  }

  private literal(length: number, value: JsonValue): JsoncLiteralNode {
    const start = this.i
    this.i += length
    return { type: 'literal', start, end: this.i, value }
  }

  private parseString(): JsoncLiteralNode {
    const text = this.text
    const start = this.i
    this.i += 1
    while (this.i < text.length) {
      const c = text[this.i]
      if (c === '\\') {
        this.i += 2
        continue
      }
      if (c === '"') {
        this.i += 1
        const raw = text.slice(start, this.i)
        let value: string
        try {
          value = JSON.parse(raw) as string
        } catch {
          this.fail('字符串转义不合法', start)
        }
        return { type: 'literal', start, end: this.i, value }
      }
      if (c === '\n') this.fail('字符串里不能直接换行', this.i)
      this.i += 1
    }
    this.fail('字符串没有闭合', start)
  }

  private parseNumber(): JsoncLiteralNode {
    const text = this.text
    const start = this.i
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(start))
    if (match === null || match[0].length === 0) this.fail('数字格式不正确', start)
    this.i += match[0].length
    return { type: 'literal', start, end: this.i, value: Number(match[0]) }
  }

  private parseObject(): JsoncObjectNode {
    const text = this.text
    const start = this.i
    this.i += 1
    const props: JsoncProp[] = []
    for (;;) {
      this.skip()
      if (text[this.i] === '}') {
        this.i += 1
        break
      }
      if (this.i >= text.length) this.fail('对象没有闭合（缺少 }）', start)
      if (text[this.i] !== '"') this.fail('对象的键必须是带引号的字符串', this.i)
      const keyNode = this.parseString()
      const key = String(keyNode.value)
      this.skip()
      if (text[this.i] !== ':') this.fail('键后面缺少冒号', this.i)
      this.i += 1
      this.skip()
      const value = this.parseValue()
      props.push({
        key,
        keyStart: keyNode.start,
        keyEnd: keyNode.end,
        start: keyNode.start,
        end: value.end,
        value,
      })
      this.skip()
      if (text[this.i] === ',') {
        this.i += 1
        continue
      }
      if (text[this.i] === '}') {
        this.i += 1
        break
      }
      this.fail('对象成员之间缺少逗号', this.i)
    }
    return { type: 'object', start, end: this.i, props }
  }

  private parseArray(): JsoncArrayNode {
    const text = this.text
    const start = this.i
    this.i += 1
    const items: JsoncItem[] = []
    for (;;) {
      this.skip()
      if (text[this.i] === ']') {
        this.i += 1
        break
      }
      if (this.i >= text.length) this.fail('数组没有闭合（缺少 ]）', start)
      const node = this.parseValue()
      items.push({ start: node.start, end: node.end, node })
      this.skip()
      if (text[this.i] === ',') {
        this.i += 1
        continue
      }
      if (text[this.i] === ']') {
        this.i += 1
        break
      }
      this.fail('数组元素之间缺少逗号', this.i)
    }
    return { type: 'array', start, end: this.i, items }
  }
}

/** 解析 JSONC 文本。注释与尾逗号都接受，错误信息带行列号。 */
export function parseJsonc(text: string): JsoncDocument {
  const node = new Parser(text).parse()
  return { text, root: node, value: toValue(node) }
}

function toValue(node: JsoncNode): JsonValue {
  if (node.type === 'literal') return node.value
  if (node.type === 'array') return node.items.map((item) => toValue(item.node))
  const out: { [key: string]: JsonValue } = {}
  for (const prop of node.props) out[prop.key] = toValue(prop.value)
  return out
}

/** 宽松解析：解析失败时抛出带行列号的 JsoncError。 */
export function parseLenient(text: string, label: string): JsonValue {
  try {
    return parseJsonc(text).value
  } catch (error) {
    if (error instanceof JsoncError) throw new Error(`${label} 解析失败：${error.message}`)
    throw error
  }
}

// ─────────────────────────────────────────────────────────────
// 编辑：只替换目标片段，保留注释与格式
// ─────────────────────────────────────────────────────────────

function lineIndentAt(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const segment = text.slice(lineStart, pos)
  return /^[ \t]*$/.test(segment) ? segment : ''
}

function skipWsFrom(text: string, from: number): number {
  let i = from
  for (;;) {
    const c = text[i]
    if (isWs(c)) {
      i += 1
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close < 0 ? text.length : close + 2
      continue
    }
    return i
  }
}

function innerIndent(text: string, node: JsoncArrayNode | JsoncObjectNode, firstPos: number): string {
  if (firstPos >= 0) {
    const indent = lineIndentAt(text, firstPos)
    if (indent !== '') return indent
  }
  return lineIndentAt(text, node.end - 1) + '  '
}

/** 把值渲染成可插入的多行 JSON 文本，除首行外每行补上缩进。 */
export function renderValue(value: JsonValue, indent: string): string {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : indent + line))
    .join('\n')
}

export function hasKey(node: JsoncNode, key: string): boolean {
  return node.type === 'object' && node.props.some((prop) => prop.key === key)
}

export function getProp(node: JsoncNode, key: string): JsoncProp | undefined {
  return node.type === 'object' ? node.props.find((prop) => prop.key === key) : undefined
}

export function getStringArray(node: JsoncNode): string[] {
  if (node.type !== 'array') return []
  return node.items.map((item) => (item.node.type === 'literal' && typeof item.node.value === 'string' ? item.node.value : ''))
}

/**
 * 定位「在最后一个元素之后追加」的插入点，并处理行尾注释。
 * 形如 `"a" // 说明` 的行尾注释必须留在原行，新元素插到下一行，
 * 否则注释会被错误地挂到新元素上。
 */
function appendAnchor(text: string, lastEnd: number): { insertAt: number; addComma: boolean; afterLine: boolean } {
  let cursor = lastEnd
  const skipBlanks = (): void => {
    while (text[cursor] === ' ' || text[cursor] === '\t') cursor += 1
  }
  skipBlanks()
  let addComma = true
  if (text[cursor] === ',') {
    addComma = false
    cursor += 1
    skipBlanks()
  }
  if (text[cursor] === '/' && text[cursor + 1] === '/') {
    while (cursor < text.length && text[cursor] !== '\n') cursor += 1
    return { insertAt: Math.min(cursor + 1, text.length), addComma, afterLine: true }
  }
  return { insertAt: lastEnd, addComma, afterLine: false }
}

/** 在数组尾部（或头部）插入一个值文本，保留行尾注释与缩进。 */
export function arrayInsert(text: string, node: JsoncArrayNode, valueText: string, prepend = false): string {
  const indent = innerIndent(text, node, node.items.length > 0 ? node.items[0]!.start : -1)
  const multiline = text.slice(node.start, node.end).includes('\n')
  if (node.items.length === 0) {
    const close = node.end - 1
    if (!multiline) return `${text.slice(0, close)}${valueText}${text.slice(close)}`
    const closeIndent = lineIndentAt(text, close)
    return `${text.slice(0, close)}\n${indent}${valueText}\n${closeIndent}${text.slice(close)}`
  }
  if (prepend) {
    const first = node.items[0]!
    return `${text.slice(0, first.start)}${valueText},\n${indent}${text.slice(first.start)}`
  }
  const last = node.items[node.items.length - 1]!
  if (!multiline) {
    const anchor = appendAnchor(text, last.end)
    const comma = anchor.addComma ? ',' : ''
    return `${text.slice(0, anchor.insertAt)}${comma} ${valueText}${text.slice(anchor.insertAt)}`
  }
  const anchor = appendAnchor(text, last.end)
  const comma = anchor.addComma ? ',' : ''
  if (anchor.afterLine) {
    return `${text.slice(0, last.end)}${comma}${text.slice(last.end, anchor.insertAt)}${indent}${valueText}\n${text.slice(anchor.insertAt)}`
  }
  return `${text.slice(0, last.end)}${comma}\n${indent}${valueText}${text.slice(last.end)}`
}

/** 删除数组中的第 index 个元素，并吞掉相邻逗号，避免留下尾逗号。 */
export function arrayRemove(text: string, node: JsoncArrayNode, index: number): string {
  if (index < 0 || index >= node.items.length) return text
  if (node.items.length === 1) return `${text.slice(0, node.start)}[]${text.slice(node.end)}`
  const item = node.items[index]!
  if (index < node.items.length - 1) {
    // 非末项：把 [本项起点, 下一项起点) 整段删掉，逗号随之消失
    const next = node.items[index + 1]!
    return text.slice(0, item.start) + text.slice(next.start)
  }
  // 末项：删掉它所在的整行，再回头摘掉前一项后面那个逗号。
  // 顺序很重要：先删后面的行，前面的偏移量才依然有效。
  const prev = node.items[index - 1]!
  let comma = prev.end
  while (text[comma] === ' ' || text[comma] === '\t') comma += 1
  const hasComma = text[comma] === ','
  const lineStart = text.lastIndexOf('\n', item.start - 1) + 1
  const inline = !text.slice(prev.end, item.start).includes('\n')
  if (inline) {
    const start = hasComma ? comma : prev.end
    return text.slice(0, start) + text.slice(item.end)
  }
  const newline = text.indexOf('\n', item.end)
  const lineEnd = newline < 0 ? item.end : newline + 1
  let out = text.slice(0, lineStart) + text.slice(lineEnd)
  if (hasComma) out = out.slice(0, comma) + out.slice(comma + 1)
  return out
}

/** 设置对象的某个键：已存在则替换值，否则在末尾插入（保留其余文本）。 */
export function objectSet(text: string, node: JsoncObjectNode, key: string, value: JsonValue): string {
  const existing = node.props.find((prop) => prop.key === key)
  if (existing !== undefined) {
    const indent = innerIndent(text, node, node.props[0]!.keyStart)
    return text.slice(0, existing.value.start) + renderValue(value, indent) + text.slice(existing.value.end)
  }
  const indent = innerIndent(text, node, node.props.length > 0 ? node.props[0]!.keyStart : -1)
  const entry = `${JSON.stringify(key)}: ${renderValue(value, indent)}`
  const multiline = text.slice(node.start, node.end).includes('\n')
  if (node.props.length === 0) {
    const close = node.end - 1
    if (!multiline) return `${text.slice(0, close)}${entry}${text.slice(close)}`
    const closeIndent = lineIndentAt(text, close)
    return `${text.slice(0, close)}\n${indent}${entry}\n${closeIndent}${text.slice(close)}`
  }
  const last = node.props[node.props.length - 1]!
  if (!multiline) {
    const anchor = appendAnchor(text, last.end)
    const comma = anchor.addComma ? ',' : ''
    return `${text.slice(0, anchor.insertAt)}${comma} ${entry}${text.slice(anchor.insertAt)}`
  }
  const anchor = appendAnchor(text, last.end)
  const comma = anchor.addComma ? ',' : ''
  if (anchor.afterLine) {
    return `${text.slice(0, last.end)}${comma}${text.slice(last.end, anchor.insertAt)}${indent}${entry}\n${text.slice(anchor.insertAt)}`
  }
  return `${text.slice(0, last.end)}${comma}\n${indent}${entry}${text.slice(last.end)}`
}

/** 删除对象的一个键（连同上一个逗号）。 */
export function objectRemove(text: string, node: JsoncObjectNode, key: string): string {
  const index = node.props.findIndex((prop) => prop.key === key)
  if (index < 0) return text
  if (node.props.length === 1) return `${text.slice(0, node.start)}{}${text.slice(node.end)}`
  if (index === 0) {
    const next = node.props[1]!
    return text.slice(0, node.props[0]!.start) + text.slice(next.start)
  }
  const prev = node.props[index - 1]!
  let to = node.props[index]!.end
  const after = skipWsFrom(text, to)
  if (text[after] === ',') to = after + 1
  return text.slice(0, prev.end) + text.slice(to)
}

/** 字符串化一个 JSON 值，用于错误信息等场景。 */
export function preview(value: JsonValue, max = 160): string {
  const raw = JSON.stringify(value)
  if (raw === undefined) return 'undefined'
  return raw.length > max ? `${raw.slice(0, max)}…` : raw
}
