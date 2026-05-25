import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const storyPath = 'docs/stories/story-codex-appserver-session-state-ssot.md';
const architecturePath = 'docs/architecture/codex-appserver-session-state-ssot-architecture.md';
const specPath = 'docs/specs/codex-appserver-session-state-ssot-spec.md';
const capabilityPath = 'docs/brainbase-capabilities/capabilities/codex.app-server.yml';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

test.describe('story-codex-appserver-session-state-ssot contract', () => {
  test('ac:1 defines a named durable App Server thread owner', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    expect(story).toContain('named field with a documented owner');
    expect(spec).toContain('Codex App Server thread identity must have a named durable owner in Brainbase session state');
  });

  test('ac:2 keeps active App Server turns in existing activity state', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    expect(story).toContain('existing activity state without inventing a browser-only SSOT');
    expect(spec).toContain('Active App Server turn identity must continue to flow through existing `hookStatus` activity state');
  });

  test('ac:3 requires Codex restore metadata without changing Claude Code restore', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    expect(story).toContain('Runtime restore for `engine: codex` can choose App Server resume metadata');
    expect(architecture).toContain('use App Server metadata only for Codex restore/reconcile decisions');
  });

  test('ac:4 prevents Claude Code sessions from receiving App Server metadata', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    expect(story).toContain('Claude Code sessions cannot receive Codex App Server thread, turn, or resume metadata');
    expect(architecture).toContain('Claude Code sessions must not store or consume Codex App Server metadata');
    expect(spec).toContain('Claude Code sessions must not receive App Server metadata and must keep existing restore semantics');
  });

  test('ac:5 requires explicit fallback for missing or stale metadata', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    expect(story).toContain('explicit fallback or recovery state');
    expect(architecture).toContain('Stale or missing App Server metadata must surface as a recoverable state or explicit fallback');
    expect(spec).toContain('Missing or stale App Server metadata must produce an explicit recovery/fallback outcome');
  });

  test('ac:6 keeps event item persistence out of scope unless a ledger is defined', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    expect(story).toContain('App Server event item persistence is either explicitly out of scope');
    expect(architecture).toContain('keep full App Server item/event persistence out of scope unless a ledger contract is created');
    expect(spec).toContain('Full App Server event item persistence must remain out of scope unless this story adds a ledger contract');
  });

  test('ac:7 keeps terminal transport unchanged unless a separate story approves it', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    expect(story).toContain('Existing xterm/tmux terminal transport files remain unchanged');
    expect(architecture).toContain('Existing terminal transport files must remain unchanged unless a terminal transport story is created');
    expect(spec).toContain('Terminal/xterm transport must remain unchanged');
  });

  test('ac:8 updates Capability Map with the new Codex-only boundary', async () => {
    const capability = await read(capabilityPath);
    expect(capability).toContain('story-codex-appserver-session-state-ssot');
    expect(capability).toContain('App Server session-state metadata is a Codex-only boundary');
    expect(capability).toContain('Claude Code sessions must not store or consume it');
  });

  test('ac:9 requires future tests for Codex metadata persistence and Claude non-mutation', async () => {
    const story = await read(storyPath);
    const architecture = await read(architecturePath);
    const spec = await read(specPath);
    expect(story).toContain('Unit or contract tests cover Codex session metadata persistence');
    expect(architecture).toContain('Unit or contract tests proving Claude Code sessions are not mutated');
    expect(spec).toContain('Claude Code non-mutation');
  });
});
