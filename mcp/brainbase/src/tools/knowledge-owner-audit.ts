export interface KnowledgeOwnerAudit {
  schema_version: 'brainbase-knowledge-owner-audit-v1';
  source: 'Graph' | 'Personal KG' | 'Wiki互換面';
  operation: '検索' | '取得';
  query: string;
  outcome: '結果を取得' | '該当なし（不在確定ではない）';
  display_line: string;
}

export interface KnowledgeToolTextContent {
  type: 'text';
  text: string;
}

interface AuditTarget {
  source: KnowledgeOwnerAudit['source'];
  operation: KnowledgeOwnerAudit['operation'] | ((args: Record<string, unknown>) => KnowledgeOwnerAudit['operation']);
  query: (args: Record<string, unknown>) => string;
}

const TARGETS: Record<string, AuditTarget> = {
  get_context: {
    source: 'Graph',
    operation: '取得',
    query: (args) => String(args.topic ?? ''),
  },
  list_entities: {
    source: 'Graph',
    operation: '取得',
    query: (args) => String(args.type ?? 'entities'),
  },
  get_entity: {
    source: 'Graph',
    operation: '取得',
    query: (args) => `${String(args.type ?? 'entity')}/${String(args.id ?? '')}`,
  },
  list_extension_entities: {
    source: 'Graph',
    operation: (args) => typeof args.query === 'string' && args.query.trim() ? '検索' : '取得',
    query: (args) => String(args.query ?? args.type ?? 'extension entities'),
  },
  search: {
    source: 'Graph',
    operation: '検索',
    query: (args) => String(args.query ?? ''),
  },
  resolve_entity: {
    source: 'Graph',
    operation: '検索',
    query: (args) => String(args.query ?? ''),
  },
  search_personal_kg: {
    source: 'Personal KG',
    operation: '検索',
    query: (args) => String(args.query ?? ''),
  },
  search_wiki: {
    source: 'Wiki互換面',
    operation: '検索',
    query: (args) => String(args.query ?? ''),
  },
  get_wiki_page: {
    source: 'Wiki互換面',
    operation: '取得',
    query: (args) => String(args.path ?? ''),
  },
};

const NO_RESULT = /(?:\bNo (?:results|context|personal KG entries|extension entities|wiki pages)|Entity not found)/iu;
const QUERY_LIMIT = 40;

function isNoResult(toolName: string, result: string): boolean {
  if (NO_RESULT.test(result)) return true;
  if (toolName === 'list_entities' && /^# .* entities \(0\)$/mu.test(result)) return true;
  if (toolName === 'resolve_entity') {
    try {
      const parsed = JSON.parse(result) as { candidates?: unknown };
      return Array.isArray(parsed.candidates) && parsed.candidates.length === 0;
    } catch {
      return false;
    }
  }
  return false;
}

function sanitizeQuery(value: string): string {
  const redacted = value
    .replace(/\b(token|api[_-]?key|secret|password)\s*=\s*[^\s]+/giu, '$1=[秘密情報]')
    .replace(/[「」\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const points = Array.from(redacted || '対象未指定');
  return points.length > QUERY_LIMIT
    ? `${points.slice(0, QUERY_LIMIT).join('')}…`
    : points.join('');
}

export function buildKnowledgeOwnerAudit(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
): KnowledgeOwnerAudit | null {
  const target = TARGETS[toolName];
  if (!target) return null;

  const query = sanitizeQuery(target.query(args));
  const operation = typeof target.operation === 'function' ? target.operation(args) : target.operation;
  const outcome: KnowledgeOwnerAudit['outcome'] = isNoResult(toolName, result)
    ? '該当なし（不在確定ではない）'
    : '結果を取得';
  const success = outcome === '結果を取得' ? ' ✓' : '';
  const action = operation === '検索'
    ? `${target.source}で「${query}」を検索`
    : `${target.source}から「${query}」を取得`;

  return {
    schema_version: 'brainbase-knowledge-owner-audit-v1',
    source: target.source,
    operation,
    query,
    outcome,
    display_line: `📚 Brainbase${operation}: ${action} → ${outcome}${success}`,
  };
}

export function buildKnowledgeToolContent(
  result: string,
  audit: KnowledgeOwnerAudit | null,
): KnowledgeToolTextContent[] {
  const content: KnowledgeToolTextContent[] = [{ type: 'text', text: result }];
  if (!audit) return content;

  content.push({
    type: 'text',
    text: [
      'Brainbase retrieval audit: reproduce the next line exactly once in the next user-facing assistant message.',
      'Do not merge it with the turn-level Judgment audit and do not repeat it without another tool call.',
      audit.display_line,
    ].join('\n'),
  });
  return content;
}
