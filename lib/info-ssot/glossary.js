export const parseGlossaryAliases = (patterns) => String(patterns || '')
  .split(/[,、，]/)
  .map((value) => value.trim())
  .filter(Boolean);
