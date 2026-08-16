import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

type Environment = Record<string, string | undefined>;

export interface ConversationMessage {
  sequence?: number;
  turn_id?: string | null;
  role: 'user' | 'assistant';
  phase?: string | null;
  text: string;
}

export interface JudgmentHookPayload {
  hook_event_name?: string;
  hookEventName?: string;
  prompt?: string;
  session_id?: string;
  turn_id?: string;
  transcript_path?: string;
  cwd?: string;
  model?: string;
  permission_mode?: string;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  last_assistant_message?: string;
}

export interface JudgmentRequest {
  request: string;
  turn_id: string;
  project_code?: string;
  conversation_context: {
    schema_version: 'brainbase-conversation-context-v1';
    session_ref: string;
    messages: Required<ConversationMessage>[];
    prior_receipts: Array<Record<string, unknown>>;
    runtime: {
      host: string;
      model: string | null;
      permission_mode: string | null;
      project_binding: string | null;
    };
    instruction_bindings: Array<{ scope: string; source_ref: string; digest: string }>;
    completeness: 'complete' | 'partial';
    source_digest: string;
  };
}

export interface JudgmentClassification {
  intent: 'answer' | 'investigate' | 'diagnose' | 'design' | 'implement' | 'review' | 'operate';
  domains: Array<'general' | 'knowledge' | 'engineering' | 'organization' | 'operations' | 'personal_judgment'>;
  confidence: 'confirmed' | 'inferred';
}

export interface JudgmentNodeDefinition {
  id: string;
  kind: 'common' | 'judgment' | 'constraint' | 'clarification';
  instruction: string;
}

export interface JudgmentReceipt {
  resolution_id: string;
  resolved_at: string;
  turn_id: string;
  request_digest: string;
  context_digest: string;
  plan_digest: string;
  status: 'resolved' | 'needs_clarification';
  runtime_version: string;
  manifest_digest: string;
  host_binding: {
    adapter_id: 'brainbase-local';
    adapter_version: '1';
    status: 'managed';
    enforcement_level: 'host_contract';
  };
  project_code?: string;
  classification: JudgmentClassification | null;
  classification_evidence: {
    source: 'current_request' | 'prior_message' | 'prior_receipt' | 'resolver';
    source_turn_ids: string[];
    matcher_ids: string[];
  };
  reconciliation_reasons: string[];
  selected_dag_ids: string[];
  applicable_policies: Array<{ id: string; instruction: string }>;
  active_nodes: string[];
  active_edges: Array<[string, string]>;
  active_node_definitions: JudgmentNodeDefinition[];
  unresolved: string[];
  rationale: string[];
}

export interface JudgmentHookOutput {
  continue: true;
  suppressOutput: true;
  receipt: JudgmentReceipt;
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit';
    additionalContext: string;
  };
}

export interface JudgmentHostOptions {
  env?: Environment;
  resolver?: (request: JudgmentRequest) => Promise<JudgmentReceipt>;
  trustedConversationMessages?: ConversationMessage[];
}

interface LocalResolverOptions {
  now?: () => Date;
  id?: () => string;
}

export interface JudgmentOwnerAudit {
  schema_version: 'brainbase-owner-audit-v1';
  renderer_version: '1';
  locale: 'ja-JP';
  historical_exact: boolean;
  source_receipt_digest: string;
  source_kind: 'current_request' | 'prior_turn' | 'prior_turn_fallback' | 'prior_turn_unavailable';
  source_turn_ids: string[];
  source_excerpt: string;
  decision: string;
  display_line: string;
  text_digest: string;
}

interface JudgmentAdoptionEntry {
  schema_version: 'brainbase-judgment-adoption-v1' | 'brainbase-judgment-adoption-v2';
  accepted_at: string;
  request_text_digest: string;
  request: JudgmentRequest;
  receipt: JudgmentReceipt;
  receipt_digest?: string;
  owner_audit: JudgmentOwnerAudit;
}

export interface JudgmentEpisode {
  schema_version: 'brainbase-judgment-episode-v1';
  session_ref: string;
  turn_id: string;
  started_at: string;
  request_text_digest: string;
  initial_receipt_digest: string;
  adoption: JudgmentAdoptionEntry;
  episode_digest: string;
}

export interface JudgmentToolEvent {
  schema_version: 'brainbase-judgment-tool-event-v1';
  session_ref: string;
  turn_id: string;
  sequence: number;
  recorded_at: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  event_fingerprint: string;
  event_digest: string;
}

export interface JudgmentFinalReceipt {
  schema_version: 'brainbase-judgment-final-v1';
  session_ref: string;
  turn_id: string;
  finalized_at: string;
  initial_receipt_digest: string;
  event_count: number;
  event_set_digest: string;
  answer_digest: string;
  final_digest: string;
}

const RUNTIME_VERSION = 'portable-judgment-runtime-1.0.0';

const NODES: Record<string, JudgmentNodeDefinition> = {
  entry: { id: 'entry', kind: 'common', instruction: 'Enter once for this managed turn.' },
  reconcile: { id: 'reconcile', kind: 'common', instruction: 'Classify the current request from canonical conversation context.' },
  goal: { id: 'goal', kind: 'judgment', instruction: 'Fix the actual goal and success condition.' },
  'direct-answer': { id: 'direct-answer', kind: 'judgment', instruction: 'Answer the bounded question directly.' },
  'source-intent': { id: 'source-intent', kind: 'judgment', instruction: 'Identify the required knowledge and its trustworthy local source.' },
  'knowledge-handoff': { id: 'knowledge-handoff', kind: 'judgment', instruction: 'Retrieve only the knowledge needed for this turn.' },
  'problem-frame': { id: 'problem-frame', kind: 'judgment', instruction: 'Test whether the stated problem is only a symptom.' },
  observe: { id: 'observe', kind: 'judgment', instruction: 'Separate observed evidence from explanations.' },
  hypothesis: { id: 'hypothesis', kind: 'judgment', instruction: 'Form a causal hypothesis that the evidence can test.' },
  verify: { id: 'verify', kind: 'judgment', instruction: 'Try to falsify the hypothesis before changing code.' },
  implement: { id: 'implement', kind: 'judgment', instruction: 'Make the smallest change that satisfies the verified intent.' },
  'organization-context': { id: 'organization-context', kind: 'judgment', instruction: 'Identify actors, incentives, and decision ownership.' },
  'current-state': { id: 'current-state', kind: 'judgment', instruction: 'Verify the current operational state.' },
  runbook: { id: 'runbook', kind: 'judgment', instruction: 'Select the current local runbook or explicit recovery procedure.' },
  evidence: { id: 'evidence', kind: 'judgment', instruction: 'Define evidence for success and failure.' },
  'personal-context': { id: 'personal-context', kind: 'judgment', instruction: 'Use only owner-approved local context and decision principles.' },
  'authority-check': { id: 'authority-check', kind: 'constraint', instruction: 'Identify actor, scope, and approval authority separately from judgment.' },
  'enforcement-point': { id: 'enforcement-point', kind: 'constraint', instruction: 'Use the host or workflow permission boundary to enforce action authority.' },
  clarification: { id: 'clarification', kind: 'clarification', instruction: 'Ask only for the missing referent or context, then continue normally.' },
  merge: { id: 'merge', kind: 'common', instruction: 'Join only the selected judgment branches.' },
  receipt: { id: 'receipt', kind: 'common', instruction: 'Use this request-bound receipt for the current turn only.' }
};

