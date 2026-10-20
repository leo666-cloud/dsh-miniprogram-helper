/**
 * mp_page_add —— 建页面 + 自动注册 + 写完自检。
 *
 * 这是插件存在的理由：把「建文件」和「写进 app.json」做成一个原子操作。
 * 两个关键细节：
 *  - 已存在的文件默认不覆盖（force=true 才覆盖），避免抹掉用户手写的页面；
 *  - 页面路径落在分包目录里时，自动登记到该分包的 pages 而不是主包。
 */
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { readAppJson, readJsonFile } from '../lib/appjson.js';
import { mutateApp, resolveProject, scriptExtensions, textOutput, renderSelfCheck } from '../lib/toolkit.js';
import { collectPages, isFile, normalizePagePath, probePage, relativeToSrc, subpackageOf } from '../lib/project.js';
import * as tpl from '../lib/templates.js';
import { ensureTrailingNewline, writeText } from '../lib/appjson.js';
export function registerPageAdd(ctx, config) {
    ctx.tools.register(defineTool({
        name: 'mp_page_add',
        description: 'Create a WeChat Mini Program page (wxml + wxss + script + json) and register it in app.json in ONE step, then self-verify. ' +
            'Idempotent: calling twice never duplicates the app.json entry, and existing files are left untouched unless force=true. ' +
            'Pages whose path sits under a declared subpackage root are registered in that subpackage automatically. ' +
            'Use prepend=true or entry=true to make it the launch page.',
        parameters: {
            root: { type: 'string', description: 'Project path. Omit to use the configured default.' },
            pagePath: {
                type: 'string',
                required: true,
                description: 'Page path relative to the code root, e.g. "pages/detail/index". The LAST segment is the file base name (not a directory).',
            },
            title: { type: 'string', description: 'Navigation bar title. Defaults to the last path segment.' },
            prepend: { type: 'boolean', description: 'Insert at the head of app.json pages.' },
            entry: { type: 'boolean', description: 'Make this the launch page (also writes entryPagePath).' },
            force: { type: 'boolean', description: 'Overwrite files that already exist. Default false (keeps your code).' },
        },
        output: textOutput(),
        async execute(args) {
            const project = await resolveProject(args.root, config);
            const pagePath = normalizePagePath(args.pagePath);
            const base = path.join(project.srcRoot, pagePath);
            const title = (args.title ?? '').trim() !== '' ? String(args.title) : (pagePath.split('/').pop() ?? pagePath);
            const ext = config.useTypeScript ? 'ts' : 'js';
            const force = args.force === true;
            // 启动页必须在主包，先判掉再写文件
            const declaredBefore = collectPages((await readAppJson(project)).json);
            const ownerBefore = subpackageOf(pagePath, declaredBefore.subs);
            if (args.entry === true && ownerBefore !== undefined) {
                return `❌ ${pagePath} 位于分包 ${ownerBefore.root} 内，不能作为启动页（启动页必须在主包）。\n   去掉 entry 参数，或把页面改到主包目录下。`;
            }
            const files = [
                [`${base}.wxml`, tpl.pageWxml(title)],
                [`${base}.wxss`, tpl.pageWxss],
                [`${base}.${ext}`, ext === 'ts' ? tpl.pageTs(title) : tpl.pageJs(title)],
                [`${base}.json`, tpl.pageJson(title)],
            ];
            const created = [];
            const kept = [];
            for (const [file, content] of files) {
                if (!force && (await isFile(file))) {
                    kept.push(relativeToSrc(project, file));
                    continue;
                }
                await writeText(file, ensureTrailingNewline(content));
                created.push(relativeToSrc(project, file));
            }
            // 注册：路径落在分包目录里就登记到该分包，否则进主包
            const before = await mutateApp(project, (app) => {
                if (args.entry === true) {
                    app.setEntryPage(pagePath);
                    return;
                }
                const declared = collectPages(app.json);
                const owner = subpackageOf(pagePath, declared.subs);
                const prepend = args.prepend === true;
                app.registerPage(pagePath, owner !== undefined ? { subpackage: owner.root } : { prepend });
            });
            const declaredNow = collectPages(before.app.json);
            const owner = subpackageOf(pagePath, declaredNow.subs);
            const probe = await probePage(project, pagePath, scriptExtensions(config));
            const registered = declaredNow.all.includes(pagePath);
            const L = [];
            L.push(`✅ 页面 ${pagePath}`);
            L.push(created.length > 0 ? `   新建：${created.join('、')}` : `   已有文件已保留（${kept.join('、')}）`);
            if (kept.length > 0 && created.length > 0)
                L.push(`   保留：${kept.join('、')}（需要覆盖请传 force=true）`);
            L.push(registered
                ? `   app.json：已${owner !== undefined ? `登记到分包 ${owner.root}` : '写入主包 pages'}（合计 ${declaredNow.all.length} 个页面）`
                : `   app.json：❌ 注册失败`);
            if (args.entry === true)
                L.push('   已设为启动页（entryPagePath）');
            L.push('');
            L.push(renderSelfCheck({
                ok: probe.complete && registered,
                lines: [
                    probe.complete ? '页面文件齐全（脚本 + wxml + wxss + json）' : `缺文件：${probe.missing.join('、')}`,
                    registered ? '已在 app.json 中声明' : '未能在 app.json 中声明',
                ],
            }));
            if (!probe.complete || !registered) {
                L.push('   → 先修掉上面的问题；改完可用 mp_scan 复核');
            }
            return L.join('\n');
        },
    }));
}
/** 读取页面 json（用于其它工具判断组件引用） */
export async function pageJsonOf(project, pagePath) {
    const value = await readJsonFile(path.join(project.srcRoot, `${pagePath}.json`));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
