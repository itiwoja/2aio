// 画面の側を確認するためのダミーデータ。
// agents/*.md の実在する25体から名前とモデルを写しているが、ここは静的スナップショット —
// ファイルを読みに行く実装は入れていない。

export const agents = [
  // 取締役会レーン
  { id: '2aio-ceo', short: 'ceo', group: 'board', model: 'opus', role: '経営判断・全役員レポート統合' },
  { id: '2aio-cto', short: 'cto', group: 'board', model: 'opus', role: '技術戦略・アーキ方針の決裁' },
  { id: '2aio-cmo', short: 'cmo', group: 'board', model: 'sonnet', role: 'マーケ戦略・市場調査の統合' },
  { id: '2aio-prd', short: 'prd', group: 'board', model: 'sonnet', role: '要件定義・PRD作成' },
  { id: '2aio-planner', short: 'planner', group: 'board', model: 'sonnet', role: '実装計画WBSの正本作成' },
  { id: '2aio-architect', short: 'architect', group: 'board', model: 'sonnet', role: '計画レーンのアーキテクト' },

  // 実装レーン
  { id: '2aio-engineer', short: 'engineer', group: 'impl', model: 'sonnet', pinned: true, role: 'WBSタスクを順次実装' },
  { id: '2aio-frontend-engineer', short: 'frontend', group: 'impl', model: 'sonnet', role: 'フロントエンド実装リード' },
  { id: '2aio-qa', short: 'qa', group: 'impl', model: 'sonnet', pinned: true, role: '受け入れ条件の検証ゲート' },
  { id: '2aio-devops', short: 'devops', group: 'impl', model: 'sonnet', pinned: true, role: 'デプロイ・セキュリティゲート' },
  { id: '2aio-release-manager', short: 'release', group: 'impl', model: 'sonnet', role: '本番デプロイの最終責任' },
  { id: '2aio-migration-runner', short: 'migration', group: 'impl', model: 'sonnet', role: '移行・廃止の実行' },

  // レビュー・監査レーン
  { id: '2aio-design-reviewer', short: 'design-rev', group: 'review', model: 'sonnet', role: 'デザインレビュー' },
  { id: '2aio-swift-reviewer', short: 'swift-rev', group: 'review', model: 'sonnet', role: 'Swift/SwiftUIレビュー' },
  { id: '2aio-project-auditor', short: 'auditor', group: 'review', model: 'sonnet', role: 'プロジェクト監査' },
  { id: '2aio-observability', short: 'observ', group: 'review', model: 'sonnet', role: '可観測性の設計・点検' },
  { id: '2aio-ios-debugger', short: 'ios-dbg', group: 'review', model: 'sonnet', role: 'iOSビルド/デバッグ' },

  // リサーチレーン
  { id: '2aio-researcher', short: 'researcher', group: 'research', model: 'haiku', role: 'リサーチ委譲のルーティング' },
  { id: '2aio-r-web', short: 'r-web', group: 'research', model: 'haiku', role: 'Web検索(Tavily/Exa)' },
  { id: '2aio-r-code', short: 'r-code', group: 'research', model: 'haiku', role: 'コード・リポジトリ検索' },
  { id: '2aio-r-gemini', short: 'r-gemini', group: 'research', model: 'haiku', role: 'Gemini経由の調査' },
  { id: '2aio-r-news', short: 'r-news', group: 'research', model: 'haiku', role: 'ニュース収集' },
  { id: '2aio-r-sns', short: 'r-sns', group: 'research', model: 'haiku', role: 'SNS動向収集' },
  { id: '2aio-r-community', short: 'r-community', group: 'research', model: 'haiku', role: 'コミュニティ動向収集' },
  { id: '2aio-r-reference', short: 'r-reference', group: 'research', model: 'haiku', role: '一次資料・公式ドキュメント' },
];

