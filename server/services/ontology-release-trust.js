const SHA256_DIGEST = /^[a-f0-9]{64}$/;
const RECEIPT_FIELDS = ['receipt_path', 'receipt_digest_algorithm', 'receipt_digest'];

export function hasReceiptMetadata(entry = {}) {
    return RECEIPT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(entry, field));
}

export function hasPublishedReceipt(entry = {}) {
    return typeof entry.receipt_path === 'string'
        && entry.receipt_path.trim().length > 0
        && entry.receipt_digest_algorithm === 'sha256'
        && typeof entry.receipt_digest === 'string'
        && SHA256_DIGEST.test(entry.receipt_digest);
}
