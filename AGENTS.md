# AGENTS.md

### ユーザー追記
- モバイル対応は考えてないので、モバイル用の確認/テストは不要です
- サブエージェントは必要に応じて自由に利用してください

## プロジェクト概要

このリポジトリでは、Pokémon Champions の対戦動画をキャプチャ/ブラウザに映し解析する、**GitHub Pages / gh-pages で静的ホスティング可能なブラウザ完結Webアプリ**を構築する。

アプリは、画面上に表示される日本語のバトルメッセージを構造化されたバトルイベントへ変換し、あとから確認・修正できる試合ログと統計サマリーを生成する。

基本パイプライン:

```text
video / screenshot
→ browser-side frame sampling
→ battle-message ROI crop with Canvas
→ browser-side image preprocessing
→ OCR with Tesseract.js / Web Worker
→ text normalization
→ template + dictionary matching
→ structured battle events
→ unknown-message bucket
→ manual correction UI
→ statistics / export
→ IndexedDB / downloadable JSON / CSV
```

これは汎用OCR文字起こしアプリではない。OCRはノイズの多い候補生成器として扱うこと。中核となる成果物は、ポケモン対戦の画面メッセージをバトルイベントへ変換するパイプラインである。

## 静的ホスティング方針

このプロジェクトは、GitHub Pages で公開できる静的Webアプリとして実装する。

実行時にサーバーを必要とする構成は禁止する。

禁止するもの:

- FastAPI / Flask / Express などの常駐バックエンド。
- Python backend。
- `pytesseract`。
- OpenCV-Python。
- サーバー側SQLite。
- サーバー側ファイルシステムへの保存。
- `../champout` のようなローカルパスをWebアプリ実行時に直接読む設計。
- クラウドOCR APIをデフォルトにする設計。
- 動画・画像を外部サーバーへアップロードする設計。

許可するもの:

- React + TypeScript + Vite。
- GitHub Pages / gh-pages への静的デプロイ。
- Canvas API / OffscreenCanvas による画像処理。
- Tesseract.js によるブラウザ内OCR。
- Web Worker による重い処理の分離。
- MediaDevices `enumerateDevices()` による `videoinput` / `audioinput` 一覧取得。
- MediaDevices `getUserMedia()` によるOBS Virtual Camera、OBS-Camera、USBキャプチャボードなどの映像入力取得。
- 将来の別モードとしての `getDisplayMedia()` 画面共有入力。
- IndexedDB / localStorage によるブラウザ内保存。
- JSON / CSV / ZIP などのブラウザ内エクスポート。
- ユーザーが選択したローカルファイルをブラウザ内で読み込む処理。
- 開発時またはビルド時だけ使うNode.js scripts。

重要: `npm run build` 後の `dist/` だけでアプリが動くこと。静的ホスティング先にアプリサーバーが存在する前提を置かない。

## 現在のプロダクト方針

以下を優先する。

1. 観測できた行動と、統計価値の高いバトルイベントを安定して抽出する。
2. OCRの生テキストと、確認用の元フレーム情報を必ず保存する。
3. 最初からすべてを分類しようとせず、よく出る有用なイベントだけを分類する。
4. まれなメッセージや未知メッセージは、すぐに完全再現しようとせず保存する。
5. テンプレート、辞書、手動修正によって段階的に精度改善できる構造にする。
6. すべての解析処理を、原則としてユーザーのブラウザ内で完結させる。
7. 最初のMVPでは、キャプチャ映像をリアルタイムで分析し、OCR結果とイベント候補をログのように流す体験を最優先する。

MVP段階では、ゲーム内シミュレーター状態の完全再現を目指さない。

## MVPの中心体験: リアルタイムOCRログ

最初のMVPは、スクリーンショット単発解析ではなく、キャプチャ映像をブラウザに表示しながらリアルタイムでOCR結果をログへ流す体験を中心にする。

ユーザー体験の軸:

- ユーザーがブラウザで映像ソース (`videoinput`) と音声ソース (`audioinput` または音声なし) を選択する。
- キャプチャ映像をアプリ内に表示し、バトルメッセージROIを確認・調整する。
- 解析開始後、低fpsでフレームをサンプリングし、ROI crop、前処理、OCR、正規化、分類候補生成を行う。
- OCR生テキスト、正規化テキスト、confidence、timestamp、frame index、イベント候補、unknown判定をライブログとして流す。
- 近接フレームの同一/類似メッセージは安定化し、重複ログを抑制する。
- 分類できないメッセージもunknownとしてログに残し、後からレビュー・修正・エクスポートできるようにする。

スクリーンショットや動画ファイルの読み込みは、検証、デバッグ、後追い解析として有用なので残してよい。ただし、最初のMVPの主戦場はリアルタイムキャプチャ解析である。

統計は、観測されたバトルメッセージから作った `observed_action` / parsed event / confirmed event を中心に計算する。選択UIそのものを検出できない限り、`selected_action` はMVPの対象外にする。

## 絶対に守る制約

- Nintendo、Game Freak、Creatures、Pokémon の公式アセットをリポジトリに同梱しない。
- ROMダンプ、公式スクリーンショット、公式フォント、著作権のあるゲームアセットをコミットしない。
- `champout` 由来データは、MIT License、source commit、source file、third-party noticeを記録したcompact generated battle template packだけを標準同梱してよい。
- raw dump全体、公式由来テキストの無制限な全文dump、`others/champout` のruntime参照、`public/` へのraw配置は禁止する。
- デフォルトではクラウドOCR APIなしで動作すること。
- 動画・スクリーンショットはデフォルトでローカルに留めること。明示的に依頼されない限り、テレメトリ、トラッキング、アカウント機能、クラウドアップロードを追加しない。
- UIテキストだけで実際に選択行動が証明できない限り、`selected_action` を事実として記録しない。バトルメッセージは通常、選択された行動ではなく、解決済み・観測済みの行動を示す。
- 必要に応じて `observed_action`、`resolved_action`、`inferred_action` を使い分ける。
- Unknown message は想定内である。失敗ではなく、レビュー・学習・ルール追加のための有用なデータとして扱う。
- 静的ホスティングで動かない実装を追加しない。必要になった場合は、`docs/architecture.md` に「将来の任意API版」として分離して書く。

## ローカル参考資産 (`others/`)

`others/` はgit追跡しないローカル資産置き場である。

基本ルール:

- `others/` 配下のファイルをコミットしない。
- `others/` や `PROGRESS.md` の除外は、このワークスペースでは `.git/info/exclude` のようなローカルignoreで管理されている場合がある。必要が明確でない限り、重複する `.gitignore` を新規作成しない。
- ブラウザ実行時に `others/` へ直接依存しない。
- `others/` の内容を使う場合は、必要な部分だけをリポジトリ内の適切な場所へコピー、変換、または生成して使う。
- コピー・変換した成果物をコミットする場合は、ライセンス、再配布可否、由来を確認する。
- 生成データは手作業で編集せず、可能な限り `scripts/` や明示的なoverrideファイルから再生成できる形にする。
- 開発時の参照パスとして `others/` を使ってよいが、runtime import、bundle import、固定絶対パス参照にしない。

