import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';

import {
    JudgmentResolutionError,
    canonicalJson,
    computeRequestDigest
} from '../services/judgment-resolution-service.js';
import { resolveCanonicalTenantIdentity } from '../lib/canonical-tenant-identity.js';

const ADAPTER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ADAPTER_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEX_64 = /^[a-f0-9]{64}$/;

function header(req, name) {
    const value = req.get(name);
    return typeof value === 'string' ? value : '';
}

function nonNegativeInteger(value, fallback, name) {
    const selected = value === undefined || value === null || value === '' ? fallback : Number(value);
    if (!Number.isInteger(selected) || selected < 0) {
        throw new JudgmentResolutionError('judgment_manifest_invalid', `${name} must be a non-negative integer`, 500);
    }
    return selected;
}

function untrusted(message) {
    throw new JudgmentResolutionError('judgment_host_binding_untrusted', message, 403);
}

export function verifyJudgmentHostBinding({
    req,
    service,
    bindingSecret,
    now = () => new Date(),
    maxAgeMs = process.env.BRAINBASE_JUDGMENT_BINDING_MAX_AGE_MS,
    maxFutureSkewMs = process.env.BRAINBASE_JUDGMENT_BINDING_MAX_FUTURE_SKEW_MS
}) {
    if (typeof bindingSecret !== 'string' || !bindingSecret) {
        throw new JudgmentResolutionError('judgment_manifest_invalid', 'BRAINBASE_JUDGMENT_BINDING_SECRET is required', 500);
    }
    const adapterId = header(req, 'x-brainbase-judgment-adapter');
    const adapterVersion = header(req, 'x-brainbase-judgment-version');
    const issuedAt = header(req, 'x-brainbase-judgment-issued-at');
    const claimedDigest = header(req, 'x-brainbase-judgment-request-digest');
    const signature = header(req, 'x-brainbase-judgment-signature');
    if (!ADAPTER_ID.test(adapterId) || !ADAPTER_VERSION.test(adapterVersion)) untrusted('host adapter binding is malformed');
    if (!service.hasHostBinding(adapterId, adapterVersion)) untrusted('host adapter binding is not registered');
    if (!UTC_MILLISECONDS.test(issuedAt)) untrusted('host binding timestamp is malformed');
    const issued = new Date(issuedAt);
    if (Number.isNaN(issued.valueOf()) || issued.toISOString() !== issuedAt) untrusted('host binding timestamp is invalid');
    const turnId = req.body?.turn_id;
    if (typeof turnId !== 'string' || !turnId || turnId.length > 128 || /[\u0000-\u001f\u007f]/u.test(turnId)) untrusted('host binding turn id is invalid');
    const requestDigest = computeRequestDigest(req.body);
    if (!HEX_64.test(claimedDigest) || claimedDigest !== requestDigest) untrusted('host binding request digest does not match');
    if (!HEX_64.test(signature)) untrusted('host binding signature is malformed');

    const ageLimit = nonNegativeInteger(maxAgeMs, 300000, 'BRAINBASE_JUDGMENT_BINDING_MAX_AGE_MS');
    const futureLimit = nonNegativeInteger(maxFutureSkewMs, 30000, 'BRAINBASE_JUDGMENT_BINDING_MAX_FUTURE_SKEW_MS');
    const delta = now().valueOf() - issued.valueOf();
    if (delta > ageLimit) untrusted('host binding is stale');
    if (-delta > futureLimit) untrusted('host binding is too far in the future');

    const signedPayload = canonicalJson([
        'brainbase-judgment-binding-v1', adapterId, adapterVersion, turnId, issuedAt, requestDigest
    ]);
    const expected = createHmac('sha256', bindingSecret).update(signedPayload).digest();
    const actual = Buffer.from(signature, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) untrusted('host binding signature does not match');
    return { adapter_id: adapterId, adapter_version: adapterVersion, status: 'managed', enforcement_level: 'host_contract' };
}

function sendError(res, error) {
    if (error instanceof JudgmentResolutionError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
    }
    if (error instanceof TypeError) {
        res.status(400).json({ error: { code: 'judgment_resolution_input_invalid', message: error.message } });
        return;
    }
    res.status(500).json({
        error: {
            code: 'judgment_resolution_failed',
            message: error instanceof Error ? error.message : String(error)
        }
    });
}

export function createJudgmentResolutionRouter({
    service,
    bindingSecret = process.env.BRAINBASE_JUDGMENT_BINDING_SECRET,
    now,
    maxAgeMs,
    maxFutureSkewMs,
    receiptWriter
}) {
    const router = Router();
    router.post('/resolve', async (req, res) => {
        try {
            const hostBinding = verifyJudgmentHostBinding({
                req, service, bindingSecret, now, maxAgeMs, maxFutureSkewMs
            });
            const access = req.access || {};
            const receipt = service.resolve(req.body, { access, hostBinding });
            const tenant = resolveCanonicalTenantIdentity(access);
            const mayPersist = receiptWriter
                && tenant.state === 'confirmed'
                && typeof access.personId === 'string' && access.personId.trim()
                && typeof receipt?.project_code === 'string'
                && Array.isArray(access.projectCodes)
                && access.projectCodes.includes(receipt.project_code);
            if (mayPersist) {
                try {
                    if (typeof receiptWriter.record !== 'function') throw new Error('receipt writer is invalid');
                    await receiptWriter.record(receipt, access);
                } catch {
                    throw new JudgmentResolutionError(
                        'judgment_receipt_persistence_unavailable', 'Judgment receipt persistence is unavailable', 503
                    );
                }
            }
            res.json(receipt);
        } catch (error) {
            sendError(res, error);
        }
    });
    return router;
}
