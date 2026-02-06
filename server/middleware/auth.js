export function requireAuth(authService) {
    return (req, res, next) => {
        try {
            if (req.method === 'OPTIONS') {
                return next();
            }
            const header = req.headers.authorization || '';
            const token = header.startsWith('Bearer ') ? header.slice(7) : null;
            if (!token) {
                return res.status(401).json({ error: 'Authorization token required' });
            }
            const decoded = authService.verifyToken(token);
            const access = {
                role: decoded.role,
                projectCodes: decoded.projectCodes || [],
                clearance: decoded.clearance || [],
                personId: decoded.personId || null,
                slackUserId: decoded.slackUserId || null,
                slackWorkspaceId: decoded.slackWorkspaceId || null
            };
            req.auth = decoded;
            req.access = access;
            return next();
        } catch (error) {
            return res.status(401).json({ error: 'Invalid token' });
        }
    };
}
