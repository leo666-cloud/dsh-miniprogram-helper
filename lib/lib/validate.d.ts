import { type AppJson } from './appjson.js';
import { collectPages, normalizePagePath, type PageProbe, type Project } from './project.js';
export type IssueLevel = 'error' | 'warn' | 'info';
export interface Issue {
    level: IssueLevel;
    code: string;
    msg: string;
    /** 修复建议 */
    fix?: string;
}
export interface PackageSize {
    name: string;
    bytes: number;
    limit: number;
}
export interface ScanReport {
    project: Project;
    pages: ReturnType<typeof collectPages>;
    probes: PageProbe[];
    orphans: string[];
    issues: Issue[];
    sizes: PackageSize[];
    totalBytes: number;
    tabBar?: {
        count: number;
        custom: boolean;
    };
}
/**
 * 收集全部问题。这个函数是 mp_scan 的核心，也被所有写操作复用做「写完自检」。
 */
export declare function scanProject(project: Project, app: AppJson, scriptExtensions: string[]): Promise<ScanReport>;
/** 把问题列表渲染成一段人读的报告（工具输出用） */
export declare function formatIssues(issues: Issue[], options?: {
    limit?: number;
}): string[];
export declare function summarize(issues: Issue[]): {
    errors: number;
    warnings: number;
    infos: number;
};
export { normalizePagePath };
