import express from 'express';
import { createRetiredCapabilityRouter } from '../retired-capability.js';

const NOCODB_AUXILIARY_RETIREMENT = {
    capability: 'brainbase.nocodb-auxiliary',
    owner: 'Canonical Graph and Task APIs',
    replacement: 'Use the Graph project catalog and Canonical Task APIs'
};

/**
 * NocoDB-backed trend projections were retired with the legacy dashboard.
 * Keep both paths explicit so callers do not mistake an empty trend set for
 * a successful read.
 */
export function createBrainbaseTrendsRouter(_options = {}) {
    const router = express.Router();
    const retired = createRetiredCapabilityRouter(NOCODB_AUXILIARY_RETIREMENT);

    router.use('/trends', retired);

    return router;
}
