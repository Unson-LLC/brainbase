import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type JudgmentStopState = {
  schema_version: 'brainbase-stop-state-v1';
  status: 'completed' | 'pending' | 'waiting_human';
  pending_safe_work: boolean;
  runtime_reason_code: string | null;
};

export const judgmentStateTools: Tool[] = [{
  name: 'brainbase_judgment_state_record',
  description: 'Record the current judgment episode execution state out of band. Call exactly once as the final tool call for runtime 2.4 implementation or operation turns; never copy this state into the user-facing answer.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['completed', 'pending', 'waiting_human'] },
      pending_safe_work: { type: 'boolean' },
      runtime_reason_code: { type: ['string', 'null'] },
    },
    required: ['status', 'pending_safe_work', 'runtime_reason_code'],
    additionalProperties: false,
  },
}];

function isValidState(args: Record<string, unknown>): boolean {
  const keys = Object.keys(args).sort();
  return keys.join(',') === ['pending_safe_work', 'runtime_reason_code', 'status'].join(',')
    && ['completed', 'pending', 'waiting_human'].includes(String(args.status))
    && typeof args.pending_safe_work === 'boolean'
    && (args.runtime_reason_code === null || typeof args.runtime_reason_code === 'string');
}

export async function handleJudgmentStateToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: 'ok'; data: JudgmentStopState } | { status: 'error'; error: { code: string; message: string } } | null> {
  if (name !== 'brainbase_judgment_state_record') return null;
  if (!isValidState(args)) {
    return { status: 'error', error: { code: 'judgment_state_invalid', message: 'Judgment state does not match brainbase-stop-state-v1' } };
  }
  return {
    status: 'ok',
    data: {
      schema_version: 'brainbase-stop-state-v1',
      status: args.status as JudgmentStopState['status'],
      pending_safe_work: args.pending_safe_work as boolean,
      runtime_reason_code: args.runtime_reason_code as string | null,
    },
  };
}
