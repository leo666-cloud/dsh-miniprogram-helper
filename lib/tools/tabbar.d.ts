import type { Config } from '../config.js';
interface TabSpec {
    pagePath: string;
    text: string;
    iconPath?: string;
    selectedIconPath?: string;
}
/** 解析 "页面:文字" 形式；也接受 "页面:文字:图标" 三段的简写 */
export declare function parseTabSpecs(input: string): {
    tabs: TabSpec[];
    errors: string[];
};
export declare function registerTabbar(ctx: any, config: Config): void;
export {};
