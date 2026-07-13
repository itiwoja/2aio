// 適用ポリシー: README の安全設計の唯一の実装点
// 自動適用は「vault × low × 監査PASS × dryでない × autoApplyVault 明示 opt-in」の全条件成立時のみ。
// それ以外は全て提案(承認制)。autoApplyVault 既定 OFF の理由: vault 内容は Web スクレイプ(第三者が
// 内容を操作可能)由来で、無人適用すると後続の Bash 権限付きワーカーへ間接プロンプトインジェクションが
// 波及しうる。既定では人間レビュー(承認)を必須にし、config.json で明示的に opt-in した場合のみ自動適用。
export function decideAction({ targetType, risk, auditPass, dry, autoApplyVault }) {
  if (dry) return { action: 'propose', why: 'dry指定（適用せず全部提案）' };
  if (targetType !== 'vault') return { action: 'propose', why: `対象が${targetType}（skills/agentsは絶対に自動上書きしない）` };
  if (risk !== 'low') return { action: 'propose', why: `リスク${risk}（低リスクのみ自動適用）` };
  if (auditPass !== true) return { action: 'propose', why: '監査NG（PASSのみ自動適用）' };
  if (autoApplyVault !== true) return { action: 'propose', why: 'autoApplyVault 無効（既定: 外部収集内容は承認制。config.json で明示 opt-in が必要）' };
  return { action: 'apply', why: 'vault × low × 監査PASS × autoApplyVault' };
}
