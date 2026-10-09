/** Compact notices are projections of the same source-read states as the full rail.
 * A task's needs_check is a record gap, never an unavailable read or failed job.
 */
import { readReasonText, shortTime } from './world-work-rail.js';

const READ_LABELS = Object.freeze({ tasks: '仕事', persons: '人物', decisions: '方針の決定', relations: '関係' });
const STATE_TEXT = Object.freeze({ partial: '一部だけ読めた', failed: '読込失敗', forbidden: '権限がなく読めない', not_connected: '未接続', unavailable: '読めない' });

export function workCanvasNotes(work) {
  if (!work) return [];
  if (work.status !== 'ok') {
    const state = STATE_TEXT[work.status] ?? '読めない';
    return [{ label: '区画の仕事', tone: 'warning', summary: `仕事：${state}（0件とは確認できません）`, text: `仕事は${state}。${readReasonText(work.reason) ?? '理由不明'}。仕事の件数は未確認です。0件とは確認できません。` }];
  }
  const notes = [];
  for (const [key, label] of Object.entries(READ_LABELS)) {
    const read = work.reads?.[key];
    if (!read || read.state !== 'complete') {
      const state = STATE_TEXT[read?.state] ?? '状態不明';
      notes.push({ label: `区画の${label}`, tone: 'warning', summary: `${label}：${state}`, text: `${label}は${state}。${readReasonText(read?.reason) ?? '理由不明'}。読めていない記録は0件とは限りません。` });
    }
  }
  const summary = work.summary;
  if (summary?.state === 'complete' || summary?.state === 'partial') {
    const needs = summary.needs_check?.length;
    if (needs > 0) notes.push({ label: '記録の確認', tone: 'attention', summary: `記録の要確認 ${needs}件`, text: `読めた未完了の仕事のうち${needs}件に、記録から把握できていないことがあります。仕事が止まっているという意味ではありません。詳細の絞り込みから根拠を確認できます。` });
  }
  const at = work.reads?.tasks?.read_at;
  notes.push({ label: '区画の時点', tone: 'info', text: `仕事の読み込み：${shortTime(at) ?? '時点不明'}。表示は読み込んだ時点の記録です。` });
  return notes;
}
