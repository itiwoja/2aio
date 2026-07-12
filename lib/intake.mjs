// 新規リポジトリの対話ヒアリング: ダッシュボード上でClaude(サブスク)が1問ずつ質問し、
// 十分集まったら done + brief(PRD種) を返す。ここではプロンプト生成と応答検証(純ロジック)のみ。
// 実際のClaude呼び出しは control.mjs が claudeJSON() 経由で行う。

// これまでの会話(messages: [{role:'assistant'|'user', content}])から次の1問を生成するプロンプト。
export function buildInterview(messages, repo) {
  const label = repo?.slug || repo?.name || '新規アプリ';
  const sys = `あなたは2AIOのプロダクト・インタビュアー。新規リポジトリ「${label}」で作るアプリの要件を、ユーザーに【1問ずつ】日本語で質問して引き出す。
規則:
- 既に分かっていることは聞き直さない。1回の返答で質問は1つだけ。
- 目的 / 主要機能 / 対象ユーザー / 技術スタック希望 / デプロイ先(プラットフォーム) が揃うことを目指す。
- 十分に揃ったと判断したら done:true にして brief を書く(それまでは done:false)。
- 出力は必ず次のJSONのみ: {"done": true|false, "question": "次の1問(doneなら空文字)", "brief": "doneのとき目的・主要機能・対象ユーザー・スタック・プラットフォームを箇条書きにしたPRD種。doneでなければ空文字"}`;
  const convo = (messages || []).map(m => `${m.role === 'user' ? 'ユーザー' : '質問'}: ${m.content}`).join('\n');
  const user = `これまでのやりとり:\n${convo || '(まだ無し。最初の質問をどうぞ)'}\n\n上記を踏まえ、JSONで「次の1問」または「完了(brief)」を返してください。`;
  return { sys, user };
}

// Claudeの応答(パース済みオブジェクト)を検証・正規化。壊れていたら null。
export function validateInterview(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const done = obj.done === true;
  const question = typeof obj.question === 'string' ? obj.question.trim() : '';
  const brief = typeof obj.brief === 'string' ? obj.brief.trim() : '';
  if (!done && !question) return null;      // 未完了なのに質問が無いのは不正
  if (done && !brief) return null;          // 完了なのに brief が無いのは不正
  return { done, question, brief };
}

// done時のbriefを、2AIO実装レーンへ渡す実行プロンプトに変換。
export function briefToBuildPrompt(brief, repo) {
  const label = repo?.name || 'このアプリ';
  return `次の要件（ヒアリング結果）に基づき、このリポジトリに「${label}」を実装してください。まず計画(WBS)を立て、続けて実装まで進めてください。\n\n=== 要件 ===\n${brief}`;
}

// #12: intake 完了時は plan→implement の2連ジョブに分割する。
// ジョブ境界＝ガバナー予算判定ポイントになり、impl-plan 成果物がチェックポイントとして残る。
export function briefToPlanPrompt(brief, repo) {
  const label = repo?.name || 'このアプリ';
  return `次の要件（ヒアリング結果）を PRD とみなし、「${label}」の実装計画書を /2aio-plan-project --lite 相当（タスクWBS＋依存＋スプリント1行）で output/ に impl-plan-*.md として生成してください。実装はしない（後続ジョブが行う）。\n\n=== 要件 ===\n${brief}`;
}
export const IMPLEMENT_CHAIN_PROMPT = '/2aio-implement-project latest --auto';
