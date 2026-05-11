import contextsFixture from '../fixtures/access-contexts.fixture.json' with { type: 'json' };

export function getContext(id) {
  const context = contextsFixture.access_contexts.find((entry) => entry.id === id);
  if (!context) {
    throw new Error(`Unknown access context: ${id}`);
  }
  return context;
}

export function getJwt(id) {
  return structuredClone(getContext(id).jwt);
}

export function jwtWith(overrides = {}) {
  return {
    ...getJwt('ctx-unson-only-member'),
    ...overrides,
  };
}