export const groupLabel = {
  board: '取締役会',
  impl: '実装',
  review: 'レビュー / 監査',
  research: 'リサーチ',
};

// 黒曜石＝はめ込めるモデル。3系統（サブスク / APIキー / ローカル）を横断して並べる。
// 着手順序の決定に従い、サブスク系だけ ready、他は未接続の見た目にしてある。
export const obsidians = [
  {
    id: 'cc-opus',
    label: 'claude-opus-4-8',
    backend: 'subscription',
    provider: 'Claude Code',
    status: 'ready',
    note: 'Max×5 プランの認証を委譲',
  },
  {
    id: 'cc-sonnet',
    label: 'claude-sonnet-5',
    backend: 'subscription',
    provider: 'Claude Code',
    status: 'ready',
    note: '実装トリオの既定',
  },
  {
    id: 'cc-haiku',
    label: 'claude-haiku-4-5',
    backend: 'subscription',
    provider: 'Claude Code',
    status: 'ready',
    note: 'リサーチ7体の既定',
  },
  {
    id: 'codex-terra',
    label: 'gpt-5-codex (Terra)',
    backend: 'subscription',
    provider: 'Codex CLI',
    status: 'ready',
    note: 'ChatGPTサブスク認証を再利用',
  },
  {
    id: 'codex-luna',
    label: 'gpt-5-codex (Luna)',
    backend: 'subscription',
    provider: 'Codex CLI',
    status: 'quota',
    note: '5時間ウィンドウを対話セッションと共有',
  },
  {
    id: 'api-anthropic',
    label: 'claude-opus-4-8',
    backend: 'apikey',
    provider: 'Anthropic',
    status: 'auth',
    note: 'ANTHROPIC_API_KEY 未設定',
  },
  {
    id: 'api-openai',
    label: 'gpt-5',
    backend: 'apikey',
    provider: 'OpenAI',
    status: 'auth',
    note: 'OPENAI_API_KEY 未設定',
  },
  {
    id: 'api-google',
    label: 'gemini-3-pro',
    backend: 'apikey',
    provider: 'Google',
    status: 'auth',
    note: 'GEMINI_API_KEY 未設定',
  },
  {
    id: 'local-qwen',
    label: 'qwen2.5:14b',
    backend: 'local',
    provider: 'Ollama',
    status: 'offline',
    note: 'localhost:11434 に到達できない',
  },
  {
    id: 'local-deepseek',
    label: 'deepseek-r1:32b',
    backend: 'local',
    provider: 'Ollama',
    status: 'offline',
    note: '未取得',
  },
];

export const statusLabel = {
  ready: '装着可',
  quota: 'クォータ逼迫',
  auth: '未認証',
  offline: 'オフライン',
};

// どのモアイに、どの黒曜石がはまっているか（初期状態のダミー）
export const fitted = {
  '2aio-ceo': 'cc-opus',
  '2aio-cto': 'cc-opus',
  '2aio-planner': 'cc-sonnet',
  '2aio-engineer': 'cc-sonnet',
  '2aio-qa': 'cc-sonnet',
  '2aio-devops': 'cc-sonnet',
  '2aio-frontend-engineer': 'codex-terra',
  '2aio-researcher': 'cc-haiku',
  '2aio-r-web': 'cc-haiku',
  '2aio-r-code': 'cc-haiku',
  '2aio-r-gemini': 'cc-haiku',
};

// 起動中のモアイ（ダミー）
export const running = {
  '2aio-engineer': { tokens: 12400, elapsed: '02:41', task: 'T-014 認証ミドルウェア実装' },
  '2aio-r-web': { tokens: 3120, elapsed: '00:18', task: '競合サービス調査' },
};

