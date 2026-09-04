import { createHash, createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createVibeproManagedHandoff } from '../../../../server/services/outcome-case/vibepro-managed-handoff.js';

const SIGNING_KEY = 'brainbase-vibepro-handoff-test-key-at-least-32-characters';
const PAYLOAD_FIELDS = [
    'schema_version',
    'repository',
    'repository_root',
    'project_code',
    'base_sha',
    'issued_at',
    'expires_at',
    'turn_id',
    'resolution_id',
    'story_id',
    'authorized',
    'graph_promotion_allowed',
    'outcome_case'
];

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function compareCodePoints(left, right) {
    const a = Array.from(left, (value) => value.codePointAt(0));
    const b = Array.from(right, (value) => value.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
}

function vibeproCanonicalJson(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map((entry) => vibeproCanonicalJson(entry)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort(compareCodePoints).map((key) => `${JSON.stringify(key)}:${vibeproCanonicalJson(value[key])}`).join(',')}}`;
    }
    throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

function v2CanonicalPayload(receipt) {
    return vibeproCanonicalJson([
        'brainbase-vibepro-managed-handoff.v2',
        Object.fromEntries(PAYLOAD_FIELDS.map((field) => [field, receipt[field]]))
    ]);
}

function input(overrides = {}) {
    const decision = {
        turn_id: 'turn-001',
        resolution_id: 'resolution-001',
        project_code: 'brainbase',
        case_id: 'outcome-case-001',
        selected_path: ['implementation'],
        ...overrides.decision
    };
    return {
        outcomeCase: {
            case_id: 'outcome-case-001',
            project_code: 'brainbase',
            user_observable_outcome: '利用者が成果ケースと技術受入を同じ案件として確認できる。',
            ...overrides.outcomeCase
        },
        decision,
        target: {
            repository: 'https://github.com/Unson-LLC/example.git',
            repository_root: './services/../.',
            project_code: 'brainbase',
            base_sha: 'a'.repeat(40),
            story_id: null,
            ...overrides.target
        },
        technicalAcceptance: [{
            id: 'TA-1',
            criterion: 'VibeProが成果ケースを技術受入として投影できる。'
        }],
        productionProbe: {
            id: 'probe-001',
            procedure: '本番の保存済み成果ケースを再読込する。',
            terminal_receipt_target: 'brainbase://production-probes/probe-001/receipt'
        },
        signingKey: SIGNING_KEY,
        keyId: 'brainbase-vibepro-handoff-hmac-v1',
        issuedAt: '2026-09-04T00:00:00.000Z',
        expiresAt: '2026-09-05T00:00:00.000Z',
        ...Object.fromEntries(Object.entries(overrides)
            .filter(([key]) => !['outcomeCase', 'decision', 'target'].includes(key)))
    };
}

describe('createVibeproManagedHandoff', () => {
    it('VibePro v2の正規payloadを署名付きで発行し、OutcomeCaseを7項目だけ投影する', () => {
        const receipt = createVibeproManagedHandoff(input());

        expect(receipt).toMatchObject({
            schema_version: 'brainbase-vibepro-managed-handoff.v2',
            repository: 'github://Unson-LLC/example',
            repository_root: '.',
            project_code: 'brainbase',
            base_sha: 'a'.repeat(40),
            turn_id: 'turn-001',
            resolution_id: 'resolution-001',
            story_id: null,
            authorized: false,
            graph_promotion_allowed: false
        });
        expect(Object.keys(receipt.outcome_case).sort()).toEqual([
            'case_id',
            'decision_digest',
            'judgment_receipt_ref',
            'outcome_case_ref',
            'production_probe',
            'technical_acceptance',
            'user_observable_outcome'
        ]);
        expect(receipt.outcome_case).toMatchObject({
            case_id: 'outcome-case-001',
            outcome_case_ref: 'brainbase://outcome-cases/outcome-case-001',
            judgment_receipt_ref: 'brainbase://judgment-receipts/resolution-001',
            technical_acceptance: [{ id: 'TA-1' }],
            production_probe: { id: 'probe-001' }
        });

        const canonicalPayload = v2CanonicalPayload(receipt);
        expect(receipt.receipt_digest).toBe(sha256(canonicalPayload));
        expect(receipt.signature).toEqual({
            algorithm: 'hmac-sha256',
            key_id: 'brainbase-vibepro-handoff-hmac-v1',
            value: createHmac('sha256', SIGNING_KEY).update(canonicalPayload).digest('hex')
        });
    });

    it('decision snapshotのキー順に依らず同じdecision_digestを発行する', () => {
        const first = createVibeproManagedHandoff(input({
            decision: {
                turn_id: 'turn-001', resolution_id: 'resolution-001', project_code: 'brainbase',
                case_id: 'outcome-case-001', nested: { beta: 2, alpha: 1 }
            }
        }));
        const second = createVibeproManagedHandoff(input({
            decision: {
                nested: { alpha: 1, beta: 2 }, case_id: 'outcome-case-001', project_code: 'brainbase',
                resolution_id: 'resolution-001', turn_id: 'turn-001'
            }
        }));

        expect(second.outcome_case.decision_digest).toBe(first.outcome_case.decision_digest);
    });

    it('VibeProと同じUnicode codepoint順でdecision snapshotをdigestする', () => {
        const decision = {
            turn_id: 'turn-001',
            resolution_id: 'resolution-001',
            project_code: 'brainbase',
            case_id: 'outcome-case-001',
            unicode: { '\u{1F600}': 'non-BMP', '\uE000': 'private-use', 'あ': 'hiragana' }
        };
        const receipt = createVibeproManagedHandoff(input({ decision }));

        expect(receipt.outcome_case.decision_digest).toBe('61077d6352d37ee764d3b895d1ab9ffdd50b1995d404111628e84132486b0b83');
    });

    it('production probeの終端receipt参照を省略時に正規URIへ補完する', () => {
        const receipt = createVibeproManagedHandoff(input({
            productionProbe: {
                id: 'probe-001',
                procedure: '本番の保存済み成果ケースを再読込する。'
            }
        }));

        expect(receipt.outcome_case.production_probe.terminal_receipt_target)
            .toBe('brainbase://production-probes/probe-001/receipt');
    });

    it('canonical JSONにできないdecision snapshotを曖昧に署名しない', () => {
        const sparse = [];
        sparse[1] = 'value';
        const cyclic = { turn_id: 'turn-001', resolution_id: 'resolution-001', project_code: 'brainbase', case_id: 'outcome-case-001' };
        cyclic.self = cyclic;

        for (const decision of [
            { observed_at: new Date('2026-09-04T00:00:00.000Z') },
            { routing: new Map([['a', 'b']]) },
            { paths: sparse },
            cyclic
        ]) {
            expect(() => createVibeproManagedHandoff(input({ decision }))).toThrow(TypeError);
        }
    });

    it.each([
        ['case scope mismatch', input({ decision: { case_id: 'another-case' } })],
        ['project scope mismatch', input({ target: { project_code: 'other-project' } })],
        ['blank observable outcome', input({ outcomeCase: { user_observable_outcome: '  ' } })],
        ['duplicate technical acceptance id', input({ technicalAcceptance: [{ id: 'TA-1', criterion: 'A' }, { id: 'TA-1', criterion: 'B' }] })],
        ['wrong production probe receipt target', input({ productionProbe: { terminal_receipt_target: 'brainbase://production-probes/another/receipt' } })],
        ['short signing key', input({ signingKey: 'too-short' })],
        ['bad base SHA', input({ target: { base_sha: 'A'.repeat(40) } })],
        ['expired before issue', input({ expiresAt: '2026-09-03T00:00:00.000Z' })],
        ['undefined decision value', input({ decision: { ambiguous: undefined } })],
        ['nonfinite decision value', input({ decision: { confidence: Number.NaN } })]
    ])('%sを拒否する', (_name, value) => {
        expect(() => createVibeproManagedHandoff(value)).toThrow();
    });
});
