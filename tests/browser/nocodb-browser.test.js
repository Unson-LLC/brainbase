import { describe, expect, it } from 'vitest';
import {
    NocoDBBrowserAdapter,
    CanonicalTaskApiRequiredError,
    CanonicalTaskStoreConfigUnavailableError
} from '../../public/js/nocodb-browser.js';

const CANONICAL_BASE_ID = 'pva7l2qlu6fdfip';

describe('NocoDBBrowserAdapter legacy Task write guard', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
        'Given canonical base, when %s is prepared for the legacy Task API, then it is rejected',
        (method) => {
            const adapter = new NocoDBBrowserAdapter({
                canonicalTaskStoreConfig: { baseId: CANONICAL_BASE_ID, project: 'brainbase' }
            });

            expect(() => adapter.guardLegacyTaskRequest({
                method,
                baseId: CANONICAL_BASE_ID,
                body: { title: 'must not be sent' }
            })).toThrow(CanonicalTaskApiRequiredError);
        }
    );

    it('Given canonical project, when create is prepared without a base ID, then it is rejected', () => {
        const adapter = new NocoDBBrowserAdapter({
            canonicalTaskStoreConfig: { baseId: CANONICAL_BASE_ID, project: 'brainbase' }
        });

        expect(() => adapter.guardLegacyTaskRequest({
            method: 'POST',
            projectId: 'brainbase',
            body: { title: 'must not be sent' }
        })).toThrow(CanonicalTaskApiRequiredError);
    });

    it('Given canonical identity is unavailable, when a legacy Task mutation is prepared, then it fails closed', () => {
        const adapter = new NocoDBBrowserAdapter({ canonicalTaskStoreConfig: null });

        expect(() => adapter.guardLegacyTaskRequest({
            method: 'PUT',
            baseId: 'other-base',
            body: { title: 'must not be sent' }
        })).toThrow(CanonicalTaskStoreConfigUnavailableError);
    });

    it('Given a non-canonical base, when a legacy Task mutation is prepared, then the request remains unchanged', () => {
        const adapter = new NocoDBBrowserAdapter({
            canonicalTaskStoreConfig: { baseId: CANONICAL_BASE_ID, project: 'brainbase' }
        });
        const request = {
            method: 'PUT',
            baseId: 'other-base',
            body: { fields: { title: 'unchanged' } }
        };

        expect(adapter.guardLegacyTaskRequest(request)).toBe(request);
    });

    it('Given a read request, when canonical identity is unavailable, then the request remains unchanged', () => {
        const adapter = new NocoDBBrowserAdapter({ canonicalTaskStoreConfig: null });
        const request = { method: 'GET', baseId: CANONICAL_BASE_ID };

        expect(adapter.guardLegacyTaskRequest(request)).toBe(request);
    });
});
