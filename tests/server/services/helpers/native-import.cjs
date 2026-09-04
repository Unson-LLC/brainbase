// Execute external-checkout ESM through Node, not Vitest's transformed loader.
module.exports = (specifier) => import(specifier);
