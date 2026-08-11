import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readCommand(name) {
    return fs.readFileSync(path.join(repoRoot, `.claude/commands/${name}.md`), 'utf8');
}

describe('Brainbase daily routine command contracts', () => {
    it('three routines preserve uncertainty and separate execution from coverage', () => {
        for (const name of ['oyasumi', 'ohayo', 'retro']) {
            const command = readCommand(name);

            for (const status of ['`成功`', '`部分成功`', '`未確認`', '`失敗`']) {
                expect(command, `${name} must define ${status}`).toContain(status);
            }

            expect(command).toContain('timeout');
            expect(command).toMatch(/0件|0件へ|0件と/);
            expect(command).not.toContain('http://localhost:31013/api/wiki/page');
            expect(command).not.toContain('scripts/archive-blocked-report.mjs');
            expect(command).not.toMatch(/scripts\/bin\/bb-report-submit\.mjs/);
            expect(command).not.toMatch(/npm run (sns:|oyasumi:)/);
            expect(command).not.toMatch(/node cli\/index\.js learn/);
            expect(command).not.toMatch(/gog (calendar|gmail|auth)/);
            expect(command).toContain('実行状態');
            expect(command).toContain('確認範囲');
            expect(command).toContain('確認済み');
            expect(command).toContain('部分的');
        }
    });

    it('oyasumi closes the day with only outcomes, carryover, and reflection candidates', () => {
        const command = readCommand('oyasumi');

        expect(command).toContain('今日を閉じ、未解決だけを翌日に渡す');
        expect(command).toContain('## 今日閉じたこと');
        expect(command).toContain('## 明日へ持ち越すこと');
        expect(command).toContain('## 振り返り候補');
        expect(command).toContain('`昇格レビュー待ち`');
        expect(command).toContain('Graphの確認と昇格判断は`/retro`へ任せ');
    });

    it('ohayo shows only decisions, anomalies, and carryover', () => {
        const command = readCommand('ohayo');

        expect(command).toContain('今日、人間が決めることを明らかにする');
        expect(command).toContain('## 要判断');
        expect(command).toContain('## 異常');
        expect(command).toContain('## 持ち越し');
        expect(command).toContain('情報だけの項目は表示しない');
        expect(command).toContain('実行予定・猶予時間');
        expect(command).toContain('無効化・廃止済み');
    });

    it('retro converts repeated problems into at most three system changes', () => {
        const command = readCommand('retro');

        expect(command).toContain('繰り返す問題を、来週の仕組み変更へ変える');
        expect(command).toContain('## 繰り返した問題');
        expect(command).toContain('## 学びの判断');
        expect(command).toContain('## 来週変える仕組み');
        expect(command).toContain('最大3件');
        expect(command).toContain('`変更なし`を正常な結果');
        expect(command).toContain('Graph昇格の判断はこのルーティンだけが担う');
        expect(command).not.toContain('Codex Automationのタスク本文');
        expect(command).not.toContain('automation memoryへ');
    });
});
