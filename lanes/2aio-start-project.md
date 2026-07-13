---
description: 2AIO取締役会(CEO方針→CMO/CTO/CSO並列→CFO→CEO統合)を開催しPRDを生成する。--lite で軽量モード(CTO+CEO+PRDのみ)
argument-hint: <テーマ|--lite>
---

> **表記の読み替え:** 本文中の `/2aio-<name>` は旧スラッシュコマンド表記。`~/.claude/2aio/lanes/2aio-<name>.md` を Read し、後続テキストを $ARGUMENTS としてその指示に従う意味に読み替える。

以下のテーマについて2AIO（AGENT ALL IN ONE）取締役会議を開いてください。

**テーマ:** $ARGUMENTS

> `output/` の正本は環境変数 `TWOAIO_OUTPUT_DIR`（設定時のみ）。未設定なら対象プロジェクト直下の `output/` を使う。
> 使い分け: 事業性判断が必要な新テーマ=本コマンド（フル） / 個人ツール・開発ツール・社内ツール・学習目的で即PRD=--lite（ビジネス役員フル編成のトークンを開発テーマに使わない — #18） / 調査不要・即実装=/2aio-build / Intent を自分で書ける反復開発=IDD（/idd-intent〜。2AIOを通さない）。実装フェーズは 2AIO レーンと IDD のどちらか一方のみ使用する。

---

## 軽量モード（引数に `--lite` を含む場合）

個人ツール・小規模アプリ向けに、フル取締役会を開かず最小工程で PRD まで出す。
**`--lite` 指定時は、下の「実行手順」を次に置き換える:**

1. **CTO 簡易評価のみ**: `2aio-cto` だけを起動（技術スタック・実現性・主要リスク）。市場/戦略/財務は調べない。2aio-cto には簡易評価モード（結論/推奨スタック/技術リスク上位3のみ）での出力を明示指示すること。
2. **CEO 即決**: `2aio-ceo` を1回だけ起動して approved/conditional/rejected を判断（多重統合・再起動なし）。2aio-ceo には Lite 即決フォーマット（approved/conditional/rejected の3値。needs_review 禁止）で出力するよう明示指示すること。
3. **最小PRD**: approved/conditional なら `2aio-prd` で目的・主要機能・受け入れ条件・スコープ外のみ生成（市場/競合/収益セクションは省略）。
4. 出力: `output/prd-{略称}-{YYYY-MM-DD}.md`。あわせて CTO 簡易評価+CEO 即決を `output/board-meeting-{略称}-{YYYY-MM-DD}.md` として保存する（バッチ等の下流が参照するため lite でも省略しない）。

`--lite` では **CMO・CSO・CFO・2aio-researcher・2aio-r-\* を一切起動しない**（冗長排除）。フル取締役会は新規事業検討のときだけ（`--lite` なし）に使う。

> 調査も意思決定も要らず「即作って公開」したいだけなら `/2aio-build` を使う（さらに高速）。

---

## 実行手順（通常モード = フル取締役会）

### Phase 0: テーマ略称の確定と board-state 初期化（#24）

1. **テーマ略称を冒頭で確定する**（従来 Phase 6 で行っていた生成を前倒し。ルールは同じ: `output/board-meeting-*.md` を一覧し、ファイル冒頭の「**テーマ:**」行との意味的一致があればその略称を再利用、無ければ英小文字ケバブ20文字以内で新規生成。Phase 6 では確定済み略称をそのまま使う）
2. `output/{project}/board-state.md` を初期化（**implement の state.md とは別ファイル** — phase enum・デプロイ承認フィールドの混線を避ける）: frontmatter は `project / phase: board-1 / created_at / updated_at` のみ
3. **各 Phase 完了時**、中間成果を `output/{project}/board-work/` に逐次保存し board-state の `phase` を進める:
   `ceo-brief.md`（Phase 1）→ `cmo|cto|cso-report.md`（Phase 2）→ `cfo-report.md`（Phase 3）→ `ceo-final.md`（Phase 4）
4. **resume**: 引数 `resume {project}` で board-state.md の `phase` から完了済み Phase をスキップして再開（最大10体・最長レーンの中断=全損を防ぐ）。--lite にはこの機構を適用しない（3起動のみで再実行コストが resume のオーバーヘッドと同等）

### Phase 1: CEO ブリーフ生成
オーケストレーター（本体セッション）が `2aio-ceo.md` の [Phase 1 — ブリーフ生成時] フォーマットに従い直接ブリーフを生成する（エージェント起動不要。opus 起動は Phase 4 の1回に温存）。

### Phase 2a: CMO・CTO・CSO 並列起動
`2aio-cmo`・`2aio-cto`・`2aio-cso` エージェントを**単一のメッセージで3つ同時にTaskとして起動してください（並列必須）**。

