import { createVibeproHandoffIssuer } from './vibepro-handoff-issuer.js';
import { VibeproHandoffPostgresStore } from './vibepro-handoff-postgres-store.js';

// Deliberate composition boundary: callers must provide signing material and
// the scoped PostgreSQL services. Normal bootstrap does not auto-enable it.
export function createVibeproHandoffRuntime({
    pool,
    infoSSOTService,
    outcomeCaseService,
    signingKey,
    keyId,
    clock,
    ttlMs
} = {}) {
    const store = new VibeproHandoffPostgresStore({ pool, infoSSOTService });
    const issuer = createVibeproHandoffIssuer({
        outcomeCaseService,
        readAdoptedHandoff: store.readAdoptedHandoff.bind(store),
        signingKey,
        keyId,
        clock,
        ttlMs
    });
    return {
        adopt: store.adopt.bind(store),
        issue: issuer.issue.bind(issuer),
        store,
        issuer
    };
}
