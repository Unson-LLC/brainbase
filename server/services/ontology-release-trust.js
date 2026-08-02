const SHA256_DIGEST = /^[a-f0-9]{64}$/;

export function hasPublishedReceipt(entry = {}) {
    return typeof entry.receipt_path === 'string'
        && entry.receipt_path.trim().length > 0
        && entry.receipt_digest_algorithm === 'sha256'
        && typeof entry.receipt_digest === 'string'
        && SHA256_DIGEST.test(entry.receipt_digest);
}
