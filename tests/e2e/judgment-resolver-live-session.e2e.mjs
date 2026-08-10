import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
const HOOK_CONFIG = join(CODEX_HOME, 'hooks.json');
const JOURNAL_ROOT = join(CODEX_HOME, 'var', 'judgment-resolver');
const CANONICAL_ENTRYPOINT = 'scripts/codex-hooks/judgment-resolver-entry.sh';
const MAX_EVIDENCE_AGE_MS = 60 * 60 * 1000;

const EXPECTED_SEQUENCE = [
    {
        tool_name: 'mcp__brainbase__brainbase_knowledge_resolve',
        query_excerpt: 'Judgment Resolverの現行アーキテクチャ契約とデプロイ正本を確認する'
    },
    { tool_name: 'mcp__brainbase__search', query_excerpt: 'Judgment Resolver' },
    { tool_name: 'mcp__brainbase__search', query_excerpt: '判断' },
    { tool_name: 'mcp__brainbase__get_entity', query_excerpt: 'glossary_term' }
];

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function hookCommands(config, hookName) {
    return (config.hooks?.[hookName] || [])
        .flatMap((group) => group.hooks || [])
        .map((hook) => hook.command || '');
}

function matchesExpectedSequence(events) {
    if (events.length !== EXPECTED_SEQUENCE.length) return false;
    return EXPECTED_SEQUENCE.every((expected, index) => {
        const actualQuery = events[index].query_excerpt || '';
        const queryMatches = actualQuery.endsWith('…')
            ? expected.query_excerpt.startsWith(actualQuery.slice(0, -1))
            : actualQuery === expected.query_excerpt;
        return events[index].tool_name === expected.tool_name
            && queryMatches
            && events[index].success === true;
    });
}

function findFreshAdaptiveEpisode() {
    const now = Date.now();
    const candidates = [];
    for (const sessionDirectory of readdirSync(JOURNAL_ROOT, { withFileTypes: true })) {
        if (!sessionDirectory.isDirectory()) continue;
        const sessionPath = join(JOURNAL_ROOT, sessionDirectory.name);
        for (const file of readdirSync(sessionPath)) {
            if (!file.endsWith('.episode.json')) continue;
            const turnPrefix = file.slice(0, -'.episode.json'.length);
            const eventDirectory = join(sessionPath, `${turnPrefix}.events`);
            if (!existsSync(eventDirectory)) continue;
            const events = readdirSync(eventDirectory)
                .filter((eventFile) => eventFile.endsWith('.json'))
                .map((eventFile) => readJson(join(eventDirectory, eventFile)))
                .sort((left, right) => left.recorded_at.localeCompare(right.recorded_at));
            if (!matchesExpectedSequence(events)) continue;
            const newestEventAt = Date.parse(events.at(-1).recorded_at);
            if (!Number.isFinite(newestEventAt) || now - newestEventAt > MAX_EVIDENCE_AGE_MS) continue;
            candidates.push({
                episode: readJson(join(sessionPath, file)),
                events,
                newestEventAt
            });
        }
    }
    return candidates.sort((left, right) => right.newestEventAt - left.newestEventAt)[0] || null;
}

test('global hookが実turnの結果依存Brainbase検索を1つのepisodeへ記録する', () => {
    assert.ok(existsSync(HOOK_CONFIG), `Codex global hook config is missing: ${HOOK_CONFIG}`);
    assert.ok(existsSync(JOURNAL_ROOT), `Judgment journal is missing: ${JOURNAL_ROOT}`);

    const config = readJson(HOOK_CONFIG);
    for (const hookName of ['UserPromptSubmit', 'PostToolUse', 'Stop']) {
        assert.ok(
            hookCommands(config, hookName).some((command) => command.includes(CANONICAL_ENTRYPOINT)),
            `${hookName} is not bound to ${CANONICAL_ENTRYPOINT}`
        );
    }

    const candidate = findFreshAdaptiveEpisode();
    assert.ok(
        candidate,
        'No fresh episode contains the expected route -> exact search -> broadened search -> entity retrieval sequence'
    );
    assert.equal(candidate.episode.state, 'open');
    assert.equal(candidate.episode.initial_route_receipt?.status, 'resolved');
    assert.equal(candidate.events.length, 4);
});
