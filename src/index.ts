/**
 * dsh-miniprogram-helper —— DSH 插件入口。
 *
 * 让 Agent 能扫描、生成、注册、校验微信小程序页面与配置。
 * 解决的核心痛点：AI 生成小程序时最容易「文件建好了但忘记写进 app.json」，
 * 页面在开发者工具里根本打不开。这里把「建文件 + 注册」做成原子操作。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.js'
import { guarded } from './lib/toolkit.js'
import { registerScan } from './tools/scan.js'
import { registerPageAdd } from './tools/page-add.js'
import { registerRegister } from './tools/register.js'
import { registerPageRemove, registerEntrySet } from './tools/page-remove.js'
import { registerSubpackageAdd, registerComponentAdd } from './tools/structure.js'
import { registerTabbar } from './tools/tabbar.js'
import { registerProjectInit } from './tools/project-init.js'
import { registerDevtools } from './tools/devtools.js'

export const name = 'miniprogram-helper'

/** Cordis 的 ctx 是 Proxy：没声明的服务一访问就抛异常，不是返回 undefined。 */
export const inject = ['tools']

export { Config }
export type { Config as MiniprogramHelperConfig } from './config.js'

export const TOOL_NAMES = [
  'mp_scan',
  'mp_page_add',
  'mp_page_remove',
  'mp_entry_set',
  'mp_register',
  'mp_fix',
  'mp_subpackage_add',
  'mp_component_add',
  'mp_tabbar',
  'mp_project_init',
  'mp_devtools',
] as const

export function apply(ctx: Context, config: Config): void {
  // 统一兜底：路径写错、工程不存在这类「用户可预期」的错误，
  // 变成一句可读的 ❌ 提示返回给模型，而不是让整个工具调用抛异常。
  const registerWithGuard = (tool: { execute: (...args: any[]) => Promise<unknown>; [key: string]: unknown }) =>
    ctx.tools.register({ ...tool, execute: guarded(tool.execute as any) } as any)

  const scoped = { tools: { register: registerWithGuard } } as unknown as Context
  registerScan(scoped, config)
  registerPageAdd(scoped, config)
  registerPageRemove(scoped, config)
  registerEntrySet(scoped, config)
  registerRegister(scoped, config)
  registerSubpackageAdd(scoped, config)
  registerComponentAdd(scoped, config)
  registerTabbar(scoped, config)
  registerProjectInit(scoped, config)
  registerDevtools(scoped, config)
  ctx.logger?.info?.(`[miniprogram-helper] 已注册 ${TOOL_NAMES.length} 个工具：${TOOL_NAMES.join(' / ')}`)
}
