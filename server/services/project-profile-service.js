// @ts-check
import { AppError, ErrorCodes } from '../lib/errors.js';

export const CAPABILITY_DESIRED_STATES = Object.freeze([
    'enabled',
    'disabled',
    'deferred',
    'unspecified'
]);

const DEFAULT_CAPABILITIES = Object.freeze(['mana', 'slack', 'github', 'drive']);

function crossTenantCandidateError() {
    return new AppError('別組織に属する関係者候補は追加できません', ErrorCodes.CROSS_TENANT_CANDIDATE, {
        details: {
            required_action: 'none',
            audit_event: 'cross_tenant_candidate_denied'
        }
    });
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireString(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${field}は必須です`);
    }
    return value.trim();
}

function optionalString(value, field) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${field}は空でない文字列で指定してください`);
    }
    return value.trim();
}

function validateCapabilityFields(name, capability, { allowVerification = false } = {}) {
    const normalized = { ...capability };
    for (const field of ['reason', 'organization', 'primary_channel_id', 'folder_id', 'owner', 'repo']) {
        const value = optionalString(normalized[field], `capabilities.${name}.${field}`);
        if (value !== undefined) normalized[field] = value;
    }
    if (normalized.verification !== undefined && !allowVerification) {
        throw new Error(`capabilities.${name}.verificationは信頼済み検証器だけが設定できます`);
    }
    if (normalized.verification !== undefined && !isRecord(normalized.verification)) {
        throw new Error(`capabilities.${name}.verificationはオブジェクト形式で指定してください`);
    }
    return normalized;
}

/**
 * @param {unknown} capabilities
 * @param {{ allowVerification?: boolean }} [options]
 * @returns {Record<string, Record<string, any>>}
 */
export function normalizeCapabilities(capabilities, options = {}) {
    if (capabilities === undefined || capabilities === null) return {};
    if (!isRecord(capabilities)) throw new Error('capabilitiesはオブジェクト形式で指定してください');

    return Object.fromEntries(Object.entries(capabilities).map(([name, raw]) => {
        if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
            throw new Error(`能力名「${name}」の形式が不正です`);
        }
        if (!isRecord(raw)) throw new Error(`capabilities.${name}はオブジェクト形式で指定してください`);
        const desiredState = raw.desired_state ?? 'unspecified';
        if (!CAPABILITY_DESIRED_STATES.includes(desiredState)) {
            throw new Error(`能力「${name}」のdesired_state「${desiredState}」は使用できません`);
        }
        return [name, validateCapabilityFields(name, { ...raw, desired_state: desiredState }, options)];
    }));
}

/**
 * @param {Record<string, any>} input
 */
export function validateProjectCreateInput(input) {
    if (!isRecord(input)) throw new Error('Project入力はオブジェクト形式で指定してください');
    const projectCode = requireString(input.project_code ?? input.id, 'project_code');
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectCode)) {
        throw new Error('project_codeは半角小文字・数字・ハイフン・アンダースコアで指定してください');
    }
    if (input.id && input.project_code && input.id !== input.project_code) {
        throw new Error('idとproject_codeは同じ値にしてください');
    }

    return {
        project_code: projectCode,
        name: requireString(input.name, 'name'),
        organization: requireString(input.organization, 'organization'),
        created_by: requireString(input.created_by, 'created_by'),
        capabilities: normalizeCapabilities(input.capabilities),
        ...(input.people === undefined ? {} : { people: validatePeople(input.people) })
    };
}

/**
 * @param {unknown} people
 */
