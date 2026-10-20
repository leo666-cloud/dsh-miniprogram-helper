import type { Config } from '../config.js';
export declare function registerProjectInit(ctx: any, config: Config): void;
/** 读取文件内容（MP 工具内部使用） */
export declare function readTextFile(file: string): Promise<string>;
