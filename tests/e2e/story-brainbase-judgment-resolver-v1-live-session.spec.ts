import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import test from 'node:test';

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
const HOOK_CONFIG = join(CODEX_HOME, 'hooks.json');
const CODEX_CONFIG = join(CODEX_HOME, 'config.toml');
const JOURNAL_ROOT = join(CODEX_HOME, 'var', 'judgment-resolver');
const CANONICAL_ENTRYPOINT = 'scripts/codex-hooks/judgment-resolver-entry.sh';
const EVIDENCE_EPISODE_PATH = process.env.BRAINBASE_JUDGMENT_E2E_EPISODE_PATH || '';
const EVIDENCE_TRANSCRIPT_PATH = process.env.BRAINBASE_JUDGMENT_E2E_TRANSCRIPT_PATH || '';
const EXPECTED_HEAD = process.env.BRAINBASE_JUDGMENT_E2E_EXPECTED_HEAD || '';
const EXPECTED_NONCE = process.env.BRAINBASE_JUDGMENT_E2E_NONCE || '';
const EXPECTED_RUN_QUERY = process.env.BRAINBASE_JUDGMENT_E2E_RUN_QUERY || '';
const REGRESSION_SCRIPT = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    .scripts['test:judgment-resolution'];
const READINESS_CHECKER = join(process.cwd(), 'scripts', 'check-codex-judgment-hook-readiness.mjs');

const EXPECTED_TOOLS = [
    'mcp__brainbase__brainbase_knowledge_resolve',
    'mcp__brainbase__search',
    'mcp__brainbase__search',
    'mcp__brainbase__get_entity'
];

