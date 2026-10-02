import {
  ClassSkillController,
  ClassSkillControllerOptions,
} from "./class-skill-controller.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type { GameAdapter } from "./game-adapter.lib";
import type { CombatController } from "./combat-controller.lib";

export class PriestSkillController extends ClassSkillController {
  constructor(
    game: GameAdapter,
    actions: ActionBoundary,
    combat: CombatController,
    options: ClassSkillControllerOptions = {},
  ) {
    super(
      "priest",
      "PriestSkillController",
      [
        { skill: "curse", targetMode: "CURRENT", rangeMode: "SKILL" },
        { skill: "darkblessing", targetMode: "NONE" },
        { skill: "phaseout", targetMode: "NONE" },
      ],
      game,
      actions,
      combat,
      options,
    );
  }
}
