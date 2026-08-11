// @ts-check

function readOptionalString(input, snakeKey, camelKey = snakeKey) {
    const value = input?.[snakeKey] ?? input?.[camelKey];
    return typeof value === 'string' ? value.trim() : '';
}

function normalizePeopleText(value) {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .replace(/^@+/, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function normalizePeopleCompactText(value) {
    return normalizePeopleText(value).replace(/\s+/g, '');
}

function normalizeOwnerHintSearchText(value) {
    return normalizePeopleText(value).replace(/(さん|様|氏)$/u, '').trim();
}

function ownerHintCanonicalToken(value) {
    return normalizeOwnerHintSearchText(value).replace(/\s+/g, '');
}

function isGenericOwnerHint(value) {
    return ['担当者', '担当', '未設定', '未定', 'tbd', 'todo', 'owner', 'assignee']
        .includes(ownerHintCanonicalToken(value));
}

function ownerHintSearchQueries(ownerHint) {
    return Array.from(new Set([
        normalizePeopleText(ownerHint),
        normalizeOwnerHintSearchText(ownerHint)
    ].filter(Boolean)));
}

function isSpeakerOwnerHint(value) {
    const normalized = normalizePeopleText(value);
    return /^speaker\s*\d+$/.test(normalized) || /^話者\s*\d+$/.test(normalized);
}

function personNameValues(person = {}) {
    return [
        person.display_name,
        person.name,
        ...(Array.isArray(person.aliases) ? person.aliases : [])
    ].filter((value) => typeof value === 'string' && value.trim());
}

function normalizeProjectIDs(value) {
    if (!value) return [];
    const values = Array.isArray(value) ? value : [value];
    return Array.from(new Set(values
        .flatMap((item) => {
            if (Array.isArray(item)) return normalizeProjectIDs(item);
            if (typeof item === 'string') return [item];
            if (!item || typeof item !== 'object') return [];
            return [item.id, item.project_id, item.projectId, item.project_code, item.projectCode, item.code, item.slug, item.name];
        })
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim())));
}

function projectCodeLookupVariants(projectId) {
    if (!projectId || typeof projectId !== 'string') return [];
    const trimmed = projectId.trim();
    if (!trimmed) return [];
    return Array.from(new Set([
        trimmed,
        trimmed.replace(/[-_]/g, ''),
        trimmed.replace(/_/g, '-'),
        trimmed.replace(/-/g, '_')
    ].filter(Boolean)));
}

function normalizeTaskOwnerPerson(record) {
    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
    const id = record?.id || record?.entity_id || payload.person_id || payload.id || '';
    const displayName = payload.display_name || payload.name || record?.label || id;
    if (!id || !displayName) return null;
    const projectIds = normalizeProjectIDs([
        payload.project_ids,
        payload.projectIds,
        payload.project_codes,
        payload.projectCodes,
        payload.projects,
        payload.member_of,
        payload.memberOf,
        payload.member_of_project_codes,
        payload.memberOfProjectCodes,
        payload.member_of_project_ids,
        payload.memberOfProjectIds,
        payload.project_id,
        payload.projectId,
        payload.project_code,
        payload.projectCode,
        record?.project_id,
        record?.projectId,
        record?.project_code,
        record?.projectCode,
        record?.project_codes,
        record?.projectCodes,
        record?.member_of,
        record?.memberOf,
        record?.member_of_project_codes,
        record?.memberOfProjectCodes,
        record?.member_of_project_ids,
        record?.memberOfProjectIds,
        record?.projects,
        record?.project
    ]);
    return {
        id,
        person_id: id,
        entity_id: record?.entity_id || id,
        display_name: displayName,
        name: payload.name || displayName,
        aliases: Array.isArray(payload.aliases) ? payload.aliases.filter((alias) => typeof alias === 'string' && alias.trim()) : [],
        email: payload.email || null,
        org: payload.org || payload.organization || null,
        role: payload.role || null,
        status: payload.status || 'active',
        project_ids: projectIds,
        source: 'graph_ssot'
    };
}

function graphContextPeople(context = {}) {
    if (!context || typeof context !== 'object') return [];
    const entities = context.entities;
    const records = Array.isArray(entities)
        ? entities.filter((record) => record?.entity_type === 'person' || record?.type === 'person' || record?.payload?.entity_type === 'person')
        : (Array.isArray(entities?.person) ? entities.person : []);
    return records.map(normalizeTaskOwnerPerson).filter(Boolean);
}

function mergeTaskOwnerPeople(...peopleLists) {
    const peopleByKey = new Map();
    for (const person of peopleLists.flat()) {
        if (!person) continue;
        const aliasesKey = Array.isArray(person.aliases)
            ? person.aliases.map((alias) => normalizePeopleCompactText(alias)).filter(Boolean).sort().join('|')
            : '';
        const nameKey = [person.display_name, person.name, aliasesKey]
            .map((value) => normalizePeopleCompactText(value))
            .filter(Boolean)
            .join('::');
        const key = nameKey || person.person_id || person.entity_id || person.id || person.display_name;
        if (!key || peopleByKey.has(key)) continue;
        peopleByKey.set(key, person);
    }
    return Array.from(peopleByKey.values());
}

function taskCandidateOwnerHint(candidate) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return '';
    return readOptionalString(candidate, 'owner_hint', 'ownerHint')
        || readOptionalString(candidate, 'assignee_hint', 'assigneeHint')
        || readOptionalString(candidate, 'owner')
        || readOptionalString(candidate, 'assignee')
        || '';
}

