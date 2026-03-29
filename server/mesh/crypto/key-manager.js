import { ensureSodium } from './sodium-init.js';
import { writeFile, readFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const KEYPAIR_DIR = join(homedir(), '.brainbase', 'mesh');
const KEYPAIR_PATH = join(KEYPAIR_DIR, 'node-keypair.json');

/**
 * Generate Ed25519 (signing) + X25519 (encryption) keypairs.
 * @returns {{ signKeyPair: object, boxKeyPair: object }}
 */
export async function generateKeyPair() {
  const sodium = await ensureSodium();

  const signKeyPair = sodium.crypto_sign_keypair();
  const boxKeyPair = sodium.crypto_box_keypair();

  return { signKeyPair, boxKeyPair };
}

/**
 * Save a keypair to ~/.brainbase/mesh/node-keypair.json with mode 0600.
 * @param {{ signKeyPair: object, boxKeyPair: object }} keyPair
 */
export async function saveKeyPair(keyPair) {
  const sodium = await ensureSodium();
  await mkdir(KEYPAIR_DIR, { recursive: true });

  const serialized = {
    signKeyPair: {
      publicKey: sodium.to_base64(keyPair.signKeyPair.publicKey),
      privateKey: sodium.to_base64(keyPair.signKeyPair.privateKey),
      keyType: keyPair.signKeyPair.keyType,
    },
    boxKeyPair: {
      publicKey: sodium.to_base64(keyPair.boxKeyPair.publicKey),
      privateKey: sodium.to_base64(keyPair.boxKeyPair.privateKey),
      keyType: keyPair.boxKeyPair.keyType,
    },
  };

  await writeFile(KEYPAIR_PATH, JSON.stringify(serialized, null, 2), { mode: 0o600 });
}

/**
 * Load a previously saved keypair.
 * @returns {{ signKeyPair: object, boxKeyPair: object } | null}
 */
export async function loadKeyPair() {
  const sodium = await ensureSodium();

  if (!existsSync(KEYPAIR_PATH)) {
    return null;
  }

  try {
    const raw = await readFile(KEYPAIR_PATH, 'utf-8');
    const data = JSON.parse(raw);

    return {
      signKeyPair: {
        publicKey: sodium.from_base64(data.signKeyPair.publicKey),
        privateKey: sodium.from_base64(data.signKeyPair.privateKey),
        keyType: data.signKeyPair.keyType,
      },
      boxKeyPair: {
        publicKey: sodium.from_base64(data.boxKeyPair.publicKey),
        privateKey: sodium.from_base64(data.boxKeyPair.privateKey),
        keyType: data.boxKeyPair.keyType,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Export public keys as base64 strings.
 * @param {{ signKeyPair: object, boxKeyPair: object }} keyPair
 * @returns {{ signPub: string, boxPub: string }}
 */
export async function exportPublicKeys(keyPair) {
  const sodium = await ensureSodium();
  return {
    signPub: sodium.to_base64(keyPair.signKeyPair.publicKey),
    boxPub: sodium.to_base64(keyPair.boxKeyPair.publicKey),
  };
}
