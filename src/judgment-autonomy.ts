import { createHash } from 'node:crypto';

export type JudgmentAutonomyVerdict = 'continue' | 'human_required' | 'not_applicable';

export type JudgmentAutonomyReasonCode =
  | 'not_a_human_escalation'
  | 'routine_reversible_work'
  | 'semantic_judgment_required'
  | 'irreversible_external_action'
  | 'missing_authority_or_secret'
  | 'material_commitment'
  | 'owner_value_choice'
  | 'resolver_selected_clarification'
  | 'resolver_continue'
  | 'resolver_human_required';

export interface JudgmentAutonomyInstructionPatch {
  cancel: readonly string[];
  do_next: readonly string[];
  acceptance_criteria: readonly string[];
}

export interface JudgmentAutonomyContext {
  turn_id: string;
  request: string;
  final_answer: string;
  project_code?: string;
  selected_dag_ids: readonly string[];
}

export interface JudgmentAutonomyResolverRequest {
  schema_version: 'brainbase-autonomy-resolver-request-v1';
  case_id: string;
  turn_id: string;
  task_request: string;
  proposed_human_question: string;
  project_code?: string;
  selected_dag_ids: readonly string[];
  policy: {
    default_behavior: 'continue';
    complexity_behavior: 'decompose_and_continue';
    human_only: readonly [
      'irreversible_external_action',
      'missing_authority_or_secret',
      'material_commitment',
      'new_owner_value_choice'
    ];
  };
}

export interface JudgmentAutonomyResolverDecision {
  schema_version: 'brainbase-autonomy-resolver-decision-v1';
  case_id: string;
  verdict: 'continue' | 'human_required';
  reason_code: string;
  reason: string;
  basis: ReadonlyArray<{
    entity_id: string;
    application: string;
  }>;
  instruction_patch?: JudgmentAutonomyInstructionPatch;
  human_question?: string;
}

export type JudgmentAutonomyResolver = (
  request: JudgmentAutonomyResolverRequest
) => Promise<JudgmentAutonomyResolverDecision>;

export interface JudgmentAutonomyEvaluation {
  schema_version: 'brainbase-autonomy-evaluation-v1';
  case_id: string;
  verdict: JudgmentAutonomyVerdict;
  reason_code: JudgmentAutonomyReasonCode;
  reason: string;
  question: string | null;
  source: 'deterministic' | 'same_codex' | 'independent_resolver';
  instruction_patch: JudgmentAutonomyInstructionPatch | null;
  resolver_decision: JudgmentAutonomyResolverDecision | null;
}

const AUDIT_LINE = /^(?:🧠 |📚 Brainbase|⚠️ (?:Brainbase|判断))/u;
const QUESTION_END = /(?:[?？]|(?:選んで|教えて|確認して|承認して)(?:ください|下さい)?[。.]?)$/u;

const HUMAN_QUESTION_PATTERNS = [
  /(?:しても|して|進めても|実行しても|変更しても|修正しても|作成しても)(?:よい|いい|良い)ですか/u,
  /(?:しますか|進めますか|実行しますか|変更しますか|修正しますか|作成しますか)/u,
  /(?:どちら|どれ|何を|どう)(?:に|を|で)?(?:します|進めます|選びます|すべき)か/u,
  /(?:どちら|どの|何の).+(?:ですか|ますか)/u,
  /(?:送って|渡して|共有して)(?:も)?(?:よい|いい|良い)ですか/u,
  /(?:選んで|教えて|確認して|承認して)(?:ください|下さい)/u,
  /(?:送信|送付|公開|投稿|デプロイ|マージ|merge|push|publish|作成|削除|破棄|変更|共有)(?:しても|して)?(?:よい|いい|良い)ですか/iu,
  /(?:送ります|公開します|投稿します|デプロイします|マージします|作成します|削除します|破棄します|変更します|共有します|渡します)か/iu,
  /(?:should i|would you like|do you want|which (?:option|one)|please (?:choose|confirm|approve)|can i)\b/iu
] as const;

const EXTERNAL_ACTION_TERMS = [
  '外部送信', 'メール送信', '送信しますか', '公開しますか', '投稿しますか', '本番デプロイ',
  '本番へデプロイ', 'prを作成', 'pull request', 'issueを作成', 'github issue', 'slack',
  'メール', 'webhook', '外部api', '外部サービス', '共有しますか', '渡してよい',
  'mergeしますか', 'pushしますか', 'publish', 'send', 'deploy', 'merge', 'push', 'post'
] as const;

