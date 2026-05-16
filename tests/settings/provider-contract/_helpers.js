// @ts-check
export function xProvider() {
    return {
        service: 'x',
        authMethods: ['oauth2_pkce'],
        capabilities: ['post', 'read'],
        publicMetadataSchema: { external_handle: 'string' },
        credentialKeySpec: ['access_token', 'refresh_token']
    };
}

export function slackProvider() {
    return {
        service: 'slack',
        authMethods: ['oauth2_confidential'],
        capabilities: ['post', 'read', 'notify'],
        publicMetadataSchema: { workspace_id: 'string' },
        credentialKeySpec: ['bot_token']
    };
}
