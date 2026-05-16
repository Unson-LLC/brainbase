// @ts-check
import { describe, expect, it } from 'vitest';

import {
    companionTranscriptPath,
    parseArgs
} from '../../../scripts/oyasumi-meeting-personal-kg.js';

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
});