export function validatePeople(people) {
    if (!isRecord(people)) throw new Error('peopleはオブジェクト形式で指定してください');
    const teamStatus = people.team_status ?? 'incomplete';
    if (!['complete', 'incomplete', 'unspecified'].includes(teamStatus)) {
        throw new Error(`people.team_status「${teamStatus}」は使用できません`);
    }
    const normalized = { ...people, team_status: teamStatus };
    for (const key of ['owner', 'team', 'external']) {
        if (normalized[key] !== undefined && !Array.isArray(normalized[key])) {
            throw new Error(`people.${key}は配列で指定してください`);
        }
        normalized[key]?.forEach((member, index) => {
            if (typeof member === 'string' && member.trim()) return;
            if (isRecord(member)) {
                requireString(member.person_id ?? member.id, `people.${key}[${index}].person_id`);
                optionalString(member.organization, `people.${key}[${index}].organization`);
                return;
            }
            throw new Error(`people.${key}[${index}]は人物を識別できる値で指定してください`);
        });
    }
    return normalized;
}

/**
 * 入力に別organization所属が明示されている場合だけ拒否する。
 * 所属情報がない参照は推測せず、inspectのunverifiedに残す。
 * @param {string} organization
 * @param {Record<string, Record<string, any>>} capabilities
 * @param {Record<string, any>|undefined} people
 */
export function assertNoDeclaredCrossTenantReferences(organization, capabilities, people) {
    for (const [name, capability] of Object.entries(capabilities || {})) {
        if (capability.organization && capability.organization !== organization) {
            throw new Error(`capabilities.${name}は別のorganizationに属しています`);
        }
        if (capability.tenant_validation?.status === 'mismatch') {
            throw new Error(`capabilities.${name}のtenant検証に失敗しました`);
        }
    }

    for (const role of ['owner', 'team', 'external']) {
        const members = Array.isArray(people?.[role]) ? people[role] : [];
        for (const member of members) {
            if (isRecord(member) && member.organization && member.organization !== organization) {
                throw new Error(`people.${role}に別のorganizationの人物が含まれています`);
            }
        }
    }
}

/**
 * @param {Record<string, any>} project
 * @param {string} name
 * @param {Record<string, any>} capability
 */
function missingRequirements(project, name, capability) {
    if (name === 'slack') {
        return capability.primary_channel_id ? [] : ['primary_channel_id'];
    }
    if (name === 'github') {
        const github = { ...(project.github || {}), ...capability };
        return ['owner', 'repo'].filter(field => !github[field]);
    }
    if (name === 'drive') {
        return capability.folder_id ? [] : ['folder_id'];
    }
    if (name === 'mana') {
        const slack = project.capabilities?.slack || {};
        const missing = [];
        if (slack.desired_state !== 'enabled') missing.push('slack.desired_state=enabled');
        if (!slack.primary_channel_id) missing.push('slack.primary_channel_id');
        return missing;
    }
    return [];
}

function hasTrustedVerification(capability) {
    const verification = capability.verification;
    return isRecord(verification)
        && verification.status === 'verified'
        && typeof verification.evidence_id === 'string'
        && verification.evidence_id.trim().length > 0
        && typeof verification.verified_at === 'string'
        && !Number.isNaN(Date.parse(verification.verified_at));
}

/**
 * 能力ごとの状態を返す。Project全体のready/not_readyは返さない。
 * @param {Record<string, any>} project
 */