- **1つずつ順番に実行することは禁止します。必ず3つを同時に発行してください。**
- 各エージェントにはCEOブリーフの該当部分を渡してください
- CMO/CSO には「最新データが必要なら『## 調査依頼リスト』を出力して一旦終了する」よう明示指示してください
- 3つすべてのTaskが完了するまで待ってから次に進んでください

### Phase 2b: 調査の仲介実行（調査依頼リストが出力された場合）
メインスレッドが `2aio-researcher.md` のルーティング表（重複時優先規則含む）に従い、該当する `2aio-r-*` を単一メッセージで並列起動し、結果を researcher の集約フォーマット（接頭辞付きソース番号+統合ソース一覧）で集約してください。

### Phase 2c: CMO・CSO 再起動
CMO/CSO を「CEOブリーフの該当部分 + Phase 2b の集約結果（要約+統合ソース一覧。r-* の生出力全文は渡さない）」込みで再起動し、最終レポートを作成させてください。

※ 環境要因で並列 Task が直列実行になった場合は、レポートが揃うことを優先して続行してよい

### Phase 3: CFO 財務試算
`2aio-cfo` エージェントを起動してください。入力:
- CEOブリーフの「CFOへの指示」セクション
- CMO・CTO のレポート全文
- CSO レポートの「新興脅威・機会」「戦略リスク」セクション（規制・脅威の財務影響評価のため）

### Phase 4: CEO 最終統合判断
`2aio-ceo` エージェントを起動し、全役員レポートを統合した最終判断を取得してください。

### Phase 5: PRD生成（条件付き）
最終判断が `approved` または `conditional` の場合のみ、`2aio-prd` エージェントを起動してPRDを生成してください。
- 入力: 全役員レポート + CEO最終判断
- 出力先: `output/prd-{テーマ略称}-{YYYY-MM-DD}.md`
- `rejected` の場合: PRD は生成せず、却下理由と再検討条件をレポートに明記して Phase 6 へ進む。
- `needs_review` の場合: CEO 統合判断の「不足情報」セクションに列挙された項目を該当役員（CMO/CTO/CSO/CFO）に1回だけ追加調査させ、Phase 4 を再実行する（最大1回。2回目も needs_review ならレポートに未解決事項を記録して終了し、ユーザーに判断を仰ぐ）。

### Phase 6: レポート出力・差分チェック
テーマ略称は英小文字ケバブケース・20文字以内で生成する。差分チェック時は `output/board-meeting-*.md` を一覧し、ファイル名類似だけでなく各ファイル冒頭の「**テーマ:**」行との意味的一致で過去レポートを判定する。一致が見つかった場合はその略称を再利用する。
`output/` ディレクトリに同テーマの過去レポートがあれば差分サマリーを生成してください。
全フェーズの結果をMarkdownレポートとして整形し、以下に保存してください:
- 取締役会議レポート: `output/board-meeting-{テーマ略称}-{YYYY-MM-DD}.md`
- PRD（該当する場合）: `output/prd-{テーマ略称}-{YYYY-MM-DD}.md`

### Phase 7: Linear 起票（approved / conditional のみ・任意）
`LINEAR_API_KEY` が利用可能なら、Linear BIZ チームに Issue を起票する: タイトル「[2AIO] {テーマ略称}: PRD実装」、本文に PRD パス・最終判断・即時アクション。Linear GraphQL API（ローカルに linear 用スクリプトがあればそれでも可）を使用。rejected / 起票不可の場合はレポートに「起票なし」と記録する。

---

## 最終レポートフォーマット

```markdown
# 2AIO 取締役会議レポート
**テーマ:** {問い}
**日時:** {ISO 8601形式}
**最終判断:** {approved / conditional / rejected / needs_review}

---
## CEO 方針
{Phase 1の出力}

---
## CMO 市場調査レポート
{Phase 2 CMOの出力（調査メタデータ・ソース一覧含む）}

---
## CTO 技術評価レポート
{Phase 2 CTOの出力}

---
## CSO 戦略情報レポート
{Phase 2 CSOの出力（調査メタデータ・ソース一覧含む）}

---
## CFO 財務試算レポート
{Phase 3の出力}

---
## CEO 最終判断
{Phase 4の出力}

---
## レポートメタデータ

**レポート生成日時:** {ISO 8601形式: YYYY-MM-DDTHH:MM:SS+09:00}
**過去レポートとの比較:** {差分サマリー または「初回調査」}

### 使用ソース一覧（全エージェント集計）

| # | ソース名/URL | 取得日時 | 使用エージェント | 使用箇所 |
|---|-------------|---------|----------------|---------|
| 1 | {URL または 学習データ} | {YYYY-MM-DD} | {CMO/CSO} | {市場規模など} |

### Web検索使用状況

| エージェント | Web検索 | 検索クエリ数 |
|------------|--------|------------|
| CMO | {有/無} | {n件} |
| CSO | {有/無} | {n件} |
| 2aio-r-*（使用したエージェント） | {有/無} | {n件} |
```

---

各フェーズの進捗を逐次報告してください。
