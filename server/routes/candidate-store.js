// @ts-check
/**
 * candidate-store cross-repo write router
 * Mounts at /api/candidate-store
 *
 * Story: story-candidate-store-cross-repo-write
 */

import express from 'express';

import { CandidateStoreController } from '../controllers/candidate-store-controller.js';
import {
    captureCandidateStoreRawBody,
    createCandidateStoreHmacMiddleware
} from '../middleware/candidate-store-hmac.js';
import { requirePersonalKnowledgeAccess } from '../middleware/personal-knowledge-access.js';

export function createCandidateStoreRouter({
    candidateRepository,
    defaultScope,
    defaultOrgIds,
    allowedSources,
    auditPersonalAccess = null,
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
        verify: captureCandidateStoreRawBody
    });

    const hmac = createCandidateStoreHmacMiddleware({ allowedSources });
    const personalAccess = requirePersonalKnowledgeAccess({ audit: auditPersonalAccess });

    router.post('/raw-ledger', jsonParserWithRawBody, hmac, personalAccess, controller.ingestRawLedger);

    return router;
}
