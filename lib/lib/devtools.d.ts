export interface CliResult {
    ok: boolean;
    code: number | null;
    stdout: string;
    stderr: string;
    /** 超时被杀 */
    timedOut: boolean;
    command: string;
}
/** 各平台常见的 IDE 安装位置 */
export declare function devtoolsCandidates(): string[];
/** 找到可用的 CLI：显式配置优先，其次常见安装位置 */
export declare function findDevtoolsCli(configured: string): Promise<{
    cli: string;
    source: string;
    tried: string[];
}>;
export interface InvokeOptions {
    /** 超时毫秒；IDE 冷启动可能很慢，默认给 90 秒 */
    timeoutMs?: number;
    cwd?: string;
}
/**
 * 调一次 CLI。永不抛异常：把失败也变成结构化结果，交给上层解释。
 */
export declare function invoke(cli: string, args: string[], options?: InvokeOptions): Promise<CliResult>;
export interface PreviewOptions {
    projectDir: string;
    /** 二维码图片输出路径 */
    qrOutput: string;
    /** 附带信息文件输出路径 */
    infoOutput?: string;
    /** 编译前不看缓存 */
    cli: string;
    port?: number;
    token?: string;
    timeoutMs?: number;
}
export type PreviewFailure = 'not-logged-in' | 'port-closed' | 'timeout' | 'no-cli' | 'ide-init' | 'permission' | 'unknown';
export interface PreviewOutcome {
    ok: boolean;
    qrPath?: string;
    log: string;
    /** 归因：未登录 / 端口未开 / 超时 / IDE 未初始化 / 无权限 / 其它 */
    reason?: PreviewFailure;
    raw: CliResult | string;
}
/**
 * CLI 输出里识别常见失败原因。
 * 顺序有意义：权限错误往往伴随「IDE 未正确安装」的笼统提示，
 * 但真正原因是可以修的那一条，所以先把 EPERM/EACCES 认出来。
 */
export declare function classifyCliFailure(result: CliResult): PreviewFailure | undefined;
export declare function explainReason(reason: PreviewFailure | undefined): string;
/** 生成预览二维码图片 */
export declare function runPreview(cli: string, options: PreviewOptions): Promise<PreviewOutcome>;
/** 上传体验版 */
export declare function runUpload(cli: string, options: {
    projectDir: string;
    version: string;
    desc: string;
    port?: number;
    token?: string;
    timeoutMs?: number;
    infoOutput?: string;
}): Promise<PreviewOutcome>;
/** 打开 IDE 到某个项目 */
export declare function runOpen(cli: string, projectDir: string, options?: {
    port?: number;
    token?: string;
    timeoutMs?: number;
}): Promise<PreviewOutcome>;
/** 检查 IDE 是否已登录（未登录时 preview/upload 必然失败，提前给出明确信息） */
export declare function checkLogin(cli: string, options?: {
    port?: number;
    token?: string;
    timeoutMs?: number;
}): Promise<{
    loggedIn: boolean;
    log: string;
}>;
/** 读取 CLI 写出的 info 文件（JSON），失败返回 undefined */
export declare function readInfoFile(file: string): Promise<Record<string, unknown> | undefined>;
export declare function cleanup(file: string): Promise<void>;
