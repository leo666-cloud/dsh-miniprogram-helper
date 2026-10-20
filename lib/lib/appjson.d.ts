import { type JsoncDocument, type JsonValue } from './jsonc.js';
import { type Project } from './project.js';
/** 读取 app.json（必须存在） */
export declare function readAppJson(project: Project): Promise<AppJson>;
/** 读取任意 json（宽松）；不存在或为空返回 {} */
export declare function readJsonFile(file: string): Promise<JsonValue>;
export { getProp, hasKey } from './jsonc.js';
export type RegisterOutcome = 'added' | 'exists' | 'moved';
/** 保格式地编辑一份 app.json 文本。 */
export declare class AppJson {
    readonly file: string;
    text: string;
    constructor(file: string, text: string);
    get doc(): JsoncDocument;
    get json(): JsonValue;
    pages(): string[];
    /** 注册一个页面。subpackage 未指定时按已有分包声明自动判断归属。 */
    registerPage(pagePath: string, options?: {
        prepend?: boolean;
        subpackage?: string;
    }): RegisterOutcome;
    private findOwningSubpackage;
    /** 把页面从主包或所属分包中移除 */
    unregisterPage(pagePath: string): boolean;
    /** 把页面放到首位并写 entryPagePath */
    setEntryPage(pagePath: string): void;
    /** 声明或补全一个分包，并把页面登记进去 */
    registerInSubpackage(root: string, pagePath: string): void;
    /** 设置 tabBar：list 为 [{pagePath, text, iconPath?, selectedIconPath?}] */
    setTabBar(list: Array<{
        pagePath: string;
        text: string;
        iconPath?: string;
        selectedIconPath?: string;
    }>): void;
    tabBarList(): Array<Record<string, JsonValue>>;
    /** 追加/覆盖一个全局组件 */
    setGlobalComponent(tag: string, ref: string): void;
    /** 设置 tabBar 上的单个属性（color / selectedColor / backgroundColor / position） */
    setTabBarValue(key: string, value: JsonValue): void;
    /** 移除根级键 */
    removeRootKey(key: string): void;
    /** 给某个分包补上独立分包等标志 */
    setSubpackageFlags(root: string, flags: {
        independent?: boolean;
    }): void;
    /** 设置根级键（保持文件其余部分不变） */
    setRootKey(key: string, value: JsonValue): void;
    private insertIntoArray;
    private indentAt;
}
/** 原子写入文本：先写临时文件再 rename，避免中途崩溃留下半个文件。 */
export declare function writeText(file: string, text: string): Promise<void>;
/** 页面 json 里注入组件引用（文件不存在则新建） */
export declare function injectPageComponent(pageJsonFile: string, tag: string, ref: string): Promise<{
    created: boolean;
    text: string;
}>;
export declare function ensureTrailingNewline(text: string): string;
