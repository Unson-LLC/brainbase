import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Brainbase routine outcome contract', () => {
    const spec = read('docs/specs/brainbase-memory-routine-cycle-spec.md');
    const story = read('docs/stories/brainbase-memory-routine-cycle-story.md');
    const ohayoRunbook = read('docs/runbooks/ohayo-day-view.md');

    it('daily commands remain thin runner entrypoints', () => {
        for (const name of ['oyasumi', 'ohayo']) {
            const command = read(`.claude/commands/${name}.md`);
            expect(command).toContain(`node scripts/routines/run.mjs ${name}`);
            expect(command.split('\n').filter((line) => line.trim())).toHaveLength(3);
        }
    });

    it('retro keeps its evidence collection contract next to the runner entrypoint', () => {
        const command = read('.claude/commands/retro.md');
        expect(command).toContain('node scripts/routines/run.mjs retro');
        expect(command).toContain('判断episode、実行、Outcome、Run Receipt');
        expect(command).toContain('自動承認・自動昇格しない');
        expect(command).toContain('受信側で読み戻す');
    });

    it('status and coverage remain separate and unavailable sources are not empty results', () => {
        expect(spec).toContain('`status`は処理成否');
        expect(spec).toContain('`coverage`は`confirmed|partial|unavailable`');
        expect(story).toContain('取得不能を確認済み0件へ変換しない');
    });

    it('ohayo and oyasumi define hierarchical user outcomes', () => {
        expect(spec).toContain('`today_focus`');
        expect(spec).toContain('`immediate_decisions`');
        expect(spec).toContain('`tomorrow_focus`');
        expect(spec).toContain('`personal_kg_registration_candidates`');
        expect(spec).toContain('`personal_kg_memories`');
        expect(spec).toContain('`personal_kg_review_exceptions`');
        expect(spec).toContain('`graph_promotion_reviews`');
    });

    it('ohayo bounds Gmail detail collection without losing the unread backlog', () => {
        expect(spec).toContain('Gmailの未読総数と直近7日の要対応候補');
        expect(spec).toContain('古い未読と自動分類を含む持ち越し件数として表示');
        expect(ohayoRunbook).toContain('`is:unread newer_than:7d -category:promotions -category:social -category:updates -category:forums`');
        expect(ohayoRunbook).toContain('古い未読本文や販促メールを毎朝全件走査して処理を止めない');
    });

    it('retro separates registration from Graph promotion and never applies scheduled changes', () => {
        expect(spec).toContain('`personal_kg_registration_reviews`');
        expect(spec).toContain('`pending_approval`のGraph昇格候補');
        expect(spec).toContain('定期実行は`applies_changes=false`');
        expect(story).toContain('Graph昇格を自動承認・自動実行しない');
    });
});
