import { extractEvidence, bodyEvidenceFields } from '../retrieval/evidence.js';

export interface KnowledgeOwnerAudit {
  schema_version: 'brainbase-knowledge-owner-audit-v1';
  source: 'Graph' | 'Personal KG' | 'Wiki互換面' | 'Brainbase';
  operation: '検索' | '取得' | '登録';
  query: string;
  outcome: '結果を取得' | '該当なし（不在確定ではない）';
  display_line: string;
  retrieval?: ReturnType<typeof buildRetrievalEvidence>;
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
  register_personal_kg: {
    source: 'Personal KG',
    operation: '登録',
    query: (args) => {
      const event = args.event && typeof args.event === 'object' && !Array.isArray(args.event)
        ? args.event as Record<string, unknown>
        : {};
      return String(event.event_id ?? event.body_hash ?? '個人記憶');
    },
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
  brainbase_get_shareable_person_profile: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => String(args.target_slack_user_id ?? '人物プロフィール'),
  },
  brainbase_knowledge_retrieve: {
    source: 'Brainbase',
    operation: '取得',
    query: (args) => {
      const project = typeof args.project_code === 'string' ? args.project_code : '';
      const refs = Array.isArray(args.refs)
        ? args.refs.flatMap((ref) => {
            if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return [];
            const value = ref as Record<string, unknown>;
            if (typeof value.id !== 'string' || typeof value.version !== 'string') return [];
            return [`${value.id}@${value.version}`];
          })
        : [];
      return [project, refs.join(', ')].filter(Boolean).join(' / ') || '知識';
    },
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

function isStructuredFailure(result: string): boolean {
  try {
    const parsed = JSON.parse(result) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const status = (parsed as Record<string, unknown>).status;
    return typeof status === 'string'
      && ['error', 'unavailable', 'partial', 'failed', 'failure', 'unknown'].includes(status);
  } catch {
    return false;
  }
}

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
      if (toolName === 'search') return Array.isArray(record.candidates) && record.candidates.length === 0;
      if (toolName === 'brainbase_knowledge_retrieve') {
        return Array.isArray(record.results)
          && record.results.length > 0
          && record.results.every((item) => item && typeof item === 'object'
            && !Array.isArray(item) && (item as Record<string, unknown>).status === 'not_found');
      }
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
  entity?: unknown,
): KnowledgeOwnerAudit | null {
  const target = TARGETS[toolName];
  if (!target) return null;
  if (isStructuredFailure(result)) return null;

  const query = sanitizeQuery(target.query(args));
  const operation = typeof target.operation === 'function' ? target.operation(args) : target.operation;
  const outcome: KnowledgeOwnerAudit['outcome'] = isNoResult(toolName, result)
    ? '該当なし（不在確定ではない）'
    : '結果を取得';
  const success = outcome === '結果を取得' ? ' ✓' : '';
  const action = operation === '検索'
    ? `${target.source}で「${query}」を検索`
    : operation === '登録'
      ? `${target.source}へ「${query}」を登録`
    : `${target.source}から「${query}」を取得`;

  return {
    ...(toolName === 'search' || toolName === 'search_personal_kg'
      || toolName === 'brainbase_knowledge_retrieve'
      || (toolName === 'get_entity' && entity !== undefined)
      ? { retrieval: buildRetrievalEvidence(toolName, result, entity) } : {}),
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
    text: `<!-- brainbase-knowledge-owner-audit:${JSON.stringify({
      schema_version: audit.schema_version,
      operation: audit.operation,
      outcome: audit.outcome,
      ...(audit.retrieval ? { retrieval: audit.retrieval } : {}),
    })} -->`,
  });
  return content;
}

