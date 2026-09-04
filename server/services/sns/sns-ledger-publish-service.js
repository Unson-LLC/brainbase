// @ts-check
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { SnsPostValidationError } from './posting-ledger-repository.js';
import { requireSnsAuthority } from './sns-authority.js';

const execFileAsync = promisify(execFile);
const DEFAULT_PYTHON = '/Users/ksato/workspace/.venv/bin/python';
const DEFAULT_SNS_POST_SCRIPT = '/Users/ksato/workspace/common/ops/scripts/sns_post.py';

function assertPublishable(post) {
    if (!post) throw new SnsPostValidationError('SNS post not found');
    if (post.status === 'posted') throw new SnsPostValidationError('SNS post is already posted');
    if (!['approved', 'scheduled', 'publishing'].includes(post.status)) {
        throw new SnsPostValidationError(`SNS post must be approved, scheduled, or publishing before publish: ${post.status}`);
    }
    if (!String(post.body || '').trim()) throw new SnsPostValidationError('SNS post body required before publish');
}

function extractJsonObject(stdout) {
    const text = String(stdout || '').trim();
    const candidates = [];
    for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
        candidates.push(text.slice(index));
    }
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            // sns_post.py prints human-readable lines before final JSON.
        }
    }
    throw new Error('sns_post.py did not return JSON output');
}

function postedUrlFromResult(result) {
    return result?.post_result?.url
        || result?.url
        || (result?.post_result?.id ? `https://x.com/i/web/status/${result.post_result.id}` : null)
        || (result?.id ? `https://x.com/i/web/status/${result.id}` : null);
}

export function createSnsPostScriptExecutor({
    pythonPath = process.env.SNS_POST_PYTHON || DEFAULT_PYTHON,
    scriptPath = process.env.SNS_POST_SCRIPT || DEFAULT_SNS_POST_SCRIPT
} = {}) {
    return async function executeSnsPost({ title, body, dry_run = false }) {
        const args = [
            scriptPath,
            '--title', title || 'SNS post',
            '--body', body,
            '--skip-image',
            '--json'
        ];
        if (dry_run) args.push('--dry-run');
        const { stdout } = await execFileAsync(pythonPath, args, {
            maxBuffer: 1024 * 1024 * 4
        });
        return extractJsonObject(stdout);
    };
}

export class SnsLedgerPublishService {
    constructor({ ledgerRepository, postExecutor = createSnsPostScriptExecutor(), now = () => new Date() }) {
        if (!ledgerRepository) throw new Error('ledgerRepository required');
        if (typeof postExecutor !== 'function') throw new Error('postExecutor function required');
        this.ledgerRepository = ledgerRepository;
        this.postExecutor = postExecutor;
        this.now = now;
    }

    async publishPost(postId, {
        actor = {},
        dry_run = false,
        confirm_public_post = false
    } = {}) {
        const authority = requireSnsAuthority(actor);
        const post = await this.ledgerRepository.findById(postId, authority);
        assertPublishable(post);
        if (!dry_run && !confirm_public_post) {
            throw new SnsPostValidationError('confirm_public_post required for public SNS publish');
        }
        if (!dry_run && post.status !== 'publishing') {
            throw new SnsPostValidationError('SNS post must be claimed before public SNS publish');
        }

        const publishResult = await this.postExecutor({
            title: post.title,
            body: post.body,
            dry_run
        });
        if (dry_run) return { post, dry_run: true, publish_result: publishResult };

        const postedUrl = postedUrlFromResult(publishResult);
        if (!postedUrl) throw new SnsPostValidationError('posted URL missing from publish result');

        const updated = await this.ledgerRepository.updatePost(post.id, {
            status: 'posted',
            posted_url: postedUrl,
            posted_at: this.now().toISOString()
        }, authority);
        return { post: updated, publish_result: publishResult };
    }
}

export const __private__ = {
    extractJsonObject,
    postedUrlFromResult
};
