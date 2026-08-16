import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { negotiateProtocol } from '../../../../server/services/multitenant/protocol-contract.js';

const fixtureRoot = resolve(process.cwd(), 'tests/fixtures/multitenant-contract/v1');

function load(name) {
    return JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8'));
}

describe('Cloud/OSS protocol v1 contract fixtures', () => {
    const positive = load('positive.json');
    it.each(positive.cases)('$id: positive fixture', ({ input, expected }) => {
        const result = negotiateProtocol(input, { now: new Date('2026-08-16T00:00:00.000Z') });
        expect(result).toMatchObject({ protocol_id: expected.protocol_id, selected_version: expected.selected_version });
        if (expected.optional_status) {
            expect(result.optional_capabilities.cloud_billing_export.status).toBe(expected.optional_status);
        }
    });

    const negative = load('negative.json');
    it.each(negative.cases)('$id: negative fixture', ({ input, expected_code }) => {
        expect(() => negotiateProtocol(input)).toThrow(expect.objectContaining({ code: expected_code }));
    });

    const nonApplicable = load('non-applicable.json');
    it.each(nonApplicable.cases)('$id: non-applicable fixture', ({ input, expected }) => {
        const result = negotiateProtocol(input);
        for (const capability of input.optional_capabilities) {
            expect(result.optional_capabilities[capability]).toEqual(expected);
        }
    });

    it.each([positive, negative, nonApplicable])('fixtureは本番readbackと明示的に分離する', (fixture) => {
        expect(fixture.evidence_boundary).toBe('contract_fixture_not_production_readback');
        expect(JSON.stringify(fixture)).not.toMatch(/access_token|refresh_token|private_key|client_secret/i);
    });
});
