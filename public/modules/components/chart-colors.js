const SCORE_COLORS = Object.freeze([
  { threshold: 70, color: '#35a670' },
  { threshold: 50, color: '#ff9b26' },
  { threshold: 0, color: '#ee4f27' }
]);

const normalizeValue = (value) => {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
};

export const clampScoreValue = normalizeValue;

export function getScoreColor(value) {
  const score = normalizeValue(value);
  return SCORE_COLORS.find(({ threshold }) => score >= threshold)?.color || SCORE_COLORS.at(-1).color;
}
