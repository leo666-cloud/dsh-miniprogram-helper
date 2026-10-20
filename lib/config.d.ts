/** 插件可配置项 */
import Schema from '@deepseek-ai/schemastery';
export interface Config {
    /** 默认项目根目录 */
    projectRoot: string;
    /** 生成 .ts 而非 .js */
    useTypeScript: boolean;
    /** 组件目录（可多个，逗号分隔），扫描页面时跳过 */
    componentDirs: string;
    /** 新建工程时使用的 AppID */
    appId: string;
    /** 微信开发者工具 CLI 路径，留空自动探测 */
    devtoolsCli: string;
    /** IDE 服务端口；留空由 CLI 自行决定 */
    devtoolsPort: string;
    /** CLI 超时（秒） */
    devtoolsTimeoutSec: number;
    /** 预览二维码落盘目录，留空用系统临时目录 */
    previewDir: string;
}
export declare const Config: Schema<Config>;
