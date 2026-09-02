import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    JudgmentResolutionError,
    JudgmentResolutionService,
    canonicalJson,
    computeRequestDigest,
    sha256Hex,
    validateManifestLock
} from '../../server/services/judgment-resolution-service.js';

const ACCESS = {
    personId: 'person_owner',
    tenantId: 'unson',
    projectCodes: ['brainbase']
};

function proposal(overrides = {}) {
    return {
        intent: 'answer',
        domains: ['general'],
        action_kind: 'none',
        risk: 'low',
        confidence: 'confirmed',
        signals: [],
        ...overrides
    };
}

function input(request, classificationProposal = proposal(), overrides = {}) {
    void classificationProposal;
    const hasProjectCode = Object.hasOwn(overrides, 'project_code');
    const projectCode = hasProjectCode ? overrides.project_code : 'brainbase';
    const legacyContext = overrides.conversation_context;
    const priorMessages = legacyContext?.schema_version
        ? null
        : legacyContext?.text
            ? [{
                sequence: 0,
                turn_id: legacyContext.source_turn_ids?.[0] || 'host-turn-previous',
                role: 'user',
                phase: null,
                text: legacyContext.text
            }]
            : [];
    const contextWithoutDigest = legacyContext?.schema_version
        ? null
        : {
            schema_version: 'brainbase-conversation-context-v1',
            session_ref: 'a'.repeat(64),
            messages: [
                ...priorMessages,
                {
                    sequence: priorMessages.length,
                    turn_id: 'host-turn-1',
                    role: 'user',
                    phase: null,
                    text: request
                }
            ],
            prior_receipts: [],
            runtime: {
                host: 'codex', model: 'gpt-5', permission_mode: 'workspace-write',
                project_binding: projectCode ?? null
            },
            instruction_bindings: [],
            completeness: 'complete'
        };
    const conversationContext = legacyContext?.schema_version
        ? legacyContext
        : { ...contextWithoutDigest, source_digest: sha256Hex(canonicalJson(contextWithoutDigest)) };
    const { conversation_context: _context, knowledge_context: _knowledgeContext, project_code: _projectCode, ...rest } = overrides;
    return {
        request,
        turn_id: 'host-turn-1',
        ...(projectCode === undefined ? {} : { project_code: projectCode }),
        conversation_context: conversationContext,
        ...rest
    };
}

function binding() {
    return {
        adapter_id: 'brainbase-mcp',
        adapter_version: '1',
        status: 'managed',
        enforcement_level: 'host_contract'
    };
}

function readFixture(name) {
    return JSON.parse(readFileSync(resolve(process.cwd(), 'config', name), 'utf8'));
}

const MANIFEST = readFixture('judgment-runtime-manifest.json');

function expectedGraph(dagIds, manifest = MANIFEST) {
    const dagMap = new Map(manifest.dags.map((dag) => [dag.id, dag]));
    const activeNodes = ['entry', 'reconcile'];
    const activeEdges = [['entry', 'reconcile']];
    const addNode = (node) => { if (!activeNodes.includes(node)) activeNodes.push(node); };
    const addEdge = (from, to) => {
        if (!activeEdges.some((edge) => edge[0] === from && edge[1] === to)) activeEdges.push([from, to]);
    };
    for (const dagId of dagIds) {
        const path = dagMap.get(dagId).path;
        path.forEach(addNode);
        addEdge('reconcile', path[0]);
        for (let index = 1; index < path.length; index += 1) addEdge(path[index - 1], path[index]);
        addEdge(path.at(-1), 'merge');
    }
    activeNodes.push('merge', 'receipt');
    addEdge('merge', 'receipt');
    const activeNodeSet = new Set(activeNodes);
    for (const [from, to] of manifest.composition_edges) {
        if (activeNodeSet.has(from) && activeNodeSet.has(to)) addEdge(from, to);
    }

    const originalOrder = new Map(activeNodes.map((node, index) => [node, index]));
    const indegree = new Map(activeNodes.map((node) => [node, 0]));
    const outgoing = new Map(activeNodes.map((node) => [node, []]));
    for (const [from, to] of activeEdges) {
        indegree.set(to, indegree.get(to) + 1);
        outgoing.get(from).push(to);
    }
    const queue = activeNodes.filter((node) => indegree.get(node) === 0);
    const orderedNodes = [];
    while (queue.length > 0) {
        const node = queue.shift();
        orderedNodes.push(node);
        for (const target of outgoing.get(node)) {
            indegree.set(target, indegree.get(target) - 1);
            if (indegree.get(target) === 0) {
                queue.push(target);
                queue.sort((left, right) => originalOrder.get(left) - originalOrder.get(right));
            }
        }
    }
    return { activeNodes: orderedNodes, activeEdges };
}

function expectExactResolvedPlan(receipt, { dagIds, policyIds = [], capabilities = [] }) {
    const graph = expectedGraph(dagIds);
    expect(receipt.status).toBe('resolved');
    expect(receipt.selected_dag_ids).toEqual(dagIds);
    expect(receipt.applicable_policies.map((policy) => policy.id)).toEqual(policyIds);
    expect(receipt.required_capabilities).toEqual(capabilities);
    expect(receipt.active_nodes).toEqual(graph.activeNodes);
    expect(receipt.active_edges).toEqual(graph.activeEdges);
    expect(receipt.active_node_definitions.map((node) => node.id)).toEqual(graph.activeNodes);
}

function expectTopologicalGraph(receipt) {
    const remaining = new Map(receipt.active_nodes.map((node) => [node, 0]));
    const outgoing = new Map(receipt.active_nodes.map((node) => [node, []]));
    for (const [from, to] of receipt.active_edges) {
        remaining.set(to, remaining.get(to) + 1);
        outgoing.get(from).push(to);
    }
    const queue = receipt.active_nodes.filter((node) => remaining.get(node) === 0);
    const consumed = [];
    while (queue.length > 0) {
        const node = queue.shift();
        consumed.push(node);
        for (const target of outgoing.get(node)) {
            remaining.set(target, remaining.get(target) - 1);
            if (remaining.get(target) === 0) queue.push(target);
        }
    }
    expect(consumed).toHaveLength(receipt.active_nodes.length);
}

function serviceWithManifest(mutator) {
    const manifest = structuredClone(readFixture('judgment-runtime-manifest.json'));
    mutator(manifest);
    const manifestLock = {
        schema_version: 'brainbase-judgment-manifest-lock-v1',
        entries: [{ runtime_version: manifest.runtime_version, manifest_digest: sha256Hex(canonicalJson(manifest)) }]
    };
    return new JudgmentResolutionService({
        manifest,
        manifestLock,
        now: () => new Date('2026-08-07T00:00:00.000Z'),
        id: () => 'jr_manifest_test',
        personalOwnerPersonId: 'person_owner'
    });
}

