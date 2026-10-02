import {
  ClassSkillController,
  ClassSkillControllerOptions,
} from "./class-skill-controller.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type { GameAdapter } from "./game-adapter.lib";
import type { CombatController } from "./combat-controller.lib";

export class MageSkillController extends ClassSkillController {
  constructor(
    game: GameAdapter,
    actions: ActionBoundary,
    combat: CombatController,
    options: ClassSkillControllerOptions = {},
  ) {
    super(
      "mage",
      "MageSkillController",
      [
        { skill: "entangle", targetMode: "CURRENT", rangeMode: "SKILL" },
        { skill: "light", targetMode: "NONE" },
      ],
      game,
      actions,
      combat,
      options,
    );
  }
}
