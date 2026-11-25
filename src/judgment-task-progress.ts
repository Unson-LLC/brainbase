import { z } from 'zod';
import type { JudgmentToolEvent } from './judgment-host.js';

const reference = z.string().trim().min(1).max(512);
export const taskProgressScopeSchema = z.object({
  task_ref: reference,
  criterion_ref: reference,
  contract_revision: reference
}).strict();

const evidenceIds = z.array(reference).min(1).refine((ids) => new Set(ids).size === ids.length);
export const taskProgressObservationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preparation_only'), evidence_tool_use_ids: evidenceIds }).strict(),
  z.object({ kind: z.literal('waiting') }).strict(),
  z.object({
    kind: z.literal('verified_outcome'),
    outcome: z.enum(['criterion_advanced', 'new_negative_result']),
    evidence_tool_use_ids: evidenceIds,
    verification_ref: reference
  }).strict()
]);

export interface JudgmentTaskProgressSnapshot {
  episode_digest: string;
  event_set_digest: string;
  request: string;
  events: readonly JudgmentToolEvent[];
}

/** Host configuration, never fields copied from a model's Stop payload.
 * assess owns semantic classification; verifyOutcome must independently check
 * the actual result against this task/criterion, not accept a declaration.
 * Neither callback is provided by default or invokes a paid model internally.
 */
export interface JudgmentTaskProgressAdapter {
  scope: z.infer<typeof taskProgressScopeSchema>;
  assess(snapshot: JudgmentTaskProgressSnapshot): Promise<z.infer<typeof taskProgressObservationSchema>>;
  verifyOutcome(snapshot: JudgmentTaskProgressSnapshot & {
    observation: Extract<z.infer<typeof taskProgressObservationSchema>, { kind: 'verified_outcome' }>;
  }): Promise<boolean>;
}
