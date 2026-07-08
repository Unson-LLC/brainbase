// 判断委任KPI（フェーズ1）週次サマリーをSlackに送信する
// Usage: node scripts/send-decision-kpi-to-slack.js [--dry-run] [--channel=#general] [--days=7]
//
// データ取得方式について:
// このスクリプトが読む判断イベントは server/services/companion/decision-event-service.js が
// ローカルサーバーのvarDir配下（companion-decision-events/<yyyy-mm>.json）へ書き込む。
// weekly-story-progress.js が使う NocoDB のような外部公開APIではなく、companion API
// （POST/GET /api/companion/decision-events）はサーバー自身の内部認証（x-internal-api-key /
// bearer / service-token）でのみ到達可能な設計になっている。GitHub Actions（ubuntu-latest等の
// ホスト型runner）からこのローカルサーバーへ到達できる保証がないため、本スクリプトは
// ローカルサーバーと同一ホスト上で launchd/cron から実行される前提で組む
// （.github/workflows/weekly-decision-kpi.yml は作成しない）。
// 稼働ホストが変わった場合は BRAINBASE_COMPANION_API_URL で向き先を上書きできる。

const API_BASE_URL = process.env.BRAINBASE_COMPANION_API_URL || 'http://localhost:31013';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!INTERNAL_API_SECRET) {
    console.error('Error: INTERNAL_API_SECRET is required');
    process.exit(1);
}

if (!SLACK_BOT_TOKEN) {
    console.error('Error: SLACK_BOT_TOKEN is required');
    process.exit(1);
}

async function fetchDecisionEvents({ from, to }) {
    const url = new URL('/api/companion/decision-events', API_BASE_URL);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    const response = await fetch(url, {
        headers: { 'x-internal-api-key': INTERNAL_API_SECRET }
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch decision events: ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data.events) ? data.events : [];
}

function countByType(events) {
    const counts = {};
    for (const event of events) {
        const type = event.event_type || 'unknown';
        counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
}

function formatPercent(numerator, denominator) {
    if (!denominator) return null;
    return Math.round((numerator / denominator) * 1000) / 10;
}

function calculateKpi(events) {
    const counts = countByType(events);
    const draftAccepted = counts.draft_accepted || 0;
    const draftEdited = counts.draft_edited || 0;
    const selfHandled = counts.self_handled || 0;
    const escalated = counts.escalated || 0;
    const ruleCreated = counts.rule_created || 0;

    const delegationDenominator = draftAccepted + draftEdited + selfHandled;
    const delegationNumerator = draftAccepted + draftEdited;
    const delegationRate = formatPercent(delegationNumerator, delegationDenominator);

    const reworkDenominator = draftAccepted + draftEdited;
    const reworkRate = formatPercent(draftEdited, reworkDenominator);

    return {
        totalEvents: events.length,
        counts,
        delegationRate,
        delegationDenominator,
        reworkRate,
        reworkDenominator,
        escalatedCount: escalated,
        ruleCreatedCount: ruleCreated
    };
}

function formatRate(rate, denominator) {
    if (denominator === 0 || rate === null) return '計測不能（対象イベントなし）';
    return `${rate}%`;
}

function buildSlackBlocks(kpi, { from, to }) {
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    if (kpi.totalEvents === 0) {
        return [
            {
                type: 'header',
                text: { type: 'plain_text', text: '📥 判断委任KPI 週次サマリー', emoji: true }
            },
            {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: `集計日時: ${now} / 対象期間: ${from} 〜 ${to}` }]
            },
            {
                type: 'section',
                text: { type: 'mrkdwn', text: '⚠️ *イベント未受信*\nこの期間、判断イベントを1件も受信していません。' }
            }
        ];
    }

    return [
        {
            type: 'header',
            text: { type: 'plain_text', text: '📥 判断委任KPI 週次サマリー', emoji: true }
        },
        {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `集計日時: ${now} / 対象期間: ${from} 〜 ${to}` }]
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: [
                    `*委任率*: ${formatRate(kpi.delegationRate, kpi.delegationDenominator)}`,
                    `　draft_accepted(${kpi.counts.draft_accepted || 0}) + draft_edited(${kpi.counts.draft_edited || 0}) / 完結分母(${kpi.delegationDenominator})`,
                    `*差戻し率*: ${formatRate(kpi.reworkRate, kpi.reworkDenominator)}`,
                    `　draft_edited(${kpi.counts.draft_edited || 0}) / 採用分母(${kpi.reworkDenominator})`,
                    `*エスカレーション件数*: ${kpi.escalatedCount}件`,
                    `*境界拡張数（rule_created）*: ${kpi.ruleCreatedCount}件`,
                    `*受信イベント総数*: ${kpi.totalEvents}件`
                ].join('\n')
            }
        }
    ];
}

async function sendToSlack(blocks, channel) {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
        },
        body: JSON.stringify({
            channel,
            blocks,
            text: '判断委任KPI 週次サマリー'
        })
    });

    if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.ok) {
        throw new Error(`Slack error: ${data.error}`);
    }

    return data;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const channelArg = args.find((a) => a.startsWith('--channel='));
    const channel = channelArg ? channelArg.split('=')[1] : '#brainbase';
    const daysArg = args.find((a) => a.startsWith('--days='));
    const days = daysArg ? Number.parseInt(daysArg.split('=')[1], 10) : 7;

    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    console.log('=== 判断委任KPI 週次サマリーSlack送信 ===\n');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}`);
    console.log(`Channel: ${channel}`);
    console.log(`対象期間: ${from.toISOString()} 〜 ${to.toISOString()}\n`);

    const events = await fetchDecisionEvents({ from: from.toISOString(), to: to.toISOString() });
    console.log(`✓ ${events.length}件のイベントを取得\n`);

    const kpi = calculateKpi(events);
    const blocks = buildSlackBlocks(kpi, { from: from.toISOString(), to: to.toISOString() });

    if (dryRun) {
        console.log('=== Slack Block Kit（DRY RUN） ===\n');
        console.log(JSON.stringify(blocks, null, 2));
        console.log('\n=== DRY RUN完了 ===');
        return;
    }

    console.log('Slackに送信中...');
    const result = await sendToSlack(blocks, channel);
    console.log(`✓ 送信完了: ${result.channel} / ${result.ts}`);
}

const isDirectRun = (() => {
    try {
        return import.meta.url === `file://${process.argv[1]}`;
    } catch {
        return false;
    }
})();

if (isDirectRun) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

export {
    calculateKpi,
    countByType,
    formatPercent,
    formatRate,
    buildSlackBlocks
};
