---
description: 既存システムの UI を「作り直す」専用レーン。解析→デザイン監査→路線選択→段階的リデザイン→再採点。機能は壊さない。
argument-hint: <対象dir|.> [--scope=<glob|ページ名>] [--route=minimal|editorial|dense|<路線名>] [--auto] [--local]
---

既存プロダクトの **UI リデザイン専用** オーケストレーター。`/2aio-build` が「ゼロから新規生成」なのに対し、本コマンドは **今あるコードを読み、監査し、既存スタックのまま段階的に高級化** する。**スクラッチで書き直さない・機能を壊さない** が絶対原則。

**対象:** $ARGUMENTS

## 引数

```
/2aio-redesign {対象dir} [--scope=...] [--route=...] [--auto] [--local]
```

| パターン | 意味 |
|---|---|
| `{対象dir}` | 作り直すプロジェクトのルート（省略時はカレント `.`） |
| `--scope=` | 対象を絞る（例: `--scope=src/components/**` や `--scope=ランディング`）。省略時は主要画面を自動選定 |
| `--route=` | デザイン路線を指定（`minimal`/`editorial`/`dense` または anti-ai-design の路線名）。省略時は Phase 2 で提案 |
| `--auto` | fail-forward（既定は interactive）。auto でも「機能破壊の兆候」検出時は停止 |
| `--local` | 公開しない（デフォルト。リデザインは基本ローカル完結） |

## 役割と絶対制約

- **本コマンドはスクラッチ生成をしない。** `redesign-skill` の原則「Do not rewrite from scratch. Improve what's there」に従い、既存スタック（Tailwind / vanilla CSS / styled-components / CSS Modules 等）を維持したまま狙い撃ちで直す。
- **機能を壊さない。** ロジック・ルーティング・状態管理・API 呼び出し・テストに手を入れない（触るのは見た目＝マークアップ構造の最小変更・スタイル・トークン・モーション・アクセシビリティのみ）。デザイン目的を超える改修は Phase 3 のレビューへ回す。
- **既存の design 資産と衝突させない。** `~/.claude/skills` の既存路線スキル（anti-ai-design / apple-hig / material-design-3 / digital-agency-design-system / glassmorphism 等）と新規審美眼スキル（taste-skill / ui-craft / styleseed-design-review）を併用する。
- 状態は `output/{project}/redesign-state.md` を正本とし resume 可。
- **絶対の安全線（モード問わず）:** 機能破壊の検出 / ハードコード秘密の混入 / state.md I/O 障害 → 停止。

## 実行フロー

### Phase 1: 解析（Scan・read-only）
対象を読み、**リデザインの土台**を把握する。コードは書かない。
- フレームワーク・スタイリング手法・デザイントークンの所在（CSS 変数 / tailwind.config / テーマファイル）を特定。
- 主要画面・コンポーネント階層・共通UI（ボタン/カード/フォーム/ナビ）を列挙。
- `--scope` があればそこに限定、無ければ「顔になる画面」を 3〜7 個自動選定。
- 出力: `output/{project}/redesign-audit.md` の「## 現状」セクション（スタック・対象一覧・既存トークン）。

`project` 略称は対象dir名から生成。`output/{project}/` を作成。

### Phase 2: デザイン監査（Diagnose ★必須）
`redesign-skill` の監査リストと `styleseed-design-review` の採点で、**なぜ安っぽい/AIっぽいか**を構造的に洗い出す。
- `redesign-skill` 監査軸: タイポ（デフォルトフォント/Inter一辺倒・見出しの弱さ・本文幅・ウェイト不足・字間・孤立語）/ 色と面（純黒背景・過飽和アクセント・複数アクセント・暖寒グレー混在・**紫青AIグラデ**・単色影・テクスチャ無し・均一グラデ）/ 余白・階層 / 状態（hover/focus/active/空/読込/エラー）/ モーション。
- `styleseed-design-review` で **デザインスコア** を算出し、「AI っぽさの指紋」を具体行で指摘。
- 出力: `output/{project}/redesign-audit.md` に **優先度順の指摘リスト**（各項目: 現状→問題→修正方針）を追記。これが Phase 4 の正本。

