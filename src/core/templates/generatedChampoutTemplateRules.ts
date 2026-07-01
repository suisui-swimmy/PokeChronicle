import generatedPack from "../../../data/generated/champout-event-rules.ja.json";
import type { BattleTemplateRule } from "./types";

interface GeneratedChampoutTemplatePack {
  schemaVersion: string;
  generatedAt: string;
  generator: string;
  source: {
    name: string;
    root: string;
    language: string;
    license: string;
    sourceCommit: string;
    noticeFile: string;
    files: string[];
  };
  stats: {
    sourceFileCount: number;
    extractedTextCount: number;
    battleCandidateCount: number;
    generatedRuleCount: number;
    skippedTextCount: number;
    duplicateRuleCount: number;
    maxGeneratedRules: number;
    perFile: Array<{
      fileName: string;
      extractedTextCount: number;
      battleCandidateCount: number;
      generatedRuleCount: number;
      skippedTextCount: number;
    }>;
  };
  rules: BattleTemplateRule[];
}

const pack = generatedPack as GeneratedChampoutTemplatePack;

export const CHAMPOUT_TEMPLATE_SOURCE = pack.source;
export const CHAMPOUT_TEMPLATE_STATS = pack.stats;
export const CHAMPOUT_TEMPLATE_RULES = pack.rules as readonly BattleTemplateRule[];

