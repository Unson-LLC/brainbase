#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { resolveSnsRoot } from './workspace-paths.js';
import { throwRetiredSnsCli } from './lib/retired-sns-cli.js';

const ROOT = process.cwd();
const X_SEARCH_DIR = path.join(ROOT, '.claude/skills/x-research-skill');
const SNS_ROOT = resolveSnsRoot();
const DEFAULT_OUT_DIR = path.join(SNS_ROOT, 'x/ops/daily-briefs');
const COST_PER_TWEET_READ_USD = 0.005;
const FIRST_PERSON_EXPERIENCE_PATTERN = /俺|私|自分|うち|今日|昨日|今朝|今夜|やってみ|作った|決めた|迷っ|失敗|止まった|感じた|思い出した|残しておく|まだ答え/u;
const ADVICE_PATTERN = /すべき|した方がいい|しよう|してください|正解は|最初に見るべき|間違えてる|できてない|みんなはどう|詳しくは|DM(?:ください)?|プロフィール(?:へ|から)|問い合わせ/u;

const SEARCH_SPECS = {
    jpPeer: {
        kind: 'reflection_prompt',
        query: '(Claude Code OR Codex OR AIエージェント OR AI PM OR AI駆動経営) (会社 OR 業務 OR 現場 OR PM OR 経営 OR 運用 OR 導入) lang:ja -is:reply -is:retweet'
    },
    enNews: {
        kind: 'reflection_prompt',
        query: '("Claude Code" OR Codex OR "AI agents") (workflow OR company OR product OR PM OR "long running" OR management) lang:en -is:reply -is:retweet'
    }
};

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

function parseArgs(argv) {
    const args = {
        date: todayJst(),
        since: '1d',
        maxResults: 10,
        limit: 5,
        jpJson: null,
        enJson: null,
        generationContext: null,
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
        if (arg === '--generation-context') args.generationContext = argv[++i];
        if (arg === '--out') args.out = argv[++i];
        if (arg === '--signals-out') args.signalsOut = argv[++i];
        if (arg === '--dry-run') args.dryRun = true;
    }
    return args;
}

function readJsonArray(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error(`${filePath} must contain a JSON array`);
    return parsed;
}

function readGenerationContext(filePath) {
    if (!filePath) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
    if (result.status !== 0) throw new Error(`x-search failed: ${result.stderr || result.stdout}`);
    const tweets = JSON.parse(result.stdout || '[]');
    const readMatch = String(result.stderr || '').match(/(\d+)\s+tweets read/u);
    return {
        tweets,
        reads: readMatch ? Number(readMatch[1]) : tweets.length
    };
}

function metricsOf(tweet) {
    return tweet.metrics || {};
}

function engagementScore(tweet) {
    const metrics = metricsOf(tweet);
    return Number(metrics.likes || 0) * 3
        + Number(metrics.retweets || 0) * 4
        + Number(metrics.quotes || 0) * 3
        + Number(metrics.replies || 0) * 2
        + Number(metrics.bookmarks || 0) * 2;
}

export function classifyAuthorBand(tweet) {
    const followers = Number(tweet?.author_followers);
    if (!Number.isFinite(followers)) return 'unknown';
    if (followers >= 2000 && followers <= 20000) return 'primary';
    if (followers > 20000 && followers <= 50000) return 'secondary';
    return 'out_of_band';
}

function topicFor(text) {
    for (const topic of ['Claude Code', 'Codex', 'AI PM', 'AI駆動経営', 'AIエージェント']) {
        if (String(text || '').toLowerCase().includes(topic.toLowerCase())) return topic;
    }
    return '今日見かけた話';
}

function toReflectionPrompt(tweet, sourceKind) {
    return {
        id: tweet.id,
        kind: 'reflection_prompt',
        source_kind: sourceKind,
        author_handle: tweet.username ? `@${tweet.username}` : null,
        author_followers: Number.isFinite(Number(tweet.author_followers)) ? Number(tweet.author_followers) : null,
        target_band: classifyAuthorBand(tweet),
        topic: topicFor(tweet.text),
        text: tweet.text || '',
        url: tweet.tweet_url || tweet.url || null,
        prompt: 'これを見て、自分の経験として思い出すことがあるか。なければ投稿にしない',
        may_become_post_without_first_person_source: false
    };
}