### Phase 3: 路線選択（Route → トークン確定 ★必須）
「作り直し後の顔」を1つに決める。既存トークンを尊重しつつ引き上げる。
- `--route` 指定があればそれを採用。無ければ:
  - **interactive**: 題材に合う推奨1つ＋候補を短く提示してユーザーに選んでもらう。
  - **auto**: 最適路線を自動選択し理由を記録。
- 路線スキルを1つ選ぶ: `ui-craft-minimal`（Linear/Notion系）/ `ui-craft-editorial`（雑誌/長文系）/ `ui-craft-dense-dashboard`（データ密度系）/ または `anti-ai-design` の路線カード（12路線）/ 日本語UIなら `digital-agency-design-system` + `design-references/design-md-jp`。
- **常時必須**: `wcag-accessibility`（AA）・`layout-composition`（構図）・`modern-css`・`motion-design`。**純黒/純白/紫青グラデ/デフォルトフォント無加工は禁止**。
- 出力: `output/{project}/redesign-design.md`（紙/地色・文字色・アクセント1・フォント2種・角丸/影・テクスチャ・モーション方針・「既存の何を残し何を差し替えるか」）。**このトークンが Phase 4 の正本**。

### Phase 4: 段階的リデザイン（Apply・2aio-engineer）
入力: `redesign-audit.md`（指摘）＋ `redesign-design.md`（トークン正本）＋ 対象コード。
- `2aio-engineer` を起動。engineer 起動プロンプトに **redesign-design.md 全文 ＋ 選んだ路線スキル名 ＋ redesign-skill ＋ styleseed-design-review ＋ ui-craft ＋ layout-composition ＋ modern-css ＋ wcag-accessibility** を渡す。
- **既存スタックのまま**、指摘の優先度順に in-place 修正。CSS 変数/テーマに落として全要素が新トークンを参照するよう配線。
- **機能不変を厳守**: ロジック/props/データフロー/ルーティング/テストを変えない。マークアップは意味構造を保ったままの最小変更に留める。
- 各コンポーネントに hover/focus/active/空/読込/エラーの状態を与える（`redesign-skill` の「無反応な要素を作らない」）。
- interactive: 機能破壊の疑いで停止 / auto: fail-forward（ただし機能破壊の兆候は安全線で停止）。
- 出力: 変更コード ＋ `output/{project}/redesign-build.md`（変更点と "触っていない機能" の明示）。

### Phase 5: 再採点・回帰確認（1往復）
- `styleseed-design-review` で **リデザイン後スコア** を再算出し、Phase 2 との差分（改善した指標）を提示。
- **機能回帰チェック**: 既存テストがあれば実行して緑を確認（`2aio-qa`）。無ければビルド＋主要画面の目視確認手順を提示。ロジック無変更のため機能は不変であることを確認。
- 未達の指摘が残れば engineer に1回だけ差し戻し → 再確認。auto は2往復目未達で DEGRADED 続行（残指摘を記録）。

### Phase 6: 完了
`output/{project}/redesign-state.md` を `phase: completed` 更新。簡潔に「Before/After スコア・直した主要指摘・触っていない機能・残タスク」を報告。`--local` 以外で公開したい場合はユーザー明示指示で通常の承認・セキュリティゲートを踏む。

## モデル指針
- Phase 1 解析・Phase 2 監査・Phase 3 路線は本体セッションで実行してよい。Phase 4 実装は `2aio-engineer`、Phase 5 回帰は `2aio-qa`。

## ガードレール
- **スクラッチ書き直し禁止**（既存を改善する。これが `/2aio-build` との存在意義の違い）。
- **機能を壊さない**（ロジック/データフロー/ルーティング/テスト不変。触るのは見た目のみ）。
- **Phase 2 監査と Phase 3 路線選択は省略しない**（解析だけして実装に入らない）。
- **wcag-accessibility（AA）・anti-slop（純黒/純白/紫青グラデ/デフォルトフォント無加工なし）は路線に関わらず常時適用**。
- 「ついでにこの機能も直す」は禁止 → 発見は redesign-build.md に記録し、機能改修は別 Issue（IDD スコープ防衛）。
- 各フェーズ進捗を redesign-state.md に追記しつつ簡潔報告。
