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
export function parseMarkdownTable(content: string): TableRow[] {
  const lines = content.split('\n');
  const rows: TableRow[] = [];

  let headers: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      inTable = false;
      continue;
    }

    // Check if line is a table row (starts and ends with |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)  // Remove outer pipes
        .split('|')
        .map(cell => cell.trim());

      // Skip separator row (contains only dashes and spaces)
      if (cells.every(cell => /^[-:\s]+$/.test(cell))) {
        continue;
      }

      if (!inTable) {
        // First table row = headers
        headers = cells;
        inTable = true;
      } else {
        // Data row
        const row: TableRow = {};
        cells.forEach((cell, index) => {
          if (headers[index]) {
            row[headers[index]] = cell;
          }
        });
        rows.push(row);
      }
    } else {
      // Non-table line resets table state
      if (inTable && headers.length > 0) {
        inTable = false;
      }
    }
  }

  return rows;
}

/**
 * Find and parse the first table in markdown content
 */
export function findFirstTable(content: string): TableRow[] {
  return parseMarkdownTable(content);
}

/**
 * Parse apps.md table format
 * | アプリ名 | app_id | 所属プロジェクト | 所属組織 | ステータス | 概要 |
 */
export function parseAppsTable(content: string): Array<{
  name: string;
  app_id: string;
  project: string;
  orgs: string[];
  status: string;
  description: string;
}> {
  const rows = parseMarkdownTable(content);
  return rows.map(row => ({
    name: row['アプリ名'] || '',
    app_id: row['app_id'] || '',
    project: row['所属プロジェクト'] || '',
    orgs: (row['所属組織'] || '').split('/').map(s => s.trim()).filter(Boolean),
    status: row['ステータス'] || '',
    description: row['概要'] || '',
  }));
}

/**
 * Parse customers.md table format
 * | 顧客 | customer_id | 営業組織タグ | 実装組織タグ | プロジェクト | 契約形態メモ | 前受け | ステータス | 備考 |
 */
export function parseCustomersTable(content: string): Array<{
  name: string;
  customer_id: string;
  salesOrg: string;
  implOrg: string;
  project: string;
  contractType: string;
  upfront: string;
  status: string;
  notes: string;
}> {
  const rows = parseMarkdownTable(content);
  return rows.map(row => ({
    name: row['顧客'] || '',
    customer_id: row['customer_id'] || '',
    salesOrg: row['営業組織タグ'] || '',
    implOrg: row['実装組織タグ'] || '',
    project: row['プロジェクト'] || '',
    contractType: row['契約形態メモ'] || '',
    upfront: row['前受け'] || '',
    status: row['ステータス'] || '',
    notes: row['備考'] || '',
  }));
}

/**
 * Parse RACI table from content
 * | 項目 | R（実行） | A（説明責任） | C（相談） | I（報告） |
 */
export function parseRACITable(content: string): Array<{
  item: string;
  responsible: string;
  accountable: string;
  consulted: string;
  informed: string;
}> {
  const rows = parseMarkdownTable(content);
  return rows.map(row => ({
    item: row['項目'] || '',
    responsible: row['R（実行）'] || row['R'] || '',
    accountable: row['A（説明責任）'] || row['A'] || '',
    consulted: row['C（相談）'] || row['C'] || '',
    informed: row['I（報告）'] || row['I'] || '',
  }));
}