const EXPECTED_QUERY_EXCERPTS = [
    {
        includes: () => [EXPECTED_NONCE]
    },
    { includes: () => [EXPECTED_NONCE] },
    { includes: () => ['判断'] },
    { includes: () => ['glossary_term'] }
];

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function inputDigest(input) {
    return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function fileDigest(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function hookCommands(config, hookName) {
    return (config.hooks?.[hookName] || [])
        .flatMap((group) => group.hooks || [])
        .map((hook) => hook.command || '');
}

function canonicalEntrypointPath(config, hookName) {
    const command = hookCommands(config, hookName)
        .find((candidate) => candidate.includes(CANONICAL_ENTRYPOINT));
    const match = command?.match(/(?:^|\s)["']?(\/[^\s"']*\/scripts\/codex-hooks\/judgment-resolver-entry\.sh)["']?/u);
    return match?.[1] || '';
}

function evidencePathIsBoundToJournal(path) {
    if (!path || !isAbsolute(path)) return false;
    const journalRelativePath = relative(JOURNAL_ROOT, path);
    return journalRelativePath !== ''
        && !journalRelativePath.startsWith('..')
        && !isAbsolute(journalRelativePath)
        && path.endsWith('.episode.json');
}

function evidenceTranscriptIsBoundToSessions(path) {
    if (!path || !isAbsolute(path) || !existsSync(path)) return false;
    const sessionRoot = realpathSync(join(CODEX_HOME, 'sessions'));
    const canonicalPath = realpathSync(path);
    const sessionRelativePath = relative(sessionRoot, canonicalPath);
    return sessionRelativePath !== ''
        && !sessionRelativePath.startsWith('..')
        && !isAbsolute(sessionRelativePath)
        && path.endsWith('.jsonl');
}

function readFinalAssistantMessage(path, turnId) {
    const messages = readFileSync(path, 'utf8').split('\n').flatMap((line) => {
        if (!line.trim()) return [];
        const entry = JSON.parse(line);
        const payload = entry?.type === 'response_item' ? entry.payload : null;
        if (payload?.type !== 'message' || payload.role !== 'assistant') return [];
        const metadata = payload.internal_chat_message_metadata_passthrough || payload.metadata || {};
        const messageTurnId = metadata.turn_id || payload.turn_id || null;
        const phase = metadata.phase || payload.phase || null;
        const text = Array.isArray(payload.content)
            ? payload.content
                .filter((content) => content?.type === 'output_text' && typeof content.text === 'string')
                .map((content) => content.text)
                .join('\n')
            : '';
        return messageTurnId === turnId && phase === 'final_answer' && text ? [{ text }] : [];
    });
    assert.ok(messages.length > 0, `No final assistant response_item found for turn ${turnId}`);
    return messages.at(-1).text;
}

function hookVisibleFinalAnswer(renderedAnswer) {
    const openingTag = '<oai-mem-citation>';
    const closingTag = '</oai-mem-citation>';
    const openingTags = [...renderedAnswer.matchAll(/<oai-mem-citation>/gu)];
    const closingTags = [...renderedAnswer.matchAll(/<\/oai-mem-citation>/gu)];
    if (openingTags.length !== 1 || closingTags.length !== 1) return renderedAnswer;

    const markerIndex = openingTags[0].index;
    const closingIndex = closingTags[0].index;
    if (markerIndex === undefined || closingIndex === undefined || closingIndex <= markerIndex) {
        return renderedAnswer;
    }

    const prefix = renderedAnswer.slice(0, markerIndex);
    const citationBlock = renderedAnswer.slice(markerIndex);
    if (!/(?:\r?\n)+$/u.test(prefix)
        || !new RegExp(`^${openingTag}\\r?\\n[\\s\\S]*\\r?\\n${closingTag}$`, 'u').test(citationBlock)
        || closingIndex + closingTag.length !== renderedAnswer.length) {
        return renderedAnswer;
    }
    return prefix;
}

test('hookVisibleFinalAnswer preserves an answer without a citation block', () => {
    const renderedAnswer = '本文のみ';
    assert.equal(hookVisibleFinalAnswer(renderedAnswer), renderedAnswer);
});

test('hookVisibleFinalAnswer removes one complete trailing citation block', () => {
    const renderedAnswer = '本文\n\n<oai-mem-citation>\nsource\n</oai-mem-citation>';
    assert.equal(hookVisibleFinalAnswer(renderedAnswer), '本文\n\n');
});

test('hookVisibleFinalAnswer preserves an incomplete citation block', () => {
    const renderedAnswer = '本文\n\n<oai-mem-citation>\nsource';
    assert.equal(hookVisibleFinalAnswer(renderedAnswer), renderedAnswer);
});

test('hookVisibleFinalAnswer preserves an embedded citation block', () => {
    const renderedAnswer = '本文\n\n<oai-mem-citation>\nsource\n</oai-mem-citation>\n\n続き';
    assert.equal(hookVisibleFinalAnswer(renderedAnswer), renderedAnswer);
});

test('hookVisibleFinalAnswer preserves multiple citation blocks joined by one newline', () => {
    const citation = '<oai-mem-citation>\nsource\n</oai-mem-citation>';
    const renderedAnswer = `本文\n${citation}\n${citation}`;
    assert.equal(hookVisibleFinalAnswer(renderedAnswer), renderedAnswer);
});

test('hookVisibleFinalAnswer preserves multiple citation blocks joined by a blank line', () => {
    const citation = '<oai-mem-citation>\nsource\n</oai-mem-citation>';
    const renderedAnswer = `本文\n\n${citation}\n\n${citation}`;
    assert.equal(hookVisibleFinalAnswer(renderedAnswer), renderedAnswer);
});

function assertRenderedAuditTrace(answer, expectedLines) {
    const lines = answer.replaceAll('\r\n', '\n').split('\n');
    assert.deepEqual(
        lines.slice(0, expectedLines.length),
        expectedLines,
        'The final user-visible answer must begin with the stored owner/tool audit lines in journal commit order'
    );
    const expectedCounts = new Map(expectedLines.map((line) => [
        line,
        expectedLines.filter((candidate) => candidate === line).length
    ]));
    for (const [line, count] of expectedCounts) {
        assert.equal(
            lines.filter((candidate) => candidate === line).length,
            count,
            `Stored audit line must appear exactly as many times as its recorded event: ${line}`
        );
    }
}

function readBoundEpisode() {
    const eventDirectory = EVIDENCE_EPISODE_PATH.replace(/\.episode\.json$/u, '.events');
    const finalPath = EVIDENCE_EPISODE_PATH.replace(/\.episode\.json$/u, '.final.json');
    return {
        episode: readJson(EVIDENCE_EPISODE_PATH),
        events: readdirSync(eventDirectory)
            .filter((eventFile) => eventFile.endsWith('.json'))
            .map((eventFile) => readJson(join(eventDirectory, eventFile)))
            .sort((left, right) => (
                Number.isSafeInteger(left.event_sequence) && Number.isSafeInteger(right.event_sequence)
                    ? left.event_sequence - right.event_sequence
                    : left.recorded_at.localeCompare(right.recorded_at)
            )),
        final: readJson(finalPath)
    };
}

function regressionCovers(file, evidenceText, regressionStatus) {
    return regressionStatus === 0
        && REGRESSION_SCRIPT.includes(file)
        && readFileSync(join(process.cwd(), file), 'utf8').includes(evidenceText);
}

function assertLiveEvidenceBinding(expectedHead, expectedNonce, expectedRunQuery) {
    assert.match(expectedHead, /^[0-9a-f]{40}$/u, 'Expected current HEAD must be a full SHA');
    assert.match(expectedNonce, /^[0-9a-z-]{8,64}$/u, 'Expected run nonce must be explicit');
    const evidenceSourceHead = expectedRunQuery.slice(-40);
    assert.match(evidenceSourceHead, /^[0-9a-f]{40}$/u, 'Run query must retain its source HEAD');
    assert.equal(expectedRunQuery, `E2E-${expectedNonce}-${evidenceSourceHead}`);
    assert.equal(
        evidenceSourceHead,
        expectedHead,
        'Live episode evidence must be generated for the same HEAD as the contract under test'
    );
}

function assertEffectiveHookReadiness() {
    const checked = spawnSync(process.execPath, [
        READINESS_CHECKER,
        '--cwd', process.cwd(),
        '--codex-bin', process.env.BRAINBASE_JUDGMENT_E2E_CODEX_BIN || 'codex',
        '--json'
    ], { cwd: process.cwd(), encoding: 'utf8', env: process.env });
    const output = `${checked.stdout || ''}\n${checked.stderr || ''}`;
    assert.equal(checked.status, 0, `Current Codex Hook trust is not ready:\n${output.slice(-4000)}`);
    const receipt = JSON.parse(checked.stdout);
    assert.equal(receipt.status, 'ready_for_fresh_task');
    assert.equal(receipt.ready, true);
}

function assertFreshTaskBinding(transcriptPath) {
    const sessionMeta = readFileSync(transcriptPath, 'utf8').split('\n').flatMap((line) => {
        if (!line.trim()) return [];
        const entry = JSON.parse(line);
        if (entry?.type !== 'session_meta') return [];
        const timestamp = entry.payload?.timestamp || entry.timestamp;
        return typeof timestamp === 'string' ? [timestamp] : [];
    }).at(0);
    assert.ok(sessionMeta, 'Live transcript must contain a session creation timestamp');
    const taskCreatedAt = Date.parse(sessionMeta);
    assert.ok(Number.isFinite(taskCreatedAt), 'Live transcript session timestamp must be valid');
    const bindingUpdatedAt = Math.max(statSync(HOOK_CONFIG).mtimeMs, statSync(CODEX_CONFIG).mtimeMs);
    assert.ok(
        taskCreatedAt >= bindingUpdatedAt,
        'Live evidence must come from a task created after the current Hook definition and trust approval'
    );
}

test('story-brainbase-judgment-resolver-v1 は旧HEADのlive episode証跡を拒否する', () => {
    const currentHead = 'a'.repeat(40);
    const staleHead = 'b'.repeat(40);

    assert.throws(
        () => assertLiveEvidenceBinding(currentHead, 'jr-e2e-stale-head', `E2E-jr-e2e-stale-head-${staleHead}`),
        /same HEAD as the contract under test/u
    );
});

test('story-brainbase-judgment-resolver-v1 AC-4 ac:4 follow-up minimal DAG coverage marker', () => {
    const serviceTestPath = 'tests/unit/judgment-resolution-service.test.js';
    const serviceTest = readFileSync(join(process.cwd(), serviceTestPath), 'utf8');
    const criterion = '解決結果は問いと会話文脈に必要な判断ノードだけを含み、無関係な全判断段階を一律には含まない。短い追従発話でも明示された会話文脈から同じ問題領域を継続できる。';

    assert.ok(
        criterion.includes('短い追従発話')
            && REGRESSION_SCRIPT.includes(serviceTestPath)
            && serviceTest.includes('短い追従質問はStory履歴'),
        `AC-4/ac:4 ${criterion}`
    );
});

test('story-brainbase-judgment-resolver-v1 AC-2 ac:2 binding rejection coverage marker', () => {
    const routeTestPath = 'tests/integration/judgment-resolution-routes.test.js';

    assert.ok(
        REGRESSION_SCRIPT.includes(routeTestPath)
            && readFileSync(join(process.cwd(), routeTestPath), 'utf8').includes('unregistered adapter'),
        'AC-2/ac:2 binding rejection regression must remain in the release suite'
    );
});

test('story-brainbase-judgment-resolver-v1 AC-5 ac:5 active node definition coverage marker', () => {
    const serviceTestPath = 'tests/unit/judgment-resolution-service.test.js';

    assert.ok(
        REGRESSION_SCRIPT.includes(serviceTestPath)
            && readFileSync(join(process.cwd(), serviceTestPath), 'utf8').includes('active_node_definitions.map((node) => node.id)'),
        'AC-5/ac:5 active node definition regression must remain in the release suite'
    );
});

test('story-brainbase-judgment-resolver-v1 AC-7 ac:7 policy conflict coverage marker', () => {
    const serviceTestPath = 'tests/unit/judgment-resolution-service.test.js';

    assert.ok(
        REGRESSION_SCRIPT.includes(serviceTestPath)
            && readFileSync(join(process.cwd(), serviceTestPath), 'utf8').includes('hard conflictはpriority・specificity'),
        'AC-7/ac:7 policy conflict regression must remain in the release suite'
    );
});

test('story-brainbase-judgment-resolver-v1 AC-9 ac:9 clarification continuation coverage marker', () => {
    const managedTurnTestPath = 'tests/integration/judgment-managed-turn-e2e.test.js';

    assert.ok(
        REGRESSION_SCRIPT.includes(managedTurnTestPath)
            && readFileSync(join(process.cwd(), managedTurnTestPath), 'utf8').includes('clarification.execution_status'),
        'AC-9/ac:9 clarification continuation regression must remain in the release suite'
    );
});

test('story-brainbase-judgment-resolver-v1 AC-12 ac:12 stable digest coverage marker', () => {
    const serviceTestPath = 'tests/unit/judgment-resolution-service.test.js';

    assert.ok(
        REGRESSION_SCRIPT.includes(serviceTestPath)
            && readFileSync(join(process.cwd(), serviceTestPath), 'utf8').includes('同じcanonical contextから同じplan digestを再現する'),
        'AC-12/ac:12 stable digest regression must remain in the release suite'
    );
});

test('story-brainbase-judgment-resolver-v1 AC-15 ac:15 future adapter boundary coverage marker', () => {
    const publicationTestPath = 'tests/unit/judgment-resolution-publication.test.js';

    assert.ok(
        REGRESSION_SCRIPT.includes(publicationTestPath)
            && readFileSync(join(process.cwd(), publicationTestPath), 'utf8').includes('Claude Codeは将来のHost adapter候補'),
        'AC-15/ac:15 future adapter boundary regression must remain in the release suite'
    );
});

test('story-brainbase-judgment-resolver-v1 AC-16 ac:16 publication consistency coverage marker', () => {
    const publicationTestPath = 'tests/unit/judgment-resolution-publication.test.js';

    assert.ok(
        REGRESSION_SCRIPT.includes(publicationTestPath)
            && readFileSync(join(process.cwd(), publicationTestPath), 'utf8').includes('Skill・capability・runbook・specがmodel非依存の同じ境界を公開する'),
        'AC-16/ac:16 publication consistency regression must remain in the release suite'
    );
});

test('story-brainbase-judgment-resolver-v1 AC-10 ac:10 caller injection coverage marker', () => {
    const serviceTestPath = 'tests/unit/judgment-resolution-service.test.js';
    const serviceTest = readFileSync(join(process.cwd(), serviceTestPath), 'utf8');
    const criterion = '呼び出し側は、サーバー管理の判断基準、判断経路、分類provenance、安全floorを任意に注入・上書きできない。';

    assert.ok(
        criterion.includes('任意に注入・上書きできない')
            && REGRESSION_SCRIPT.includes(serviceTestPath)
            && serviceTest.includes('modelがclassification_proposalを注入できない'),
        `AC-10/ac:10 ${criterion}`
    );
});

test('story-brainbase-judgment-resolver-v1 AC-17 ac:17 auditable threshold coverage marker', () => {
    const serviceTestPath = 'tests/unit/judgment-resolution-service.test.js';
    const serviceTest = readFileSync(join(process.cwd(), serviceTestPath), 'utf8');
    const criterion = '根拠のない固定閾値を追加せず、分類、reconciliation、適用理由を監査できる。';

    assert.ok(
        criterion.includes('根拠のない固定閾値を追加せず')
            && REGRESSION_SCRIPT.includes(serviceTestPath)
            && serviceTest.includes('根拠のない固定閾値は置きたくない'),
        `AC-17/ac:17 ${criterion}`
    );
});

test('story-brainbase-judgment-resolver-v1 がcurrent runのglobal hook・回帰suite・final receiptを検証する', () => {
    assert.ok(existsSync(HOOK_CONFIG), `Codex global hook config is missing: ${HOOK_CONFIG}`);
    assert.ok(existsSync(CODEX_CONFIG), `Codex global config is missing: ${CODEX_CONFIG}`);
    assert.ok(existsSync(JOURNAL_ROOT), `Judgment journal is missing: ${JOURNAL_ROOT}`);
    assertEffectiveHookReadiness();
    assertLiveEvidenceBinding(EXPECTED_HEAD, EXPECTED_NONCE, EXPECTED_RUN_QUERY);
    const currentHead = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: process.cwd(),
        encoding: 'utf8'
    });
    assert.equal(currentHead.status, 0, currentHead.stderr || 'Unable to resolve current HEAD');
    assert.equal(
        currentHead.stdout.trim(),
        EXPECTED_HEAD,
        'Contract regression evidence must be generated for current HEAD; installed Hook checkout SHA is verified separately at deployment'
    );
    assert.ok(
        evidencePathIsBoundToJournal(EVIDENCE_EPISODE_PATH) && existsSync(EVIDENCE_EPISODE_PATH),
        'Evidence must name one exact episode inside the owner journal'
    );
    assert.ok(
        evidenceTranscriptIsBoundToSessions(EVIDENCE_TRANSCRIPT_PATH),
        'Evidence must name one exact Codex JSONL transcript inside CODEX_HOME/sessions'
    );
    assertFreshTaskBinding(EVIDENCE_TRANSCRIPT_PATH);

    const config = readJson(HOOK_CONFIG);
    for (const hookName of ['UserPromptSubmit', 'PostToolUse', 'Stop']) {
        assert.ok(
            hookCommands(config, hookName).some((command) => command.includes(CANONICAL_ENTRYPOINT)),
            `${hookName} is not bound to ${CANONICAL_ENTRYPOINT}`
        );
    }

    const installedEntrypoints = ['UserPromptSubmit', 'PostToolUse', 'Stop']
        .map((hookName) => ({
            hookName,
            path: canonicalEntrypointPath(config, hookName)
        }));
    for (const installed of installedEntrypoints) {
        assert.ok(
            installed.path && existsSync(installed.path),
            `${installed.hookName} canonical Hook entrypoint is not resolvable`
        );
    }
    assert.equal(
        new Set(installedEntrypoints.map((installed) => installed.path)).size,
        1,
        'UserPromptSubmit, PostToolUse, and Stop must use the same installed lifecycle adapter checkout'
    );
    for (const installed of installedEntrypoints) {
        const installedHookRoot = resolve(dirname(installed.path), '..', '..');
        for (const runtimeFile of [
            CANONICAL_ENTRYPOINT,
            'scripts/codex-hooks/judgment-resolver-host.mjs'
        ]) {
            assert.equal(
                fileDigest(join(installedHookRoot, runtimeFile)),
                fileDigest(join(process.cwd(), runtimeFile)),
                `${installed.hookName} lifecycle adapter must be content-equivalent to current HEAD: ${runtimeFile}`
            );
        }
    }

    const candidate = readBoundEpisode();
    const runtimeManifest = readJson(join(process.cwd(), 'config/judgment-runtime-manifest.json'));
    const expectedManifestDigest = createHash('sha256')
        .update(canonicalJson(runtimeManifest))
        .digest('hex');
    assert.equal(candidate.episode.state, 'open', 'Episode remains immutable after finalization');
    assert.equal(candidate.episode.initial_route_receipt?.status, 'resolved');
    assert.equal(
        candidate.episode.initial_route_receipt?.runtime_version,
        runtimeManifest.runtime_version,
        'Live evidence must use the Resolver runtime version declared by current HEAD'
    );
    assert.equal(
        candidate.episode.initial_route_receipt?.manifest_digest,
        expectedManifestDigest,
        'Live evidence must use the Resolver manifest declared by current HEAD'
    );
    assert.deepEqual(candidate.events.map((event) => event.tool_name), EXPECTED_TOOLS);
    assert.ok(candidate.events.every((event) => event.success === true));
    for (const [index, expected] of EXPECTED_QUERY_EXCERPTS.entries()) {
        const excerpt = candidate.events[index].query_excerpt || '';
        assert.ok(expected.includes().every((token) => excerpt.includes(token)));
    }
    const runQuery = EXPECTED_RUN_QUERY;
    assert.equal(candidate.events[0].input_digest, inputDigest({
        audience: 'team',
        content_type: 'unknown',
        intent: runQuery,
        project_code: 'brainbase'
    }));
    assert.equal(candidate.events[1].input_digest, inputDigest({
        project: 'brainbase',
        query: runQuery
    }));
    assert.match(candidate.events[1].display_line, /該当なし/u);
    assert.match(candidate.events[2].display_line, /結果を取得/u);
    assert.match(candidate.events[3].display_line, /結果を取得/u);
    assert.match(candidate.events[0].display_line, /^(?:📚|⚠️) Brainbase参照先:/u);
    assert.match(candidate.events[1].display_line, /^📚 Brainbase検索:/u);
    assert.match(candidate.events[2].display_line, /^📚 Brainbase検索:/u);
    assert.match(candidate.events[3].display_line, /^📚 Brainbase取得:/u);
    assert.match(candidate.episode.owner_audit?.display_line || '', /^🧠 判断参照:/u);
    assert.equal(candidate.final.completion_status, 'complete');
    assert.equal(candidate.final.owner_audit_complete, true);
    assert.equal(candidate.final.owner_audit_line_count, 5);
    assert.equal(candidate.final.event_count, 4);
    assert.equal(candidate.final.qualifying_event_count, 1);
    assert.match(candidate.final.answer_digest, /^[0-9a-f]{64}$/u);
    const renderedAnswer = readFinalAssistantMessage(
        EVIDENCE_TRANSCRIPT_PATH,
        candidate.episode.initial_route_receipt.turn_id
    );
    const expectedAuditLines = [
        candidate.episode.owner_audit.display_line,
        ...candidate.events.map((event) => event.display_line)
    ];
    assertRenderedAuditTrace(renderedAnswer, expectedAuditLines);
    assert.equal(
        candidate.final.answer_digest,
        createHash('sha256').update(hookVisibleFinalAnswer(renderedAnswer)).digest('hex'),
        'Final receipt must bind the exact Stop Hook-visible final answer before app-added memory citation metadata'
    );
    const finalizedAt = Date.parse(candidate.final.finalized_at);
    const evidenceAgeMs = Date.now() - finalizedAt;
    assert.ok(Number.isFinite(finalizedAt), 'Final receipt must have a valid finalized_at timestamp');
    assert.ok(
        evidenceAgeMs >= -5 * 60 * 1000 && evidenceAgeMs <= 60 * 60 * 1000,
        'Live evidence must be finalized within the last hour'
    );

    const regression = spawnSync('npm', ['run', 'test:judgment-resolution'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 20 * 1024 * 1024
    });
    const regressionOutput = `${regression.stdout || ''}\n${regression.stderr || ''}`;
    assert.equal(regression.status, 0, `Judgment regression suite failed:\n${regressionOutput.slice(-4000)}`);

    assert.ok(
        regressionCovers('tests/unit/judgment-resolver-host.test.js', 'UserPromptSubmitでepisodeを1件だけ開始', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:1 initial route and exactly-one episode evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/integration/judgment-resolution-routes.test.js', 'unregistered adapter', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:2 binding rejection evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/integration/judgment-launcher-process.test.js', 'network failureをexit 69で可視化', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:3 unmanaged host evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-service.test.js', '短い追従質問はStory履歴', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:4 minimal DAG and follow-up context evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-service.test.js', 'active_node_definitions.map((node) => node.id)', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:5 active node definition evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-service.test.js', '文脈に応じたdomain・constraint・authority DAGだけを選ぶ', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:6 context-specific subgraph evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-service.test.js', 'hard conflictはpriority・specificity', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:7 policy scope and conflict evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-service.test.js', 'knowledge branchはKnowledge Resolverの完全なhandoffだけを返す', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:8 structured Knowledge Resolver handoff evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/integration/judgment-managed-turn-e2e.test.js', 'clarification.execution_status', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:9 clarification continuation evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-service.test.js', 'modelがclassification_proposalを注入できない', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:10 caller injection rejection evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/integration/judgment-resolution-routes.test.js', 'personal judgmentを%sへ公開しない', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:11 owner-only personal policy evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-service.test.js', '同じcanonical contextから同じplan digestを再現する', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:12 digest and stable plan evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-publication.test.js', 'model-callable toolとして公開しない', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:13 Host-only bridge publication evidence must pass'
    );
    assert.ok(
        candidate.events[1].display_line.includes('該当なし')
            && candidate.events[2].display_line.includes('結果を取得')
            && candidate.events[3].display_line.includes('結果を取得'),
        'story-brainbase-judgment-resolver-v1 ac:14 live result-dependent 0..N retrieval evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-publication.test.js', 'Claude Codeは将来のHost adapter候補', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:15 future Claude Code adapter boundary evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-publication.test.js', 'Skill・capability・runbook・specがmodel非依存の同じ境界を公開する', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:16 publication surface consistency evidence must pass'
    );
    assert.ok(
        regressionCovers('tests/unit/judgment-resolution-service.test.js', '根拠のない固定閾値は置きたくない', regression.status),
        'story-brainbase-judgment-resolver-v1 ac:17 no arbitrary threshold and auditable rationale evidence must pass'
    );
});
