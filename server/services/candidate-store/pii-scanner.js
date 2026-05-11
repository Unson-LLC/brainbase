// @ts-check
/**
 * PII / secret scanner（SPEC-candidate-store-mvp Contract-6）
 * block: secret pattern → candidate 作成不可
 * review: PII pattern → candidate 作成可、redaction_status=needs_redaction
 */

const BLOCK_PATTERNS = [
    { name: 'openai_api_key', regex: /sk-[A-Za-z0-9]{20,}/g },
    { name: 'github_pat', regex: /ghp_[A-Za-z0-9]{20,}/g },
    { name: 'anthropic_api_key', regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },
    { name: 'aws_access_key', regex: /AKIA[0-9A-Z]{16}/g },
    { name: 'slack_token', regex: /xox[abpsr]-[A-Za-z0-9-]{10,}/g },
    { name: 'private_key_block', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
    { name: 'password_assignment', regex: /(?:password|passwd|secret)\s*=\s*['"][^'"\s]{6,}['"]/gi },
    { name: 'infisical_ref', regex: /infisical:\/\/[^\s]+/gi }
];

const PII_PATTERNS = [
    { name: 'jp_phone', regex: /0\d{1,4}-\d{1,4}-\d{3,4}/g },
    { name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
    { name: 'credit_card_like', regex: /\b(?:\d{4}[- ]?){3}\d{4}\b/g }
];

/**
 * @param {string} content
 * @returns {{ block: boolean, review: boolean, findings: Array<{kind:'block'|'review', name:string, count:number}> }}
 */
export function scan(content) {
    if (typeof content !== 'string' || content.length === 0) {
        return { block: false, review: false, findings: [] };
    }

    const findings = [];

    for (const { name, regex } of BLOCK_PATTERNS) {
        const matches = content.match(regex);
        if (matches && matches.length > 0) {
            findings.push({ kind: 'block', name, count: matches.length });
        }
    }

    const piiHits = [];
    for (const { name, regex } of PII_PATTERNS) {
        const matches = content.match(regex);
        if (matches && matches.length > 0) {
            piiHits.push({ name, count: matches.length });
        }
    }

    // email + phone 同時 = review、単独 PII でも review にする（安全寄り）
    if (piiHits.length > 0) {
        for (const hit of piiHits) {
            findings.push({ kind: 'review', name: hit.name, count: hit.count });
        }
    }

    const block = findings.some((f) => f.kind === 'block');
    const review = findings.some((f) => f.kind === 'review');

    return { block, review, findings };
}

export { BLOCK_PATTERNS, PII_PATTERNS };
