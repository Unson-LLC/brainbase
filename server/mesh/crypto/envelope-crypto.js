import sodium from 'libsodium-wrappers';

/**
 * Encrypt a payload for a recipient using their X25519 public key (sealed box).
 * @param {string} payload - Plaintext payload to encrypt.
 * @param {string} recipientBoxPub - Recipient's X25519 public key as base64.
 * @returns {Promise<string>} Encrypted bytes as base64.
 */
export async function seal(payload, recipientBoxPub) {
  await sodium.ready;

  const pubKey = sodium.from_base64(recipientBoxPub);
  const message = sodium.from_string(payload);
  const encrypted = sodium.crypto_box_seal(message, pubKey);

  return sodium.to_base64(encrypted);
}

/**
 * Decrypt a sealed-box message using our X25519 keypair.
 * @param {string} encryptedBase64 - Encrypted data as base64.
 * @param {{ publicKey: Uint8Array, privateKey: Uint8Array }} boxKeyPair - Our X25519 keypair.
 * @returns {Promise<string>} Decrypted payload string.
 */
export async function unseal(encryptedBase64, boxKeyPair) {
  await sodium.ready;

  const encrypted = sodium.from_base64(encryptedBase64);
  const decrypted = sodium.crypto_box_seal_open(encrypted, boxKeyPair.publicKey, boxKeyPair.privateKey);

  return sodium.to_string(decrypted);
}

/**
 * Sign a message using an Ed25519 signing keypair.
 * @param {string} message - Message to sign.
 * @param {{ privateKey: Uint8Array }} signKeyPair - Ed25519 signing keypair (needs privateKey).
 * @returns {string} Detached signature as base64.
 */
export function sign(message, signKeyPair) {
  const messageBytes = sodium.from_string(message);
  const signature = sodium.crypto_sign_detached(messageBytes, signKeyPair.privateKey);

  return sodium.to_base64(signature);
}

/**
 * Verify a detached Ed25519 signature.
 * @param {string} message - Original message.
 * @param {string} signatureBase64 - Detached signature as base64.
 * @param {string} signPubBase64 - Signer's Ed25519 public key as base64.
 * @returns {boolean} True if the signature is valid.
 */
export function verify(message, signatureBase64, signPubBase64) {
  try {
    const messageBytes = sodium.from_string(message);
    const signature = sodium.from_base64(signatureBase64);
    const pubKey = sodium.from_base64(signPubBase64);

    return sodium.crypto_sign_verify_detached(signature, messageBytes, pubKey);
  } catch {
    return false;
  }
}