const DESTRUCTIVE_TERMS = [
  '本番データを削除', '本番削除', '本番DB', 'drop table', 'truncate', 'production delete',
  'データベースを削除', 'dbを削除', '削除しますか', '消去しますか', '不可逆',
  '取り消せない', '破棄', '全削除', '上書き'
] as const;

const PRODUCTION_ACTION_TERMS = [
  '本番環境', '本番で', '本番へ', 'production', 'prod', '商用環境', '顧客環境'
] as const;

const AUTHORITY_CHANGE_TERMS = [
  '権限を変更', '権限付与', '管理者権限', 'owner権限', 'roleを変更', 'rbac',
  'アクセス権', 'permission change', 'grant access', 'admin role'
] as const;

const SENSITIVE_DATA_TERMS = [
  '個人情報', '機密情報', '顧客情報', '医療情報', '認証情報を送', '秘密情報を送',
  'personal data', 'pii', 'confidential', 'health data', 'credentialを送'
] as const;

const AUTHORITY_TERMS = [
  '権限がありません', '権限不足', '認証情報', '秘密情報', 'api key', 'credential', 'permission denied',
  'access denied', 'secretが必要', 'トークンが必要'
] as const;

const MATERIAL_COMMITMENT_TERMS = [
  '購入', '発注', '支払い', '決済', '契約締結', '法的', '金額', '課金', 'purchase', 'payment',
  'sign the contract', 'legal commitment'
] as const;

const EXPLICIT_NEW_OWNER_VALUE_TERMS = [
  '既存の判断基準では決められない', 'brainbaseに判断基準がない', '新しい価値判断を決める必要',
  'これまで決めていない方針', 'no existing decision principle', 'new owner value choice is required'
] as const;

const ROUTINE_TERMS = [
  'テスト', 'lint', 'format', 'フォーマット', 'build', 'ビルド', '型チェック', 'typecheck',
  'ファイルを読む', 'ファイルを確認', '調査', '検索', 'ログを確認', '差分を確認', 'dry-run',
  'ローカル', '可逆', '小さな修正', '編集', '実装方法', 'リファクタ', 'read the file',
  'run the test', 'run tests', 'inspect', 'search', 'local change'
] as const;

const RELEASE_PIPELINE_TERMS = [
  'prを作成', 'pull request', 'merge', 'マージ', 'push', 'publish', '公開', 'deploy',
  'デプロイ', '本番展開', '本番反映', 'release', 'リリース'
] as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new TypeError('canonical JSON only supports JSON values');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function containsAny(text: string, terms: readonly string[]): boolean {
  const normalized = text.toLocaleLowerCase();
  return terms.some((term) => normalized.includes(term.toLocaleLowerCase()));
}

function requestAuthorizesExternalAction(request: string, question: string): boolean {
  if (containsAny(question, RELEASE_PIPELINE_TERMS)) {
    return containsAny(request, RELEASE_PIPELINE_TERMS);
  }
  return false;
}

export function visibleAnswerBody(answer: string): string {
  const lines = answer.replaceAll('\r\n', '\n').split('\n');
  while (lines.length > 0 && (lines[0].trim() === '' || AUDIT_LINE.test(lines[0]))) lines.shift();
  return lines.join('\n').trim();
}