現時点の主な参照先:

- `others/champout`
  - Project Pokémon `champout` のローカル参照用。
  - 実行時には直接読まない。開発時scriptで、設定ファイルにenabled指定された少数のbattle templateだけを `data/generated/champout-event-rules.ja.json` へ生成する。
  - generated packを拡張する場合は、`npm run report:champout` で候補を確認し、source fileを1つずつ `data/champout/champout-template-sources.ja.json` に追加し、再生成・テスト・notice更新を行う。
  - raw dump全体や巨大ファイルをリポジトリにコピーしない。generated JSONは手編集せず、script/configから再生成できる状態を保つ。
- `others/pokemon-showdown`
  - Pokémon Showdown simulator protocolやイベント表現のローカル参照用。
  - Showdownのログ形式と公式ゲーム表示が1対1対応するとは仮定しない。
  - 必要な知見は設計・テストに反映するが、runtimeで `others/pokemon-showdown` をimportしない。
- `others/pokemon-SnapCrop`
  - ゲーム映像のブラウザキャプチャ表示、相手選出ポケモン検出などが実装されたWebアプリの参考用。
  - media capture、画面表示、検出UI、ブラウザ内処理の実装パターンを参考にしてよい。
  - 参照する場合も、必要な実装だけをこのリポジトリの方針に合わせてコピー・再実装し、runtime dependencyにはしない。

## 参考資料

データimportやイベントモデリングでは、以下を参照する。

- Project Pokémon `champout`: `https://github.com/projectpokemon/champout`
  - 利用可能な場合、ローカライズ済み日本語バトルテキストテンプレートの候補として使う。
  - 実装前に必ず実際のリポジトリ構造を確認する。
  - `rom-txt/jpn` や `btl_*` などのバトル関連ファイルが有用な可能性が高い。
  - 静的Webアプリ実行時は `others/champout` を読まない。標準同梱する場合は、開発時scriptでcompact generated packへ変換し、license/source commit/source filesを記録する。
- Pokémon Showdown simulator protocol: `https://github.com/smogon/pokemon-showdown/blob/master/sim/SIM-PROTOCOL.md`
  - 内部イベント分類の参考にする。
  - 公式ゲームの表示メッセージとShowdownのログ形式が1対1対応するとは仮定しない。
- Tesseract.js: `https://github.com/naptha/tesseract.js`
  - ブラウザ内OCRの実装候補として使う。
- Tesseract quality guidance: `https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html`
  - 画像前処理やページ分割モードの参考にする。
- Vite static deploy: `https://vite.dev/guide/static-deploy`
  - GitHub Pages向けのビルド・デプロイ設定の参考にする。

## リポジトリが空の場合

既存リポジトリに明確な構成がない場合は、以下の構成を使う。

```text
.
├─ public/
│  ├─ tessdata/
│  │  └─ .gitkeep
│  └─ sample/
│     └─ .gitkeep
├─ src/
│  ├─ app/
│  │  ├─ App.tsx
│  │  └─ routes.tsx
│  ├─ components/
│  ├─ features/
│  │  ├─ upload/
│  │  ├─ roi/
│  │  ├─ review/
│  │  ├─ timeline/
│  │  ├─ unknowns/
│  │  └─ stats/
│  ├─ core/
│  │  ├─ media/
│  │  ├─ preprocess/
│  │  ├─ ocr/
│  │  ├─ normalize/
│  │  ├─ dictionary/
│  │  ├─ templates/
│  │  ├─ parser/
│  │  ├─ events/
│  │  └─ stats/
│  ├─ storage/
│  │  ├─ indexedDb.ts
│  │  └─ export.ts
│  ├─ workers/
│  │  ├─ analysis.worker.ts
│  │  └─ ocr.worker.ts
│  ├─ types/
│  └─ test/
├─ data/
│  ├─ rules/
│  │  ├─ event_rules.ja.yaml
│  │  └─ roi_profiles.yaml
│  ├─ dictionaries/
│  │  ├─ pokemon.sample.json
│  │  └─ moves.sample.json
│  └─ generated/
│     └─ .gitkeep
├─ docs/
│  ├─ architecture.md
│  ├─ data-import.md
│  ├─ gh-pages-deploy.md
│  └─ windows-setup.md
├─ scripts/
│  └─ prepare-static-data.mjs
├─ AGENTS.md
├─ README.md
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
└─ vitest.config.ts
```

新規プロジェクトのデフォルト技術スタック:

- Runtime: static browser app。
- Frontend: React + TypeScript + Vite。
- OCR: Tesseract.js。重い処理はWeb Workerへ分離する。
- Image preprocessing: Canvas API / ImageData。必要になった場合のみOpenCV.jsを検討する。
- Fuzzy matching: TypeScript実装、またはブラウザで使える軽量ライブラリ。
- Storage: IndexedDB。小さな設定値のみlocalStorageでもよい。
- Export: Browser BlobによるJSON / CSV download。
- Tests: Vitest + React Testing Library。必要に応じてPlaywright。
- Package management: npmを優先し、Windows PowerShell向けのコマンドをREADMEへ明記する。

既存スタックがある場合は、置き換えずに既存構成へ合わせる。ただし、バックエンド前提の構成は静的ホスティング方針に反するため、ブラウザ完結の構成へ整理する。

## GitHub Pages / gh-pages 要件

Viteでビルドし、GitHub Pagesで配信できるようにする。

必須方針:

- `npm run build` で `dist/` を生成する。
- `npm run preview` でローカル確認できる。
- GitHub Pages配信時のbase pathに対応する。
- リポジトリ名が確定している場合、`vite.config.ts` の `base` を `/<repo-name>/` にする。
- リポジトリ名が未確定の場合、`VITE_BASE_PATH` などの環境変数でbase pathを指定できるようにする。
- `import.meta.env.BASE_URL` を使い、assets pathをハードコードしない。
- `BrowserRouter` を使う場合は404問題に注意する。MVPでは `HashRouter` を優先してよい。
- GitHub Pages上で追加HTTPヘッダーを自由に設定できる前提を置かない。
- SharedArrayBufferやcross-origin isolation必須の実装にしない。
- Tesseract.jsやWASMの配置は、GitHub Pagesのbase pathで壊れないようにする。

