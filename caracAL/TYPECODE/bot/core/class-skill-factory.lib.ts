import type { ActionBoundary } from "./action-boundary.lib";
import type { CombatController } from "./combat-controller.lib";
import type { GameAdapter } from "./game-adapter.lib";
import {
  ClassSkillController,
  ClassSkillControllerEvent,
  ClassSkillControllerOptions,
} from "./class-skill-controller.lib";
import { MageSkillController } from "./mage-skill-controller.lib";
import { MerchantSkillController } from "./merchant-skill-controller.lib";
import { PriestSkillController } from "./priest-skill-controller.lib";
import { RangerSkillController } from "./ranger-skill-controller.lib";
import { RogueSkillController } from "./rogue-skill-controller.lib";
import { WarriorSkillController } from "./warrior-skill-controller.lib";

export function createClassSkillController(
  ctype: string | null,
  game: GameAdapter,
  actions: ActionBoundary,
  combat: CombatController,
  options: ClassSkillControllerOptions = {},
): ClassSkillController | null {
  switch (ctype) {
    case "warrior":
      return new WarriorSkillController(game, actions, combat, options);
    case "ranger":
      return new RangerSkillController(game, actions, combat, options);
    case "mage":
      return new MageSkillController(game, actions, combat, options);
    case "priest":
      return new PriestSkillController(game, actions, combat, options);
    case "rogue":
      return new RogueSkillController(game, actions, combat, options);
    case "merchant":
      return new MerchantSkillController(game, actions, combat, options);
    default:
      return null;
  }
}

export type { ClassSkillControllerEvent };
