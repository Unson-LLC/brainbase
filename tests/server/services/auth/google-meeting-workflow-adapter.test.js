import { describe, expect, it, vi } from 'vitest';

import { GoogleMeetingWorkflowAdapter } from '../../../../server/services/auth/google-meeting-workflow-adapter.js';

function harness() {
    const credentialMaterializer = {
        materialize: vi.fn(async () => Buffer.from('access-secret'))
    };
    const provider = {
        listMeetConferenceRecords: vi.fn(async () => ({ conferenceRecords: [{ name: 'conferenceRecords/one' }] })),
        listCalendarEvents: vi.fn(async () => ({ items: [{ id: 'event-one' }] })),
        getGoogleDocument: vi.fn(async () => ({ documentId: 'doc-one' })),
        listMeetTranscripts: vi.fn(async () => ({ transcripts: [{ name: 'transcript-one' }] })),
        listMeetTranscriptEntries: vi.fn(async () => ({ transcriptEntries: [{ text: 'hello' }] })),
        createGmailDraft: vi.fn(async () => ({ id: 'draft-one' }))
    };
    return {
        credentialMaterializer,
        provider,
        adapter: new GoogleMeetingWorkflowAdapter({ provider, credentialMaterializer })
    };
}

const credentialBinding = Object.freeze({
    credential_ref: 'credref://bbcs/growin-google',
    tenant_id: 'growin',
    connection_id: 'google-meet-one',
    connection_revision: '1'
});

describe('GoogleMeetingWorkflowAdapter', () => {
    it('materializes OAuth only inside Calendar, Meet, and Docs provider calls', async () => {
        const h = harness();

        await h.adapter.listCalendarEvents({ credentialBinding, calendarId: 'primary' });
        await h.adapter.listConferenceRecords({ credentialBinding, pageSize: 25 });
        await h.adapter.getAttachedDocument({ credentialBinding, documentId: 'doc-one' });
        await h.adapter.listTranscripts({
            credentialBinding, conferenceRecordName: 'conferenceRecords/one'
        });
        const result = await h.adapter.listTranscriptEntries({
            credentialBinding, transcriptName: 'conferenceRecords/one/transcripts/one'
        });

        expect(h.credentialMaterializer.materialize).toHaveBeenCalledTimes(5);
        expect(h.credentialMaterializer.materialize).toHaveBeenCalledWith(
            credentialBinding.credential_ref,
            expect.objectContaining({ tenant_id: 'growin', provider: 'google-meet' })
        );
        expect(h.provider.listCalendarEvents).toHaveBeenCalledWith('access-secret', { calendarId: 'primary' });
        expect(JSON.stringify(result)).not.toContain('access-secret');
    });

    it('creates a Gmail draft through the compose-only provider method without returning credentials', async () => {
        const h = harness();

        const result = await h.adapter.createGmailDraft({
            credentialBinding, rawMessage: 'base64url-message'
        });

        expect(result).toEqual({ id: 'draft-one' });
        expect(h.provider.createGmailDraft).toHaveBeenCalledWith('access-secret', 'base64url-message');
        expect(JSON.stringify(result)).not.toContain('access-secret');
    });

    it('fails before the provider call when credential material is missing', async () => {
        const h = harness();
        h.credentialMaterializer.materialize.mockResolvedValue(Buffer.alloc(0));

        await expect(h.adapter.listConferenceRecords({
            credentialBinding
        })).rejects.toThrow('credential material is unavailable');
        expect(h.provider.listMeetConferenceRecords).not.toHaveBeenCalled();
    });
});