推奨scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "deploy": "npm run build && gh-pages -d dist"
  }
}
```

GitHub ActionsでPagesへデプロイする場合は、`docs/gh-pages-deploy.md` に手順を書く。`gh-pages` ブランチ方式でもActions方式でもよいが、READMEにどちらを採用したか明記する。

## エージェント向け開発手順

変更前に行うこと:

1. リポジトリ構造を確認する。
2. `PROGRESS.md` を確認し、現在の進捗、残課題、次の一手を把握する。
3. 既存のREADME、package設定、テスト、ソース配置を読む。
4. 静的ホスティング方針に反する実装がないか確認する。
5. OCR → event-log パイプラインを前進させる最小の有用な変更を特定する。
6. 明示的に依頼されない限り、大規模な書き換えは避ける。

進捗管理:

- プロジェクトの進捗、作業ログ、引き継ぎ情報は `PROGRESS.md` を参照する。
- 意味のある作業単位が完了したとき、ブロッカーが出たとき、milestone検証が終わったとき、または次回へ引き継ぐときは、個人用の汎用skill `progress-update` を使って `PROGRESS.md` を更新する。
- `progress-update` skill は `~/.agents/skills/progress-update` に配置されている。
- `PROGRESS.md` には、変更内容、変更ファイル、検証結果、残課題、次の一手を簡潔に残す。
- 変更ファイルはrepo相対パスで書き、ユーザー名を含むローカル絶対パスは書かない。
- 長い議論や思考ログを貼らず、次のagentが再開できる事実だけを残す。

実装時のルール:

- 純粋なパース処理は、OCR処理やUIから分離する。
- OCR provider logic はinterfaceの背後に置き、Tesseract.jsを後から他のブラウザ対応OCRに差し替え・併用できるようにする。
- 前処理は設定可能かつテスト可能にする。
- normalizer rule または parser rule を追加したら、必ずテストを追加する。
- セットアップ手順、コマンド、データ形式を変更したらREADMEまたはdocsを更新する。
- コード中の識別子は明確な英語にする。UIテキストは日本語でもよい。
- 巨大な正規表現の塊より、小さく合成可能な関数を優先する。
- 絶対パスをハードコードしない。
- `fs`, `path`, Node専用APIをブラウザ実行コードに混ぜない。
- 生成されたローカルデータ、動画ファイル、スクリーンショット、OCRデバッグダンプ、外部テキストダンプをコミットしない。

変更後に行うこと:

- 関連するテストとlintを実行する。
- `npm run build` を実行し、静的ビルドが通ることを確認する。
- GitHub Pagesのbase pathで壊れる可能性がある変更をした場合は、`npm run preview` またはdocsで確認手順を示す。
- 変更ファイル、挙動、実行したテスト、既知の制限を要約する。

## コア概念

### Raw OCR message

OCRの生結果は必ず保存する。

```json
{
  "rawText": "エルフーンの\nおいかぜ/",
  "normalizedText": "エルフーンのおいかぜ!",
  "ocrConfidence": 0.74,
  "timestampMs": 123456,
  "frameIndex": 370,
  "roi": { "x": 0.14, "y": 0.62, "w": 0.55, "h": 0.25 }
}
```

`rawText` は絶対に上書きしない。正規化済みテキストは派生値として扱う。

### Battle event

安定した内部イベントスキーマを使う。

```json
{
  "id": "evt_000001",
  "battleId": "battle_2026_06_29_001",
  "turn": null,
  "timestampMs": 123456,
  "type": "move",
  "actor": {
    "name": "エルフーン",
    "side": null
  },
  "move": "おいかぜ",
  "target": null,
  "condition": null,
  "rawText": "エルフーンの\nおいかぜ！",
  "normalizedText": "エルフーンのおいかぜ!",
  "confidence": 0.96,
  "classification": {
    "method": "template+dictionary",
    "templateId": "attack_actor_move",
    "alternatives": []
  },
  "source": {
    "frameIndex": 370,
    "timestampMs": 123456,
    "cropObjectUrl": null
  }
}
```

ブラウザ完結アプリでは、永続化できない一時的なObject URLに依存しない。必要な画像証拠を保存する場合は、IndexedDBにBlobとして保存するか、debug exportに含める。

### Unknown event

Unknown event は一級データとして扱う。

```json
{
  "id": "unk_000001",
  "battleId": "battle_2026_06_29_001",
  "timestampMs": 124800,
  "afterEventId": "evt_000001",
  "rawText": "OCRされた未分類メッセージ",
  "normalizedText": "OCRされた未分類メッセージ",
  "ocrConfidence": 0.68,
  "candidateMatches": [],
  "sourceFrameRef": "indexeddb:frame-blobs/abc123",
  "reviewStatus": "unreviewed"
}
```

Unknown message はレビューUIに表示し、後からルール作成に使えるようエクスポート可能にする。

## 内部イベント型

最初は以下のイベント型から始める。新しい型は、パース・UI・統計で実際に必要になったときだけ追加する。

優先度高:

```text
move
switch_out
switch_in
faint
battle_start
battle_end
turn_marker
unknown
```

重要なバトル文脈:

```text
damage
heal
status
status_cure
boost
unboost
miss
fail
immune
supereffective
resisted
critical
protect
weather_start
weather_end
terrain_start
terrain_end
field_start
field_end
side_start
side_end
item
ability
activate
```

後回し・高度な分類:

```text
substitute
encore
taunt
disable
perish_count
flinch
recharge
charge_turn
multi_hit
forced_switch
redirection
hazard
screen
room
custom_effect
```

一回きりの特殊イベント型を大量に作るのではなく、必要になるまでは `custom_effect` または `unknown` を使う。

## MVPスコープ

最初の動作版では、以下をサポートする。

1. `videoinput` のキャプチャ映像をブラウザ上に表示し、リアルタイム解析を開始・停止できる。
2. 検証や後追い解析のため、動画またはスクリーンショットもブラウザ上で読み込める。
3. バトルメッセージのROIを選択・確認できる。
4. 透明背景・ノイズの多い画面上の白い日本語テキストに対して、Canvasベースのメッセージcrop前処理を実行できる。
5. メッセージcropに対してTesseract.jsでOCRを実行できる。
6. OCR生テキスト、正規化テキスト、confidence、timestamp、分類候補をライブログとして表示できる。
7. 近接フレームの同一/類似メッセージを安定化し、重複ログを抑制できる。
8. OCRテキストを正規化できる。
9. 少なくとも以下のメッセージをパースできる。
   - `{pokemon}の {move}！`
   - `相手の {pokemon}の {move}！`
   - `引っこめた` / `ひっこめた` を含む交代アウト系メッセージ
   - `ゆけっ！ {pokemon}！` のような交代イン系メッセージ
   - faint / KO 系メッセージ
   - `効果は バツグンだ` 系の効果抜群メッセージ
   - `効果は いまひとつ` 系の半減メッセージ
   - `効果が ない` 系の無効メッセージ
   - `急所` メッセージ
   - simple patternで拾える失敗・まもる・外れメッセージ
10. レビュー可能なイベントタイムラインを作成できる。
11. 未分類メッセージをunknown bucketに保存できる。
12. 基本統計を表示できる。
   - observed move count
   - Pokémon action count
   - switch count
   - faint count
   - unknown message count
   - effectiveness / critical count when parsed
13. JSONとCSVでエクスポートできる。
14. `npm run build` 後の静的ファイルだけで動作する。

まれな特殊技メッセージの完全対応をMVP完了条件にしない。

## MVPまでのマイルストーン

MVPまでは以下のマイルストーン順に進める。各マイルストーンでは、完了条件を満たしたら `progress-update` skill を使って `PROGRESS.md` に検証結果と次の一手を残す。

原則:

- マイルストーン境界を守る。現在のマイルストーンの完了条件を満たす前に、後続の大きな機能へ広げすぎない。
- ただし、後続マイルストーンのための型、interface、テストダブルなど、小さな足場は作ってよい。
- 各マイルストーンの完了時には、`npm run test`、`npm run build`、ブラウザ表示確認のうち、その段階で意味のある検証を行う。
- `others/` 由来の参照データはruntime importしない。必要な場合はコピー、変換、import UI、または生成scriptを通す。
- 公式アセット、公式スクリーンショット、再配布可否が未確認の全文テンプレートをコミットしない。

### M0: 静的アプリ基盤

Goal:

- GitHub Pagesで配信可能なReact + TypeScript + Viteの静的アプリ基盤を作る。

Scope:

- `package.json`、Vite、TypeScript、Vitest、React Testing Libraryの初期構成。
- `src/`、`docs/`、`data/`、`scripts/` の基本ディレクトリ作成。
- `README.md`、`docs/architecture.md`、`docs/windows-setup.md` の初期版。
- 共有event schema、OCR message schema、unknown schemaの型定義。

Done:

- `npm run build` が通る。
- 最小のReact画面が表示できる。
- バックエンドなし、Node専用APIなしでbundleできる。

Stop line:

- この段階ではOCR、キャプチャ、parserの本実装へ進みすぎない。

### M1: キャプチャ表示とROI調整

Goal:

- OBS Virtual Camera、OBS-Camera、USBキャプチャボードなどの `videoinput` 映像をブラウザ内に表示し、バトルメッセージROIを調整できるようにする。

Scope:

- `enumerateDevices()` による `videoinput` / `audioinput` の一覧取得。
- 映像ソースselect: `videoinput` から選択する。
- 音声ソースselect: `audioinput` または `音声なし` から選択する。
- 選択した映像ソースを `getUserMedia()` で開始・停止する。OBS/USBキャプチャ向けに、1920x1080、1280x720、16:9 ideal、fallback の順で映像制約を試す。
- 映像streamは `audio: false` で取得し、音声は別の `audioinput` streamとして扱う。
- `音声なし` の場合は音声streamを取得せず、音声ソース選択時は該当 `deviceId` を音声onlyの `getUserMedia()` で取得し、Web Audioで再生する。
- キャプチャ映像のpreview表示。
- キャプチャ失敗、権限拒否、停止時のUI状態。
- 正規化座標のROI overlayと保存。
- 検証用の画像/動画ファイル読み込みの最小足場。
- `getDisplayMedia()` 画面共有はM1のメイン導線にせず、必要になったら将来の別モードとして扱う。

Done:

- キャプチャ映像をアプリ内に表示できる。
- ROIを動かし、解像度に依存しない正規化座標として保持できる。
- キャプチャ停止後にUIが破綻しない。

Stop line:

- この段階ではOCR結果の正しさを追わない。まず入力映像とROIの境界を固める。

### M2: フレームサンプリングと前処理preview

Goal:

- キャプチャ映像から低fpsでフレームを取り出し、ROI cropとOCR向け前処理を確認できるようにする。

Scope:

- 3〜5fps程度のフレームサンプリング。
- Canvas / ImageDataによるROI crop。
- 白文字候補抽出、upscale、背景単色化、反転などの前処理pipeline。
- raw crop / preprocessed cropのdebug preview。
- フレーム保存の上限、リングバッファ、代表フレーム選択の足場。

Done:

- キャプチャ映像からROI cropを継続的に生成できる。
- 前処理結果をUIで確認できる。
- フレームBlobを無制限に保存しない構造になっている。

Stop line:

- この段階ではTesseract.js連携を必須にしない。OCR前の画像品質と処理境界を優先する。

### M3: OCR providerとリアルタイムOCRログ

Goal:

- OCR provider interfaceの背後でOCRを実行し、raw OCR resultをライブログとして流す。

Scope:

- `OCRProvider` interfaceとtest double。
- `analysis.worker.ts` / `ocr.worker.ts` のmessage型。
- Tesseract.js providerの初期実装。
- OCR進捗、失敗、language data読み込みエラーのUI表示。
- `rawText`、`normalizedText`、confidence、timestamp、frame indexを含むOCRログ。

Done:

- キャプチャ映像からリアルタイムにOCRログが流れる。
- OCR providerがUIやparserから分離されている。
- Tesseract.jsのworker / wasm / traineddata pathがGitHub Pages base pathで壊れにくい設計になっている。

Stop line:

- この段階では分類率を追いすぎない。raw OCRと正規化ログが安定して流れることを優先する。

### M4: 正規化、辞書、seed parser

Goal:

- OCRテキストを正規化し、ポケモン名・技名辞書とseed ruleで主要イベントを分類できるようにする。

Scope:

- Unicode NFKC、句読点、空白、OCR記号誤読の正規化。
- `normalizedText` と `matchText` の分離。
- ポケモン名・技名の小さなsample dictionary。
- 完全一致と安全なfuzzy matching。
- 必須Parserテスト例のseed rules。
- unknown fallback。

Done:

- 必須Parserテスト例がunit testで通る。
- 不明または曖昧な文言はunknownまたはneeds_reviewに落ちる。
- 低confidenceの辞書補正を不可逆に確定しない。

Stop line:

- この段階ではchampout全文テンプレートの同梱や大量手書きルールをしない。

### M4.5: seed template matcher

Goal:

- 名前・技以外の頻出バトル文言を拾うため、後続のgenerated champout packも流し込めるtemplate rule engineの受け皿を作る。

Scope:

- `data/rules/event_rules.ja.yaml` または同等のversion-controlled seed rule定義。
- `{pokemon}`、`{move}`、自由テキスト、固定文言を扱えるtemplate compilation。
- OCRノイズを前提に、`normalizedText` / `matchText` / OCR linesを使った安全なtemplate matching。
- ポケモン名・技名辞書と組み合わせたplaceholder capture。
- 反動、HP消費、回復、天候、フィールド、能力変化、特性/道具発動など、統計価値が高く頻出する文言の最小seed。
- unknown fallbackとcandidate evidenceの保持。

Done:

- `相手の イダイトウは 命が 少し削られた` や、OCRノイズを含む近い文言のような、技名が出ない解決後メッセージをseed ruleで分類できる。
- seed ruleはunit testで検証され、曖昧な文言はunknownまたはneeds_reviewへ落ちる。
- 後続M7のgenerated champout packを、同じtemplate matcherへ流し込めるinterfaceになっている。

Stop line:

- この段階ではchampout source fileの拡張、raw dump同梱、browser runtimeからの `others/champout` 参照はしない。
- seed ruleを増やしすぎず、実機OCRで頻出した代表文言に絞る。

### M5: Event timeline、unknown bucket、レビュー

Goal:

- OCRログからイベント候補とunknownを生成し、後から確認・修正できるUIを作る。

Scope:

- OCR message、parsed event、unknown eventの連携。
- 近接フレームの類似OCR結果の重複抑制。
- Event timeline。
- Unknown messages view。
- OCR生テキスト、正規化テキスト、元フレーム/crop、classification状態の表示。
- manual correctionの最小UI。

Done:

- リアルタイム解析中にイベント候補とunknownがタイムラインへ流れる。
- raw OCR textを失わずに確認できる。
- unknownをreviewedにできる。

Stop line:

- この段階では統計の網羅性より、レビュー可能な証跡を優先する。

### M6: IndexedDB保存とexport/import基盤

Goal:

- 解析結果、unknown、manual correction、代表フレーム/cropをブラウザ内に保存し、JSON/CSVで外へ出せるようにする。

Scope:

- IndexedDB adapter。
- Battle metadata、media metadata、ROI profile、OCR messages、events、unknowns、manual correctionsの保存。
- schemaVersionつきBattle log JSON export。
- Events CSV、Unknown messages CSVのexport。
- localStorageは小さなUI/OCR設定だけに限定。

Done:

- 解析結果を再読み込み後も確認できる。
- JSON/CSV exportが動作する。
- 大きな動画ファイル全体や大量フレームを自動保存しない。

Stop line:

- この段階ではクラウド同期、アカウント、テレメトリを追加しない。

### M7: champout/generated template pack

Goal:

- 名前・技以外のバトル文言の分類率を上げるため、champout由来の日本語バトルテンプレートを安全なcompact generated packとして標準同梱する。

Scope:

- `scripts/report-champout-files.mjs` で `others/champout/rom-txt/jpn/btl_*.json` を横断スキャンし、候補数、label、placeholder、event type分布、risk hintを確認する。
- `data/champout/champout-template-sources.ja.json` でsource file、enabled/hold/disabled、allow/deny条件、event type rule、placeholder policyを管理する。
- enabled source fileだけを `scripts/generate-champout-templates.mjs` で `data/generated/champout-event-rules.ja.json` に再生成する。
- source file name、key path、label name、sourceCommitをgenerated JSONとnoticeに保持する。
- source fileは1つずつ追加し、parser/decoder/test/docs/noticeを同時に更新する。

Done:

- `others/champout` をruntime importせず、checked-in generated packだけで標準分類候補を生成できる。
- report scriptで次に追加すべき候補ファイルを判断できる。
- seed rules + dictionary + generated champout templatesで分類候補を生成できる。

Stop line:

- raw dump全体、無制限な全文テンプレート、`public/` 配置、browser runtimeからの `others/champout` 参照はしない。

### M8: 統計、MVP検収、静的デプロイ準備

Goal:

- 観測ログ中心の統計、レビュー済みイベント、export、静的buildを揃え、MVPとして試せる状態にする。

Scope:

- observed move count、Pokémon action count、switch count、faint count、unknown count/rate。
- 効果抜群、半減、無効、急所など、parseできた範囲の集計。
- selected actionは検出できた場合だけ扱い、MVPでは原則対象外。
- README、architecture、data-import、gh-pages-deploy、windows-setupのMVP向け更新。
- GitHub Pages base path、Tesseract.js asset path、Windows PowerShell手順の確認。
- スクリーンショット/短い動画クリップでも同じpipelineを確認できるfallback。

Done:

- 「最初の有用なMVPの受け入れ条件」を満たす。
- `npm run test` と `npm run build` が通る。
- ブラウザ上で、キャプチャ開始 → ROI調整 → リアルタイムOCRログ → event/unknown timeline → review → stats → export の一連の流れを確認できる。
- 公式アセット、外部dump、大容量動画、再配布不可テンプレートをコミットしていない。

Stop line:

- MVP完了後の改善は、別マイルストーンとして扱う。高度な選択UI検出、完全なシミュレーター再現、特殊技完全対応、クラウド同期はMVP後に切り出す。

## OCR方針

### Provider abstraction

以下のようなOCR provider interfaceをTypeScriptで作る。

```ts
export interface OCRProvider {
  recognize(image: ImageBitmap | HTMLCanvasElement | OffscreenCanvas): Promise<OCRResult>;
}

