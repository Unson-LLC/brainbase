// @ts-check
import { DuplicateCandidateError } from '../candidate-store/candidate-repository.js';
import {
    assertPersonalKgCandidateScope,
    isPersonalKgCandidateInScope,
    requirePersonalKgIdentity
} from './personal-kg-identity.js';
const MAX_BODY_LENGTH = 280;

const PROJECT_ORGS = {
    salestailor: ['unson', 'salestailor'],
    brainbase: ['unson'],
    baao: ['unson', 'baao'],
    techknight: ['techknight'],
    zeims: ['unson', 'zeims'],
    ncom: ['unson', 'ncom']
};

const SOURCE_SYSTEM = 'oyasumi-meeting-personal-kg';
const MEMORY_LAYER_CORE = 'personal_kg_core';
const MEMORY_LAYER_SNS_READY = 'sns_ready';
const ALLOWED_COGNITIVE_TYPES = new Set(['observation', 'insight', 'claim', 'preference', 'hypothesis', 'experiment', 'result']);
const SNS_PROJECTION_BLOCKED_CATEGORIES = new Set(['private_or_family', 'medical_or_health']);
const ALLOWED_SEMANTIC_SENSITIVITY = new Set(['internal', 'confidential', 'restricted']);
const ALLOWED_SEMANTIC_REDACTION_STATUS = new Set(['none', 'needs_redaction']);
const SEMANTIC_MODEL_INPUT_LIMIT = 18000;
const SEMANTIC_SNS_BLOCK_PATTERN = /補助金|助成金|融資|返金|銀行口座|税務リスク|役員報酬|未払い|資金調達|キャッシュ不足|保証協会|不審メール|乗っ取り|フィッシング|迷惑メール|Outlook|Entra|セキュリティ診断|脆弱性診断|診断業者|監査法人|暫定ルート|PC貸出|Pマーク|IFA|MA仲介|オンサイト|物理セキュリティ|ネットワークアクセス|システムアクセス/u;

function normalizeSpaces(value) {
    return String(value || '').replace(/\s+/gu, ' ').trim();
}

function stripMarkdown(value) {
    return normalizeSpaces(value)
        .replace(/^[-*]\s*/u, '')
        .replace(/[*_`]/gu, '')
        .replace(/:([a-z_]+):/giu, '')
        .trim();
}

function compact(value, max = MAX_BODY_LENGTH) {
    const body = normalizeSpaces(value);
    if (body.length <= max) return body;
    return `${body.slice(0, max - 1).trim()}…`;
}

function structuredBodyParts(body) {
    const text = String(body || '');
    const labels = ['Context', 'Judgment', 'Reusable Pattern', 'Apply When', 'Do Not Apply When'];
    const parts = {};
    for (let index = 0; index < labels.length; index += 1) {
        const label = labels[index];
        const nextLabel = labels[index + 1];
        const pattern = nextLabel
            ? new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n?${nextLabel}:)`, 'u')
            : new RegExp(`${label}:\\s*([\\s\\S]*)$`, 'u');
        const match = text.match(pattern);
        if (match) parts[label] = normalizeSpaces(match[1]);
    }
    return parts;
}

function redactSnsProjectionText(value) {
    return normalizeSpaces(value)
        .replace(/月\s*\d+\s*万(?:円)?/gu, '具体金額')
        .replace(/半年\s*\d+\s*万(?:円)?/gu, '具体金額')
        .replace(/月額予算\s*\d+\s*万(?:円)?/gu, '具体予算')
        .replace(/月\s*\d+\s*(?:から|〜|~|-)\s*\d+\s*件/gu, '具体件数')
        .replace(/\d+\s*(?:から|〜|~|-)\s*\d+\s*件/gu, '具体件数')
        .replace(/Agoda Japan/gu, '相手企業')
        .replace(/Bangkok HQ/gu, '海外本部')
        .replace(/DialogAI/gu, '顧客向けプロダクト')
        .replace(/SenpaiNurse/gu, '業務システム')
        .replace(/SmartFront/gu, '業務ダッシュボード')
        .replace(/TechKnight/gu, '事業会社')
        .replace(/NCOM/gu, '相手組織');
}

function normalizeCognitiveType(value) {
    return ALLOWED_COGNITIVE_TYPES.has(value) ? value : 'insight';
}

function idPart(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '')
        .slice(0, 80);
}

function projectOrDefault(meeting) {
    if (meeting.project_code) return meeting.project_code;
    if (String(meeting.repo || '').includes('salestailor')) return 'salestailor';
    return 'brainbase';
}

function orgsFor(projectCode) {
    return PROJECT_ORGS[projectCode] || ['unson', projectCode].filter(Boolean);
}

function sourcePathFor(meeting, sourceKind = 'minutes') {
    if (sourceKind === 'transcript' && meeting.transcript_path) return meeting.transcript_path;
    return meeting.path;
}

