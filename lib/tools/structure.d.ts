import type { Config } from '../config.js';
export declare function registerSubpackageAdd(ctx: any, config: Config): void;
export declare function registerComponentAdd(ctx: any, config: Config): void;
/** 目录是否为空目录（供 init 复用） */
export declare function isEmptyDir(dir: string): Promise<boolean>;
