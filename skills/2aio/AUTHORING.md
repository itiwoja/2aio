# 2AIO スキル著作標準

2AIO ネイティブスキル（`skills/2aio/*`）と、Forge が将来自動生成するスキルが従う基準。
Hermes の HARDLINE authoring standards（`agent/learn_prompt.py`）と anti-capture guardrail
（`agent/background_review.py`）の概念borrowを、**2AIO の router の実挙動に合わせて**書き直したもの。

## description は router の一次入力（実挙動に合わせて書く）

`harness/skill-router/build-index.mjs` が SKILL.md frontmatter の `name` と `description` から
keyword を導出する。挙動は次の通り（推測ではなくコードの事実）:

- **トリガー句が最強シグナル（重み 2）** — `Use when …` / `Trigger on …` / `Use for …` /
  `Use proactively …` に続く語が最も強く効く。**「いつ使うか」を description の前方に置く。**
- **name のトークン（重み 1.5）** — `-`/`_` 区切りで 3 字以上の語が効く。名前に意味のある語を入れる。
- **description の一般トークン（重み 1）** — 4 字以上・ストップワード除外。ユーザーが実際に打つ具体名詞を使う。
- **格納は 240 字まで** — `build-index` は description を 240 字で切って index に保存する。
  超過分の末尾は router の表示から失われる。**要点とトリガーを 240 字以内・前方に。**
- **日本語対応** — matcher は `synonyms.json` で日本語→英語を展開する。英語 description のスキルを
  日本語ユーザーに引かせたい場合は `harness/skill-router/synonyms.json` に日本語同義語を足す。

> lint: `node harness/skill-router/build-index.mjs` は上記に反する description（空 / 240 字超 /
> トリガー句なし）を警告する（`harness/skill-router/lint.mjs`）。

## 捏造しない

- 存在しない **flag / path / API / ツール名** を書かない。ドキュメント化する前に実物を確認する
  （`Read`/`Grep` で裏取り）。これは 2AIO の portable-paths 規約とも整合する。
- バージョン依存の挙動は「確認した時点」を明記する。

## anti-capture — 脆い偽の制約を保存しない

Forge の synthesize / 将来の学習レビューで、次を**知識・スキルとして保存してはならない**
（放置すると月単位で「自分への refusal」に硬化し、以後の判断を誤らせる）:

- **環境依存の失敗**（「この環境では X が動かない」= 別環境では動く）
- **否定的なツール主張**（「Y ツールは壊れている / 使えない」）
- **一過性のエラー**（rate-limit・ネットワーク瞬断・偶発クラッシュ）
- **一度きりの物語**（特定タスク固有の経緯で再利用価値のないもの）

保存するのは「再現性のある手順・設計判断・恒久的な事実」だけにする。

## 帰属と provenance

- **vendored 第三者スキル**（`skills/{sdlc,apple,engineering,design,orchestration,research}/*`）は
  **無改変**で原ライセンス（MIT 等）のまま再配布し、各フォルダに `SOURCE.md`、全体を
  `skills/SOURCES.md` に登録する。**編集しない**（更新は upstream 追従）。
- **2AIO ネイティブ / Forge 生成スキル**は上記と分離する。将来の自動 curator は
  provenance で「vendored（保護・不可触）」と「生成（archive 候補）」を区別し、
  **削除はせず archive のみ**とする（never-delete 不変条件）。

## SKILL.md の構成順（本文）

1. 何をするスキルか（1–2 文）
2. いつ使う / いつ使わない（トリガーは description にも重複させる）
3. 手順・具体例（コピペ可能な最小例）
4. 注意・落とし穴
5. 参照（`references/` 等への path。path の後の散文は load-bearing = 省略しない）
