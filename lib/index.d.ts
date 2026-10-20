/**
 * dsh-miniprogram-helper —— DSH 插件入口。
 *
 * 让 Agent 能扫描、生成、注册、校验微信小程序页面与配置。
 * 解决的核心痛点：AI 生成小程序时最容易「文件建好了但忘记写进 app.json」，
 * 页面在开发者工具里根本打不开。这里把「建文件 + 注册」做成原子操作。
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.js';
export declare const name = "miniprogram-helper";
/** Cordis 的 ctx 是 Proxy：没声明的服务一访问就抛异常，不是返回 undefined。 */
export declare const inject: string[];
export { Config };
export type { Config as MiniprogramHelperConfig } from './config.js';
export declare const TOOL_NAMES: readonly ["mp_scan", "mp_page_add", "mp_page_remove", "mp_entry_set", "mp_register", "mp_fix", "mp_subpackage_add", "mp_component_add", "mp_tabbar", "mp_project_init", "mp_devtools"];
export declare function apply(ctx: Context, config: Config): void;
