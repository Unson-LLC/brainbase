#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { evaluatePersonaAffect } from '../server/services/sns/personal-kg-sns-weekly-planner.js';

const ROOT = process.cwd();
const X_SEARCH_DIR = path.join(ROOT, '.claude/skills/x-research-skill');
const SHARED_SNS_ROOT = '/Users/ksato/workspace/shared/_codex/sns';
const DEFAULT_OUT_DIR = path.join(SHARED_SNS_ROOT, 'x/ops/daily-briefs');
const COST_PER_TWEET_READ_USD = 0.005;

const SEARCH_SPECS = {
    jpPeer: {
        kind: 'peer_post',
        query: '(Claude Code OR Codex OR AIエージェント OR AI PM OR AI駆動経営) (会社 OR 業務 OR 現場 OR PM OR 経営 OR 運用 OR 導入) lang:ja -is:reply -is:retweet'
    },
    enNews: {
        kind: 'news',
        query: '("Claude Code" OR Codex OR "AI agents") (workflow OR company OR product OR PM OR "long running" OR management) lang:en -is:reply -is:retweet'
    }
};

function parseArgs(argv) {
    const args = {
        date: todayJst(),
        since: '1d',
        maxResults: 10,
        limit: 5,
        jpJson: null,
        enJson: null,
        out: null,
        signalsOut: null,
        dryRun: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--date') args.date = argv[++i];
        if (arg === '--since') args.since = argv[++i];
        if (arg === '--max-results') args.maxResults = Number(argv[++i]);
        if (arg === '--limit') args.limit = Number(argv[++i]);
        if (arg === '--jp-json') args.jpJson = argv[++i];
        if (arg === '--en-json') args.enJson = argv[++i];
        if (arg === '--out') args.out = argv[++i];
        if (arg === '--signals-out') args.signalsOut = argv[++i];
        if (arg === '--dry-run') args.dryRun = true;
    }
    return args;
}

function todayJst() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

function readJsonArray(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error(`${filePath} must contain a JSON array`);
    return parsed;
}

