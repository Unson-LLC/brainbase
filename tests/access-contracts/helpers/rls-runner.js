const REQUIRED_JWT_FIELDS = ['sub', 'role', 'level', 'clearance', 'projectCodes'];
const REQUIRED_ENTITY_FIELDS = [
  'storage',
  'visibility',
  'org_ids',
  'project_ids',
  'team_id',
  'owner_person_id',
  'sensitivity',
  'role_min',
  'agency_level',
];

const ROLE_RANK = {
  member: 1,
  gm: 3,
  ceo: 4,
};

const SENSITIVITY_RANK = {
  internal: 1,
  restricted: 2,
  confidential: 3,
  'top-secret': 4,
};

const PROJECT_TO_ORG = {
  brainbase: 'unson',
  unson: 'unson',
  salestailor: 'salestailor',
  techknight: 'techknight',
  baao: 'baao',
};

class ACLFieldMissing extends Error {
  constructor(field) {
    super(`ACLFieldMissing: ${field}`);
    this.name = 'ACLFieldMissing';
  }
}

class JWTMalformed extends Error {
  constructor(field) {
    super(`JWTMalformed: ${field}`);
    this.name = 'JWTMalformed';
  }
}

function assertJwt(jwt) {
  for (const field of REQUIRED_JWT_FIELDS) {
    if (!(field in jwt)) {
      throw new JWTMalformed(field);
    }
  }
  if (!Array.isArray(jwt.clearance)) {
    throw new JWTMalformed('clearance');
  }
  if (!Array.isArray(jwt.projectCodes)) {
    throw new JWTMalformed('projectCodes');
  }
}

function assertEntity(entity) {
  for (const field of REQUIRED_ENTITY_FIELDS) {
    if (!(field in entity)) {
      throw new ACLFieldMissing(field);
    }
  }
  if (!Array.isArray(entity.org_ids)) {
    throw new ACLFieldMissing('org_ids');
  }
  if (!Array.isArray(entity.project_ids)) {
    throw new ACLFieldMissing('project_ids');
  }
}

function actorOrgIds(jwt) {
  return new Set(jwt.projectCodes.map((projectCode) => PROJECT_TO_ORG[projectCode]).filter(Boolean));
}

function intersects(left, right) {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function maxClearanceRank(jwt) {
  return Math.max(...jwt.clearance.map((clearance) => SENSITIVITY_RANK[clearance] ?? 0));
}

function hasVisibilityAccess(jwt, entity) {
  switch (entity.visibility) {
    case 'public':
      return { allow: true, reason: 'public visibility' };
    case 'owner':
      if (entity.owner_person_id && entity.owner_person_id === (jwt.person_id ?? jwt.sub)) {
        return { allow: true, reason: 'owner match' };
      }
      return { allow: false, reason: 'owner mismatch' };
    case 'team':
      if (entity.team_id && (jwt.team_ids ?? []).includes(entity.team_id)) {
        return { allow: true, reason: 'team match' };
      }
      return { allow: false, reason: 'team mismatch' };
    case 'org':
      if (intersects(entity.org_ids, Array.from(actorOrgIds(jwt)))) {
        return { allow: true, reason: 'org intersection' };
      }
      return { allow: false, reason: 'org mismatch' };
    default:
      return { allow: false, reason: 'unknown visibility' };
  }
}

export function canRetrieve(jwt, entity) {
  assertJwt(jwt);
  assertEntity(entity);

  if (entity.storage === 'candidate-store') {
    return { allow: false, reason: 'candidate-store-isolated' };
  }

  if (entity.visibility !== 'public' && entity.org_ids.length === 0) {
    return { allow: false, reason: 'org_ids empty default deny' };
  }

  const visibility = hasVisibilityAccess(jwt, entity);
  if (!visibility.allow) {
    return visibility;
  }

  const entitySensitivity = SENSITIVITY_RANK[entity.sensitivity] ?? Number.POSITIVE_INFINITY;
  if (entitySensitivity > maxClearanceRank(jwt)) {
    return { allow: false, reason: 'sensitivity exceeds clearance' };
  }

  const entityRoleMin = ROLE_RANK[entity.role_min] ?? Number.POSITIVE_INFINITY;
  const actorRoleRank = Number.isFinite(jwt.level) ? jwt.level : ROLE_RANK[jwt.role];
  if (entityRoleMin > actorRoleRank) {
    return { allow: false, reason: 'role_min exceeds actor role' };
  }

  if (entity.visibility !== 'public' && entity.project_ids.length > 0 && !intersects(entity.project_ids, jwt.projectCodes)) {
    return { allow: false, reason: 'project mismatch' };
  }

  if (entity.channel_id) {
    const channelIds = jwt.permission_snapshot?.channel_ids ?? [];
    if (!channelIds.includes(entity.channel_id)) {
      return { allow: false, reason: 'channel membership missing' };
    }
  }

  return { allow: true, reason: visibility.reason };
}

export function canRetrieveForSynthesis(jwt, entity) {
  const retrieval = canRetrieve(jwt, entity);
  if (!retrieval.allow) {
    return retrieval;
  }
  if (entity.agency_level === 'none') {
    return { allow: false, reason: 'agency_level none excludes synthesis' };
  }
  return { allow: true, reason: `synthesis ${entity.agency_level}` };
}

export { ACLFieldMissing, JWTMalformed, PROJECT_TO_ORG, ROLE_RANK, SENSITIVITY_RANK };
