// @ts-check
/**
 * candidate-store cross-repo write router
 * Mounts at /api/candidate-store
 *
 * Story: story-candidate-store-cross-repo-write
 */

import express from 'express';

import { CandidateStoreController } from '../controllers/candidate-store-controller.js';
import { createCandidateStoreHmacMiddleware } from '../middleware/candidate-store-hmac.js';

export function createCandidateStoreRouter({
    candidateRepository,
    defaultScope,
    defaultOrgIds,
    allowedSources,
    bodyLimit = '1mb'
} = {}) {
    const router = express.Router();
    const controller = new CandidateStoreController({
        candidateRepository,
        defaultScope,
        defaultOrgIds
    });

    // この router 専用の JSON parser。 verify callback で raw body を保持し
    // HMAC 検証で正確なバイト列に対する署名を比較できるようにする
    // (アプリ全体の express.json は parsed only でも互換性を壊さない設計)。
    const jsonParserWithRawBody = express.json({
        limit: bodyLimit,
        verify: (req, _res, buf) => {
            req.rawBody = buf.toString('utf8');
        }
    });

    const hmac = createCandidateStoreHmacMiddleware({ allowedSources });

    router.post('/raw-ledger', jsonParserWithRawBody, hmac, controller.ingestRawLedger);

    return router;
}