function buildRetrievalEvidence(tool: string, result: string, entity?: unknown) {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(result) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const parsedRecord = parsed as Record<string, unknown>;
      data = parsedRecord.data && typeof parsedRecord.data === 'object' && !Array.isArray(parsedRecord.data)
        ? parsedRecord.data as Record<string, unknown>
        : parsedRecord;
    }
  } catch { /* get_entity is rendered text */ }
  const personalKgCandidates = tool === 'search_personal_kg'
    ? Array.from(result.matchAll(/^- \*\*\[[^\]]+\]\*\*\s+(.+)\r?\n\s+_\(([^\r\n]+?)\s+·\s+([^\r\n]+?)\s+·\s+([^\r\n)]+)\)_$/gmu), (match) => ({
      id: match[4].trim(), entity_type: 'personal_kg', evidence: { body: match[1].trim() },
    }))
    : [];
  const personalKgNoResult = tool === 'search_personal_kg' && isNoResult(tool, result);
  const known = tool === 'get_entity'
    || (tool === 'search_personal_kg' && (personalKgNoResult || personalKgCandidates.length > 0))
    || (data && Array.isArray(data.candidates))
    || (tool === 'brainbase_knowledge_retrieve' && Array.isArray(data.results));
  const candidates = tool === 'search' ? (Array.isArray(data.candidates) ? data.candidates : [])
    : tool === 'search_personal_kg' ? personalKgCandidates
    : tool === 'brainbase_knowledge_retrieve' ? (Array.isArray(data.results) ? data.results : [])
    : entity && typeof entity === 'object' ? [entity] : [];
  const references = candidates.flatMap((candidate: Record<string, unknown>) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const id = candidate.id;
    if (typeof id !== 'string' || !id.trim()) return [];
    if (tool === 'brainbase_knowledge_retrieve') {
      const source = candidate.source && typeof candidate.source === 'object' && !Array.isArray(candidate.source)
        ? candidate.source as Record<string, unknown>
        : {};
      const requestedVersion = candidate.requested_version;
      const resolvedVersion = candidate.resolved_version;
      const receipt = candidate.retrieval_receipt_id;
      const resolved = candidate.status === 'resolved'
        && typeof requestedVersion === 'string' && requestedVersion.trim().length > 0
        && typeof resolvedVersion === 'string' && resolvedVersion.trim().length > 0
        && resolvedVersion === requestedVersion
        && typeof candidate.content === 'string' && candidate.content.trim().length > 0
        && typeof source.kind === 'string' && source.kind.trim().length > 0
        && typeof receipt === 'string' && receipt.trim().length > 0;
      return [{
        id: id.trim(),
        entity_type: String(candidate.entity_type ?? candidate.type ?? 'unknown'),
        evidence_status: resolved ? 'present' : 'missing',
        evidence_fields: resolved ? ['content'] : [],
        ...(typeof candidate.version === 'string' && candidate.version.trim()
          ? { version: candidate.version }
          : {}),
        ...(typeof requestedVersion === 'string' && requestedVersion.trim()
          ? { requested_version: requestedVersion }
          : {}),
        ...(typeof resolvedVersion === 'string' && resolvedVersion.trim()
          ? { resolved_version: resolvedVersion }
          : {}),
        ...(typeof receipt === 'string' && receipt.trim()
          ? { retrieval_receipt_id: receipt }
          : {}),
      }];
    }
    const raw = (tool === 'search' || tool === 'search_personal_kg' ? candidate.evidence : candidate.retrieval_evidence)
      ?? (tool === 'get_entity' ? candidate : {});
    const evidence = extractEvidence(raw && typeof raw === 'object' ? raw as Record<string, unknown> : {});
    const fields = bodyEvidenceFields(evidence);
    return [{ id, entity_type: String(candidate.entity_type ?? candidate.type ?? 'unknown'),
      evidence_status: fields.length ? 'present' : 'missing', evidence_fields: fields }];
  });
  const coverage = tool === 'get_entity' || tool === 'brainbase_knowledge_retrieve' ? 'complete'
    : ['complete', 'partial', 'unknown'].includes(String(data.coverage)) ? data.coverage : 'unknown';
  const status = !known ? 'unknown' : references.length ? 'retrieved' : 'empty';
  return { status, coverage,
    sufficiency: status === 'unknown' && tool === 'search_personal_kg' ? 'unknown'
      : references.some((ref) => ref.evidence_status === 'present') ? 'needs_model_verification' : 'insufficient',
    references, absence_confirmed: false };
}
