import type { BattleEvent, BattleEventType } from "../events/schema";

export interface BattleTemplateRule {
  id: string;
  eventType: BattleEventType;
  priority: number;
  patterns: readonly string[];
  constants?: {
    "actor.side"?: BattleEvent["actor"]["side"];
    "target.side"?: NonNullable<BattleEvent["target"]>["side"];
  };
  maxGap?: number;
  maxTextCaptureLength?: number;
  confidence?: number;
  source?: {
    fileName: string;
    keyPath: string;
    labelName: string | null;
    originalText: string;
    sourceCommit: string | null;
  };
}

export interface TemplateMatchSurface {
  id: string;
  matchText: string;
  priority?: number;
}

export interface TemplateMatch {
  rule: BattleTemplateRule;
  pattern: string;
  surface: TemplateMatchSurface;
  actor: BattleEvent["actor"];
  target: BattleEvent["target"];
  move: string | null;
  confidenceScore: number;
  evidence: string;
}