export interface OCRResult {
  lines: OCRLine[];
  rawText: string;
  confidence: number | null;
}

export interface OCRLine {
  text: string;
  confidence: number | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
}
```

最初はTesseract.js providerを実装する。

推奨方針:

- 日本語データ `jpn` を使う。
- OCR処理はWeb Workerに寄せ、UI threadを塞がない。
- 2行メッセージブロックにはTesseractのPSM相当設定を検討する。
- すでに1行へ分割済みの場合は1行前提の認識設定を検討する。
- 取得可能な場合はconfidenceを返す。
- language dataやworker assetsの読み込みに失敗した場合は、わかりやすいsetup errorをUIに出す。
- GitHub Pagesのbase pathでTesseract worker / wasm / lang data のURLが壊れないようにする。

Tesseract.jsへの直接呼び出しをコードベース全体に散らさない。

### Tesseract.js assets

Tesseract.jsのworker、WASM、language dataは、静的ホスティングで壊れやすい。以下を守る。

- `import.meta.env.BASE_URL` を使ってasset URLを組み立てる。
- `public/tessdata/` に言語データを置く場合、ファイルサイズとライセンスを確認する。
- `jpn.traineddata.gz` などの大きなファイルを同梱するか、初回起動時に取得するかはREADMEに明記する。
- 公式由来ではないOCR言語データであっても、サイズが大きい場合はGitHub Pagesの制限に注意する。
- Tesseract.jsがIndexedDB等にcacheする場合でも、アプリ側はcache前提の挙動にしない。

### 前処理

バトルメッセージは、透明・ノイズの多い3D背景の上に白文字で表示される。前処理は必須。

前処理は、Canvas / ImageData を使ったパイプラインとして実装する。

```text
crop ROI
→ upscale 2x or 3x
→ isolate bright low-saturation text candidates
→ reduce colored background noise
→ morphological cleanup if implemented
→ create artificial solid background
→ invert if needed so OCR sees dark text on light background
→ optional line splitting
→ OCR
```

以下のパラメータは設定可能にする。

```yaml
ocr:
  provider: tesseractjs
  psmBlock: 6
  psmLine: 7
  upscale: 3
  minConfidence: 0.65

