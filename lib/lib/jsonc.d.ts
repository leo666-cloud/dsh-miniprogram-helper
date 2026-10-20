/**
 * JSONC（带注释的 JSON）解析与「保格式」编辑。
 *
 * 微信小程序的 app.json / 页面 json 在工程里经常被手写注释，而 JSON.parse 不认注释。
 * 这里实现一个带位置信息的解析器，编辑时只改动目标片段，其余文本（注释、缩进、键顺序、
 * 换行风格）原样保留 —— 而不是整份 JSON.stringify 覆盖掉用户的心血。
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export interface JsoncLiteralNode {
    type: 'literal';
    start: number;
    end: number;
    value: JsonValue;
}
export interface JsoncItem {
    /** 值节点起点 */
    start: number;
    /** 值节点终点（不含） */
    end: number;
    node: JsoncNode;
}
export interface JsoncArrayNode {
    type: 'array';
    start: number;
    end: number;
    items: JsoncItem[];
}
export interface JsoncProp {
    key: string;
    keyStart: number;
    keyEnd: number;
    /** 整个属性的起点（键的左引号） */
    start: number;
    /** 整个属性的终点（值的结尾） */
    end: number;
    value: JsoncNode;
}
export interface JsoncObjectNode {
    type: 'object';
    start: number;
    end: number;
    props: JsoncProp[];
}
export type JsoncNode = JsoncLiteralNode | JsoncArrayNode | JsoncObjectNode;
export declare class JsoncError extends Error {
    readonly offset: number;
    readonly line: number;
    readonly column: number;
    constructor(message: string, text: string, offset: number);
}
/** 解析结果：语法树 + 纯数据。语法树只用于定位编辑区间。 */
export interface JsoncDocument {
    text: string;
    root: JsoncNode;
    value: JsonValue;
}
/** 解析 JSONC 文本。注释与尾逗号都接受，错误信息带行列号。 */
export declare function parseJsonc(text: string): JsoncDocument;
/** 宽松解析：解析失败时抛出带行列号的 JsoncError。 */
export declare function parseLenient(text: string, label: string): JsonValue;
/** 把值渲染成可插入的多行 JSON 文本，除首行外每行补上缩进。 */
export declare function renderValue(value: JsonValue, indent: string): string;
export declare function hasKey(node: JsoncNode, key: string): boolean;
export declare function getProp(node: JsoncNode, key: string): JsoncProp | undefined;
export declare function getStringArray(node: JsoncNode): string[];
/** 在数组尾部（或头部）插入一个值文本，保留行尾注释与缩进。 */
export declare function arrayInsert(text: string, node: JsoncArrayNode, valueText: string, prepend?: boolean): string;
/** 删除数组中的第 index 个元素，并吞掉相邻逗号，避免留下尾逗号。 */
export declare function arrayRemove(text: string, node: JsoncArrayNode, index: number): string;
/** 设置对象的某个键：已存在则替换值，否则在末尾插入（保留其余文本）。 */
export declare function objectSet(text: string, node: JsoncObjectNode, key: string, value: JsonValue): string;
/** 删除对象的一个键（连同上一个逗号）。 */
export declare function objectRemove(text: string, node: JsoncObjectNode, key: string): string;
/** 字符串化一个 JSON 值，用于错误信息等场景。 */
export declare function preview(value: JsonValue, max?: number): string;
