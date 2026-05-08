# Travel App Patch

開発者: 近藤悠太 (Kondo Yuta)

このリポジトリには、Maison Passage Gateway Pair Explorer と、それを計画・生成・評価するためのローカル Codex ハーネスが含まれています。

## このアプリで作っているもの

Maison Passage は、海外旅行を「2 枚の片道航空券」として検索するプレミアム海外旅行プランナーです。複数の渡航先国にまたがる代表的な空港を比較し、必要に応じて近隣のゲートウェイ空港まで検索範囲を広げ、さらに非直行ルートを許容する場合は、ブダペストやプラハといったヨーロッパ限定の格安コリドー・ゲートウェイも候補に加えます。まず安価な往路片道便を見つけ、続いて安価な復路片道便を探します。なお、現地内の移動は意図的に対象外としています。

現在の結果フォリオには、往路・復路・往復通しの Skyscanner 検索に向けた、ライブ運賃に近い構造化されたソース受け渡しカードが追加されています。これらのカードがライブ検索への唯一の主要導線であり、決定論的な見積もりは事業者バックの受け渡しリンクとは視覚的に明確に分離され、事業者リンクが失敗したり利用可能な運賃を返さなかった場合のフォールバックについても、UI 上で正直に説明します。

現在のアプリは、季節をまたいだ柔軟な計画にも対応しています。例えば、往路の出発月として 7 月・8 月・9 月といった複数月を選び、滞在期間の目安として 26 〜 36 日のようなレンジを指定できます。プランナーはまず最も安い往路の日付を選び、その往路日付に滞在レンジを足し合わせて復路の候補日を検索します。

プランナーは、ユーザーが選んだ滞在対象国と、自動的に拡張されたゲートウェイ国を検索前に分けて扱うようになりました。これにより、入出国のプールがどのように広げられているかを、利用者がはっきりと確認できます。

現在の決定論的見積もりエンジンは、非直行ルートを許容したヨーロッパ検索でもより現実的に振る舞います。ハブ経由のクリーンなルートに対して、乗継回数の多い格安コリドーが大きく価格を下回る場合には、そちらを優先することができます。

これらのコリドー・ゲートウェイは、あくまで内部的な検索候補という位置づけです。勝ち残った場合にゲートウェイ・サマリや結果に表示されることはあっても、目的地ピッカーの新しい主要選択肢としては表示されません。

現在承認されているロードマップは次のとおりです。

- `Sprint 5`: Grand Tour Ledger Redesign
- `Sprint 6`: Gateway Pair Ticketing
- `Sprint 7`: Bauhaus Motion Refresh
- `Sprint 8`: Europe Corridor Overlay
- `Sprint 9`: Live Fare Handoff Cards

## リポジトリ構成

- `build/`: 実行可能な Next.js アプリ本体。
- `agents/`: ローカル Codex の計画・生成・評価ハーネス。
- `specs/spec.json`: プロダクトの真実 (Source of Truth)。
- `設計書.md`: 人間が読むための設計コンパニオン。
- `sprints/`: ジェネレーターの自己評価アーティファクト。
- `evaluations/`: エバリュエーターのレポート。

## アプリの起動方法

```bash
cd build
npm install
npm run dev
```

その後、`http://localhost:3000` を開いてください。

## 検証

```bash
cd build
npm run typecheck
npm run test:planner
npm run smoke
npm run build
```

## ハーネス

リポジトリのルートで以下を実行します。

```bash
python agents/orchestrator_codex.py status
python agents/orchestrator_codex.py autodev "Advance Maison Passage toward gateway-first two-ticket travel planning" --sprint 6 --max-iterations 3
python agents/orchestrator_codex.py autodev "Advance Maison Passage toward gateway-first two-ticket travel planning" --sprint 6 --max-iterations 3 --auto-sync
python agents/orchestrator_codex.py sync "Describe the sync change" --dry-run
```

ハーネスは `specs/spec.json` をプロダクトの真実として扱い、`build/` を更新し、`sprints/sprint_N_eval.json` と `evaluations/sprint_N_report.json` を書き出します。

ハーネスは、3 つのローカル・サブエージェント役割を中心に構成されています。