function taskOwnerCandidatePayload(person, ownerHint, projectId = null) {
    const ownerHintCompact = normalizePeopleCompactText(ownerHint);
    const normalizedHintCompact = normalizePeopleCompactText(normalizeOwnerHintSearchText(ownerHint));
    const nameCompacts = personNameValues(person).map((value) => normalizePeopleCompactText(value));
    const exact = nameCompacts.some((value) => value === ownerHintCompact || value === normalizedHintCompact);
    const partial = !exact
        && normalizedHintCompact.length >= 2
        && nameCompacts.some((value) => value.includes(normalizedHintCompact));
    const projectVariants = projectCodeLookupVariants(projectId);
    const contextMatch = Boolean(projectVariants.length && Array.isArray(person.project_ids)
        && person.project_ids.some((personProjectId) => projectVariants.includes(personProjectId)));
    const baseScore = exact ? 100 : (partial ? 70 : 30);
    const score = baseScore + (contextMatch ? 50 : 0) + (person.status === 'inactive' ? 0 : 5);
    return {
        person_id: person.person_id,
        entity_id: person.entity_id,
        display_name: person.display_name,
        aliases: person.aliases,
        project_ids: person.project_ids || [],
        status: person.status || 'active',
        source: 'graph_ssot',
        match: exact ? 'exact_name_or_alias' : (partial ? 'partial_name_or_alias' : 'search_result'),
        context_match: contextMatch,
        score
    };
}

function sortTaskOwnerCandidates(candidates) {
    return [...candidates].sort((a, b) => {
        if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
        return String(a.display_name || '').localeCompare(String(b.display_name || ''), 'ja');
    });
}

function confidentlySelectedTaskOwnerCandidate(ownerCandidates) {
    const selectableCandidates = ownerCandidates.filter((person) => String(person.status || 'active').toLowerCase() !== 'inactive');
    if (!selectableCandidates.length) return null;
    const exactMatches = selectableCandidates.filter((person) => person.match === 'exact_name_or_alias');
    if (ownerCandidates.length === 1 && exactMatches.length === 1) return selectableCandidates[0];
    const partialMatches = selectableCandidates.filter((person) => person.match === 'partial_name_or_alias');
    if (ownerCandidates.length === 1 && partialMatches.length === 1) return selectableCandidates[0];
    const [first, second] = selectableCandidates;
    const firstScore = first?.score || 0;
    const secondScore = second?.score || 0;
    if (
        first
        && first.context_match
        && ['exact_name_or_alias', 'partial_name_or_alias'].includes(first.match)
        && firstScore - secondScore >= 20
    ) {
        return first;
    }
    return null;
}

