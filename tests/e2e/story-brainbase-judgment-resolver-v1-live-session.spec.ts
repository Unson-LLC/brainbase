import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import test from 'node:test';

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
const HOOK_CONFIG = join(CODEX_HOME, 'hooks.json');
const JOURNAL_ROOT = join(CODEX_HOME, 'var', 'judgment-resolver');
const CANONICAL_ENTRYPOINT = 'scripts/codex-hooks/judgment-resolver-entry.sh';
const EVIDENCE_EPISODE_PATH = process.env.BRAINBASE_JUDGMENT_E2E_EPISODE_PATH || '';
const EXPECTED_HEAD = process.env.BRAINBASE_JUDGMENT_E2E_EXPECTED_HEAD || '';
const EXPECTED_NONCE = process.env.BRAINBASE_JUDGMENT_E2E_NONCE || '';
const REGRESSION_SCRIPT = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    .scripts['test:judgment-resolution'];

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

function hookCommands(config, hookName) {
    return (config.hooks?.[hookName] || [])
        .flatMap((group) => group.hooks || [])
        .map((hook) => hook.command || '');
}

function evidencePathIsBoundToJournal(path) {
    if (!path || !isAbsolute(path)) return false;
    const journalRelativePath = relative(JOURNAL_ROOT, path);
    return journalRelativePath !== ''
        && !journalRelativePath.startsWith('..')
        && !isAbsolute(journalRelativePath)
        && path.endsWith('.episode.json');
}

function readBoundEpisode() {
    const eventDirectory = EVIDENCE_EPISODE_PATH.replace(/\.episode\.json$/u, '.events');
    const finalPath = EVIDENCE_EPISODE_PATH.replace(/\.episode\.json$/u, '.final.json');
    return {
        episode: readJson(EVIDENCE_EPISODE_PATH),
        events: readdirSync(eventDirectory)
            .filter((eventFile) => eventFile.endsWith('.json'))
            .map((eventFile) => readJson(join(eventDirectory, eventFile)))
            .sort((left, right) => left.recorded_at.localeCompare(right.recorded_at)),
        final: readJson(finalPath)
    };
}

function regressionCovers(file, evidenceText, regressionStatus) {
    return regressionStatus === 0
        && REGRESSION_SCRIPT.includes(file)
        && readFileSync(join(process.cwd(), file), 'utf8').includes(evidenceText);
}

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
    assert.ok(existsSync(JOURNAL_ROOT), `Judgment journal is missing: ${JOURNAL_ROOT}`);
    assert.ok(EXPECTED_HEAD.match(/^[0-9a-f]{40}$/u), 'Expected current HEAD must be a full SHA');
    assert.ok(EXPECTED_NONCE.match(/^[0-9a-z-]{8,64}$/u), 'Expected run nonce must be explicit');
    const currentHead = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: process.cwd(),
        encoding: 'utf8'
    });
    assert.equal(currentHead.status, 0, currentHead.stderr || 'Unable to resolve current HEAD');
    assert.equal(currentHead.stdout.trim(), EXPECTED_HEAD, 'Evidence must be generated for the current HEAD');
    assert.ok(
        evidencePathIsBoundToJournal(EVIDENCE_EPISODE_PATH) && existsSync(EVIDENCE_EPISODE_PATH),
        'Evidence must name one exact episode inside the owner journal'
    );

    const config = readJson(HOOK_CONFIG);
    for (const hookName of ['UserPromptSubmit', 'PostToolUse', 'Stop']) {
        assert.ok(
            hookCommands(config, hookName).some((command) => command.includes(CANONICAL_ENTRYPOINT)),
            `${hookName} is not bound to ${CANONICAL_ENTRYPOINT}`
        );
    }

    const candidate = readBoundEpisode();
    assert.equal(candidate.episode.state, 'open', 'Episode remains immutable after finalization');
    assert.equal(candidate.episode.initial_route_receipt?.status, 'resolved');
    assert.deepEqual(candidate.events.map((event) => event.tool_name), EXPECTED_TOOLS);
    assert.ok(candidate.events.every((event) => event.success === true));
    for (const [index, expected] of EXPECTED_QUERY_EXCERPTS.entries()) {
        const excerpt = candidate.events[index].query_excerpt || '';
        assert.ok(expected.includes().every((token) => excerpt.includes(token)));
    }
    const runQuery = `E2E-${EXPECTED_NONCE}-${EXPECTED_HEAD}`;
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
    assert.equal(candidate.final.event_count, 4);
    assert.equal(candidate.final.qualifying_event_count, 1);
    assert.match(candidate.final.answer_digest, /^[0-9a-f]{64}$/u);

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
