#!/usr/bin/env node
const port = process.env.BRAINBASE_PORT || process.env.PORT || '31013';
const rawCodes = process.argv.slice(2).join(',');
const projectCodes = rawCodes
  ? rawCodes.split(',').map((code) => code.trim()).filter(Boolean)
  : [];

const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input?.url;
  if (typeof url === 'string' && url.startsWith('/')) {
    return originalFetch(`http://127.0.0.1:${port}${url}`, init);
  }
  return originalFetch(input, init);
};

const projectMapping = await import('../public/modules/project-mapping.js');
await projectMapping.projectMappingReady;

const projects = projectMapping.getSessionSelectableProjects(projectCodes);
console.log(JSON.stringify({
  port,
  projectCodes,
  count: projects.length,
  projects
}, null, 2));
