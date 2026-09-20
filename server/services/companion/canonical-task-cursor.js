export function decodeCanonicalTaskCursor(cursor) {
    if (!cursor) return 0;
    try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (value?.v !== 1 || !Number.isInteger(value.offset) || value.offset < 0) throw new Error();
        return value.offset;
    } catch {
        const error = new Error('Invalid cursor');
        error.code = 'validation_failed';
        error.status = 422;
        error.fieldErrors = { cursor: ['invalid_cursor'] };
        throw error;
    }
}
