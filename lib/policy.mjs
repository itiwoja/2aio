// 適用ポリシー: README の安全設計の唯一の実装点
// 自動適用は「vault × low × 監査PASS × dryでない」の全条件成立時のみ。それ以外は全て提案(承認制)。
export function decideAction({ targetType, risk, auditPass, dry }) {
  if (dry) return { action: 'propose', why: 'dry指定（適用せず全部提案）' };
  if (targetType !== 'vault') return { action: 'propose', why: `対象が${targetType}（skills/agentsは絶対に自動上書きしない）` };
  if (risk !== 'low') return { action: 'propose', why: `リスク${risk}（低リスクのみ自動適用）` };
  if (auditPass !== true) return { action: 'propose', why: '監査NG（PASSのみ自動適用）' };
  return { action: 'apply', why: 'vault × low × 監査PASS' };
}
