// SKILL.md description の軽量 lint（Wave B v1）。build-index の実挙動に基づく純関数。
// AUTHORING.md（skills/2aio/AUTHORING.md）の基準を機械的に検査する。
export const DESC_MAX = 240; // build-index が index に格納する description の上限（超過分は切られる）

// 2AIO ネイティブスキルの description は日本語で「…で使う / …に使う」と締める慣習なので、
// 英語トリガー句に加えて日本語の「使う/使いたい/使用する」も検出する。
const TRIGGER_RE = /(trigger on|triggers on|use when|use it when|use for|use immediately|use this when|use proactively|使う|使いたい|使用する)/i;

// スキル1件の警告配列を返す（問題なければ空）。フェイルオープン運用のため throw しない。
export function lintSkill(name, description) {
  const warnings = [];
  const desc = String(description || '');
  if (!desc.trim()) { warnings.push(`${name}: description が空 — router index から除外される`); return warnings; }
  if ([...desc].length > DESC_MAX) warnings.push(`${name}: description が ${DESC_MAX} 字超 — 末尾が router index で切られる（トリガーと要点を前方へ）`);
  if (!TRIGGER_RE.test(desc)) warnings.push(`${name}: 明示的なトリガー句が無い — "Use when …" を入れると keyword 重み(2)が効く`);
  return warnings;
}
