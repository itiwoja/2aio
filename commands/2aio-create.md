---
description: 2AIO 入口①「一から作る」。アイデア 1 行から規模を自動判定し、最適な内部レーン（高速 build / 取締役会→計画→実装のフルコース）で完走する
argument-hint: <作りたいもの> [--quick|--full] [--auto] [残りの引数は選択レーンへ透過]
---

2AIO の「一からプロジェクトを作る」モード。ユーザーは作りたいものを 1 行で渡すだけでよい。
内部レーンの存在・使い分けはこちらが吸収する（ユーザーに選ばせない）。

## 手順

1. **入力確認**: $ARGUMENTS が空なら「何を作りますか？（1 行で OK）」と 1 問だけ聞く。
2. **規模判定**（--quick / --full 指定があればそれに従う。無ければ自動判定）:
   - **quick**: 作るものが明確・小〜中規模（単機能アプリ / LP / ツール / PWA / プロトタイプ）
     → レーン `2aio-build`
   - **full**: 事業性・市場性の判断が必要（「儲かるか」「サービスとして」等）、複数スプリント規模、
     要件が曖昧で PRD から固めるべきテーマ
     → レーン連鎖 `2aio-start-project` → `2aio-plan-project` → `2aio-implement-project --auto`
   - 判定に迷う場合のみ AskUserQuestion で「サクッと形にする / 事業として本格的に」の 2 択を 1 回だけ聞く。
3. **レーン実行**: `~/.claude/2aio/lanes/<レーン名>.md` を Read し、その指示に
   $ARGUMENTS を「<テーマ + 透過フラグ>」として厳密に従って実行する。
   **full の場合、`latest` は使わない**（他プロジェクトの旧成果物とのクロス汚染防止。`2aio-autorun-batch` の
   path-capture 規律と同じ）:
   1. `2aio-start-project` 完了後、CEO 最終判断が `rejected`、または `needs_review` が未解決のまま終了して
      PRD が生成されなかった場合は、ここで停止し却下理由・再検討条件をユーザーに報告する
      （plan/implement へは進まない）。
   2. PRD が生成された場合のみ、完了報告から実際の生成パス（`output/prd-{テーマ略称}-{日付}.md`）を捕捉し、
      `latest` の代わりにその実パスを `2aio-plan-project` に明示的に渡す。
   3. `2aio-plan-project` 完了後も同様に、生成された impl-plan の実パス
      （`output/impl-plan-{テーマ略称}-{日付}.md`）を捕捉し、`latest` の代わりに
      `2aio-implement-project --auto` へ明示的に渡す。
   （create はセッション内でこれらのパスを保持すれば足りる。`2aio-autorun-batch` のような
   batch-state ファイルは不要）
4. **報告**: 完成物の場所 / URL / 次にできることを、レーン内部の用語を使わずに報告する。

## 禁止事項
- ユーザーにレーン名の選択を求めない（--quick/--full の明示指定は例外）。
- レーン定義に無い工程を足さない。