export function inspectProjectProfile(project) {
    const configured = isRecord(project.capabilities) ? project.capabilities : {};
    const names = [...new Set([...DEFAULT_CAPABILITIES, ...Object.keys(configured)])].sort();
    const warnings = [];
    const capabilities = {};

    for (const name of names) {
        const capability = isRecord(configured[name]) ? configured[name] : {};
        const desiredState = capability.desired_state ?? 'unspecified';

        if (desiredState === 'disabled' || desiredState === 'deferred') {
            capabilities[name] = desiredState;
            continue;
        }
        if (desiredState === 'unspecified') {
            capabilities[name] = 'warning';
            warnings.push({
                code: 'capability_intent_unspecified',
                capability: name,
                message: `${name}の利用方針が未指定です`
            });
            continue;
        }
        if (!CAPABILITY_DESIRED_STATES.includes(desiredState)) {
            capabilities[name] = 'warning';
            warnings.push({
                code: 'capability_intent_invalid',
                capability: name,
                desired_state: desiredState,
                message: `${name}の利用方針が不正です`
            });
            continue;
        }

        const missing = missingRequirements(project, name, capability);
        capabilities[name] = missing.length > 0
            ? 'unconfigured'
            : hasTrustedVerification(capability) ? 'ready' : 'unverified';
        if (missing.length > 0) {
            warnings.push({
                code: 'enabled_capability_unconfigured',
                capability: name,
                missing,
                message: `${name}は有効ですが、必要な設定または検証が不足しています`
            });
        } else if (capabilities[name] === 'unverified') {
            warnings.push({
                code: 'enabled_capability_unverified',
                capability: name,
                message: `${name}は設定済みですが、実接続の検証証跡がありません`
            });
        }
    }

    const people = isRecord(project.people) ? project.people : {};
    const ownerCount = Array.isArray(people.owner) ? people.owner.length : 0;
    const peopleComplete = people.team_status === 'complete' && ownerCount > 0;
    // 人物の実テナント帰属を確認する外部検証器は未実装のため、
    // 構成が完了していても未検証の参照をreadyとして扱わない。
    const peopleStatus = peopleComplete ? 'unverified' : 'warning';
    if (!peopleComplete) {
        warnings.push({
            code: 'people_incomplete',
            capability: 'people',
            message: '関係者構成が未完了です'
        });
    } else {
        warnings.push({
            code: 'people_unverified',
            capability: 'people',
            message: '関係者構成は完了していますが、人物の実テナント帰属の検証証跡がありません'
        });
    }
    const hasSuccessCriteria = Array.isArray(project.success_criteria)
        ? project.success_criteria.length > 0
        : typeof project.success_criteria === 'string' && project.success_criteria.trim().length > 0;
    if (!hasSuccessCriteria) {
        warnings.push({
            code: 'success_criteria_unspecified',
            capability: 'core',
            message: '成功条件が未記入です'
        });
    }

    return {
        project_code: project.project_code || project.id,
        project: 'registered',
        capabilities: {
            core: 'ready',
            ...capabilities,
            people: peopleStatus
        },
        warnings,
        verification_scope: {
            local_catalog: 'confirmed',
            graph_registration: 'unverified',
            authorization_grants: 'unverified',
            cross_tenant_references: 'unverified'
        }
    };
}

/**
 * @param {Record<string, any>} project
 * @param {unknown} rawCandidates
 */
export function reconcileProjectPeople(project, rawCandidates) {
    if (!Array.isArray(rawCandidates)) throw new Error('people_candidatesは配列で指定してください');
    const people = isRecord(project.people) ? project.people : {};
    const registered = new Set(['owner', 'team', 'external']
        .flatMap(role => Array.isArray(people[role]) ? people[role] : [])
        .map(person => typeof person === 'string' ? person : person?.person_id ?? person?.id)
        .filter(Boolean));

    const candidates = rawCandidates.map((candidate, index) => {
        if (!isRecord(candidate)) throw new Error(`people_candidates[${index}]はオブジェクト形式で指定してください`);
        const personId = requireString(candidate.person_id ?? candidate.id, `people_candidates[${index}].person_id`);
        const projectOrganization = project.organization;
        const candidateOrganization = candidate.organization;
        if (typeof projectOrganization === 'string' && projectOrganization.trim()
            && typeof candidateOrganization === 'string' && candidateOrganization.trim()
            && candidateOrganization !== projectOrganization) {
            throw crossTenantCandidateError();
        }
        return {
            ...candidate,
            person_id: personId,
            status: registered.has(personId) ? 'already_registered' : 'candidate',
            actions: registered.has(personId)
                ? []
                : ['add', 'add_as_external', 'exclude', 'defer']
        };
    });

    return {
        project_code: project.project_code || project.id,
        candidates,
        summary: {
            candidates: candidates.filter(candidate => candidate.status === 'candidate').length,
            already_registered: candidates.filter(candidate => candidate.status === 'already_registered').length
        }
    };
}
