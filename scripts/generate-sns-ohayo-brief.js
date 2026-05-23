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

function compactText(text, max = 120) {
    const cleaned = String(text || '').replace(/。/gu, '、').replace(/\s+/gu, ' ').trim().replace(/[、,]+$/u, '');
    if (cleaned.length <= max) return cleaned;
    return `${cleaned.slice(0, max - 1).trim()}…`;
}

function publicKgSnippet(text, max = 72) {
    const withoutLabels = String(text || '')
        .replace(/Own Proof:\s*/gu, '')
        .replace(/Reusable Pattern:\s*/gu, '')
        .replace(/\s+Apply When:[\s\S]*$/u, '')
        .replace(/\s+Do Not Apply When:[\s\S]*$/u, '');
    return compactText(withoutLabels, max);
}

function normalizeBodyFingerprint(body) {
    return String(body || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/https?:\/\/\S+/gu, '')
        .replace(/[「」『』（）()[\]{}【】、。，．・:：;；!?！？"“”'‘’`]/gu, '')
        .replace(/\s+/gu, '')
        .trim();
}

function isNearFingerprint(candidate, existing) {
    if (!candidate || !existing) return false;
    if (candidate === existing) return true;
    const minLength = Math.min(candidate.length, existing.length);
    if (minLength < 42) return false;
    return candidate.includes(existing) || existing.includes(candidate);
}

function recentHistory(generationContext) {
    return generationContext?.generation_policy?.recent_history || {
        posts: [],
        used_source_urls: [],
        blocked_body_fingerprints: []
    };
}

function dedupeReasons({ body, sourceUrl = null, generationContext = null }) {
    const history = recentHistory(generationContext);
    const fingerprint = normalizeBodyFingerprint(body);
    const blocked = new Set((history.blocked_body_fingerprints || []).map(normalizeBodyFingerprint));
    const reasons = [];
    if (fingerprint && blocked.has(fingerprint)) {
        reasons.push('duplicate_recent_body');
    } else if (fingerprint && [...blocked].some((existing) => isNearFingerprint(fingerprint, existing))) {
        reasons.push('near_duplicate_recent_body');
    }
    if (sourceUrl && new Set(history.used_source_urls || []).has(sourceUrl)) {
        reasons.push('source_url_already_used');
    }
    return [...new Set(reasons)];
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
        'これ、Claude Codeを会社で使う時も同じだと思ってる',
        '',
        'うちでも便利なコマンドより先に、レビュー境界と権限を決めないと現場で止まる',
        '',
        'AIが賢いほど、人間側の運用が雑だと怖いんよな',
        signal.url
    ].join('\n');
}

function draftHintForNews(signal) {
    return [
        '海外のClaude Code事例って、ツール紹介より「長く走る業務フロー」に話が寄ってきてる',
        '',
        '日本の会社で見る時も、機能比較より先に、どこまでAIに任せてどこで人間が戻るかを決める方が大事',
        signal.url
    ].join('\n');
}

function draftHintAlternativesForPeer(signal, generationContext = null) {
    const anchor = publicKgSnippet((generationContext?.personal_kg?.anchors || [])[0] || '', 70);
    const sourceText = compactText(signal.text || signal.topic || 'この論点', 64);
    return [
        draftHintForPeer(signal),
        [
            `${sourceText}、かなり現場の論点だと思う`,
            '',
            anchor || '会社導入では、便利さより先に責任境界と戻し方を決める必要がある',
            '',
            'AIを入れるほど、人間側の設計の粗さがそのまま出る',
            signal.url
        ].join('\n'),
        [
            'この話、AI活用を個人技で終わらせないために大事だと思ってる',
            '',
            '会社で見るべきなのは、誰が判断し、どこでレビューし、何を記憶に戻すか',
            '',
            'ツールの前に運用の型がいる',
            signal.url
        ].join('\n')
    ];
}

function draftHintAlternativesForNews(signal, generationContext = null) {
    const anchor = publicKgSnippet((generationContext?.personal_kg?.anchors || [])[1] || (generationContext?.personal_kg?.anchors || [])[0] || '', 70);
    const sourceText = compactText(signal.topic || '海外のAI事例', 64);
    return [
        draftHintForNews(signal),
        [
            `${sourceText}という話、日本企業だと「どう使うか」より「どこまで任せるか」に翻訳した方がよさそう`,
            '',
            anchor || '現場に入るAIは、業務ログと責任分界まで含めて設計する必要がある',
            signal.url
        ].join('\n'),
        [
            '海外のAI事例を見る時、機能名だけ追うと浅くなる',
            '',
            '日本の現場では、AIが動いた後に人間がどこで戻れるかまで設計して初めて使える',
            signal.url
        ].join('\n')
    ];
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

function parseBaselineItems(weeklyPlan) {
    const baselineMatch = String(weeklyPlan || '').match(/Baseline:\s*([\s\S]*?)(?=\n[A-Z][A-Za-z ]+:|\n## |\n# |$)/u);
    const block = baselineMatch ? baselineMatch[1] : '';
    const items = block
        .split('\n')
        .map((line) => line.match(/^\s*\d+\.\s*(.+?)\s*$/u)?.[1])
        .filter(Boolean);
    const fallback = ['Own Proof', 'Claude Code法人導入'];
    return [...items, ...fallback].slice(0, 2);
}

function contextEvidence(generationContext) {
    if (!generationContext) return null;
    return {
        policy_ref: 'generation_policy',
        date: generationContext.date || null,
        recommended_lanes: generationContext.generation_policy?.recommended_lanes || [],
        avoid_patterns: generationContext.generation_policy?.avoid_patterns || [],
        winning_angles: generationContext.generation_policy?.winning_angles || [],
        evidence: generationContext.evidence || []
    };
}

function generationConstraints(generationContext) {
    const avoid = generationContext?.generation_policy?.avoid_patterns || [];
    if (!avoid.length) return [];
    return [
        'SNS Generation Contextのavoid_patternsを本文に露出せず生成前制約として扱う',
        ...avoid.slice(0, 4).map((pattern) => `avoid:${pattern}`)
    ];
}

function graphCheckFor(topic, generationContext = null) {
    return {
        scope: 'growth',
        entities: ['さとけい', 'Unson', 'AI駆動経営', topic],
        source_of_truth: 'brainbase Graph + shared/_codex/sns',
        decision: 'checked_for_review',
        constraints: [
            '投稿実行は人間レビュー後',
            '読者に運用都合を見せない',
            '固有名詞はGraph SSOT優先',
            ...generationConstraints(generationContext)
        ]
    };
}

function peerCircleBrain(signal) {
    return {
        source: signal.author_handle,
        relation_mode: '同じ実務界隈の仲間として補強する',
        give_first: '相手の論点に、会社導入で起きる責任境界の現場知見を足す',
        avoid: '相手選定や成長施策の都合を本文に出さない'
    };
}

function amplifierBrain(signal) {
    return {
        source: signal.author_handle,
        relation_mode: '海外の話題を日本の事業責任者 / PM の業務判断に翻訳する',
        give_first: '機能紹介ではなく、責任境界とレビュー設計に接続する',
        avoid: '英語混じりの説明やニュース要約だけで終わらせない'
    };
}

function baselineBodyFor(item, index) {
    if (/Claude Code/u.test(item) || index === 1) {
        return [
            'Claude Codeを会社で使う時、小技を増やすより先に決めることがある',
            '',
            'CLAUDE.md、スキル、hook、レビュー、権限',
            '',
            'ここがないと、個人の便利ツールで止まる',
            '会社で使うAIは、行動ルールまで含めて設計するものなんよな'
        ].join('\n');
    }
    return [
        'SNS運用を「投稿を作る仕組み」じゃなくて、読者理解を学習に戻す個人ナレッジグラフとして作ってる',
        '',
        'Xで反応を見る',
        '反応から読者理解を更新する',
        '次の仮説に戻す',
        '',
        '投稿生成より、こっちが本体なんよな'
    ].join('\n');
}

function baselineBodyAlternatives(item, index, generationContext = null) {
    const personalKg = generationContext?.personal_kg || {};
    const proof = publicKgSnippet((personalKg.proof_points || [])[index] || (personalKg.proof_points || [])[0] || '', 86);
    const anchor = publicKgSnippet((personalKg.anchors || [])[index] || (personalKg.anchors || [])[0] || '', 86);
    const defaultBody = baselineBodyFor(item, index);
    if (index === 0) {
        return [
            defaultBody,
            [
                proof || 'MANAの実運用では、AI駆動PMが会議時間やPM工数の削減に効いている',
                '',
                'この話を単なる成功事例で終わらせず、どの業務をAIに渡し、どこで人間が責任を持つかまで設計する',
                '',
                'ここまで戻して初めて会社のAI活用になる'
            ].join('\n'),
            [
                '個人KGをSNSに使う価値は、投稿を増やすことじゃない',
                '',
                anchor || '読者が何を誤解し、何を怖がっているかを先に立ち上げる',
                '',
                '反応を見て、次の仮説に戻せることが本体'
            ].join('\n')
        ];
    }
    return [
        defaultBody,
        [
            'Claude Codeを会社に入れる時、最初に見るのは機能より責任の置き方だと思ってる',
            '',
            '誰が指示し、どこまで任せ、どこでレビューし、失敗時にどう戻すか',
            '',
            'ここが曖昧だと、便利な個人ツールで止まる'
        ].join('\n'),
        [
            anchor || 'AI活用支援では、相手の決断の怖さを減らして責任を支えることが人間の仕事になる',
            '',
            'Claude Codeも同じで、導入論はプロンプト集より運用設計から始めた方がいい'
        ].join('\n')
    ];
}

function qualityGate({ body, lane, personaBrain: brain, signal, requireSignal = false }) {
    const affect = evaluatePersonaAffect({ body, lane, personaBrain: brain, signal });
    const checks = [];
    const reasons = [];

    checks.push({ name: 'persona_affect', pass: affect.decision === 'pass' });
    if (affect.decision !== 'pass') reasons.push(...affect.negative_feeling_risks);

    const text = String(body || '');
    const forbidden = /少し上の人に絡む|相手の読者に入る|APIで投稿|自動投稿|AI使って書いてます|ルー大柴/u.test(text);
    checks.push({ name: 'no_internal_or_cold_phrasing', pass: !forbidden });
    if (forbidden) reasons.push('internal_or_cold_phrasing');

    const hasJapaneseReaderWorld = /会社|現場|業務|運用|責任|権限|レビュー|経営|PM|読者|学習/u.test(text);
    checks.push({ name: 'reader_world_anchor', pass: hasJapaneseReaderWorld });
    if (!hasJapaneseReaderWorld) reasons.push('reader_world_anchor_missing');

    const isShortEnough = text.length <= 280;
    checks.push({ name: 'under_280_chars', pass: isShortEnough });
    if (!isShortEnough) reasons.push('too_long');

    const noSentencePeriod = !/。/u.test(text);
    checks.push({ name: 'style_no_sentence_period', pass: noSentencePeriod });
    if (!noSentencePeriod) reasons.push('style_sentence_period');

    if (requireSignal) {
        const followers = Number(signal?.author_followers || 0);
        const passesSignal = signal?.kind === 'peer_post'
            ? ['primary', 'secondary'].includes(signal.target_band)
            : followers >= 500;
        checks.push({ name: 'source_strength', pass: Boolean(passesSignal) });
        if (!passesSignal) reasons.push('source_strength_insufficient');
    }

    return {
        decision: reasons.length === 0 ? 'pass' : 'hold',
        checks,
        reasons: [...new Set(reasons)],
        persona_affect: affect
    };
}

function buildPost({ slot, label, lane, topic, body, signal, extra = {}, requireSignal = false, generationContext = null }) {
    const brain = personaBrain(topic);
    const quality_gate = qualityGate({ body, lane, personaBrain: brain, signal, requireSignal });
    return {
        slot,
        label,
        lane,
        topic,
        body,
        source_url: signal?.url,
        persona_brain: brain,
        graph_check: graphCheckFor(topic, generationContext),
        generation_context_evidence: contextEvidence(generationContext),
        quality_gate,
        ...extra
    };
}

function buildReviewPack({ date, weeklyPlan, peerCards, newsCards, generationContext = null }) {
    const holds = [];
    const posts = [];

    for (const [index, item] of parseBaselineItems(weeklyPlan).entries()) {
        const lane = index === 0 ? 'own_proof' : 'trust_balance';
        const candidates = baselineBodyAlternatives(item, index, generationContext).map((body) => buildPost({
            slot: `baseline_${index + 1}`,
            label: `Baseline ${index + 1}`,
            lane,
            topic: item,
            body,
            generationContext
        }));
        let selected = null;
        for (const candidate of candidates) {
            if (candidate.quality_gate.decision !== 'pass') continue;
            const reasons = dedupeReasons({ body: candidate.body, generationContext });
            if (reasons.length > 0) {
                holds.push({
                    lane,
                    decision: 'dedupe hold',
                    reasons,
                    slot: candidate.slot,
                    topic: candidate.topic
                });
                continue;
            }
            selected = candidate;
            break;
        }
        if (selected) {
            posts.push(selected);
        } else if (!holds.some((hold) => hold.slot === `baseline_${index + 1}`)) {
            holds.push({
                lane,
                decision: 'quality hold',
                reasons: ['baseline_quality_or_dedupe_blocked'],
                slot: `baseline_${index + 1}`,
                topic: item
            });
        }
    }

    const peerPost = peerCards
        .flatMap((signal) => draftHintAlternativesForPeer(signal, generationContext).map((body) => buildPost({
            slot: 'peer_quote_1',
            label: 'Peer Quote 1',
            lane: 'peer_circle',
            topic: signal.topic,
            body,
            signal,
            requireSignal: true,
            generationContext,
            extra: { peer_circle_brain: peerCircleBrain(signal) }
        })))
        .find((post) => {
            if (post.quality_gate.decision !== 'pass') return false;
            const reasons = dedupeReasons({ body: post.body, sourceUrl: post.source_url, generationContext });
            if (reasons.length > 0) {
                holds.push({
                    lane: post.lane,
                    decision: 'dedupe hold',
                    reasons,
                    slot: post.slot,
                    topic: post.topic,
                    source_url: post.source_url
                });
                return false;
            }
            return true;
        });
    if (peerPost) {
        posts.push(peerPost);
    } else if (!holds.some((hold) => hold.slot === 'peer_quote_1')) {
        holds.push({
            lane: 'Peer Quote',
            decision: 'quality hold',
            reasons: ['source_strength_insufficient_or_persona_affect_blocked']
        });
    }

    const newsPost = newsCards
        .flatMap((signal) => draftHintAlternativesForNews(signal, generationContext).map((body) => buildPost({
            slot: 'news_commentary_1',
            label: 'News Commentary 1',
            lane: 'trust_balance',
            topic: signal.topic,
            body,
            signal,
            requireSignal: true,
            generationContext,
            extra: { amplifier_brain: amplifierBrain(signal) }
        })))
        .find((post) => {
            if (post.quality_gate.decision !== 'pass') return false;
            const reasons = dedupeReasons({ body: post.body, sourceUrl: post.source_url, generationContext });
            if (reasons.length > 0) {
                holds.push({
                    lane: post.lane,
                    decision: 'dedupe hold',
                    reasons,
                    slot: post.slot,
                    topic: post.topic,
                    source_url: post.source_url
                });
                return false;
            }
            return true;
        });
    if (newsPost) {
        posts.push(newsPost);
    } else if (!holds.some((hold) => hold.slot === 'news_commentary_1')) {
        holds.push({
            lane: 'News Commentary',
            decision: 'quality hold',
            reasons: ['source_strength_insufficient_or_persona_affect_blocked']
        });
    }

    return {
        date,
        publish_intent: 'manual_review_only',
        posts,
        holds
    };
}

function generationContextSummary(generationContext) {
    if (!generationContext) return null;
    return {
        date: generationContext.date || null,
        generation_policy: generationContext.generation_policy || {
            recommended_lanes: [],
            avoid_patterns: [],
            winning_angles: [],
            needs_more_data: [],
            quote_target_policy: []
        },
        evidence: generationContext.evidence || []
    };
}

export function buildBrief({ date, jpTweets, enTweets, jpReads, enReads, weeklyPlan = '', generationContext = null }) {
    const peerSignals = pickPeerTweets(jpTweets).map(toPeerSignal);
    const newsSignals = pickTopTweets(enTweets, 3).map(toNewsSignal);
    const peerCards = peerSignals.map((signal) => withAffect(signal, draftHintForPeer(signal), 'peer_circle'));
    const newsCards = newsSignals.map((signal) => withAffect(signal, draftHintForNews(signal), 'trust_balance'));
    const totalReads = Number(jpReads ?? jpTweets.length) + Number(enReads ?? enTweets.length);
    const cost = totalReads * COST_PER_TWEET_READ_USD;
    const reviewPack = buildReviewPack({ date, weeklyPlan, peerCards, newsCards, generationContext });
    const signals = {
        peerSignals,
        newsSignals,
        generationContext: generationContextSummary(generationContext),
        reviewPack
    };
    return {
        markdown: renderMarkdown({ date, weeklyPlan, peerCards, newsCards, reviewPack, totalReads, cost, generationContext }),
        signals,
        summary: {
            date,
            total_reads: totalReads,
            estimated_cost_usd: Number(cost.toFixed(3)),
            generation_context_used: Boolean(generationContext),
            peer_candidates: peerCards.length,
            news_candidates: newsCards.length,
            review_pack_posts: reviewPack.posts.length,
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

function renderPost(post) {
    const graphEntities = post.graph_check.entities.join(', ');
    const quality = post.quality_gate.decision;
    const persona = post.persona_brain.target_person;
    const extras = [];
    if (post.peer_circle_brain) {
        extras.push(`Peer Circle Brain: ${post.peer_circle_brain.relation_mode}`);
    }
    if (post.amplifier_brain) {
        extras.push(`Amplifier Brain: ${post.amplifier_brain.relation_mode}`);
    }
    return [
        `### ${post.label} / ${post.topic}`,
        '',
        `Quality Gate: ${quality}`,
        `Graph Check: scope=${post.graph_check.scope}; entities=${graphEntities}`,
        `Persona Brain: ${persona}`,
        ...extras,
        '',
        '本文:',
        '',
        '```text',
        post.body,
        '```'
    ].join('\n');
}

function renderGenerationContext(generationContext) {
    if (!generationContext) {
        return [
            '## Generation Context',
            '',
            '- status: not provided',
            '- fallback: weekly plan + today signals only'
        ].join('\n');
    }
    const policy = generationContext.generation_policy || {};
    return [
        '## Generation Context',
        '',
        `- Context date: ${generationContext.date || 'unknown'}`,
        `- Recommended lanes: ${(policy.recommended_lanes || []).join(', ') || '-'}`,
        `- Avoid patterns: ${(policy.avoid_patterns || []).join(', ') || '-'}`,
        `- Winning angles: ${(policy.winning_angles || []).slice(0, 3).join(' / ') || '-'}`,
        `- Needs more data: ${(policy.needs_more_data || []).slice(0, 3).join(' / ') || '-'}`,
        `- Quote target policy: ${(policy.quote_target_policy || []).slice(0, 2).join(' / ') || '-'}`
    ].join('\n');
}

function renderMarkdown({ date, weeklyPlan, peerCards, newsCards, reviewPack, totalReads, cost, generationContext = null }) {
    const holdLines = reviewPack.holds.length > 0
        ? reviewPack.holds.map((hold) => `- ${hold.lane}: ${hold.decision} - ${hold.reasons.join(', ')}`)
        : ['- なし'];
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
        '## 今日のレビュー用投稿パック',
        '',
        `Publish intent: ${reviewPack.publish_intent}`,
        '',
        '## Graph Check',
        '',
        '- scope: growth',
        '- source: brainbase Graph + shared/_codex/sns',
        '- rule: No Graph Check, no post',
        '',
        renderGenerationContext(generationContext),
        '',
        reviewPack.posts.length > 0 ? reviewPack.posts.map(renderPost).join('\n\n') : '通過した投稿なし。',
        '',
        'Hold:',
        ...holdLines,
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
    const generationContext = readGenerationContext(args.generationContext);
    const brief = buildBrief({
        date: args.date,
        jpTweets: jp.tweets,
        enTweets: en.tweets,
        jpReads: jp.reads,
        enReads: en.reads,
        weeklyPlan: loadWeeklyPlan(args.date),
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
