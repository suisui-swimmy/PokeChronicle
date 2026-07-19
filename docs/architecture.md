# Architecture

PokeChronicle is a static browser application. The runtime app must work from the built `dist/` directory without an application server.

## MVP Pipeline

```text
videoinput capture / video / screenshot
-> lightweight message ROI watcher
   -> provisional visual candidate
   -> committed MessageObservation open / close
-> bounded OCR frame sampling
   -> ROI crop
   -> Canvas preprocessing
   -> OCR provider
-> text normalization
-> seed rules / generated champout templates / dictionary
-> OCRMessage / BattleEvent / UnknownEvent linked to the observation
-> review timeline
-> statistics and export
```

## M1 Input Boundary

The primary live input path is browser `MediaDevices` device capture:

- `enumerateDevices()` lists `videoinput` and `audioinput` sources.
- The user selects one `videoinput` as the live video source.
- The user selects one `audioinput`, or `音声なし` which maps to `audio: false`.
- The selected video input is opened with `getUserMedia()` using 16:9-preferred profiles: exact 1920x1080, exact 1280x720, ideal 1920x1080 with 16:9 aspect ratio, then a final fallback.
- The selected audio input is opened as a separate audio-only stream and routed through Web Audio playback. The preview video element stays muted, matching the `others/pokemon-SnapCrop` pattern.
- `getDisplayMedia()` screen sharing is not the M1 main path; keep it as a possible future separate mode.

## M2 Frame Sampling Boundary

M2 keeps processing in the browser UI thread until OCR work begins:

- The sampler reads the active `videoinput`, video file, or image file preview at 3fps or 5fps.
- ROI coordinates stay normalized, then convert to source pixels only when drawing the crop.
- The raw ROI crop is generated with Canvas and kept as a debug preview.
- The preprocessing pass extracts bright low-chroma text candidates, writes them onto a solid black or white background, optionally inverts the output, and upscales without smoothing.
- バトルHUDはHPゲージの緑色を必須にせず、相手側の赤/マゼンタ系または味方側の青/紫系ネームプレート、白枠、暗い情報帯の組み合わせで検出する。HUD消失でメッセージ候補フェーズを開き、再出現で閉じる。
- 小さいルビ帯は本文行へ関連付ける。元の前処理画像を保持したまま、ルビ候補だけを抑制した画像をfallback候補として生成し、濁点・半濁点は除去しない。
- Recent frame samples are kept in a small in-memory ring buffer. They are not persisted and do not grow without bounds.

## Message Watcher Boundary

表示発生の検出と内容解読は別レイヤーとして扱う:

