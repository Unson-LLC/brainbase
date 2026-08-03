import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const markdownPath = path.resolve('docs/specs/ten-minute-world-onboarding-runtime-spec.md');
const jsonPath = path.resolve('docs/specs/ten-minute-world-onboarding-runtime-spec.json');
const vibeproJsonPath = path.resolve(
    '.vibepro/spec/story-ten-minute-world-onboarding-runtime/spec.json'
);

describe('ten-minute onboarding runtime spec parity', () => {
    it('RT-INV-001..017のIDとstatementをMarkdown/JSONで完全一致させる', () => {
        const markdown = fs.readFileSync(markdownPath, 'utf8');
        const machineSpec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const markdownInvariants = [...markdown.matchAll(/^- (RT-INV-\d{3}): (.+)$/gm)]
            .map((match) => ({ id: match[1], statement: match[2] }));
        const jsonInvariants = machineSpec.clauses
            .filter((clause) => clause.type === 'invariant')
            .map(({ id, statement }) => ({ id, statement }));
        const expectedIds = Array.from(
            { length: 17 },
            (_, index) => `RT-INV-${String(index + 1).padStart(3, '0')}`
        );

        expect(markdownInvariants.map(({ id }) => id)).toEqual(expectedIds);
        expect(jsonInvariants.map(({ id }) => id)).toEqual(expectedIds);
        expect(jsonInvariants).toEqual(markdownInvariants);
    });

    it('host entryをruntime実装面に含めずblocking dependencyとして機械可読に保持する', () => {
        const machineSpec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const authority = JSON.parse(fs.readFileSync(
            path.resolve('docs/responsibility-authority/ten-minute-world-onboarding-runtime.json'),
            'utf8'
        ));
        const runtimeAuthority = authority.responsibilities.find(
            ({ id }) => id === 'ten_minute_world_onboarding_runtime'
        );

        expect(machineSpec.delivery_boundary).toMatchObject({
            blocking_dependency: {
                story_id: 'story-ten-minute-world-onboarding',
                acceptance_criteria: ['AC-001', 'AC-002', 'AC-003', 'AC-004', 'AC-005', 'AC-006'],
                status: 'host_entry_blocked'
            }
        });
        expect(machineSpec.diagrams.map(({ source }) => source).join('\n')).toContain(
            'separate blocked delivery slice'
        );
        expect(runtimeAuthority.owned_surfaces.paths).not.toContain(
            '.claude/skills/brainbase-onboarding/SKILL.md'
        );
        expect(runtimeAuthority.external_dependencies).toContainEqual(expect.objectContaining({
            id: 'host_entry_binding',
            owned_surface: '.claude/skills/brainbase-onboarding/SKILL.md',
            status: 'host_entry_blocked'
        }));
    });

    it('VibePro workspace Specが存在する場合はcanonical JSONの完全なprojectionにする', () => {
        if (!fs.existsSync(vibeproJsonPath)) return;

        const canonicalSpec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const vibeproSpec = JSON.parse(fs.readFileSync(vibeproJsonPath, 'utf8'));

        expect(vibeproSpec).toEqual(canonicalSpec);
        expect(vibeproSpec.clauses.map(({ id }) => id)).toContain('RT-INV-016');
        expect(vibeproSpec.clauses.map(({ id }) => id)).toContain('RT-INV-017');
        expect(JSON.stringify(vibeproSpec)).toContain(
            'tests/e2e/story-ten-minute-world-onboarding-runtime-flow.spec.ts'
        );
        expect(JSON.stringify(vibeproSpec)).not.toContain(
            'tests/e2e/story-ten-minute-world-onboarding-runtime.spec.ts'
        );
    });
});
