import type { Config } from '../config.js';
export interface MutablePageFiles {
    created: string[];
    skipped: string[];
}
export declare function registerPageAdd(ctx: any, config: Config): void;
/** 读取页面 json（用于其它工具判断组件引用） */
export declare function pageJsonOf(project: {
    srcRoot: string;
}, pagePath: string): Promise<Record<string, unknown>>;