- `src/core/preprocess/messagePresenceDetection.ts` はメッセージROIだけを最大幅320pxへ縮小し、既存の白文字・黄色文字pixel predicate、本文行band、foreground component、message fingerprintを再利用する。Tesseract、upscale、OCR candidate生成、parser、全画面motion判定は実行しない。
- watcherはデフォルト12fps、OCR samplerは従来どおり3fps/5fpsで動く。OCR workerがbusyでもwatcherは停止しない。
- presence gateはforeground比率 `0.004..0.18`、最大component比率 `0.72` 以下、text-like component 1件以上、本文行band 1件以上をnamed configで要求する。presence成立はまだ観測確定ではなく、pure state machine内の`CANDIDATE`へ入るだけである。`EMPTY -> CANDIDATE -> ACTIVE`のうち、候補中はReact state、Battle Log、crop evidence、OCR queueへ公開しない。
- candidate commitは直近5sample中3sample、250ms以上、presence/line/component/巨大component/commit scoreを要求する。候補は900msでtimeoutし、短い1行小領域は650msまで保持してpersistent UI判定を待つ。1〜2sampleのspikeや低品質候補はbounded transition diagnosticsだけを残す。
- `MessageVisualSignature`は32x12 occupancy grid、foreground bounds、本文行数を持つ。fingerprint距離だけでなく、前景のretention、包含、bounds overlap、line構造を比較し、文字が増えるprogressive renderやfadeは同じ観測へ継続する。通常同一閾値は距離`0.22`、別メッセージ切替は距離`0.28`超・包含`0.70`未満・構造変化・4sample安定・ACTIVE開始350ms経過を要求する。
- `src/core/preprocess/persistentUiModel.ts`は32x12 gridの直近36sampleだけを保持する。80%以上occupiedかつtransition率20%以下のcellをpersistentとし、candidate前景とのoverlap `0.70`以上かつdynamic foreground `0.30`未満なら固定UIとして抑制する。mask自体はOCR cropから削らない。ROI/media/解析のresetで履歴を破棄し、固定UI上へ動的なメッセージが重なった場合は新candidateへ進める。
- `src/core/events/messageObservation.ts` のACTIVEはabsence 3sampleでcloseし、15秒でstale closeする。`MessageObservation`は`lifecycle` (`active`/`closed`) と`resolution` (`pending`/`resolved`/`ocr_unknown`/`unread`) に加え、主ログ上の価値を`disposition` (`primary`/`review`/`suppressed`)で分離する。
- `src/core/preprocess/messagePhaseGate.ts`はVSとバトルHUDのstable edgeをOCR admission用の`unknown / message_candidate / hud / ended`へ変換する。VSは2sample visible後の2sample hidden、HUDは2sample hidden/visibleでphaseを開閉し、candidateに観測activityがない状態が6秒続けば`unknown`へ失効する。phaseは表示検出の必須条件ではなく、12fps watcherはphase unknownやOCR busyでも動き続ける。
- observation commit時のpriority sampleと通常3fps/5fps sampleは、直接workerへ送らず`src/core/ocr/messagePhaseOcrAdmission.ts`を通す。`message_candidate`は即時、HUD再出現後1.5秒以内はtrailing graceで既存schedulerへ渡す。その他のphaseは観測openから500msだけ最大3件のbounded待機枠でphase確定を待ち、その後はstrict visual fallbackだけを許可する。
- strict visual fallbackはpersistent model warm-up後ならcommit score `0.94`以上、presence `0.90`以上、persistent overlap `0.35`以下、dynamic foreground `0.65`以上を要求する。warm-up前はcommit `0.97`、presence `0.95`へ引き上げ、どちらもline band 1件以上、component 2件以上、最大component比 `0.55`以下を必須にする。弱いphase外観測は`phase_gate`としてsuppressedにし、raw cropとdiagnosticsは保持する。
- admission後は既存OCR schedulerへ渡し、queue、distinct FIFO、同一fingerprint置換、fallback、retry、retry preemption、worker request/responseの全経路でoptional `observationId`を維持する。表示終了後もOCR jobが残る場合は`closed + pending`で、全候補settle後に最終状態を決める。admission済みjobは途中のHUD変化だけではcancelせず、`battle_end`だけをhard stopにする。
- `MessageObservation.phaseAtCommit`と`ocrAdmissionReason`、diagnosticsの`ocrPhaseDeferred / ocrPhaseAdmitted / ocrPhaseRejected`、summaryのconfirmed/grace/fallback/deferred/rejected件数で判定根拠をexportする。旧JSONでfieldやnested counterが欠ける場合はnull/0へbackfillする。
- resolutionは候補全体から `BattleEvent > 実際に生成されたUnknownEvent > 強いvisual evidenceのunread > visual/OCR双方が弱いsuppressed` の順で決める。`ocr_unknown/review`は`unknownEventIds.length > 0`が必須で、`src/core/events/timeline.ts`のUnknown gate decisionを重複実装せず再利用する。empty OCRからUnknownEventを捏造せず、late resultによる`unread/suppressed -> ocr_unknown/resolved`だけを許可する。
- `src/core/events/observationMerge.ts`は1.5秒以内の隣接観測について、片方だけがresolvedで、OCR similarity、visual fingerprint、resolved entity、間の別resolved eventを組み合わせて安全にmergeする。resolved側をtargetにし、secondaryは削除せず`merged_duplicate`として参照を残す。
- 右側のライブイベントログはpure selectorを通し、committed pending、resolved、unread、実際のUnknownEventを持つreviewだけを表示する。`observation.id`をDOM keyに`検出中 -> 解析中 -> 解決 / 未解決 / 未読`を同じ行で更新し、raw OCR garbageは表示しない。resolved bundleは全`BattleEvent`をcanonical表示し、未解決は汎用文言にする。raw/normalized OCRはOCR Raw、Unknown/Timeline詳細、JSON exportに残る。
- crop evidenceは観測ごとにbest 1件を基本とし、既存の全体上限80件を共有する。watcher sampleそのものはReact stateやSystemログへ毎回流さず、candidate/commit/suppress/progressive/switch/merge/resolution transitionだけをbounded diagnosticsへ追加する。統計は従来どおり`BattleEvent`から計算し、`MessageObservation`やsuppressed observationをevent typeへ推測変換しない。

