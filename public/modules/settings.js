/**
 * settings.js - Settings page module
 *
 * Handles config visualization (Slack, Projects mappings).
 * Self-contained module with its own state.
 */

// --- Module State ---
let configData = null;
let integrityData = null;
let unifiedData = null;

// --- DOM Elements (initialized in init) ---
let settingsBtn = null;
let settingsModal = null;
let settingsView = null;
let closeSettingsBtn = null;
let settingsTabs = null;
let settingsPanels = null;

// --- Data Loading ---
async function loadConfigData() {
    try {
        const [configRes, integrityRes, unifiedRes] = await Promise.all([
            fetch('/api/config'),
            fetch('/api/config/integrity'),
            fetch('/api/config/unified')
        ]);

        configData = await configRes.json();
        integrityData = await integrityRes.json();
        unifiedData = await unifiedRes.json();

        renderIntegritySummary();
        renderUnifiedView();
        renderWorkspaces();
        renderChannels();
        renderMembers();
        renderProjects();
        renderGitHub();
        renderNocoDB();

    } catch (err) {
        console.error('Failed to load config:', err);
    }
}

// --- Render Functions ---
function renderIntegritySummary() {
    const container = document.getElementById('integrity-summary');
    if (!integrityData) {
        container.innerHTML = '<div class="config-empty">Failed to load integrity data</div>';
        return;
    }

    const { stats, summary, issues } = integrityData;

    let html = `
        <div class="integrity-stats">
            <div class="stat-item success">
                <span class="label">Workspaces</span>
                <span class="count">${stats.workspaces}</span>
            </div>
            <div class="stat-item success">
                <span class="label">Channels</span>
                <span class="count">${stats.channels}</span>
            </div>
            <div class="stat-item success">
                <span class="label">Members</span>
                <span class="count">${stats.members}</span>
            </div>
            <div class="stat-item success">
                <span class="label">Projects</span>
                <span class="count">${stats.projects}</span>
            </div>
            <div class="stat-item success">
                <span class="label">GitHub</span>
                <span class="count">${stats.github || 0}</span>
            </div>
            <div class="stat-item success">
                <span class="label">NocoDB</span>
                <span class="count">${stats.nocodb || 0}</span>
            </div>
            ${summary.errors > 0 ? `
                <div class="stat-item error">
                    <span class="label">Errors</span>
                    <span class="count">${summary.errors}</span>
                </div>
            ` : ''}
            ${summary.warnings > 0 ? `
                <div class="stat-item warning">
                    <span class="label">Warnings</span>
                    <span class="count">${summary.warnings}</span>
                </div>
            ` : ''}
        </div>
    `;

    if (issues.length > 0) {
        html += `
            <div class="integrity-issues">
                ${issues.map(issue => `
                    <div class="issue-item ${issue.severity}">
                        <i data-lucide="${issue.severity === 'error' ? 'alert-circle' : issue.severity === 'warning' ? 'alert-triangle' : 'info'}"></i>
                        <span>${issue.message}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    container.innerHTML = html;
}

function renderUnifiedView() {
    const container = document.getElementById('unified-view');
    if (!unifiedData) {
        container.innerHTML = '<div class="config-empty">Failed to load unified data</div>';
        return;
    }

    const { workspaces, orphanedChannels, orphanedProjects } = unifiedData;

    if (!workspaces || workspaces.length === 0) {
        container.innerHTML = '<div class="config-empty">No workspaces found</div>';
        return;
    }

    let html = '';

    // Render each workspace section
    for (const ws of workspaces) {
        html += `
            <div class="unified-workspace" data-workspace="${ws.key}">
                <h3 class="workspace-header">
                    <span class="workspace-name">${ws.name}</span>
                    <span class="workspace-id mono">${ws.id || '-'}</span>
                </h3>
        `;

        // Filter out archived projects
        const activeProjects = ws.projects.filter(p => !p.archived);

        if (activeProjects.length === 0) {
            html += '<div class="config-empty">No projects in this workspace</div>';
        } else {
            html += `
                <table class="config-table unified-table">
                    <thead>
                        <tr>
                            <th>Project</th>
                            <th>Slack Channels</th>
                            <th>GitHub</th>
                            <th>NocoDB</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            for (const proj of activeProjects) {
                const hasGithub = !!proj.github;
                const hasNocodb = !!proj.nocodb;
                const warningClass = (!hasGithub || !hasNocodb) ? 'warning-row' : '';

                html += `
                    <tr data-project="${proj.id}" class="${warningClass}">
                        <td><span class="badge badge-project">${proj.emoji ? proj.emoji + ' ' : ''}${proj.id}</span></td>
                        <td>
                            ${proj.channels.length > 0
                                ? proj.channels.slice(0, 3).map(ch =>
                                    `<span class="channel-tag" title="${ch.type}">#${ch.name}</span>`
                                ).join(' ')
                                : '<span class="status-missing">-</span>'
                            }
                            ${proj.channels.length > 3 ? `<span class="channel-count">+${proj.channels.length - 3}</span>` : ''}
                        </td>
                        <td class="${!hasGithub ? 'missing' : ''}">
                            ${hasGithub
                                ? `<a href="${proj.github.url}" target="_blank" class="config-link">${proj.github.owner}/${proj.github.repo}</a>
                                   ${proj.github.paths && proj.github.paths.length > 0
                                       ? `<span class="paths-hint">[${proj.github.paths.slice(0, 2).join(', ')}${proj.github.paths.length > 2 ? '...' : ''}]</span>`
                                       : ''
                                   }`
                                : '<span class="status-missing">❌ 未設定</span>'
                            }
                        </td>
                        <td class="${!hasNocodb ? 'missing' : ''}">
                            ${hasNocodb
                                ? `<a href="${proj.nocodb.url}" target="_blank" class="config-link">${proj.nocodb.base_name}</a>`
                                : '<span class="status-missing">❌ 未設定</span>'
                            }
                        </td>
                    </tr>
                `;
            }

            html += '</tbody></table>';
        }

        html += '</div>';
    }

    // Orphaned items section
    if ((orphanedProjects && orphanedProjects.length > 0) || (orphanedChannels && orphanedChannels.length > 0)) {
        html += `
            <div class="unified-orphans">
                <h3 class="orphans-header">⚠️ Orphaned Items</h3>
        `;

        if (orphanedProjects && orphanedProjects.length > 0) {
            html += `
                <div class="orphan-section">
                    <h4>Unassigned Projects</h4>
                    <ul>
                        ${orphanedProjects.map(p =>
                            `<li><span class="badge badge-project">${p.id}</span> (GitHub: ${p.hasGithub ? '✅' : '❌'}, NocoDB: ${p.hasNocodb ? '✅' : '❌'}, Channels: ${p.channelCount})</li>`
                        ).join('')}
                    </ul>
                </div>
            `;
        }

        if (orphanedChannels && orphanedChannels.length > 0) {
            html += `
                <div class="orphan-section">
                    <h4>Unmapped Channels</h4>
                    <ul>
                        ${orphanedChannels.map(ch =>
                            `<li>#${ch.name} (${ch.workspace}) → ${ch.project_id || 'no project'}</li>`
                        ).join('')}
                    </ul>
                </div>
            `;
        }

        html += '</div>';
    }

    container.innerHTML = html;
}

function renderWorkspaces() {
    const container = document.getElementById('workspaces-list');
    const workspaces = configData?.slack?.workspaces || {};
    const channels = configData?.slack?.channels || [];

    if (Object.keys(workspaces).length === 0) {
        container.innerHTML = '<div class="config-empty">No workspaces found</div>';
        return;
    }

    // Count channels per workspace
    const channelCounts = {};
    channels.forEach(ch => {
        channelCounts[ch.workspace] = (channelCounts[ch.workspace] || 0) + 1;
    });

    const html = Object.entries(workspaces).map(([key, ws]) => `
        <div class="config-card">
            <div class="config-card-header">
                <h4>${ws.name}</h4>
                ${ws.default ? '<span class="badge badge-type">Default</span>' : ''}
            </div>
            <div class="config-card-id">${ws.id}</div>
            <div class="config-card-stats">
                <div class="config-card-stat">
                    <i data-lucide="hash"></i>
                    <span>${channelCounts[key] || 0} channels</span>
                </div>
                <div class="config-card-stat">
                    <i data-lucide="folder"></i>
                    <span>${(ws.projects || []).length} projects</span>
                </div>
            </div>
        </div>
    `).join('');

    container.innerHTML = html;

    // Populate workspace filter
    const workspaceFilter = document.getElementById('workspace-filter');
    workspaceFilter.innerHTML = '<option value="">All Workspaces</option>' +
        Object.entries(workspaces).map(([key, ws]) =>
            `<option value="${key}">${ws.name}</option>`
        ).join('');
}

function renderChannels(filter = '', workspaceFilter = '') {
    const container = document.getElementById('channels-list');
    let channels = configData?.slack?.channels || [];

    if (channels.length === 0) {
        container.innerHTML = '<div class="config-empty">No channels found</div>';
        return;
    }

    // Apply filters
    if (filter) {
        const lowerFilter = filter.toLowerCase();
        channels = channels.filter(ch =>
            ch.channel_name.toLowerCase().includes(lowerFilter) ||
            ch.project_id.toLowerCase().includes(lowerFilter)
        );
    }
    if (workspaceFilter) {
        channels = channels.filter(ch => ch.workspace === workspaceFilter);
    }

    const html = `
        <table class="config-table">
            <thead>
                <tr>
                    <th>Channel</th>
                    <th>Workspace</th>
                    <th>Project</th>
                    <th>Type</th>
                    <th>ID</th>
                </tr>
            </thead>
            <tbody>
                ${channels.map(ch => `
                    <tr>
                        <td>#${ch.channel_name}</td>
                        <td><span class="badge badge-workspace">${ch.workspace}</span></td>
                        <td><span class="badge badge-project">${ch.project_id}</span></td>
                        <td><span class="badge badge-type">${ch.type || '-'}</span></td>
                        <td class="mono">${ch.channel_id}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function renderMembers(filter = '') {
    const container = document.getElementById('members-list');
    let members = configData?.slack?.members || [];

    if (members.length === 0) {
        container.innerHTML = '<div class="config-empty">No members found</div>';
        return;
    }

    // Apply filter
    if (filter) {
        const lowerFilter = filter.toLowerCase();
        members = members.filter(m =>
            m.slack_name.toLowerCase().includes(lowerFilter) ||
            m.brainbase_name.toLowerCase().includes(lowerFilter)
        );
    }

    const html = `
        <table class="config-table">
            <thead>
                <tr>
                    <th>Slack Name</th>
                    <th>Brainbase Name</th>
                    <th>Workspace</th>
                    <th>Slack ID</th>
                    <th>Note</th>
                </tr>
            </thead>
            <tbody>
                ${members.map(m => `
                    <tr>
                        <td>@${m.slack_name}</td>
                        <td>${m.brainbase_name}</td>
                        <td><span class="badge badge-workspace">${m.workspace}</span></td>
                        <td class="mono">${m.slack_id}</td>
                        <td class="mono">${m.note || '-'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function renderProjects() {
    const container = document.getElementById('projects-list');
    const allProjects = configData?.projects?.projects || [];
    const root = configData?.projects?.root || '';

    // Filter out archived projects
    const projects = allProjects.filter(p => !p.archived);

    if (projects.length === 0) {
        container.innerHTML = '<div class="config-empty">No projects found</div>';
        return;
    }

    const html = `
        <table class="config-table">
            <thead>
                <tr>
                    <th>Project ID</th>
                    <th>Local Path</th>
                    <th>Included Globs</th>
                </tr>
            </thead>
            <tbody>
                ${projects.map(p => `
                    <tr>
                        <td><span class="badge badge-project">${p.emoji ? p.emoji + ' ' : ''}${p.id}</span></td>
                        <td class="mono">${root}/${p.local?.path || '-'}</td>
                        <td class="mono">${(p.local?.glob_include || []).slice(0, 3).join(', ')}${(p.local?.glob_include || []).length > 3 ? '...' : ''}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function renderGitHub() {
    const container = document.getElementById('github-list');
    const github = configData?.github || [];

    if (github.length === 0) {
        container.innerHTML = '<div class="config-empty">No GitHub mappings found</div>';
        return;
    }

    const html = `
        <table class="config-table">
            <thead>
                <tr>
                    <th>Project ID</th>
                    <th>Owner</th>
                    <th>Repository</th>
                    <th>Branch</th>
                    <th>URL</th>
                </tr>
            </thead>
            <tbody>
                ${github.map(g => `
                    <tr>
                        <td><span class="badge badge-project">${g.project_id}</span></td>
                        <td class="mono">${g.owner}</td>
                        <td class="mono">${g.repo}</td>
                        <td><span class="badge badge-type">${g.branch}</span></td>
                        <td><a href="${g.url}" target="_blank" class="config-link">${g.url}</a></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function renderAirtable() {
    const container = document.getElementById('airtable-list');
    const airtable = configData?.airtable || [];

    if (airtable.length === 0) {
        container.innerHTML = '<div class="config-empty">No Airtable mappings found</div>';
        return;
    }

    const html = `
        <table class="config-table">
            <thead>
                <tr>
                    <th>Project ID</th>
                    <th>Base Name</th>
                    <th>Base ID</th>
                    <th>URL</th>
                </tr>
            </thead>
            <tbody>
                ${airtable.map(a => `
                    <tr>
                        <td><span class="badge badge-project">${a.project_id}</span></td>
                        <td>${a.base_name}</td>
                        <td class="mono">${a.base_id}</td>
                        <td><a href="${a.url}" target="_blank" class="config-link">${a.url}</a></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function renderNocoDB() {
    const container = document.getElementById('nocodb-list');
    const nocodb = configData?.nocodb || [];

    if (nocodb.length === 0) {
        container.innerHTML = '<div class="config-empty">No NocoDB mappings found</div>';
        return;
    }

    const html = `
        <table class="config-table">
            <thead>
                <tr>
                    <th>Project ID</th>
                    <th>Base Name</th>
                    <th>Base ID</th>
                    <th>URL</th>
                </tr>
            </thead>
            <tbody>
                ${nocodb.map(n => `
                    <tr>
                        <td><span class="badge badge-project">${n.project_id}</span></td>
                        <td>${n.base_name}</td>
                        <td class="mono">${n.base_id}</td>
                        <td><a href="${n.url}" target="_blank" class="config-link">${n.url}</a></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    // Open settings modal
    settingsBtn?.addEventListener('click', async () => {
        settingsModal.classList.add('active');
        settingsBtn.classList.add('active');

        // Load config data
        await loadConfigData();

        // Re-init lucide icons for new content
        lucide.createIcons();
    });

    // Close settings modal via X button
    closeSettingsBtn?.addEventListener('click', () => {
        settingsModal.classList.remove('active');
        settingsBtn.classList.remove('active');
    });

    // Close settings modal via backdrop click
    settingsModal?.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('active');
            settingsBtn.classList.remove('active');
        }
    });

    // Tab switching
    settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // Update tab active state
            settingsTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update panel visibility
            settingsPanels.forEach(panel => {
                panel.classList.remove('active');
                if (panel.id === `${targetTab}-panel`) {
                    panel.classList.add('active');
                }
            });
        });
    });

    // Filter event listeners
    document.getElementById('channel-filter')?.addEventListener('input', (e) => {
        const workspaceFilterValue = document.getElementById('workspace-filter')?.value || '';
        renderChannels(e.target.value, workspaceFilterValue);
    });

    document.getElementById('workspace-filter')?.addEventListener('change', (e) => {
        const textFilter = document.getElementById('channel-filter')?.value || '';
        renderChannels(textFilter, e.target.value);
    });

    document.getElementById('member-filter')?.addEventListener('input', (e) => {
        renderMembers(e.target.value);
    });
}

// --- Public API ---

/**
 * Initialize settings module
 * Call this after DOMContentLoaded
 */
export function initSettings() {
    // Get DOM elements
    settingsBtn = document.getElementById('settings-btn');
    settingsModal = document.getElementById('settings-modal');
    settingsView = document.getElementById('settings-view');
    closeSettingsBtn = document.getElementById('close-settings-btn');
    settingsTabs = document.querySelectorAll('.settings-tab');
    settingsPanels = document.querySelectorAll('.settings-panel');

    // Setup event listeners
    setupEventListeners();
}

/**
 * Open settings view (callable from outside)
 */
export async function openSettings() {
    if (settingsModal) {
        settingsModal.classList.add('active');
        if (settingsBtn) {
            settingsBtn.classList.add('active');
        }
        // Load config data
        await loadConfigData();
        // Re-init lucide icons for new content
        lucide.createIcons();
    }
}

/**
 * Close settings view (callable from outside)
 */
export function closeSettings() {
    if (settingsModal && settingsBtn) {
        settingsModal.classList.remove('active');
        settingsBtn.classList.remove('active');
    }
}

/**
 * Check if settings view is open
 */
export function isSettingsOpen() {
    return settingsModal?.classList.contains('active');
}
