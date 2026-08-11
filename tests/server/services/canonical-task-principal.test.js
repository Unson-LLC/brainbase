import { describe, expect, it } from 'vitest';

import {
    createCanonicalTaskPrincipal,
    principalNamespace
} from '../../../server/services/companion/canonical-task-principal.js';

describe('canonical task principal', () => {
    it('normalizes equivalent person credentials into one namespace', () => {
        const bearer = createCanonicalTaskPrincipal({ authSource: 'bearer', personId: 'person_e\u0301' });
        const session = createCanonicalTaskPrincipal({ authSource: 'session', personId: 'person_é' });
        expect(bearer).toEqual({ type: 'person', id: 'person_é' });
        expect(principalNamespace(bearer)).toBe(principalNamespace(session));
    });

    it('keeps type and delimiter-bearing ids disjoint', () => {
        const person = principalNamespace({ type: 'person', id: 'a:b' });
        const service = principalNamespace({ type: 'service', id: 'a:b' });
        expect(person).not.toBe(service);
        expect(person).toMatch(/^v1\./);
    });

    it('rejects untrusted or invalid principals', () => {
        expect(() => createCanonicalTaskPrincipal({ authSource: 'cookie', personId: 'p1' }))
            .toThrowError(/trusted authentication/);
        expect(() => principalNamespace({ type: 'person', id: 'bad\nvalue' }))
            .toThrowError(/control/);
    });
});
