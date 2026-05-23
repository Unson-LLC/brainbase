export const ownershipServiceMethods = {
    _normalizeString(value) {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        return trimmed || null;
    },

    _normalizeViewerId(viewerId) {
        return this._normalizeString(viewerId);
    },

    _normalizeViewerLabel(viewerLabel) {
        return this._normalizeString(viewerLabel);
    },

    _getTerminalOwnerEntry(sessionId) {
        const owner = this.terminalOwners.get(sessionId);
        if (!owner) return null;

        if (Date.now() - owner.lastSeenAt > this.TERMINAL_OWNER_TTL_MS) {
            this.terminalOwners.delete(sessionId);
            return null;
        }

        return owner;
    },

    _buildTerminalAccessState(owner, viewerId) {
        if (!owner) {
            return {
                state: 'available',
                ownerViewerLabel: null,
                ownerLastSeenAt: null,
                canTakeover: false
            };
        }

        const isOwner = owner.viewerId === viewerId;
        return {
            state: isOwner ? 'owner' : 'blocked',
            ownerViewerLabel: owner.viewerLabel || null,
            ownerLastSeenAt: new Date(owner.lastSeenAt).toISOString(),
            canTakeover: !isOwner
        };
    },

    getTerminalAccessState(sessionId, viewerId) {
        const normalizedViewerId = this._normalizeViewerId(viewerId);
        const owner = this._getTerminalOwnerEntry(sessionId);
        return this._buildTerminalAccessState(owner, normalizedViewerId);
    },

    getTerminalOwnerSnapshot(sessionId) {
        const owner = this._getTerminalOwnerEntry(sessionId);
        if (!owner) return null;
        return {
            ownerViewerId: owner.viewerId,
            ownerViewerLabel: owner.viewerLabel || null,
            claimedAt: new Date(owner.claimedAt).toISOString(),
            lastSeenAt: new Date(owner.lastSeenAt).toISOString()
        };
    },

    claimTerminalOwnership(sessionId, viewerId, viewerLabel) {
        const normalizedViewerId = this._normalizeViewerId(viewerId);
        if (!sessionId || !normalizedViewerId) return null;

        const now = Date.now();
        const owner = {
            viewerId: normalizedViewerId,
            viewerLabel: this._normalizeViewerLabel(viewerLabel),
            claimedAt: now,
            lastSeenAt: now
        };
        this.terminalOwners.set(sessionId, owner);
        return owner;
    },

    touchTerminalOwnership(sessionId, viewerId, viewerLabel = null) {
        const normalizedViewerId = this._normalizeViewerId(viewerId);
        if (!sessionId || !normalizedViewerId) return null;

        const owner = this._getTerminalOwnerEntry(sessionId);
        if (!owner || owner.viewerId !== normalizedViewerId) {
            return null;
        }

        owner.lastSeenAt = Date.now();
        if (viewerLabel) {
            owner.viewerLabel = this._normalizeViewerLabel(viewerLabel);
        }
        this.terminalOwners.set(sessionId, owner);
        return owner;
    },

    ensureTerminalOwnership(sessionId, viewerId, viewerLabel = null) {
        const normalizedViewerId = this._normalizeViewerId(viewerId);
        if (!sessionId || !normalizedViewerId) {
            return { allowed: false, terminalAccess: this._buildTerminalAccessState(this._getTerminalOwnerEntry(sessionId), normalizedViewerId) };
        }

        const currentOwner = this._getTerminalOwnerEntry(sessionId);
        if (!currentOwner) {
            const owner = this.claimTerminalOwnership(sessionId, normalizedViewerId, viewerLabel);
            return { allowed: true, owner, terminalAccess: this._buildTerminalAccessState(owner, normalizedViewerId) };
        }

        if (currentOwner.viewerId === normalizedViewerId) {
            const owner = this.touchTerminalOwnership(sessionId, normalizedViewerId, viewerLabel) || currentOwner;
            return { allowed: true, owner, terminalAccess: this._buildTerminalAccessState(owner, normalizedViewerId) };
        }

        return {
            allowed: false,
            owner: currentOwner,
            terminalAccess: this._buildTerminalAccessState(currentOwner, normalizedViewerId)
        };
    },

    forceTerminalOwnership(sessionId, viewerId, viewerLabel = null) {
        const owner = this.claimTerminalOwnership(sessionId, viewerId, viewerLabel);
        return {
            allowed: Boolean(owner),
            owner,
            terminalAccess: this._buildTerminalAccessState(owner, this._normalizeViewerId(viewerId))
        };
    },

    releaseTerminalOwnership(sessionId, viewerId, { force = false } = {}) {
        const normalizedViewerId = this._normalizeViewerId(viewerId);
        const owner = this._getTerminalOwnerEntry(sessionId);
        if (!owner) return false;
        if (!force && owner.viewerId !== normalizedViewerId) return false;
        this.terminalOwners.delete(sessionId);
        return true;
    }
};
