export interface KnowledgeOwnerAudit {
  schema_version: 'brainbase-knowledge-owner-audit-v1';
  source: 'Graph' | 'Personal KG' | 'Wiki互換面' | 'Brainbase';
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
  list_extension_types: {
    source: 'Graph',
    operation: '取得',
    query: () => 'extension entity types',
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
  brainbase_projects: {
    source: 'Brainbase',
    operation: '取得',
    query: () => 'プロジェクト一覧',
  },
  brainbase_bootstrap_config: {
    source: 'Brainbase',
    operation: '取得',
    query: () => '初期設定',
  },
  brainbase_admin_read: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => String(args.view ?? '管理情報'),
  },
  brainbase_run_receipt_inbox: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => String(args.project_id ?? '実行レシート受信箱'),
  },
  brainbase_run_receipt_history: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => String(args.project_id ?? '実行レシート履歴'),
  },
  brainbase_run_receipt_diagnosis: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => String(args.receipt_id ?? '実行レシート診断'),
  },
  brainbase_automation_run_detail: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => String(args.run_id ?? '自動化実行'),
  },
  brainbase_meeting_automation_diagnosis: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => String(args.project_id ?? '会議自動化診断'),
  },
  brainbase_onboarding_get: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => String(args.run_id ?? 'オンボーディング'),
  },
  brainbase_get_meeting_minutes_context: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => String(args.run_id ?? args.receipt_id ?? '議事録コンテキスト'),
  },
  authorize_tenant_resource: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => String(args.resource_id ?? args.object_type ?? 'テナント権限'),
  },
  mesh_peers: {
    source: 'Brainbase',
    operation: '取得',
    query: () => 'メッシュピア',
  },
  graph_get_plan_receipt: {
    source: 'Graph',
    operation: '取得',
    query: (args) => String(args.plan_id ?? '変更計画レシート'),
  },
  graph_validate: {
    source: 'Graph',
    operation: '取得',
    query: (args) => String(args.project_code ?? 'Graph検証'),
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
  try {
    const parsed = JSON.parse(result) as { status?: unknown; data?: unknown };
    const data = parsed && typeof parsed === 'object' ? parsed.data : undefined;
    if (toolName === 'brainbase_onboarding_get') return parsed.status === 'ok' && data === null;
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (toolName === 'brainbase_projects') return record.count === 0 && Array.isArray(record.projects) && record.projects.length === 0;
      if (['brainbase_run_receipt_inbox', 'brainbase_run_receipt_history'].includes(toolName)) {
        return Array.isArray(record.items) && record.items.length === 0;
      }
      if (toolName === 'graph_get_plan_receipt') return Array.isArray(record.receipts) && record.receipts.length === 0;
    }
  } catch {
    // Non-JSON knowledge tool responses are classified by the text patterns above.
  }
  if (toolName === 'mesh_peers' && result === '接続中のピアはありません。') return true;
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
