// @ts-check

function required(value, name) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`${name} is required`);
    return normalized;
}

function materializedAccessToken(result) {
    const raw = Buffer.isBuffer(result) ? result.toString('utf8') : result?.credential_material ?? result;
    const token = String(raw || '').trim();
    if (!token) throw new Error('Google meeting credential material is unavailable');
    return token;
}

/**
 * Trusted runtime boundary for the Growin meeting workflow.
 * Credential material is used only inside each provider call and is never
 * returned to the caller, written to disk, or included in receipts.
 */
export class GoogleMeetingWorkflowAdapter {
    constructor({ provider, credentialMaterializer }) {
        if (!provider || typeof credentialMaterializer?.materialize !== 'function') {
            throw new Error('Google meeting workflow adapter dependencies are required');
        }
        this.provider = provider;
        this.credentialMaterializer = credentialMaterializer;
    }

    async #withCredential({ credentialBinding, operation }, callback) {
        const credentialRef = required(credentialBinding?.credential_ref, 'credentialBinding.credential_ref');
        const binding = {
            tenant_id: required(credentialBinding?.tenant_id, 'credentialBinding.tenant_id'),
            connection_id: required(credentialBinding?.connection_id, 'credentialBinding.connection_id'),
            connection_revision: required(credentialBinding?.connection_revision, 'credentialBinding.connection_revision'),
            provider: 'google-meet'
        };
        required(operation, 'operation');
        const material = await this.credentialMaterializer.materialize(credentialRef, binding);
        const accessToken = materializedAccessToken(material);
        return callback(accessToken);
    }

    listConferenceRecords({ credentialBinding, pageSize, pageToken }) {
        return this.#withCredential({ credentialBinding, operation: 'conference-records.read' }, (accessToken) => (
            this.provider.listMeetConferenceRecords(accessToken, { pageSize, pageToken })
        ));
    }

    listCalendarEvents({ credentialBinding, ...query }) {
        return this.#withCredential({ credentialBinding, operation: 'calendar-events.read' }, (accessToken) => (
            this.provider.listCalendarEvents(accessToken, query)
        ));
    }

    getAttachedDocument({ credentialBinding, documentId }) {
        return this.#withCredential({ credentialBinding, operation: 'document.read' }, (accessToken) => (
            this.provider.getGoogleDocument(accessToken, documentId)
        ));
    }

    listTranscripts({ credentialBinding, conferenceRecordName, pageSize, pageToken }) {
        return this.#withCredential({ credentialBinding, operation: 'transcripts.read' }, (accessToken) => (
            this.provider.listMeetTranscripts(accessToken, conferenceRecordName, { pageSize, pageToken })
        ));
    }

    listTranscriptEntries({ credentialBinding, transcriptName, pageSize, pageToken }) {
        return this.#withCredential({ credentialBinding, operation: 'transcript-entries.read' }, (accessToken) => (
            this.provider.listMeetTranscriptEntries(accessToken, transcriptName, { pageSize, pageToken })
        ));
    }

    createGmailDraft({ credentialBinding, rawMessage }) {
        return this.#withCredential({ credentialBinding, operation: 'gmail-draft.create' }, (accessToken) => (
            this.provider.createGmailDraft(accessToken, rawMessage)
        ));
    }
}
