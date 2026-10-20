import { defineTool } from '@deepseek-ai/dsh-tools';
import { AppJson } from './appjson.js';
import { type Project } from './project.js';
import type { Config } from '../config.js';
/**
 * 把「可预期的用户错误」变成一句可读的提示，而不是让整个工具调用失败。
 * 模型看到失败的工具结果时容易乱猜；看到「路径不能包含 ..」这种句子才知道下一步该干嘛。
 */
export declare function guarded<A>(run: (args: A) => Promise<string>): (args: A) => Promise<string>;
/** 工具返回值统一是纯文本：模型读得懂，UI 也不需要额外的渲染器。 */
export declare function textOutput(): {
    schema: {
        type: "string";
    };
    render: (_args: unknown, value: string) => {
        type: "text";
        text: string;
    }[];
};
/** 规整路径：工具参数优先，其次插件配置。 */
export declare function resolveRootPath(given: string | undefined, config: Config): string;
/** 解析项目根：工具参数优先，其次插件配置。 */
export declare function resolveProject(given: string | undefined, config: Config): Promise<Project>;
export declare function scriptExtensions(config: Config): string[];
export interface AppWriteResult {
    app: AppJson;
    changed: boolean;
    text: string;
}
/** 读取 → 编辑 → 原子写回。changed 为 false 时不会触碰磁盘。 */
export declare function mutateApp(project: Project, mutate: (app: AppJson) => void): Promise<AppWriteResult>;
/** 相对代码根的显示路径 */
export declare function displayPath(project: Project, absolute: string): string;
/** 把「多条结果」渲染成一段列表，空列表给出提示而不是空行。 */
export declare function bulletList(items: string[], empty?: string): string;
export interface SelfCheck {
    ok: boolean;
    lines: string[];
}
/** 自检结果的统一渲染 */
export declare function renderSelfCheck(check: SelfCheck): string;
export { defineTool };
