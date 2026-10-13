/** @typedef {{ role: string, projectCodes: string[], clearance: string[], organizationId?: string | null, tenantId?: string | null, personId?: string | null, graphMaintenanceMode?: boolean }} AccessContext */

function buildAccessContext(req) {
  if (!req.access) {
    const error = new Error('Authenticated access context required');
    error.status = 401;
    throw error;
  }
  return req.access;
}

function assertAccessContext(access) {
  if (!access.role) throw Object.assign(new Error('Access role is required'), { status: 400 });
  if (!Array.isArray(access.projectCodes) || access.projectCodes.length === 0) {
    throw Object.assign(new Error('Access project list is required'), { status: 400 });
  }
  if (!Array.isArray(access.clearance) || access.clearance.length === 0) {
    throw Object.assign(new Error('Access clearance is required'), { status: 400 });
  }
}

function resolveErrorStatus(error) {
  return Number.isInteger(error?.status) ? error.status : 500;
}

export function createInfoSsotController({ infoSSOTService }) {
  return {
    listGraphEntities: async (req, res) => {
      try {
        const access = buildAccessContext(req);
        assertAccessContext(access);
        const page = await infoSSOTService.listGraphEntities(access, {
          id: req.query?.id || null,
          projectCode: req.query?.project || null,
          entityType: req.query?.type || null,
          query: req.query?.query || null,
          limit: req.query?.limit ?? null,
          cursor: req.query?.cursor ?? null
        });
        res.json({ records: page.records, next_cursor: page.next_cursor ?? null });
      } catch (error) {
        const status = resolveErrorStatus(error);
        res.status(status).json({
          error: status === 400 || status === 401 ? error.message : 'Failed to list graph entities'
        });
      }
    }
  };
}
