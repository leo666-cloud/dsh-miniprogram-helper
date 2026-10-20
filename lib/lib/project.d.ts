import { type JsonValue } from './jsonc.js';
export declare const DEVTOOLS_CONFIG = "project.config.json";
export declare const DEVTOOLS_PRIVATE_CONFIG = "project.private.config.json";
export declare const APP_JSON = "app.json";
export declare class ProjectError extends Error {
    constructor(message: string);
}
export interface Project {
    /** 开发者工具打开的项目根目录（绝对路径） */
    root: string;
    /** app.json 所在目录（绝对路径） */
    srcRoot: string;
    /** miniprogramRoot 原始值，'' 表示代码根就是项目根 */
    miniprogramRoot: string;
    /** 工程类型：普通小程序 / 插件 / 小游戏 */
    compileType: string;
    appId: string;
    /** project.config.json 解析结果（可能为 undefined） */
    config?: JsonValue;
    privateConfig?: JsonValue;
}
declare function isFile(p: string): Promise<boolean>;
declare function isDir(p: string): Promise<boolean>;
export { isFile, isDir };
/**
 * 打开一个工程。接受三种输入：
 *  - 项目根目录（含 project.config.json）
 *  - 代码根目录（含 app.json）
 *  - project.config.json 文件路径
 */
export declare function openProject(input: string): Promise<Project>;
/** 归一化相对路径：统一分隔符、去首尾斜杠、拒绝对路径与 .. 逃逸。 */
export declare function normalizeRelative(input: string): string;
/**
 * 规整页面路径。模型常见的几种写法都接受：
 *   "/pages/detail/index/"、"pages/detail/index.wxml"、"pages\\detail\\index"
 * 返回像 "pages/detail/index" 这样、最后一段是文件名基名的路径。
 */
export declare function normalizePagePath(input: string): string;
/** 判断候选路径是否落在 subs 中某个分包根目录下，返回该分包。 */
export declare function subpackageOf(pagePath: string, subs: Subpackage[]): Subpackage | undefined;
export interface Subpackage {
    /** 在 app.json 中的写法：subPackages / subpackages */
    key: 'subPackages' | 'subpackages';
    /** 分包根目录（已归一化） */
    root: string;
    /** 分包内页面，相对分包根 */
    pages: string[];
    independent: boolean;
    index: number;
}
export interface DeclaredPages {
    main: string[];
    subs: Subpackage[];
    /** 所有页面的完整路径（主包 + 分包展开） */
    all: string[];
}
/** 从 app.json 数据里收集页面声明。兼容 subPackages 与 subpackages 两种写法。 */
export declare function collectPages(json: JsonValue | undefined): DeclaredPages;
export interface PageProbe {
    page: string;
    /** 必需文件（脚本 + 模板）是否齐全 */
    complete: boolean;
    missing: string[];
    optionalMissing: string[];
    files: string[];
}
export interface ScanOptions {
    /** 组件目录（相对代码根），扫描页面时跳过 */
    componentDirs: string[];
    /** 脚本扩展名，默认 ['js', 'ts'] */
    scriptExtensions?: string[];
}
/**
 * 递归找页面：以 .wxml 为锚点。
 * 排除自定义组件（同名 json 里 "component": true），否则 mp_fix 会把组件塞进 pages 把工程搞坏。
 */
export declare function scanPages(project: Project, options: ScanOptions): Promise<string[]>;
/** 探针：检查页面文件是否齐全。微信只强制要求脚本 + 模板，wxss/json 可选。 */
export declare function probePage(project: Project, pagePath: string, scriptExtensions: string[]): Promise<PageProbe>;
/** 计算目录体积（字节）。跳过依赖与隐藏缓存目录。 */
export declare function dirSize(dir: string, skipNames?: Set<string>): Promise<number>;
export declare function fmtBytes(bytes: number): string;
/**
 * 解析 usingComponents 里的组件路径。
 * 以 / 开头相对代码根，否则相对当前页面所在目录（微信的规则）。
 */
export declare function resolveComponentPath(srcRoot: string, fromPagePath: string, ref: string): string;
/** 相对代码根书写一个绝对路径（用于在报告里展示） */
export declare function relativeToSrc(project: Project, absolute: string): string;
/** 相对项目根书写（开发者工具里看到的路径） */
export declare function relativeToRoot(project: Project, absolute: string): string;
