import { describe, expect, it, vi } from 'vitest';

import { ReplyDraftContextResolver } from '../../../../server/services/companion/reply-draft-context-resolver.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const request = {
    userInstruction: 'Use my normal concise response style.',
    subject: 'Contract reply',
    sender: 'Example Sender',
    classificationReason: 'A reply is needed.',
    snippet: 'Please confirm the next action.',
    threadMessages: [{
        sender: 'Example Sender',
        body: 'Could you share the next step?'
    }]
};

describe('ReplyDraftContextResolver', () => {
    it('searches Personal KG sequentially under one authenticated owner transaction context', async () => {
        let activeSearches = 0;
        let maxActiveSearches = 0;
        let callCount = 0;
        const calls = [];
        const learningService = {
            searchPersonalKgCandidates: async (input, context) => {
                calls.push({ input, context });
                activeSearches += 1;
                maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
                const index = callCount;
                callCount += 1;
                await delay(5);
                activeSearches -= 1;
                return [{
                    id: `mem_${index}`,
                    body: `Memory for ${input.query}`,
                    cognitive_type: 'preference'
                }];
            }
        };
        const resolver = new ReplyDraftContextResolver({
            infoSSOTService: {
                getContext: async () => ({ meta: { entity_count: 1 } })
            },
            learningService
        });
        const access = {
            personId: 'umeda_ryo',
            organizationId: 'unson',
            actorPersonId: 'per_graph_umeda',
            role: 'gm',
            projectCodes: ['brainbase']
        };

        const context = await resolver.resolve(request, access);

        expect(callCount).toBe(4);
        expect(maxActiveSearches).toBe(1);
        expect(context.personalKg).toHaveLength(4);
        expect(calls).toEqual(expect.arrayContaining([
            expect.objectContaining({
                input: expect.objectContaining({
                    ownerPersonId: 'umeda_ryo',
                    organizationId: 'unson'
                }),
                context: { access }
            })
        ]));
        expect(context.rationale).toEqual(expect.arrayContaining([
            expect.stringContaining('Personal KG search completed: 4 owner-visible memories')
        ]));
    });

    it('fails closed instead of falling back to a default owner', async () => {
        const searchPersonalKgCandidates = vi.fn();
        const resolver = new ReplyDraftContextResolver({
            infoSSOTService: { getContext: async () => ({ meta: { entity_count: 1 } }) },
            learningService: { searchPersonalKgCandidates }
        });

        await expect(resolver.resolve(request, {
            role: 'gm',
            projectCodes: ['brainbase']
        })).rejects.toMatchObject({
            code: 'context_unavailable',
            details: expect.objectContaining({ reason: 'personal_knowledge_identity_required' })
        });
        expect(searchPersonalKgCandidates).not.toHaveBeenCalled();
    });
});