roi:
  default:
    x: 0.12
    y: 0.58
    w: 0.58
    h: 0.30

preprocess:
  whiteTextThreshold:
    minValue: 180
    maxSaturation: 110
  morphology:
    openKernel: 1
    closeKernel: 2
```

UIでは手動ROI調整を可能にする。ROIは1280x720、1920x1080、その他解像度に対応できるよう、正規化座標で保存する。

OpenCV.jsはMVPでは必須にしない。Canvasで不足する場合のみ導入を検討する。

### Multi-frame stabilization

動画では1フレームだけを信用しない。

以下のルールを実装する。

- `<video>` とCanvasを使い、デフォルト3〜5fps程度でフレームをサンプリングする。
- ROI内に白文字らしいピクセルが十分ある候補フレームだけOCRする。
- 各OCR結果を正規化する。
- 隣接フレームをfuzzy similarityで重複排除する。
- 近い時間帯で類似テキストが複数回出た、または短時間安定して表示された場合にメッセージを確定する。
- レビュー用に最も良い元フレームとcropを保持する。
- 大量のフレームBlobを無制限にIndexedDBへ保存しない。保存数・保存サイズに上限を設ける。

これにより、OCRを単発認識問題ではなく、時系列多数決問題として扱う。

## テキスト正規化

正規化処理は、純粋関数として実装し、十分にテストする。

ルール:

- `rawText` は別に保存する。
- Unicode NFKC正規化を適用する。
- 句読点・記号の揺れを正規化する。
  - `！` とよくあるOCR誤読を `!` に寄せる。
  - 日本語スペース・ASCIIスペースは、パーサーの都合に合わせて処理する。
- 表示用には改行を残したversionを保持し、照合用には不要な空白を削ったcompact versionを作る。
- 明らかなOCRノイズは照合用テキストだけで除去する。
- ポケモン名や技名を、誤検出が増えるほど過剰に正規化しない。
- 必要に応じて `normalizedText` と `matchText` の両方を保持する。

例:

```text
rawText:        "マフォオクシーの\nまもる/"
normalizedText:"マフォオクシーの\nまもる!"
matchText:     "マフォオクシーのまもる!"
```

辞書補正で `マフォオクシー` → `マフォクシー` に直す場合は、候補スコアの差が十分に大きい場合だけ受け入れる。

## 辞書マッチング

ポケモン名と技名は既知辞書として扱う。積極的に使うが、安全性を優先する。

辞書マッチ結果は以下を含む。

```json
{
  "input": "マフォオクシー",
  "best": "マフォクシー",
  "score": 0.93,
  "secondBest": "...",
  "secondScore": 0.74,
  "accepted": true,
  "reason": "score>=0.88 and margin>=0.08"
}
```

初期の受け入れ方針:

- 完全一致: accept。
- fuzzy match: scoreが高く、2番手候補との差が十分ある場合のみaccept。
- 曖昧なmatch: `needs_review` にする。
- 低confidenceの名前を不可逆に黙って変換しない。

ブラウザで動作する軽量なfuzzy matching実装を優先する。Node専用ライブラリをブラウザ実行コードに入れない。

## テンプレートマッチング

ローカライズ済みメッセージテンプレートを使ってメッセージを分類する。

ソース方針:

1. `npm run report:champout` で `others/champout/rom-txt/jpn/btl_*.json` をスキャンし、候補ファイルごとの件数、label、placeholder、event type分布、risk hintを確認する。
2. `data/champout/champout-template-sources.ja.json` で、enabled source fileとallow/deny条件、event type rule、placeholder policyを管理する。
3. enabled source fileだけを `npm run generate:champout-templates` でcompact generated packへ変換する。
4. `{0}`, `{1}` のようなplaceholderを、照合可能なplaceholderへ変換する。
5. 統計価値が高く誤分類リスクの低いテンプレートだけをactive ruleにする。

generated packは、MIT License、source commit、source file、third-party noticeを記録したcompact battle template packだけをコミットしてよい。raw dump全体、無制限な全文テンプレート、`public/` 配置、runtime `others/champout` 参照は禁止する。

MVPでの扱い:

- ポケモン名と技名は、一覧リストから小さな辞書を作りやすい。これはMVP初期から使う。
- 名前と技以外のバトル文言は手書きルールだけではすぐ限界が来るため、`champout` 由来のローカライズ済みバトルテキストを標準generated packとして少しずつ取り込む。
- M4.5では、手書きseed ruleと共通template matcherを先に作る。反動、HP消費、回復、天候、フィールド、特性/道具発動のような頻出文言を少量だけ扱い、後続M7のgenerated pack結果を同じmatcherへ接続できるようにする。
- リアルタイムOCRログ自体は、generated packが薄くても動作すること。拾えないものはunknownとして流す。
- `champout` generated packは、分類精度を実用域へ近づけるための標準データ源として扱う。ただしsource fileは1つずつ追加し、誤分類を増やすくらいならunknown/reviewに残す。

手書きのevent ruleはversion controlに含める。

```text
data/rules/event_rules.ja.yaml
```

ルール例:

```yaml
- id: attack_actor_move
  event_type: move
  priority: 100
  patterns:
    - "{pokemon}の\n{move}!"
    - "{pokemon}の {move}!"
  captures:
    pokemon: actor.name
    move: move

