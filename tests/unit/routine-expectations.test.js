import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseRoutineExpectations } from '../../server/services/routine-runtime/expectation-parser.js';

const manifestPath = path.resolve('server/config/routine-expectations.json');

describe('Brainbase routine expectations manifest', () => {
    it('3ルーティンの固定project、schedule、猶予、必須成果物を定義する', () => {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        expect(manifest).toHaveLength(3);
        expect(manifest).toEqual(expect.arrayContaining([
            expect.objectContaining({
                routine: 'oyasumi',
                automation_id: 'brainbase-oyasumi',
                source_type: 'codex_automations',
                project_id: 'brainbase',
                timezone: 'Asia/Tokyo',
                schedule: { kind: 'daily', hour: 3, minute: 0 },
                grace_minutes: 20,
                required_artifacts: ['routine_summary']
            }),
            expect.objectContaining({
                routine: 'ohayo',
                automation_id: 'brainbase-ohayo',
                source_type: 'codex_automations',
                project_id: 'brainbase',
                timezone: 'Asia/Tokyo',
                schedule: { kind: 'daily', hour: 6, minute: 0 },
                grace_minutes: 20,
                required_artifacts: ['routine_summary']
            }),
            expect.objectContaining({
                routine: 'retro',
                automation_id: 'brainbase-retro',
                source_type: 'codex_automations',
                project_id: 'brainbase',
                timezone: 'Asia/Tokyo',
                schedule: { kind: 'weekly', day_of_week: 6, hour: 0, minute: 0 },
                grace_minutes: 60,
                required_artifacts: ['routine_summary']
            })
        ]));
    });

    it.each([
        ['routine', (manifest) => { manifest[1].routine = manifest[0].routine; }],
        ['automation_id', (manifest) => { manifest[1].automation_id = manifest[0].automation_id; }]
    ])('重複した%sを拒否し、重複したindexとfieldを示す', (field, mutate) => {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        mutate(manifest);

        expect(() => parseRoutineExpectations(manifest)).toThrow(`expectations[1].${field}`);
    });

    it.each([
        ['timezone', (manifest) => { manifest[0].timezone = 'Invalid/Timezone'; }],
        ['schedule.hour', (manifest) => { manifest[0].schedule.hour = 24; }],
        ['grace_minutes', (manifest) => { manifest[0].grace_minutes = 0; }],
        ['required_artifacts', (manifest) => { manifest[0].required_artifacts = []; }]
    ])('不正な%sを拒否し、indexとfieldを示す', (field, mutate) => {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        mutate(manifest);

        expect(() => parseRoutineExpectations(manifest)).toThrow(`expectations[0].${field}`);
    });
});
