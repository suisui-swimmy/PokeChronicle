import type { BattleEvent, UnknownEvent } from "../events/schema";

const POKEMON_ACTION_EVENT_TYPES = new Set<BattleEvent["type"]>([
  "move",
  "switch_out",
  "switch_in",
  "damage",
  "heal",
  "status",
  "status_cure",
  "boost",
  "unboost",
  "protect",
  "miss",
  "fail",
  "item",
  "ability",
  "activate",
  "redirection",
]);

export interface PokemonActionCount {
  key: string;
  name: string;
  side: BattleEvent["actor"]["side"];
  count: number;
}

export interface BattleStatsSummary {
  totalResolvedEventCount: number;
  totalClassifiedItemCount: number;
  observedMoveCount: number;
  pokemonActionCount: number;
  pokemonActionCounts: PokemonActionCount[];
  switchCount: number;
  faintCount: number;
  unknownMessageCount: number;
  unknownRate: number;
  effectiveness: {
    supereffective: number;
    resisted: number;
    immune: number;
    total: number;
  };
  criticalCount: number;
}

function createPokemonActionKey(event: Pick<BattleEvent, "actor">) {
  if (!event.actor.name) {
    return null;
  }

  return `${event.actor.side ?? "unknown"}:${event.actor.name}`;
}

function comparePokemonActionCounts(left: PokemonActionCount, right: PokemonActionCount) {
  return (
    right.count - left.count ||
    left.name.localeCompare(right.name, "ja") ||
    (left.side ?? "unknown").localeCompare(right.side ?? "unknown")
  );
}

export function summarizeBattleStats(
  events: readonly BattleEvent[],
  unknowns: readonly UnknownEvent[],
): BattleStatsSummary {
  const pokemonActionCountsByKey = new Map<string, PokemonActionCount>();
  let observedMoveCount = 0;
  let pokemonActionCount = 0;
  let switchCount = 0;
  let faintCount = 0;
  let supereffective = 0;
  let resisted = 0;
  let immune = 0;
  let criticalCount = 0;

  for (const event of events) {
    if (event.type === "move") {
      observedMoveCount += 1;
    }

    if (event.type === "switch_in" || event.type === "switch_out") {
      switchCount += 1;
    }

    if (event.type === "faint") {
      faintCount += 1;
    }

    if (event.type === "supereffective") {
      supereffective += 1;
    } else if (event.type === "resisted") {
      resisted += 1;
    } else if (event.type === "immune") {
      immune += 1;
    } else if (event.type === "critical") {
      criticalCount += 1;
    }

    if (POKEMON_ACTION_EVENT_TYPES.has(event.type)) {
      const pokemonActionKey = createPokemonActionKey(event);

      if (pokemonActionKey) {
        pokemonActionCount += 1;
        const current = pokemonActionCountsByKey.get(pokemonActionKey);

        if (current) {
          current.count += 1;
        } else {
          pokemonActionCountsByKey.set(pokemonActionKey, {
            key: pokemonActionKey,
            name: event.actor.name ?? "",
            side: event.actor.side,
            count: 1,
          });
        }
      }
    }
  }

  const totalClassifiedItemCount = events.length + unknowns.length;

  return {
    totalResolvedEventCount: events.length,
    totalClassifiedItemCount,
    observedMoveCount,
    pokemonActionCount,
    pokemonActionCounts: [...pokemonActionCountsByKey.values()].sort(comparePokemonActionCounts),
    switchCount,
    faintCount,
    unknownMessageCount: unknowns.length,
    unknownRate:
      totalClassifiedItemCount === 0 ? 0 : unknowns.length / totalClassifiedItemCount,
    effectiveness: {
      supereffective,
      resisted,
      immune,
      total: supereffective + resisted + immune,
    },
    criticalCount,
  };
}
