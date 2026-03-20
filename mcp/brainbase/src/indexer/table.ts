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
 * Parse RACI table from content (legacy format)
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

/**
 * Parse markdown tables by section header
 * Returns a map of section name to table rows
 */
export function parseTablesBySection(content: string): Map<string, TableRow[]> {
  const result = new Map<string, TableRow[]>();
  const lines = content.split('\n');

  let currentSection = '';
  let currentTable: TableRow[] = [];
  let headers: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for section header (## ...)
    const headerMatch = trimmed.match(/^##\s+(.+)$/);
    if (headerMatch) {
      // Save previous section's table if any
      if (currentSection && currentTable.length > 0) {
        result.set(currentSection, currentTable);
      }
      currentSection = headerMatch[1];
      currentTable = [];
      headers = [];
      inTable = false;
      continue;
    }

    // Skip empty lines
    if (!trimmed) {
      inTable = false;
      continue;
    }

    // Check if line is a table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map(cell => cell.trim());

      // Skip separator row
      if (cells.every(cell => /^[-:\s]+$/.test(cell))) {
        continue;
      }

      if (!inTable) {
        headers = cells;
        inTable = true;
      } else {
        const row: TableRow = {};
        cells.forEach((cell, index) => {
          if (headers[index]) {
            row[headers[index]] = cell;
          }
        });
        currentTable.push(row);
      }
    } else {
      if (inTable && headers.length > 0) {
        inTable = false;
      }
    }
  }

  // Save last section's table
  if (currentSection && currentTable.length > 0) {
    result.set(currentSection, currentTable);
  }

  return result;
}

/**
 * Parse 立ち位置 (position) table from RACI content
 * | 人 | 資産 | 権利の範囲 |
 */
export function parsePositionTable(content: string): Array<{
  person: string;
  assets: string;
  authority: string;
}> {
  const sections = parseTablesBySection(content);
  const positionTable = sections.get('立ち位置') || [];

  return positionTable.map(row => ({
    person: row['人'] || '',
    assets: row['資産'] || '',
    authority: row['権利の範囲'] || '',
  }));
}

/**
 * Parse 決裁 (decision) table from RACI content
 * | 領域 | 決裁者 |
 */
export function parseDecisionTable(content: string): Array<{
  domain: string;
  decider: string;
}> {
  const sections = parseTablesBySection(content);
  const decisionTable = sections.get('決裁') || [];

  return decisionTable.map(row => ({
    domain: row['領域'] || '',
    decider: row['決裁者'] || '',
  }));
}

/**
 * Parse 主な担当 (assignment) table from RACI content
 * | 人 | 領域 |
 */
export function parseAssignmentTable(content: string): Array<{
  person: string;
  areas: string;
}> {
  const sections = parseTablesBySection(content);
  const assignmentTable = sections.get('主な担当（柔軟に変わる）') || sections.get('主な担当') || [];

  return assignmentTable.map(row => ({
    person: row['人'] || '',
    areas: row['領域'] || '',
  }));
}

/**
 * Parse 管轄プロダクト・ブランド list from RACI content
 */
export function parseProductsList(content: string): string[] {
  const lines = content.split('\n');
  const products: string[] = [];
  let inProductsSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for section header
    if (trimmed.startsWith('## ')) {
      inProductsSection = trimmed.includes('管轄プロダクト') || trimmed.includes('管轄ブランド');
      continue;
    }

    // Parse list items in products section
    if (inProductsSection && trimmed.startsWith('- ')) {
      const product = trimmed.slice(2).trim();
      // Remove any parenthetical notes
      const cleanProduct = product.replace(/（.*?）/g, '').trim();
      if (cleanProduct) {
        products.push(cleanProduct);
      }
    }

    // Stop at next section
    if (inProductsSection && trimmed.startsWith('#')) {
      break;
    }
  }

  return products;
}
