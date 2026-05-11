// @ts-check
import { createHash } from 'node:crypto';

const SOURCE_SYSTEM = 'brainbase-personal-kg-seed';
const SEED_VERSION = '2026-05-12-sns-foundation-v1';
const OWNER_PERSON_ID = 'sato_keigo';
const WORKSPACE = 'unson';
const PROJECT_CODE = 'brainbase';
const ORG_IDS = ['unson'];

const BASE_PERMISSION_SNAPSHOT = {
    roles: ['ceo'],
    project_membership: true,
    seed: {
        version: SEED_VERSION,
        purpose: 'personal-kg-sns-foundation',
        source_session: 'session-1778496304661'
    }
};

/**
 * SNS運用を始める前に個人KGへ入れる初期memory。
 *
 * ここでは投稿draftを作らない。Persona Brain / Peer Circle / Own Proof を
 * curatorが後で読める cognitive memory として candidate-store に積む。
 */
const FOUNDATION_ITEMS = [
    {
        id: 'persona-brain-first',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.95,
        body: 'Persona Brainで考える。SNSでも営業でも、こちらの正しさや分類から始めず、相手が今何を見て、何を誤解し、何を怖がり、何なら自然に動けるかを先に立ち上げる。'
    },
    {
        id: 'ai-as-org-unit',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.94,
        body: 'AIはツールではなく組織ユニットとして扱う。単発チャットではなく、役割、権限、記憶、承認、証跡を持って継続稼働する単位として設計する。'
    },
    {
        id: 'ai-pm-responsibility-boundary',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.92,
        body: 'AI PMはタスク管理の自動化ではない。責任分界、意思決定ログ、レビュー境界、学習の戻し先を設計する仕事である。'
    },
    {
        id: 'ai-management-company-os',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.92,
        body: 'AI駆動経営は投稿生成や業務自動化の足し算ではない。会社の動き方を、AI社員、承認、証跡、記憶、配分判断を含むOSとして再設計すること。'
    },
    {
        id: 'knowledge-graph-brings-context',
        category: 'philosophy',
        cognitive_type: 'claim',
        confidence: 0.9,
        body: 'ナレッジグラフの価値は、人間が情報を見に行くことではなく、AIが必要なentityに紐づく文脈をgraph traversalで持ってくることにある。'
    },
    {
        id: 'content-design-three-core',
        category: 'content_design',
        cognitive_type: 'claim',
        confidence: 0.96,
        body: 'さとけいX運用の中心は Persona Brain / Peer Circle / Own Proof。AI活用ノウハウ量産ではなく、近接界隈で信頼残高を積み、仲間として認知されるために運用する。'
    },
    {
        id: 'weekly-allocation',
        category: 'content_design',
        cognitive_type: 'preference',
        confidence: 0.9,
        body: '投稿設計は今日の3投稿ではなく1週間単位で作る。目安は週21から28本、Peer interaction 30%、Claude Code / AI PM / AI経営理解 25%、Own Proof 20%、哲学 15%、Learn in public 5%、診断CTA 5%。'
    },
    {
        id: 'tone-guard-no-ai-posting-flex',
        category: 'content_design',
        cognitive_type: 'preference',
        confidence: 0.92,
        body: 'Xでは「AIで投稿を書いています」「APIで投稿しています」と見える表現を避ける。出してよいのは、読者理解、仮説検証、反応学習、思考や判断の資産化にAIを使っていること。'
    },
    {
        id: 'peer-circle-friendship',
        category: 'content_design',
        cognitive_type: 'claim',
        confidence: 0.94,
        body: 'Peer Circleでは巨大インフルエンサーへの一方的な便乗ではなく、同じ界隈の同格から少し上の人に仲間だと思ってもらう。引用は相手の論点を補強し、相手の読者に向けて翻訳する。'
    },
    {
        id: 'amplifier-target-band',
        category: 'content_design',
        cognitive_type: 'preference',
        confidence: 0.88,
        body: '引用リポストで狙う相手は、自分より少し人気がある近接界隈。現時点ではフォロワー2,000から20,000を一次ターゲット、20,000から50,000を二次ターゲットとして扱う。'
    },
    {
        id: 'own-proof-m1-m4',
        category: 'proof',
        cognitive_type: 'insight',
        confidence: 0.88,
        body: 'Own Proof: knowledge-graph-kernel M1-M4で、ACL foundation、Candidate Store、account + curator + settings、SNS posting engineまでをin-memoryで通した。実装された思想として語れる。'
    },
    {
        id: 'own-proof-protected-push-guard',
        category: 'proof',
        cognitive_type: 'insight',
        confidence: 0.86,
        body: 'Own Proof: develop直pushによるsilent drop事故を、protected-push guard、Codex/Claude hook、runbook、capability mapで再発防止した。AI組織運用には注意喚起よりdeterministic guardが必要。'
    },
    {
        id: 'own-proof-pr-684-personal-kg-sns-seed',
        category: 'proof',
        cognitive_type: 'insight',
        confidence: 0.9,
        body: 'Own Proof: PR #684で、candidate-store personal scopeを個人KGのcognitive layerとして読み、Persona Brain付きSNS seedに接続するread modelを実装した。投稿APIではなく記憶からネタを作る入口。'
    },
    {
        id: 'own-proof-vibepro-story-gate',
        category: 'proof',
        cognitive_type: 'claim',
        confidence: 0.87,
        body: 'Own Proof: VibeProではStory、Architecture、Spec、Graphify、Gate、PR evidenceを通して変更を進める。AIがコードを書く前に、価値と影響範囲を正本化する運用である。'
    },
    {
        id: 'peer-primary-obisidian-graph-brain',
        category: 'peer_circle',
        cognitive_type: 'hypothesis',
        confidence: 0.78,
        body: 'Peer Circle候補: @obsidianstudio9。Obsidian x Claude Code x graph文脈が近い。角度は、ObsidianはノートではなくAIの作業記憶になるが、組織運用にはACLが必要という翻訳。'
    },
    {
        id: 'peer-primary-ai-driven-pm',
        category: 'peer_circle',
        cognitive_type: 'hypothesis',
        confidence: 0.8,
        body: 'Peer Circle候補: @masa_oka108 / @JoE_HiRose。AI駆動PM、AI駆動経営、組織OSの文脈が近い。角度は、AI PMはツール導入ではなく責任、権限、記憶の設計という補強。'
    },
    {
        id: 'peer-primary-claude-code-workflow',
        category: 'peer_circle',
        cognitive_type: 'hypothesis',
        confidence: 0.78,
        body: 'Peer Circle候補: @1osabori / @oikon48 / @commte。Claude Code実務Tipsの読者が近い。角度は、TipsよりCLAUDE.md、Skills、権限、レビュー、検収の運用設計が法人導入の本体という翻訳。'
    },
    {
        id: 'peer-primary-ai-agent-safety',
        category: 'peer_circle',
        cognitive_type: 'hypothesis',
        confidence: 0.76,
        body: 'Peer Circle候補: @tommy_love123 / @yamaguchi_take / @Shimayus。AI自律化やセキュリティのリスク論点が近い。角度は、AIに任せるほど停止条件、責任境界、secret管理、監査ログが先に必要という補強。'
    },
    {
        id: 'peer-primary-ai-marketing-os',
        category: 'peer_circle',
        cognitive_type: 'hypothesis',
        confidence: 0.76,
        body: 'Peer Circle候補: @starriver0513 / @arupoki / @ai_shunoda。AI駆動マーケや配信OSSの文脈が近い。角度は、マーケAIは投稿生成ではなく、顧客理解から配信後学習までの運用OSという翻訳。'
    },
    {
        id: 'peer-primary-ai-management-community',
        category: 'peer_circle',
        cognitive_type: 'hypothesis',
        confidence: 0.76,
        body: 'Peer Circle候補: @kimotuki / @itohiro73 / @YuhiFreaker。AI駆動経営コミュニティ、経営、役割権限設計の文脈が近い。角度は、AI駆動経営を100種類のツール利用ではなく仕事の流れの再設計として語る。'
    },
    {
        id: 'reaction-log-first-post',
        category: 'reaction_log',
        cognitive_type: 'insight',
        confidence: 0.7,
        body: 'SNS反応ログ初期値: 2026-05-12に @tetumemo の投稿を素材に通常投稿 + URL形式で投稿した。今後は本人のlike、reply、repost、follow、profile visit、bookmarkをoyasumiで確認して学習へ戻す。'
    },
    {
        id: 'reaction-log-metric-policy',
        category: 'reaction_log',
        cognitive_type: 'claim',
        confidence: 0.78,
        body: 'SNS反応ログの見るべき指標は、単発のimpressionだけではない。Peer本人の反応、相手読者への到達、保存、プロフィール訪問、次回引用時の拾われやすさを学習対象にする。'
    }
];

