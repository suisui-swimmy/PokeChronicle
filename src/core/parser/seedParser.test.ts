import { describe, expect, it } from "vitest";
import { renderBattleEventCanonicalText } from "../events/canonicalText";
import { getParsedBattleEvents, parseBattleMessage } from "./seedParser";

describe("parseBattleMessage", () => {
  it("parses a basic move message", () => {
    const result = parseBattleMessage("エルフーンの\nおいかぜ！");

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "エルフーン" },
      move: "おいかぜ",
      classification: {
        method: "template_dictionary",
        templateId: "champout_move_1oj9w2v",
      },
    });
  });

  it("parses protect as an observed move when it appears in actor move form", () => {
    const result = parseBattleMessage("マフォクシーの\nまもる！");

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "マフォクシー" },
      move: "まもる",
      classification: {
        method: "template_dictionary",
        templateId: "champout_move_1oj9w2v",
      },
    });
  });

  it("uses the generated full name dictionaries by default", () => {
    const result = parseBattleMessage("ガブリアスの\nじしん！");

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "ガブリアス" },
      move: "じしん",
    });
  });

  it("parses noisy OCR prefixes by exact pokemon and move spans", () => {
    const result = parseBattleMessage({
      rawText: "きき\nにーー\nエルフーンの\nムーンフォース/",
      lines: ["きき", "にーー", "エルフーンの", "ムーンフォース/"],
      ocrConfidence: 0.74,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "エルフーン", side: null },
      move: "ムーンフォース",
      classification: {
        method: "template_dictionary",
        templateId: "champout_move_1oj9w2v",
      },
    });
  });

  it("uses the same span extraction for arbitrary generated dictionary names", () => {
    const result = parseBattleMessage({
      rawText: "xx\nガブリアスの\nじしん/",
      lines: ["xx", "ガブリアスの", "じしん/"],
      ocrConfidence: 0.8,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "ガブリアス" },
      move: "じしん",
      classification: { method: "template_dictionary" },
    });
  });

  it("keeps opponent side only when 相手の is immediately before the actor span", () => {
    const result = parseBattleMessage({
      rawText: "ノイズ\n相手の\nカラマネロの\nばかぢから/",
      lines: ["ノイズ", "相手の", "カラマネロの", "ばかぢから/"],
      ocrConfidence: 0.82,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "カラマネロ", side: "opponent" },
      move: "ばかぢから",
    });
  });

  it("does not split on の characters inside move names", () => {
    const result = parseBattleMessage("ルカリオの\nいのちがけ！");

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "ルカリオ" },
      move: "いのちがけ",
    });
  });

  it("uses safe fuzzy dictionary correction for high-confidence OCR", () => {
    const result = parseBattleMessage({
      rawText: "マフォオクシーの\nまもる/",
      ocrConfidence: 0.9,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "マフォクシー" },
      move: "まもる",
      classification: {
        method: "template_dictionary",
        templateId: "champout_move_1oj9w2v",
      },
    });
  });

  it("does not silently accept fuzzy corrections from low-confidence OCR", () => {
    const result = parseBattleMessage({
      rawText: "マフォオクシーの\nまもる/",
      ocrConfidence: 0.52,
    });

    expect(result).toMatchObject({
      status: "unknown",
      reviewStatus: "unreviewed",
    });
    expect(result.candidateMatches.join("\n")).toContain("low-ocr-confidence");
  });

  it("parses effectiveness messages", () => {
    expect(parseBattleMessage("効果は バツグンだ！")).toMatchObject({
      status: "event",
      event: { type: "supereffective" },
    });
    expect(parseBattleMessage("効果は パツグンだ")).toMatchObject({
      status: "event",
      event: { type: "supereffective" },
    });
    expect(parseBattleMessage("効果は パッグンだ")).toMatchObject({
      status: "event",
      event: { type: "supereffective" },
    });
    expect(parseBattleMessage("相手の カラマネロと オーロングに\n効果は バッグンだ/")).toMatchObject({
      status: "event",
      event: { type: "supereffective" },
    });
    expect(parseBattleMessage("ドドゲザンに 効果は いまひとつだ")).toMatchObject({
      status: "event",
      event: { type: "resisted" },
    });
    expect(parseBattleMessage("効果は いまひとつのようだ")).toMatchObject({
      status: "event",
      event: { type: "resisted" },
    });
    expect(parseBattleMessage("効果が ないようだ...")).toMatchObject({
      status: "event",
      event: { type: "immune" },
    });
  });

  it("parses noisy context messages before attempting span move matching", () => {
    expect(
      parseBattleMessage({
        rawText: "きき\n効果は バツグンだ/",
        lines: ["きき", "効果は バツグンだ/"],
        ocrConfidence: 0.7,
      }),
    ).toMatchObject({
      status: "event",
      event: { type: "supereffective" },
    });
  });

  it("parses noisy HP loss messages with seed template rules", () => {
    const result = parseBattleMessage({
      rawText: "尼手の イダイトウは\n命が 少し削られた/\nーー 9/",
      lines: ["尼手の イダイトウは", "命が 少し削られた/", "ーー 9/"],
      ocrConfidence: 0.67,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "damage",
      actor: { name: "イダイトウ", side: null },
      move: null,
      classification: {
        method: "template_dictionary",
        templateId: "hp_loss_life_cost",
      },
    });
  });

  it("parses noisy life-cost HP loss variants without overwriting raw text", () => {
    const result = parseBattleMessage({
      rawText: "イヅダイトウは\n命か 少し削られだ/",
      lines: ["イヅダイトウは", "命か 少し削られだ/"],
      ocrConfidence: 0.82,
    });

    expect(result.status).toBe("event");
    expect(result.rawText).toBe("イヅダイトウは\n命か 少し削られだ/");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "damage",
      actor: { name: "イダイトウ" },
      move: null,
    });
  });

  it("parses exact life-cost OCR variants through seed templates", () => {
    for (const rawText of [
      "イダイトウは 命か 少し削られだ",
      "イダイトウは 命が 少し削られだ",
      "イダイトウは 命か 少し削られた",
    ]) {
      expect(parseBattleMessage(rawText)).toMatchObject({
        status: "event",
        event: { type: "damage", actor: { name: "イダイトウ" } },
      });
    }
  });

  it("parses exact opponent HP loss templates with opponent side", () => {
    const result = parseBattleMessage({
      rawText: "相手の イダイトウは\n命が 少し削られた/",
      lines: ["相手の イダイトウは", "命が 少し削られた/"],
      ocrConfidence: 0.86,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "damage",
      actor: { name: "イダイトウ", side: "opponent" },
      classification: { templateId: "hp_loss_life_cost_opponent" },
    });
  });

  it("parses seed weather and terrain templates", () => {
    expect(parseBattleMessage("雨が 降り始めた！")).toMatchObject({
      status: "event",
      event: {
        type: "weather_start",
        classification: { templateId: "weather_start" },
      },
    });
    expect(parseBattleMessage("エレキフィールドに なった！")).toMatchObject({
      status: "event",
      event: {
        type: "terrain_start",
        classification: { templateId: "terrain_start" },
      },
    });
  });

  it("parses simple stat boost and drop messages as context events", () => {
    expect(parseBattleMessage("相手の カラマネロの\n記導 習防が ごぐーんと上がった/")).toMatchObject({
      status: "event",
      event: { type: "boost" },
    });
    expect(parseBattleMessage("エルフーンの すばやさが 下がった！")).toMatchObject({
      status: "event",
      event: { type: "unboost" },
    });
    expect(parseBattleMessage("エルフーンの すばやさが 下かった！")).toMatchObject({
      status: "event",
      event: { type: "unboost" },
    });
    expect(parseBattleMessage("エルフーンの すばやさが 下がっだ！")).toMatchObject({
      status: "event",
      event: { type: "unboost" },
    });
    expect(parseBattleMessage("マフォクシーの 特攻が がくっと 下がった/")).toMatchObject({
      status: "event",
      event: { type: "unboost" },
    });
  });

  it("parses protect and side-end context OCR variants", () => {
    expect(parseBattleMessage("マフォクシーは 守りの体勢に入った/")).toMatchObject({
      status: "event",
      event: {
        type: "protect",
        classification: { templateId: "protect_stance" },
      },
    });
    expect(parseBattleMessage("マフォクシーは 攻撃から 身を守った/")).toMatchObject({
      status: "event",
      event: {
        type: "protect",
        classification: { templateId: "protect_block" },
      },
    });
    expect(parseBattleMessage("追い風が 止んだ/")).toMatchObject({
      status: "event",
      event: { type: "side_end" },
    });
    expect(parseBattleMessage("追い風か 止んだ/")).toMatchObject({
      status: "event",
      event: { type: "side_end" },
    });
  });

  it("parses faint and battle-end OCR variants", () => {
    for (const rawText of ["たおれだ", "だたおれだ"]) {
      expect(parseBattleMessage(rawText)).toMatchObject({
        status: "event",
        event: { type: "faint" },
      });
    }

    for (const rawText of [
      "降参が 選ばれました",
      "降参が 選はばれました",
      "勝負に 負けた",
      "勝負に 口けた",
    ]) {
      expect(parseBattleMessage(rawText)).toMatchObject({
        status: "event",
        event: { type: "battle_end" },
      });
    }
  });

  it("relaxes move OCR matching only inside a strong actor-move shape", () => {
    const result = parseBattleMessage({
      rawText: "相手の キュウコンの\nオーパーヒードト/",
      lines: ["相手の キュウコンの", "オーパーヒードト/"],
      ocrConfidence: 0.86,
    });

    expect(result.status).toBe("event");
    expect(result.status === "event" ? result.event : null).toMatchObject({
      type: "move",
      actor: { name: "キュウコン", side: "opponent" },
      move: "オーバーヒート",
      classification: {
        method: "template_dictionary",
        templateId: "champout_move_1pbrfiv",
      },
    });
  });

  it("parses noisy opponent move messages with constrained champout decoding", () => {
    const kyukon = parseBattleMessage({
      rawText: "相手の キュウコンの\nオーパーヒードト/",
      lines: ["相手の キュウコンの", "オーパーヒードト/"],
      ocrConfidence: 0.86,
    });
    const basculegion = parseBattleMessage({
      rawText: "相手の イヅダイトウの\nアクアジエット/",
      lines: ["相手の イヅダイトウの", "アクアジエット/"],
      ocrConfidence: 0.86,
    });
    const delphox = parseBattleMessage({
      rawText: "マフオォクグシーの\nまもる/",
      lines: ["マフオォクグシーの", "まもる/"],
      ocrConfidence: 0.88,
    });

    expect(kyukon).toMatchObject({
      status: "event",
      rawText: "相手の キュウコンの\nオーパーヒードト/",
      event: {
        type: "move",
        actor: { name: "キュウコン", side: "opponent" },
        move: "オーバーヒート",
        classification: {
          method: "template_dictionary",
          templateId: "champout_move_1pbrfiv",
        },
      },
    });
    expect(basculegion).toMatchObject({
      status: "event",
      event: {
        type: "move",
        actor: { name: "イダイトウ", side: "opponent" },
        move: "アクアジェット",
      },
    });
    expect(delphox).toMatchObject({
      status: "event",
      event: {
        type: "move",
        actor: { name: "マフォクシー" },
        move: "まもる",
      },
    });
  });

  it("trims short suffix noise without mixing it into actor or move slots", () => {
    const result = parseBattleMessage({
      rawText: "相手の キュウコンの オームーヒードヒ/ bh、亜",
      ocrConfidence: 0.86,
    });

    expect(result).toMatchObject({
      status: "event",
      rawText: "相手の キュウコンの オームーヒードヒ/ bh、亜",
      event: {
        type: "move",
        actor: { name: "キュウコン", side: "opponent" },
        move: "オーバーヒート",
      },
    });

    if (result.status === "event") {
      expect(result.event.actor.name).not.toContain("bh");
      expect(result.event.move).toBe("オーバーヒート");
      expect(result.event.classification.alternatives.join("\n")).toContain("suffixNoise");
    }
  });

  it("parses noisy switch messages with constrained champout decoding", () => {
    expect(
      parseBattleMessage({
        rawText: "ゆけつ/ ガブプリアス/",
        ocrConfidence: 0.82,
      }),
    ).toMatchObject({
      status: "event",
      event: { type: "switch_in", actor: { name: "ガブリアス" } },
    });
    expect(
      parseBattleMessage({
        rawText: "Mercysanは 國論謀キュウコンを 繰り出した!",
        ocrConfidence: 0.82,
      }),
    ).toMatchObject({
      status: "event",
      event: { type: "switch_in", actor: { name: "キュウコン" } },
    });
    expect(
      parseBattleMessage({
        rawText: "ドドグザフン\n戻れ/",
        ocrConfidence: 0.84,
      }),
    ).toMatchObject({
      status: "event",
      event: { type: "switch_out", actor: { name: "ドドゲザン" } },
    });
  });

  it("parses double switch-in call messages as two switch-in events", () => {
    const result = parseBattleMessage({
      rawText: "ゆけっ! エルフーン!\nマフォクシー!",
      lines: ["ゆけっ! エルフーン!", "マフォクシー!"],
      ocrConfidence: 0.92,
    });
    const events = getParsedBattleEvents(result);

    expect(result).toMatchObject({
      status: "event",
      event: {
        type: "switch_in",
        actor: { name: "エルフーン" },
        classification: { templateId: "switch_in_double_call" },
      },
    });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.actor.name)).toEqual(["エルフーン", "マフォクシー"]);
    expect(events.every((event) => event.type === "switch_in")).toBe(true);
  });

  it("parses noisy double switch-in call OCR from live logs", () => {
    const result = parseBattleMessage({
      rawText: "ゆけつ/ エルフーン/\nマフオォオグクシー/",
      lines: ["ゆけつ/ エルフーン/", "マフオォオグクシー/"],
      ocrConfidence: 0.847,
    });
    const events = getParsedBattleEvents(result);

    expect(result.status).toBe("event");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.actor.name)).toEqual(["エルフーン", "マフォクシー"]);
  });

  it("parses titled trainer double switch-in messages as two switch-in events", () => {
    const result = parseBattleMessage({
      rawText: "Mercysanは ランクマスター エルフーンと\nイダイトウを 繰り出した!",
      lines: ["Mercysanは ランクマスター エルフーンと", "イダイトウを 繰り出した!"],
      ocrConfidence: 0.92,
    });
    const events = getParsedBattleEvents(result);

    expect(result).toMatchObject({
      status: "event",
      event: {
        type: "switch_in",
        actor: { name: "エルフーン" },
        classification: { templateId: "switch_in_double_trainer" },
      },
    });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.actor.name)).toEqual(["エルフーン", "イダイトウ"]);
  });

  it("parses switch messages from terminator-trimmed noisy surfaces", () => {
    expect(
      parseBattleMessage({
        rawText: "ゆけつ/ ガプリアス/ eとー貝",
        ocrConfidence: 0.84,
      }),
    ).toMatchObject({
      status: "event",
      rawText: "ゆけつ/ ガプリアス/ eとー貝",
      event: { type: "switch_in", actor: { name: "ガブリアス" } },
    });
    expect(
      parseBattleMessage({
        rawText: "ドドグザン 戻れ/ -思霜いa",
        ocrConfidence: 0.84,
      }),
    ).toMatchObject({
      status: "event",
      event: { type: "switch_out", actor: { name: "ドドゲザン" } },
    });
  });

  it("parses btl_set status, cure, faint, and immune templates", () => {
    expect(parseBattleMessage("マフォクシーはやけどを 負った!")).toMatchObject({
      status: "event",
      event: {
        type: "status",
        actor: { name: "マフォクシー" },
        classification: {
          method: "template_dictionary",
          templateId: "champout_status_x7pe38",
        },
      },
    });
    expect(parseBattleMessage("相手の マフォクシーのやけどが 治った!")).toMatchObject({
      status: "event",
      event: {
        type: "status_cure",
        actor: { name: "マフォクシー", side: "opponent" },
        classification: {
          method: "template_dictionary",
          templateId: "champout_status_cure_oyr09e",
        },
      },
    });
    expect(parseBattleMessage("ガブリアスは たおれた!")).toMatchObject({
      status: "event",
      event: {
        type: "faint",
        actor: { name: "ガブリアス" },
      },
    });
    expect(parseBattleMessage("マフォクシーには効果が ないようだ...")).toMatchObject({
      status: "event",
      event: {
        type: "immune",
        target: { name: "マフォクシー" },
      },
    });
  });

  it("projects noisy btl_set status templates only inside narrow shapes", () => {
    const burned = parseBattleMessage({
      rawText: "マフォジシーはやけどを 負った/",
      ocrConfidence: 0.88,
    });
    const cured = parseBattleMessage({
      rawText: "相手の マフォジシーのやけどが 治った/",
      ocrConfidence: 0.88,
    });
    const fainted = parseBattleMessage({
      rawText: "ガプリアスは たおれだ/",
      ocrConfidence: 0.86,
    });

    expect(burned).toMatchObject({
      status: "event",
      event: {
        type: "status",
        actor: { name: "マフォクシー" },
        classification: { templateId: "champout_status_x7pe38" },
      },
    });
    expect(cured).toMatchObject({
      status: "event",
      event: {
        type: "status_cure",
        actor: { name: "マフォクシー", side: "opponent" },
        classification: { templateId: "champout_status_cure_oyr09e" },
      },
    });
    expect(fainted).toMatchObject({
      status: "event",
      event: {
        type: "faint",
        actor: { name: "ガブリアス" },
      },
    });
  });

  it("parses newly allowed btl_set resolution templates from real OCR variants", () => {
    const megaEvolution = parseBattleMessage({
      rawText: "相手の バンギラスは\nメ力八ンギラスに メガシン力した/",
      ocrConfidence: 0.82,
    });
    const failed = parseBattleMessage({
      rawText: "しじしかし うまぐ   決ま らなかつた//",
      ocrConfidence: 0.88,
    });
    const redirection = parseBattleMessage({
      rawText: "ヤハバソチヤは\n注目の的に なった/",
      ocrConfidence: 0.9,
    });
    const supereffective = parseBattleMessage({
      rawText: "ヤハソチヤに\n効果は バウツグンただ/",
      ocrConfidence: 0.83,
    });
    const fainted = parseBattleMessage({
      rawText: "ヤミラ三は たおあれた/",
      ocrConfidence: 0.88,
    });
    const opponentFainted = parseBattleMessage({
      rawText: "相手の バンギキギキラスは だおれだた/",
      ocrConfidence: 0.88,
    });

    expect(megaEvolution).toMatchObject({
      status: "event",
      event: {
        type: "activate",
        actor: { name: "バンギラス", side: "opponent" },
        classification: { method: "template_dictionary" },
      },
    });
    expect(failed).toMatchObject({
      status: "event",
      event: {
        type: "fail",
        classification: { templateId: "champout_fail_1mhcr35" },
      },
    });
    expect(redirection).toMatchObject({
      status: "event",
      event: {
        type: "redirection",
        actor: { name: "ヤバソチャ" },
        classification: { templateId: "champout_redirection_zp3lh" },
      },
    });
    expect(supereffective).toMatchObject({
      status: "event",
      event: {
        type: "supereffective",
        target: { name: "ヤバソチャ" },
        classification: { templateId: "champout_supereffective_hqpe25" },
      },
    });
    expect(fainted).toMatchObject({
      status: "event",
      event: {
        type: "faint",
        actor: { name: "ヤミラミ" },
      },
    });
    expect(opponentFainted).toMatchObject({
      status: "event",
      event: {
        type: "faint",
        actor: { name: "バンギラス", side: "opponent" },
      },
    });
  }, 20000);

  it("parses complete weather and tea-effect btl_set messages but leaves fragments unknown", () => {
    const teaEffect = parseBattleMessage("ヤバソチャが たてた お茶をバンギラスは 飲みほした!");
    const sandDamage = parseBattleMessage("砂あらしが相手の バンギラスを 襲う!");
    const noisySandStart = parseBattleMessage({
      rawText: "砂 あらじしが 吹き始めた /",
      ocrConfidence: 0.85,
    });
    const partialTea = parseBattleMessage({
      rawText: "ヤ六ソチヤがか たてた お茶を",
      ocrConfidence: 0.88,
    });
    const partialSand = parseBattleMessage({
      rawText: "砂あらしが ー",
      ocrConfidence: 0.85,
    });

    expect(teaEffect).toMatchObject({
      status: "event",
      event: {
        type: "activate",
        actor: { name: "ヤバソチャ" },
        target: { name: "バンギラス" },
        classification: { templateId: "champout_activate_1gp6nis" },
      },
    });
    expect(sandDamage).toMatchObject({
      status: "event",
      event: {
        type: "damage",
        target: { name: "バンギラス", side: "opponent" },
        classification: { method: "template_dictionary" },
      },
    });
    expect(noisySandStart).toMatchObject({
      status: "event",
      event: {
        type: "weather_start",
        classification: { templateId: "weather_start" },
      },
    });
    expect(partialTea).toMatchObject({ status: "unknown" });
    expect(partialSand).toMatchObject({ status: "unknown" });
  });

  it("parses requested champout/live resolution messages from real-log review", () => {
    const flinch = parseBattleMessage("相手の ガメノデスは\nひるんで 技が だせない!");
    const priorityItem = parseBattleMessage(
      "相手の ガメノデスは せんせいのツメで\n行動が はやくなった!",
    );
    const megaEvolution = parseBattleMessage(
      "相手の バンギラスは メガバンギラスに メガシンカした!",
    );
    const teaEffect = parseBattleMessage(
      "ヤバソチャが たてた お茶を\nメタグロスは 飲みほした!",
    );

    expect(flinch).toMatchObject({
      status: "event",
      event: {
        type: "flinch",
        actor: { name: "ガメノデス", side: "opponent" },
        classification: { method: "template_dictionary" },
      },
    });
    expect(priorityItem).toMatchObject({
      status: "event",
      event: {
        type: "item",
        actor: { name: "ガメノデス", side: "opponent" },
        classification: { method: "template_dictionary" },
      },
    });
    expect(megaEvolution).toMatchObject({
      status: "event",
      event: {
        type: "activate",
        actor: { name: "バンギラス", side: "opponent" },
        classification: { method: "template_dictionary" },
      },
    });
    expect(teaEffect).toMatchObject({
      status: "event",
      event: {
        type: "activate",
        actor: { name: "ヤバソチャ" },
        target: { name: "メタグロス" },
        classification: { templateId: "champout_activate_1gp6nis" },
      },
    });
    expect(
      flinch.status === "event" ? renderBattleEventCanonicalText(flinch.event) : null,
    ).toBe("相手の ガメノデスは ひるんで 技が だせない!");
    expect(
      priorityItem.status === "event"
        ? renderBattleEventCanonicalText({
            ...priorityItem.event,
            normalizedText: priorityItem.normalizedText,
          })
        : null,
    ).toBe("相手の ガメノデスは せんせいのツメで 行動が はやくなった!");
    expect(
      teaEffect.status === "event"
        ? renderBattleEventCanonicalText({
            ...teaEffect.event,
            normalizedText: teaEffect.normalizedText,
          })
        : null,
    ).toBe("ヤバソチャが たてた お茶を メタグロスは 飲みほした!");
    expect(parseBattleMessage("雨が 降り始めた!")).toMatchObject({
      status: "event",
      event: { type: "weather_start" },
    });
    expect(parseBattleMessage("砂あらしが 吹き始めた!")).toMatchObject({
      status: "event",
      event: { type: "weather_start" },
    });
    expect(parseBattleMessage("急所に 当たった!")).toMatchObject({
      status: "event",
      event: { type: "critical" },
    });
    expect(parseBattleMessage("降参が 選ばれました")).toMatchObject({
      status: "event",
      event: { type: "battle_end" },
    });
  });

  it("projects noisy flinch and priority-item templates only inside narrow shapes", () => {
    expect(
      parseBattleMessage({
        rawText: "相手の ガメノデスは ひるんで 技が だせない/",
        ocrConfidence: 0.88,
      }),
    ).toMatchObject({
      status: "event",
      event: {
        type: "flinch",
        actor: { name: "ガメノデス", side: "opponent" },
      },
    });
    expect(
      parseBattleMessage({
        rawText: "相手の ガメノデスは せんせいのツメで 行動が はやくなつた/",
        ocrConfidence: 0.88,
      }),
    ).toMatchObject({
      status: "event",
      event: {
        type: "item",
        actor: { name: "ガメノデス", side: "opponent" },
      },
    });
    expect(parseBattleMessage("せんせいのツメで 行動が はやくなった")).toMatchObject({
      status: "unknown",
    });
  });

  it("keeps weak constrained candidates unknown and reviewable", () => {
    const result = parseBattleMessage({
      rawText: "相手の キュウの\nオーパーヒードト/",
      lines: ["相手の キュウの", "オーパーヒードト/"],
      ocrConfidence: 0.42,
    });

    expect(result).toMatchObject({
      status: "unknown",
      rawText: "相手の キュウの\nオーパーヒードト/",
      reviewStatus: "unreviewed",
    });
    expect(result.candidateMatches.join("\n")).toContain("constrained-review:");
  });

  it("keeps unrelated pokemon and move spans as unknown candidates", () => {
    const result = parseBattleMessage({
      rawText: "エルフーン\nムーンフォース/",
      lines: ["エルフーン", "ムーンフォース/"],
      ocrConfidence: 0.9,
    });

    expect(result.status).toBe("unknown");
    expect(result.candidateMatches.join("\n")).toContain("span:pokemon");
    expect(result.candidateMatches.join("\n")).toContain("span:move");
    expect(result.candidateMatches.join("\n")).toContain("missing-possessive-no");
  });

  it("keeps unsupported messages as reviewable unknowns", () => {
    expect(parseBattleMessage("まだ知らない特殊メッセージ")).toMatchObject({
      status: "unknown",
      reviewStatus: "unreviewed",
      classification: { method: "unknown" },
    });
    expect(parseBattleMessage("こおりタイプの防御が1.5倍になる。")).toMatchObject({
      status: "unknown",
      reviewStatus: "unreviewed",
    });
  });

  it("extracts corrected participants from noisy context effectiveness messages", () => {
    const supereffective = parseBattleMessage({
      rawText: "マフォプシーに効果は パツグンだ",
      ocrConfidence: 0.88,
    });
    const resisted = parseBattleMessage({
      rawText: "カプリアスに効果は いまひとつだ",
      ocrConfidence: 0.88,
    });

    expect(supereffective).toMatchObject({
      status: "event",
      event: {
        type: "supereffective",
        target: { name: "マフォクシー" },
      },
    });
    expect(
      supereffective.status === "event"
        ? renderBattleEventCanonicalText(supereffective.event)
        : null,
    ).toBe("マフォクシーに 効果は バツグンだ!");
    expect(resisted).toMatchObject({
      status: "event",
      event: {
        type: "resisted",
        target: { name: "ガブリアス" },
      },
    });
  });

  it("extracts corrected actors from noisy protect context messages", () => {
    const result = parseBattleMessage({
      rawText: "マフォジシーは 守りの体勢に入った",
      ocrConfidence: 0.88,
    });

    expect(result).toMatchObject({
      status: "event",
      event: {
        type: "protect",
        actor: { name: "マフォクシー" },
      },
    });
  });

  it("uses OCR-aware dictionary correction for noisy actor and move slots", () => {
    const aquaJet = parseBattleMessage({
      rawText: "相手の イヅダイトウの アクアジエッツト",
      ocrConfidence: 0.9,
    });
    const heatWave = parseBattleMessage({
      rawText: "マフォクシーの ねっぶぷう",
      ocrConfidence: 0.9,
    });
    const switchIn = parseBattleMessage({
      rawText: "ゆけつ! ガプリアス!",
      ocrConfidence: 0.86,
    });

    expect(aquaJet).toMatchObject({
      status: "event",
      rawText: "相手の イヅダイトウの アクアジエッツト",
      event: {
        type: "move",
        actor: { name: "イダイトウ", side: "opponent" },
        move: "アクアジェット",
      },
    });
    expect(heatWave).toMatchObject({
      status: "event",
      event: {
        type: "move",
        actor: { name: "マフォクシー" },
        move: "ねっぷう",
      },
    });
    expect(switchIn).toMatchObject({
      status: "event",
      event: { type: "switch_in", actor: { name: "ガブリアス" } },
    });
  });

  it("does not accept ambiguous global dictionary candidates", () => {
    const result = parseBattleMessage(
      {
        rawText: "カカカカの じしん",
        ocrConfidence: 0.9,
      },
      {
        pokemon: [
          { id: "pokemon:test-1", label: "ガカカカ" },
          { id: "pokemon:test-2", label: "カガカカ" },
        ],
        moves: [{ id: "move:test-1", label: "じしん" }],
      },
    );

    expect(result.status).toBe("unknown");
  });

  it("uses session roster dictionary before the global pokemon dictionary", () => {
    const result = parseBattleMessage(
      {
        rawText: "マフォジシーは 守りの体勢に入った",
        ocrConfidence: 0.42,
      },
      undefined,
      {
        sessionRosterDictionary: [{ id: "session:マフォクシー", label: "マフォクシー" }],
      },
    );

    expect(result).toMatchObject({
      status: "event",
      event: {
        type: "protect",
        actor: { name: "マフォクシー" },
      },
    });
  });

  it("uses observed move dictionary before the global move dictionary", () => {
    const result = parseBattleMessage(
      {
        rawText: "マフォクシーの ねっぶぷう",
        ocrConfidence: 0.42,
      },
      undefined,
      {
        observedMoveDictionary: [{ id: "observed:ねっぷう", label: "ねっぷう" }],
      },
    );

    expect(result).toMatchObject({
      status: "event",
      event: {
        type: "move",
        actor: { name: "マフォクシー" },
        move: "ねっぷう",
      },
    });
  });
});
