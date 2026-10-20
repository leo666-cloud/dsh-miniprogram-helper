/**
 * mp_project_init —— 从零生成一个能直接用开发者工具打开的小程序工程。
 *
 * 生成的是「项目根 + miniprogramRoot」的标准结构（和微信官方 quickstart 模板一致），
 * 因为很多团队真的这么放：项目根里有 README、node_modules、CI 配置，代码在 miniprogram/ 里。
 */
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ensureTrailingNewline, writeText } from '../lib/appjson.js';
import { isDir, isFile, normalizeRelative } from '../lib/project.js';
import { resolveRootPath, textOutput, scriptExtensions } from '../lib/toolkit.js';
import { openProject } from '../lib/project.js';
import { scanProject } from '../lib/validate.js';
import { readAppJson } from '../lib/appjson.js';
import * as tpl from '../lib/templates.js';
export function registerProjectInit(ctx, config) {
    ctx.tools.register(defineTool({
        name: 'mp_project_init',
        description: 'Scaffold a brand-new native WeChat Mini Program project at the given directory: project.config.json (with miniprogramRoot), app.json/app.js/app.wxss, sitemap.json, and a first page. ' +
            'Refuses to touch a directory that already holds a mini program (app.json) unless force=true, so it can never clobber an existing project. ' +
            'After scaffolding it opens the result with the same checks mp_scan uses.',
        parameters: {
            root: { type: 'string', description: 'Directory to create the project in. Defaults to the configured projectRoot. Omit both to be asked.' },
            appId: { type: 'string', description: 'Mini Program AppID. Defaults to the configured appId, else the touristappid placeholder.' },
            name: { type: 'string', description: 'Project name used in project.config.json. Defaults to the directory name.' },
            miniprogramRoot: {
                type: 'string',
                description: 'Where the mini program code lives relative to the project root, e.g. "miniprogram". Default "miniprogram"; pass "." to put app.json at the project root.',
            },
            firstPage: { type: 'string', description: 'First page path relative to the code root. Default "pages/index/index".' },
            title: { type: 'string', description: 'Navigation bar title of the first page. Default "首页".' },
            force: { type: 'boolean', description: 'Scaffold even if an app.json already exists (only fills in missing files).' },
        },
        output: textOutput(),
        async execute(args) {
            const rootArg = String(args.root ?? '').trim() !== '' ? String(args.root) : config.projectRoot;
            if (rootArg.trim() === '') {
                return [
                    '❌ 没指定要建在哪里。',
                    '   请传 root（例如 "~/Documents/miniprogram-demo"），或在插件设置里配置 projectRoot。',
                ].join('\n');
            }
            const root = path.resolve(rootArg.trim().replace(/^~(?=$|[/\\])/, process.env.HOME ?? '~'));
            const name = String(args.name ?? '').trim() !== '' ? String(args.name) : path.basename(root);
            const appId = String(args.appId ?? '').trim() !== '' ? String(args.appId) : config.appId.trim() !== '' ? config.appId.trim() : 'touristappid';
            let mpRoot;
            const rawMpRoot = String(args.miniprogramRoot ?? '').trim();
            if (rawMpRoot === '' || rawMpRoot === '.')
                mpRoot = rawMpRoot === '.' ? '' : 'miniprogram';
            else {
                try {
                    mpRoot = normalizeRelative(rawMpRoot);
                }
                catch (error) {
                    return `❌ miniprogramRoot 不合法：${error.message}`;
                }
            }
            const srcRoot = mpRoot === '' ? root : path.join(root, mpRoot);
            let firstPage;
            try {
                firstPage = normalizePagePathSafe(String(args.firstPage ?? '').trim() === '' ? 'pages/index/index' : String(args.firstPage));
            }
            catch (error) {
                return `❌ firstPage 不合法：${error.message}`;
            }
            const title = String(args.title ?? '').trim() !== '' ? String(args.title) : '首页';
            if (await isFile(path.join(srcRoot, 'app.json'))) {
                if (args.force !== true) {
                    return [
                        `❌ ${srcRoot} 下已经有 app.json，看起来已经是一个小程序工程了。`,
                        '   为安全起见没有改动任何文件。要在这个工程上继续开发，直接用 mp_scan 体检。',
                        '   确实想只补缺失文件，请带 force=true。',
                    ].join('\n');
                }
            }
            else if (!(await isDir(root))) {
                await writeText(path.join(root, '.keep'), '');
            }
            else if ((await readdir(root)).filter((entry) => entry !== '.DS_Store').length > 0) {
                if (args.force !== true) {
                    return [
                        `❌ ${root} 不是空目录，且里面没有 app.json。`,
                        '   为了不把工程文件混进你已有的项目，已停止。换一个空目录，或确认后带 force=true。',
                    ].join('\n');
                }
            }
            const created = [];
            const write = async (absolute, content) => {
                if (await isFile(absolute))
                    return;
                await writeText(absolute, ensureTrailingNewline(content));
                created.push(path.relative(root, absolute).split(path.sep).join('/'));
            };
            const ext = config.useTypeScript ? 'ts' : 'js';
            // 代码根
            await write(path.join(srcRoot, 'app.json'), tpl.appJson([firstPage], { navigationBarTitleText: '小程序', navigationBarBackgroundColor: '#ffffff', navigationBarTextStyle: 'black', backgroundColor: '#f6f7f9' }));
            await write(path.join(srcRoot, 'app.js'), tpl.appJs());
            await write(path.join(srcRoot, 'app.wxss'), tpl.appWxss);
            await write(path.join(srcRoot, 'sitemap.json'), tpl.sitemapJson());
            await write(path.join(srcRoot, `${firstPage}.wxml`), tpl.pageWxml(title));
            await write(path.join(srcRoot, `${firstPage}.wxss`), tpl.pageWxss);
            await write(path.join(srcRoot, `${firstPage}.${ext}`), ext === 'ts' ? tpl.pageTs(title) : tpl.pageJs(title));
            await write(path.join(srcRoot, `${firstPage}.json`), tpl.pageJson(title));
            // 项目根
            await write(path.join(root, 'project.config.json'), tpl.projectConfigJson({ appid: appId, miniprogramRoot: mpRoot, name }));
            await write(path.join(root, '.gitignore'), tpl.gitignore);
            await write(path.join(root, 'README.md'), [
                `# ${name}`,
                '',
                '微信小程序工程（由 dsh-miniprogram-helper 生成）。',
                '',
                '## 打开方式',
                '',
                '1. 打开微信开发者工具 → 导入项目',
                `2. 目录选择：\`${root}\``,
                mpRoot === '' ? '3. 代码根就是项目根（app.json 在根目录）' : `3. 代码在 \`${mpRoot}/\` 下（app.json 在那里），project.config.json 里的 miniprogramRoot 已配好`,
                '',
                '## 目录结构',
                '',
                '```',
                `${mpRoot === '' ? '' : `${mpRoot}/\n`}├── app.json        # 全局配置：页面注册、窗口样式、tabBar`,
                '├── app.js          # 应用入口',
                '├── app.wxss        # 全局样式',
                '├── sitemap.json    # 搜索索引配置',
                `└── ${firstPage.split('/').slice(0, -1).join('/') || '.'}/`,
                `    └── ${firstPage.split('/').pop()}.{wxml,wxss,${ext},json}`,
                '```',
                '',
                '## 提示',
                '',
                '- 新建页面用 `mp_page_add`，它会同时写进 app.json —— 手写页面最容易忘的一步。',
                '- 改完跑 `mp_scan` 体检，`mp_fix` 补注册漏掉的页面。',
            ].join('\n'));
            // 用体检做一次交付自检
            const project = await openProject(root);
            const app = await readAppJson(project);
            const report = await scanProject(project, app, scriptExtensions(config));
            const errors = report.issues.filter((issue) => issue.level === 'error');
            const L = [`✅ 已生成小程序工程：${root}`];
            L.push(`   代码根：${srcRoot}${mpRoot === '' ? '（app.json 直接在项目根）' : `（miniprogramRoot: ${mpRoot}）`}`);
            L.push(`   新建 ${created.length} 个文件：`);
            for (const file of created)
                L.push(`     ${file}`);
            L.push('');
            L.push(`   启动页：${firstPage}（导航标题「${title}」）`);
            L.push(`   AppID：${appId}${appId === 'touristappid' ? '（占位值，开发者工具里会以测试模式打开；正式开发请填真实 AppID）' : ''}`);
            L.push('');
            L.push(errors.length === 0 ? '✅ 自检通过：工程结构完整，可以直接用开发者工具导入' : `❌ 自检发现 ${errors.length} 个错误：`);
            for (const issue of errors)
                L.push(`   ${issue.msg}`);
            L.push('');
            L.push('下一步：');
            L.push('  · 在微信开发者工具里「导入项目」，目录选上面的项目根');
            L.push('  · 用 mp_page_add 加页面，mp_tabbar 配底部导航');
            L.push('  · 想直接看预览二维码：mp_devtools（action=preview）');
            return L.join('\n');
        },
    }));
}
function normalizePagePathSafe(input) {
    const cleaned = input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const segments = cleaned.split('/').filter((segment) => segment !== '' && segment !== '.');
    for (const segment of segments) {
        if (segment === '..')
            throw new Error('路径不能包含 ..');
    }
    return segments.join('/');
}
/** 读取文件内容（MP 工具内部使用） */
export async function readTextFile(file) {
    return readFile(file, 'utf8');
}