function taskOwnerAccessFromActor(actor = {}, projectId = null) {
    const role = typeof actor.role === 'string' ? actor.role.toLowerCase() : '';
    const actorProjectCodes = Array.isArray(actor.projectCodes)
        ? actor.projectCodes.filter((code) => typeof code === 'string' && code.trim()).map((code) => code.trim())
        : [];
    const projectCodes = Array.from(new Set([
        ...actorProjectCodes,
        ...projectCodeLookupVariants(projectId)
    ]));
    return {
        role: ['member', 'gm', 'ceo'].includes(role) ? role : 'ceo',
        projectCodes,
        clearance: Array.isArray(actor.clearance) && actor.clearance.length ? actor.clearance : ['internal'],
        personId: actor.person_id || actor.personId || actor.sub || null
    };
}

export class MeetingTaskOwnerResolver {
    constructor({ infoSSOTService = null } = {}) {
        this.infoSSOTService = infoSSOTService;
    }

    async resolveReviewTaskOwners(reviewPackage, { actor = {}, projectId = null, graphContext = null } = {}) {
        if (!this.infoSSOTService?.listGraphEntities || !Array.isArray(reviewPackage?.task_candidates)) {
            return reviewPackage;
        }

        const access = taskOwnerAccessFromActor(actor, projectId);
        const cache = new Map();
        const contextPeople = graphContextPeople(graphContext);
        const taskCandidates = [];

        for (const candidate of reviewPackage.task_candidates) {
            taskCandidates.push(await this.resolveCandidate(candidate, {
                access,
                projectId,
                contextPeople,
                cache
            }));
        }

        return {
            ...reviewPackage,
            task_candidates: taskCandidates
        };
    }

    async resolveCandidate(candidate, { access, projectId, cache, contextPeople = [] }) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
        if (candidate.selected_owner_id || candidate.selectedOwnerId) {
            const selectedOwnerId = candidate.selected_owner_id || candidate.selectedOwnerId;
            const lookup = await this.lookupPeople({ access, projectId, ids: [selectedOwnerId], cache });
            const selectedPerson = mergeTaskOwnerPeople(lookup.people, contextPeople)
                .find((person) => person.person_id === selectedOwnerId);
            if (lookup.status === 'ok' && selectedPerson) {
                return {
                    ...candidate,
                    selected_owner_id: selectedPerson.person_id,
                    selected_owner: candidate.selected_owner || candidate.selectedOwner || selectedPerson.display_name,
                    owner_candidates: [taskOwnerCandidatePayload(selectedPerson, selectedOwnerId, projectId)],
                    owner_resolution: {
                        source: 'graph_ssot',
                        status: 'already_selected',
                        reason: 'selected_owner_id_verified_in_people_ssot'
                    }
                };
            }

            const {
                selected_owner_id: _selectedOwnerId,
                selectedOwnerId: _selectedOwnerIdCamel,
                selected_owner: _selectedOwner,
                selectedOwner: _selectedOwnerCamel,
                ...candidateWithoutUnverifiedOwner
            } = candidate;

            return {
                ...candidateWithoutUnverifiedOwner,
                owner_candidates: mergeTaskOwnerPeople(lookup.people, contextPeople)
                    .map((person) => taskOwnerCandidatePayload(person, selectedOwnerId, projectId)),
                owner_resolution: {
                    source: 'graph_ssot',
                    status: 'unresolved',
                    reason: lookup.status === 'unavailable'
                        ? 'people_ssot_unavailable'
                        : 'selected_owner_id_not_found_in_people_ssot'
                }
            };
        }

        const ownerHint = taskCandidateOwnerHint(candidate);
        if (!ownerHint) return candidate;
        if (isSpeakerOwnerHint(ownerHint)) {
            return {
                ...candidate,
                owner_resolution: { source: 'graph_ssot', status: 'ignored', reason: 'speaker_label_is_not_people_ssot' }
            };
        }
        if (isGenericOwnerHint(ownerHint)) {
            return {
                ...candidate,
                owner_candidates: [],
                owner_resolution: { source: 'graph_ssot', status: 'unresolved', reason: 'generic_owner_hint_requires_human_selection' }
            };
        }

