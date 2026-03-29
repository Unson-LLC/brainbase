// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import sodium from 'libsodium-wrappers';
import { seal, unseal, sign, verify } from '../../../server/mesh/crypto/envelope-crypto.js';
import { generateKeyPair, exportPublicKeys } from '../../../server/mesh/crypto/key-manager.js';

describe('envelope-crypto', () => {
  let senderKp;
  let recipientKp;
  let recipientPub;

  beforeAll(async () => {
    await sodium.ready;
    senderKp = await generateKeyPair();
    recipientKp = await generateKeyPair();
    recipientPub = await exportPublicKeys(recipientKp);
  });

  describe('seal / unseal round-trip', () => {
    it('encrypts and decrypts plaintext correctly', async () => {
      const plaintext = 'Hello, mesh world!';

      const encrypted = await seal(plaintext, recipientPub.boxPub);
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(plaintext);

      const decrypted = await unseal(encrypted, recipientKp.boxKeyPair);
      expect(decrypted).toBe(plaintext);
    });

    it('handles JSON payloads', async () => {
      const payload = JSON.stringify({ question: 'What is your status?', scope: 'general' });

      const encrypted = await seal(payload, recipientPub.boxPub);
      const decrypted = await unseal(encrypted, recipientKp.boxKeyPair);

      expect(JSON.parse(decrypted)).toEqual({ question: 'What is your status?', scope: 'general' });
    });
  });

  describe('sign', () => {
    it('produces a base64 string', async () => {
      const message = 'test message to sign';
      const signature = await sign(message, senderKp.signKeyPair);

      expect(typeof signature).toBe('string');
      const sigBytes = sodium.from_base64(signature);
      expect(sigBytes.length).toBe(64);
    });
  });

  describe('verify', () => {
    it('returns true for a valid signature', async () => {
      const message = 'authentic message';
      const senderPub = await exportPublicKeys(senderKp);
      const signature = await sign(message, senderKp.signKeyPair);

      const result = await verify(message, signature, senderPub.signPub);
      expect(result).toBe(true);
    });

    it('returns false for a tampered message', async () => {
      const message = 'original message';
      const senderPub = await exportPublicKeys(senderKp);
      const signature = await sign(message, senderKp.signKeyPair);

      const result = await verify('tampered message', signature, senderPub.signPub);
      expect(result).toBe(false);
    });
  });
});
