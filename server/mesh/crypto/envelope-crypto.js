import { ensureSodium } from './sodium-init.js';

/**
 * Encrypt a payload for a recipient using their X25519 public key (sealed box).
 */
export async function seal(payload, recipientBoxPub) {
  const sodium = await ensureSodium();
  const pubKey = sodium.from_base64(recipientBoxPub);
  const message = sodium.from_string(payload);
  const encrypted = sodium.crypto_box_seal(message, pubKey);
  return sodium.to_base64(encrypted);
}

/**
 * Decrypt a sealed-box message using our X25519 keypair.
 */
export async function unseal(encryptedBase64, boxKeyPair) {
  const sodium = await ensureSodium();
  const encrypted = sodium.from_base64(encryptedBase64);
  const decrypted = sodium.crypto_box_seal_open(encrypted, boxKeyPair.publicKey, boxKeyPair.privateKey);
  return sodium.to_string(decrypted);
}

/**
 * Sign a message using an Ed25519 signing keypair.
 */
export async function sign(message, signKeyPair) {
  const sodium = await ensureSodium();
  const messageBytes = sodium.from_string(message);
  const signature = sodium.crypto_sign_detached(messageBytes, signKeyPair.privateKey);
  return sodium.to_base64(signature);
}

/**
 * Verify a detached Ed25519 signature.
 */
export async function verify(message, signatureBase64, signPubBase64) {
  try {
    const sodium = await ensureSodium();
    const messageBytes = sodium.from_string(message);
    const signature = sodium.from_base64(signatureBase64);
    const pubKey = sodium.from_base64(signPubBase64);
    return sodium.crypto_sign_verify_detached(signature, messageBytes, pubKey);
  } catch {
    return false;
  }
}
