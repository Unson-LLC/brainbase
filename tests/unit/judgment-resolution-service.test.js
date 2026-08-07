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
    return {
        request,
        turn_id: 'host-turn-1',
        project_code: 'brainbase',
        classification_proposal: classificationProposal,
        ...overrides
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
    });

    // Trace: story-brainbase-judgment-resolver-v1:ac:5
    it('肯定一致したsafe generalだけをdirect DAGへ通す', () => {
        const receipt = service.resolve(input('この文章の意味を説明して'), { access: ACCESS, hostBinding: binding() });
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
        expect(receipt.request_digest).toBe(computeRequestDigest(input('この文章の意味を説明して')));
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
        expect(receipt.reconciliation_reasons).toContain('domain_supported_only_by_proposal');
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
        ['general', 'この文章の意味を説明して', proposal(), 'direct.v1', 'hypothesis'],
        ['knowledge', 'Brainbaseの判断履歴を調べて', proposal({ intent: 'investigate', domains: ['knowledge'], action_kind: 'read' }), 'knowledge.v1', 'personal-decision'],
        ['personal_judgment', '俺の思考アルゴリズムで判断して', proposal({ intent: 'review', domains: ['personal_judgment'], action_kind: 'read' }), 'personal-judgment.v1', 'organization-incentive'],
        ['engineering', 'API設計をレビューして', proposal({ intent: 'review', domains: ['engineering'], action_kind: 'read' }), 'engineering.v1', 'organization-incentive'],
        ['organization', '組織の権限構造とインセンティブを評価して', proposal({ intent: 'review', domains: ['organization'], action_kind: 'read' }), 'organization.v1', 'hypothesis'],
        ['operations', '運用runbookをレビューして', proposal({ intent: 'review', domains: ['operations'], action_kind: 'read' }), 'operations.v1', 'organization-incentive']
    ])('%s domainは対応する最小DAGだけを選ぶ', (_domain, request, classificationProposal, expectedDag, excludedNode) => {
        const overrides = expectedDag === 'knowledge.v1'
            ? { knowledge_context: { audience: 'team', content_type: 'canonical_fact' } }
            : {};
        const receipt = service.resolve(input(request, classificationProposal, overrides), { access: ACCESS, hostBinding: binding() });
        expect(receipt.status).toBe('resolved');
        expect(receipt.selected_dag_ids).toContain(expectedDag);
        expect(receipt.active_nodes).not.toContain(excludedNode);
    });

    it.each([
        ['cumulative_effect', 'API設計の複数Storyにまたがる累積を確認して', 'cumulative-complexity.v1', 'controller-scope'],
        ['complexity_growth', 'API設計の正味複雑性を確認して', 'cumulative-complexity.v1', 'subtract-first'],
        ['threshold_proposal', 'API設計の閾値を確認して', 'threshold.v1', 'threshold-source'],
        ['parallel_exploration', 'API設計の並列な候補生成を確認して', 'parallel.v1', 'separate-generation-adoption'],
        ['authority_boundary', 'API設計の権限境界を確認して', 'authority.v1', 'enforcement-point'],
        ['problem_frame_uncertain', 'API設計の問題設定を確認して', 'problem-frame.v1', 'rederive'],
        ['external_outcome', 'API設計の外部成果を確認して', 'external-outcome.v1', 'downstream-outcome']
    ])('%s signalは対応するconstraint DAGを合成する', (signal, request, expectedDag, expectedNode) => {
        const receipt = service.resolve(input(request, proposal({
            intent: 'review', domains: ['engineering'], action_kind: 'read', signals: [signal]
        })), { access: ACCESS, hostBinding: binding() });
        expect(receipt.status).toBe('resolved');
        expect(receipt.selected_dag_ids).toContain(expectedDag);
        expect(receipt.active_nodes).toContain(expectedNode);
    });

    // Trace: story-brainbase-judgment-resolver-v1:ac:9
    it('専門依頼をgeneral提案してもserver検出を迂回できない', () => {
        const receipt = service.resolve(input('認証APIを実装して', proposal({
            intent: 'implement', action_kind: 'none', risk: 'low'
        })), { access: ACCESS, hostBinding: binding() });

        expect(receipt.status).toBe('needs_classification');
        expect(receipt.reconciliation_reasons).toEqual(expect.arrayContaining([
            'server_detected_domain_missing', 'action_below_server_floor'
        ]));
        expect(receipt.selected_dag_ids).toEqual(['clarification.v1']);
        expect(receipt.active_nodes).toEqual(['entry', 'reconcile', 'clarification', 'receipt']);
        expect(receipt.active_nodes).not.toContain('authority-check');
    });

    it('server matcherに裏づけられないdomainとsignalをfail closedにする', () => {
        const receipt = service.resolve(input('もっと良くして', proposal({
            intent: 'review',
            domains: ['engineering'],
            action_kind: 'read',
            signals: ['threshold_proposal']
        })), { access: ACCESS, hostBinding: binding() });
        expect(receipt.status).toBe('needs_classification');
        expect(receipt.reconciliation_reasons).toEqual(expect.arrayContaining([
            'domain_supported_only_by_proposal', 'signal_supported_only_by_proposal'
        ]));
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
                intent: 'lookup', audience: 'team', content_type: 'canonical_fact', project_code: 'brainbase'
            },
            receipt_required: true
        }]);
    });

    it('knowledge context不足はclarificationへ落とす', () => {
        const receipt = service.resolve(input('判断履歴を調べて', proposal({
            intent: 'investigate', domains: ['knowledge'], action_kind: 'read'
        })), { access: ACCESS, hostBinding: binding() });
        expect(receipt.status).toBe('needs_classification');
        expect(receipt.reconciliation_reasons).toContain('knowledge_context_missing');
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

    it('domainとsignalの入力順にplan digestが依存しない', () => {
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
        expect(firstReceipt.request_digest).not.toBe(secondReceipt.request_digest);
        expect(firstReceipt.plan_digest).toBe(secondReceipt.plan_digest);
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
        ['matcher reference', (manifest) => { manifest.semantic_matchers.signals.unsupported = ['x']; }, /unsupported selector or matcher/]
    ])('%sの破損manifestを起動時に拒否する', (_label, mutate, expected) => {
        expect(() => serviceWithManifest(mutate)).toThrowError(expected);
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
