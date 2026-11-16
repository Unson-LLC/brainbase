import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  JudgmentResolutionError,
  canonicalJson,
  computeRequestDigest,
  sha256Hex
} from '../src/judgment-resolution-contract.js';
import { canonicalJson as hostCanonicalJson } from '../src/judgment-host.js';

// The values below are the repository-shared golden vectors that the
// Brainbase judgment resolver (brainbase-unson config/judgment-runtime-golden-vectors.json)
// pins. The Host and the resolver must produce the same bytes and digests.
const GOLDEN = {
  canonical_json: {
    input: { z: [3, { 'あ': '値', a: true }], a: null },
    expected_bytes: '{"a":null,"z":[3,{"a":true,"あ":"値"}]}',
    expected_sha256: '720c426a8d984447034a85227cf9eb25e3fed20b27af6c41c246c2be8edac67f'
  },
  binding: {
    request: { request: 'この文章の意味を説明して', turn_id: 'host-turn-mcp', project_code: 'brainbase' },
    secret: 'secret',
    adapter_id: 'brainbase-mcp',
    adapter_version: '1',
    issued_at: '2026-08-07T00:00:00.000Z',
    expected_request_digest: '376e1546ad94575ca592ea7768c6626163158ba17b56b192f041af6a0864643f',
    expected_payload_bytes: '["brainbase-judgment-binding-v1","brainbase-mcp","1","host-turn-mcp","2026-08-07T00:00:00.000Z","376e1546ad94575ca592ea7768c6626163158ba17b56b192f041af6a0864643f"]',
    expected_signature: '804663d1d09ade9273ff7c3aafcd84f53b9dd4146b6af1cf1de043865affb6ca'
  }
} as const;

describe('judgment resolution contract', () => {
  it('pins the shared golden canonical JSON bytes and digests', () => {
    const canonical = canonicalJson(GOLDEN.canonical_json.input);
    expect(canonical).toBe(GOLDEN.canonical_json.expected_bytes);
    expect(sha256Hex(canonical)).toBe(GOLDEN.canonical_json.expected_sha256);
  });

  it('pins the shared golden request digest and host binding payload', () => {
    const { binding } = GOLDEN;
    expect(computeRequestDigest(binding.request)).toBe(binding.expected_request_digest);
    const payload = canonicalJson([
      'brainbase-judgment-binding-v1', binding.adapter_id, binding.adapter_version,
      binding.request.turn_id, binding.issued_at, binding.expected_request_digest
    ]);
    expect(payload).toBe(binding.expected_payload_bytes);
    expect(createHmac('sha256', binding.secret).update(payload).digest('hex')).toBe(binding.expected_signature);
  });

  it('orders keys by code point, not by locale or UTF-16 unit', () => {
    // U+1F600 (surrogate pair) sorts after U+FF5E by code point but before it by UTF-16 unit.
    expect(canonicalJson({ '\u{1F600}': 1, '～': 2, b: 3, a: 4 }))
      .toBe('{"a":4,"b":3,"～":2,"\u{1F600}":1}');
  });

  it('rejects values that have no canonical form', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
    expect(() => canonicalJson(1n)).toThrow(TypeError);
  });

  it('carries code, status, and a stable JSON form on the error', () => {
    const error = new JudgmentResolutionError('judgment_host_binding_untrusted', 'untrusted', 403);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(JudgmentResolutionError);
    expect(error.name).toBe('JudgmentResolutionError');
    expect(error.toJSON()).toEqual({
      name: 'JudgmentResolutionError', code: 'judgment_host_binding_untrusted', status: 403, message: 'untrusted'
    });
    expect(new JudgmentResolutionError('judgment_resolution_input_invalid', 'bad').status).toBe(400);
  });

  it('is the same canonicalJson the judgment Host uses', () => {
    expect(hostCanonicalJson).toBe(canonicalJson);
  });
});
