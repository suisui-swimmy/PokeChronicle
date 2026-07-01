import { CHAMPOUT_TEMPLATE_RULES } from "./generatedChampoutTemplateRules";
import { SEED_TEMPLATE_RULES } from "./seedTemplateRules";
import type { BattleTemplateRule } from "./types";

export const STANDARD_TEMPLATE_RULES: readonly BattleTemplateRule[] = [
  ...SEED_TEMPLATE_RULES,
  ...CHAMPOUT_TEMPLATE_RULES,
];
