/** 页面 / 组件 / 工程骨架模板。生成即合法的原生小程序代码。 */
export interface PageTemplateOptions {
    title: string;
    /** 是否生成 wxss（默认 true） */
    withStyle?: boolean;
    /** 是否生成页面 json（默认 true） */
    withJson?: boolean;
    /** 页面描述，写进注释里给后续维护者 */
    description?: string;
}
export declare const pageWxml: (title: string) => string;
export declare const pageWxss = ".page {\n  padding: 32rpx;\n}\n\n.title {\n  font-size: 36rpx;\n  font-weight: 600;\n  color: #1a1a1a;\n}\n";
export declare const pageJs: (title: string) => string;
export declare const pageTs: (title: string) => string;
export declare const pageJson: (title: string, usingComponents?: Record<string, string>) => string;
export declare const componentWxml: (name: string) => string;
export declare const componentWxss: (name: string) => string;
export declare const componentJs: () => string;
export declare const componentJson: () => string;
export declare const appJs: () => string;
export declare const appJson: (pages: string[], window: Record<string, unknown>) => string;
export declare const appWxss = "page {\n  background: #f6f7f9;\n  color: #1a1a1a;\n  font-size: 28rpx;\n}\n";
export declare const sitemapJson: () => string;
export declare const projectConfigJson: (input: {
    appid: string;
    miniprogramRoot: string;
    compileType?: string;
    name?: string;
}) => string;
export declare const gitignore = "node_modules/\nminiprogram_npm/\n.DS_Store\nproject.private.config.json\n";
