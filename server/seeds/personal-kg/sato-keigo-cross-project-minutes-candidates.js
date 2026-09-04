// @ts-check
import { createHash } from 'node:crypto';

const SOURCE_SYSTEM = 'cross-project-minutes-personal-kg-seed';
const SEED_VERSION = '2026-05-12-cross-project-minutes-v1';
const OWNER_PERSON_ID = 'sato_keigo';
const WORKSPACE = 'unson';

const BASE_PERMISSION_SNAPSHOT = {
    roles: ['ceo'],
    project_membership: true,
    seed: {
        version: SEED_VERSION,
        purpose: 'personal-kg-from-cross-project-minutes',
        source_session: 'session-1778496304661',
        review_status: 'approved_by_owner_prompt'
    }
};

const PROJECTS_ROOT = '/Users/ksato/workspace/projects';

const SOURCE_INVENTORY = [
    {
        id: 'cross-minutes:brainbase:2026-03-30-ai-driven-management-framework',
        kind: 'minutes',
        date: '2026-03-30',
        project_code: 'brainbase',
        source_path: `${PROJECTS_ROOT}/brainbase/meetings/minutes/2026-03-30_ai-driven-management-framework.md`,
        focus: ['ai_driven_management', 'story_driven_strategy', 'brainbase']
    },
    {
        id: 'cross-minutes:brainbase:2026-04-06-ai-driven-pm-project-alignment',
        kind: 'minutes',
        date: '2026-04-06',
        project_code: 'brainbase',
        source_path: `${PROJECTS_ROOT}/brainbase/meetings/minutes/2026-04-06_ai-driven-pm-project-alignment.md`,
        focus: ['ai_catalyst', 'kpi', 'governance']
    },
    {
        id: 'cross-minutes:salestailor:2026-03-26-pitch-deck-structure-review',
        kind: 'minutes',
        date: '2026-03-26',
        project_code: 'salestailor',
        source_path: `${PROJECTS_ROOT}/salestailor/meetings/minutes/2026-03-26_pitch-deck-structure-review.md`,
        focus: ['sales_future', 'trust_platform', 'high_ticket_sales']
    },
    {
        id: 'cross-minutes:salestailor:2026-03-25-sales-trust-score-strategy',
        kind: 'minutes',
        date: '2026-03-25',
        project_code: 'salestailor',
        source_path: `${PROJECTS_ROOT}/salestailor/meetings/minutes/2026-03-25_sales-trust-score-strategy.md`,
        focus: ['trust_score', 'human_sales_value', 'data_strategy']
    },
    {
        id: 'cross-minutes:salestailor:2026-03-26-sales-value-design-discussion',
        kind: 'minutes',
        date: '2026-03-26',
        project_code: 'salestailor',
        source_path: `${PROJECTS_ROOT}/zeims/meetings/minutes/2026-03-26_sales-value-design-discussion.md`,
        focus: ['value_design', 'human_value', 'sales_philosophy']
    },
    {
        id: 'cross-minutes:salestailor:2026-04-28-sales-email-naturalness-review',
        kind: 'minutes',
        date: '2026-04-28',
        project_code: 'salestailor',
        source_path: `${PROJECTS_ROOT}/salestailor/meetings/minutes/2026-04-28_sales-email-naturalness-review.md`,
        focus: ['sales_letter', 'prompt_design', 'realtime_context']
    },
    {
        id: 'cross-minutes:unson-board:2026-04-07-ai-first-framework-quarterly-review',
        kind: 'minutes',
        date: '2026-04-07',
        project_code: 'unson-board',
        source_path: `${PROJECTS_ROOT}/unson/meetings/unson-board/minutes/2026-04-07_ai-first-framework-quarterly-review.md`,
        focus: ['ai_first_framework', 'portfolio_management', 'risk_hedge']
    },
    {
        id: 'cross-minutes:zeims:2026-04-08-brainbase-team-ai-adoption',
        kind: 'minutes',
        date: '2026-04-08',
        project_code: 'zeims',
        source_path: `${PROJECTS_ROOT}/zeims/meetings/minutes/2026-04-08_brainbase-team-ai-adoption.md`,
        focus: ['team_ai_adoption', 'permissions', 'onboarding']
    },
    {
        id: 'cross-minutes:techknight:2026-03-09-love-hotel-industry-dx-strategy',
        kind: 'minutes',
        date: '2026-03-09',
        project_code: 'techknight',
        source_path: `${PROJECTS_ROOT}/techknight/meetings/minutes/2026-03-09_love-hotel-industry-dx-strategy.md`,
        focus: ['industry_demand', 'ai_phone', 'market_positioning']
    },
    {
        id: 'cross-minutes:techknight:2026-04-11-leisure-hotel-ai-networking-strategy',
        kind: 'minutes',
        date: '2026-04-11',
        project_code: 'techknight',
        source_path: `${PROJECTS_ROOT}/techknight/meetings/minutes/2026-04-11_leisure-hotel-ai-networking-strategy.md`,
        focus: ['ai_phone_poc', 'human_ai_handoff', 'industry_network']
    },
    {
        id: 'cross-minutes:ncom-catalyst:2025-12-08-docomo-business-security-incident',
        kind: 'minutes',
        date: '2025-12-08',
        project_code: 'ncom-catalyst',
        source_path: `${PROJECTS_ROOT}/ncom-catalyst/meetings/minutes/2025-12-08_docomo-business-internal-security-incident.md`,
        focus: ['incident_response', 'security_guardrail', 'proposal_framing']
    }
];

