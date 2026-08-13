// @ts-check
/**
 * HMAC validation middleware for /api/candidate-store/* endpoints.
 *
 * Source-specific HMAC secret loaded from env:
 *   CANDIDATE_STORE_HMAC_<SOURCE_UPPER>  (e.g. CANDIDATE_STORE_HMAC_SALESTAILOR)
 *
 * Request headers:
 *   x-cs-source     : source_system identifier (e.g. "salestailor_ops_refactor")
 *   x-cs-signature  : hex-encoded HMAC-SHA256 over raw request body
 *
 * Story: story-candidate-store-cross-repo-write
 */

import { createHmac, timingSafeEqual } from 'crypto';

import { logger } from '../utils/logger.js';

function envKeyFor(source) {
    return `CANDIDATE_STORE_HMAC_${String(source || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
}

/**
 * Express JSON-parser verify callback for the exact Candidate Store ingest path.
 * The application-level parser runs before the mounted router in production, so
 * it must preserve the original bytes before the request stream is consumed.
 */
export function captureCandidateStoreRawBody(req, _res, buf) {
    const requestPath = String(req.originalUrl || req.url || req.path || '').split('?')[0];
    if (req.method === 'POST' && requestPath === '/api/candidate-store/raw-ledger') {
        req.rawBody = Buffer.from(buf);
    }
}

/**
 * Express middleware. Reads `req.rawBody` (set by upstream JSON parser) and
 * validates HMAC signature against per-source secret.
 */
export function createCandidateStoreHmacMiddleware(options = {}) {
    const allowedSources = new Set(options.allowedSources || null);
    const allowAny = !options.allowedSources;

    return function candidateStoreHmacMiddleware(req, res, next) {
        const source = req.get('x-cs-source');
        const signature = req.get('x-cs-signature');

        if (!source || !signature) {
            return res.status(401).json({ error: 'missing x-cs-source or x-cs-signature header' });
        }

        if (!allowAny && !allowedSources.has(source)) {
            logger.warn('candidate-store ingestion rejected: source not in allowlist', { source });
            return res.status(403).json({ error: `source not allowed: ${source}` });
        }

        const secret = process.env[envKeyFor(source)];
        if (!secret) {
            logger.warn('candidate-store HMAC secret missing for source', { source, envKey: envKeyFor(source) });
            return res.status(403).json({ error: `no HMAC secret configured for source: ${source}` });
        }

        const rawBody = req.rawBody;
        if (!rawBody || (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody))) {
            return res.status(400).json({ error: 'request body required for HMAC verification' });
        }

        const computed = createHmac('sha256', secret)
            .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
            .digest('hex');

        const sigBuf = Buffer.from(String(signature), 'utf8');
        const computedBuf = Buffer.from(computed, 'utf8');

        if (sigBuf.length !== computedBuf.length || !timingSafeEqual(sigBuf, computedBuf)) {
            logger.warn('candidate-store HMAC mismatch', { source });
            return res.status(401).json({ error: 'invalid HMAC signature' });
        }

        req.candidateStoreSource = source;
        // HMAC identifies the calling service, not the Personal Vault owner.
        // The following personal access guard therefore requires explicit
        // proxy person/org headers and records the service as the actor.
        req.authSource = 'internal';
        req.access = {
            ...(req.access || {}),
            personId: `service:${source}`,
            role: 'member',
            projectCodes: [],
            clearance: ['internal']
        };
        next();
    };
}

/**
 * Helper for callers (mana / salestailor adapters): compute the signature
 * value to send in `x-cs-signature` header.
 */
export function computeCandidateStoreSignature(source, rawBody) {
    const secret = process.env[envKeyFor(source)];
    if (!secret) {
        throw new Error(`no HMAC secret configured for source: ${source}`);
    }
    return createHmac('sha256', secret)
        .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
        .digest('hex');
}