function hash(text) {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function makeCandidate(item) {
    const sourceEventId = `${SOURCE_SYSTEM}:${SEED_VERSION}:${item.category}:${item.id}`;
    return {
        id: `seed_sns_foundation_${item.id}`,
        cognitive_type: item.cognitive_type,
        body: item.body,
        owner_person_id: OWNER_PERSON_ID,
        actor_person_id: OWNER_PERSON_ID,
        source_system: SOURCE_SYSTEM,
        source_event_ids: [sourceEventId],
        workspace: WORKSPACE,
        project_code: PROJECT_CODE,
        org_ids: ORG_IDS,
        project_ids: [PROJECT_CODE],
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
                item_id: item.id
            }
        },
        evidence_ids: [{
            raw_event_id: sourceEventId,
            uri: `brainbase:personal-kg-seed:${SEED_VERSION}#${item.id}`,
            hash: hash(item.body)
        }]
    };
}

export function buildSatoKeigoSnsFoundationCandidates() {
    return FOUNDATION_ITEMS.map(makeCandidate);
}

export {
    FOUNDATION_ITEMS as SATO_KEIGO_SNS_FOUNDATION_ITEMS,
    SEED_VERSION as SATO_KEIGO_SNS_FOUNDATION_SEED_VERSION,
    SOURCE_SYSTEM as SATO_KEIGO_SNS_FOUNDATION_SOURCE_SYSTEM
};