export function extractHumanDecisionQuestion(answer: string): string | null {
  const body = visibleAnswerBody(answer);
  if (!body) return null;
  const paragraphs = body.split(/\n\s*\n/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const candidate = paragraphs.at(-1) ?? body;
  const lines = candidate.split('\n').map((line) => line.trim()).filter(Boolean);
  const question = lines.slice(-3).join(' ').slice(-1200).trim();
  if (!question || !QUESTION_END.test(question)) return null;
  return HUMAN_QUESTION_PATTERNS.some((pattern) => pattern.test(question)) ? question : null;
}

function continuationPatch(question: string, semantic: boolean): JudgmentAutonomyInstructionPatch {
  return {
    cancel: [`人間への確認質問: ${question}`],
    do_next: semantic ? [
      'Brainbase MCPから今回の目的、適用可能な判断基準、過去Decision、委任境界を取得する',
      '候補を比較し、既存の人間由来の基準を今回の具体的状況へ適用してOK / NG / 条件付きOKを決める',
      'NGなら理由だけで止めず、代替行動と完了条件を作業計画へ反映する',
      '安全かつ委任範囲内なら同じCodexターンで調査・実装・検証を続行する'
    ] : [
      '質問対象の通常工程をそのまま実行する',
      '結果を検証し、失敗時は安全な代替手段を試す',
      '同じCodexターンで完了まで続行する'
    ],
    acceptance_criteria: [
      '人間へ同じ確認を再送しない',
      '不可逆な外部操作、実証済みの権限不足、既存基準から決められない新しい価値判断だけを再エスカレーションする',
      '最終回答は既存のBrainbase audit_contractも満たす'
    ]
  };
}

function resolverRequest(context: JudgmentAutonomyContext, question: string, caseId: string): JudgmentAutonomyResolverRequest {
  return {
    schema_version: 'brainbase-autonomy-resolver-request-v1',
    case_id: caseId,
    turn_id: context.turn_id,
    task_request: context.request,
    proposed_human_question: question,
    ...(context.project_code ? { project_code: context.project_code } : {}),
    selected_dag_ids: [...context.selected_dag_ids],
    policy: {
      default_behavior: 'continue',
      complexity_behavior: 'decompose_and_continue',
      human_only: [
        'irreversible_external_action',
        'missing_authority_or_secret',
        'material_commitment',
        'new_owner_value_choice'
      ]
    }
  };
}

function validateResolverDecision(
  decision: JudgmentAutonomyResolverDecision,
  caseId: string
): JudgmentAutonomyResolverDecision {
  if (decision?.schema_version !== 'brainbase-autonomy-resolver-decision-v1'
    || decision.case_id !== caseId
    || !['continue', 'human_required'].includes(decision.verdict)
    || typeof decision.reason_code !== 'string'
    || !decision.reason_code.trim()
    || typeof decision.reason !== 'string'
    || !decision.reason.trim()
    || !Array.isArray(decision.basis)
    || decision.basis.length === 0
    || !decision.basis.every((entry) => (
      entry
      && typeof entry.entity_id === 'string'
      && entry.entity_id.trim().length > 0
      && typeof entry.application === 'string'
      && entry.application.trim().length > 0
    ))) {
    throw new Error('judgment_autonomy_resolver_invalid');
  }
  if (decision.verdict === 'continue') {
    const patch = decision.instruction_patch;
    if (!patch
      || !Array.isArray(patch.cancel)
      || !Array.isArray(patch.do_next)
      || patch.do_next.length === 0
      || !Array.isArray(patch.acceptance_criteria)
      || patch.acceptance_criteria.length === 0
      || ![...patch.cancel, ...patch.do_next, ...patch.acceptance_criteria].every((item) => (
        typeof item === 'string' && item.trim().length > 0
      ))) {
      throw new Error('judgment_autonomy_resolver_instruction_missing');
    }
    const delegatedInstructions = [...patch.cancel, ...patch.do_next, ...patch.acceptance_criteria].join(' ');
    if (containsAny(delegatedInstructions, EXTERNAL_ACTION_TERMS)
      || containsAny(delegatedInstructions, DESTRUCTIVE_TERMS)
      || containsAny(delegatedInstructions, MATERIAL_COMMITMENT_TERMS)) {
      throw new Error('judgment_autonomy_resolver_authority_expansion');
    }
  }
  if (decision.verdict === 'human_required'
    && (typeof decision.human_question !== 'string' || !decision.human_question.trim())) {
    throw new Error('judgment_autonomy_resolver_human_question_missing');
  }
  return decision;
}

export async function evaluateJudgmentAutonomy(
  context: JudgmentAutonomyContext,
  resolver?: JudgmentAutonomyResolver
): Promise<JudgmentAutonomyEvaluation> {
  const question = extractHumanDecisionQuestion(context.final_answer);
  const caseId = sha256(canonicalJson({
    turn_id: context.turn_id,
    request: context.request,
    question,
    project_code: context.project_code ?? null,
    selected_dag_ids: [...context.selected_dag_ids]
  }));

  if (!question) {
    return {
      schema_version: 'brainbase-autonomy-evaluation-v1',
      case_id: caseId,
      verdict: 'not_applicable',
      reason_code: 'not_a_human_escalation',
      reason: 'The final answer does not request a human decision or approval.',
      question: null,
      source: 'deterministic',
      instruction_patch: null,
      resolver_decision: null
    };
  }

  if (context.selected_dag_ids.includes('clarification.v1')) {
    return {
      schema_version: 'brainbase-autonomy-evaluation-v1', case_id: caseId,
      verdict: 'human_required', reason_code: 'resolver_selected_clarification',
      reason: 'The accepted Judgment Receipt explicitly selected a missing referent clarification.',
      question, source: 'deterministic', instruction_patch: null, resolver_decision: null
    };
  }

  if (containsAny(question, AUTHORITY_TERMS)) {
    return {
      schema_version: 'brainbase-autonomy-evaluation-v1', case_id: caseId,
      verdict: 'human_required', reason_code: 'missing_authority_or_secret',
      reason: 'The agent reports a missing authority or secret that the worker cannot invent.',
      question, source: 'deterministic', instruction_patch: null, resolver_decision: null
    };
  }
  if (containsAny(question, MATERIAL_COMMITMENT_TERMS)) {
    return {
      schema_version: 'brainbase-autonomy-evaluation-v1', case_id: caseId,
      verdict: 'human_required', reason_code: 'material_commitment',
      reason: 'The requested decision creates a material financial, legal, or contractual commitment.',
      question, source: 'deterministic', instruction_patch: null, resolver_decision: null
    };
  }
  const destructive = containsAny(question, DESTRUCTIVE_TERMS);
  const production = containsAny(question, PRODUCTION_ACTION_TERMS);
  const authorityChange = containsAny(question, AUTHORITY_CHANGE_TERMS);
  const sensitiveData = containsAny(question, SENSITIVE_DATA_TERMS);
  const externalAction = containsAny(question, EXTERNAL_ACTION_TERMS);
  const authorizedReleaseAction = requestAuthorizesExternalAction(context.request, question);
  if (destructive || authorityChange || sensitiveData
    || ((production || externalAction) && !authorizedReleaseAction)) {
    return {
      schema_version: 'brainbase-autonomy-evaluation-v1', case_id: caseId,
      verdict: 'human_required', reason_code: 'irreversible_external_action',
      reason: 'The requested decision crosses a production, destructive, authority, sensitive-data, or unapproved external-action boundary.',
      question, source: 'deterministic', instruction_patch: null, resolver_decision: null
    };
  }
  if (containsAny(question, EXPLICIT_NEW_OWNER_VALUE_TERMS)) {
    return {
      schema_version: 'brainbase-autonomy-evaluation-v1', case_id: caseId,
      verdict: 'human_required', reason_code: 'owner_value_choice',
      reason: 'The existing packet does not establish a reusable owner value choice.',
      question, source: 'deterministic', instruction_patch: null, resolver_decision: null
    };
  }
  if (containsAny(question, ROUTINE_TERMS)) {
    return {
      schema_version: 'brainbase-autonomy-evaluation-v1', case_id: caseId,
      verdict: 'continue', reason_code: 'routine_reversible_work',
      reason: 'The question concerns routine, reversible work already implied by the task.',
      question, source: 'deterministic', instruction_patch: continuationPatch(question, false), resolver_decision: null
    };
  }

  if (!resolver) {
    return {
      schema_version: 'brainbase-autonomy-evaluation-v1', case_id: caseId,
      verdict: 'continue', reason_code: 'semantic_judgment_required',
      reason: 'The case requires semantic application of Brainbase judgments; the current Codex worker must resolve it before escalating.',
      question, source: 'same_codex', instruction_patch: continuationPatch(question, true), resolver_decision: null
    };
  }

  const decision = validateResolverDecision(await resolver(resolverRequest(context, question, caseId)), caseId);
  if (decision.verdict === 'human_required') {
    return {
      schema_version: 'brainbase-autonomy-evaluation-v1', case_id: caseId,
      verdict: 'human_required', reason_code: 'resolver_human_required',
      reason: decision.reason, question: decision.human_question ?? question,
      source: 'independent_resolver', instruction_patch: null, resolver_decision: decision
    };
  }
  return {
    schema_version: 'brainbase-autonomy-evaluation-v1', case_id: caseId,
    verdict: 'continue', reason_code: 'resolver_continue',
    reason: decision.reason, question,
    source: 'independent_resolver', instruction_patch: decision.instruction_patch ?? null,
    resolver_decision: decision
  };
}

export function renderJudgmentAutonomyContinuation(evaluation: JudgmentAutonomyEvaluation): string {
  if (evaluation.verdict !== 'continue' || !evaluation.instruction_patch) {
    throw new TypeError('Only continue evaluations can be rendered as a continuation');
  }
  const patch = evaluation.instruction_patch;
  return [
    'この確認質問は人間へ送らず、Brainbaseの代理判断ループとして同じターンを続行してください。',
    `判定理由: ${evaluation.reason}`,
    `中止: ${patch.cancel.join(' / ')}`,
    `次に行うこと:\n${patch.do_next.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
    `完了条件:\n${patch.acceptance_criteria.map((item) => `- ${item}`).join('\n')}`
  ].join('\n');
}
