import sodium from 'libsodium-wrappers';

let initialized = false;

/**
 * Ensure libsodium is initialized. Returns the sodium instance.
 * Safe to call multiple times — only initializes once.
 */
export async function ensureSodium() {
  if (!initialized) {
    await sodium.ready;
    initialized = true;
  }
  return sodium;
}