const DAGS: Record<string, string[]> = {
  'direct.v1': ['goal', 'direct-answer'],
  'knowledge.v1': ['source-intent', 'knowledge-handoff'],
  'engineering.v1': ['goal', 'problem-frame', 'observe', 'hypothesis', 'verify', 'implement'],
  'organization.v1': ['goal', 'organization-context'],
  'operations.v1': ['current-state', 'runbook', 'evidence'],
  'personal-judgment.v1': ['goal', 'personal-context'],
  'authority.v1': ['authority-check', 'enforcement-point'],
  'clarification.v1': ['clarification']
};

const MANIFEST_DIGEST = sha256(canonicalJson({ runtime_version: RUNTIME_VERSION, nodes: NODES, dags: DAGS }));

const INTENT_TERMS: Array<[JudgmentClassification['intent'], string[]]> = [
  ['operate', ['deploy', 'publish', 'restart', 'デプロイ', '公開', '再起動', '復旧', '運用']],
  ['implement', ['implement', 'fix', 'change', 'update', 'delete', 'create', '実装', '修正', '変更', '更新', '削除', '作って']],
  ['diagnose', ['why', 'cause', 'diagnose', 'なぜ', '原因', '診断', '何が問題', '欠陥']],
  ['investigate', ['investigate', 'search', 'inspect', '調べ', '検索', '探して', '確認して', 'ログを見']],
  ['design', ['design', 'derive', '設計', '考えて', 'どうすべき', '演繹']],
  ['review', ['review', 'audit', 'レビュー', '評価して', '監査']],
  ['answer', ['explain', 'what is', '説明', '教えて', '答えて', 'とは', '意味']]
];

const DOMAIN_TERMS: Array<[JudgmentClassification['domains'][number], string[]]> = [
  ['operations', ['deploy', 'restart', 'runbook', 'incident', 'デプロイ', '再起動', '復旧', '運用', '障害']],
  ['engineering', ['implementation', 'code', 'api', 'bug', 'test', 'architecture', 'refactor', '実装', 'コード', 'api', 'バグ', 'テスト', '設計', 'pr', 'リファクタ', 'resolver', 'host']],
  ['knowledge', ['search', 'knowledge', 'source', '調べ', '検索', '資料', '情報', '知識']],
  ['organization', ['organization', 'hiring', 'authority', '組織', '採用', '人事', '権限構造', 'インセンティブ']],
  ['personal_judgment', ['my judgment', 'decision principle', '俺の判断', '私の判断', '判断基準', '思考アルゴリズム']]
];

