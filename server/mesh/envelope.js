import crypto from 'node:crypto';

export const ENVELOPE_TYPES = {
  QUERY: 'query',
  RESPONSE: 'response',
  PING: 'ping',
  PONG: 'pong',
  PEER_JOINED: 'peer_joined',
  PEER_LEFT: 'peer_left',
};

const VALID_TYPES = new Set(Object.values(ENVELOPE_TYPES));

/**
 * Create a mesh communication envelope.
 * @param {{ from: string, to: string, type: string, payload: * }} opts
 * @returns {{ id: string, from: string, to: string, type: string, payload: *, ts: number, nonce: string }}
 */
export function createEnvelope({ from, to, type, payload }) {
  if (!from) throw new Error('Envelope requires a "from" field');
  if (!to) throw new Error('Envelope requires a "to" field');
  if (!type) throw new Error('Envelope requires a "type" field');
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Invalid envelope type: "${type}". Must be one of: ${[...VALID_TYPES].join(', ')}`);
  }

  return {
    id: crypto.randomUUID(),
    from,
    to,
    type,
    payload: payload ?? null,
    ts: Date.now(),
    nonce: crypto.randomUUID(),
  };
}

/**
 * Parse and validate a JSON string or object into an envelope.
 * @param {string | object} json - JSON string or plain object.
 * @returns {{ id: string, from: string, to: string, type: string, payload: *, ts: number, nonce: string }}
 */
export function parseEnvelope(json) {
  const envelope = typeof json === 'string' ? JSON.parse(json) : json;

  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Envelope must be a non-null object');
  }

  const required = ['id', 'from', 'to', 'type', 'ts', 'nonce'];
  for (const field of required) {
    if (envelope[field] === undefined || envelope[field] === null) {
      throw new Error(`Envelope missing required field: "${field}"`);
    }
  }

  if (!VALID_TYPES.has(envelope.type)) {
    throw new Error(`Invalid envelope type: "${envelope.type}". Must be one of: ${[...VALID_TYPES].join(', ')}`);
  }

  if (typeof envelope.ts !== 'number') {
    throw new Error('Envelope "ts" must be a number');
  }

  return {
    id: envelope.id,
    from: envelope.from,
    to: envelope.to,
    type: envelope.type,
    payload: envelope.payload ?? null,
    ts: envelope.ts,
    nonce: envelope.nonce,
  };
}