## M3 OCR Boundary

M3 moves recognition behind an OCR provider interface and keeps OCR work off the UI thread:

- `src/core/ocr/types.ts` defines the browser-side `OCRProvider` contract.
- `src/workers/ocr.worker.ts` owns the Tesseract.js provider and receives preprocessed ROI images from the app.
- The app keeps raw OCR text and derives normalized display text without overwriting the raw value.
- OCR jobs are bounded to one pending recognition at a time so slow recognition does not build an unbounded queue. 処理中に到着したフレームは最新1件だけを遅延枠へ保持する。
- 通常は主要行cropを `SINGLE_BLOCK` で1回だけ認識する。空文字、unknown、必須slot欠落などの場合だけ、行別 `SINGLE_LINE` と代替maskまたはfull画像の `SPARSE_TEXT` を最大3候補まで順次試す。
- 候補はparserで安全にevent化できるかを最優先して選び、Tesseract confidenceだけではfallbackを止めない。強い候補同士が異なるeventを示す場合はunknownへ保留する。
- Tesseract language data defaults to `https://tessdata.projectnaptha.com/4.0.0` so Japanese OCR does not depend on the jsDelivr package fallback path; worker/core/language asset paths can still be supplied with `VITE_TESSERACT_WORKER_PATH`, `VITE_TESSERACT_CORE_PATH`, and `VITE_TESSERACT_LANG_PATH`.
- Relative `VITE_TESSERACT_*` values are resolved against the Vite base path.

## M4 Parser Boundary

M4 keeps classification as pure browser-side TypeScript:

- `src/core/normalize/ocrText.ts` derives display text and compact `matchText` without overwriting raw OCR text.
- `scripts/generate-battle-dictionaries.mjs` reads local reference name lists from `others/pokemon-names` and `others/move-names`, then writes runtime-safe generated dictionaries under `src/core/dictionary` and `data/dictionaries`. When source Pokemon names only provide trailing gender markers, the generated dictionary also includes the genderless base label for OCR text that omits the marker.
- `src/core/dictionary/generatedBattleDictionary.ts` is the parser's default dictionary and contains generated Pokemon and move name entries only. The runtime app does not read `others/`.
- `src/core/dictionary/statDictionary.ts` is a small hand-written stat-name dictionary used only for constrained `{stat}` placeholders and canonical rank-change display.
- `src/core/dictionary/seedBattleDictionary.ts` remains a tiny test/support dictionary, not the default parser dictionary.
- `src/core/dictionary/fuzzyMatch.ts` accepts exact matches and only accepts fuzzy corrections when score, margin, and OCR confidence are high enough.
- `src/core/parser/seedParser.ts` classifies the first seed rules: observed move messages, effectiveness messages, critical/miss/fail/protect/faint/switch hints, and unknown fallback.
- OCR log entries display the current parser candidate, while review timeline state is handled in M5.