const FOLLOW_UP_TERMS = ['that', 'it', 'continue', 'do that', 'それ', 'その形', 'これ', 'こちら', '続けて', 'もう一度', 'では', 'それでいい', 'そうして'];
const AUTHORITY_INTENTS = new Set<JudgmentClassification['intent']>(['implement', 'operate']);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareCodePoints).map((key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) throw new TypeError('canonical JSON does not support undefined');
      return `${JSON.stringify(key)}:${canonicalJson(entry)}`;
    }).join(',')}}`;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) as number);
  const b = Array.from(right, (value) => value.codePointAt(0) as number);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((item) => {
    if (typeof item === 'string') return item;
    const block = record(item);
    if (!block || !['input_text', 'output_text', 'text'].includes(String(block.type))) return '';
    return typeof block.text === 'string' ? block.text : '';
  }).filter(Boolean).join('\n');
}

function isInjectedHostEnvelope(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('<recommended_plugins>')
    || trimmed.startsWith('# AGENTS.md instructions for ')
    || trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('<app-context>');
}

function pathInside(path: string, root: string): boolean {
  const delta = relative(root, path);
  return delta === '' || (!delta.startsWith(`..${sep}`) && delta !== '..' && !isAbsolute(delta));
}

function transcriptRoots(env: Environment): string[] {
  const configured = (env.BRAINBASE_JUDGMENT_TRANSCRIPT_ROOTS ?? '')
    .split(delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  const defaultCodexHome = join(homedir(), '.codex');
  const defaultRoots = [...new Set([
    env.CODEX_HOME ? join(env.CODEX_HOME, 'sessions') : null,
    join(defaultCodexHome, 'sessions')
  ].filter((value): value is string => Boolean(value)))];
  return (configured.length > 0 ? configured : defaultRoots)
    .flatMap((path) => {
      try {
        return [realpathSync(path)];
      } catch {
        return [];
      }
    });
}

function normalizeMessages(messages: ConversationMessage[]): Required<ConversationMessage>[] {
  return messages.flatMap((message, sequence) => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string' || !message.text.trim()) return [];
    if (isInjectedHostEnvelope(message.text)) return [];
    return [{
      sequence,
      turn_id: typeof message.turn_id === 'string' ? message.turn_id : null,
      role: message.role,
      phase: typeof message.phase === 'string' ? message.phase : null,
      text: message.text
    }];
  });
}

function readCanonicalTranscript(
  payload: JudgmentHookPayload,
  env: Environment,
  trustedConversationMessages?: ConversationMessage[]
): { messages: Required<ConversationMessage>[]; complete: boolean } {
  if (Array.isArray(trustedConversationMessages)) {
    return { messages: normalizeMessages(trustedConversationMessages), complete: true };
  }
  if (!payload.transcript_path) return { messages: [], complete: false };

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(payload.transcript_path);
    if (!statSync(canonicalPath).isFile()) return { messages: [], complete: false };
  } catch {
    return { messages: [], complete: false };
  }
  const roots = transcriptRoots(env);
  if (roots.length === 0 || !roots.some((root) => pathInside(canonicalPath, root))) {
    return { messages: [], complete: false };
  }

  const messages: ConversationMessage[] = [];
  let sessionMatched = false;
  let truncatedTail = false;
  try {
    const lines = readFileSync(canonicalPath, 'utf8').split('\n');
    let lastNonEmptyIndex = -1;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (lines[index].trim()) {
        lastNonEmptyIndex = index;
        break;
      }
    }
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        if (index === lastNonEmptyIndex) {
          truncatedTail = true;
          break;
        }
        throw new Error(`judgment_transcript_corrupt_line_${index + 1}`, { cause: error });
      }
      const envelope = record(parsed);
      const eventPayload = record(envelope?.payload);
      if (!envelope || !eventPayload) continue;
      if (envelope.type === 'session_meta') {
        const ids = [eventPayload.id, eventPayload.session_id].filter((value): value is string => typeof value === 'string');
        sessionMatched = sessionMatched || !payload.session_id || ids.includes(payload.session_id);
        continue;
      }
      if (envelope.type !== 'response_item' || eventPayload.type !== 'message') continue;
      if (eventPayload.role !== 'user' && eventPayload.role !== 'assistant') continue;
      const text = contentText(eventPayload.content);
      if (!text.trim()) continue;
      const metadata = record(eventPayload.internal_chat_message_metadata_passthrough) ?? record(eventPayload.metadata);
      messages.push({
        role: eventPayload.role,
        turn_id: typeof metadata?.turn_id === 'string'
          ? metadata.turn_id
          : typeof eventPayload.turn_id === 'string' ? eventPayload.turn_id : null,
        phase: typeof metadata?.phase === 'string'
          ? metadata.phase
          : typeof eventPayload.phase === 'string' ? eventPayload.phase : null,
        text
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('judgment_transcript_corrupt_line_')) throw error;
    return { messages: [], complete: false };
  }
  return {
    messages: sessionMatched ? normalizeMessages(messages) : [],
    complete: sessionMatched && !truncatedTail
  };
}

function findRepoRoot(start: string): string | null {
  let current = resolve(start);
  for (;;) {
    try {
      statSync(join(current, '.git'));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

function instructionBindings(cwd: string): Array<{ scope: string; source_ref: string; digest: string }> {
  const discoveredRoot = findRepoRoot(cwd);
  if (!discoveredRoot) return [];
  const root = realpathSync(discoveredRoot);
  const workingDirectory = realpathSync(resolve(cwd));
  if (!pathInside(workingDirectory, root)) return [];
  const paths = [join(root, 'AGENTS.md')];
  const segments = relative(root, workingDirectory).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    paths.push(join(current, 'AGENTS.md'));
  }
  const seen = new Set<string>();
  return paths.flatMap((path, index) => {
    try {
      const canonical = realpathSync(path);
      if (seen.has(canonical) || !statSync(canonical).isFile()) return [];
      seen.add(canonical);
      return [{
        scope: index === 0 ? 'repository' : 'directory',
        source_ref: relative(root, canonical).replaceAll(sep, '/') || 'AGENTS.md',
        digest: sha256(readFileSync(canonical))
      }];
    } catch {
      return [];
    }
  });
}

function journalRoot(env: Environment): string {
  if (env.BRAINBASE_JUDGMENT_JOURNAL_DIR) return resolve(env.BRAINBASE_JUDGMENT_JOURNAL_DIR);
  const personalOs = resolve(env.BRAINBASE_PERSONAL_OS_DIR ?? join(homedir(), '.brainbase', 'personal-os'));
  return join(personalOs, 'judgment-journal');
}

function journalPaths(sessionRef: string, turnId: string, env: Environment): {
  directory: string;
  target: string;
  episode: string;
  events: string;
  final: string;
  lock: string;
} {
  const directory = join(journalRoot(env), sessionRef);
  const turnRef = sha256(turnId);
  return {
    directory,
    target: join(directory, `${turnRef}.json`),
    episode: join(directory, `${turnRef}.episode.json`),
    events: join(directory, `${turnRef}.events`),
    final: join(directory, `${turnRef}.final.json`),
    lock: join(directory, `${turnRef}.lock`)
  };
}

function acceptedProjection(receipt: JudgmentReceipt): Record<string, unknown> {
  return {
    turn_id: receipt.turn_id,
    resolution_id: receipt.resolution_id,
    request_digest: receipt.request_digest,
    context_digest: receipt.context_digest,
    plan_digest: receipt.plan_digest,
    status: receipt.status,
    classification: receipt.classification,
    classification_evidence: receipt.classification_evidence,
    selected_dag_ids: receipt.selected_dag_ids
  };
}

function readAdoptionEntry(path: string): JudgmentAdoptionEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw error;
    throw new Error(`judgment_journal_corrupt:${basename(path)}`, { cause: error });
  }
  const entry = record(parsed);
  const request = record(entry?.request) as unknown as JudgmentRequest | null;
  const receipt = record(entry?.receipt) as unknown as JudgmentReceipt | null;
  const supportedSchema = entry?.schema_version === 'brainbase-judgment-adoption-v1'
    || entry?.schema_version === 'brainbase-judgment-adoption-v2';
  if (!supportedSchema
    || typeof entry.accepted_at !== 'string'
    || typeof entry.request_text_digest !== 'string'
    || !request
    || typeof request.request !== 'string'
    || typeof request.turn_id !== 'string'
    || !record(request.conversation_context)
    || !receipt) {
    throw new Error(`judgment_journal_invalid:${basename(path)}`);
  }
  if (entry.request_text_digest !== sha256(request.request)) {
    throw new Error(`judgment_journal_request_digest_mismatch:${basename(path)}`);
  }
  const verifiedReceipt = verifyReceipt(receipt, request);
  if (entry.schema_version === 'brainbase-judgment-adoption-v2') {
    if (typeof entry.receipt_digest !== 'string'
      || entry.receipt_digest !== sha256(canonicalJson(verifiedReceipt))) {
      throw new Error(`judgment_adoption_receipt_digest_mismatch:${basename(path)}`);
    }
    return {
      schema_version: 'brainbase-judgment-adoption-v2',
      accepted_at: entry.accepted_at,
      request_text_digest: entry.request_text_digest,
      request,
      receipt: verifiedReceipt,
      receipt_digest: entry.receipt_digest,
      owner_audit: verifyOwnerAudit(entry.owner_audit, verifiedReceipt)
    };
  }
  return {
    schema_version: 'brainbase-judgment-adoption-v1',
    accepted_at: entry.accepted_at,
    request_text_digest: entry.request_text_digest,
    request,
    receipt: verifiedReceipt,
    owner_audit: buildOwnerAudit(request, verifiedReceipt, { historicalExact: false })
  };
}

function priorReceipts(sessionRef: string, currentTurnId: string, env: Environment): Array<Record<string, unknown>> {
  const { directory, target } = journalPaths(sessionRef, currentTurnId, env);
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/u.test(name));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  return names.filter((name) => name !== basename(target)).map((name) => {
    const entry = readAdoptionEntry(join(directory, name));
    if (entry.request.conversation_context.session_ref !== sessionRef) {
      throw new Error(`judgment_journal_session_mismatch:${name}`);
    }
    return { accepted_at: entry.accepted_at, projection: acceptedProjection(entry.receipt) };
  }).sort((left, right) => left.accepted_at.localeCompare(right.accepted_at))
    .map((entry) => entry.projection);
}

export function buildJudgmentRequest(
  payload: JudgmentHookPayload,
  {
    env = process.env,
    trustedConversationMessages
  }: { env?: Environment; trustedConversationMessages?: ConversationMessage[] } = {}
): JudgmentRequest {
  const request = typeof payload.prompt === 'string' && payload.prompt.trim() ? payload.prompt : '';
  const turnId = typeof payload.turn_id === 'string' ? payload.turn_id.trim() : '';
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!request || !turnId || !sessionId) throw new TypeError('UserPromptSubmit requires prompt, turn_id, and session_id');

  const sessionRef = sha256(sessionId);
  const transcript = readCanonicalTranscript(payload, env, trustedConversationMessages);
  const messages = transcript.messages.filter((message) => !(
    message.role === 'user' && message.turn_id === turnId && message.text === request
  ));
  const trailingMessage = messages.at(-1);
  if (trailingMessage?.role === 'user' && trailingMessage.turn_id === null && trailingMessage.text === request) {
    trailingMessage.turn_id = turnId;
  } else {
    messages.push({ sequence: messages.length, turn_id: turnId, role: 'user', phase: null, text: request });
  }
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const repoRoot = findRepoRoot(cwd);
  const projectBinding = env.BRAINBASE_JUDGMENT_PROJECT_CODE
    ?? (repoRoot ? basename(repoRoot).replace(/\.git$/u, '') : null);
  const contextWithoutDigest = {
    schema_version: 'brainbase-conversation-context-v1' as const,
    session_ref: sessionRef,
    messages: messages.map((message, sequence) => ({ ...message, sequence })),
    prior_receipts: priorReceipts(sessionRef, turnId, env),
    runtime: {
      host: 'codex' as const,
      model: typeof payload.model === 'string' && payload.model ? payload.model : null,
      permission_mode: typeof payload.permission_mode === 'string' && payload.permission_mode ? payload.permission_mode : null,
      project_binding: projectBinding
    },
    instruction_bindings: instructionBindings(cwd),
    completeness: transcript.complete ? 'complete' as const : 'partial' as const
  };
  return {
    request,
    turn_id: turnId,
    ...(projectBinding ? { project_code: projectBinding } : {}),
    conversation_context: {
      ...contextWithoutDigest,
      source_digest: sha256(canonicalJson(contextWithoutDigest))
    }
  };
}

function includesTerm(text: string, terms: string[]): boolean {
  const normalized = text.toLocaleLowerCase();
  return terms.some((term) => {
    const normalizedTerm = term.toLocaleLowerCase();
    if (!/^[a-z0-9_-]+$/u.test(normalizedTerm)) return normalized.includes(normalizedTerm);
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'u').test(normalized);
  });
}

function matchIntent(text: string): JudgmentClassification['intent'] | null {
  return INTENT_TERMS.find(([, terms]) => includesTerm(text, terms))?.[0] ?? null;
}

function matchDomains(text: string): JudgmentClassification['domains'] {
  return DOMAIN_TERMS.filter(([, terms]) => includesTerm(text, terms)).map(([domain]) => domain);
}

function priorClassification(request: JudgmentRequest): { classification: JudgmentClassification; source: 'prior_receipt' | 'prior_message'; turnIds: string[] } | null {
  const receipts = request.conversation_context.prior_receipts;
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const projection = record(receipts[index]);
    const classification = record(projection?.classification) as unknown as JudgmentClassification | null;
    if (classification && Array.isArray(classification.domains) && typeof classification.intent === 'string') {
      return {
        classification,
        source: 'prior_receipt',
        turnIds: typeof projection?.turn_id === 'string' ? [projection.turn_id] : []
      };
    }
  }

  const priorUsers = request.conversation_context.messages
    .filter((message) => message.role === 'user' && message.turn_id !== request.turn_id)
    .reverse();
  for (const message of priorUsers) {
    const intent = matchIntent(message.text);
    const domains = matchDomains(message.text);
    if (intent || domains.length > 0) {
      return {
        classification: {
          intent: intent ?? 'answer',
          domains: domains.length > 0 ? domains : ['general'],
          confidence: 'inferred'
        },
        source: 'prior_message',
        turnIds: message.turn_id ? [message.turn_id] : []
      };
    }
  }
  return null;
}

function dagForDomain(domain: JudgmentClassification['domains'][number]): string {
  return {
    general: 'direct.v1',
    knowledge: 'knowledge.v1',
    engineering: 'engineering.v1',
    organization: 'organization.v1',
    operations: 'operations.v1',
    personal_judgment: 'personal-judgment.v1'
  }[domain];
}

function buildActiveGraph(dagIds: string[]): { active_nodes: string[]; active_edges: Array<[string, string]>; active_node_definitions: JudgmentNodeDefinition[] } {
  const activeNodes = ['entry', 'reconcile'];
  const edges: Array<[string, string]> = [['entry', 'reconcile']];
  for (const dagId of dagIds) {
    const path = DAGS[dagId];
    if (!path) throw new Error(`unknown judgment DAG: ${dagId}`);
    if (path[0]) edges.push(['reconcile', path[0]]);
    for (let index = 0; index < path.length; index += 1) {
      const node = path[index];
      if (!activeNodes.includes(node)) activeNodes.push(node);
      const next = path[index + 1];
      if (next) edges.push([node, next]);
    }
    if (path.at(-1)) edges.push([path.at(-1) as string, 'merge']);
  }
  activeNodes.push('merge', 'receipt');
  edges.push(['merge', 'receipt']);
  return {
    active_nodes: activeNodes,
    active_edges: edges,
    active_node_definitions: activeNodes.map((id) => NODES[id])
  };
}

export async function resolveLocalJudgment(request: JudgmentRequest, options: LocalResolverOptions = {}): Promise<JudgmentReceipt> {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const followsPrior = includesTerm(request.request, FOLLOW_UP_TERMS);
  const prior = followsPrior ? priorClassification(request) : null;
  const detectedIntent = matchIntent(request.request);
  const detectedDomains = matchDomains(request.request);

  if (followsPrior && !prior && detectedDomains.length === 0) {
    return makeReceipt(request, {
      id: id(),
      now: now(),
      status: 'needs_clarification',
      classification: null,
      evidence: { source: 'resolver', source_turn_ids: [], matcher_ids: [] },
      reasons: ['conversation_referent_missing'],
      dagIds: ['clarification.v1'],
      unresolved: ['conversation_referent'],
      rationale: ['The Host kept the turn managed and selected a clarification instead of refusing the response.']
    });
  }

  const inheritedDomains = detectedDomains.length === 0 && prior ? prior.classification.domains : [];
  const domains: JudgmentClassification['domains'] = detectedDomains.length > 0
    ? detectedDomains
    : inheritedDomains.length > 0 ? inheritedDomains : ['general'];
  const intent = detectedIntent ?? prior?.classification.intent ?? 'answer';
  const inherited = detectedDomains.length === 0 && Boolean(prior);
  const classification: JudgmentClassification = {
    intent,
    domains,
    confidence: inherited ? 'inferred' : 'confirmed'
  };
  const dagIds = [...new Set(domains.map(dagForDomain))];
  if (AUTHORITY_INTENTS.has(intent)) dagIds.push('authority.v1');
  const matcherIds = [
    ...(detectedIntent ? [`intent:${detectedIntent}`] : []),
    ...detectedDomains.map((domain) => `domain:${domain}`)
  ];

  return makeReceipt(request, {
    id: id(),
    now: now(),
    status: 'resolved',
    classification,
    evidence: {
      source: inherited && prior ? prior.source : 'current_request',
      source_turn_ids: inherited && prior ? prior.turnIds : [request.turn_id],
      matcher_ids: matcherIds
    },
    reasons: inherited ? ['classification_inherited_from_prior_turn'] : [],
    dagIds,
    unresolved: [],
    rationale: ['The local Resolver selected only the judgment branches required by this turn.']
  });
}

function makeReceipt(request: JudgmentRequest, input: {
  id: string;
  now: Date;
  status: JudgmentReceipt['status'];
  classification: JudgmentClassification | null;
  evidence: JudgmentReceipt['classification_evidence'];
  reasons: string[];
  dagIds: string[];
  unresolved: string[];
  rationale: string[];
}): JudgmentReceipt {
  const graph = buildActiveGraph(input.dagIds);
  const receiptWithoutPlan = {
    resolution_id: input.id,
    resolved_at: input.now.toISOString(),
    turn_id: request.turn_id,
    request_digest: sha256(canonicalJson(request)),
    context_digest: sha256(canonicalJson(request.conversation_context)),
    status: input.status,
    runtime_version: RUNTIME_VERSION,
    manifest_digest: MANIFEST_DIGEST,
    host_binding: {
      adapter_id: 'brainbase-local' as const,
      adapter_version: '1' as const,
      status: 'managed' as const,
      enforcement_level: 'host_contract' as const
    },
    ...(request.project_code ? { project_code: request.project_code } : {}),
    classification: input.classification,
    classification_evidence: input.evidence,
    reconciliation_reasons: input.reasons,
    selected_dag_ids: input.dagIds,
    applicable_policies: [{
      id: 'portable.action-authorization-separate.v1',
      instruction: 'A judgment receipt never authorizes a write or external action.'
    }],
    ...graph,
    unresolved: input.unresolved,
    rationale: input.rationale
  };
  return {
    ...receiptWithoutPlan,
    plan_digest: receiptPlanDigest(receiptWithoutPlan)
  };
}

function receiptPlanDigest(receipt: Record<string, unknown>): string {
  const planValue = { ...receipt };
  delete planValue.resolution_id;
  delete planValue.resolved_at;
  delete planValue.request_digest;
  delete planValue.plan_digest;
  return sha256(canonicalJson(planValue));
}

function verifyReceipt(receipt: JudgmentReceipt, request: JudgmentRequest): JudgmentReceipt {
  if (!record(receipt) || receipt.turn_id !== request.turn_id) throw new Error('judgment_receipt_turn_mismatch');
  if (receipt.request_digest !== sha256(canonicalJson(request))) throw new Error('judgment_receipt_request_mismatch');
  if (receipt.context_digest !== sha256(canonicalJson(request.conversation_context))) throw new Error('judgment_receipt_context_mismatch');
  if (receipt.runtime_version !== RUNTIME_VERSION || receipt.manifest_digest !== MANIFEST_DIGEST) {
    throw new Error('judgment_receipt_runtime_mismatch');
  }
  if (receipt.host_binding?.adapter_id !== 'brainbase-local'
    || receipt.host_binding.adapter_version !== '1'
    || receipt.host_binding.status !== 'managed'
    || receipt.host_binding.enforcement_level !== 'host_contract') {
    throw new Error('judgment_receipt_binding_unmanaged');
  }
  if (!Array.isArray(receipt.active_node_definitions) || receipt.active_node_definitions.length === 0) {
    throw new Error('judgment_receipt_active_nodes_missing');
  }
  if (receipt.plan_digest !== receiptPlanDigest(receipt as unknown as Record<string, unknown>)) {
    throw new Error('judgment_receipt_plan_mismatch');
  }
  return receipt;
}

function existingAdoption(request: JudgmentRequest, env: Environment): JudgmentAdoptionEntry | null {
  const { target } = journalPaths(request.conversation_context.session_ref, request.turn_id, env);
  try {
    const entry = readAdoptionEntry(target);
    if (entry.request_text_digest !== sha256(request.request)
      || entry.request.turn_id !== request.turn_id
      || entry.request.conversation_context.session_ref !== request.conversation_context.session_ref) {
      throw new Error('judgment_turn_receipt_conflict');
    }
    return entry;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function existingAdoptionForPayload(payload: JudgmentHookPayload, env: Environment): JudgmentAdoptionEntry | null {
  const request = typeof payload.prompt === 'string' && payload.prompt.trim() ? payload.prompt : '';
  const turnId = typeof payload.turn_id === 'string' ? payload.turn_id.trim() : '';
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!request || !turnId || !sessionId) return null;
  const sessionRef = sha256(sessionId);
  const { target } = journalPaths(sessionRef, turnId, env);
  try {
    const entry = readAdoptionEntry(target);
    if (entry.request_text_digest !== sha256(request)
      || entry.request.turn_id !== turnId
      || entry.request.conversation_context.session_ref !== sessionRef) {
      throw new Error('judgment_turn_receipt_conflict');
    }
    return entry;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function adoptReceipt(request: JudgmentRequest, receipt: JudgmentReceipt, env: Environment): JudgmentAdoptionEntry {
  const { directory, target } = journalPaths(request.conversation_context.session_ref, request.turn_id, env);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ownerAudit = buildOwnerAudit(request, receipt);
  const entry: JudgmentAdoptionEntry = {
    schema_version: 'brainbase-judgment-adoption-v2',
    accepted_at: new Date().toISOString(),
    request_text_digest: sha256(request.request),
    request,
    receipt,
    receipt_digest: sha256(canonicalJson(receipt)),
    owner_audit: ownerAudit
  };
  const temp = join(directory, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(entry)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    try {
      linkSync(temp, target);
      return entry;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      return existingAdoption(request, env) as JudgmentAdoptionEntry;
    }
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the primary write error.
      }
    }
    try {
      unlinkSync(temp);
    } catch {
      // The target link is authoritative; temporary cleanup is best effort.
    }
  }
}

function artifactDigest(value: Record<string, unknown>, digestKey: string): string {
  const projection = { ...value };
  delete projection[digestKey];
  return sha256(canonicalJson(projection));
}

function readJsonArtifact(path: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!record(value)) throw new Error('not an object');
    return value;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw error;
    throw new Error(`judgment_journal_corrupt:${basename(path)}`, { cause: error });
  }
}

function writeImmutableJson(path: string, value: Record<string, unknown>): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    linkSync(temp, path);
  } finally {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch { /* Preserve the primary error. */ }
    }
    try { unlinkSync(temp); } catch { /* The immutable target is authoritative. */ }
  }
}

async function withTurnLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  let descriptor: number | null = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      descriptor = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      writeFileSync(descriptor, `${process.pid}\n`);
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  if (descriptor === null) throw new Error('judgment_episode_lock_timeout');
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let releaseError: unknown;
    try { closeSync(descriptor); } catch (error) { releaseError = error; }
    try { unlinkSync(lockPath); } catch (error) {
      releaseError ??= error;
    }
    if (releaseError && operationError === undefined) {
      throw new Error('judgment_episode_lock_release_failed', { cause: releaseError });
    }
  }
}

function readEpisode(path: string): JudgmentEpisode {
  const value = readJsonArtifact(path);
  if (value.schema_version !== 'brainbase-judgment-episode-v1'
    || typeof value.session_ref !== 'string'
    || typeof value.turn_id !== 'string'
    || typeof value.started_at !== 'string'
    || typeof value.request_text_digest !== 'string'
    || typeof value.initial_receipt_digest !== 'string'
    || !record(value.adoption)
    || typeof value.episode_digest !== 'string') {
    throw new Error(`judgment_journal_invalid:${basename(path)}`);
  }
  if (value.episode_digest !== artifactDigest(value, 'episode_digest')) {
    throw new Error(`judgment_episode_digest_mismatch:${basename(path)}`);
  }
  const adoption = value.adoption as unknown as JudgmentAdoptionEntry;
  if (value.initial_receipt_digest !== sha256(canonicalJson(adoption.receipt))) {
    throw new Error(`judgment_episode_receipt_digest_mismatch:${basename(path)}`);
  }
  return value as unknown as JudgmentEpisode;
}

function verifyEpisodeAdoption(episode: JudgmentEpisode, adoptionPath: string): void {
  const adoption = readAdoptionEntry(adoptionPath);
  if (sha256(canonicalJson(adoption.receipt)) !== episode.initial_receipt_digest
    || adoption.request.turn_id !== episode.turn_id
    || adoption.request.conversation_context.session_ref !== episode.session_ref) {
    throw new Error('judgment_episode_adoption_mismatch');
  }
}

function readToolEvent(path: string): JudgmentToolEvent {
  const value = readJsonArtifact(path);
  if (value.schema_version !== 'brainbase-judgment-tool-event-v1'
    || typeof value.session_ref !== 'string'
    || typeof value.turn_id !== 'string'
    || typeof value.sequence !== 'number'
    || typeof value.recorded_at !== 'string'
    || typeof value.tool_use_id !== 'string'
    || typeof value.tool_name !== 'string'
    || typeof value.event_fingerprint !== 'string'
    || typeof value.event_digest !== 'string') {
    throw new Error(`judgment_journal_invalid:${basename(path)}`);
  }
  if (value.event_digest !== artifactDigest(value, 'event_digest')) {
    throw new Error(`judgment_tool_event_digest_mismatch:${basename(path)}`);
  }
  return value as unknown as JudgmentToolEvent;
}

function readEvents(directory: string): JudgmentToolEvent[] {
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const events = names.map((name) => readToolEvent(join(directory, name)));
  events.forEach((event, index) => {
    if (event.sequence !== index + 1) throw new Error('judgment_tool_event_sequence_invalid');
  });
  return events;
}

function readFinal(path: string): JudgmentFinalReceipt {
  const value = readJsonArtifact(path);
  if (value.schema_version !== 'brainbase-judgment-final-v1'
    || typeof value.session_ref !== 'string'
    || typeof value.turn_id !== 'string'
    || typeof value.finalized_at !== 'string'
    || typeof value.initial_receipt_digest !== 'string'
    || typeof value.event_count !== 'number'
    || typeof value.event_set_digest !== 'string'
    || typeof value.answer_digest !== 'string'
    || typeof value.final_digest !== 'string') {
    throw new Error(`judgment_journal_invalid:${basename(path)}`);
  }
  if (value.final_digest !== artifactDigest(value, 'final_digest')) {
    throw new Error(`judgment_final_digest_mismatch:${basename(path)}`);
  }
  return value as unknown as JudgmentFinalReceipt;
}

const OWNER_EXCERPT_LIMIT = 26;
const PRIOR_EVIDENCE_SOURCES = new Set<JudgmentReceipt['classification_evidence']['source']>([
  'prior_receipt',
  'prior_message'
]);

function sanitizeOwnerExcerpt(value: unknown): string {
  const redacted = String(value ?? '')
    .replace(/\b(token|api[_-]?key|secret|password)\s*=\s*[^\s]+/giu, '$1=[秘密情報]')
    .replace(/\b(?:sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,}|xox[a-z]-[a-z0-9-]{8,}|AIza[a-z0-9_-]{8,})\b/giu, '[秘密情報]')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/[「」]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const points = Array.from(redacted);
  return points.length > OWNER_EXCERPT_LIMIT
    ? `${points.slice(0, OWNER_EXCERPT_LIMIT).join('')}…`
    : redacted;
}

function ownerEvidenceSource(request: JudgmentRequest, receipt: JudgmentReceipt): {
  sourceKind: JudgmentOwnerAudit['source_kind'];
  text: string;
  sourceTurnIds: string[];
} {
  const sourceTurnIds = Array.isArray(receipt.classification_evidence?.source_turn_ids)
    ? receipt.classification_evidence.source_turn_ids.filter((turnId) => typeof turnId === 'string')
    : [];
  const inherited = receipt.reconciliation_reasons?.includes('classification_inherited_from_prior_turn');
  const prior = PRIOR_EVIDENCE_SOURCES.has(receipt.classification_evidence?.source) || inherited;
  if (!prior) {
    return { sourceKind: 'current_request', text: request.request, sourceTurnIds };
  }

  const messages = Array.isArray(request.conversation_context?.messages)
    ? request.conversation_context.messages
    : [];
  const exact = [...messages].reverse().find((message) => (
    message.role === 'user'
    && message.turn_id !== request.turn_id
    && typeof message.turn_id === 'string'
    && sourceTurnIds.includes(message.turn_id)
  ));
  const fallback = sourceTurnIds.length === 0
    ? [...messages].reverse().find((message) => message.role === 'user' && message.turn_id !== request.turn_id)
    : undefined;
  return {
    sourceKind: exact ? 'prior_turn' : fallback ? 'prior_turn_fallback' : 'prior_turn_unavailable',
    text: exact?.text ?? fallback?.text ?? '',
    sourceTurnIds
  };
}

function ownerDecision(receipt: JudgmentReceipt): string {
  if (receipt.selected_dag_ids?.includes('knowledge.v1')) return 'Brainbase内検索が必要と判断';
  const byIntent: Partial<Record<JudgmentClassification['intent'], string>> = {
    implement: '実装依頼として継続',
    investigate: '調査として確認',
    diagnose: '原因診断として確認',
    review: 'レビューとして確認',
    design: '設計として検討',
    answer: '質問として回答',
    operate: '運用依頼として対応'
  };
  return receipt.classification?.intent
    ? byIntent[receipt.classification.intent] ?? '回答方針を確認'
    : '回答方針を確認';
}

function verifyOwnerAudit(ownerAuditValue: unknown, receipt: JudgmentReceipt): JudgmentOwnerAudit {
  const ownerAudit = record(ownerAuditValue) as unknown as JudgmentOwnerAudit | null;
  if (!ownerAudit || ownerAudit.schema_version !== 'brainbase-owner-audit-v1') {
    throw new Error('judgment_owner_audit_missing');
  }
  if (ownerAudit.source_receipt_digest !== sha256(canonicalJson(receipt))) {
    throw new Error('judgment_owner_audit_receipt_mismatch');
  }
  if (typeof ownerAudit.display_line !== 'string'
    || ownerAudit.text_digest !== sha256(ownerAudit.display_line)) {
    throw new Error('judgment_owner_audit_digest_mismatch');
  }
  return ownerAudit;
}

export function buildOwnerAudit(
  request: JudgmentRequest,
  receipt: JudgmentReceipt,
  { historicalExact = true }: { historicalExact?: boolean } = {}
): JudgmentOwnerAudit {
  const evidence = ownerEvidenceSource(request, receipt);
  const excerpt = sanitizeOwnerExcerpt(evidence.text);
  let decision = ownerDecision(receipt);
  let displayLine: string;

  if (receipt.status === 'needs_clarification' || receipt.selected_dag_ids.includes('clarification.v1')) {
    decision = '確認質問';
    displayLine = `⚠️ Brainbase参照: 「${excerpt || '現在の依頼'}」の対象を特定できず → ${decision}`;
  } else if (evidence.sourceKind === 'prior_turn_unavailable') {
    decision = '判断証跡を要確認';
    displayLine = `⚠️ Brainbase参照: 参照元の会話を確認できず → ${decision}`;
  } else {
    const prefix = evidence.sourceKind.startsWith('prior_turn') ? '直前の' : '';
    displayLine = `🧠 Brainbase参照: ${prefix}「${excerpt || '現在の依頼'}」を参照 → ${decision} ✓`;
  }

  return {
    schema_version: 'brainbase-owner-audit-v1',
    renderer_version: '1',
    locale: 'ja-JP',
    historical_exact: historicalExact,
    source_receipt_digest: sha256(canonicalJson(receipt)),
    source_kind: evidence.sourceKind,
    source_turn_ids: evidence.sourceTurnIds,
    source_excerpt: excerpt,
    decision,
    display_line: displayLine,
    text_digest: sha256(displayLine)
  };
}

export function buildOwnerReferenceLine(request: JudgmentRequest, receipt: JudgmentReceipt): string {
  return buildOwnerAudit(request, receipt).display_line;
}

function successOutput(
  request: JudgmentRequest,
  receipt: JudgmentReceipt,
  ownerAudit: JudgmentOwnerAudit = buildOwnerAudit(request, receipt)
): JudgmentHookOutput {
  const ownerReferenceLine = ownerAudit.display_line;
  const executionPlan = {
    status: receipt.status,
    active_edges: receipt.active_edges,
    active_node_definitions: receipt.active_node_definitions,
    unresolved: receipt.unresolved
  };
  const auditContract = {
    schema_version: 'brainbase-audit-contract-v1',
    owner_line: ownerReferenceLine,
    required_order: ['judgment', 'knowledge', 'warning'],
    exact_once: true
  };
  const context = [
    'Brainbase Judgment Resolver Host contract completed before model generation.',
    'This is the only accepted receipt for the current turn. Do not call a resolver again or reclassify the turn.',
    'Use active_node_definitions in active_edges order. A clarification receipt means ask only the clarification selected by the receipt and continue the response.',
    'A judgment receipt is not action authorization. Normal host permissions and approval boundaries remain in force.',
    `The first line of every user-facing response must be exactly this Host-generated line:\n${ownerReferenceLine}`,
    'Do not alter, translate, summarize, omit, or repeat that owner-visible line. It reports judgment evidence, not action authorization or completed knowledge retrieval.',
    `Execution plan: ${JSON.stringify(executionPlan)}`,
    `audit_contract: ${JSON.stringify(auditContract)}`
  ].join('\n');
  return {
    continue: true,
    suppressOutput: true,
    receipt,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context }
  };
}

export async function runJudgmentHost(payload: JudgmentHookPayload, options: JudgmentHostOptions = {}): Promise<JudgmentHookOutput> {
  const env = options.env ?? process.env;
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const turnId = typeof payload.turn_id === 'string' ? payload.turn_id.trim() : '';
  if (!sessionId || !turnId) throw new TypeError('UserPromptSubmit requires prompt, turn_id, and session_id');
  const paths = journalPaths(sha256(sessionId), turnId, env);
  return withTurnLock(paths.lock, async () => {
    try {
      const episode = readEpisode(paths.episode);
      verifyEpisodeAdoption(episode, paths.target);
      const requestText = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
      if (!requestText || episode.request_text_digest !== sha256(requestText)) {
        throw new Error('judgment_episode_binding_mismatch');
      }
      return successOutput(episode.adoption.request, episode.adoption.receipt, episode.adoption.owner_audit);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }

    const adopted = existingAdoptionForPayload(payload, env);
    const request = adopted?.request ?? buildJudgmentRequest(payload, {
      env,
      trustedConversationMessages: options.trustedConversationMessages
    });
    const existing = adopted ?? existingAdoption(request, env);
    const adoption = existing ?? adoptReceipt(
      request,
      verifyReceipt(await (options.resolver ?? resolveLocalJudgment)(request), request),
      env
    );
    const episodeWithoutDigest = {
      schema_version: 'brainbase-judgment-episode-v1' as const,
      session_ref: request.conversation_context.session_ref,
      turn_id: request.turn_id,
      started_at: new Date().toISOString(),
      request_text_digest: sha256(request.request),
      initial_receipt_digest: sha256(canonicalJson(adoption.receipt)),
      adoption
    };
    const episode: JudgmentEpisode = {
      ...episodeWithoutDigest,
      episode_digest: sha256(canonicalJson(episodeWithoutDigest))
    };
    writeImmutableJson(paths.episode, episode as unknown as Record<string, unknown>);
    return successOutput(adoption.request, adoption.receipt, adoption.owner_audit);
  });
}

function hookIdentity(payload: JudgmentHookPayload): { sessionRef: string; turnId: string } {
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const turnId = typeof payload.turn_id === 'string' ? payload.turn_id.trim() : '';
  if (!sessionId || !turnId) throw new TypeError('Judgment lifecycle hook requires turn_id and session_id');
  return { sessionRef: sha256(sessionId), turnId };
}

async function recordToolUse(payload: JudgmentHookPayload, env: Environment): Promise<JudgmentToolEvent> {
  const { sessionRef, turnId } = hookIdentity(payload);
  const paths = journalPaths(sessionRef, turnId, env);
  const toolUseId = typeof payload.tool_use_id === 'string' ? payload.tool_use_id.trim() : '';
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name.trim() : '';
  if (!toolUseId || !toolName) throw new TypeError('PostToolUse requires tool_use_id and tool_name');
  return withTurnLock(paths.lock, async () => {
    let episode: JudgmentEpisode;
    try {
      episode = readEpisode(paths.episode);
      verifyEpisodeAdoption(episode, paths.target);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error('judgment_orphan_post_tool_use');
      }
      throw error;
    }
    if (episode.session_ref !== sessionRef || episode.turn_id !== turnId) {
      throw new Error('judgment_episode_binding_mismatch');
    }
    try {
      readFinal(paths.final);
      throw new Error('judgment_episode_already_finalized');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const toolInput = payload.tool_input ?? null;
    const toolResponse = payload.tool_response ?? null;
    const eventFingerprint = sha256(canonicalJson({ tool_use_id: toolUseId, tool_name: toolName, tool_input: toolInput, tool_response: toolResponse }));
    const events = readEvents(paths.events);
    const replay = events.find((event) => event.tool_use_id === toolUseId);
    if (replay) {
      if (replay.event_fingerprint !== eventFingerprint) throw new Error('judgment_tool_event_conflict');
      return replay;
    }
    const eventWithoutDigest = {
      schema_version: 'brainbase-judgment-tool-event-v1' as const,
      session_ref: sessionRef,
      turn_id: turnId,
      sequence: events.length + 1,
      recorded_at: new Date().toISOString(),
      tool_use_id: toolUseId,
      tool_name: toolName,
      tool_input: toolInput,
      tool_response: toolResponse,
      event_fingerprint: eventFingerprint
    };
    const event: JudgmentToolEvent = {
      ...eventWithoutDigest,
      event_digest: sha256(canonicalJson(eventWithoutDigest))
    };
    const name = `${String(event.sequence).padStart(8, '0')}-${sha256(toolUseId)}.json`;
    writeImmutableJson(join(paths.events, name), event as unknown as Record<string, unknown>);
    return event;
  });
}

async function finalizeEpisode(payload: JudgmentHookPayload, env: Environment): Promise<JudgmentFinalReceipt> {
  const { sessionRef, turnId } = hookIdentity(payload);
  const paths = journalPaths(sessionRef, turnId, env);
  const answerDigest = sha256(typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '');
  return withTurnLock(paths.lock, async () => {
    let episode: JudgmentEpisode;
    try {
      episode = readEpisode(paths.episode);
      verifyEpisodeAdoption(episode, paths.target);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new Error('judgment_orphan_stop');
      throw error;
    }
    if (episode.session_ref !== sessionRef || episode.turn_id !== turnId) {
      throw new Error('judgment_episode_binding_mismatch');
    }
    const events = readEvents(paths.events);
    const eventSetDigest = sha256(canonicalJson(events));
    try {
      const existing = readFinal(paths.final);
      if (existing.initial_receipt_digest !== episode.initial_receipt_digest
        || existing.event_count !== events.length
        || existing.event_set_digest !== eventSetDigest
        || existing.answer_digest !== answerDigest) {
        throw new Error('judgment_final_conflict');
      }
      return existing;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const finalWithoutDigest = {
      schema_version: 'brainbase-judgment-final-v1' as const,
      session_ref: sessionRef,
      turn_id: turnId,
      finalized_at: new Date().toISOString(),
      initial_receipt_digest: episode.initial_receipt_digest,
      event_count: events.length,
      event_set_digest: eventSetDigest,
      answer_digest: answerDigest
    };
    const final: JudgmentFinalReceipt = {
      ...finalWithoutDigest,
      final_digest: sha256(canonicalJson(finalWithoutDigest))
    };
    writeImmutableJson(paths.final, final as unknown as Record<string, unknown>);
    return final;
  });
}

export async function processJudgmentHook(
  payload: JudgmentHookPayload,
  options: JudgmentHostOptions = {}
): Promise<JudgmentHookOutput | JudgmentToolEvent | JudgmentFinalReceipt | Record<string, never>> {
  const eventName = payload.hook_event_name ?? payload.hookEventName ?? 'UserPromptSubmit';
  const env = options.env ?? process.env;
  if (eventName === 'UserPromptSubmit') return runJudgmentHost(payload, options);
  if (eventName === 'PostToolUse') return recordToolUse(payload, env);
  if (eventName === 'Stop') return finalizeEpisode(payload, env);
  return {};
}

export function blockedJudgmentOutput(reason: string): { continue: false; suppressOutput: false; stopReason: string } {
  return {
    continue: false,
    suppressOutput: false,
    stopReason: `Brainbase Judgment Host failed before the turn (${reason}).`
  };
}
