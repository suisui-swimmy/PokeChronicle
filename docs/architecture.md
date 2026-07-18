# Architecture

PokeChronicle is a static browser application. The runtime app must work from the built `dist/` directory without an application server.

## MVP Pipeline

```text
videoinput capture / video / screenshot
-> lightweight message ROI watcher
   -> MessageObservation open / close
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
- presence gateはforeground比率 `0.004..0.18`、最大component比率 `0.72` 以下、text-like component 1件以上、本文行band 1件以上をnamed configで要求する。1sample spikeでは開かず、直近3sample中2sampleでopenする。
- `src/core/events/messageObservation.ts` のpure state machineは、absence 2sampleでclose、別fingerprint 2sampleで旧観測をcloseして新観測をopen、15秒でstale closeする。fingerprint距離 `0.16` 以内の小揺れは同じ観測として継続する。
- `MessageObservation`は`lifecycle` (`active`/`closed`) と`resolution` (`pending`/`resolved`/`ocr_unknown`/`unread`) を分離する。表示終了後もOCR jobが残る場合は`closed + pending`として扱い、遅延結果による`unread -> ocr_unknown/resolved`の昇格を許可する。逆方向へは戻さない。
- observation open時は既存OCR schedulerへpriority sampleを1件渡す。queue、distinct FIFO、同一fingerprint置換、fallback、retry、retry preemption、worker request/responseの全経路でoptional `observationId`を維持する。
- 右側のライブイベントログは`observation.id`をDOM keyにし、`検出中 -> 解析中 -> 解決 / 未解決 / 未読`を同じ行で更新する。`resolved`は同じ観測の全`BattleEvent`をcanonical表示し、`ocr_unknown`はbest normalized text、`unread`は内容未読だけを示す。
- OCR文字列が完全に空の場合は`UnknownEvent`を捏造しない。`UnknownEvent`の既存noise gateも変更しない。統計は従来どおり`BattleEvent`/既存unknown集計から作り、`MessageObservation`をmove・switch・damageへ推測変換しない。
- crop evidenceは観測ごとにbest 1件を基本とし、既存の全体上限80件を共有する。watcher sampleそのものはReact stateやSystemログへ毎回流さず、open/change/close/resolution/staleのtransitionだけを診断へ追加する。

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

- `src/core/events/timeline.ts` converts parser results into `OCRMessage`, `BattleEvent`, or `UnknownEvent` records without depending on React.
- Raw OCR text is kept on every OCR message and timeline item; normalized text remains derived display data.
- Repeated same-message timeline items within a short near-frame window are suppressed, while raw OCR log entries remain visible.
- The live review panel is viewport-bounded and tabbed across timeline, resolved events, unknowns, raw OCR, and system logs. It is for monitoring and triage, not for dumping every log category into the page body.
- Raw OCR display groups consecutive same-message entries in the UI; raw records remain available in memory for later persistence/export work.
- The app shows source crop preview, parser evidence, and a minimal unknown review state for the active tab.

## M6 Storage And Export Boundary

M6 makes the review data durable without adding a runtime server:

- `src/storage/export.ts` builds schema-versioned Battle Log JSON documents from message observations, OCR messages, parsed events, unknowns, ROI metadata, media metadata, bounded crop evidence, and manual corrections. OCR messageには最大3件の候補履歴を保持し、HUD/VSの永続集計と最大64件のphase遷移もexportする。session履歴はmessage observation 512件、OCR 1024件、event 512件、unknown 512件まで保持し、UIはlive observation/resolved/unknown各48件とOCR Raw 30件だけを描画する。
- Battle Log JSONの`messageObservations`と`messageObservationSummary`は後方互換fieldである。旧JSONは空配列と空summaryへbackfillし、観測がない場合の右ライブログは従来のresolved eventsを表示する。`bestEvidenceRef`はbounded evidenceの参照だけを保存し、Object URLを永続参照にしない。
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
