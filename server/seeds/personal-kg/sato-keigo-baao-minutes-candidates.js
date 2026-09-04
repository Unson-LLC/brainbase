// @ts-check
import { createHash } from 'node:crypto';

const SOURCE_SYSTEM = 'baao-minutes-personal-kg-seed';
const SEED_VERSION = '2026-05-12-baao-minutes-v1';
const OWNER_PERSON_ID = 'sato_keigo';
const WORKSPACE = 'unson';
const PROJECT_CODE = 'baao';
const ORG_IDS = ['unson', 'baao'];

const BASE_PERMISSION_SNAPSHOT = {
    roles: ['ceo'],
    project_membership: true,
    seed: {
        version: SEED_VERSION,
        purpose: 'personal-kg-from-baao-minutes',
        source_session: 'session-1778496304661',
        review_status: 'approved_by_owner_prompt'
    }
};

const BAAO_MEETINGS_ROOT = '/Users/ksato/workspace/projects/baao/meetings';

const SOURCE_INVENTORY = [
    {
        id: 'baao-minutes:2025-11-19-ai-dojo-event-planning',
        kind: 'minutes',
        date: '2025-11-19',
        project_code: PROJECT_CODE,
        source_path: `${BAAO_MEETINGS_ROOT}/minutes/2025-11-19_ai-dojo-event-planning.md`,
        focus: ['persona', 'content_design', 'practical_ai_use']
    },
    {
        id: 'baao-minutes:2025-12-21-ai-partner-positioning-practice-workshop',
        kind: 'minutes',
        date: '2025-12-21',
        project_code: PROJECT_CODE,
        source_path: `${BAAO_MEETINGS_ROOT}/minutes/2025-12-21_ai-partner-positioning-practice-workshop.md`,
        focus: ['brain-base', 'positioning', 'personal_kg', 'ai_partner']
    },
    {
        id: 'baao-minutes:2025-12-21-ai-agent-implementation-enterprise-discussion',
        kind: 'minutes',
        date: '2025-12-21',
        project_code: PROJECT_CODE,
        source_path: `${BAAO_MEETINGS_ROOT}/minutes/2025-12-21_ai-agent-implementation-enterprise-discussion.md`,
        focus: ['enterprise_ai', 'acl', 'mana', 'organization_design']
    },
    {
        id: 'baao-minutes:2026-01-07-event-promotion-strategy-meeting',
        kind: 'minutes',
        date: '2026-01-07',
        project_code: PROJECT_CODE,
        source_path: `${BAAO_MEETINGS_ROOT}/minutes/2026-01-07_event-promotion-strategy-meeting.md`,
        focus: ['lead_path', 'conversion_design', 'brainbase']
    },
    {
        id: 'baao-minutes:2026-02-19-ai-development-trends-meeting',
        kind: 'minutes',
        date: '2026-02-19',
        project_code: PROJECT_CODE,
        source_path: `${BAAO_MEETINGS_ROOT}/minutes/2026-02-19_ai-development-trends-meeting.md`,
        focus: ['ai_trends', 'nec', 'ai_pm', 'operations']
    },
    {
        id: 'baao-minutes:2026-02-19-nec-consultation-02',
        kind: 'minutes',
        date: '2026-02-19',
        project_code: PROJECT_CODE,
        source_path: `${BAAO_MEETINGS_ROOT}/minutes/2026-02-19_nec-consultation-02.md`,
        focus: ['nec', 'customer_feedback', 'operations_usecase', 'ai_pm']
    },
    {
        id: 'baao-minutes:2026-03-09-ai-project-management-introduction',
        kind: 'minutes',
        date: '2026-03-09',
        project_code: PROJECT_CODE,
        source_path: `${BAAO_MEETINGS_ROOT}/minutes/2026-03-09_ai-project-management-introduction.md`,
        focus: ['mana', 'ai_pm', 'proof', 'pm_automation']
    },
    {
        id: 'baao-minutes:2026-04-08-architecture-discussion-automation-workflow',
        kind: 'minutes',
        date: '2026-04-08',
        project_code: PROJECT_CODE,
        source_path: `${BAAO_MEETINGS_ROOT}/minutes/2026-04-08_architecture-discussion-automation-workflow.md`,
        focus: ['sns_automation', 'human_approval', 'architecture']
    }
];

