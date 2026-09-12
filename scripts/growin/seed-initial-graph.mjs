#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createBrainbaseGraphHttpClient } from '../lib/brainbase-graph-http-client.mjs';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const baseUrl = process.env.GROWIN_BRAINBASE_API_URL || 'https://brainbase-api-lmc74punpa-an.a.run.app';
const secret = process.env.BRAINBASE_SERVICE_TOKEN_SECRET;
if (!secret) throw new Error('BRAINBASE_SERVICE_TOKEN_SECRET is required');

const now = Math.floor(Date.now() / 1000);
const claims = {
    typ: 'service', sub: 'svc_growin_initial_seed', personId: 'svc_growin_initial_seed',
    name: 'Growin initial Graph seed', role: 'ceo', level: 3,
    projectCodes: ['growin', 'brainbase'], clearance: ['internal'],
    employmentType: 'internal_service', organizationId: 'org_growin',
    iat: now, exp: now + 900
};
const accessToken = `bbsvc_${jwt.sign(claims, secret)}`;
const graph = createBrainbaseGraphHttpClient({ baseUrl, accessToken, sessionId: `growin-seed-${now}` });

const entities = [
    ['org_growin_partners', 'org', { name: 'グローウィン・パートナーズ株式会社', display_name: 'グローウィン・パートナーズ株式会社', aliases: ['Growin', 'GWP'], description: 'Growin専用Brainbaseを所有・利用する会社' }],
    ['org_growin_ax', 'org', { name: 'AX推進室', display_name: 'AX推進室', description: 'AI活用を推進するCEO直轄部署' }],
    ['project_growin_brainbase', 'project', { name: 'Growin専用Brainbase構築・導入', display_name: 'Growin専用Brainbase構築・導入', status: 'active', description: 'GrowinのGCP上に独立したBrainbase環境を構築・導入するプロジェクト' }],
    ['person_sano_tetsuya', 'person', { name: '佐野 哲哉', display_name: '佐野 哲哉', aliases: ['佐野さん'], org: 'グローウィン・パートナーズ株式会社', role: 'プロジェクトオーナー / AX推進室 室長' }],
    ['person_kawamura_tatsumi', 'person', { name: '川村 達見', display_name: '川村 達見', aliases: ['川村さん'], org: 'グローウィン・パートナーズ株式会社', role: 'PM / 進捗管理・品質最終確認' }],
    ['person_kato_shintaro', 'person', { name: '加藤 真太郎', display_name: '加藤 真太郎', aliases: ['ウッディ'], org: 'グローウィン・パートナーズ株式会社', role: 'PL / 業務リード・品質確認' }],
    ['person_inoue_nozomi', 'person', { name: '井上 希望', display_name: '井上 希望', aliases: ['井上さん'], org: 'グローウィン・パートナーズ株式会社', role: 'プロジェクトチーム / 実務遂行' }]
];

for (const [id, entityType, payload] of entities) {
    await graph.upsertEntity({ id, entityType, projectCode: 'growin', projectName: 'Growin', roleMin: 'member', sensitivity: 'internal', payload });
}
await graph.upsertEntity({
    id: 'phi_growin_graph_ssot_first', entityType: 'philosophy',
    projectCode: 'brainbase', projectName: 'Brainbase共通コンテキスト',
    roleMin: 'member', sensitivity: 'internal',
    payload: {
        philosophy_id: 'phi_growin_graph_ssot_first',
        display_name: 'Growinの承認済みGraphを一次情報にする',
        statement: 'Growinの固有名詞、関係、判断、進行状態はGrowin専用Graphを一次情報として扱う。',
        priority: 'core',
        decision_tests: ['Growin専用Graphを一次情報として確認したか'],
        anti_patterns: ['雲孫または他社のGraphを参照する']
    }
});
console.log(JSON.stringify({ status: 'ok', project: 'growin', entity_count: entities.length + 1 }));
