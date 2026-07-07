import type { BattleEvent } from "./schema";

function formatParticipant(
  participant: { name: string | null; side: BattleEvent["actor"]["side"] } | null,
) {
  if (!participant?.name) {
    return null;
  }

  return participant.side === "opponent" ? `相手の ${participant.name}` : participant.name;
}

function formatPossessiveActor(actor: BattleEvent["actor"]) {
  const name = formatParticipant(actor);

  return name ? `${name}の` : "";
}

function formatActorSubject(actor: BattleEvent["actor"]) {
  return formatParticipant(actor);
}

function formatTargetObject(event: Pick<BattleEvent, "actor" | "target">) {
  return formatParticipant(event.target) ?? formatParticipant(event.actor);
}

function extractTextCapture(classification: BattleEvent["classification"]) {
  for (const alternative of classification.alternatives) {
    const match = alternative.match(/(?:^|:)text[=:]([^:]+)/);

    if (!match?.[1]) {
      continue;
    }

    return match[1].split(",")[0].trim();
  }

  return null;
}

function extractStatCapture(classification: BattleEvent["classification"]) {
  for (const alternative of classification.alternatives) {
    const dictionaryMatch = alternative.match(/(?:^|:)stat:([^:]+)->([^:]+)/);

    if (dictionaryMatch?.[2]) {
      return dictionaryMatch[2].trim();
    }

    const exactMatch = alternative.match(/(?:^|:)stat=([^:]+)/);

    if (exactMatch?.[1]) {
      return exactMatch[1].trim();
    }
  }

  return null;
}

function getRankChangeModifier(type: "boost" | "unboost", signalText: string) {
  if (type === "boost" && signalText.includes("ぐーん")) {
    return "ぐーんと ";
  }

  if (type === "unboost" && signalText.includes("がくっと")) {
    return "がくっと ";
  }

  return "";
}