export const runLog = [
  { at: '12:04:11', agent: 'ceo', level: 'ok', text: '取締役会サマリを統合 → state.md 更新' },
  { at: '12:04:52', agent: 'planner', level: 'ok', text: 'impl-plan-004.md を発行（WBS 18タスク）' },
  { at: '12:05:03', agent: 'engineer', level: 'run', text: 'T-013 完了 → T-014 に着手' },
  { at: '12:05:44', agent: 'r-web', level: 'run', text: 'Tavily 検索 5件取得' },
  { at: '12:06:02', agent: 'qa', level: 'warn', text: 'T-012 受け入れ条件2件が未検証' },
  { at: '12:06:31', agent: 'devops', level: 'ok', text: 'gitleaks + SAST パス（Step 2.5）' },
  { at: '12:07:10', agent: 'codex', level: 'warn', text: 'Luna: 5時間ウィンドウ残り 12%' },
  { at: '12:07:38', agent: 'engineer', level: 'run', text: 'codex_brief_014.md を書き出し → 委譲' },
  { at: '12:08:01', agent: 'design-rev', level: 'ok', text: 'コントラスト比 AA 達成' },
  { at: '12:08:22', agent: 'auditor', level: 'err', text: 'ARCHITECTURE.md と lanes/ の記述が不一致' },
];

// ヘッダに出すダミーのプラン情報
export const session = {
  plan: 'Max×5',
  tokensUsed: 18_400_000,
  tokenLimit: 88_000_000,
  concurrency: 1,
  maxConcurrency: 1,
};

// 下部のページ送り
export const pages = ['dashboard', 'system', 'moai', 'logs', 'settings'];

// ── クォータ
// クォータは像ではなく黒曜石（＝プロバイダのアカウント）に付く。同じプロバイダの黒曜石を
// はめた像は全部で1つの窓を食い合うので、「この像のクォータ」というものは存在しない。
// 系統によって性質が違うのが要点:
//   サブスク型 = 5時間ローリング窓。対話セッションとも共有するため、並列に動かすほど減る
//   APIキー型  = 従量課金。窓はなく、減るのは残高
//   ローカル型 = 自前ホスト。上限なし
export const quota = {
  'Claude Code': { kind: 'window', pct: 32, label: '5時間窓', note: '対話セッションと共有' },
  'Codex CLI': { kind: 'window', pct: 12, label: '5時間窓', note: '対話セッションと共有' },
  Anthropic: { kind: 'metered', note: '従量課金 — 窓なし' },
  OpenAI: { kind: 'metered', note: '従量課金 — 窓なし' },
  Google: { kind: 'metered', note: '従量課金 — 窓なし' },
  Ollama: { kind: 'unlimited', note: '自前ホスト — 上限なし' },
};

// ── いまのタスク（動いている像だけが持つ）
export const tasks = {
  '2aio-engineer': {
    id: 'T-014',
    title: '認証ミドルウェア実装',
    done: 14,
    total: 18,
    elapsed: '02:41',
    retries: 1,
    maxRetries: 3, // engineer は3回で止まりエスカレーションする
  },
  '2aio-r-web': {
    id: 'Q-03',
    title: '競合サービス調査',
    done: 3,
    total: 5,
    elapsed: '00:18',
    retries: 0,
    maxRetries: 0,
  },
};

// ── 呼び出し関係。誰から起動され、次に誰へ渡すか。
// サブエージェントは他のサブエージェントを起動できない（ARCHITECTURE 原則1）ので、
// 「←」は常にオーケストレーターか、それが渡した計画正本を指す。
const CALL_BY_GROUP = {
  board: { from: ['オーケストレーター', '/2aio-plan-project'], to: ['2aio-ceo', '役員レポートの統合へ'] },
  impl: { from: ['2aio-planner', 'impl-plan-004.md'], to: ['2aio-qa', '受け入れ条件の検証へ'] },
  review: { from: ['オーケストレーター', 'build-log.md の変更ファイル'], to: ['2aio-engineer', '差し戻し（CRITICAL/HIGH のみ）'] },
  research: { from: ['2aio-researcher', 'ルーティング表による委譲'], to: ['2aio-researcher', 'ソース付きで返す'] },
};