/**
 * BAAO以外の議事録から抽出した、佐藤圭吾の横断的な個人KG memory。
 *
 * 投稿案ではなく、後続のSNS/営業/経営判断で再利用できる思想・運用原則・実績・
 * 営業哲学・インシデント学習だけをcandidate-storeに積む。
 */
const CROSS_PROJECT_MINUTES_ITEMS = [
    {
        id: 'frame-story-event-strategy',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.95,
        source_id: 'cross-minutes:brainbase:2026-03-30-ai-driven-management-framework',
        line_start: 18,
        line_end: 23,
        body: 'AI駆動経営は、フレーム・ストーリー・イベントの3層で会社の世界観、時間軸、記録を扱う。判断、Ship、実行、計測のバリューループでは、人間の判断がボトルネックになるためShipを経営進捗KPIにする。'
    },
    {
        id: 'ai-readable-git-over-human-readable',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.92,
        source_id: 'cross-minutes:brainbase:2026-03-30-ai-driven-management-framework',
        line_start: 25,
        line_end: 30,
        body: '議事録やナレッジは、共有性よりAIの読みやすさを優先してGitに置く。生成時にはプロジェクトコンテキストと用語集を読ませ、固有名詞の誤認識を防ぐ。'
    },
    {
        id: 'p2p-ai-driven-team',
        category: 'philosophy',
        cognitive_type: 'hypothesis',
        confidence: 0.88,
        source_id: 'cross-minutes:brainbase:2026-03-30-ai-driven-management-framework',
        line_start: 39,
        line_end: 42,
        body: 'AI駆動チームの次の形は、各メンバーが自分専用のコンテキスト管理済みAIを持ち、P2P接続でAI同士が問い合わせながら協働すること。権限管理は上位レイヤーで制御する。'
    },
    {
        id: 'emotion-experience-starts-adoption',
        category: 'operating_principle',
        cognitive_type: 'insight',
        confidence: 0.9,
        source_id: 'cross-minutes:brainbase:2026-03-30-ai-driven-management-framework',
        line_start: 51,
        line_end: 55,
        body: 'AI導入は「便利」だけでは動かない。感動体験を起点にし、AI好きな身近な人が周囲へ成功体験を伝播させることで、抵抗層にも届きやすくなる。'
    },
    {
        id: 'medical-ai-starts-with-owner-workflow',
        category: 'operating_principle',
        cognitive_type: 'hypothesis',
        confidence: 0.84,
        source_id: 'cross-minutes:brainbase:2026-03-30-ai-driven-management-framework',
        line_start: 44,
        line_end: 49,
        body: '規制や個人情報の制約が強い業界では、いきなり現場データへ入らない。まず経営者個人の情報や経営指標でAIワークフローを作り、リテラシーを高めてから段階的に院内・現場情報へ展開する。'
    },
    {
        id: 'ai-adoption-not-dashboard-first',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.93,
        source_id: 'cross-minutes:brainbase:2026-04-06-ai-driven-pm-project-alignment',
        line_start: 36,
        line_end: 48,
        body: 'AI活用推進は、AIダッシュボードやツール導入だけでは変わらない。先に自分ごと化するモデルケースを2から3チームで作り、AIカタリスト制度として波及させる。'
    },
    {
        id: 'ai-kpi-quality-not-usage',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.92,
        source_id: 'cross-minutes:brainbase:2026-04-06-ai-driven-pm-project-alignment',
        line_start: 52,
        line_end: 58,
        body: 'AI活用KPIは導入率や「使っている風」ではなく、活用の質を見る。個人レベルのAI活用度を段階評価し、レベル1からレベル3への移行を追う方が実態に近い。'
    },
    {
        id: 'governance-before-catchy-tool',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.9,
        source_id: 'cross-minutes:brainbase:2026-04-06-ai-driven-pm-project-alignment',
        line_start: 62,
        line_end: 74,
        body: 'AI導入ではキャッチーなツールより、普段の業務で簡単に使える環境、ポリシー、ガバナンス、自己完結できるオンボーディングを先に作る。セキュリティ線引きも制度設計に含める。'
    },
    {
        id: 'high-ticket-sales-human-fear-reduction',
        category: 'sales_philosophy',
        cognitive_type: 'claim',
        confidence: 0.93,
        source_id: 'cross-minutes:salestailor:2026-03-26-pitch-deck-structure-review',
        line_start: 26,
        line_end: 35,
        body: 'AI時代の高額商材営業で人間に残る仕事は、相手の決断の恐怖を減らし、納得と責任を支えること。調査や提案はAI化しても、背中を押す面談は人間の価値として残る。'
    },
    {
        id: 'trust-relationship-platform',
        category: 'sales_philosophy',
        cognitive_type: 'claim',
        confidence: 0.92,
        source_id: 'cross-minutes:salestailor:2026-03-26-pitch-deck-structure-review',
        line_start: 42,
        line_end: 60,
        body: 'SalesTailorの長期構想は、個人依存ではなく会社としての信頼資産を作る信頼関係データのマネジメント基盤。テキスト、音声、映像、バーバル、ノンバーバルを組み合わせて信頼形成を扱う。'
    },
    {
        id: 'human-is-still-letter-phone-trust',
        category: 'sales_philosophy',
        cognitive_type: 'preference',
        confidence: 0.84,
        source_id: 'cross-minutes:salestailor:2026-03-26-pitch-deck-structure-review',
        line_start: 63,
        line_end: 68,
        body: 'インサイドセールス代行では、手紙と電話のセットで信頼を作る部分は人間が担うべき。AIに代替すると効果が消える領域がある。'
    },
    {
        id: 'trust-score-company-meaning',
        category: 'sales_philosophy',
        cognitive_type: 'claim',
        confidence: 0.92,
        source_id: 'cross-minutes:salestailor:2026-03-25-sales-trust-score-strategy',
        line_start: 20,
        line_end: 35,
        body: 'AIが売上を上げる時代には、売上だけでは人間を採用する理由が弱くなる。人間営業が生む人と人との信頼を、会社が会社である意味として信頼スコアにする。'
    },
    {
        id: 'data-compounding-over-immediate-revenue',
        category: 'sales_philosophy',
        cognitive_type: 'preference',
        confidence: 0.86,
        source_id: 'cross-minutes:salestailor:2026-03-25-sales-trust-score-strategy',
        line_start: 20,
        line_end: 23,
        body: 'SalesTailorの事業戦略では、短期収益だけでなく、将来につながる信頼スコアのデータ蓄積を優先する。データを取らせてもらえる組み方は戦略的価値が高い。'
    },
    {
        id: 'value-design-human-sales',
        category: 'sales_philosophy',
        cognitive_type: 'claim',
        confidence: 0.91,
        source_id: 'cross-minutes:salestailor:2026-03-26-sales-value-design-discussion',
        line_start: 24,
        line_end: 35,
        body: '営業AIのビジョンは成果最大化だけではなく、人間価値の最大化。AIは論理的提案を作れるが、人間は顧客の感情、信条、ビジョンを踏まえ、信頼と責任を伴う体験をデザインする。'
    },
    {
        id: 'caring-power-core-sales-skill',
        category: 'sales_philosophy',
        cognitive_type: 'insight',
        confidence: 0.86,
        source_id: 'cross-minutes:salestailor:2026-03-26-sales-value-design-discussion',
        line_start: 24,
        line_end: 29,
        body: '人間営業パーソンの核心スキルは、関心力。相手のことを深く考え抜き、AIが拾えない対面の感覚やふとした言葉を価値設計へ戻す。'
    },
    {
        id: 'prompt-naturalness-needs-bridging-context',
        category: 'operating_principle',
        cognitive_type: 'insight',
        confidence: 0.86,
        source_id: 'cross-minutes:salestailor:2026-04-28-sales-email-naturalness-review',
        line_start: 49,
        line_end: 61,
        body: 'AI生成の営業レターは、ブロック単位の情報を並べるだけではぶつ切りになる。セクション間の連動性、つなぎの文脈、商材ごとの情報源選択、リアルタイム取得が自然さを作る。'
    },
    {
        id: 'unson-frame-story-backup-plan',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.89,
        source_id: 'cross-minutes:unson-board:2026-04-07-ai-first-framework-quarterly-review',
        line_start: 18,
        line_end: 22,
        body: 'UnsonのAI駆動経営フレームワークでは、フレーム・ストーリー・イベントの構造に加えて、リスクヘッジ用のバックアッププランをストーリーとして並走させる。'
    },
    {
        id: 'ai-driven-management-consulting-proof',
        category: 'proof',
        cognitive_type: 'result',
        confidence: 0.84,
        source_id: 'cross-minutes:unson-board:2026-04-07-ai-first-framework-quarterly-review',
        line_start: 23,
        line_end: 28,
        body: 'Own Proof: AI駆動経営コンサルは複数案件で契約書レベルに進み、事例化後は青鬼ブランドでのプロモーション活用も検討されている。思想だけではなく受注に近い実需がある。'
    },
    {
        id: 'team-ai-permission-data-onboarding',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.92,
        source_id: 'cross-minutes:zeims:2026-04-08-brainbase-team-ai-adoption',
        line_start: 44,
        line_end: 60,
        body: 'BrainBaseのチーム導入で解くべき課題は、権限設計、データ一元化、チームオンボーディング。CLIツールのUI化だけでなく、Wiki、Google Drive連携、タスク管理、プロジェクト単位ACLが必要。'
    },
    {
        id: 'top-down-structure-project-owner-maintains',
        category: 'operating_principle',
        cognitive_type: 'preference',
        confidence: 0.86,
        source_id: 'cross-minutes:zeims:2026-04-08-brainbase-team-ai-adoption',
        line_start: 53,
        line_end: 60,
        body: 'チームAI導入の初期整備は、トップが基本構造を一括作成し、プロジェクト責任者へ細部の継続管理を委任する力技が有効。最初から全員に分散管理させない。'
    },
    {
        id: 'oss-plus-mana-monetization',
        category: 'proof',
        cognitive_type: 'claim',
        confidence: 0.82,
        source_id: 'cross-minutes:zeims:2026-04-08-brainbase-team-ai-adoption',
        line_start: 62,
        line_end: 65,
        body: 'Own Proof: BrainBase本体はOSS、詳細ノウハウ販売とAIマネージャーまなちゃん運用をマネタイズ軸にする。まなちゃんはタスク漏れ、朝ブリーフィング、会議提案を担う。'
    },
    {
        id: 'industry-wedge-before-core-system',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.88,
        source_id: 'cross-minutes:techknight:2026-04-11-leisure-hotel-ai-networking-strategy',
        line_start: 40,
        line_end: 52,
        body: 'レジャーホテルDXでは、いきなり基幹システムを置き換えず、AI電話という周辺領域から入る。導入しやすい実績を作り、徐々にデータ管理・基幹領域へ広げる。'
    },
    {
        id: 'legacy-market-ai-era-long-positioning',
        category: 'operating_principle',
        cognitive_type: 'insight',
        confidence: 0.84,
        source_id: 'cross-minutes:techknight:2026-03-09-love-hotel-industry-dx-strategy',
        line_start: 31,
        line_end: 35,
        body: 'AI時代の事業領域は、古い業務フローが残り、参入障壁が高く、変革余地が大きい成熟市場に長期機会がある。レジャーホテル領域は20から30年単位で食いっぱぐれにくい市場として見ている。'
    },
    {
        id: 'ai-phone-poc-data-before-price',
        category: 'operating_principle',
        cognitive_type: 'preference',
        confidence: 0.88,
        source_id: 'cross-minutes:techknight:2026-04-11-leisure-hotel-ai-networking-strategy',
        line_start: 20,
        line_end: 24,
        body: 'AI電話は、価格設定よりPOC導入と実運用データ取得を優先する。モデル性能の自然改善に投資しすぎず、ホテル運用への組み込み方、部屋管理連携、人間との分担設計を差別化にする。'
    },
    {
        id: 'human-ai-handoff-for-responsibility',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.88,
        source_id: 'cross-minutes:techknight:2026-04-11-leisure-hotel-ai-networking-strategy',
        line_start: 26,
        line_end: 30,
        body: 'AI電話でも100%代替はしない。クレームやアレルギーなど責任を伴う判断は人間へ転送し、まず深夜帯の一次対応から始めるハイブリッド運用が現実的。'
    },
    {
        id: 'ai-value-starts-with-one-data-place',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.86,
        source_id: 'cross-minutes:techknight:2026-04-11-leisure-hotel-ai-networking-strategy',
        line_start: 68,
        line_end: 74,
        body: 'AIを効果的に活用する基本は、自分のデータを一箇所に集め、AIがアクセスできるようにすること。AIは育ててこそ価値が出るため、データの蓄積と整理が先。'
    },
    {
        id: 'target-brain-naming-matters',
        category: 'operating_principle',
        cognitive_type: 'insight',
        confidence: 0.78,
        source_id: 'cross-minutes:techknight:2026-04-11-leisure-hotel-ai-networking-strategy',
        line_start: 90,
        line_end: 94,
        body: 'AIプロダクトの名前はターゲットの脳で理解できる必要がある。「AIで電話する」では年配の経営者層に伝わりにくく、技術より機能と便益が直感的に分かる名前が必要。'
    },
    {
        id: 'incident-response-can-build-trust',
        category: 'incident_learning',
        cognitive_type: 'insight',
        confidence: 0.9,
        source_id: 'cross-minutes:ncom-catalyst:2025-12-08-docomo-business-security-incident',
        line_start: 20,
        line_end: 28,
        body: 'インシデントは即死ではなく、適切に対応することで信頼性を高める機会にもなる。短期対応を全て実施し、中長期の脆弱性修正、アクセス更新、WAF、セキュリティグループ多層防御へ接続する。'
    },
    {
        id: 'incident-root-cause-needs-architecture-view',
        category: 'incident_learning',
        cognitive_type: 'claim',
        confidence: 0.88,
        source_id: 'cross-minutes:ncom-catalyst:2025-12-08-docomo-business-security-incident',
        line_start: 23,
        line_end: 27,
        body: 'セキュリティ事故の原因は単一脆弱性ではなく、残存パブリックIPとNext.js脆弱性の組み合わせだった。想定外の別ルートを見落とさないため、構成全体のアーキテクチャ視点が必要。'
    },
    {
        id: 'proposal-value-before-feature-list',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.86,
        source_id: 'cross-minutes:ncom-catalyst:2025-12-08-docomo-business-security-incident',
        line_start: 31,
        line_end: 35,
        body: '提案資料は機能詳細より、決裁者向けに各機能がユーザー体験をどう変えるかで整理する。専門性の進化、体験の効率化、信頼性の確立の3本柱で価値を説明する。'
    }
];

