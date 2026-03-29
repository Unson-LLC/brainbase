import { describe, it, expect } from 'vitest';
import { createEnvelope, parseEnvelope, ENVELOPE_TYPES } from '../../server/mesh/envelope.js';

describe('envelope', () => {
  describe('createEnvelope', () => {
    it('returns all required fields', () => {
      const env = createEnvelope({
        from: 'node-a',
        to: 'node-b',
        type: ENVELOPE_TYPES.QUERY,
        payload: { question: 'hello?' },
      });

      expect(env).toHaveProperty('id');
      expect(env).toHaveProperty('from', 'node-a');
      expect(env).toHaveProperty('to', 'node-b');
      expect(env).toHaveProperty('type', 'query');
      expect(env).toHaveProperty('payload');
      expect(env).toHaveProperty('ts');
      expect(env).toHaveProperty('nonce');

      expect(typeof env.id).toBe('string');
      expect(typeof env.ts).toBe('number');
      expect(typeof env.nonce).toBe('string');
    });

    it('throws on invalid type', () => {
      expect(() =>
        createEnvelope({ from: 'a', to: 'b', type: 'invalid_type', payload: null })
      ).toThrow(/Invalid envelope type/);
    });

    it('throws when "from" is missing', () => {
      expect(() =>
        createEnvelope({ from: '', to: 'b', type: ENVELOPE_TYPES.PING, payload: null })
      ).toThrow(/requires a "from" field/);
    });
  });

  describe('parseEnvelope', () => {
    it('parses a valid JSON string', () => {
      const original = createEnvelope({
        from: 'node-a',
        to: 'node-b',
        type: ENVELOPE_TYPES.RESPONSE,
        payload: { data: 'ok' },
      });
      const jsonStr = JSON.stringify(original);

      const parsed = parseEnvelope(jsonStr);
      expect(parsed.id).toBe(original.id);
      expect(parsed.from).toBe('node-a');
      expect(parsed.to).toBe('node-b');
      expect(parsed.type).toBe('response');
      expect(parsed.ts).toBe(original.ts);
      expect(parsed.nonce).toBe(original.nonce);
    });

    it('throws on missing required fields', () => {
      const incomplete = JSON.stringify({ id: '123', from: 'a' });
      expect(() => parseEnvelope(incomplete)).toThrow(/missing required field/i);
    });

    it('throws on invalid type in parsed envelope', () => {
      const bad = JSON.stringify({
        id: '1',
        from: 'a',
        to: 'b',
        type: 'bad_type',
        ts: Date.now(),
        nonce: 'x',
      });
      expect(() => parseEnvelope(bad)).toThrow(/Invalid envelope type/);
    });
  });
});
