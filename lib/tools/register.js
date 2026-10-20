/**
 * mp_register —— 只补注册磁盘上已存在的页面，不建文件。
 * mp_fix —— 把「磁盘上有、app.json 里没有」的页面一次性全部补进去。
 */
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { readAppJson } from '../lib/appjson.js';
import { collectPages, isFile, normalizePagePath, probePage, scanPages, subpackageOf } from '../lib/project.js';
import { mutateApp, resolveProject, scriptExtensions, textOutput } from '../lib/toolkit.js';
export function registerRegister(ctx, config) {
    ctx.tools.register(defineTool({
        name: 'mp_register',
        description: 'Register page paths that ALREADY exist on disk into app.json, without creating or touching page files. ' +
            'Use after mp_scan reports orphan pages. Paths under a declared subpackage root go to that subpackage, everything else to the main package. ' +
            'A path whose .wxml is missing is rejected instead of being registered, so a typo cannot add a dead page.',
        parameters: {
            root: { type: 'string', description: 'Project path. Omit to use the configured default.' },
            pagePaths: {
                type: 'string',
                required: true,
                description: 'Comma- or newline-separated page paths, e.g. "pages/a/index,pages/b/index". Extensions and leading slashes are tolerated.',
            },
            prepend: { type: 'boolean', description: 'Insert at the head of the main package instead of appending.' },
        },
        output: textOutput(),
        async execute(args) {
            const project = await resolveProject(args.root, config);
            const wanted = String(args.pagePaths)
                .split(/[,\n]/)
                .map((part) => part.trim())
                .filter((part) => part !== '');
            if (wanted.length === 0)
                return '❌ 没有提供页面路径（pagePaths 参数为空）';
            const candidates = [];
            const invalid = [];
            for (const rawPath of wanted) {
                try {
                    candidates.push(normalizePagePath(rawPath));
                }
                catch (error) {
                    invalid.push(`${rawPath}（${error.message}）`);
                }
            }
            // 先确认磁盘上真的有这个页面，再写 app.json —— 顺序反了会留下打不开的死页面
            const existing = [];
            const notOnDisk = [];
            for (const pagePath of candidates) {
                if (await isFile(path.join(project.srcRoot, `${pagePath}.wxml`)))
                    existing.push(pagePath);
                else
                    notOnDisk.push(pagePath);
            }
            const added = [];
            const skipped = [];
            const result = await mutateApp(project, (app) => {
                for (const pagePath of existing) {
                    const declared = collectPages(app.json);
                    if (declared.all.includes(pagePath)) {
                        skipped.push(pagePath);
                        continue;
                    }
                    const owner = subpackageOf(pagePath, declared.subs);
                    app.registerPage(pagePath, owner !== undefined ? { subpackage: owner.root } : { prepend: args.prepend === true });
                    if (collectPages(app.json).all.includes(pagePath))
                        added.push(pagePath);
                }
            });
            const incomplete = [];
            for (const pagePath of added) {
                const probe = await probePage(project, pagePath, scriptExtensions(config));
                if (!probe.complete)
                    incomplete.push(`${pagePath}（缺 ${probe.missing.join('、')}）`);
            }
            const declared = collectPages(result.app.json);
            const L = [];
            if (added.length > 0)
                L.push(`✅ 已注册 ${added.length} 个页面：${added.join('、')}`);
            if (skipped.length > 0)
                L.push(`⏭️ 已在 app.json 中，跳过：${skipped.join('、')}`);
            if (notOnDisk.length > 0) {
                L.push(`⚠️ 磁盘上没有对应的 .wxml，未注册：${notOnDisk.join('、')}`);
                L.push('   → 路径写错了，或者页面还没建：用 mp_page_add 建页面（会同时注册）');
            }
            if (invalid.length > 0)
                L.push(`❌ 路径写法不合法：${invalid.join('；')}`);
            if (incomplete.length > 0) {
                L.push(`⚠️ 已注册但缺必需文件（开发者工具里会报错）：${incomplete.join('；')}`);
                L.push('   → 用 mp_page_add 补齐缺失文件');
            }
            L.push('');
            L.push(`app.json 现有 ${declared.main.length} 个主包页面、${declared.subs.length} 个分包、共 ${declared.all.length} 个页面`);
            if (result.changed)
                L.push(`（已改写 ${path.basename(result.app.file)}，原有注释与格式保持不变）`);
            else if (added.length === 0)
                L.push('没有需要改动的内容');
            return L.join('\n');
        },
    }));
    ctx.tools.register(defineTool({
        name: 'mp_fix',
        description: 'One-click repair: find EVERY page that exists on disk but is missing from app.json (including subpackage directories) and register them all. ' +
            'Custom components are excluded, so components never get registered as pages. ' +
            'Run this after generating pages to guarantee nothing is invisible in WeChat DevTools. Idempotent.',
        parameters: {
            root: { type: 'string', description: 'Project path. Omit to use the configured default.' },
            dryRun: { type: 'boolean', description: 'Only report what would be registered; do not modify app.json.' },
        },
        output: textOutput(),
        async execute(args) {
            const project = await resolveProject(args.root, config);
            const componentDirs = config.componentDirs
                .split(',')
                .map((part) => part.trim())
                .filter((part) => part !== '');
            const disk = await scanPages(project, { componentDirs });
            const declared = collectPages((await readAppJson(project)).json);
            const orphans = disk.filter((page) => !declared.all.includes(page));
            if (orphans.length === 0) {
                return `✅ 没有孤儿页面：磁盘上的 ${disk.length} 个页面都已在 app.json 中声明`;
            }
            if (args.dryRun === true) {
                return [
                    `（dryRun）会发现 ${orphans.length} 个未注册页面：`,
                    ...orphans.map((page) => `   ${page}`),
                    '',
                    '去掉 dryRun 再跑一次即可真正写入 app.json',
                ].join('\n');
            }
            const result = await mutateApp(project, (app) => {
                for (const pagePath of orphans) {
                    const current = collectPages(app.json);
                    const owner = subpackageOf(pagePath, current.subs);
                    app.registerPage(pagePath, owner !== undefined ? { subpackage: owner.root } : {});
                }
            });
            const after = collectPages(result.app.json);
            const registeredMain = orphans.filter((page) => after.main.includes(page));
            const registeredSub = orphans.filter((page) => !after.main.includes(page) && after.all.includes(page));
            const failed = orphans.filter((page) => !after.all.includes(page));
            const L = [`✅ 已补注册 ${orphans.length - failed.length} 个孤儿页面`];
            if (registeredMain.length > 0)
                L.push(`   主包：${registeredMain.join('、')}`);
            if (registeredSub.length > 0)
                L.push(`   分包：${registeredSub.join('、')}`);
            if (failed.length > 0)
                L.push(`❌ 未能注册：${failed.join('、')}`);
            const dead = [];
            for (const pagePath of orphans) {
                const probe = await probePage(project, pagePath, scriptExtensions(config));
                if (!probe.complete)
                    dead.push(`${pagePath}（缺 ${probe.missing.join('、')}）`);
            }
            if (dead.length > 0) {
                L.push('');
                L.push(`⚠️ 这些页面虽然注册了，但缺必需文件：${dead.join('；')}`);
                L.push('   → 用 mp_page_add 补齐，否则开发者工具仍会报错');
            }
            L.push('');
            L.push(`app.json 现有 ${after.main.length} 个主包页面、${after.subs.length} 个分包、共 ${after.all.length} 个页面`);
            L.push('（原有注释与格式保持不变）');
            return L.join('\n');
        },
    }));
}