/**
 * BAAO議事録から抽出した、佐藤圭吾の個人KG foundation memory。
 *
 * ここではSNS投稿案を作らない。議事録から、後続のSNS運用や提案に使える
 * 思想・運用原則・実績・関係性・コンテンツ設計だけを candidate-store に積む。
 */
const BAAO_MINUTES_ITEMS = [
    {
        id: 'positioning-three-axis',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.96,
        source_id: 'baao-minutes:2025-12-21-ai-partner-positioning-practice-workshop',
        line_start: 52,
        line_end: 58,
        body: 'Brain-Baseの立ち位置は、自分・仕事・関係性の3軸で仕事上の座標を定義する。自分は価値観と判断基準、仕事はプロジェクトやタスク、関係性は相談相手・決裁者・契約関係を表す。'
    },
    {
        id: 'values-before-agent-autonomy',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.95,
        source_id: 'baao-minutes:2025-12-21-ai-partner-positioning-practice-workshop',
        line_start: 54,
        line_end: 55,
        body: 'AIを自律的に動かす前に、ユーザーの価値観や判断基準を渡す。AIの複数提案から、本人の価値観ならどれを選ぶべきかまで絞れることが意思決定コストを下げる。'
    },
    {
        id: 'brain-base-second-brain',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.95,
        source_id: 'baao-minutes:2025-12-21-ai-partner-positioning-practice-workshop',
        line_start: 28,
        line_end: 29,
        body: 'Brain-Baseは自分の脳みそをもう一つ作る思想。プロジェクト管理、タスク、RACI、ナレッジを統合し、AIが文脈を理解した状態から会話を始められるようにする。'
    },
    {
        id: 'positioning-makes-ai-partner',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.93,
        source_id: 'baao-minutes:2025-12-21-ai-partner-positioning-practice-workshop',
        line_start: 24,
        line_end: 24,
        body: 'AIの賢さだけでは不十分。プロジェクトの文脈、関係性、背景情報を体系的に理解させる立ち位置整理によって、AIは単なるツールからビジネスパートナーになる。'
    },
    {
        id: 'knowledge-includes-dialogue-sns-books',
        category: 'philosophy',
        cognitive_type: 'insight',
        confidence: 0.9,
        source_id: 'baao-minutes:2025-12-21-ai-partner-positioning-practice-workshop',
        line_start: 29,
        line_end: 29,
        body: '個人KGに入れるナレッジは業務情報だけではない。AIとの対話から学んだ内容、SNSの良質な投稿、書籍の体系的情報も、本人の判断基準を支える素材として統合する。'
    },
    {
        id: 'decision-human-context-ai',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.92,
        source_id: 'baao-minutes:2025-12-21-ai-partner-positioning-practice-workshop',
        line_start: 40,
        line_end: 44,
        body: 'AIは背景情報と外部ナレッジを踏まえて戦略提案する。人間の役割は、コンテキストの抜け漏れ確認と、この施策で損失を受け入れられるかの判断に集中すること。'
    },
    {
        id: 'meetings-for-decisions-only',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.92,
        source_id: 'baao-minutes:2025-12-21-ai-partner-positioning-practice-workshop',
        line_start: 46,
        line_end: 47,
        body: 'Manaちゃんがプロジェクト進捗、担当者、マイルストーンを理解して個別メッセージや週次報告を出すと、情報共有のための会議は不要になり、会議は意思決定に集約される。'
    },
    {
        id: 'continuous-positioning-update',
        category: 'operating_principle',
        cognitive_type: 'preference',
        confidence: 0.9,
        source_id: 'baao-minutes:2025-12-21-ai-partner-positioning-practice-workshop',
        line_start: 85,
        line_end: 91,
        body: '立ち位置整理は一度作って終わりではない。毎日10分または週末10分でも、タスク、プロジェクト、関わる人、意思決定基準の変化を更新し続ける。'
    },
    {
        id: 'source-of-truth-folder-acl',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.93,
        source_id: 'baao-minutes:2025-12-21-ai-agent-implementation-enterprise-discussion',
        line_start: 23,
        line_end: 29,
        body: '4会社・16から17プロジェクトを扱うには、共通情報とプロジェクト単位情報を分けた正本情報、RACI、人物情報、意思決定方法を持ち、質問者の所属範囲に応じてAIの参照範囲を制御する。'
    },
    {
        id: 'enterprise-ai-self-concern',
        category: 'operating_principle',
        cognitive_type: 'insight',
        confidence: 0.88,
        source_id: 'baao-minutes:2025-12-21-ai-agent-implementation-enterprise-discussion',
        line_start: 39,
        line_end: 40,
        body: '企業へのAI導入では教育だけでは浸透しにくい。相手が実際に困っている業務をAIで劇的に改善し、自分ごととして認めざるを得ない体験を作ることが重要。'
    },
    {
        id: 'ai-first-new-org',
        category: 'operating_principle',
        cognitive_type: 'hypothesis',
        confidence: 0.86,
        source_id: 'baao-minutes:2025-12-21-ai-agent-implementation-enterprise-discussion',
        line_start: 42,
        line_end: 43,
        body: '既存組織のセキュリティや業務フローを変えるより、AIファーストの新組織を別に立ち上げる方が現実的な場合がある。新組織なら情報管理、権限、ツール、業務フローを最初からAI前提で設計できる。'
    },
    {
        id: 'management-ai-inputs',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.94,
        source_id: 'baao-minutes:2025-12-21-ai-agent-implementation-enterprise-discussion',
        line_start: 45,
        line_end: 48,
        body: 'マネジメントAIは、マイルストーン、週次進捗、各メンバーのタスク、プロジェクト背景、要求・要件を読み込み、適切なタイミングで情報を届け、回収し、更新する。唯一できないのは意思決定。'
    },
    {
        id: 'github-managed-docs-for-ai',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.86,
        source_id: 'baao-minutes:2025-12-21-ai-agent-implementation-enterprise-discussion',
        line_start: 50,
        line_end: 51,
        body: 'AIが正しく参照できるよう、プロジェクトメンバーが共通の場所に情報を更新する。MarkdownやGitHubコミットを情報更新の証跡にすることで、誰が何を変えたかをAIも追える。'
    },
    {
        id: 'ai-worker-scale-requires-context-workflow',
        category: 'philosophy',
        cognitive_type: 'hypothesis',
        confidence: 0.86,
        source_id: 'baao-minutes:2025-12-21-ai-partner-positioning-practice-workshop',
        line_start: 79,
        line_end: 83,
        body: '今後の起業家は、少人数の人間と大量のAI社員で事業を回す。その基盤はコンテキスト管理と業務フロー設計であり、エージェントへの権限委譲と組織運営設計が競争力になる。'
    },
    {
        id: 'ai-pm-mana-proof',
        category: 'proof',
        cognitive_type: 'result',
        confidence: 0.92,
        source_id: 'baao-minutes:2026-03-09-ai-project-management-introduction',
        line_start: 12,
        line_end: 38,
        body: 'Own Proof: MANAによるAI駆動PMは、実運用4ヶ月で会議時間90%削減、PM工数75%削減、タスク登録80%自動化の実績として説明されている。'
    },
    {
        id: 'ai-pm-functions',
        category: 'proof',
        cognitive_type: 'claim',
        confidence: 0.9,
        source_id: 'baao-minutes:2026-03-09-ai-project-management-introduction',
        line_start: 20,
        line_end: 31,
        body: 'AI駆動PMの主要機能は、日次ログ、週次振り返り、議事録、タスク管理、対話型PM支援、ログ監視や異常検知との連携。Slack、NocoDB、GitHub、Sentryなどの状態を束ねる。'
    },
    {
        id: 'operations-ai-pm-nec-demand',
        category: 'relationship',
        cognitive_type: 'insight',
        confidence: 0.88,
        source_id: 'baao-minutes:2026-02-19-nec-consultation-02',
        line_start: 67,
        line_end: 88,
        body: 'NEC統括部向けには、セールスエージェントより運用業務特化が刺さる。障害予見、障害対応、自律化、問い合わせ対応、仕様書・手順書作成レビュー、AI駆動PMでアンビエントAIを体感させる提案が本命。'
    },
    {
        id: 'ai-trends-as-trust-balance',
        category: 'content_design',
        cognitive_type: 'claim',
        confidence: 0.82,
        source_id: 'baao-minutes:2026-02-19-ai-development-trends-meeting',
        line_start: 20,
        line_end: 25,
        body: '信頼残高を積むには、AIトレンドを単なるニュース紹介で終えず、Claude、企業導入、AIエージェント、SaaS侵食、労働市場変化を事業・組織運営の論点へ翻訳する。'
    },
    {
        id: 'persona-practical-ai-use',
        category: 'content_design',
        cognitive_type: 'insight',
        confidence: 0.84,
        source_id: 'baao-minutes:2025-11-19-ai-dojo-event-planning',
        line_start: 56,
        line_end: 58,
        body: 'コンテンツはペルソナを絞り、その人に響く実務AI利用へ寄せる。聞かれやすいのは「仕事の中でどうAIを使っているか」であり、ハイパフォーマーの実践AI利用術は強い入口になる。'
    },
    {
        id: 'single-low-friction-lead-path',
        category: 'content_design',
        cognitive_type: 'preference',
        confidence: 0.84,
        source_id: 'baao-minutes:2026-01-07-event-promotion-strategy-meeting',
        line_start: 23,
        line_end: 27,
        body: 'イベントやSNSからの導線は一本に絞り、最もハードルが低いリスト取得を優先する。取得後に興味分野で分岐し、Brainbase導入、バイブコーディング支援、場をなどへ案内する。'
    },
    {
        id: 'sns-automation-human-approval',
        category: 'operating_principle',
        cognitive_type: 'preference',
        confidence: 0.9,
        source_id: 'baao-minutes:2026-04-08-architecture-discussion-automation-workflow',
        line_start: 30,
        line_end: 42,
        body: 'SNS自動化でも、記事・RSSクローリングとAIコメント草案生成は自動化しつつ、記事の最終選定、コメント編集、投稿前承認、返信は人間が担う。投稿は必ず人間承認を経る。'
    }
];