- `Planner`: 短いリクエストを `specs/spec.json` に展開します。実装の細部までは過剰に指定しません。
- `Generator`: 1 スプリント分の実装を行い、`sprints/` に自己評価のハンドオフを残します。
- `Evaluator`: スプリントを厳格に検証し、`PASS` か `FAIL` のレポートを `evaluations/` に書き出します。

ハンドオフ契約はバグを意識した内容になっています。

- `Evaluator` はスプリントが失敗した場合、安定した `bug_id` を持つ構造化された `bugs` エントリを書き出します。
- `Generator` は対応中のバグ ID を `source_bug_ids` にコピーし、`sprints/sprint_N_eval.json` の `addressed_bug_ids` と `unresolved_bug_ids` でそれらを分類します。
- `status` は最新のバグ・リンク状況を可視化し、どの指摘が分類済みで、どれが未対応なのか、そして現在のレポートが `FAIL` の場合に、ジェネレーターの参照しているバグ集合と一致しているかどうかが一目で分かるようにします。

`python agents/orchestrator_codex.py status` は、エージェント中心の JSON ビューでパイプラインの状態を返します。プランナー / ジェネレーター / エバリュエーターの準備状況、読み書きコントラクト、最新アーティファクトの構造的検証、最新スプリント・レポートのサマリ、バグ・リンク集計、ローカル git の同期状態、最新の評価ステータスなどが含まれます。

sync セクションでは、現在のブランチ、アップストリーム、HEAD の sha、ペンディング変更のプレビュー、検出された sync モード、ローカル git がインデックスに書き込めるかどうか、`.git` への書き込みなしで GitHub API フォールバックが可能かどうか、そして自動化が進められない場合の現在のブロッカーが報告されます。

sync のフォールバック順序は次のとおりです。

- `local_git`: `.git` に書き込み可能な場合、`git add -A`、`git commit`、`git push` を使用します。
- `github_api`: ローカル git がブロックされていても API クレデンシャルが利用可能な場合、GitHub API を介して直接コミットを作成します。
- `github_api` の PR フォールバック: API による直接コミットを安全に完了できない場合、フォールバック用ブランチとドラフトのプルリクエストを作成します。
- `manual`: 自動化された経路がいずれも実行できない場合、必要な環境変数名と手動手順を返します。

`.git/index.lock: Permission denied` が検出されると、status はローカル git の致命的失敗として扱う代わりに `sync.mode = "github_api_required"` に切り替わります。

GitHub API フォールバックは、`origin` リモートが GitHub を指している場合、そこから `owner` と `repo` を推定できます。それでもクレデンシャルが不足している場合は、`status.sync.required_env_names` に不足している値が示されます。通常は `GITHUB_TOKEN` または `GH_TOKEN`、現在のブランチをきれいに推定できない場合は任意で `GITHUB_SYNC_BRANCH` です。

`autodev` は既定で既存の `specs/spec.json` を再利用します。これにより、Planner はスペックの著者という役割を維持しつつ、Generator と Evaluator は現在のスプリントを反復的に進められます。意図的にスペックから再生成したい場合は `--replan` を指定してください。

`autodev` は既定で GitHub に公開しません。`PASS` となったイテレーションを自動的に sync 自動化にかけたい場合は `--auto-sync` を指定してください。安全のため、この自動 sync 経路はワークツリーが最初からクリーンだった場合にのみ実行されます。これにより、ハーネスが無関係なローカル変更を巻き込んでコミットしてしまうことを防ぎます。

## 現在のデザイン方針

現在の UI 方針は、バウハウスに寄せたネオ・ブルータリズムの旅行アトリエです。日本語の階層を表現するために `Noto Sans JP` をウェイト・コントラストを効かせて使用し、数値キャプションや路線コードには `Oswald` を、フィールドカラーには温かみのあるオフホワイトを採用し、赤・青・黄・ニアブラックをアクセントとして配しています。ホバーには `0.3s` のソフトなリフトモーション、スクロール表示には段階的なスプリング風のリビールを与えています。

Sprint 9 では、このビジュアル言語を維持したまま、結果エリアをよりクリアなハンドオフ層へと進化させます。決定論的見積もりが引き続きアンカーとなり、往路・復路・往復通しの Skyscanner カードが、唯一の明示的な次のステップとして機能します。