- id: attack_opponent_actor_move
  event_type: move
  priority: 100
  patterns:
    - "相手の {pokemon}の\n{move}!"
    - "相手の {pokemon}の {move}!"
  captures:
    pokemon: actor.name
    move: move
  constants:
    actor.side: opponent
```

Parser behavior:

- まず完全なtemplate/rule matchを試す。
- 次に、重要メッセージに対してdictionary-awareな柔軟patternを試す。
- 次に、fuzzy candidate matchingを試す。
- confidenceが不十分ならunknown eventを作成する。
- レビュー用にすべてのcandidate matchを保持する。

## champout generated pack

静的Webアプリでは、実行時に `../champout` や `others/champout` のようなローカルパスを直接読むことはできない。

現在の方針は、ユーザー許可に基づき、Project Pokémon `champout` のMIT License、source commit、source file、third-party noticeを記録したcompact generated battle template packを標準同梱する方式である。

### 推奨: scan report -> config -> generate

`others/champout` は開発時の参照だけに使う。

要件:

- `npm run report:champout` で `others/champout/rom-txt/jpn/btl_*.json` をスキャンする。
- reportはraw `OriginalText` の大量dumpを出力・コミットしない。
- `data/champout/champout-template-sources.ja.json` でenabled/hold/disabledを管理する。
- enabled source fileだけを `npm run generate:champout-templates` で `data/generated/champout-event-rules.ja.json` へ生成する。
- source fileを追加する場合は1つずつ。label allow/deny、text deny、event type rule、placeholder policy、parser test、noticeを同時に更新する。
- generatorの出力は手編集しない。
- generated JSONのsource metadataと `THIRD_PARTY_NOTICES.md` のsource filesを一致させる。
- browser runtime codeから `others/champout`、Node `fs`、Node `path` を読まない。

生成packのsource metadata例:

```json
{
  "source": {
    "name": "projectpokemon/champout",
    "license": "MIT",
    "sourceCommit": "d2885a864f041744df1de1b35f4ab3d2e52cf4db",
    "configFile": "data/champout/champout-template-sources.ja.json",
    "files": ["btl_attack_syn.json", "btl_std.json"]
  }
}
```

### 開発時script

Node.js scriptは開発時だけ使ってよい。

```bash
npm run report:champout
npm run generate:champout-templates
```

sourceがない場合、MIT Licenseが確認できない場合、source commitが特定できない場合、schemaが想定と異なる場合は、明確なエラーを出し、期待する入力形式をdocumentに書く。

## 必須Parserテスト例

少なくとも以下のunit testを追加する。

```text
エルフーンの
おいかぜ！
```

Expected:

```json
{ "type": "move", "actor": { "name": "エルフーン" }, "move": "おいかぜ" }
```

```text
マフォクシーの
まもる！
```

Expected:

```json
{ "type": "move", "actor": { "name": "マフォクシー" }, "move": "まもる" }
```

```text
マフォオクシーの
まもる/
```

辞書が読み込まれており、confidenceとmarginが十分高い場合のExpected:

```json
{
  "type": "move",
  "actor": { "name": "マフォクシー" },
  "move": "まもる",
  "classification": { "method": "fuzzy_dictionary" }
}
```

```text
効果は バツグンだ！
```

Expected:

```json
{ "type": "supereffective" }
```

```text
効果は いまひとつのようだ
```

Expected:

```json
{ "type": "resisted" }
```

```text
効果が ないようだ...
```

Expected:

```json
{ "type": "immune" }
```

未対応の特殊メッセージは以下を生成する。

```json
{ "type": "unknown", "reviewStatus": "unreviewed" }
```

## 統計ルール

統計は、パース済みまたはユーザー確認済みイベントからのみ計算する。

初期統計:

- Pokémon別の観測済み技使用数。
- sideが判明している場合、side別の観測済み技使用数。
- 交代回数。
- ひんし回数。
- 技またはprotect eventとしてパースできた場合のまもる使用回数。
- パースできた場合のTailwind / weather / terrain / room回数。
- 急所 / 効果抜群 / 半減 / 無効の回数。
- Unknown message count と unknown rate。

隠れた選択や表示されなかった行動を推測しない。

区別例:

- 画面に表示された `{pokemon}の {move}!` は observed move usage としてカウントできる。
- プレイヤーが選択したが、行動前に倒されたため表示されなかった技は observed usage としてカウントしない。

## UI要件

Frontendでは、以下の画面または同等のsectionを提供する。

### Capture / import

- 映像ソースとして `videoinput` を選択できる。
- 音声ソースとして `audioinput` または `音声なし` を選択できる。
- キャプチャ映像をアプリ内に表示できる。
- 動画または画像をアップロードできる。
- 基本的なmedia metadataを表示する。
- メッセージROIを確認・調整できる。
- リアルタイム解析を開始・停止できる。
- OCR結果、正規化テキスト、分類候補、unknown判定をライブログとして表示できる。
- 解析はブラウザ内で行うことを明示する。

### OCR review

- 元フレームとメッセージcropを表示する。
- OCR生テキスト、正規化テキスト、confidence、候補イベント分類を表示する。
- ポケモン名、技名、イベント型を手動修正できる。
- Unknown messageをreviewedにできる。

### Event timeline

- バトルイベントをtimestamp順に表示する。
- raw textを常に表示、または1クリックで確認できるようにする。
- parsed、fuzzy、manual、unknownの分類状態を区別する。

### Unknown messages

- Unknown messageをnormalized textと出現頻度でgroup化して表示する。
- source frameを表示する。
- 将来的に、頻出unknownから新しいruleを作れるようにする。

### Template / generated data

- 標準テンプレートは `SEED_TEMPLATE_RULES + CHAMPOUT_TEMPLATE_RULES` としてbundleする。
- champout由来テンプレートは `data/champout/champout-template-sources.ja.json` と `scripts/generate-champout-templates.mjs` から再生成できる。
- 次に追加するsource fileは `npm run report:champout` のscan reportとparser testで確認する。
- UI/説明文や曖昧なテンプレートはactive ruleへ入れず、unknown/reviewに残す。

### Stats

- 技使用、交代、ひんし、unknown rateなどの基本chart/tableを表示する。
- JSONとCSVのexportを提供する。

## Worker設計

重い処理はWeb Workerへ分離する。

推奨Worker:

```text
src/workers/ocr.worker.ts
src/workers/analysis.worker.ts
```

`ocr.worker.ts`:

- Tesseract.js workerの初期化。
- OCR実行。
- OCR進捗の通知。
- language data loading errorの通知。

`analysis.worker.ts`:

- 動画フレームの解析指示。
- 前処理。
- OCR workerとの連携、またはOCR providerの呼び出し。
- 正規化。
- イベントパース。
- 複数フレーム安定化。

Worker messageは型定義する。

```ts
export type AnalysisWorkerRequest =
  | { type: "analyzeFrame"; payload: AnalyzeFramePayload }
  | { type: "analyzeImage"; payload: AnalyzeImagePayload }
  | { type: "analyzeVideo"; payload: AnalyzeVideoPayload }
  | { type: "cancel"; payload: { jobId: string } };