function hash(text) {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function sourceById(id) {
    const source = SOURCE_INVENTORY.find((entry) => entry.id === id);
    if (!source) {
        throw new Error(`BAAO minutes source not found: ${id}`);
    }
    return source;
}

function makeCandidate(item) {
    const source = sourceById(item.source_id);
    const sourceEventId = `${SOURCE_SYSTEM}:${SEED_VERSION}:${item.category}:${item.id}`;
    return {
        id: `seed_baao_minutes_${item.id}`,
        cognitive_type: item.cognitive_type,
        body: item.body,
        owner_person_id: OWNER_PERSON_ID,
        actor_person_id: OWNER_PERSON_ID,
        organization_id: WORKSPACE,
        source_system: SOURCE_SYSTEM,
        source_event_ids: [sourceEventId],
        workspace: WORKSPACE,
        project_code: PROJECT_CODE,
        org_ids: ORG_IDS,
        project_ids: ['brainbase', PROJECT_CODE],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        requires_approval: true,
        redaction_status: 'none',
        recommended_subject_type: null,
        confidence: item.confidence,
        permission_snapshot: {
            ...BASE_PERMISSION_SNAPSHOT,
            seed: {
                ...BASE_PERMISSION_SNAPSHOT.seed,
                category: item.category,
                item_id: item.id,
                source_id: item.source_id,
                source_date: source.date,
                line_start: item.line_start,
                line_end: item.line_end
            }
        },
        evidence_ids: [{
            raw_event_id: item.source_id,
            uri: `file://${source.source_path}#L${item.line_start}-L${item.line_end}`,
            source_path: source.source_path,
            line_start: item.line_start,
            line_end: item.line_end,
            hash: hash(`${item.body}\n${source.source_path}:${item.line_start}-${item.line_end}`)
        }]
    };
}

export function buildSatoKeigoBaaoMinutesCandidates() {
    return BAAO_MINUTES_ITEMS.map(makeCandidate);
}

export {
    BAAO_MINUTES_ITEMS as SATO_KEIGO_BAAO_MINUTES_ITEMS,
    SOURCE_INVENTORY as SATO_KEIGO_BAAO_MINUTES_SOURCE_INVENTORY,
    SEED_VERSION as SATO_KEIGO_BAAO_MINUTES_SEED_VERSION,
    SOURCE_SYSTEM as SATO_KEIGO_BAAO_MINUTES_SOURCE_SYSTEM
};