## M4.5 Seed Template Boundary

M4.5 adds the template matcher that later generated champout rules can feed:

- `data/rules/event_rules.ja.json` is the version-controlled seed rule source for frequent non-move messages.
- `src/core/templates/templateMatcher.ts` compiles seed patterns with placeholders such as `{pokemon}`, `{move}`, `{stat}`, and bounded `{text}`.
- Template matching runs after high-priority context rules and before flexible move span matching.
- Seed templates can classify damage, healing, weather, terrain, ability, and item activation messages without bundling champout-derived full template dumps.
- No browser JSON/ZIP import UI, IndexedDB template persistence, or champout-derived full text is included in M4.5.

## M5 Review Timeline Boundary

M5 turns OCR/parser output into reviewable in-memory evidence:

- `src/core/events/timeline.ts` converts parser results into `OCRMessage`, `BattleEvent`, or `UnknownEvent` records without depending on React. Unknown gateはreason付きdecisionを返し、短文、timer、UI fragment、記号noise、prefix-only、低confidenceなどを主ログのreviewへ昇格させない。
- Raw OCR text is kept on every OCR message and timeline item; normalized text remains derived display data.
- Repeated same-message timeline items within a short near-frame window are suppressed, while raw OCR log entries remain visible.
- The live review panel is viewport-bounded and tabbed across timeline, resolved events, unknowns, raw OCR, and system logs. It is for monitoring and triage, not for dumping every log category into the page body.
- Raw OCR display groups consecutive same-message entries in the UI; raw records remain available in memory for later persistence/export work.
- The app shows source crop preview, parser evidence, and a minimal unknown review state for the active tab.

## M6 Storage And Export Boundary

M6 makes the review data durable without adding a runtime server:

- `src/storage/export.ts` builds schema-versioned Battle Log JSON documents from message observations, OCR messages, parsed events, unknowns, ROI metadata, media metadata, bounded crop evidence, and manual corrections. OCR messageには最大3件の候補履歴を保持し、HUD/VSの永続集計と最大64件のphase遷移もexportする。session履歴はmessage observation 512件、OCR 1024件、event 512件、unknown 512件まで保持し、UIはlive observation/resolved/unknown各48件とOCR Raw 30件だけを描画する。
- Battle Log JSONの`messageObservations`と`messageObservationSummary`は後方互換fieldである。disposition、suppression reason、commit/persistent/dynamic score、merge先はoptional fieldとして保存し、欠落する旧JSONはresolutionとUnknownEvent参照からbackfillする。観測がない場合や一部eventが観測へ未紐付けの場合も右ライブログは従来のresolved eventsをfallback表示する。provisional candidateはexportせず、`bestEvidenceRef`はbounded evidenceの参照だけを保存し、Object URLを永続参照にしない。
- `src/storage/indexedDb.ts` is the only browser storage adapter for Battle Logs. It stores the current document in IndexedDB and can restore the latest saved log after a reload.
- JSON import is for user-controlled Battle Log restore, not champout/template import. Imported logs are validated by `schemaVersion` before they replace the review state.
- Events CSV and Unknown messages CSV exports are derived from the same Battle Log document. Unknown CSV includes review notes from durable manual corrections.
- The app saves only bounded ROI crop evidence. It never stores the full video file or an unbounded frame stream.
- OCR実行中は二値message fingerprintごとに最新frameへ置換しながら、異なる文面を最大3件のFIFOへ保持する。別文面が待っている場合は現在文面の残りfallbackを中断し、短い連続メッセージを優先する。

## M7 Generated Champout Pack Boundary

M7 includes a standard generated champout template pack:

- `scripts/report-champout-files.mjs` scans `others/champout/rom-txt/jpn/btl_*.json`, summarizes candidate counts, label prefixes, placeholder patterns, event type distribution, and risk hints, and intentionally omits raw `OriginalText` dumps from committed output.
- `data/champout/champout-template-sources.ja.json` is the hand-reviewed source configuration. It supports `enabled`, `hold`, and `disabled` source statuses; only `enabled` files are generated into the runtime pack.
- `scripts/generate-champout-templates.mjs` is a development/build-time Node script. It verifies the local `others/champout` MIT license and source commit, reads selected Japanese battle text files, and writes `data/generated/champout-event-rules.ja.json`.
- The generated pack is compact: it currently uses `OriginalText` from `btl_attack_syn.json`, `btl_std.json`, and narrowly allow-listed live-message labels from `btl_set.json`, including status/faint/effectiveness, `WazaAvoid(_E)` miss messages, and single-stat `RankupLv` / `RankdownLv` Lv1-Lv2 messages. It records source file, key path, label name, original text, and source commit for each generated rule. Short but high-signal templates such as `{pokemon}の{move}!`, `{pokemon}戻れ!`, and `{pokemon}の{stat}が 上がった!` are allowed because the parser constrains their placeholders to dictionaries.
- `src/core/templates/generatedChampoutTemplateRules.ts` imports the generated JSON. Runtime code does not read from `others/champout`.
- `src/core/templates/standardTemplateRules.ts` combines `SEED_TEMPLATE_RULES` with generated champout rules for live parsing.
- Third-party source, MIT license, source commit, and notice details are recorded in `THIRD_PARTY_NOTICES.md`.
- Additional `btl_*.json` files must be added one at a time through scan report review, config changes, regeneration, targeted parser tests, full test/build verification, and notice updates.

## Constrained Champout Decoding

The parser treats generated champout rules as a constrained search problem before falling back to broader matching:

- `src/core/templates/constrainedTemplateDecoder.ts` evaluates match surfaces derived from the raw OCR text, normalized text, OCR lines, and short line windows.
- Fixed template text is fuzzy-aligned against the OCR surface. Placeholders are not free-form except for bounded `{text}`.
- `{pokemon}` and `{target}` resolve only through the Pokemon dictionary. `{move}` resolves only through the move dictionary. `{stat}` resolves only through the small stat dictionary. `{text}` is capped and stored as evidence for trainer names or OCR noise; it does not decide the event type.
- Candidate acceptance uses a combined score from literal alignment, dictionary match quality, OCR confidence, and surface priority. Fuzzy dictionary matches also require clear margin and enough OCR confidence.
- Constrained decoding is intentionally narrow. It admits generated champout candidates only for reviewed live-message shapes such as move, switch-in, switch-out, status/status-cure, faint, immune/effectiveness, flinch/item priority, activation/damage, and stat rank up/down surfaces.
- Rejected but plausible candidates are returned as `constrained-review:` evidence so the unknown bucket remains reviewable instead of silently accepting ambiguous OCR.
- Parsed events preserve the original `rawText`; normalized and match text remain derived values.
- The decoder is pure TypeScript and uses no Node, OpenCV, backend, cloud OCR, uploads, or runtime `others/champout` reads.

## M8 Statistics And MVP Acceptance

M8 closes the first useful MVP around observed battle-message logs:

- `src/core/stats/battleStats.ts` derives MVP statistics from resolved `BattleEvent` records and reviewable `UnknownEvent` records.
- The statistics intentionally count observed events only: observed moves, Pokemon action events, switches, faints, unknown messages/rate, effectiveness messages, and critical hits.
- Pokemon action counts require an actor name and never infer `selected_action` from message text alone.
- The capture workspace shows the statistics beside the review/export controls so users can judge log quality before exporting JSON or CSV.
- Static deploy is prepared through the GitHub Pages Actions workflow, which builds the committed browser app into `dist/` without a runtime server.

## Runtime Constraints

- Browser-only processing by default.
- `others/` is a local reference area, not a runtime dependency.
- `rawText` from OCR is preserved and normalized text is treated as derived data.
- Unknown messages are first-class data for review and future rule creation.