const CALL_OVERRIDE = {
  '2aio-ceo': { from: ['オーケストレーター', '/2aio-start-project'], to: ['—', '最終統合（ここで止まる）'] },
  '2aio-qa': { from: ['2aio-engineer', 'build-log.md'], to: ['2aio-devops', 'QAパス後のみ'] },
  '2aio-devops': { from: ['2aio-qa', 'QAパス'], to: ['2aio-release-manager', 'Step 2.5 のゲート通過後'] },
  '2aio-researcher': { from: ['オーケストレーター', '調査クエリ'], to: ['2aio-r-*', 'ルーティング表で委譲'] },
};

export function callsFor(agent) {
  const c = CALL_OVERRIDE[agent.id] || CALL_BY_GROUP[agent.group];
  return { from: { id: c.from[0], via: c.from[1] }, to: { id: c.to[0], why: c.to[1] } };
}

// ── 待ち条件（走っていない像が、何を待っているか）
// ここは飾りではなく ARCHITECTURE に実在するゲートを写している。
//   原則2   デプロイ承認は state.md の deploy_approved: true のみ
//   原則3   セキュリティゲートは devops Step 2.5（gitleaks + SAST）
//   原則3.5 コード品質レビューは QAパス後のみ
const GATE = {
  '2aio-qa': { cond: 'WBS完走 → 受け入れ条件の検証', now: 'T-014 実行中 · 14/18' },
  '2aio-devops': { cond: 'QAパス + deploy_approved: true', now: 'QA未着手 · 承認なし' },
  '2aio-release-manager': { cond: 'devops の Step 2.5 通過', now: 'devops未着手' },
  '2aio-ceo': { cond: '全役員レポートが揃う', now: 'cto / cmo / prd の3件待ち' },
  '2aio-engineer': { cond: 'impl-plan の発行', now: 'impl-plan-004.md 発行済み' },
  '2aio-researcher': { cond: 'オーケストレーターの調査依頼', now: '依頼なし' },
};

const GATE_BY_GROUP = {
  board: { cond: 'オーケストレーターからの起動', now: '—' },
  impl: { cond: 'impl-plan の発行', now: 'impl-plan-004.md 発行済み' },
  review: { cond: 'QAパス後の変更ファイル一覧', now: 'QA未通過' },
  research: { cond: '2aio-researcher からの委譲', now: 'ルーティング待ち' },
};

export function gateFor(agent) {
  return GATE[agent.id] || GATE_BY_GROUP[agent.group];
}

// ── 直近の実行。走っていない像でも画面が死なないよう、履歴を持たせる。
const HISTORY = {
  '2aio-qa': [
    ['12:02', 'ok', 'T-012 を検証 → Pass'],
    ['11:47', 'warn', 'T-011 → Fail（受け入れ条件2件）'],
    ['11:20', 'ok', 'T-010 を検証 → Pass'],
  ],
  '2aio-devops': [
    ['09:14', 'ok', 'Step 2.5 gitleaks + SAST パス'],
    ['09:02', 'ok', 'sprint-003 を Vercel へデプロイ'],
  ],
  '2aio-engineer': [
    ['12:05', 'ok', 'T-013 完了'],
    ['11:52', 'warn', 'T-013 自己修正 1回目'],
    ['11:38', 'ok', 'T-012 完了'],
  ],
  '2aio-ceo': [['08:30', 'ok', '取締役会サマリを state.md へ']],
  '2aio-planner': [['12:04', 'ok', 'impl-plan-004.md を発行（18タスク）']],
  '2aio-r-web': [
    ['12:05', 'run', 'Tavily 検索 5件取得'],
    ['11:10', 'ok', '競合3社の料金表を回収'],
  ],
};

export function historyFor(agent) {
  return (HISTORY[agent.id] || []).map(([at, level, text]) => ({ at, level, text }));
}
