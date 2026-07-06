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

export function renderBattleEventCanonicalText(
  event: Pick<BattleEvent, "type" | "actor" | "move" | "target" | "classification">,
) {
  const actorSubject = formatActorSubject(event.actor);
  const targetObject = formatTargetObject(event);

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
    case "faint":
      return actorSubject ? `${actorSubject}は たおれた!` : "たおれた!";
    case "boost":
      return actorSubject ? `${actorSubject}の 能力が 上がった!` : "能力が 上がった!";
    case "unboost":
      return actorSubject ? `${actorSubject}の 能力が 下がった!` : "能力が 下がった!";
    case "side_end":
      return "追い風が 止んだ!";
    case "battle_end":
      return "勝負が 終了した!";
    default:
      return actorSubject ? `${actorSubject}: ${event.type}` : event.type;
  }
}
