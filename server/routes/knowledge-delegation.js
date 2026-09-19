import express from 'express';

function problem(res, status, code, reason) {
    return res.status(status).type('application/problem+json').json({
        type: `https://brainbase.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
        status,
        code,
        title: status === 503 ? '知識委任を利用できません' : '知識委任リクエストが無効です',
        retryable: status >= 500,
        fault_domain: status >= 500 ? 'brainbase_cloud' : 'protocol',
        correlation_id: null,
        details: { reason }
    });
}

function unavailable(_req, res) {
    return problem(res, 503, 'KNOWLEDGE_DELEGATION_UNAVAILABLE', 'service authentication is not configured');
}

export function createKnowledgeDelegationRouter({ serviceAuth = null, issuer = null } = {}) {
    const router = express.Router();
    router.post('/knowledge:delegate', typeof serviceAuth === 'function' ? serviceAuth : unavailable, async (req, res) => {
        if (typeof issuer?.issue !== 'function') {
            return problem(res, 503, 'KNOWLEDGE_DELEGATION_UNAVAILABLE', 'delegation issuer is not configured');
        }
        try {
            const result = await issuer.issue(req.body, req.serviceIdentity);
            res.set('Cache-Control', 'no-store');
            return res.status(200).json(result);
        } catch (error) {
            if (error instanceof TypeError) return problem(res, 400, 'KNOWLEDGE_DELEGATION_INPUT_INVALID', error.message);
            return problem(res, 403, 'KNOWLEDGE_DELEGATION_DENIED', error?.message || 'authority readback denied delegation');
        }
    });
    return router;
}