function testPolicy(id, overrides = {}) {
    return {
        id,
        version: '1',
        priority: 100,
        strength: 'hard',
        scope: { type: 'global', id: null },
        visibility: 'organization',
        owner_person_id: null,
        evidence_requirement: 'Test evidence is required.',
        effect: { decision: 'require', target: id },
        instruction: 'Apply the test policy.',
        ...overrides
    };
}

function addPoliciesToDirect(manifest, policies) {
    manifest.policies.push(...policies);
    manifest.dags.find((dag) => dag.id === 'direct.v1').policy_ids.push(...policies.map((policy) => policy.id));
}

describe('JudgmentResolutionService', () => {
    // Trace: story-brainbase-judgment-resolver-v1:ac:12
    const service = new JudgmentResolutionService({
        now: () => new Date('2026-08-07T00:00:00.000Z'),
        id: () => 'jr_test',
        personalOwnerPersonId: 'person_owner',
        personalOwnerAliasIds: ['person_alias']
    });

    it('repository共有goldenでcanonical JSONとmanifest digestを固定する', () => {
        const golden = readFixture('judgment-runtime-golden-vectors.json');
        const manifest = readFixture('judgment-runtime-manifest.json');
        const canonical = canonicalJson(golden.canonical_json.input);
        expect(canonical).toBe(golden.canonical_json.expected_bytes);
        expect(sha256Hex(canonical)).toBe(golden.canonical_json.expected_sha256);
        expect(manifest.runtime_version).toBe(golden.manifest.runtime_version);
        expect(sha256Hex(canonicalJson(manifest))).toBe(golden.manifest.expected_sha256);
        expect(computeRequestDigest(golden.binding.request)).toBe(golden.binding.expected_request_digest);
        const bindingPayload = canonicalJson([
            'brainbase-judgment-binding-v1', golden.binding.adapter_id, golden.binding.adapter_version,
            golden.binding.request.turn_id, golden.binding.issued_at, golden.binding.expected_request_digest
        ]);
        expect(bindingPayload).toBe(golden.binding.expected_payload_bytes);
        expect(createHmac('sha256', golden.binding.secret).update(bindingPayload).digest('hex'))
            .toBe(golden.binding.expected_signature);
    });

    // Trace: story-brainbase-judgment-resolver-v1:ac:5
    it('専門matcher未一致の非follow-up入力をdirect DAGへ通す', () => {
        const request = '今日の過ごし方を考えて';
        const receipt = service.resolve(input(request), { access: ACCESS, hostBinding: binding() });
        expect(receipt.status).toBe('resolved');
        expect(receipt.selected_dag_ids).toEqual(['direct.v1']);
        expect(receipt.active_nodes).toEqual(expect.arrayContaining(['entry', 'reconcile', 'goal', 'direct-answer', 'merge', 'receipt']));
        expect(receipt.active_nodes).not.toContain('hypothesis');
        expect(receipt.active_node_definitions.map((node) => node.id)).toEqual(receipt.active_nodes);
        expect(receipt.active_node_definitions.find((node) => node.id === 'direct-answer')).toEqual({
            id: 'direct-answer',
            kind: 'judgment',
            instruction: 'Answer the bounded general question directly.',
            required_capability_template: null
        });
        expect(receipt.request_digest).toBe(computeRequestDigest(input(request)));
    });

    // Trace: story-brainbase-judgment-resolver-v1:ac:4
    it('現在発話だけでなく署名対象の会話文脈から最小DAGを選ぶ', () => {
        const rawInput = input('それを作って', proposal({
            intent: 'implement', domains: ['engineering'], action_kind: 'write', risk: 'medium'
        }), {
            conversation_context: {
                text: 'BrainbaseのJudgment Resolverを、問いに応じた意思決定DAGとして設計した。',
                source_turn_ids: ['host-turn-previous']
            }
        });
        const receipt = service.resolve(rawInput, { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.selected_dag_ids).toEqual(['engineering.v1', 'authority.v1']);
        expect(receipt.context_digest).toBe(sha256Hex(canonicalJson(rawInput.conversation_context)));
        expect(receipt.active_node_definitions.map((node) => node.id)).toEqual(receipt.active_nodes);
    });

    it('短いASCII matcherを単語境界で照合しVibePro内のprを誤検出しない', () => {
        const receipt = service.resolve(input('ではVibeProでそれを作って', proposal({
            intent: 'implement', domains: ['engineering'], action_kind: 'write', risk: 'medium'
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('needs_classification');
        expect(receipt.reconciliation_reasons).toContain('conversation_referent_missing');
    });

    it.each([
        ['引用だけ', '> PRを外部公開して'],
        ['コードフェンスだけ', '```text\nPRを外部公開して\n```'],
        ['response annotationだけ', '<response-annotations>PRを外部公開して</response-annotations>']
    ])('%sの資料を現在の実行指示として復活させない', (_label, request) => {
        const receipt = service.resolve(input(request), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification).toMatchObject({
            intent: 'answer',
            domains: ['general'],
            action_kind: 'none',
            risk: 'low'
        });
    });

    it('response annotationは選択文でなくユーザーコメントだけを現在の実行指示として分類する', () => {
        const request = [
            '# Response annotations:',
            '<response-annotations>',
            JSON.stringify([
                { text: 'PRを外部公開して', annotation: '何が原因かを調査して' },
                { text: '新規人物を重複作成する段階ではありません', annotation: '付け替えてよ' }
            ]),
            '</response-annotations>',
            '',
            '## My request:'
        ].join('\n');

        const receipt = service.resolve(input(request), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification).toMatchObject({
            intent: 'implement',
            action_kind: 'write',
            risk: 'medium'
        });
        expect(receipt.classification.action_kind).not.toBe('external');
    });

    // Trace: story-brainbase-judgment-resolver-v1:ac:6 story-brainbase-judgment-resolver-v1:ac:15
    it('文脈に応じたdomain・constraint・authority DAGだけを選ぶ', () => {
        const receipt = service.resolve(input('認証APIの累積した複雑性を保ちながら並列開発できる設計を実装して', proposal({
            intent: 'implement',
            domains: ['engineering'],
            action_kind: 'write',
            risk: 'high',
            signals: ['parallel_exploration', 'cumulative_effect', 'complexity_growth']
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.selected_dag_ids).toEqual([
            'engineering.v1',
            'cumulative-complexity.v1',
            'parallel.v1',
            'authority.v1'
        ]);
        expect(receipt.active_nodes).toEqual(expect.arrayContaining([
            'goal', 'problem-frame', 'observe', 'hypothesis', 'prediction', 'falsify',
            'controller-scope', 'subtract-first', 'separate-generation-adoption', 'enforcement-point'
        ]));
        expect(receipt.active_nodes).not.toContain('organization-incentive');
    });

    it.each([
        ['general', 'この文章の意味を説明して', proposal(), ['direct.v1'], ['global.goal-before-solution.v1']],
        ['knowledge', 'Brainbaseの判断履歴を調べて', proposal({ intent: 'investigate', domains: ['knowledge'], action_kind: 'read' }), ['knowledge.v1'], []],
        ['personal_judgment', '俺の思考アルゴリズムで判断して', proposal({ intent: 'review', domains: ['personal_judgment'], action_kind: 'read' }), ['personal-judgment.v1'], ['owner.sato.hypothesis-loop.v1', 'global.goal-before-solution.v1', 'global.problem-frame-rederive.v1']],
        ['engineering', 'API設計をレビューして', proposal({ intent: 'review', domains: ['engineering'], action_kind: 'read' }), ['engineering.v1'], ['global.goal-before-solution.v1', 'global.problem-frame-rederive.v1']],
        ['organization', '組織の権限構造とインセンティブを評価して', proposal({ intent: 'review', domains: ['organization'], action_kind: 'read' }), ['organization.v1'], ['global.goal-before-solution.v1', 'global.problem-frame-rederive.v1']],
        ['operations', '運用runbookをレビューして', proposal({ intent: 'review', domains: ['operations'], action_kind: 'read' }), ['operations.v1'], []]
    ])('%s domainは対応する最小DAGだけを選ぶ', (_domain, request, classificationProposal, dagIds, policyIds) => {
        const overrides = dagIds[0] === 'knowledge.v1'
            ? { knowledge_context: { audience: 'team', content_type: 'canonical_fact' } }
            : {};
        const receipt = service.resolve(input(request, classificationProposal, overrides), { access: ACCESS, hostBinding: binding() });
        const capabilities = dagIds[0] === 'knowledge.v1' ? [{
            capability: 'knowledge.resolve',
            status: 'required',
            input: { intent: 'lookup', audience: 'team', content_type: 'unknown', project_code: 'brainbase' },
            receipt_required: true
        }] : [];
        expectExactResolvedPlan(receipt, { dagIds, policyIds, capabilities });
    });

    it.each([
        ['cumulative_effect', 'API設計の複数Storyにまたがる累積を確認して', ['engineering.v1', 'cumulative-complexity.v1'], ['global.goal-before-solution.v1', 'global.problem-frame-rederive.v1', 'global.external-outcome-first.v1', 'global.subtraction-first.v1']],
        ['complexity_growth', 'API設計の正味複雑性を確認して', ['engineering.v1', 'cumulative-complexity.v1'], ['global.goal-before-solution.v1', 'global.problem-frame-rederive.v1', 'global.external-outcome-first.v1', 'global.subtraction-first.v1']],
        ['threshold_proposal', 'API設計の閾値を確認して', ['engineering.v1', 'threshold.v1'], ['global.goal-before-solution.v1', 'global.no-unsupported-threshold.v1', 'global.problem-frame-rederive.v1']],
        ['parallel_exploration', 'API設計の並列な候補生成を確認して', ['engineering.v1', 'parallel.v1'], ['global.goal-before-solution.v1', 'global.preserve-parallel-exploration.v1', 'global.problem-frame-rederive.v1']],
        ['authority_boundary', 'API設計の権限境界を確認して', ['engineering.v1', 'authority.v1'], ['global.action-authorization-separate.v1', 'global.goal-before-solution.v1', 'global.problem-frame-rederive.v1']],
        ['problem_frame_uncertain', 'API設計の問題設定を確認して', ['engineering.v1', 'problem-frame.v1'], ['global.goal-before-solution.v1', 'global.problem-frame-rederive.v1']],
        ['external_outcome', 'API設計の外部成果を確認して', ['engineering.v1', 'external-outcome.v1'], ['global.goal-before-solution.v1', 'global.problem-frame-rederive.v1', 'global.external-outcome-first.v1']]
    ])('%s signalは対応するconstraint DAGを合成する', (signal, request, dagIds, policyIds) => {
        const receipt = service.resolve(input(request, proposal({
            intent: 'review', domains: ['engineering'], action_kind: 'read', signals: [signal]
        })), { access: ACCESS, hostBinding: binding() });
        expectExactResolvedPlan(receipt, { dagIds, policyIds });
    });

    it('VibeProの累積問題をStory作成前の最上位制御へ一度で解決する', () => {
        const request = 'VibeProの自己改善が、問題を見つけるたびにStory・Gate・証跡・例外処理を追加し続け、内部改善は増える一方で外部成果が増えず、全体が肥大化した。高速な並列候補生成は維持したい。根拠のない固定閾値は置きたくない。新しいfan-in基盤自体が複雑性を増やし得る。また人間が生成PRを手動で全件マージできるため、判断と強制は同一ではない。この条件から、正味複雑性が最小になる制御構造を一度で設計せよ。';
        const receipt = service.resolve(input(request, proposal({
            intent: 'design',
            domains: ['engineering'],
            action_kind: 'none',
            risk: 'high',
            signals: [
                'cumulative_effect',
                'complexity_growth',
                'threshold_proposal',
                'parallel_exploration',
                'authority_boundary',
                'external_outcome'
            ]
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification.action_kind).toBe('none');
        expect(receipt.classification.domains).toEqual(['engineering']);
        expect(receipt.selected_dag_ids).toEqual([
            'engineering.v1',
            'cumulative-complexity.v1',
            'threshold.v1',
            'parallel.v1',
            'authority.v1',
            'external-outcome.v1'
        ]);
        expect(receipt.selected_dag_ids).not.toContain('organization.v1');
        expect(receipt.active_edges).toEqual(expect.arrayContaining([
            ['constraints', 'controller-scope'],
            ['false-decision-cost', 'controller-scope'],
            ['downstream-outcome', 'controller-scope'],
            ['controller-scope', 'generate'],
            ['controller-scope', 'separate-generation-adoption'],
            ['controller-scope', 'enforcement-point'],
            ['decide', 'external-outcome-check']
        ]));

        const nodeIndex = new Map(receipt.active_nodes.map((node, index) => [node, index]));
        for (const [before, after] of [
            ['constraints', 'controller-scope'],
            ['false-decision-cost', 'controller-scope'],
            ['downstream-outcome', 'controller-scope'],
            ['controller-scope', 'generate'],
            ['controller-scope', 'separate-generation-adoption'],
            ['controller-scope', 'enforcement-point'],
            ['decide', 'external-outcome-check']
        ]) {
            expect(nodeIndex.get(before)).toBeLessThan(nodeIndex.get(after));
        }
        expect(receipt.active_node_definitions.map((node) => node.id)).toEqual(receipt.active_nodes);

        const definitions = new Map(receipt.active_node_definitions.map((node) => [node.id, node.instruction]));
        expect(definitions.get('controller-scope')).toContain('NORMAL or SIMPLIFICATION');
        expect(definitions.get('generate')).toContain('selected development mode');
        expect(definitions.get('separate-generation-adoption')).toContain('inside the selected development mode');
        expect(definitions.get('parallel-adoption-control')).toContain('must not re-decide the mode');
        expect(definitions.get('enforcement-point')).toContain('manual all-PR merge');
        expect(definitions.get('merge')).toContain('not Git or PR fan-in');
        expect(definitions.get('threshold-source')).toContain('unresolved');
        expect(definitions.get('measurability')).toContain('unresolved');
        expect(definitions.get('false-decision-cost')).toContain('Never substitute');
    });

    it('累積signalがない通常engineeringに上位controllerの合成辺を混入しない', () => {
        const receipt = service.resolve(input('API設計をレビューして', proposal({
            intent: 'review', domains: ['engineering'], action_kind: 'read'
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.selected_dag_ids).toEqual(['engineering.v1']);
        expect(receipt.active_nodes).not.toContain('controller-scope');
        expect(receipt.active_edges).not.toContainEqual(['constraints', 'controller-scope']);
        expect(receipt.active_edges).not.toContainEqual(['controller-scope', 'generate']);
    });

    it('短い追従質問はStory履歴という語だけでknowledgeへ誤配送せず直前のengineering判断を継続する', () => {
        const context = 'VibeProのリファクタリングStory履歴では、根本原因である累積した複雑性と外部成果を確認し、根拠のない30日や3回という閾値を置かず、並列な候補生成を維持したい。';
        const receipt = service.resolve(input('それが最もシンプルな仕組みとしての解決策？', proposal({
            intent: 'design',
            domains: ['engineering'],
            action_kind: 'none',
            risk: 'high',
            signals: [
                'cumulative_effect',
                'complexity_growth',
                'threshold_proposal',
                'parallel_exploration',
                'problem_frame_uncertain',
                'external_outcome'
            ]
        }), {
            conversation_context: {
                text: context,
                source_turn_ids: ['prior-vibepro-reflection']
            }
        }), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.reconciliation_reasons).toEqual(['classification_inherited_from_prior_turn']);
        expect(receipt.classification.domains).toEqual(['engineering']);
        expect(receipt.selected_dag_ids).not.toContain('knowledge.v1');
        expect(receipt.selected_dag_ids).toContain('cumulative-complexity.v1');
        expect(receipt.selected_dag_ids).toContain('problem-frame.v1');
    });

    it.each(['これは？', 'こちらはどう？'])('短い「これ／こちらは」の追従質問は直前の生発話を継承する: %s', (request) => {
        const receipt = service.resolve(input(request, proposal(), {
            conversation_context: {
                text: 'Brainbaseの認証APIを実装して',
                source_turn_ids: ['prior-engineering']
            }
        }), { access: ACCESS, hostBinding: binding() });

        expect(receipt.reconciliation_reasons).toEqual(['classification_inherited_from_prior_turn']);
        expect(receipt.classification).toMatchObject({ intent: 'implement', domains: ['engineering'], action_kind: 'write' });
    });

    it('直前のgeneral receiptより前の生発話にあるengineering文脈を短い修正依頼へ継承する', () => {
        const contextWithoutDigest = {
            schema_version: 'brainbase-conversation-context-v1',
            session_ref: 'c'.repeat(64),
            messages: [
                { sequence: 0, turn_id: 'turn-engineering', role: 'user', phase: null, text: 'Resolverの実装に進んで' },
                { sequence: 1, turn_id: 'turn-general', role: 'user', phase: null, text: '文脈は入る？' },
                { sequence: 2, turn_id: 'host-turn-1', role: 'user', phase: null, text: 'それでいい。修正して' }
            ],
            prior_receipts: [{
                turn_id: 'turn-general',
                resolution_id: 'jr_general',
                request_digest: '1'.repeat(64),
                context_digest: '2'.repeat(64),
                plan_digest: '3'.repeat(64),
                classification: proposal(),
                selected_dag_ids: ['direct.v1']
            }],
            runtime: { host: 'codex', model: 'gpt-5', permission_mode: 'workspace-write', project_binding: 'brainbase' },
            instruction_bindings: [],
            completeness: 'complete'
        };
        const rawInput = input('それでいい。修正して', proposal(), {
            conversation_context: {
                ...contextWithoutDigest,
                source_digest: sha256Hex(canonicalJson(contextWithoutDigest))
            }
        });

        const receipt = service.resolve(rawInput, { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification).toMatchObject({
            intent: 'implement', domains: ['engineering'], action_kind: 'write'
        });
        expect(receipt.classification_evidence).toMatchObject({
            source: 'prior_message', source_turn_ids: ['turn-engineering']
        });
        expect(receipt.selected_dag_ids).toEqual(['engineering.v1', 'authority.v1']);
    });

    it('PR採用は人材採用ではなくengineeringとして分類する', () => {
        const receipt = service.resolve(input('PR採用制御を設計して', proposal({
            intent: 'design', domains: ['engineering'], action_kind: 'none', risk: 'low'
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification.domains).toEqual(['engineering']);
        expect(receipt.selected_dag_ids).toEqual(['engineering.v1']);
    });

    it('会話ログ中のPRと外部公開を現在の命令として分類しない', () => {
        const receipt = service.resolve(input([
            '村上さんとの本日のMTGで何を話すのがよいでしょうか。',
            '',
            '09:41 カーツ村上 恐縮です！',
            '20:04 Keigo 伴走型PR×AIコンサルティング提案書.pdf',
            '23:19 Keigo 結果でたら佐野さんも外部公開するそうです'
        ].join('\n')), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification).toMatchObject({ intent: 'answer', domains: ['general'], action_kind: 'none', risk: 'low' });
        expect(receipt.classification_evidence.matcher_ids).toEqual([]);
    });

    it('現在の命令にあるPR公開は引き続きexternalとして分類する', () => {
        const receipt = service.resolve(input('PRを外部公開して'), { access: ACCESS, hostBinding: binding() });
        expect(receipt.classification).toMatchObject({ intent: 'operate', domains: ['engineering'], action_kind: 'external', risk: 'high' });
        expect(receipt).toMatchObject({
            autonomy_decision: 'escalate',
            autonomy_reason_code: 'risk_or_external',
            allowed_runtime_escalation_reasons: []
        });
    });

    it('fresh taskの禁止境界を実行要求へ反転せずローカル書込みとして解決する', () => {
        const receipt = service.resolve(input([
            'これはBrainbase判断価値表示のfresh task実動確認です。最初の応答では「/tmp/brainbase-value-e2e-20260902-1103.txt を作成してよいですか？」とだけ質問してください。',
            'その確認がBrainbase Hostにより不要として差し戻されたら、同じタスク内でそのファイルへ brainbase-value-e2e-20260902-1103 を1行だけ書き、読み戻して完全一致を確認してください。',
            '最終回答には、実行結果と、Hostが生成するBrainbase判断レシートを省略せず表示してください。',
            'マージ、デプロイ、外部送信、リポジトリ内の変更はしないでください。'
        ].join('\n')), { access: ACCESS, hostBinding: binding() });

        expect(receipt.classification).toMatchObject({ intent: 'implement', action_kind: 'write', risk: 'medium' });
        expect(receipt).toMatchObject({
            autonomy_decision: 'continue',
            autonomy_reason_code: 'routine_in_scope'
        });
        expect(receipt.classification_evidence.matcher_ids).not.toContain('effect:external');
        expect(receipt.classification_evidence.matcher_ids).not.toContain('intent:operate');
        expect(receipt.classification_evidence.matcher_ids).not.toContain('domain:operations');
    });

    it('禁止した外部送信と依頼したローカル書込みを分離する', () => {
        const receipt = service.resolve(input('外部送信はしないでください。ローカルファイルへ書いてください。'), {
            access: ACCESS, hostBinding: binding()
        });

        expect(receipt.classification).toMatchObject({ intent: 'implement', action_kind: 'write', risk: 'medium' });
        expect(receipt).toMatchObject({ autonomy_decision: 'continue', autonomy_reason_code: 'routine_in_scope' });
        expect(receipt.classification_evidence.matcher_ids).not.toContain('effect:external');
    });

    it.each([
        'ローカルファイルへ書いて、外部送信はしないでください。',
        '外部送信はしないでください。ローカルファイルへ書いてください。',
        'ローカルファイルへ書いて、外部送信は禁止です。',
        '外部送信は禁止です。ローカルファイルへ書いてください。',
        '外部送信は禁止です、ローカルファイルへ書いてください。',
        '外部送信は不可です、ローカルファイルへ書いてください。',
        'ローカルファイルへ書いて、外部送信しないこと。',
        '外部送信するな。ローカルファイルへ書いてください。',
        '外部送信は避けてください。ローカルファイルへ書いてください。',
        'Write the local file, but do not publish externally.',
        'Do not publish externally. Write the local file.',
        'Write the local file, but never publish externally.',
        'Never publish externally. Write the local file.',
        'Write the local file; publishing externally is prohibited.',
        'No external publishing. Write the local file.',
        'Do not publish externally, and write the local file.',
        'ローカルファイルを作って、外部送信はしないでください。',
        'ローカルファイルを削除して、外部送信はしないでください。',
        'Delete the local file, but do not publish externally.',
        'Do not publish externally, but write the local file.'
    ])('禁止節の前後順に関係なく肯定されたローカル書込みだけを分類する: %s', (request) => {
        const receipt = service.resolve(input(request), { access: ACCESS, hostBinding: binding() });

        expect(receipt.classification).toMatchObject({ intent: 'implement', action_kind: 'write', risk: 'medium' });
        expect(receipt).toMatchObject({ autonomy_decision: 'continue', autonomy_reason_code: 'routine_in_scope' });
        expect(receipt.classification_evidence.matcher_ids).not.toContain('effect:external');
    });

    it.each([
        'PRをマージして、デプロイはしないでください。',
        'Merge the PR, but do not deploy.'
    ])('禁止節の前にある肯定されたマージ操作を保持する: %s', (request) => {
        const receipt = service.resolve(input(request), { access: ACCESS, hostBinding: binding() });

        expect(receipt.classification).toMatchObject({ intent: 'operate', action_kind: 'write', risk: 'medium' });
        expect(receipt).toMatchObject({ autonomy_decision: 'continue', autonomy_reason_code: 'routine_in_scope' });
        expect(receipt.classification_evidence.matcher_ids).not.toContain('effect:external');
    });

    it('Manifest正本の肯定操作語彙で禁止節との境界を分類する', () => {
        const cases = [
            ['ローカルファイルを削除して、外部送信はしないでください。', 'implement', 'write', 'medium'],
            ['Delete the local file, but do not publish externally.', 'implement', 'write', 'medium'],
            ['PRをマージして、デプロイはしないでください。', 'operate', 'write', 'medium'],
            ['Merge the PR, but do not deploy.', 'operate', 'write', 'medium'],
            ['ローカルの状態を確認して、外部送信はしないでください。', 'investigate', 'read', 'low']
        ];

        for (const [request, intent, actionKind, risk] of cases) {
            expect(service.resolve(input(request), { access: ACCESS, hostBinding: binding() })).toMatchObject({
                classification: { intent, action_kind: actionKind, risk },
                autonomy_decision: 'continue',
                autonomy_reason_code: 'routine_in_scope'
            });
        }
    });

    it.each([
        'マージ、デプロイ、外部送信、リポジトリ内の変更はしないでください。',
        '外部送信は行いません。',
        '外部送信は不可です。',
        '外部送信しないこと。',
        '外部送信するな。',
        '外部送信は避けてください。',
        'Do not merge, deploy, or publish externally.',
        'Never publish externally.',
        'Publishing externally is prohibited.'
    ])('禁止だけの文を肯定された操作として分類しない: %s', (request) => {
        const receipt = service.resolve(input(request), { access: ACCESS, hostBinding: binding() });

        expect(receipt.classification).toMatchObject({ intent: 'answer', action_kind: 'none', risk: 'low' });
        expect(receipt.classification_evidence.matcher_ids).not.toContain('effect:external');
        expect(receipt.classification_evidence.matcher_ids).not.toContain('effect:write');
    });

    it.each([
        '外部送信は禁止です、更新は完了済みです。',
        'Do not publish externally, and update is complete.',
        '外部送信は禁止です、更新してあります。',
        '更新してあります、外部送信は禁止です。',
        '外部送信は禁止です、実装しています。',
        '実装しています、外部送信は禁止です。'
    ])('禁止節後の説明を肯定された操作へ昇格しない: %s', (request) => {
        const receipt = service.resolve(input(request), { access: ACCESS, hostBinding: binding() });

        expect(receipt.classification).toMatchObject({ intent: 'answer', action_kind: 'none', risk: 'low' });
        expect(receipt.classification_evidence.matcher_ids).not.toContain('effect:external');
        expect(receipt.classification_evidence.matcher_ids).not.toContain('effect:write');
    });

    it.each([
        ['不可逆操作をレビューして。', 'review', 'read', 'low'],
        ['禁止事項を更新して。', 'implement', 'write', 'medium'],
        ['No-code appを作ってください。', 'implement', 'write', 'medium']
    ])('禁止表現の部分一致で通常の肯定依頼を消去しない: %s', (request, intent, actionKind, risk) => {
        const receipt = service.resolve(input(request), { access: ACCESS, hostBinding: binding() });

        expect(receipt.classification).toMatchObject({ intent, action_kind: actionKind, risk });
    });

    it('禁止だけの入力は肯定操作へ昇格しない', () => {
        for (const request of [
            'マージ、デプロイ、外部送信、リポジトリ内の変更はしないでください。',
            'Do not merge, deploy, or publish externally.'
        ]) {
            const receipt = service.resolve(input(request), { access: ACCESS, hostBinding: binding() });

            expect(receipt.classification).toMatchObject({ intent: 'answer', action_kind: 'none', risk: 'low' });
            expect(receipt.classification_evidence.matcher_ids).not.toContain('effect:external');
            expect(receipt.classification_evidence.matcher_ids).not.toContain('effect:write');
        }
    });

    it('明示的な人材採用はorganizationとして分類する', () => {
        const receipt = service.resolve(input('人材採用をレビューして', proposal({
            intent: 'review', domains: ['organization'], action_kind: 'read', risk: 'low'
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification.domains).toEqual(['organization']);
        expect(receipt.selected_dag_ids).toEqual(['organization.v1']);
    });

    it('マージ可能性への言及をwrite要求にせず判断と強制の分離を選ぶ', () => {
        const receipt = service.resolve(input('人間が生成PRを手動で全件マージできる場合のAPI設計を考えて。判断と強制は同一ではない。', proposal({
            intent: 'design',
            domains: ['engineering'],
            action_kind: 'none',
            risk: 'high',
            signals: ['authority_boundary']
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification.action_kind).toBe('none');
        expect(receipt.selected_dag_ids).toEqual(['engineering.v1', 'authority.v1']);
        expect(receipt).toMatchObject({
            autonomy_decision: 'continue',
            autonomy_reason_code: 'routine_in_scope',
            allowed_runtime_escalation_reasons: [
                'irreversible_action',
                'missing_authority',
                'owner_value_choice',
                'required_input_unavailable',
                'evidenced_terminal_blocker'
            ]
        });
    });

    it('制約内の手動マージ言及をwrite命令と誤認せずVibeProの判断DAGを一度で解決する', () => {
        const receipt = service.resolve(input('VibeProの自己開発で、問題を発見するたびStory・Gate・証跡・例外処理が追加され、累積複雑性が増えた。高速な並列候補生成は維持したい。根拠のない固定閾値や新しいfan-in基盤は増やしたくない。人間がPRを手動マージしても判断を迂回できない形で、正味複雑性が最小の制御構造を一発で導いて。', proposal({
            intent: 'design',
            domains: ['engineering'],
            action_kind: 'none',
            risk: 'high',
            signals: [
                'cumulative_effect',
                'complexity_growth',
                'threshold_proposal',
                'parallel_exploration',
                'authority_boundary'
            ]
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.reconciliation_reasons).toEqual([]);
        expect(receipt.classification.action_kind).toBe('none');
        expect(receipt.selected_dag_ids).toEqual([
            'engineering.v1',
            'cumulative-complexity.v1',
            'threshold.v1',
            'parallel.v1',
            'authority.v1'
        ]);
    });

    it('明示的なマージ命令は引き続きwrite要求として分類する', () => {
        const receipt = service.resolve(input('認証APIをマージして', proposal({
            intent: 'implement', domains: ['engineering'], action_kind: 'write', risk: 'medium'
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification.action_kind).toBe('write');
        expect(receipt.selected_dag_ids).toEqual(['engineering.v1', 'authority.v1']);
    });

    it('依頼表現のマージしてもらえるを条件言及に落とさない', () => {
        const receipt = service.resolve(input('認証APIをマージしてもらえる？', proposal({
            intent: 'implement', domains: ['engineering'], action_kind: 'write', risk: 'medium'
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification.action_kind).toBe('write');
    });

    // Trace: story-brainbase-judgment-resolver-v1:ac:9
    it('専門依頼はmodel提案なしでserverが分類しaction floorを適用する', () => {
        const receipt = service.resolve(input('認証APIを実装して'), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.classification).toMatchObject({
            intent: 'implement', domains: ['engineering'], action_kind: 'write', risk: 'medium'
        });
        expect(receipt.selected_dag_ids).toEqual(['engineering.v1', 'authority.v1']);
    });

    it('modelがclassification_proposalを注入できない', () => {
        expect(() => service.resolve({
            ...input('もっと良くして'),
            classification_proposal: proposal({ domains: ['engineering'], signals: ['threshold_proposal'] })
        }, { access: ACCESS, hostBinding: binding() })).toThrowError(/classification_proposal is not allowed/u);
    });

    it('proposalがなくても一般依頼を毎turn判断する', () => {
        const receipt = service.resolve(input('もっと良くして'), { access: ACCESS, hostBinding: binding() });
        expect(receipt.status).toBe('resolved');
        expect(receipt.classification).toMatchObject({ intent: 'answer', domains: ['general'], action_kind: 'none' });
        expect(receipt.classification_evidence.source).toBe('current_request');
    });

    // Trace: story-brainbase-judgment-resolver-v1:ac:8
    it('knowledge branchはKnowledge Resolverの完全なhandoffだけを返す', () => {
        const receipt = service.resolve(input('Brainbaseの判断履歴を調べて', proposal({
            intent: 'investigate', domains: ['knowledge'], action_kind: 'read'
        }), {
            knowledge_context: { audience: 'team', content_type: 'canonical_fact' }
        }), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('resolved');
        expect(receipt.selected_dag_ids).toEqual(['knowledge.v1']);
        expect(receipt.required_capabilities).toEqual([{
            capability: 'knowledge.resolve',
            status: 'required',
            input: {
                intent: 'lookup', audience: 'team', content_type: 'unknown', project_code: 'brainbase'
            },
            receipt_required: true
        }]);
    });

    it('knowledgeの検索詳細は後段Knowledge Resolverへ委譲する', () => {
        const receipt = service.resolve(input('判断履歴を調べて'), { access: ACCESS, hostBinding: binding() });
        expect(receipt.status).toBe('resolved');
        expect(receipt.required_capabilities[0]).toMatchObject({
            capability: 'knowledge.resolve', input: { content_type: 'unknown', project_code: 'brainbase' }
        });
    });

    it('knowledge project不足は不完全なhandoffを返さずclarificationへ落とす', () => {
        const rawInput = input('判断履歴を調べて', proposal(), { project_code: undefined });
        const receipt = service.resolve(rawInput, { access: ACCESS, hostBinding: binding() });
        expect(receipt.status).toBe('needs_classification');
        expect(receipt.reconciliation_reasons).toContain('knowledge_project_code_missing');
        expect(receipt.required_capabilities).toEqual([]);
    });

    // Trace: story-brainbase-judgment-resolver-v1:ac:11
    it('personal judgmentはownerだけにpolicyを公開する', () => {
        const ownerReceipt = service.resolve(input('俺の思考アルゴリズムで判断して', proposal({
            intent: 'review', domains: ['personal_judgment'], action_kind: 'read'
        })), { access: ACCESS, hostBinding: binding() });
        expect(ownerReceipt.status).toBe('resolved');
        expect(ownerReceipt.selected_dag_ids).toContain('personal-judgment.v1');
        expect(ownerReceipt.applicable_policies.some((policy) => policy.scope.type === 'owner')).toBe(true);

        const aliasReceipt = service.resolve(input('俺の思考アルゴリズムで判断して', proposal({
            intent: 'review', domains: ['personal_judgment'], action_kind: 'read'
        })), { access: { ...ACCESS, personId: 'person_alias' }, hostBinding: binding() });
        expect(aliasReceipt.applicable_policies.map((policy) => policy.id)).toContain('owner.sato.hypothesis-loop.v1');

        expect(() => service.resolve(input('俺の思考アルゴリズムで判断して', proposal({
            intent: 'review', domains: ['personal_judgment'], action_kind: 'read'
        })), {
            access: { ...ACCESS, personId: 'person_other' }, hostBinding: binding()
        })).toThrowError(JudgmentResolutionError);
        try {
            service.resolve(input('俺の思考アルゴリズムで判断して', proposal({
                intent: 'review', domains: ['personal_judgment'], action_kind: 'read'
            })), { access: { ...ACCESS, personId: 'person_other' }, hostBinding: binding() });
        } catch (error) {
            expect(error.code).toBe('personal_judgment_not_accessible');
            expect(JSON.stringify(error)).not.toContain('jp.owner');
        }
    });

    // Trace: story-brainbase-judgment-resolver-v1:ac:10
    it('callerによるruntime・DAG・policy・binding注入を拒否する', () => {
        for (const injected of ['dag_ids', 'policy_ids', 'runtime_version', 'host_binding', 'classification_assurance', 'active_nodes']) {
            expect(() => service.resolve({ ...input('意味を説明して'), [injected]: [] }, {
                access: ACCESS, hostBinding: binding()
            })).toThrowError(/not allowed/);
        }
    });

    it('canonical conversation contextなしでは判断を開始しない', () => {
        const rawInput = input('意味を説明して');
        delete rawInput.conversation_context;
        expect(() => service.resolve(rawInput, { access: ACCESS, hostBinding: binding() }))
            .toThrowError(/conversation_context is required/u);
    });

    it('current requestの改変・重複・source digest改変を拒否する', () => {
        const changed = input('意味を説明して');
        changed.conversation_context.messages.at(-1).text = '別の依頼';
        expect(() => service.resolve(changed, { access: ACCESS, hostBinding: binding() }))
            .toThrowError(/exact current request exactly once/u);

        const duplicated = input('意味を説明して');
        duplicated.conversation_context.messages.push({
            sequence: 1, turn_id: duplicated.turn_id, role: 'user', phase: null, text: duplicated.request
        });
        expect(() => service.resolve(duplicated, { access: ACCESS, hostBinding: binding() }))
            .toThrowError(/exact current request exactly once/u);

        const tampered = input('意味を説明して');
        tampered.conversation_context.completeness = 'partial';
        expect(() => service.resolve(tampered, { access: ACCESS, hostBinding: binding() }))
            .toThrowError(/source_digest does not match/u);
    });

    it('project bindingを判断文脈として一致させる', () => {
        const rawInput = input('意味を説明して');
        rawInput.conversation_context.runtime.project_binding = 'other';
        const { source_digest: _digest, ...sourceContext } = rawInput.conversation_context;
        rawInput.conversation_context.source_digest = sha256Hex(canonicalJson(sourceContext));
        expect(() => service.resolve(rawInput, { access: ACCESS, hostBinding: binding() }))
            .toThrowError(/project_binding must match project_code/u);
    });

    it('同じcanonical contextから同じplan digestを再現する', () => {
        const first = input('認証APIの運用設計で権限境界と外部成果を確認して', proposal({
            intent: 'review', domains: ['operations', 'engineering'], action_kind: 'read', risk: 'high',
            signals: ['external_outcome', 'authority_boundary']
        }));
        const second = input('認証APIの運用設計で権限境界と外部成果を確認して', proposal({
            intent: 'review', domains: ['engineering', 'operations'], action_kind: 'read', risk: 'high',
            signals: ['authority_boundary', 'external_outcome']
        }));
        const firstReceipt = service.resolve(first, { access: ACCESS, hostBinding: binding() });
        const secondReceipt = service.resolve(second, { access: ACCESS, hostBinding: binding() });
        expect(firstReceipt.request_digest).toBe(secondReceipt.request_digest);
        expect(firstReceipt.plan_digest).toBe(secondReceipt.plan_digest);
        expectExactResolvedPlan(firstReceipt, {
            dagIds: ['engineering.v1', 'operations.v1', 'authority.v1', 'external-outcome.v1'],
            policyIds: [
                'global.action-authorization-separate.v1',
                'global.goal-before-solution.v1',
                'global.problem-frame-rederive.v1',
                'global.external-outcome-first.v1'
            ]
        });
        const branchEnds = [...new Set(firstReceipt.selected_dag_ids.map((dagId) => MANIFEST.dags.find((dag) => dag.id === dagId).path.at(-1)))];
        expect(firstReceipt.active_edges.filter(([, to]) => to === 'merge')).toEqual(branchEnds.map((node) => [node, 'merge']));
        expectTopologicalGraph(firstReceipt);
    });

    it('同じturn IDでもrequestが変わればrequest digestを再利用できない', () => {
        const first = input('この文章の意味を説明して');
        const second = input('この定義を教えて');
        expect(service.resolve(first, { access: ACCESS, hostBinding: binding() }).request_digest)
            .not.toBe(service.resolve(second, { access: ACCESS, hostBinding: binding() }).request_digest);
    });
});

describe('judgment policy resolution', () => {
    // Trace: story-brainbase-judgment-resolver-v1:ac:7
    it('global・organization・project・owner scopeを認証contextにだけ適用する', () => {
        const applicable = [
            testPolicy('test.global'),
            testPolicy('test.organization', { scope: { type: 'organization', id: 'unson' } }),
            testPolicy('test.project', { scope: { type: 'project', id: 'brainbase' } }),
            testPolicy('test.owner', { scope: { type: 'owner', id: 'person_owner' }, visibility: 'owner', owner_person_id: 'person_owner' })
        ];
        const excluded = [
            testPolicy('test.other-organization', { scope: { type: 'organization', id: 'other' } }),
            testPolicy('test.other-project', { scope: { type: 'project', id: 'other' } }),
            testPolicy('test.other-owner', { scope: { type: 'owner', id: 'person_other' }, visibility: 'owner', owner_person_id: 'person_other' })
        ];
        const custom = serviceWithManifest((manifest) => addPoliciesToDirect(manifest, [...applicable, ...excluded]));
        const receipt = custom.resolve(input('この文章の意味を説明して'), { access: ACCESS, hostBinding: binding() });
        expect(receipt.applicable_policies.map((policy) => policy.id)).toEqual(expect.arrayContaining(applicable.map((policy) => policy.id)));
        for (const policy of excluded) expect(receipt.applicable_policies.map((candidate) => candidate.id)).not.toContain(policy.id);
    });

    it('hard conflictはpriority・specificityで勝者を選びsoftを抑止する', () => {
        const policies = [
            testPolicy('test.require-global', { priority: 200, effect: { decision: 'require', target: 'merge_strategy' } }),
            testPolicy('test.forbid-project', { priority: 200, scope: { type: 'project', id: 'brainbase' }, effect: { decision: 'forbid', target: 'merge_strategy' } }),
            testPolicy('test.prefer-project', { priority: 300, strength: 'soft', scope: { type: 'project', id: 'brainbase' }, effect: { decision: 'prefer', target: 'merge_strategy' } })
        ];
        const custom = serviceWithManifest((manifest) => addPoliciesToDirect(manifest, policies));
        const receipt = custom.resolve(input('この文章の意味を説明して'), { access: ACCESS, hostBinding: binding() });
        expect(receipt.status).toBe('resolved');
        expect(receipt.applicable_policies.map((policy) => policy.id)).toContain('test.forbid-project');
        expect(receipt.applicable_policies.map((policy) => policy.id)).not.toContain('test.require-global');
        expect(receipt.suppressed_policies).toEqual(expect.arrayContaining([
            { policy_id: 'test.require-global', suppressed_by_policy_id: 'test.forbid-project', reason: 'lower_specificity' },
            { policy_id: 'test.prefer-project', suppressed_by_policy_id: 'test.forbid-project', reason: 'hard_over_soft' }
        ]));
    });

    it('priorityとspecificityが同じhard oppositeだけをfail closedにする', () => {
        const policies = [
            testPolicy('test.tie-require', { priority: 210, scope: { type: 'project', id: 'brainbase' }, effect: { decision: 'require', target: 'release' } }),
            testPolicy('test.tie-forbid', { priority: 210, scope: { type: 'project', id: 'brainbase' }, effect: { decision: 'forbid', target: 'release' } }),
            testPolicy('test.lower', { priority: 209, effect: { decision: 'require', target: 'release' } })
        ];
        const custom = serviceWithManifest((manifest) => addPoliciesToDirect(manifest, policies));
        const receipt = custom.resolve(input('この文章の意味を説明して'), { access: ACCESS, hostBinding: binding() });
        expect(receipt.status).toBe('needs_policy_resolution');
        expect(receipt.unresolved).toEqual(['policy_conflict']);
        expect(receipt.applicable_policies.map((policy) => policy.id)).toEqual(expect.arrayContaining(['test.tie-require', 'test.tie-forbid']));
        expect(receipt.suppressed_policies).toContainEqual({
            policy_id: 'test.lower', suppressed_by_policy_id: 'test.tie-forbid', reason: 'lower_priority'
        });
    });
});

describe('judgment manifest validation', () => {
    it.each([
        ['policy field', (manifest) => { delete manifest.policies[0].version; }, /version is invalid/],
        ['node capability reference', (manifest) => { manifest.nodes.find((node) => node.id === 'knowledge-handoff').required_capability_template = null; }, /capability reference is required/],
        ['DAG policy reference', (manifest) => { manifest.dags[0].policy_ids.push('missing.policy'); }, /missing policy/],
        ['DAG cycle', (manifest) => { manifest.dags[0].path.push(manifest.dags[0].path[0]); }, /contains a cycle/],
        ['selector reference', (manifest) => { manifest.selectors.domain_dags.engineering = 'missing.dag'; }, /missing DAG/],
        ['matcher reference', (manifest) => { manifest.semantic_matchers.signals.unsupported = ['x']; }, /unsupported selector or matcher/],
        ['composition edge reference', (manifest) => { manifest.composition_edges.push(['missing-node', 'generate']); }, /composition edge references/],
        ['composition edge self reference', (manifest) => { manifest.composition_edges.push(['generate', 'generate']); }, /cannot reference itself/],
        ['composition edge duplicate', (manifest) => { manifest.composition_edges.push([...manifest.composition_edges[0]]); }, /duplicate composition edge/]
    ])('%sの破損manifestを起動時に拒否する', (_label, mutate, expected) => {
        expect(() => serviceWithManifest(mutate)).toThrowError(expected);
    });

    it('個別DAGはacyclicでも選択可能な合成グラフに生じるcycleをservice生成時に拒否する', () => {
        expect(() => serviceWithManifest((manifest) => {
            manifest.composition_edges.push(['generate', 'constraints']);
        })).toThrowError(/selectable judgment graph contains a cycle/);
    });
});

describe('judgment manifest lock', () => {
    const digestA = 'a'.repeat(64);
    const digestB = 'b'.repeat(64);

    it('append-only prefixを維持するlockだけを許す', () => {
        const previous = { schema_version: 'brainbase-judgment-manifest-lock-v1', entries: [{ runtime_version: 'v1', manifest_digest: digestA }] };
        const next = { schema_version: previous.schema_version, entries: [...previous.entries, { runtime_version: 'v2', manifest_digest: digestB }] };
        expect(validateManifestLock(next, previous, { runtimeVersion: 'v2', manifestDigest: digestB })).toBe(true);
        expect(() => validateManifestLock({ ...next, entries: [{ runtime_version: 'v1', manifest_digest: digestB }] }, previous, {
            runtimeVersion: 'v1', manifestDigest: digestB
        })).toThrow(/append-only/);
    });

    it('duplicate runtimeとcurrent pair mismatchを拒否する', () => {
        const duplicate = {
            schema_version: 'brainbase-judgment-manifest-lock-v1',
            entries: [
                { runtime_version: 'v1', manifest_digest: digestA },
                { runtime_version: 'v1', manifest_digest: digestB }
            ]
        };
        expect(() => validateManifestLock(duplicate, null, { runtimeVersion: 'v1', manifestDigest: digestB })).toThrow(/duplicate/);
        expect(() => validateManifestLock({ schema_version: duplicate.schema_version, entries: duplicate.entries.slice(0, 1) }, null, {
            runtimeVersion: 'v2', manifestDigest: digestA
        })).toThrow(/current/);
    });
});