        const queries = ownerHintSearchQueries(ownerHint);
        if (!queries.length) return candidate;
        const lookup = await this.lookupPeople({ access, projectId, queries, cache });
        if (lookup.status === 'unavailable') {
            return {
                ...candidate,
                owner_resolution: { source: 'graph_ssot', status: 'unresolved', reason: 'people_ssot_unavailable' }
            };
        }

        const ownerCandidates = sortTaskOwnerCandidates(
            mergeTaskOwnerPeople(lookup.people, contextPeople)
                .map((person) => taskOwnerCandidatePayload(person, ownerHint, projectId))
                .filter((person) => person.match !== 'search_result')
        );
        const selectedCandidate = confidentlySelectedTaskOwnerCandidate(ownerCandidates);
        if (selectedCandidate) {
            return {
                ...candidate,
                selected_owner_id: selectedCandidate.person_id,
                selected_owner: selectedCandidate.display_name,
                owner_candidates: ownerCandidates,
                owner_resolution: {
                    source: 'graph_ssot',
                    status: 'resolved',
                    confidence: selectedCandidate.match === 'exact_name_or_alias' ? 1 : 0.9,
                    reason: ownerCandidates.length === 1
                        ? (selectedCandidate.match === 'exact_name_or_alias' ? 'unique_exact_name_or_alias' : 'unique_partial_name_or_alias')
                        : 'context_ranked_owner_hint'
                }
            };
        }

        return {
            ...candidate,
            owner_candidates: ownerCandidates,
            owner_resolution: {
                source: 'graph_ssot',
                status: ownerCandidates.length > 1 ? 'ambiguous' : 'unresolved',
                reason: ownerCandidates.length > 1 ? 'ambiguous_people_ssot_candidate' : 'no_people_ssot_candidate'
            }
        };
    }

    async lookupPeople({ access, projectId, query = null, queries = null, ids = null, cache }) {
        const searchQueries = Array.isArray(queries) && queries.length ? queries : [query].filter(Boolean);
        const searchIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
        const projectCodeVariants = projectCodeLookupVariants(projectId);
        const cacheKey = `${projectCodeVariants.join(',')}:q:${searchQueries.join('|')}:id:${searchIds.join('|')}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);

        try {
            const recordsByKey = new Map();
            const addRecords = (records = []) => {
                for (const record of records) {
                    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
                    const key = record?.id || record?.entity_id || payload.person_id || payload.id || JSON.stringify(record);
                    if (!recordsByKey.has(key)) recordsByKey.set(key, record);
                }
            };
            for (const id of searchIds) {
                let scopedRecords = [];
                for (const projectCode of projectCodeVariants) {
                    const records = await this.infoSSOTService.listGraphEntities(access, {
                        projectCode,
                        entityType: 'person',
                        id,
                        limit: 1
                    });
                    addRecords(records);
                    scopedRecords = scopedRecords.concat(Array.isArray(records) ? records : []);
                }
                if (!scopedRecords.length || !projectCodeVariants.length) {
                    addRecords(await this.infoSSOTService.listGraphEntities(access, {
                        entityType: 'person',
                        id,
                        limit: 1
                    }));
                }
            }
            for (const searchQuery of searchQueries) {
                for (const projectCode of projectCodeVariants) {
                    addRecords(await this.infoSSOTService.listGraphEntities(access, {
                        projectCode,
                        entityType: 'person',
                        query: searchQuery,
                        limit: 20
                    }));
                }
                addRecords(await this.infoSSOTService.listGraphEntities(access, {
                    entityType: 'person',
                    query: searchQuery,
                    limit: 20
                }));
            }
            const people = Array.from(recordsByKey.values()).map(normalizeTaskOwnerPerson).filter(Boolean);
            const result = { status: 'ok', people };
            cache.set(cacheKey, result);
            return result;
        } catch {
            const result = { status: 'unavailable', people: [] };
            cache.set(cacheKey, result);
            return result;
        }
    }
}