function sourceUrlFor(meeting, sourceKind = 'minutes') {
    if (sourceKind === 'transcript' && meeting.transcript_html_url) {
        return meeting.transcript_html_url;
    }
    if (sourceKind !== 'transcript' || !meeting.transcript_path || !meeting.html_url) {
        return meeting.html_url || null;
    }
    return String(meeting.html_url).replace(/\/meetings\/minutes\//u, '/meetings/transcripts/').replace(/\.md$/u, '.txt');
}

function githubRef(meeting, suffix, sourceKind = 'minutes') {
    return `github:${meeting.repo}:${sourcePathFor(meeting, sourceKind)}#${suffix}`;
}

function buildCandidate({
    meeting,
    date,
    identity,
    key,
    category,
    cognitiveType,
    body,
    confidence = 0.78,
    memoryLayer = MEMORY_LAYER_SNS_READY,
    agentRole = 'sns_projection',
    sourceKind = 'minutes',
    projectionOf = null,
    sensitivity = 'internal',
    redactionStatus = 'none',
    retrievalPurpose = memoryLayer === MEMORY_LAYER_CORE ? 'owner_judgment' : 'sns_generation',
    projectionAllowed = sensitivity === 'internal' && redactionStatus === 'none',
    projectionGate = projectionAllowed ? 'sns_projection_can_use_after_context_review' : 'redact_or_approve_before_sns_team_org',
    promotionScopeCandidate = projectionAllowed ? ['personal', 'team_candidate'] : ['personal'],
    sensitivityReason = null,
    bodyMaxLength = MAX_BODY_LENGTH
}) {
    const access = requirePersonalKgIdentity(identity);
    const projectCode = projectOrDefault(meeting);
    const sourceEventId = githubRef(meeting, `${memoryLayer}:${key}`, sourceKind);
    const sourcePath = sourcePathFor(meeting, sourceKind);
    const sourceUrl = sourceUrlFor(meeting, sourceKind);
    const meetingSlug = idPart(String(sourcePath || 'meeting').split('/').pop()?.replace(/\.[^.]+$/u, '') || 'meeting');
    const stableId = `oyasumi_${date.replace(/-/gu, '')}_${idPart(projectCode)}_${meetingSlug}_${idPart(memoryLayer)}_${idPart(key)}`.slice(0, 180);
    return {
        id: stableId,
        cognitive_type: cognitiveType,
        owner_person_id: access.owner_person_id,
        actor_person_id: access.actor_person_id,
        organization_id: access.organization_id,
        source_system: SOURCE_SYSTEM,
        source_event_ids: [sourceEventId],
        workspace: 'github',
        project_code: projectCode,
        org_ids: access.org_ids,
        project_ids: [projectCode],
        visibility: 'owner',
        sensitivity,
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'candidate',
        requires_approval: true,
        redaction_status: redactionStatus,
        confidence,
        body: compact(body, bodyMaxLength),
        permission_snapshot: {
            oyasumi_meeting_personal_kg: {
                category,
                memory_layer: memoryLayer,
                agent_role: agentRole,
                source_kind: sourceKind,
                projection_of: projectionOf,
                retrieval_purpose: retrievalPurpose,
                projection_allowed: projectionAllowed,
                sns_projection_allowed: memoryLayer === MEMORY_LAYER_SNS_READY || projectionAllowed,
                projection_gate: projectionGate,
                promotion_scope_candidate: promotionScopeCandidate,
                sensitivity_reason: sensitivityReason,
                personal_core_detail_policy: 'preserve_details_needed_for_owner_judgment',
                non_owner_retrieval_policy: memoryLayer === MEMORY_LAYER_CORE
                    ? 'deny_core_details_without_projection_or_promotion'
                    : 'projection_read_only',
                meeting_date: date,
                repo: meeting.repo,
                path: sourcePath,
                minutes_path: meeting.path,
                transcript_path: meeting.transcript_path || null,
                html_url: sourceUrl,
                sha: meeting.sha || null,
                extraction_decision: 'adopted',
                rule_id: key,
                source_ref: sourceEventId,
                personal_kg_identity: {
                    owner_person_id: access.owner_person_id,
                    actor_person_id: access.actor_person_id,
                    organization_id: access.organization_id
                }
            }
        },
        evidence_ids: [{
            uri: sourceUrl || sourceEventId,
            source_ref: sourceEventId,
            sha: meeting.sha || null
        }]
    };
}

function coreCandidateProjectionSourceRef(candidate) {
    const kg = candidate.permission_snapshot?.oyasumi_meeting_personal_kg || {};
    return `${kg.source_ref || candidate.source_event_ids?.[0] || candidate.id}#sns_ready_projection`;
}

function projectSnsReadyCandidateFromCore(candidate, identity) {
    const access = requirePersonalKgIdentity(identity);
    if (!isPersonalKgCandidateInScope(candidate, access)) return null;
    const kg = candidate.permission_snapshot?.oyasumi_meeting_personal_kg || {};
    if (kg.memory_layer !== MEMORY_LAYER_CORE) return null;
    if (candidate.sensitivity === 'restricted') return null;
    if (SNS_PROJECTION_BLOCKED_CATEGORIES.has(kg.category)) return null;
    if (kg.agent_role === 'semantic_personal_kg_extractor' && (candidate.sensitivity !== 'internal' || candidate.redaction_status !== 'none')) return null;
    if (kg.agent_role === 'semantic_personal_kg_extractor' && /\[REDACTED|REDACTED -/u.test(candidate.body || '')) return null;
    if (kg.agent_role === 'semantic_personal_kg_extractor' && SEMANTIC_SNS_BLOCK_PATTERN.test(candidate.body || '')) return null;
    const bodyParts = structuredBodyParts(candidate.body);
    const pattern = bodyParts['Reusable Pattern'] || bodyParts.Judgment || candidate.body;
    const applyWhen = bodyParts['Apply When'] || '';
    const doNotApplyWhen = bodyParts['Do Not Apply When'] || '';
    const projectedBody = compact([
        `Reusable Pattern: ${redactSnsProjectionText(pattern)}`,
        applyWhen ? `Apply When: ${redactSnsProjectionText(applyWhen)}` : '',
        doNotApplyWhen ? `Do Not Apply When: ${redactSnsProjectionText(doNotApplyWhen)}` : ''
    ].filter(Boolean).join(' '), 360);
    if (!projectedBody || /娘|心臓|手術|医師|家族|疾患|遺伝|月額予算\s*\d|月\d+[〜~\-から]\d+件/u.test(projectedBody)) {
        return null;
    }
    const sourceRef = coreCandidateProjectionSourceRef(candidate);
    const projectionId = `${String(candidate.id).replace('_personal_kg_core_', '_sns_ready_')}_projection`.slice(0, 180);
    return {
        id: projectionId,
        cognitive_type: normalizeCognitiveType(candidate.cognitive_type),
        owner_person_id: access.owner_person_id,
        actor_person_id: access.actor_person_id,
        organization_id: access.organization_id,
        source_system: SOURCE_SYSTEM,
        source_event_ids: [sourceRef],
        workspace: candidate.workspace || 'github',
        channel_id: candidate.channel_id || null,
        thread_ts: candidate.thread_ts || null,
        project_code: candidate.project_code || null,
        org_ids: access.org_ids,
        project_ids: candidate.project_ids || [],
        team_id: candidate.team_id || null,
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: candidate.role_min || 'member',
        agency_level: 'synthesize',
        recommended_subject_type: MEMORY_LAYER_SNS_READY,
        recommended_owner_person_id: candidate.recommended_owner_person_id || null,
        promotion_status: 'candidate',
        requires_approval: true,
        redaction_status: 'none',
        confidence: Math.min(Number(candidate.confidence || 0.72), 0.82),
        body: projectedBody,
        permission_snapshot: {
            oyasumi_meeting_personal_kg: {
                category: kg.category || 'operating_principle',
                category_rule_id: kg.category_rule_id || null,
                memory_layer: MEMORY_LAYER_SNS_READY,
                agent_role: 'sns_projection',
                source_kind: kg.source_kind || 'minutes',
                projection_of: candidate.id,
                retrieval_purpose: 'sns_generation',
                projection_allowed: true,
                sns_projection_allowed: true,
                projection_gate: 'sns_projection_can_use_after_context_review',
                promotion_scope_candidate: ['personal'],
                sensitivity_reason: null,
                personal_core_detail_policy: 'projection_only_abstracted_from_owner_core',
                non_owner_retrieval_policy: 'projection_read_only',
                meeting_date: kg.meeting_date || null,
                repo: kg.repo || null,
                path: kg.path || null,
                minutes_path: kg.minutes_path || null,
                transcript_path: kg.transcript_path || null,
                html_url: kg.html_url || null,
                sha: kg.sha || null,
                extraction_decision: 'projected',
                rule_id: `${kg.rule_id || candidate.id}:sns_ready_projection`,
                source_ref: sourceRef,
                personal_kg_identity: {
                    owner_person_id: access.owner_person_id,
                    actor_person_id: access.actor_person_id,
                    organization_id: access.organization_id
                }
            }
        },
        evidence_ids: [
            ...(candidate.evidence_ids || []),
            { uri: `candidate:${candidate.id}`, source_ref: candidate.id }
        ]
    };
}

function projectSnsReadyCandidatesFromCoreCandidates(candidates = [], identity) {
    const access = requirePersonalKgIdentity(identity);
    return dedupeBySourceEvent(candidates
        .map((candidate) => projectSnsReadyCandidateFromCore(candidate, access))
        .filter(Boolean));
}

const ADOPTION_RULES = [
    {
        key: 'ai-sales-agency',
        category: 'sales_philosophy',
        cognitiveType: 'insight',
        matches: (content) => /月20万.*半年500万円/u.test(content) && /営業代行/u.test(content),
        body: 'AI活用支援の相談は案件幅が大きく、営業代行で現金化しながら自社プロダクトの導入機会を作る動線がある。'
    },
    {
        key: 'salestailor-conversion-proof',
        category: 'proof',
        cognitiveType: 'result',
        matches: (content) => /商談化率\s*3%\s*[→\-~〜]\s*10%/u.test(content),
        body: 'Own Proof: SalesTailorは高単価・未定形商材の営業で、商談化率3%から10%への改善実績が評価された。'
    },
    {
        key: 'letter-quality-reduces-rejection',
        category: 'sales_philosophy',
        cognitiveType: 'insight',
        matches: (content) => /文面.*断られることがほぼなく/u.test(content) || /文面作成.*本質的に伸びる/u.test(content),
        body: 'SalesTailorの手紙営業では、文面の質と相手理解を上げることで、断られにくい信頼形成を作れる。AI時代でも営業の価値は文面の審美眼に残る。'
    },
    {
        key: 'ai-adoption-aesthetic-judgment',
        category: 'operating_principle',
        cognitiveType: 'preference',
        matches: (content) => /組織的活用.*3%未満/u.test(content) || /重要なのは審美眼/u.test(content),
        body: 'AI活用で差が出るのはツール利用そのものではなく、何が良い出力かを見抜く審美眼と、組織で使える形に落とす運用設計である。'
    },
    {
        key: 'sales-prompt-knowledge-sharing',
        category: 'operating_principle',
        cognitiveType: 'preference',
        matches: (content) => /AIプロンプト.*Slack.*DM/u.test(content) || /生意気なChatGPTプロンプト/u.test(content),
        body: 'AI活用の学習は、抽象論ではなく現場で使えるプロンプトや判断基準を共有し、相手の業務文脈に合わせて使える状態にすることが重要である。'
    }
];

const PERSONAL_KG_CORE_RULES = [
    {
        key: 'ai-sales-agency-confidential-business-context',
        category: 'sales_philosophy',
        cognitiveType: 'insight',
        sourceKind: 'minutes',
        sensitivity: 'confidential',
        redactionStatus: 'needs_redaction',
        projectionAllowed: false,
        projectionGate: 'redact_or_approve_before_sns_team_org',
        promotionScopeCandidate: ['personal', 'team_candidate'],
        sensitivityReason: 'counterparty_confidential_business_context',
        matches: (content) => /月20万.*半年500万円/u.test(content) && /営業代行/u.test(content),
        body: 'Context: AI活用支援の相談は月20万から半年500万円規模まで幅があり、営業代行として受注した案件から月5から10件程度のリード獲得や月額予算15万円程度の話が出ていた。 Judgment: 佐藤は、AI受託・営業代行を短期キャッシュだけでなく、自社プロダクト導入機会の入口として見る。'
    },
    {
        key: 'ai-automation-proposal-needs-ops-log-and-hq-story',
        category: 'operating_principle',
        cognitiveType: 'insight',
        sourceKind: 'minutes',
        sensitivity: 'confidential',
        redactionStatus: 'needs_redaction',
        projectionAllowed: true,
        projectionGate: 'sns_projection_can_use_after_context_review',
        promotionScopeCandidate: ['personal'],
        sensitivityReason: 'counterparty_confidential_business_context',
        matches: (content, meeting) => /ota-setup-automation-proposal/u.test(meeting.path || '') && /YCS|OTA|Agoda|Bangkok HQ|セットアップ業務/u.test(content) && /AI|自動化|半自動/u.test(content),
        body: 'Context: TechKnightでAgoda JapanのYCSセットアップ業務をAIで半自動化する提案を検討していた。先方は日本側だけでなくBangkok HQへ説明する必要があり、提案は英語資料・実績資料・YCSログ確認を前提にしていた。 Judgment: 佐藤は、単なる画面操作代行ではなく、実ログから業務フローを掴み、海外本部に通る提案ストーリーへ変換できる点に事業機会を見た。 Reusable Pattern: AI自動化案件は「操作をAIにやらせる」では弱い。現場ログ、決裁者向け説明、実績資料が揃うと高単価提案になりやすい。 Apply When: 相手側に反復業務ログがあり、社内決裁者へ説明する材料が必要なB2B自動化案件。 Do Not Apply When: 画面操作の単発代行だけで、業務フローや決裁文脈に踏み込めない案件。'
    },
    {
        key: 'review-before-execution-for-quality-risk',
        category: 'operating_principle',
        cognitiveType: 'preference',
        sourceKind: 'minutes',
        matches: (content, meeting) => /team-dev-quality-issues/u.test(meeting.path || '') && /品質問題|設計ミス|テスト.*不十分|必ず一次確認/u.test(content),
        body: 'Context: TechKnightで特定メンバーの実装品質・確認不足が続き、顧客影響や手戻りが出る懸念が出ていた。会議では作業前レビューやテスト体制の見直しが論点になった。 Judgment: 佐藤は人格評価や叱責ではなく、作業前レビュー・設計確認・テスト体制を先に置く運用変更として扱った。 Reusable Pattern: 品質問題は「人の問題」と断定せず、レビュー導線と責任分界を先に設計する。 Apply When: 同じ種類のミスや確認不足が続き、本人任せの改善では顧客影響が出そうな時。 Do Not Apply When: 一度きりの軽微なミスや、本人に十分な前提共有がされていない段階。'
    },
    {
        key: 'role-fit-reassignment-is-operations-design',
        category: 'operating_principle',
        cognitiveType: 'preference',
        sourceKind: 'minutes',
        matches: (content, meeting) => /team-dev-quality-issues/u.test(meeting.path || '') && /バックオフィス担当|作業.*移行|タスク.*振り分け|担当.*再配置/u.test(content),
        body: 'Context: TechKnightの会議で、品質課題や展示会・出張・請求などのバックオフィス作業が並行しており、誰に何を任せるかの再配置が必要になっていた。 Judgment: 佐藤は、不得意な仕事を責めるより、役割を変えて得意な置き場所に移すことで全体の詰まりを取ろうとした。 Reusable Pattern: メンバーの問題に見えるものは、仕事の置き場所の問題として再設計できることがある。 Apply When: 個人の能力不足よりも、担当業務の種類と本人の適性がズレている可能性が高い時。 Do Not Apply When: 権限・期限・品質責任を曖昧にしたまま、単に担当だけを移してしまう時。'
    },
    {
        key: 'direct-edit-dashboard-over-admin-heavy-cms',
        category: 'operating_principle',
        cognitiveType: 'preference',
        sourceKind: 'minutes',
        matches: (content, meeting) => /weekly-team-progress-update/u.test(meeting.path || '') && /CMS|直接編集|サイト上で直接編集|WordPress|本部ダッシュボード/u.test(content),
        body: 'Context: SmartFrontの本部ダッシュボードで、運用者が情報を更新し続ける前提のUIが必要になっていた。CMS的な実装方向が論点だった。 Judgment: 佐藤は、管理画面を重く作るより、WordPressのように直接編集できる運用者寄りの体験がよいと見た。 Reusable Pattern: 継続運用されるダッシュボードは、機能の網羅性より編集導線の自然さが重要になる。 Apply When: 非エンジニアや現場担当者が頻繁に文言・表示内容を更新する画面。 Do Not Apply When: 承認フロー、監査証跡、権限分離が厳密に必要な管理画面。'
    },
    {
        key: 'ops-ssot-should-live-where-team-works',
        category: 'operating_principle',
        cognitiveType: 'preference',
        sourceKind: 'minutes',
        matches: (content, meeting) => /weekly-team-progress-update/u.test(meeting.path || '') && /環境変数|運用情報|Slack canvas|SSOT|タスク管理.*通知/u.test(content),
        body: 'Context: SmartFront定例で、環境変数や運用情報が散らばり、タスク管理や開発通知の経路も混線していた。Slack canvasへの集約が話題になった。 Judgment: 佐藤は、運用情報は「探すドキュメント」ではなく、チームが実際に毎日見る場所へ置くべきだと判断した。 Reusable Pattern: SSOTは正しい保管場所より、運用者が自然に参照する導線に置く方が機能しやすい。 Apply When: 開発・運用情報の散逸で確認漏れや属人化が起きている時。 Do Not Apply When: 権限管理や秘密情報管理が必要で、Slack等に置くと漏洩リスクが高い情報。'
    },
    {
        key: 'healthcare-workflow-ui-must-reduce-next-action-ambiguity',
        category: 'content_design',
        cognitiveType: 'insight',
        sourceKind: 'minutes',
        sensitivity: 'restricted',
        matches: (content, meeting) => /hospital-discharge-support-system-meeting/u.test(meeting.path || '') && /退院支援|チェックリスト|初期値|ハイライト/u.test(content) && /UI|入力/u.test(content),
        body: 'Context: SenpaiNurseで退院支援の入力UIを改善しており、訪問前に作業版を出す必要があった。ハイライト、初期値、退院支援チェックリストが論点だった。 Judgment: 佐藤は、医療/介護系UIでは機能量より「次に何を入力・確認すべきか」を迷わせないことを重視した。 Reusable Pattern: 業務UIの価値は、入力項目数ではなく次アクションの曖昧さを減らすことにある。 Apply When: 現場ユーザーが制度要件や判断手順に沿って入力する必要があるUI。 Do Not Apply When: 熟練者向けで自由度や高速入力を優先すべきUI。'
    },
    {
        key: 'avoid-duplicate-excel-by-embedding-billing-requirements',
        category: 'operating_principle',
        cognitiveType: 'insight',
        sourceKind: 'minutes',
        sensitivity: 'restricted',
        matches: (content, meeting) => /patient-discharge-support-ai/u.test(meeting.path || '') && /Excel|ハンドブック|加算要件|請求要件/u.test(content) && /退院支援|システム/u.test(content),
        body: 'Context: SenpaiNurseで退院支援の既存Excelチャート、東京都退院支援ハンドブック、加算要件をシステムにどう取り込むかを議論していた。 Judgment: 佐藤は、Excelとシステムを並行運用すると二重入力になるため、請求要件やチェックリストを自然な画面入力に埋め込むべきだと見た。 Reusable Pattern: 既存Excelを単に置き換えるのではなく、制度要件を業務フローに埋め込むと現場負荷が下がる。 Apply When: Excel運用が制度要件や請求要件を満たすために残っている業務。 Do Not Apply When: Excelが一時的な分析・集計用途で、業務フロー自体ではない場合。'
    },
    {
        key: 'consulting-revenue-now-theme-hook-later',
        category: 'sales_philosophy',
        cognitiveType: 'insight',
        sourceKind: 'minutes',
        sensitivity: 'confidential',
        redactionStatus: 'needs_redaction',
        projectionAllowed: true,
        projectionGate: 'sns_projection_can_use_after_context_review',
        promotionScopeCandidate: ['personal'],
        sensitivityReason: 'counterparty_confidential_business_context',
        matches: (content, meeting) => /project-progress-ai-study-meeting/u.test(meeting.path || '') && /AI勉強会|Webアプリケーション診断|フィジカルAI|Physical AI|前さばき支援/u.test(content) && /短期|長期|新規テーマ|探索/u.test(content),
        body: 'Context: NCOMでAI勉強会・Webアプリ診断・Physical AIの話題が同時に出ていた。短期売上と新テーマ開拓をどう扱うかが論点だった。 Judgment: 佐藤は、AI勉強会や診断を短期売上として維持しつつ、Physical AIは本題にしすぎず次の組織テーマのフックとして扱うのがよいと見た。 Reusable Pattern: 既存提供モデルで短期売上を作りながら、新テーマは軽く差し込んで将来の会話余地を作る。 Apply When: 既存案件で売上化できる型があり、相手組織に新テーマ探索の兆しがある時。 Do Not Apply When: 新テーマを出すことで本題の意思決定や納品責任がぼやける時。'
    },
    {
        key: 'separate-facts-and-hypotheses-before-taskforce',
        category: 'operating_principle',
        cognitiveType: 'preference',
        sourceKind: 'minutes',
        matches: (content, meeting) => /taskforce-ai-consulting-proposal/u.test(meeting.path || '') && /事実と推察を分ける|事実.*仮説|ヒアリングリスト|タスクフォース/u.test(content),
        body: 'Context: NCOMのタスクフォース準備で、ヒアリング内容・Physical AI・過去資料・仮説をどう整理するかが論点だった。 Judgment: 佐藤は、抽象的な構想に逃げず、事実と仮説を分けて、会議で何を確認すべきかを明確にすることを重視した。 Reusable Pattern: 戦略会議の前には、確認済みの事実、未確認の仮説、次に聞く質問を分ける。 Apply When: 複数テーマが混ざり、会議で聞くべきことが曖昧になっている時。 Do Not Apply When: すでに意思決定済みで、実行タスクだけを進めればよい時。'
    },
    {
        key: 'production-changes-require-before-after-reporting',
        category: 'operating_principle',
        cognitiveType: 'preference',
        sourceKind: 'minutes',
        matches: (content, meeting) => /project-progress-ai-study-meeting/u.test(meeting.path || '') && /Webアプリケーション診断|指摘事項|受け入れテスト|リグレッションテスト|本番/u.test(content),
        body: 'Context: DialogAIのメディアアップロード不具合とデプロイ報告のやり取りで、本番や顧客影響のある変更の共有不足が問題になっていた。 Judgment: 佐藤は、善意で先に直すよりも、作業前・作業後の報告と状態共有を優先すべきだと判断した。 Reusable Pattern: 本番影響のある変更は、実装力よりも可視性と復旧可能性を先に守る。 Apply When: 顧客影響、本番反映、診断・検収に関わる変更を行う時。 Do Not Apply When: 完全にローカルで閉じた検証や、誰にも影響しない試作。'
    },
    {
        key: 'act-directly-when-physical-resource-bottleneck-causes-waiting',
        category: 'operating_principle',
        cognitiveType: 'preference',
        sourceKind: 'transcript',
        matches: (content, meeting) => /weekly-progress-meeting-webfp/u.test(meeting.path || '') && /できるとこあれば|戻ってきて.*時間がもったいない|時間がもったいない気もしなくもない/u.test(content),
        body: 'Context: NCOMのWebFP進捗会議で、確認作業が相手側のPCや担当者の戻り待ちになりそうな場面があった。 Judgment: 佐藤は、自分で動ける確認なら戻り待ちにせず手を出した方が速いと判断した。 Reusable Pattern: 確認作業のボトルネックが他人物理リソースや担当者待ちなら、権限と影響範囲を確認したうえで自分が代行して詰まりを取る。 Apply When: 待ち時間が成果を遅らせ、本人が確認可能で、代行しても責任境界を壊さない時。 Do Not Apply When: 権限、監査、顧客合意、本人確認が必要で、代行すると責任所在が曖昧になる時。'
    },
    {
        key: 'hearing-should-start-simple-with-few-questions',
        category: 'content_design',
        cognitiveType: 'preference',
        sourceKind: 'transcript',
        matches: (content, meeting) => /weekly-progress-meeting-webfp/u.test(meeting.path || '') && /質問が多すぎる|シンプルにヒアリング|よく喋ってくれる2名/u.test(content),
        body: 'Context: NCOMのWebFP進捗会議で、ヒアリング設計の質問数や入り方が論点になった。 Judgment: 佐藤は、質問を増やして網羅するより、よく話してくれる少数の相手に絞り、シンプルにヒアリングから入る方がよいと判断した。 Reusable Pattern: 初回ヒアリングは質問数を絞り、相手が自然に話せる入口を作る。 Apply When: 相手の課題や温度感をまだ探索しており、網羅的な質問票が会話を重くしそうな時。 Do Not Apply When: 法務、監査、要件確定など、漏れなく確認すること自体が目的の場面。'
    },
    {
        key: 'sensitive-counterparty-context-still-belongs-in-owner-kg',
        category: 'operating_principle',
        cognitiveType: 'claim',
        sourceKind: 'minutes',
        sensitivity: 'confidential',
        redactionStatus: 'needs_redaction',
        projectionAllowed: true,
        projectionGate: 'sns_projection_can_use_after_context_review',
        promotionScopeCandidate: ['personal'],
        sensitivityReason: 'counterparty_confidential_business_context',
        matches: (content, meeting) => /team-dev-quality-issues/u.test(meeting.path || '') && /NDA|月額予算|未公開|価格改定|予算|顧問先/u.test(content),
        body: 'Context: 議事録には、相手企業や顧問先の未公開事情・予算感に見える情報が含まれることがある。 Judgment: 佐藤は、SNSに出せない情報でも、自分の判断OSには必要な背景としてowner-visibleに残すべきだと考えている。 Reusable Pattern: 個人KGの本体は公開素材ではない。公開不可情報は捨てず、visibility・sensitivity・redactionで扱いを分ける。 Apply When: AIが佐藤圭吾として判断するために必要だが、外部公開やチーム共有には向かない背景情報。 Do Not Apply When: 法令・契約・個人情報上、保存自体が不適切な情報や、不要な秘密そのもの。'
    },
    {
        key: 'brainbase-thinks-as-my-brain',
        category: 'philosophy',
        cognitiveType: 'claim',
        sourceKind: 'transcript',
        matches: (content) => /俺の脳で考えて|哲学.*データベース|関連する思想/u.test(content),
        body: 'Brainbaseは、自分の哲学や判断基準をデータベース化し、「俺の脳で考えて」と言える状態を作るための個人脳である。'
    },
    {
        key: 'ai-non-submissive-dialogue',
        category: 'operating_principle',
        cognitiveType: 'preference',
        sourceKind: 'transcript',
        matches: (content) => /媚び|生意気なChatGPT|議論させる/u.test(content),
        body: 'AIに媚びさせるのではなく、生意気に議論させることで、人間側の審美眼と判断基準を鍛える。'
    },
    {
        key: 'claude-codex-task-fit',
        category: 'operating_principle',
        cognitiveType: 'preference',
        sourceKind: 'transcript',
        matches: (content) => /Claude Code.*Codex|Codex.*Claude Code|トークン.*向き不向き/u.test(content),
        body: 'Claude CodeとCodexは優劣ではなく、タスクとトークンの向き不向きで使い分ける実務ツールである。'
    },
    {
        key: 'ai-democratizes-like-excel',
        category: 'philosophy',
        cognitiveType: 'hypothesis',
        sourceKind: 'transcript',
        matches: (content) => /Excel.*民主化|民主化.*Excel/u.test(content) && /AI/u.test(content),
        body: 'AIはExcelのように民主化する。差が出るのはツールを触れることではなく、会社で使える形に落とす設計である。'
    }
];

const MEDICAL_PATTERN = /医療|健康|病気|疾患|心臓|大動脈|気管|手術|医師|症状|遺伝/u;
const PRIVATE_PATTERN = /家族|娘|息子|奥様|妻|夫婦|個人的な近況|プライベート/u;
const COUNTERPARTY_CONFIDENTIAL_PATTERN = /顧問先|月5[〜~\-]10件|月額予算|未公開|NDA/u;

function extractSections(content) {
    const lines = String(content || '').split('\n');
    /** @type {Array<{title: string, body: string}>} */
    const sections = [];
    let current = { title: 'document', body: '' };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        const headingMatch = line.match(/^(#{1,3}\s+|:[a-z_]+:\s*)?[*#\s]*([^*\n#]+?)[*#\s]*$/iu);
        const looksLikeHeading = /^#{1,3}\s+/u.test(line) || /^:[a-z_]+:\s*\*/iu.test(line);
        if (looksLikeHeading && headingMatch) {
            if (current.body.trim()) sections.push(current);
            current = { title: stripMarkdown(line), body: '' };
        } else {
            current.body += `${rawLine}\n`;
        }
    }
    if (current.body.trim()) sections.push(current);
    return sections;
}

function rejectSensitiveSections(meeting, date) {
    const rejected = [];
    for (const section of extractSections(meeting.content || '')) {
        const text = `${section.title}\n${section.body}`;
        const hasMedical = MEDICAL_PATTERN.test(text);
        const hasPrivate = PRIVATE_PATTERN.test(text);
        if (!hasMedical && !hasPrivate) continue;
        const reason = hasMedical ? 'medical_or_health' : 'private_or_family';
        rejected.push({
            reason,
            source_ref: githubRef(meeting, `section:${idPart(section.title || reason)}`),
            meeting_date: date,
            repo: meeting.repo,
            path: meeting.path,
            summary: compact(stripMarkdown(section.title || reason), 120)
        });
    }
    return rejected;
}

function extractSensitiveCoreSections(meeting, date, identity) {
    const adopted = [];
    for (const section of extractSections(meeting.content || '')) {
        const text = `${section.title}\n${section.body}`;
        const hasMedical = MEDICAL_PATTERN.test(text);
        const hasPrivate = PRIVATE_PATTERN.test(text);
        if (!hasMedical && !hasPrivate) continue;
        const reason = hasMedical ? 'medical_or_health' : 'private_or_family';
        adopted.push(buildCandidate({
            meeting,
            date,
            identity,
            key: `${reason}-${idPart(section.title || 'sensitive-context')}`,
            category: 'persona_understanding',
            cognitiveType: 'observation',
            body: `Context: ${compact(stripMarkdown(text), 180)} Judgment: この私的背景は本人の判断再現にだけ使い、SNS・team・org projectionにはそのまま出さない。`,
            confidence: 0.68,
            memoryLayer: MEMORY_LAYER_CORE,
            agentRole: 'sensitivity_reviewer',
            sourceKind: 'minutes',
            sensitivity: hasMedical ? 'confidential' : 'restricted',
            redactionStatus: 'needs_redaction',
            projectionAllowed: false,
            projectionGate: 'redact_or_approve_before_sns_team_org',
            promotionScopeCandidate: ['personal'],
            sensitivityReason: reason
        }));
    }
    return adopted;
}

function needsHumanReview(meeting, date) {
    const content = String(meeting.content || '');
    if (!COUNTERPARTY_CONFIDENTIAL_PATTERN.test(content)) return [];
    return [{
        reason: 'counterparty_confidential',
        source_ref: githubRef(meeting, 'needs_review:counterparty-confidential'),
        meeting_date: date,
        repo: meeting.repo,
        path: meeting.path,
        summary: '相手企業や顧問先の未公開予算・リード数に見える情報は、人間確認なしにSNS素材へ使わない。'
    }];
}

function truncateModelInput(value, max = SEMANTIC_MODEL_INPUT_LIMIT) {
    const text = normalizeSpaces(value);
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n[TRUNCATED]`;
}

function buildSemanticExtractorPrompt({ meeting, date }) {
    const source = [
        `date: ${date}`,
        `repo: ${meeting.repo}`,
        `path: ${meeting.path}`,
        `project_code: ${projectOrDefault(meeting)}`,
        '',
        'MINUTES:',
        truncateModelInput(meeting.content || '', 9000),
        '',
        'TRANSCRIPT:',
        truncateModelInput(meeting.transcript_content || '', 9000)
    ].join('\n');

    return {
        system: [
            'You extract owner-only Personal Knowledge Graph candidates for Sato Keigo.',
            'Return JSON only. Do not include markdown.',
            'Extract only durable judgment signals useful for future decisions, not routine task summaries.',
            'Keep personal/confidential details in personal_kg_core when they are needed for owner judgment.',
            'Never mark private, medical, family, secrets, credentials, or raw login details as SNS-ready.',
            'Do not invent facts. Every candidate must be grounded in the provided source.'
        ].join('\n'),
        user: [
            source,
            '',
            'Return this JSON shape:',
            '{"candidates":[{"key":"short-stable-kebab-key","category":"operating_principle|persona_understanding|relationship_context|business_judgment|knowledge_architecture|sales_philosophy|content_design|philosophy|preference","cognitive_type":"observation|insight|claim|preference|hypothesis|experiment|result","sensitivity":"internal|confidential|restricted","redaction_status":"none|needs_redaction","confidence":0.0,"source_kind":"minutes|transcript","body":"Context: ... Judgment: ... Reusable Pattern: ... Apply When: ... Do Not Apply When: ..."}]}',
            '',
            'Rules:',
            '- 0 to 6 candidates.',
            '- body must include Context, Judgment, Reusable Pattern, Apply When, and Do Not Apply When.',
            '- Write body in Japanese unless the source itself is a product name or quoted English term.',
            '- sensitivity=restricted for family/private/personal logistics or credentials/login context.',
            '- sensitivity=confidential for counterparty business context, budgets, non-public plans, or negotiations.',
            '- redaction_status=needs_redaction unless the candidate is safe internal operating philosophy.',
            '- Prefer fewer high-signal candidates over exhaustive notes.'
        ].join('\n')
    };
}

function parseSemanticExtractorResponse(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.candidates)) return raw.candidates;
    if (typeof raw !== 'string') return [];
    try {
        const parsed = JSON.parse(raw);
        return parseSemanticExtractorResponse(parsed);
    } catch {
        const match = raw.match(/\{[\s\S]*\}/u);
        if (!match) return [];
        try {
            const parsed = JSON.parse(match[0]);
            return parseSemanticExtractorResponse(parsed);
        } catch {
            return [];
        }
    }
}

function normalizeSemanticBody(draft) {
    const body = normalizeSpaces(draft?.body || '');
    if (/Context:.*Judgment:/u.test(body)) return body;
    return [
        `Context: ${normalizeSpaces(draft?.context || body)}`,
        `Judgment: ${normalizeSpaces(draft?.judgment || draft?.summary || '')}`,
        `Reusable Pattern: ${normalizeSpaces(draft?.reusable_pattern || draft?.pattern || '')}`,
        `Apply When: ${normalizeSpaces(draft?.apply_when || '')}`,
        `Do Not Apply When: ${normalizeSpaces(draft?.do_not_apply_when || '')}`
    ].filter((part) => !part.endsWith(': ')).join(' ');
}

function semanticSensitivityForDraft(draft, body) {
    const text = `${draft?.category || ''} ${draft?.sensitivity_reason || ''} ${body}`;
    const medical = MEDICAL_PATTERN.test(text);
    const privateContext = PRIVATE_PATTERN.test(text) || /ログイン情報|パスワード|プライベートメール|受験|報酬条件|時給|ペナルティ/u.test(text);
    if (medical) {
        return {
            category: 'medical_or_health',
            sensitivity: 'confidential',
            redactionStatus: 'needs_redaction',
            projectionAllowed: false,
            projectionGate: 'redact_or_approve_before_sns_team_org',
            promotionScopeCandidate: ['personal'],
            sensitivityReason: 'medical_or_health'
        };
    }
    if (privateContext) {
        return {
            category: 'private_or_family',
            sensitivity: 'restricted',
            redactionStatus: 'needs_redaction',
            projectionAllowed: false,
            projectionGate: 'redact_or_approve_before_sns_team_org',
            promotionScopeCandidate: ['personal'],
            sensitivityReason: 'private_or_family'
        };
    }

    const sensitivity = ALLOWED_SEMANTIC_SENSITIVITY.has(draft?.sensitivity) ? draft.sensitivity : 'internal';
    const redactionStatus = ALLOWED_SEMANTIC_REDACTION_STATUS.has(draft?.redaction_status) ? draft.redaction_status : 'none';
    const projectionAllowed = sensitivity === 'internal' && redactionStatus === 'none';
    return {
        category: normalizeSpaces(draft?.category || 'operating_principle') || 'operating_principle',
        sensitivity,
        redactionStatus,
        projectionAllowed,
        projectionGate: projectionAllowed ? 'sns_projection_can_use_after_context_review' : 'redact_or_approve_before_sns_team_org',
        promotionScopeCandidate: projectionAllowed ? ['personal', 'team_candidate'] : ['personal'],
        sensitivityReason: draft?.sensitivity_reason || null
    };
}

function semanticCandidateFromDraft({ meeting, date, draft, index, identity }) {
    const body = normalizeSemanticBody(draft);
    if (!body || body.length < 40) return null;
    const sensitivity = semanticSensitivityForDraft(draft, body);
    const sourceKind = draft?.source_kind === 'transcript' && meeting.transcript_content ? 'transcript' : 'minutes';
    return buildCandidate({
        meeting,
        date,
        identity,
        key: `semantic-${idPart(draft?.key || sensitivity.category || `candidate-${index}`)}`,
        category: sensitivity.category,
        cognitiveType: normalizeCognitiveType(draft?.cognitive_type),
        body,
        confidence: Math.min(Math.max(Number(draft?.confidence || 0.72), 0.45), 0.9),
        memoryLayer: MEMORY_LAYER_CORE,
        agentRole: 'semantic_personal_kg_extractor',
        sourceKind,
        sensitivity: sensitivity.sensitivity,
        redactionStatus: sensitivity.redactionStatus,
        projectionAllowed: sensitivity.projectionAllowed,
        projectionGate: sensitivity.projectionGate,
        promotionScopeCandidate: sensitivity.promotionScopeCandidate,
        sensitivityReason: sensitivity.sensitivityReason,
        bodyMaxLength: 900
    });
}

async function extractSemanticCoreFromMeeting({ meeting, date, llmClient, identity }) {
    if (!llmClient) return [];
    const prompt = buildSemanticExtractorPrompt({ meeting, date });
    const raw = typeof llmClient.extractPersonalKgCandidates === 'function'
        ? await llmClient.extractPersonalKgCandidates({ meeting, date, prompt })
        : await llmClient(prompt);
    const drafts = parseSemanticExtractorResponse(raw);
    return drafts
        .map((draft, index) => semanticCandidateFromDraft({ meeting, date, draft, index, identity }))
        .filter(Boolean);
}

function dedupeBySourceEvent(candidates) {
    const seenSourceEvents = new Set();
    const seenBodies = new Set();
    const deduped = [];
    for (const candidate of candidates) {
        const sourceKey = candidate.source_event_ids.join('|');
        const bodyKey = normalizeSpaces(candidate.body);
        if (seenSourceEvents.has(sourceKey) || seenBodies.has(bodyKey)) continue;
        seenSourceEvents.add(sourceKey);
        seenBodies.add(bodyKey);
        deduped.push(candidate);
    }
    return deduped;
}

function sanitizeAdopted(candidates) {
    return candidates.filter((candidate) => {
        const memoryLayer = candidate.permission_snapshot?.oyasumi_meeting_personal_kg?.memory_layer;
        if (memoryLayer === MEMORY_LAYER_CORE) return true;
        const body = String(candidate.body || '');
        return !MEDICAL_PATTERN.test(body) && !PRIVATE_PATTERN.test(body) && !/懇親会|飲み会|会食で話した/u.test(body);
    });
}

function extractCoreFromMeeting({ meeting, date, identity }) {
    const transcript = normalizeSpaces(meeting.transcript_content || '');
    const minutes = normalizeSpaces(meeting.content || '');
    const adopted = [];
    for (const rule of PERSONAL_KG_CORE_RULES) {
        const sourceKind = rule.sourceKind === 'transcript' && transcript ? 'transcript' : 'minutes';
        const content = sourceKind === 'transcript' ? transcript : `${minutes} ${transcript}`;
        if (!rule.matches(content, meeting)) continue;
        adopted.push(buildCandidate({
            meeting,
            date,
            identity,
            key: rule.key,
            category: rule.category,
            cognitiveType: rule.cognitiveType,
            body: rule.body,
            confidence: 0.82,
            memoryLayer: MEMORY_LAYER_CORE,
            agentRole: 'personal_kg_extractor',
            sourceKind,
            sensitivity: rule.sensitivity || 'internal',
            redactionStatus: rule.redactionStatus || 'none',
            projectionAllowed: rule.projectionAllowed,
            projectionGate: rule.projectionGate,
            promotionScopeCandidate: rule.promotionScopeCandidate,
            sensitivityReason: rule.sensitivityReason || null,
            bodyMaxLength: rule.bodyMaxLength || 900
        }));
    }
    return sanitizeAdopted(adopted);
}

function projectSnsReadyFromMeeting({ meeting, date, identity }) {
    const content = normalizeSpaces(meeting.content || '');
    const adopted = [];
    for (const rule of ADOPTION_RULES) {
        if (!rule.matches(content)) continue;
        adopted.push(buildCandidate({
            meeting,
            date,
            identity,
            key: rule.key,
            category: rule.category,
            cognitiveType: rule.cognitiveType,
            body: rule.body,
            confidence: rule.category === 'proof' ? 0.88 : 0.8,
            memoryLayer: MEMORY_LAYER_SNS_READY,
            agentRole: 'sns_projection',
            sourceKind: 'minutes',
            projectionOf: rule.key
        }));
    }
    return sanitizeAdopted(adopted);
}

function extractFromMeeting({ meeting, date, identity }) {
    const core = extractCoreFromMeeting({ meeting, date, identity });
    const sensitiveCore = extractSensitiveCoreSections(meeting, date, identity);
    const snsReady = dedupeBySourceEvent([
        ...projectSnsReadyFromMeeting({ meeting, date, identity }),
        ...projectSnsReadyCandidatesFromCoreCandidates([...core, ...sensitiveCore], identity)
    ]);
    return {
        adopted: [...core, ...sensitiveCore, ...snsReady],
        rejected: rejectSensitiveSections(meeting, date),
        needs_review: needsHumanReview(meeting, date)
    };
}

function summarizeExtraction({ date, adopted, rejected, needsReview }) {
    return {
        date,
        source_system: SOURCE_SYSTEM,
        counts: {
            adopted: adopted.length,
            rejected: rejected.length,
            needs_review: needsReview.length
        }
    };
}

function extractMeetingPersonalKgCandidates({ date, meetings = [], identity }) {
    const access = requirePersonalKgIdentity(identity);
    const adopted = [];
    const rejected = [];
    const needsReview = [];
    for (const meeting of meetings) {
        const result = extractFromMeeting({ meeting, date, identity: access });
        adopted.push(...result.adopted);
        rejected.push(...result.rejected);
        needsReview.push(...result.needs_review);
    }
    const finalAdopted = dedupeBySourceEvent(adopted);
    const transcriptSourceCount = meetings.filter((meeting) => meeting.transcript_content).length;
    const coreCount = finalAdopted.filter((candidate) => candidate.permission_snapshot?.oyasumi_meeting_personal_kg?.memory_layer === MEMORY_LAYER_CORE).length;
    const snsReadyCount = finalAdopted.filter((candidate) => candidate.permission_snapshot?.oyasumi_meeting_personal_kg?.memory_layer === MEMORY_LAYER_SNS_READY).length;
    const reports = [
        {
            role: 'meeting_harvester',
            status: 'completed',
            input_count: meetings.length,
            output_count: meetings.length,
            notes: [`transcript_sources=${transcriptSourceCount}`]
        },
        {
            role: 'personal_kg_extractor',
            status: transcriptSourceCount > 0 && coreCount === 0 ? 'needs_review' : 'completed',
            input_count: meetings.length,
            output_count: coreCount,
            notes: transcriptSourceCount > 0 && coreCount === 0
                ? ['transcript was present but no personal_kg_core candidate was extracted']
                : []
        },
        {
            role: 'sensitivity_reviewer',
            status: 'completed',
            input_count: meetings.length,
            output_count: rejected.length + needsReview.length,
            notes: []
        },
        {
            role: 'sns_projection',
            status: 'completed',
            input_count: coreCount,
            output_count: snsReadyCount,
            notes: []
        }
    ];
    return {
        ...summarizeExtraction({ date, adopted: finalAdopted, rejected, needsReview }),
        agent_reports: reports,
        adopted: finalAdopted,
        rejected,
        needs_review: needsReview
    };
}

async function extractMeetingPersonalKgCandidatesSemantic({ date, meetings = [], llmClient, identity }) {
    const access = requirePersonalKgIdentity(identity);
    const ruleExtracted = extractMeetingPersonalKgCandidates({ date, meetings, identity: access });
    const semanticCore = [];
    const semanticReview = [];

    for (const meeting of meetings) {
        try {
            semanticCore.push(...await extractSemanticCoreFromMeeting({ meeting, date, llmClient, identity: access }));
        } catch (error) {
            semanticReview.push({
                reason: 'semantic_extractor_error',
                source_ref: githubRef(meeting, 'semantic_extractor_error'),
                meeting_date: date,
                repo: meeting.repo,
                path: meeting.path,
                summary: error?.message || 'semantic extractor failed'
            });
        }
    }

    const semanticSnsReady = projectSnsReadyCandidatesFromCoreCandidates(semanticCore, access);
    const finalAdopted = dedupeBySourceEvent([
        ...ruleExtracted.adopted,
        ...semanticCore,
        ...semanticSnsReady
    ]);
    const coreCount = finalAdopted.filter((candidate) => candidate.permission_snapshot?.oyasumi_meeting_personal_kg?.memory_layer === MEMORY_LAYER_CORE).length;
    const snsReadyCount = finalAdopted.filter((candidate) => candidate.permission_snapshot?.oyasumi_meeting_personal_kg?.memory_layer === MEMORY_LAYER_SNS_READY).length;
    const semanticCoreCount = semanticCore.length;
    const semanticSnsReadyCount = semanticSnsReady.length;
    const agentReports = [
        ...ruleExtracted.agent_reports,
        {
            role: 'semantic_personal_kg_extractor',
            status: semanticReview.length > 0 ? 'needs_review' : 'completed',
            input_count: meetings.length,
            output_count: semanticCoreCount,
            notes: semanticReview.length > 0
                ? [`errors=${semanticReview.length}`]
                : []
        },
        {
            role: 'semantic_sns_projection',
            status: 'completed',
            input_count: semanticCoreCount,
            output_count: semanticSnsReadyCount,
            notes: []
        },
        {
            role: 'personal_kg_merge',
            status: 'completed',
            input_count: ruleExtracted.adopted.length + semanticCore.length + semanticSnsReady.length,
            output_count: finalAdopted.length,
            notes: [`core=${coreCount}`, `sns_ready=${snsReadyCount}`]
        }
    ];

    return {
        ...summarizeExtraction({
            date,
            adopted: finalAdopted,
            rejected: ruleExtracted.rejected,
            needsReview: [...ruleExtracted.needs_review, ...semanticReview]
        }),
        agent_reports: agentReports,
        adopted: finalAdopted,
        rejected: ruleExtracted.rejected,
        needs_review: [...ruleExtracted.needs_review, ...semanticReview]
    };
}

async function writeMeetingPersonalKgCandidates({ candidateService, extracted, identity }) {
    if (!candidateService || typeof candidateService.createCandidate !== 'function') {
        throw new Error('candidateService with createCandidate required');
    }
    const access = requirePersonalKgIdentity(identity);
    const summary = {
        date: extracted.date,
        source_system: SOURCE_SYSTEM,
        total: extracted.adopted.length,
        inserted: 0,
        skipped: 0,
        blocked: 0,
        ids: [],
        rejected: extracted.rejected || [],
        needs_review: extracted.needs_review || []
    };

    for (const candidate of extracted.adopted) {
        try {
            assertPersonalKgCandidateScope(candidate, access, {}, { requireActorMatch: true });
            const result = await candidateService.createCandidate(candidate);
            if (result.blocked) {
                summary.blocked += 1;
                continue;
            }
            summary.inserted += 1;
            summary.ids.push(result.candidate.id);
        } catch (error) {
            if (error instanceof DuplicateCandidateError || error?.name === 'DuplicateCandidateError') {
                summary.skipped += 1;
                continue;
            }
            throw error;
        }
    }

    return summary;
}

export {
    SOURCE_SYSTEM,
    extractMeetingPersonalKgCandidates,
    extractMeetingPersonalKgCandidatesSemantic,
    projectSnsReadyCandidateFromCore,
    projectSnsReadyCandidatesFromCoreCandidates,
    writeMeetingPersonalKgCandidates
};
