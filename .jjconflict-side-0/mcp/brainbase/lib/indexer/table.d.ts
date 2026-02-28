/**
 * Markdown Table Parser
 * Parses markdown tables into structured data
 */
export interface TableRow {
    [key: string]: string;
}
/**
 * Parse a markdown table from content
 * Returns array of objects with header names as keys
 */
export declare function parseMarkdownTable(content: string): TableRow[];
/**
 * Find and parse the first table in markdown content
 */
export declare function findFirstTable(content: string): TableRow[];
/**
 * Parse apps.md table format
 * | アプリ名 | app_id | 所属プロジェクト | 所属組織 | ステータス | 概要 |
 */
export declare function parseAppsTable(content: string): Array<{
    name: string;
    app_id: string;
    project: string;
    orgs: string[];
    status: string;
    description: string;
}>;
/**
 * Parse customers.md table format
 * | 顧客 | customer_id | 営業組織タグ | 実装組織タグ | プロジェクト | 契約形態メモ | 前受け | ステータス | 備考 |
 */
export declare function parseCustomersTable(content: string): Array<{
    name: string;
    customer_id: string;
    salesOrg: string;
    implOrg: string;
    project: string;
    contractType: string;
    upfront: string;
    status: string;
    notes: string;
}>;
/**
 * Parse RACI table from content (legacy format)
 * | 項目 | R（実行） | A（説明責任） | C（相談） | I（報告） |
 */
export declare function parseRACITable(content: string): Array<{
    item: string;
    responsible: string;
    accountable: string;
    consulted: string;
    informed: string;
}>;
/**
 * Parse markdown tables by section header
 * Returns a map of section name to table rows
 */
export declare function parseTablesBySection(content: string): Map<string, TableRow[]>;
/**
 * Parse 立ち位置 (position) table from RACI content
 * | 人 | 資産 | 権利の範囲 |
 */
export declare function parsePositionTable(content: string): Array<{
    person: string;
    assets: string;
    authority: string;
}>;
/**
 * Parse 決裁 (decision) table from RACI content
 * | 領域 | 決裁者 |
 */
export declare function parseDecisionTable(content: string): Array<{
    domain: string;
    decider: string;
}>;
/**
 * Parse 主な担当 (assignment) table from RACI content
 * | 人 | 領域 |
 */
export declare function parseAssignmentTable(content: string): Array<{
    person: string;
    areas: string;
}>;
/**
 * Parse 管轄プロダクト・ブランド list from RACI content
 */
export declare function parseProductsList(content: string): string[];