function runXSearch(query, { since, maxResults, limit }) {
    const result = spawnSync('bun', [
        'run',
        'x-search.ts',
        'search',
        query,
        '--sort',
        'likes',
        '--since',
        since,
        '--max-results',
        String(maxResults),
        '--limit',
        String(limit),
        '--json'
    ], {
        cwd: X_SEARCH_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status !== 0) {
        throw new Error(`x-search failed: ${result.stderr || result.stdout}`);
    }
    const tweets = JSON.parse(result.stdout || '[]');
    const readMatch = String(result.stderr || '').match(/(\d+)\s+tweets read/u);
    return {
        tweets,
        reads: readMatch ? Number(readMatch[1]) : tweets.length,
        stderr: result.stderr
    };
}

function loadWeeklyPlan(date) {
    const opsDir = path.join(SHARED_SNS_ROOT, 'x/ops');
    if (!fs.existsSync(opsDir)) return '';
    const files = fs.readdirSync(opsDir)
        .filter((file) => /^weekly_content_calendar_\d{4}-\d{2}-\d{2}\.md$/u.test(file))
        .sort()
        .reverse();
    for (const file of files) {
        const content = fs.readFileSync(path.join(opsDir, file), 'utf8');
        const escapedDate = date.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
        const dayMatch = content.match(new RegExp(`## [^\\n]*${escapedDate}[\\s\\S]*?(?=\\n## |\\n# |$)`, 'u'));
        if (dayMatch) return dayMatch[0].trim();
    }
    return '';
}

function metricsOf(tweet) {
    return tweet.metrics || {};
}

function engagementScore(tweet) {
    const m = metricsOf(tweet);
    return (m.likes || 0) * 3 + (m.retweets || 0) * 4 + (m.quotes || 0) * 3 + (m.replies || 0) * 2 + (m.bookmarks || 0) * 2 + Math.floor((m.impressions || 0) / 1000);
}

function followerCount(tweet) {
    return Number(tweet.author_followers ?? tweet.author?.followers_count ?? tweet.user?.public_metrics?.followers_count ?? 0);
}

export function classifyAuthorBand(tweet) {
    const followers = followerCount(tweet);
    if (followers >= 2000 && followers <= 20000) return 'primary';
    if (followers > 20000 && followers <= 50000) return 'secondary';
    if (followers > 0) return 'out_of_band';
    return 'unknown';
}

function cleanTweetText(text, max = 120) {
    const cleaned = String(text || '').replace(/https:\/\/t\.co\/\S+/gu, '').replace(/\s+/gu, ' ').trim();
    if (cleaned.length <= max) return cleaned;
    return `${cleaned.slice(0, max - 1).trim()}…`;
}

function topicFromTweet(tweet) {
    const text = String(tweet.text || '');
    if (/Claude Code/u.test(text)) return 'Claude Code';
    if (/Codex/u.test(text)) return 'Codex';
    if (/AI PM|PdM|PM/u.test(text)) return 'AI PM';
    if (/経営|management/u.test(text)) return 'AI駆動経営';
    if (/agent|エージェント/iu.test(text)) return 'AI Agent';
    return 'AI運用';
}

function tweetUrl(tweet) {
    return tweet.tweet_url || `https://x.com/${tweet.username || '?'}/status/${tweet.id}`;
}

function toPeerSignal(tweet) {
    return {
        id: tweet.id,
        kind: 'peer_post',
        author_handle: `@${tweet.username || '?'}`,
        author_followers: followerCount(tweet),
        target_band: classifyAuthorBand(tweet),
        text: cleanTweetText(tweet.text),
        url: tweetUrl(tweet),
        topic: topicFromTweet(tweet)
    };
}

function toNewsSignal(tweet) {
    return {
        id: tweet.id,
        kind: 'news',
        title: cleanTweetText(tweet.text),
        url: tweetUrl(tweet),
        topic: topicFromTweet(tweet),
        author_handle: `@${tweet.username || '?'}`,
        author_followers: followerCount(tweet)
    };
}

function pickTopTweets(tweets, limit = 3) {
    return [...tweets]
        .filter((tweet) => tweet && tweet.id && tweet.text)
        .sort((a, b) => engagementScore(b) - engagementScore(a))
        .slice(0, limit);
}

function pickPeerTweets(tweets, limit = 3) {
    const ranked = pickTopTweets(tweets, tweets.length);
    const primary = ranked.filter((tweet) => classifyAuthorBand(tweet) === 'primary');
    const secondary = ranked.filter((tweet) => classifyAuthorBand(tweet) === 'secondary');
    const pool = primary.length > 0 ? primary : (secondary.length > 0 ? secondary : ranked);
    return pool.slice(0, limit);
}

function draftHintForPeer(signal) {
    return [
        'これめちゃ分かる',
        '',
        `${signal.text} って、会社でAIを使う時は「使う人の努力」じゃなくて、責任・権限・記憶・レビュー境界まで含めて見る話なんよな`,
        '',
        'うちでもここを曖昧にしたまま入れると、便利なのに現場で止まる',
        signal.url
    ].join('\n');
}

function draftHintForNews(signal) {
    return [
        '海外でこの手のAI agent事例が伸びるの、単に新機能が面白いからじゃなくて「業務フローの中でAIがどこまで責任を持つか」に関心が移ってるからだと思う',
        '',
        '日本の会社で見る時も、ツール比較より先に現場の責任境界とレビュー設計を見る方がいい',
        signal.url
    ].join('\n');
}

function personaBrain(topic) {
    return {
        target_person: 'AI導入を任された事業責任者 / PM / 経営者',
        current_situation: `${topic} に関心はあるが、自社の業務フローへどう落とすか迷っている`,
        existing_belief: '良いツールを選べばAI活用が進むと思っている',
        misunderstanding: 'AI活用は個人スキルや投稿生成の問題だと捉えている',
        fear: '現場で事故が起きた時の責任境界が曖昧なまま進むことを怖がっている',
        blocker: '権限、記憶、レビュー境界、学習の戻し先をどう決めるか分からない',
        resonant_detail: '現場、業務、責任境界、レビュー',
        avoid_phrasing: 'AIで全部自動化できます',
        natural_next_action: '保存して、自社ならどの業務に当てるか考える',
        success_signal: 'peer_reply_or_repost'
    };
}

function withAffect(signal, body, lane) {
    const brain = personaBrain(signal.topic || 'AI運用');
    return {
        ...signal,
        draft_hint: body,
        persona_brain: brain,
        persona_affect: evaluatePersonaAffect({ body, lane, personaBrain: brain, signal })
    };
}

export function buildBrief({ date, jpTweets, enTweets, jpReads, enReads, weeklyPlan = '' }) {
    const peerSignals = pickPeerTweets(jpTweets).map(toPeerSignal);
    const newsSignals = pickTopTweets(enTweets, 3).map(toNewsSignal);
    const peerCards = peerSignals.map((signal) => withAffect(signal, draftHintForPeer(signal), 'peer_circle'));
    const newsCards = newsSignals.map((signal) => withAffect(signal, draftHintForNews(signal), 'trust_balance'));
    const totalReads = Number(jpReads ?? jpTweets.length) + Number(enReads ?? enTweets.length);
    const cost = totalReads * COST_PER_TWEET_READ_USD;
    const signals = { peerSignals, newsSignals };
    return {
        markdown: renderMarkdown({ date, weeklyPlan, peerCards, newsCards, totalReads, cost }),
        signals,
        summary: {
            date,
            total_reads: totalReads,
            estimated_cost_usd: Number(cost.toFixed(3)),
            peer_candidates: peerCards.length,
            news_candidates: newsCards.length,
            blocked_persona_affect: [...peerCards, ...newsCards].filter((card) => card.persona_affect.decision !== 'pass').length
        }
    };
}

function renderMetrics(signal) {
    const followers = signal.author_followers ? `${signal.author_followers} followers` : 'followers unknown';
    return `${signal.author_handle || ''} / ${followers} / ${signal.target_band || 'news'}`;
}

function renderCard(card, index) {
    return [
        `### ${index + 1}. ${card.topic} / ${renderMetrics(card)}`,
        '',
        `Source: ${card.url}`,
        `Persona Affect: ${card.persona_affect.decision} - ${card.persona_affect.likely_reader_feeling}`,
        '',
        '本文:',
        '',
        '```text',
        card.draft_hint,
        '```'
    ].join('\n');
}

function renderMarkdown({ date, weeklyPlan, peerCards, newsCards, totalReads, cost }) {
    const lines = [
        `# SNS Ohayo Brief ${date}`,
        '',
        '目的: 週次カレンダーを崩さず、今日のニュース/引用枠だけを低コストで差し替える。',
        '',
        '## Budget',
        '',
        `- Tweets read: ${totalReads}`,
        `- Estimated X API cost: $${cost.toFixed(2)}`,
        '- Posting: manual review only',
        '',
        '## Weekly Plan For Today',
        '',
        weeklyPlan || '週次カレンダーが見つからないため、`/Users/ksato/workspace/shared/_codex/sns/x/ops/weekly_content_calendar_*.md` を確認する。',
        '',
        '## Peer Quote Candidates',
        '',
        peerCards.length > 0 ? peerCards.map(renderCard).join('\n\n') : '候補なし。Peer Circle watchlistを手動確認する。',
        '',
        '## Overseas / News Candidates',
        '',
        newsCards.length > 0 ? newsCards.map(renderCard).join('\n\n') : '候補なし。ニュース枠は保留する。',
        '',
        '## Next Action',
        '',
        '1. Peer候補は本物の引用UIで出すか、通常投稿末尾に元URLを置く',
        '2. 今日のベースライン2本は `npm run sns:weekly-pack -- --start-date <week-start> --signals-file <signals.json>` でKG由来draftと合わせる',
        '3. 投稿後の反応は `/oyasumi` で peer reaction / reader reaction / anomaly / learning に戻す'
    ];
    return `${lines.join('\n')}\n`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const out = args.out || path.join(DEFAULT_OUT_DIR, `${args.date}.md`);
    const signalsOut = args.signalsOut || path.join(DEFAULT_OUT_DIR, `${args.date}-signals.json`);
    const jp = args.jpJson
        ? { tweets: readJsonArray(args.jpJson), reads: undefined }
        : (args.dryRun ? { tweets: [], reads: 0 } : runXSearch(SEARCH_SPECS.jpPeer.query, args));
    const en = args.enJson
        ? { tweets: readJsonArray(args.enJson), reads: undefined }
        : (args.dryRun ? { tweets: [], reads: 0 } : runXSearch(SEARCH_SPECS.enNews.query, args));
    const brief = buildBrief({
        date: args.date,
        jpTweets: jp.tweets,
        enTweets: en.tweets,
        jpReads: jp.reads,
        enReads: en.reads,
        weeklyPlan: loadWeeklyPlan(args.date)
    });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.mkdirSync(path.dirname(signalsOut), { recursive: true });
    fs.writeFileSync(out, brief.markdown);
    fs.writeFileSync(signalsOut, JSON.stringify(brief.signals, null, 2));
    console.log(JSON.stringify({ out, signalsOut, ...brief.summary }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

export { parseArgs, SEARCH_SPECS };
