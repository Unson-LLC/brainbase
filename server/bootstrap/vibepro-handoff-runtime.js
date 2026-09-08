import { JudgmentReceiptPostgresRepository } from '../services/judgment-receipt/judgment-receipt-postgres-repository.js';
import { createVibeproHandoffRuntime } from '../services/outcome-case/vibepro-handoff-runtime.js';

export const VIBEPRO_HANDOFF_BOOTSTRAP_CONFIGURATION_ERROR = 'vibepro_handoff_bootstrap_configuration_invalid';

function configurationError() {
    const error = new Error('VibePro handoff bootstrap configuration is invalid');
    error.code = VIBEPRO_HANDOFF_BOOTSTRAP_CONFIGURATION_ERROR;
    return error;
}

function enabled(env) {
    const value = env?.BRAINBASE_VIBEPRO_HANDOFF_ENABLED;
    if (value === undefined || value === '0') return false;
    if (value === '1') return true;
    throw configurationError();
}

/**
 * Constructs the optional persistence and issuer boundary only when deployment
 * configuration explicitly opts in. It neither applies schema nor grants access.
 */
export function createVibeproHandoffBootstrap({
    env = process.env,
    pool,
    infoSSOTService,
    outcomeCaseService
} = {}) {
    if (!enabled(env)) {
        return { judgmentReceiptWriter: null, vibeproHandoffRuntime: null };
    }
    if (!pool
        || typeof infoSSOTService?.withAccessContext !== 'function'
        || typeof outcomeCaseService?.read !== 'function') {
        throw configurationError();
    }

    try {
        const judgmentReceiptWriter = new JudgmentReceiptPostgresRepository({ pool, infoSSOTService });
        const vibeproHandoffRuntime = createVibeproHandoffRuntime({
            pool,
            infoSSOTService,
            outcomeCaseService,
            signingKey: env.BRAINBASE_VIBEPRO_HANDOFF_SIGNING_KEY,
            keyId: env.BRAINBASE_VIBEPRO_HANDOFF_KEY_ID
        });
        return { judgmentReceiptWriter, vibeproHandoffRuntime };
    } catch {
        // Do not expose missing or invalid secret/configuration details at startup.
        throw configurationError();
    }
}
