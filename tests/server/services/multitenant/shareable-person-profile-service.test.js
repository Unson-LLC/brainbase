// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ShareablePersonProfileService } from '../../../../server/services/multitenant/shareable-person-profile-service.js';
import { createPersonalKnowledgeAuthority } from '../../../helpers/personal-knowledge-client-authority.js';

const now = new Date('2026-09-16T08:00:00Z');
function authority(options = {}) {
    return createPersonalKnowledgeAuthority({
        now, owner: 'person-requester', externalSubjectId: 'UREQUESTER', channel: 'CDEST',
        capability: 'runtime.execute', effect: 'external_side_effect',
        resourceRef: 'project:project-a', dataScopes: ['internal'],
        mutate: ({ context }) => { context.scope.owner_person_id = null; }, ...options
    });
}
function setup({ proof = authority(), current = proof, profile } = {}) {
    const scope = proof.context.tenant_context.workspace_connection.workspace_id;
    const rule = (value) => ({ value, reader_person_ids: ['person-requester'], audiences: [{ workspace_id: scope, channel_id: 'CDEST' }] });
    const record = {
        person_id: 'person-target',
        profile: profile ?? { version: 'shareable-person-profile.v1', revision: '1', fields: {
            name: rule('Approved name'), affiliation: rule('Approved affiliation'), role: rule('Approved role')
        } }
    };
    const profileRepository = { readProfile: vi.fn(async () => record) };
    const companyAuthority = { resolve: vi.fn(async () => current.response) };
    const service = new ShareablePersonProfileService({
        profileRepository, companyAuthority, publicJwk: proof.publicJwk,
        deploymentId: proof.context.scope.placement_id, now: () => now
    });
    const input = { company_authority_response: proof.response, target_slack_user_id: 'UTARGET' };
    return { service, input, profileRepository, companyAuthority, record, proof };
}

describe('shareable person profile disclosure', () => {
    it('returns only explicitly permitted fields and a destination-bound digest', async () => {
        const test = setup();
        const result = await test.service.read(test.input);
        expect(result.status).toBe('ok');
        expect(result.fields).toEqual({ name: 'Approved name', affiliation: 'Approved affiliation', role: 'Approved role' });
        expect(result.disclosure).toMatchObject({ channel_id: 'CDEST', requester_person_id: 'person-requester', target_person_id: 'person-target' });
        expect(result.disclosure.digest).toMatch(/^[a-f0-9]{64}$/);
        expect(test.companyAuthority.resolve).toHaveBeenCalledWith(expect.objectContaining({
            provider_identity: expect.objectContaining({ authenticated_subject_id: 'UREQUESTER' }),
            delivery: expect.objectContaining({ channel_id: 'CDEST' })
        }));
    });
    it('applies reader and destination permission independently for each field', async () => {
        const test = setup();
        test.record.profile.fields.affiliation.reader_person_ids = ['person-other'];
        test.record.profile.fields.role.audiences[0].channel_id = 'COTHER';
        expect((await test.service.read(test.input)).fields).toEqual({ name: 'Approved name' });
    });
    it('accepts freshly issued authority with the same stable bindings', async () => {
        const current = authority({ issuedAt: new Date(now - 1000), expiresAt: new Date(now.getTime() + 240000) });
        const test = setup({ current });
        expect((await test.service.read(test.input)).status).toBe('ok');
    });
    it('does not let a broadly authorized proxy disclose to another audience', async () => {
        const test = setup();
        for (const field of Object.values(test.record.profile.fields)) field.audiences[0].channel_id = 'CPRIVATE';
        expect(await test.service.read(test.input)).toEqual({ status: 'unavailable', target_slack_user_id: 'UTARGET', fields: {} });
    });
    it.each([null, {}, { version: 'shareable-person-profile.v1', revision: '1', fields: { notes: { value: 'SECRET' } } }])('fails closed for missing/malformed policy %j', async (profile) => {
        const test = setup(); test.record.profile = profile;
        expect((await test.service.read(test.input)).fields).toEqual({});
    });
    it('does not infer a target or substitute the requester when unknown', async () => {
        const test = setup(); test.profileRepository.readProfile.mockResolvedValue(null);
        expect((await test.service.read(test.input)).status).toBe('unavailable');
    });
    it.each(['requester_person_id', 'channel_id', 'tenant_id', 'fields'])('rejects model-supplied %s', async (key) => {
        const test = setup();
        await expect(test.service.read({ ...test.input, [key]: 'spoof' })).rejects.toMatchObject({ code: 'PERSON_PROFILE_INPUT_INVALID' });
        expect(test.profileRepository.readProfile).not.toHaveBeenCalled();
    });
    it('rejects tampered signed scope before data retrieval', async () => {
        const test = setup(); test.input.company_authority_response.context.tenant_context.slack.channel_id = 'COTHER';
        await expect(test.service.read(test.input)).rejects.toMatchObject({ status: 403 });
        expect(test.profileRepository.readProfile).not.toHaveBeenCalled();
    });
    it('rejects expired authority', async () => {
        const test = setup({ proof: authority({ issuedAt: new Date(now - 300000), expiresAt: new Date(now - 60000) }) });
        await expect(test.service.read(test.input)).rejects.toMatchObject({ status: 403 });
    });
    it('rejects unsupported stop conditions rather than silently ignoring them', async () => {
        const proof = authority({ mutate: ({ context }) => {
            context.scope.owner_person_id = null;
            context.authority.stop_conditions.push('owner_review_required');
        } });
        const test = setup({ proof });
        await expect(test.service.read(test.input)).rejects.toMatchObject({ status: 403 });
        expect(test.profileRepository.readProfile).not.toHaveBeenCalled();
    });
    it('rejects revoked authority without reading a profile', async () => {
        const test = setup(); test.companyAuthority.resolve.mockResolvedValue({ context: null, error: { code: 'MEMBERSHIP_INACTIVE' } });
        await expect(test.service.read(test.input)).rejects.toMatchObject({ status: 403 });
        expect(test.profileRepository.readProfile).not.toHaveBeenCalled();
    });
    it.each(['actor', 'tenant', 'destination', 'membership'])('rejects changed live %s binding', async (kind) => {
        const current = authority({ mutate: ({ context }) => {
            context.scope.owner_person_id = null;
            if (kind === 'actor') { context.actor.canonical_person_id = 'other'; context.tenant_context.actor.principal_id = 'other'; }
            if (kind === 'tenant') context.tenant_context.tenant.tenant_revision = '999';
            if (kind === 'destination') context.tenant_context.slack.channel_id = 'COTHER';
            if (kind === 'membership') context.actor.membership_revision = '999';
        } });
        const test = setup({ current });
        await expect(test.service.read(test.input)).rejects.toMatchObject({ status: 403 });
        expect(test.profileRepository.readProfile).not.toHaveBeenCalled();
    });
    it('changes the digest when disclosure is changed or withdrawn', async () => {
        const test = setup(); const first = await test.service.read(test.input);
        test.record.profile.fields.role.value = 'Changed approved role';
        const second = await test.service.read(test.input);
        expect(second.disclosure.digest).not.toBe(first.disclosure.digest);
        test.record.profile.fields.role.audiences = [];
        expect((await test.service.read(test.input)).fields).not.toHaveProperty('role');
    });
    it('does not expose repository errors or private records', async () => {
        const test = setup(); test.profileRepository.readProfile.mockRejectedValue(new Error('SECRET private body'));
        await expect(test.service.read(test.input)).rejects.toMatchObject({ message: 'PERSON_PROFILE_UNAVAILABLE' });
    });
});
