/**
 * 微信开发者工具（IDE）的发现与 CLI 调用。
 *
 * 微信的 CLI 有几个坑，这里都处理掉：
 *  - CLI 默认要 IDE 已经打开并且开了服务端口，否则会自己拉起 IDE 然后卡住；
 *    所以这里一律给超时，并把 stderr 归并进结果，而不是让工具一直挂着。
 *  - preview 的二维码默认打到终端（ANSI 字符画），对模型毫无意义；
 *    这里固定用 --qr-output 落盘成图片，返回文件路径。
 *  - IDE 必须登录才能预览/上传，未登录时错误信息很含糊，所以单独做一次 islogin 检查。
 */
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { access, constants, mkdir, readFile, rm } from 'node:fs/promises';
/** 各平台常见的 IDE 安装位置 */
export function devtoolsCandidates() {
    if (process.platform === 'darwin') {
        return [
            '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
            '/Applications/微信开发者工具.app/Contents/MacOS/cli',
            path.join(os.homedir(), 'Applications/wechatwebdevtools.app/Contents/MacOS/cli'),
        ];
    }
    if (process.platform === 'win32') {
        const bases = [process.env.LOCALAPPDATA ?? '', process.env.ProgramFiles ?? '', process.env['ProgramFiles(x86)'] ?? ''];
        const out = [];
        for (const base of bases) {
            if (base === '')
                continue;
            out.push(path.join(base, '微信开发者工具', 'cli.bat'));
            out.push(path.join(base, 'Tencent', '微信web开发者工具', 'cli.bat'));
            out.push(path.join(base, 'Programs', '微信开发者工具', 'cli.bat'));
        }
        return out;
    }
    return [];
}
async function canExecute(file) {
    try {
        await access(file, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
/** 找到可用的 CLI：显式配置优先，其次常见安装位置 */
export async function findDevtoolsCli(configured) {
    const tried = [];
    if (configured.trim() !== '') {
        tried.push(configured);
        if (await canExecute(configured))
            return { cli: configured, source: 'config', tried };
    }
    for (const candidate of devtoolsCandidates()) {
        tried.push(candidate);
        if (await canExecute(candidate))
            return { cli: candidate, source: 'auto', tried };
    }
    return { cli: '', source: 'missing', tried };
}
/**
 * 调一次 CLI。永不抛异常：把失败也变成结构化结果，交给上层解释。
 */
export function invoke(cli, args, options = {}) {
    const timeoutMs = options.timeoutMs ?? 90_000;
    const command = [cli, ...args].map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ');
    return new Promise((resolve) => {
        execFile(cli, args, { cwd: options.cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env } }, (error, stdout, stderr) => {
            if (error === null) {
                resolve({ ok: true, code: 0, stdout: String(stdout), stderr: String(stderr), timedOut: false, command });
                return;
            }
            const err = error;
            const timedOut = err.killed === true || err.signal === 'SIGTERM';
            resolve({
                ok: false,
                code: typeof err.code === 'number' ? err.code : null,
                stdout: String(stdout ?? ''),
                stderr: String(stderr ?? err.message ?? ''),
                timedOut,
                command,
            });
        });
    });
}
const HINTS = {
    notLoggedIn: ['not logged in', '未登录', '请先登录', 'login required'],
    portClosed: ['econnrefused', 'connect failed', '服务端口', 'service port', 'http server'],
    ideInit: ['请确保 ide 已正确安装', '初始化错误', '初始化失败', 'ide 已正确安装'],
    permission: ['eperm', 'eacces', 'operation not permitted', 'permission denied'],
};
/**
 * CLI 输出里识别常见失败原因。
 * 顺序有意义：权限错误往往伴随「IDE 未正确安装」的笼统提示，
 * 但真正原因是可以修的那一条，所以先把 EPERM/EACCES 认出来。
 */
export function classifyCliFailure(result) {
    const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (result.timedOut)
        return 'timeout';
    if (HINTS.permission.some((hint) => text.includes(hint)))
        return 'permission';
    if (HINTS.ideInit.some((hint) => text.includes(hint)))
        return 'ide-init';
    if (HINTS.notLoggedIn.some((hint) => text.includes(hint)))
        return 'not-logged-in';
    if (HINTS.portClosed.some((hint) => text.includes(hint)))
        return 'port-closed';
    return 'unknown';
}
export function explainReason(reason) {
    switch (reason) {
        case 'permission':
            return '开发者工具 CLI 没有写权限（EPERM/EACCES）。常见于：IDE 用户数据目录属于别的用户、被沙箱限制、或装了多份 IDE。打开 IDE 一次让它完成初始化，或检查 ~/Library/Application Support/微信开发者工具 的权限';
        case 'ide-init':
            return '开发者工具 CLI 初始化失败：确认 IDE 能正常启动（先手动打开一次），并检查安装是否完整';
        case 'no-cli':
            return '没找到微信开发者工具 CLI。装上开发者工具，或在插件设置里填 devtoolsCli 指向 cli 可执行文件';
        case 'not-logged-in':
            return '开发者工具没有登录：打开 IDE 扫码登录后再试';
        case 'port-closed':
            return '开发者工具的「服务端口」没开：设置 → 安全设置 → 打开服务端口（CLI/HTTP 调用）';
        case 'timeout':
            return 'CLI 超时：开发者工具可能没启动，或被弹窗挡住。手动打开 IDE 后重试，或加大 timeoutSec';
        default:
            return 'CLI 返回失败，详见输出';
    }
}
/** 生成预览二维码图片 */
export async function runPreview(cli, options) {
    const qrOutput = path.resolve(options.qrOutput);
    await mkdir(path.dirname(qrOutput), { recursive: true });
    const infoOutput = options.infoOutput ?? `${qrOutput}.json`;
    const args = ['preview', '--project', path.resolve(options.projectDir), '--qr-format', 'image', '--qr-output', qrOutput, '--info-output', infoOutput, '--lang', 'zh'];
    if (options.port !== undefined)
        args.push('--port', String(options.port));
    if (options.token !== undefined && options.token !== '')
        args.push('--token', options.token);
    const result = await invoke(cli, args, { timeoutMs: options.timeoutMs });
    if (result.ok) {
        return { ok: true, qrPath: qrOutput, log: summarize(result), raw: result };
    }
    const reason = classifyCliFailure(result);
    return { ok: false, qrPath: undefined, log: summarize(result), reason, raw: result };
}
/** 上传体验版 */
export async function runUpload(cli, options) {
    const args = ['upload', '--project', path.resolve(options.projectDir), '--version', options.version, '--desc', options.desc, '--lang', 'zh'];
    if (options.infoOutput !== undefined)
        args.push('--info-output', options.infoOutput);
    if (options.port !== undefined)
        args.push('--port', String(options.port));
    if (options.token !== undefined && options.token !== '')
        args.push('--token', options.token);
    const result = await invoke(cli, args, { timeoutMs: options.timeoutMs });
    return { ok: result.ok, log: summarize(result), reason: result.ok ? undefined : classifyCliFailure(result), raw: result };
}
/** 打开 IDE 到某个项目 */
export async function runOpen(cli, projectDir, options = {}) {
    const args = ['open', '--project', path.resolve(projectDir), '--lang', 'zh'];
    if (options.port !== undefined)
        args.push('--port', String(options.port));
    if (options.token !== undefined && options.token !== '')
        args.push('--token', options.token);
    const result = await invoke(cli, args, { timeoutMs: options.timeoutMs ?? 60_000 });
    return { ok: result.ok, log: summarize(result), reason: result.ok ? undefined : classifyCliFailure(result), raw: result };
}
/** 检查 IDE 是否已登录（未登录时 preview/upload 必然失败，提前给出明确信息） */
export async function checkLogin(cli, options = {}) {
    const args = ['islogin', '--lang', 'zh'];
    if (options.port !== undefined)
        args.push('--port', String(options.port));
    if (options.token !== undefined && options.token !== '')
        args.push('--token', options.token);
    const result = await invoke(cli, args, { timeoutMs: options.timeoutMs ?? 20_000 });
    const text = `${result.stdout}\n${result.stderr}`;
    const loggedIn = result.ok && /true|已登录|logged/i.test(text) && !/false|未登录/i.test(text);
    return { loggedIn, log: summarize(result) };
}
/** 读取 CLI 写出的 info 文件（JSON），失败返回 undefined */
export async function readInfoFile(file) {
    try {
        const raw = await readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
export async function cleanup(file) {
    await rm(file, { force: true }).catch(() => { });
}
function summarize(result) {
    const out = result.stdout.trim();
    const err = result.stderr.trim();
    const parts = [`$ ${result.command}`];
    if (out !== '')
        parts.push(out.length > 2000 ? `${out.slice(0, 2000)}…` : out);
    if (err !== '')
        parts.push(`[stderr] ${err.length > 2000 ? `${err.slice(0, 2000)}…` : err}`);
    if (result.timedOut)
        parts.push('（已超时终止）');
    return parts.join('\n');
}