export function renderBattleEventCanonicalText(
  event: Pick<BattleEvent, "type" | "actor" | "move" | "target" | "classification"> &
    Partial<Pick<BattleEvent, "normalizedText">>,
) {
  const actorSubject = formatActorSubject(event.actor);
  const targetObject = formatTargetObject(event);
  const textCapture = extractTextCapture(event.classification);
  const statCapture = extractStatCapture(event.classification);
  const classificationEvidence = event.classification.alternatives.join(":");
  const canonicalSignalText = `${event.normalizedText ?? ""}:${classificationEvidence}`;

  switch (event.type) {
    case "move":
      return event.move
        ? `${formatPossessiveActor(event.actor)} ${event.move}!`.trim()
        : actorSubject
          ? `${actorSubject}の 技!`
          : "技!";
    case "switch_in":
      return actorSubject ? `ゆけっ! ${actorSubject}!` : "ゆけっ!";
    case "switch_out":
      return actorSubject ? `${actorSubject} 戻れ!` : "戻れ!";
    case "protect":
      if (event.classification.templateId === "protect_stance") {
        return actorSubject
          ? `${actorSubject}は 守りの 体勢に 入った!`
          : "守りの 体勢に 入った!";
      }

      return actorSubject
        ? `${actorSubject}は 攻撃から 身を守った!`
        : "攻撃から 身を守った!";
    case "supereffective":
      return targetObject ? `${targetObject}に 効果は バツグンだ!` : "効果は バツグンだ!";
    case "resisted":
      return targetObject ? `${targetObject}に 効果は いまひとつだ!` : "効果は いまひとつだ!";
    case "immune":
      return targetObject ? `${targetObject}に 効果が ない!` : "効果が ない!";
    case "critical":
      return "急所に 当たった!";
    case "flinch":
      return actorSubject
        ? `${actorSubject}は ひるんで 技が だせない!`
        : "ひるんで 技が だせない!";
    case "faint":
      return actorSubject ? `${actorSubject}は たおれた!` : "たおれた!";
    case "damage":
      return targetObject ? `${targetObject}は ダメージを 受けた!` : "ダメージを 受けた!";
    case "boost": {
      const modifier = getRankChangeModifier("boost", canonicalSignalText);

      if (actorSubject && statCapture) {
        return `${actorSubject}の ${statCapture}が ${modifier}上がった!`;
      }

      return actorSubject ? `${actorSubject}の 能力が 上がった!` : "能力が 上がった!";
    }
    case "unboost": {
      const modifier = getRankChangeModifier("unboost", canonicalSignalText);

      if (actorSubject && statCapture) {
        return `${actorSubject}の ${statCapture}が ${modifier}下がった!`;
      }

      return actorSubject ? `${actorSubject}の 能力が 下がった!` : "能力が 下がった!";
    }
    case "fail":
      return targetObject
        ? `しかし ${targetObject}には うまく 決まらなかった!`
        : "しかし うまく 決まらなかった!";
    case "item":
      if (textCapture && event.classification.templateId?.startsWith("champout_item_")) {
        return actorSubject
          ? `${actorSubject}は ${textCapture}で 行動が はやくなった!`
          : `${textCapture}で 行動が はやくなった!`;
      }

      return actorSubject
        ? `${actorSubject}は 道具で 行動が はやくなった!`
        : "道具で 行動が はやくなった!";
    case "activate":
      if (
        (event.normalizedText?.includes("飲みほした") ||
          classificationEvidence.includes("飲みほした")) &&
        actorSubject &&
        targetObject
      ) {
        return `${actorSubject}が たてた お茶を ${targetObject}は 飲みほした!`;
      }

      if (
        (event.normalizedText?.includes("メガシンカ") ||
          classificationEvidence.includes("メガシンカ")) &&
        actorSubject &&
        textCapture
      ) {
        return `${actorSubject}は メガ${textCapture}に メガシンカした!`;
      }

      return actorSubject ? `${actorSubject}の 効果が 発動した!` : "効果が 発動した!";
    case "redirection":
      return actorSubject ? `${actorSubject}は 注目の的に なった!` : "注目の的に なった!";
    case "weather_start":
      if (
        canonicalSignalText.includes("砂あらし") ||
        canonicalSignalText.includes("砂 あら") ||
        canonicalSignalText.includes("あらじし")
      ) {
        return "砂あらしが 吹き始めた!";
      }

      if (canonicalSignalText.includes("雨")) {
        return "雨が 降り始めた!";
      }

      if (canonicalSignalText.includes("雪") || canonicalSignalText.includes("ゆき")) {
        return "雪が 降り始めた!";
      }

      if (canonicalSignalText.includes("日差し")) {
        return "日差しが 強くなった!";
      }

      return "天候が 変わった!";
    case "weather_end":
      if (canonicalSignalText.includes("砂あらし")) {
        return "砂あらしが 止んだ!";
      }

      if (canonicalSignalText.includes("雨")) {
        return "雨が 上がった!";
      }

      if (canonicalSignalText.includes("雪") || canonicalSignalText.includes("ゆき")) {
        return "雪が 止んだ!";
      }

      if (canonicalSignalText.includes("日差し")) {
        return "日差しが 元に戻った!";
      }

      return "天候が 元に戻った!";
    case "side_end":
      return "追い風が 止んだ!";
    case "battle_end":
      if (
        event.classification.templateId === "battle_end_surrender" ||
        event.classification.templateId === "champout_battle_end_1rxarh9" ||
        canonicalSignalText.includes("降参")
      ) {
        return "降参が 選ばれました!";
      }

      if (
        event.classification.templateId === "battle_end_loss" ||
        canonicalSignalText.includes("勝負に")
      ) {
        return "勝負に 負けた!";
      }

      return "勝負が 終了した!";
    default:
      return actorSubject ? `${actorSubject}: ${event.type}` : event.type;
  }
}