export type AnalysisWorkerResponse =
  | { type: "progress"; payload: AnalysisProgress }
  | { type: "message"; payload: OCRMessage }
  | { type: "event"; payload: BattleEvent }
  | { type: "done"; payload: AnalysisResult }
  | { type: "error"; payload: AnalysisError };
```

リアルタイムキャプチャでは、`enumerateDevices()` と `getUserMedia()` はUI thread側で扱い、WorkerにはCanvas/OffscreenCanvas由来のフレームまたはcropを渡す。Workerはフレームごとの前処理、OCR、正規化、分類候補生成を担当し、UIはライブログとレビュー状態の管理を担当する。

キャンセル可能にする。長い動画解析でUIが固まらないようにする。

## Storage

MVPでは、解析結果をIndexedDBに保存する。

保存するrecord:

- Battle metadata。
- Media metadata。
- ROI profiles。
- OCR messages。
- Parsed events。
- Unknown events。
- Manual corrections。
- 辞書・テンプレートimport metadata。
- 必要最小限のframe/crop Blob。

localStorageは以下のような小さな設定だけに使う。

- 最後に使ったROI。
- UI設定。
- OCR設定。

リアルタイムキャプチャでは、大量のフレームを無制限に保存しない。保存対象は確定メッセージ、unknown、レビューに必要な代表フレーム/cropに絞り、リングバッファや上限設定を用意する。

大きな動画ファイル全体をIndexedDBへ自動保存しない。ユーザーが明示的に保存・exportする場合のみ保存する。

## Export / Import

ブラウザ内で以下をエクスポートできるようにする。

- Battle log JSON。
- Events CSV。
- Unknown messages CSV。
- Statistics CSV。
- Debug package JSON、必要ならZIP。

JSON exportにはschema versionを含める。

```json
{
  "schemaVersion": "0.1.0",
  "appVersion": "0.1.0",
  "exportedAt": "2026-06-29T00:00:00Z",
  "battle": {},
  "ocrMessages": [],
  "events": [],
  "unknowns": [],
  "manualCorrections": []
}
```

将来的にimportできるよう、schemaVersionを必ず持たせる。

## テスト方針

まず、実際のOCRを必要としないロジックからテストを書く。

必須unit test:

- Text normalization。
- Punctuation normalization。
- Template compilation。
- Dictionary fuzzy matching。
- Event rule matching。
- Unknown fallback。
- Stats aggregation。
- IndexedDB adapterの最低限の保存・読込。必要ならfake IndexedDBを使う。

OCR tests:

- deterministic parser testでは、OCR providerのtest doubleを使う。
- Tesseract.js自体を使うtestはoptionalにする。
- CIで重いOCR testを必須にしない。
- 公式ゲームスクリーンショットをfixtureとしてコミットしない。
- 画像fixtureが必要な場合は、ノイズ背景に白い日本語文字を載せた合成画像を使う。

Frontend tests:

- 可能な範囲で主要componentをテストする。
- 少なくとも、mock dataからevent row、unknown row、stats viewがrenderされることを確認する。

Build tests:

- `npm run build` が通ること。
- Node専用APIがブラウザbundleへ混入していないこと。
- GitHub Pages base pathでasset URLが壊れないこと。

## 最初の有用なMVPの受け入れ条件

以下を満たすまで、PRまたは実装は完了ではない。

- `videoinput` のキャプチャ映像をブラウザ内に表示し、リアルタイム解析を開始・停止できる。
- OCR結果、正規化テキスト、confidence、timestamp、分類候補がライブログとして流れる。
- 少なくともスクリーンショット、または短い動画クリップでも同じ解析パイプラインを検証できる。
- OCRがprovider interfaceの背後に隔離されている。
- 前処理がdebug imageまたはpreviewを出力できる。
- parserが必須MVPテキスト例を分類できる。
- Unknown textが保存され、UIに表示される。
- 統計がparsedまたはconfirmed eventのみから計算される。
- JSON exportとCSV exportが動作する。
- IndexedDBへの保存・読込が動作する。
- normalization、parser rules、unknown fallback、statsのテストがある。
- `npm run build` が成功する。
- GitHub Pages向けbase pathの設定または手順がREADMEにある。
- Tesseract.jsと日本語language dataへの言及がREADMEにある。
- Windows向けsetup noteがある。
- 公式アセットや外部dumpがコミットされていない。
- 実行時バックエンドなしで動作する。

## ドキュメント要件

ドキュメントは実用的かつ明示的に書く。

READMEに含めること:

- アプリが何をするか。
- アプリが何を保証しないか。
- ブラウザ内で処理すること。
- Windowsでのローカルsetup手順。
- `npm install`、`npm run dev`、`npm run build`、`npm run preview` の説明。
- GitHub Pages / gh-pages へのデプロイ方法。
- Tesseract.js日本語language dataの扱い。
- 外部テンプレートデータのimport方法。
- テストの実行方法。
- 既知の制限。

`docs/architecture.md` に含めること:

- Pipeline diagram。
- Browser-only architecture。
- Event schema。
- Unknown bucket design。
- Data import flow。
- OCR provider abstraction。
- Worker design。
- IndexedDB storage design。

`docs/data-import.md` に含めること:

- 外部データをブラウザへ読み込む方法。
- IndexedDBに保存される内容。
- export/import schema。
- templateの再生成方法。
- legal/licensing caution。

`docs/gh-pages-deploy.md` に含めること:

- `vite.config.ts` のbase設定。
- `gh-pages` branch方式。
- GitHub Actions方式を採用する場合の設定。
- よくある404 / asset path問題。
- Tesseract.js worker / wasm / traineddata path問題。

`docs/windows-setup.md` には、PowerShell向けのコマンドを含める。

## 実装優先順位

明示的な指示がない限り、以下の順に進める。

1. Vite + React + TypeScriptの静的アプリ構成を作る。
2. 共有event schemaとparser modelを定義する。
3. `videoinput` / `audioinput` 選択UIと `getUserMedia()` による開始・停止制御を実装する。
4. ROI調整UIとCanvas cropを実装する。
5. リアルタイムフレームサンプリングとライブログのdata modelを実装する。
6. Canvasベースの前処理pipelineを実装する。
7. OCR provider interfaceとtest doubleを実装する。
8. normalizerとparserのunit testを実装する。
9. 小さなin-repo sample dictionaryでdictionary matchingを実装する。
10. seed ruleによるtemplate/rule matchingを実装する。
11. M4.5として、名前・技以外の頻出文言向けseed template matcherを実装する。
12. unknown bucket data modelを実装する。
13. Web WorkerへOCR/解析処理を分離する。
14. Tesseract.js providerを実装する。
15. IndexedDB storage adapterを実装する。
16. review UIを実装する。
17. stats UIとexportを実装する。
18. champout compact generated packを安全に拡張し、分類率を上げる。
19. 画像/動画ファイル読み込みを同じ解析パイプラインへ接続する。
20. GitHub Pages向けbuild/deploy設定を整える。

interfaceが正しければ、小さなsample dictionaryとseed ruleで先にリアルタイムOCRログを成立させてよい。ただし、名前・技以外の文言を実用的に分類するには `champout` generated packを早期に接続する。

## 避けるべき典型ミス

- event parserではなく、汎用OCR viewerを作ってしまう。
- 辞書補正なしでOCRテキストを信頼する。
- ひとつの画面解像度をハードコードする。
- フレーム間安定化を無視する。
- unknown messageをエラー扱いする。
- 共通イベントパイプラインが動く前に、特殊技handlerを大量に作る。
- 表示されなかったプレイヤー選択を推測で記録する。
- 著作権のあるデータやスクリーンショットをコミットする。
- parser logicをReact componentへ依存させる。
- 前処理、OCR、パース、統計を巨大な1関数に混ぜる。
- FastAPIやPython backendを追加する。
- `fs` や `path` などNode専用APIをブラウザbundleに混ぜる。
- GitHub Pagesで動かないasset pathをハードコードする。
- Tesseract.jsのworker / wasm / traineddata URLを固定パスで書く。
- 大容量サンプル動画をリポジトリに入れる。

## 今後のエージェント報告形式

作業報告では、以下を含める。

```text
Summary
- What changed

Validation
- Commands run
- Results

Notes
- Missing dependencies, if any
- Known limitations
- Suggested next implementation step
```

報告は簡潔かつ具体的にする。
