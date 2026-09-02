import crypto from 'node:crypto';
import fs from 'fs';
import { getAuth, getConfig } from './config.js';

function value(args, flag) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
}

function assertArgs(args, { positionals = 0, flags = [] }) {
    const allowedFlags = new Set(flags);
    let positionalCount = 0;
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument.startsWith('--')) {
            if (!allowedFlags.has(argument)) throw new Error(`Unsupported option: ${argument}`);
            if (args[index + 1] === undefined || args[index + 1].startsWith('--')) {
                throw new Error(`${argument} requires a value`);
            }
            index += 1;
            continue;
        }
        positionalCount += 1;
    }
    if (positionalCount !== positionals) throw new Error(`Expected ${positionals} positional argument(s)`);
}

function manifest(args) {
    const file = value(args, '--manifest');
    if (!file) throw new Error('--manifest <file> is required');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function authHeaders(auth) {
    if (auth?.token) return { Authorization: `Bearer ${auth.token}` };
    if (auth?.mode === 'insecure_header') {
        return {
            'x-brainbase-role': auth.role,
            'x-brainbase-projects': (auth.projects || []).join(','),
            'x-brainbase-clearance': (auth.clearance || []).join(',')
        };
    }
    throw new Error('Run brainbase auth login first');
}

async function request(path, { method = 'GET', body, idempotencyKey } = {}) {
    const auth = getAuth();
    const serverUrl = auth?.server_url || getConfig().server_url;
    const headers = authHeaders(auth);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const sessionId = `project-provisioning-${crypto.randomUUID()}`;
        const csrfResponse = await fetch(`${serverUrl}/api/csrf-token`, {
            headers: { ...headers, 'x-session-id': sessionId }
        });
        const csrfPayload = await csrfResponse.json();
        if (!csrfResponse.ok || !csrfPayload?.token) {
            throw new Error(`${csrfPayload?.error?.code || csrfResponse.status}: unable to obtain CSRF token`);
        }
        headers['x-session-id'] = sessionId;
        headers['x-csrf-token'] = csrfPayload.token;
    }
    const response = await fetch(`${serverUrl}/api/project-provisioning${path}`, {
        method,
        headers: {
            ...headers,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json();
    if (!response.ok) {
        const code = payload.error?.code || String(response.status);
        const message = payload.error?.message || 'request failed';
        const details = payload.error?.details;
        const error = new Error(`${code}: ${message}${details ? `\ndetails: ${JSON.stringify(details)}` : ''}`);
        error.code = code;
        error.statusCode = response.status;
        error.details = details;
        throw error;
    }
    console.log(JSON.stringify(payload, null, 2));
    return payload;
}

export async function runProjectProvisioning(subcommand, args) {
    if (subcommand === 'check') {
        assertArgs(args, { flags: ['--manifest'] });
        return request('/check', { method: 'POST', body: manifest(args) });
    }
    if (subcommand === 'plan') {
        assertArgs(args, { flags: ['--manifest', '--idempotency-key'] });
        const idempotencyKey = value(args, '--idempotency-key');
        if (!idempotencyKey) throw new Error('--idempotency-key <key> is required');
        return request('/plan', { method: 'POST', body: manifest(args), idempotencyKey });
    }
    const runId = args[0];
    if (!runId) throw new Error(`Usage: brainbase project provision ${subcommand} <run-id>`);
    if (subcommand === 'status') {
        assertArgs(args, { positionals: 1 });
        return request(`/runs/${runId}`);
    }
    if (subcommand === 'verify') {
        assertArgs(args, { positionals: 1 });
        return request(`/runs/${runId}/verify`, { method: 'POST', body: {} });
    }
    if (subcommand === 'approve') {
        assertArgs(args, { positionals: 1, flags: ['--gates', '--review-ref'] });
        const approvedGates = (value(args, '--gates') || '').split(',').map((item) => item.trim()).filter(Boolean);
        const reviewRef = value(args, '--review-ref');
        if (!approvedGates.length) throw new Error('--gates <gate,...> is required');
        if (!reviewRef) throw new Error('--review-ref <receipt> is required');
        return request(`/runs/${runId}/approve`, {
            method: 'POST',
            body: { approved_gates: approvedGates, review_ref: reviewRef }
        });
    }
    if (subcommand === 'apply' || subcommand === 'resume') {
        assertArgs(args, { positionals: 1 });
        const result = await request(`/runs/${runId}/${subcommand}`, { method: 'POST', body: {} });
        if (result.state === 'manual_intervention_required') {
            throw new Error(`manual_intervention_required: approve exactly these gates, then run resume: ${(result.failure?.missing_gates || []).join(',')}`);
        }
        return result;
    }
    throw new Error('Usage: brainbase project provision [check|plan|approve|apply|status|verify|resume]');
}
