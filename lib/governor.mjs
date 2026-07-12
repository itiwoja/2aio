// トークン予算ガバナー: サブスク(Claude Max)の共有5時間ブロックを食い潰さないための入場判定。
// 純ロジック(副作用なし)。ccusage の active block を入力に、新規ジョブを起動してよいか決める。
// 判定順: 同時実行上限 → 予算閾値 → 許可。README/CONTROL-PLANE の安全設計の唯一の実装点。

// admitJob({ active, tokenLimit, threshold, running, maxConcurrency }) → 判定
//   active        : ccusage の現在ブロック { tokens, end } または null(利用なし/未取得)
//   tokenLimit    : ブロックのトークン上限(config.claudeMax5x.tokenLimit)
//   threshold     : 0..1。使用率がこれ以上なら新規投入を止める(既定0.8)
//   running       : 現在実行中ジョブ数
//   maxConcurrency: 同時実行上限(サブスク直列運用の既定1)
export function admitJob({ active, tokenLimit, threshold = 0.8, running = 0, maxConcurrency = 1 }) {
  const usedPct = usedFraction({ active, tokenLimit });
  if (running >= maxConcurrency) {
    return { admit: false, reason: 'concurrency', usedPct, running, maxConcurrency, resetAt: null };
  }
  if (usedPct !== null && usedPct >= threshold) {
    return { admit: false, reason: 'budget', usedPct, running, maxConcurrency, resetAt: active?.end || null };
  }
  return { admit: true, reason: 'ok', usedPct, running, maxConcurrency, resetAt: active?.end || null };
}

// 現ブロックの使用率(0..1)。上限不明・利用なしなら null(=予算では止めない)。
export function usedFraction({ active, tokenLimit }) {
  if (!active || !tokenLimit || tokenLimit <= 0) return null;
  const used = active.tokens || 0;
  return Math.max(0, used / tokenLimit);
}
