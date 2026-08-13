import { createBrainbaseHttpClient } from './brainbase-http-client.mjs';

const GRAPH_ENTITY_PATH = '/api/info/graph/entities';

function requiredString(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
    return value;
}

export function createBrainbaseGraphHttpClient({
    baseUrl,
    accessToken,
    fetchImpl = globalThis.fetch,
    sessionId
}) {
    const http = createBrainbaseHttpClient({ baseUrl, accessToken, fetchImpl, sessionId });

    return {
        async findEntity({ entityType, entityId }) {
            requiredString(entityType, 'entityType');
            requiredString(entityId, 'entityId');
            const query = new URLSearchParams({ id: entityId, type: entityType, limit: '1' });
            const result = await http.request(`/api/info/graph/entities?${query}`);
            return result.payload?.records?.[0] || null;
        },

        async upsertEntity({
            id,
            entityType,
            projectCode,
            projectName,
            roleMin = 'gm',
            sensitivity = 'internal',
            payload = {}
        }) {
            requiredString(id, 'id');
            requiredString(entityType, 'entityType');
            requiredString(projectCode, 'projectCode');
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                throw new Error('payload must be an object');
            }
            const result = await http.request(GRAPH_ENTITY_PATH, {
                method: 'POST',
                body: {
                    id,
                    entityType,
                    projectCode,
                    ...(projectName ? { projectName } : {}),
                    roleMin,
                    sensitivity,
                    payload
                }
            });
            return result.payload;
        }
    };
}

export { GRAPH_ENTITY_PATH };
