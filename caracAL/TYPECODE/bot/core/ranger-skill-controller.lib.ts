import {
  ClassSkillController,
  ClassSkillControllerOptions,
} from "./class-skill-controller.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type { GameAdapter } from "./game-adapter.lib";
import type { CombatController } from "./combat-controller.lib";

export class RangerSkillController extends ClassSkillController {
  constructor(
    game: GameAdapter,
    actions: ActionBoundary,
    combat: CombatController,
    options: ClassSkillControllerOptions = {},
  ) {
    super(
      "ranger",
      "RangerSkillController",
      [
        { skill: "huntersmark", targetMode: "CURRENT", rangeMode: "TRIPLE_ATTACK_PLUS_20" },
        { skill: "supershot", targetMode: "CURRENT", rangeMode: "TRIPLE_ATTACK_PLUS_20" },
        { skill: "poisonarrow", targetMode: "CURRENT", rangeMode: "ATTACK" },
        { skill: "piercingshot", targetMode: "CURRENT", rangeMode: "ATTACK", sharedCooldown: "attack" },
        { skill: "track", targetMode: "NONE" },
      ],
      game,
      actions,
      combat,
      options,
    );
  }
}
