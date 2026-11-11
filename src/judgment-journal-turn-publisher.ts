import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface JudgmentJournalTurnInput {
  sessionId: string;
  turnId: string;
  projectCode: string;
  trustedToken: string;
}

export interface JudgmentJournalTurnPublisherOptions {
  apiBaseUrl?: string;
  journalRoot: string;
  fetch?: typeof globalThis.fetch;
  /** Receives only a fixed reason code, never exception details or journal data. */
  onError?: (reason: string) => void;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** HTTP-only, best-effort publication of the host's finished canonical journal. */
export function createJudgmentJournalTurnPublisher(options: JudgmentJournalTurnPublisherOptions):
(input: JudgmentJournalTurnInput) => Promise<void> {
  const report = (reason: string) => {
    try { (options.onError ?? console.warn)(reason); } catch { /* Diagnostics must fail open too. */ }
  };
  return async (input) => {
    if (!options.apiBaseUrl || !options.journalRoot) {
      report('judgment_journal_not_configured');
      return;
    }
    if (!input.trustedToken) {
      report('judgment_journal_token_missing');
      return;
    }
    let body: Record<string, unknown>;
    try {
      const sessionRef = hash(input.sessionId);
      const prefix = join(options.journalRoot, sessionRef, hash(input.turnId));
      const read = async (path: string, optional = false): Promise<Record<string, unknown> | undefined> => {
        let text: string;
        try { text = await readFile(path, 'utf8'); } catch (error) {
          if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
          throw error;
        }
        const value: unknown = JSON.parse(text);
        if (!object(value)) throw new Error('invalid');
        return value;
      };
      const episode = (await read(`${prefix}.episode.json`))!;
      const final = (await read(`${prefix}.final.json`))!;
      const receipt = episode.initial_route_receipt;
      if (!object(receipt) || typeof receipt.resolution_id !== 'string' || !receipt.resolution_id
        || receipt.project_code !== input.projectCode
        || (receipt.turn_id !== undefined && receipt.turn_id !== input.turnId)
        || (episode.turn_id !== undefined && episode.turn_id !== input.turnId)
        || (episode.session_ref !== undefined && episode.session_ref !== sessionRef)
        || (final.turn_id !== undefined && final.turn_id !== input.turnId)
        || (final.session_ref !== undefined && final.session_ref !== sessionRef)
        || typeof final.finalized_at !== 'string'
        || !Number.isFinite(Date.parse(final.finalized_at))) throw new Error('invalid');
      let names: string[];
      try { names = await readdir(`${prefix}.events`); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        names = []; // Hosts need not create a directory for a zero-tool turn.
      }
      const rawEvents = await Promise.all(names.filter(name => name.endsWith('.json'))
        .map(async name => (await read(join(`${prefix}.events`, name)))!));
      const sequence = (event: Record<string, unknown>): number =>
        typeof event.event_sequence === 'number' ? event.event_sequence : Number(event.sequence) - 1;
      rawEvents.sort((a, b) => sequence(a) - sequence(b));
      const events = rawEvents.map((event, index) => {
        if (sequence(event) !== index || index >= 4096
          || typeof event.event_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(event.event_fingerprint)
          || typeof event.tool_use_id !== 'string' || !event.tool_use_id.trim()) throw new Error('invalid');
        return { event_sequence: index, event_fingerprint: event.event_fingerprint,
          tool_use_id: event.tool_use_id, event };
      });
      if (final.event_count !== events.length) throw new Error('invalid');
      const turnInput = await read(`${prefix}.turn-input.json`, true);
      const valueProof = await read(`${prefix}.value-proof.json`, true);
      body = {
        resolution_id: receipt.resolution_id, turn_id: input.turnId, project_code: input.projectCode,
        turn_ref: `${sessionRef}/${hash(input.turnId)}`, entrypoint: 'claude_code',
        receipt, episode, final, events,
        ...(turnInput ? { turn_input: turnInput } : {}),
        ...(valueProof ? { value_proof: valueProof } : {}), recorded_at: final.finalized_at,
      };
    } catch (error) {
      report((error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'judgment_journal_files_missing' : 'judgment_journal_files_invalid');
      return;
    }
    try {
      const response = await (options.fetch ?? globalThis.fetch)(
        `${options.apiBaseUrl.replace(/\/$/, '')}/api/organization/judgment-journal/turns`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(1000),
          headers: { Authorization: `Bearer ${input.trustedToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      if (response.status !== 200 && response.status !== 201) {
        report(response.status === 409 ? 'judgment_journal_conflict' : 'judgment_journal_http_failed');
      }
    } catch { report('judgment_journal_network_failed'); }
  };
}
