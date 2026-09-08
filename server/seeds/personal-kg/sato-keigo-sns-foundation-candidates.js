// @ts-check
import { createHash } from 'node:crypto';

const SOURCE_SYSTEM = 'brainbase-personal-kg-seed';
const SEED_VERSION = '2026-07-28-sns-public-lifelog-v2';
const OWNER_PERSON_ID = 'sato_keigo';
const WORKSPACE = 'unson';
const PROJECT_CODE = 'brainbase';
const ORG_IDS = ['unson'];

const BASE_PERMISSION_SNAPSHOT = {
    roles: ['ceo'],
    project_membership: true,
    seed: {
        version: SEED_VERSION,
        purpose: 'personal-kg-sns-public-lifelog-policy',
        supersedes_seed_version: '2026-05-12-sns-foundation-v1',
        source_session: 'codex-2026-07-28-public-lifelog'
    }
};

/**
 * 公開ライフログ運用の初期方針。
 *
 * ここに実体験のふりをした投稿素材は入れない。投稿候補は別途、本人が
 * 実際に経験した daily_log / work_log / life_log / memory / unresolved
 * の候補だけから作る。
 */
const FOUNDATION_ITEMS = [
    {
        id: 'public-lifelog-north-star',
        category: 'content_design',
        cognitive_type: 'preference',
        confidence: 1,
        body: 'Xは公開ライフログとして使う。未来の自分が読み返せるように、その日に実際にあったことや考えたことを残す。'
    },
    {
        id: 'first-person-source-only',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 1,
        body: '投稿候補は本人の一次体験ソースだけから作る。一次体験がなければ候補は0件でよく、もっともらしい体験を補わない。'
    },
    {
        id: 'no-advice-or-correction',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 1,
        body: '人への助言、指導、訂正、説得を目的にしない。「私はこうだった」と記録し、読者の行動は設計しない。'
    },
    {
        id: 'grandmother-wisdom-as-outcome',
        category: 'content_design',
        cognitive_type: 'claim',
        confidence: 0.98,
        body: 'おばあちゃんの知恵袋のような役立ち方は結果であって目的ではない。経験の蓄積が後から誰かの役に立つことはあっても、役立たせるために助言へ変換しない。'
    },
    {
        id: 'no-posting-quota',
        category: 'operating_principle',
        cognitive_type: 'preference',
        confidence: 1,
        body: '投稿本数、曜日別配分、成長KPIをノルマにしない。残すものがない日は投稿しない。'
    },
    {
        id: 'external-signals-are-prompts',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 1,
        body: 'ニュースや他人の投稿は自分の記憶を呼び起こす内省のきっかけにだけ使う。外部情報だけを要約して投稿候補にしない。'
    },
    {
        id: 'no-cta-or-conversion',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 1,
        body: '日々の公開ライフログにCTA、営業導線、問い合わせ誘導、プロフィール誘導を置かない。'
    },
    {
        id: 'preserve-history',
        category: 'operating_principle',
        cognitive_type: 'claim',
        confidence: 0.98,
        body: '過去の投稿や記録は当時の履歴として保存する。新方針はこれからの生成と判断に適用し、過去を都合よく改変しない。'
    }
];

function hash(text) {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function makeCandidate(item) {
    const sourceEventId = `${SOURCE_SYSTEM}:${SEED_VERSION}:${item.category}:${item.id}`;
    return {
        id: `seed_sns_lifelog_${item.id}`,
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
