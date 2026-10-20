/**
 * 工具共用的输出与参数辅助。
 */
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { AppJson, readAppJson, writeText, ensureTrailingNewline } from './appjson.js';
import { openProject, ProjectError } from './project.js';
/**
 * 把「可预期的用户错误」变成一句可读的提示，而不是让整个工具调用失败。
 * 模型看到失败的工具结果时容易乱猜；看到「路径不能包含 ..」这种句子才知道下一步该干嘛。
 */
export function guarded(run) {
    return async (args) => {
        try {
            return await run(args);
        }
        catch (error) {
            if (error instanceof ProjectError)
                return `❌ ${error.message}`;
            const message = error instanceof Error ? error.message : String(error);
            if (/[\u4e00-\u9fa5]/.test(message))
                return `❌ ${message}`;
            throw error;
        }
    };
}
/** 工具返回值统一是纯文本：模型读得懂，UI 也不需要额外的渲染器。 */
export function textOutput() {
    return {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
    };
}
/** 规整路径：工具参数优先，其次插件配置。 */
export function resolveRootPath(given, config) {
    const root = (given ?? '').trim() !== '' ? String(given).trim() : config.projectRoot.trim();
    return root;
}
/** 解析项目根：工具参数优先，其次插件配置。 */
export async function resolveProject(given, config) {
    const root = (given ?? '').trim() !== '' ? String(given).trim() : config.projectRoot.trim();
    if (root === '') {
        throw new ProjectError('未指定小程序项目路径：在工具参数里传 root，或在插件设置里配置 projectRoot（可以是项目根目录，也可以直接是含 app.json 的代码根）');
    }
    return openProject(root);
}
export function scriptExtensions(config) {
    return config.useTypeScript ? ['ts', 'js'] : ['js', 'ts'];
}
/** 读取 → 编辑 → 原子写回。changed 为 false 时不会触碰磁盘。 */
export async function mutateApp(project, mutate) {
    const app = await readAppJson(project);
    const before = app.text;
    mutate(app);
    const changed = app.text !== before;
    if (changed)
        await writeText(app.file, ensureTrailingNewline(app.text));
    return { app, changed, text: app.text };
}
/** 相对代码根的显示路径 */
export function displayPath(project, absolute) {
    return path.relative(project.srcRoot, absolute).split(path.sep).join('/');
}
/** 把「多条结果」渲染成一段列表，空列表给出提示而不是空行。 */
export function bulletList(items, empty = '（无）') {
    return items.length > 0 ? items.map((item) => `  · ${item}`).join('\n') : `  ${empty}`;
}
/** 自检结果的统一渲染 */
export function renderSelfCheck(check) {
    return [check.ok ? '✅ 自检通过' : '❌ 自检发现问题', ...check.lines.map((line) => `   ${line}`)].join('\n');
}
export { defineTool };
