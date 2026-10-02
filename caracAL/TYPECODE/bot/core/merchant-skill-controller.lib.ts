import {
  ClassSkillController,
  ClassSkillControllerOptions,
} from "./class-skill-controller.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type { GameAdapter } from "./game-adapter.lib";
import type { CombatController } from "./combat-controller.lib";

export class MerchantSkillController extends ClassSkillController {
  constructor(
    game: GameAdapter,
    actions: ActionBoundary,
    combat: CombatController,
    options: ClassSkillControllerOptions = {},
  ) {
    super(
      "merchant",
      "MerchantSkillController",
      [
        { skill: "mcourage", targetMode: "NONE" },
        { skill: "mfrenzy", targetMode: "NONE" },
        { skill: "massproduction", targetMode: "NONE" },
        { skill: "massproductionpp", targetMode: "NONE" },
        { skill: "massexchange", targetMode: "NONE" },
        { skill: "massexchangepp", targetMode: "NONE" },
        { skill: "throw", targetMode: "CURRENT", rangeMode: "SKILL" },
      ],
      game,
      actions,
      combat,
      options,
    );
  }
}