function hash(text) {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function sourceById(id) {
    const source = SOURCE_INVENTORY.find((entry) => entry.id === id);
    if (!source) {
        throw new Error(`Cross project minutes source not found: ${id}`);
    }
    return source;
}

function orgIdsForProject(projectCode) {
    if (projectCode === 'salestailor') return ['unson', 'salestailor'];
    if (projectCode === 'techknight') return ['unson', 'techknight'];
    if (projectCode === 'zeims') return ['unson', 'zeims'];
    if (projectCode === 'ncom-catalyst') return ['unson', 'ncom-catalyst'];
    return ['unson'];
}

function makeCandidate(item) {
    const source = sourceById(item.source_id);
    const sourceEventId = `${SOURCE_SYSTEM}:${SEED_VERSION}:${item.category}:${item.id}`;
    return {
        id: `seed_cross_minutes_${item.id}`,
        cognitive_type: item.cognitive_type,
        body: item.body,
        owner_person_id: OWNER_PERSON_ID,
        actor_person_id: OWNER_PERSON_ID,
        organization_id: WORKSPACE,
        source_system: SOURCE_SYSTEM,
        source_event_ids: [sourceEventId],
        workspace: WORKSPACE,
        project_code: source.project_code,
        org_ids: orgIdsForProject(source.project_code),
        project_ids: ['brainbase', source.project_code],
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
                source_project_code: source.project_code,
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

export function buildSatoKeigoCrossProjectMinutesCandidates() {
    return CROSS_PROJECT_MINUTES_ITEMS.map(makeCandidate);
}

export {
    CROSS_PROJECT_MINUTES_ITEMS as SATO_KEIGO_CROSS_PROJECT_MINUTES_ITEMS,
    SOURCE_INVENTORY as SATO_KEIGO_CROSS_PROJECT_MINUTES_SOURCE_INVENTORY,
    SEED_VERSION as SATO_KEIGO_CROSS_PROJECT_MINUTES_SEED_VERSION,
    SOURCE_SYSTEM as SATO_KEIGO_CROSS_PROJECT_MINUTES_SOURCE_SYSTEM
};
