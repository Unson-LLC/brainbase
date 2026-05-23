// @ts-check
import { describe, expect, it } from 'vitest';

import {
    companionTranscriptPath,
    parseArgs
} from '../../../scripts/oyasumi-meeting-personal-kg.js';
import {
    matchProjectEntity
} from '../../../scripts/link-oyasumi-personal-kg-projects.js';

describe('oyasumi meeting personal KG script', () => {
    it('INV-5 maps minutes path to companion transcript path', () => {
        expect(companionTranscriptPath('meetings/minutes/2026-05-15_business-ai-future-dinner-meeting.md'))
            .toBe('meetings/transcripts/2026-05-15_business-ai-future-dinner-meeting.txt');
        expect(companionTranscriptPath('docs/notes/example.md')).toBeNull();
    });

    it('keeps dry-run as default for review before production write', () => {
        const args = parseArgs(['--date', '2026-05-15']);

        expect(args.date).toBe('2026-05-15');
        expect(args.write).toBe(false);
    });

    it('enables semantic extraction only when explicitly requested', () => {
        const args = parseArgs(['--date', '2026-05-15', '--semantic']);

        expect(args.semantic).toBe(true);
        expect(args.write).toBe(false);
    });

    it('links personal KG projects by default after production write', () => {
        const args = parseArgs(['--date', '2026-05-15', '--write']);

        expect(args.write).toBe(true);
        expect(args.projectLink).toBe(true);
    });

    it('allows project linking to be skipped for isolated reruns', () => {
        const args = parseArgs(['--date', '2026-05-15', '--write', '--no-project-link']);

        expect(args.projectLink).toBe(false);
    });

    it('maps board and yakumokai meeting folders to the Unson graph project', () => {
        const projectIndex = new Map([
            ['unson', { id: 'prj_unson', payload: { code: 'unson', name: 'Unson' } }]
        ]);

        expect(matchProjectEntity(projectIndex, 'unson-board').entity.id).toBe('prj_unson');
        expect(matchProjectEntity(projectIndex, 'yakumokai').entity.id).toBe('prj_unson');
    });
});
