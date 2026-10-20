/**
 * mp_devtools —— 调微信开发者工具 CLI：打开工程、出预览二维码、上传体验版、查登录态。
 *
 * 设计上有两条底线：
 *  - 绝不无限等待：IDE 冷启动、弹窗、端口没开都会让 CLI 卡住，全部走超时；
 *  - 失败要能归因：把「没装 IDE / 没登录 / 服务端口没开 / 超时」分开告诉模型，
 *    否则只会得到一句含糊的 "CLI failed"。
 */
import path from 'node:path';
import os from 'node:os';
import { mkdir } from 'node:fs/promises';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { readAppJson } from '../lib/appjson.js';
import { collectPages } from '../lib/project.js';
import { resolveProject, textOutput } from '../lib/toolkit.js';
import { checkLogin, devtoolsCandidates, explainReason, findDevtoolsCli, invoke, readInfoFile, runOpen, runPreview, runUpload, } from '../lib/devtools.js';
export function registerDevtools(ctx, config) {
    ctx.tools.register(defineTool({
        name: 'mp_devtools',
        description: 'Drive the WeChat DevTools CLI. Actions: ' +
            '"open" opens the project in the IDE, ' +
            '"preview" compiles and renders a preview QR code as a PNG file (returns the path so the model can look at it), ' +
            '"upload" uploads a version, ' +
            '"login" checks whether the IDE is logged in, ' +
            '"detect" reports which IDE/CLI was found. ' +
            'Every call is time-boxed and failures are attributed to missing IDE, missing login, or a closed service port, so you can tell the user exactly what to fix.',
        parameters: {
            action: {
                type: 'string',
                required: true,
                enum: ['detect', 'login', 'open', 'preview', 'upload'],
                description: 'What to do.',
            },
            root: { type: 'string', description: 'Project path. Omit to use the configured default.' },
            version: { type: 'string', description: 'upload: version string, e.g. "1.0.0".' },
            desc: { type: 'string', description: 'upload: version description shown in the console.' },
            timeoutSec: { type: 'number', description: 'Override the CLI timeout for this call (seconds).' },
            port: { type: 'number', description: 'IDE HTTP service port. Omit to use the configured one or let the CLI decide.' },
        },
        output: textOutput(),
        async execute(args) {
            const action = String(args.action);
            const found = await findDevtoolsCli(config.devtoolsCli);
            const timeoutMs = (typeof args.timeoutSec === 'number' && args.timeoutSec > 0 ? args.timeoutSec : config.devtoolsTimeoutSec) * 1000;
            const port = typeof args.port === 'number' ? args.port : config.devtoolsPort.trim() === '' ? undefined : Number(config.devtoolsPort);
            const token = process.env.WECHAT_DEVTOOLS_CLI_TOKEN;
            if (action === 'detect') {
                const L = [];
                if (found.cli !== '') {
                    L.push(`✅ 找到微信开发者工具 CLI：${found.cli}（${found.source === 'config' ? '来自插件设置' : '自动探测'}）`);
                    const version = await invoke(found.cli, ['--version'], { timeoutMs: 15_000 });
                    L.push(`   版本探测：${version.ok ? version.stdout.trim().split('\n')[0] : '（--version 未返回，可忽略）'}`);
                }
                else {
                    L.push('❌ 没找到微信开发者工具 CLI');
                    L.push('   找过这些位置：');
                    for (const candidate of devtoolsCandidates())
                        L.push(`     ${candidate}`);
                    L.push('   → 安装微信开发者工具，或在插件设置里把 devtoolsCli 指向 cli 可执行文件');
                }
                L.push('');
                L.push(`   当前超时设置：${timeoutMs / 1000} 秒；服务端口：${port ?? '（未指定，由 CLI 决定）'}`);
                return L.join('\n');
            }
            if (found.cli === '') {
                return [`❌ 没找到微信开发者工具 CLI。`, `   → ${explainReason('no-cli')}`, `   可用 mp_devtools（action=detect）查看探测了哪些路径`].join('\n');
            }
            if (action === 'login') {
                const result = await checkLogin(found.cli, { port, token, timeoutMs: Math.min(timeoutMs, 30_000) });
                return [
                    result.loggedIn ? '✅ 开发者工具已登录' : '❌ 开发者工具未登录（或无法确认）',
                    result.log,
                    result.loggedIn ? '' : '   → 打开微信开发者工具扫码登录后再预览/上传',
                ]
                    .filter((line) => line !== '')
                    .join('\n');
            }
            const project = await resolveProject(args.root, config);
            if (action === 'open') {
                const outcome = await runOpen(found.cli, project.root, { port, token, timeoutMs });
                const L = [outcome.ok ? `✅ 已在开发者工具中打开：${project.root}` : `❌ 打开失败：${explainReason(outcome.reason)}`, '', outcome.log];
                if (!outcome.ok && outcome.reason === 'timeout') {
                    L.push('');
                    L.push('   提示：IDE 可能正在启动。等它起来后重新调用，或先手动打开 IDE 再试。');
                }
                return L.join('\n');
            }
            if (action === 'preview') {
                // 预览前先确认页面配置没问题，否则二维码出来也是白屏
                const app = await readAppJson(project);
                const declared = collectPages(app.json);
                const warnings = [];
                if (declared.all.length === 0)
                    warnings.push('app.json 里没有声明任何页面，预览会是空白');
                const baseDir = config.previewDir.trim() !== '' ? config.previewDir.trim() : path.join(os.tmpdir(), 'dsh-mp-preview');
                await mkdir(baseDir, { recursive: true });
                const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
                const qrOutput = path.join(baseDir, `preview-${path.basename(project.root)}-${stamp}.png`);
                const infoOutput = `${qrOutput}.json`;
                const outcome = await runPreview(found.cli, { projectDir: project.root, qrOutput, infoOutput, cli: found.cli, port, token, timeoutMs });
                const info = await readInfoFile(infoOutput);
                const L = [];
                if (outcome.ok) {
                    L.push('✅ 预览编译成功');
                    L.push(`   二维码图片：${qrOutput}`);
                    L.push('   → 用手机微信扫码打开；模型可用 read_image 直接查看这张图');
                    if (info !== undefined && typeof info.qrcodeBase64 === 'string') {
                        L.push('   （CLI 同时返回了 base64 二维码，已写入 info 文件备用）');
                    }
                }
                else {
                    L.push(`❌ 预览失败：${explainReason(outcome.reason)}`);
                    if (outcome.reason === 'permission' || outcome.reason === 'ide-init') {
                        L.push('   如果 IDE 平时能正常打开，这条多半是 CLI 首次初始化需要写用户数据目录，手动打开一次 IDE 再重试即可。');
                    }
                    L.push('');
                    L.push(outcome.log);
                }
                if (warnings.length > 0) {
                    L.push('');
                    L.push(`⚠️ 预处理提示：${warnings.join('；')}`);
                    L.push('   先跑 mp_scan 检查工程配置');
                }
                return L.join('\n');
            }
            // upload
            const version = String(args.version ?? '').trim();
            const desc = String(args.desc ?? '').trim() !== '' ? String(args.desc) : `上传于 ${new Date().toLocaleString('zh-CN')}`;
            if (version === '') {
                return '❌ 上传需要 version 参数（例如 "1.0.0"）。微信要求版本号与备注都是必填。';
            }
            const infoOutput = path.join(os.tmpdir(), `dsh-mp-upload-${Date.now()}.json`);
            const outcome = await runUpload(found.cli, { projectDir: project.root, version, desc, port, token, timeoutMs, infoOutput });
            return [outcome.ok ? `✅ 已上传 ${version}（${desc}）` : `❌ 上传失败：${explainReason(outcome.reason)}`, '', outcome.log].join('\n');
        },
    }));
}