function selectPrompts(tweets, sourceKind, limit = 3) {
    return [...tweets]
        .sort((a, b) => engagementScore(b) - engagementScore(a))
        .slice(0, limit)
        .map((tweet) => toReflectionPrompt(tweet, sourceKind));
}

function normalizeBody(body) {
    const text = String(body || '')
        .replace(/[ \t]+/gu, ' ')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
    if (text.length <= 280) return text;
    return `${text.slice(0, 279).trim()}…`;
}

function fingerprint(body) {
    return String(body || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/https?:\/\/\S+/gu, '')
        .replace(/[「」『』（）()[\]{}【】、。，．・:：;；!?！？"“”'‘’`]/gu, '')
        .replace(/\s+/gu, '')
        .trim();
}

function laneFor(category) {
    if (category === 'work_log' || category === 'proof') return 'work_log';
    if (category === 'life_log') return 'life_log';
    if (category === 'memory') return 'memory';
    if (category === 'unresolved') return 'unresolved';
    return 'today_log';
}

function qualityGate(body, blockedFingerprints = []) {
    const reasons = [];
    if (!FIRST_PERSON_EXPERIENCE_PATTERN.test(body)) reasons.push('missing_first_person_experience');
    if (ADVICE_PATTERN.test(body)) reasons.push('advice_or_instruction');
    if (body.length > 280) reasons.push('too_long');
    if (blockedFingerprints.includes(fingerprint(body))) reasons.push('duplicate_recent_body');
    return {
        decision: reasons.length === 0 ? 'pass' : 'hold',
        check_type: 'lifelog_integrity',
        reasons,
        checks: {
            first_person_experience: !reasons.includes('missing_first_person_experience'),
            no_advice_or_instruction: !reasons.includes('advice_or_instruction'),
            under_280_chars: !reasons.includes('too_long'),
            not_recent_duplicate: !reasons.includes('duplicate_recent_body')
        }
    };
}

function buildReviewPack(date, generationContext) {
    const entries = generationContext?.personal_kg?.lifelog_entries || [];
    const blockedFingerprints = generationContext?.generation_policy?.recent_history?.blocked_body_fingerprints || [];
    const posts = [];
    const holds = [];

    for (const [index, entry] of entries.entries()) {
        const body = normalizeBody(entry.body);
        const gate = qualityGate(body, blockedFingerprints);
        if (gate.decision !== 'pass') {
            holds.push({
                source_id: entry.id,
                decision: 'lifelog integrity hold',
                reasons: gate.reasons
            });
            continue;
        }
        posts.push({
            slot: `lifelog_${index + 1}`,
            label: `公開ライフログ候補 ${index + 1}`,
            lane: laneFor(entry.category),
            format: 'first_person_lifelog',
            body,
            source_url: null,
            quality_gate: gate,
            lifelog_check: {
                decision: 'pass',
                source_id: entry.id,
                source_system: entry.source_system || 'candidate_store',
                source_category: entry.category || null,
                occurred_at: entry.occurred_at || null,
                first_person_evidence: true,
                evidence_ids: entry.evidence_ids || []
            },
            graph_check: {
                scope: 'personal_experience',
                decision: 'source_attached',
                source_of_truth: 'Personal KG owner-visible lifelog entry'
            },
            generation_context_evidence: {
                policy_ref: 'generation_policy',
                source_ref: `personal_kg.lifelog_entries:${entry.id}`
            }
        });
    }

    if (entries.length === 0) {
        holds.push({
            decision: 'no post',
            reasons: ['no_first_person_lifelog_source']
        });
    }
    return {
        date,
        mode: 'public_lifelog',
        publish_intent: 'manual_review_only',
        posts,
        holds
    };
}

function generationContextSummary(generationContext) {
    if (!generationContext) return null;
    return {
        date: generationContext.date || null,
        personal_kg: {
            retrieval_purpose: generationContext.personal_kg?.retrieval_purpose || null,
            lifelog_entry_count: generationContext.personal_kg?.lifelog_entries?.length || 0
        },
        generation_policy: generationContext.generation_policy || {},
        evidence: generationContext.evidence || []
    };
}

function renderPost(post) {
    return [
        `### ${post.label}`,
        '',
        `Lane: ${post.lane}`,
        `Lifelog Integrity: ${post.quality_gate.decision}`,
        `Source: ${post.lifelog_check.source_id}`,
        '',
        '```text',
        post.body,
        '```'
    ].join('\n');
}

function renderPrompt(prompt, index) {
    return [
        `### ${index + 1}. ${prompt.topic} / ${prompt.author_handle || 'unknown'}`,
        '',
        `Source: ${prompt.url || '-'}`,
        `Prompt: ${prompt.prompt}`
    ].join('\n');
}

function renderMarkdown({ date, totalReads, cost, reviewPack, reflectionPrompts, generationContext }) {
    const holds = reviewPack.holds.length > 0
        ? reviewPack.holds.map((hold) => `- ${hold.decision}: ${hold.reasons.join(', ')}`)
        : ['- なし'];
    return [
        `# SNS Ohayo Brief ${date}`,
        '',
        '目的: 本人の一次体験から、未来の自分へ残す公開ライフログ候補だけを確認する。',
        '',
        '## Budget',
        '',
        `- Tweets read: ${totalReads}`,
        `- Estimated X API cost: $${cost.toFixed(2)}`,
        '- Posting: manual review only',
        '',
        '## 今日の公開ライフログ候補',
        '',
        reviewPack.posts.length > 0
            ? reviewPack.posts.map(renderPost).join('\n\n')
            : '候補なし（本人の一次体験ソースなし、または完全性チェックで保留）。',
        '',
        'Hold:',
        ...holds,
        '',
        '## 外部情報からの内省プロンプト（投稿案ではない）',
        '',
        reflectionPrompts.length > 0
            ? reflectionPrompts.map(renderPrompt).join('\n\n')
            : 'プロンプトなし。',
        '',
        '## Generation Context',
        '',
        `- Mode: ${generationContext?.generation_policy?.mode || 'public_lifelog'}`,
        `- First-person sources: ${generationContext?.personal_kg?.lifelog_entries?.length || 0}`,
        '- Rule: 外部情報だけから投稿を作らない',
        '- Rule: 助言・説得・CTAへ変換しない',
        ''
    ].join('\n');
}

export function buildBrief({
    date,
    jpTweets,
    enTweets,
    jpReads,
    enReads,
    weeklyPlan: _weeklyPlan = '',
    generationContext = null
}) {
    const peerSignals = selectPrompts(jpTweets, 'jp_peer');
    const newsSignals = selectPrompts(enTweets, 'en_news');
    const reflectionPrompts = [...peerSignals, ...newsSignals];
    const totalReads = Number(jpReads ?? jpTweets.length) + Number(enReads ?? enTweets.length);
    const cost = totalReads * COST_PER_TWEET_READ_USD;
    const reviewPack = buildReviewPack(date, generationContext);
    const signals = {
        peerSignals,
        newsSignals,
        reflectionPrompts,
        generationContext: generationContextSummary(generationContext),
        reviewPack
    };
    return {
        markdown: renderMarkdown({
            date,
            totalReads,
            cost,
            reviewPack,
            reflectionPrompts,
            generationContext
        }),
        signals,
        summary: {
            date,
            total_reads: totalReads,
            estimated_cost_usd: Number(cost.toFixed(3)),
            generation_context_used: Boolean(generationContext),
            reflection_prompts: reflectionPrompts.length,
            review_pack_posts: reviewPack.posts.length,
            blocked_lifelog_integrity: reviewPack.holds.filter((hold) => hold.decision === 'lifelog integrity hold').length,
            no_first_person_source: reviewPack.holds.some((hold) => hold.reasons.includes('no_first_person_lifelog_source'))
        }
    };
}

async function main() {
    throwRetiredSnsCli('generate-sns-ohayo-brief.js');
    const args = parseArgs(process.argv.slice(2));
    const out = args.out || path.join(DEFAULT_OUT_DIR, `${args.date}.md`);
    const signalsOut = args.signalsOut || path.join(DEFAULT_OUT_DIR, `${args.date}-signals.json`);
    const jp = args.jpJson
        ? { tweets: readJsonArray(args.jpJson), reads: undefined }
        : (args.dryRun ? { tweets: [], reads: 0 } : runXSearch(SEARCH_SPECS.jpPeer.query, args));
    const en = args.enJson
        ? { tweets: readJsonArray(args.enJson), reads: undefined }
        : (args.dryRun ? { tweets: [], reads: 0 } : runXSearch(SEARCH_SPECS.enNews.query, args));
    const generationContext = readGenerationContext(args.generationContext);
    const brief = buildBrief({
        date: args.date,
        jpTweets: jp.tweets,
        enTweets: en.tweets,
        jpReads: jp.reads,
        enReads: en.reads,
        generationContext
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
