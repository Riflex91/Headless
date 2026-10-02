import {
  ClassSkillController,
  ClassSkillControllerOptions,
} from "./class-skill-controller.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type { GameAdapter } from "./game-adapter.lib";
import type { CombatController } from "./combat-controller.lib";

export class RogueSkillController extends ClassSkillController {
  constructor(
    game: GameAdapter,
    actions: ActionBoundary,
    combat: CombatController,
    options: ClassSkillControllerOptions = {},
  ) {
    super(
      "rogue",
      "RogueSkillController",
      [
        { skill: "pcoat", targetMode: "NONE" },
        { skill: "invis", targetMode: "NONE" },
        { skill: "mentalburst", targetMode: "CURRENT", rangeMode: "ATTACK_1_2_PLUS_32" },
        { skill: "quickpunch", targetMode: "CURRENT", rangeMode: "ATTACK" },
        { skill: "quickstab", targetMode: "CURRENT", rangeMode: "ATTACK", sharedCooldown: "quickpunch" },
      ],
      game,
      actions,
      combat,
      options,
    );
  }
}
