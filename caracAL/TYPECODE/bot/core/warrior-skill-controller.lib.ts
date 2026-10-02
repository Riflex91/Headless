import {
  ClassSkillController,
  ClassSkillControllerOptions,
} from "./class-skill-controller.lib";
import type { ActionBoundary } from "./action-boundary.lib";
import type { GameAdapter } from "./game-adapter.lib";
import type { CombatController } from "./combat-controller.lib";

export class WarriorSkillController extends ClassSkillController {
  constructor(
    game: GameAdapter,
    actions: ActionBoundary,
    combat: CombatController,
    options: ClassSkillControllerOptions = {},
  ) {
    super(
      "warrior",
      "WarriorSkillController",
      [
        { skill: "taunt", targetMode: "CURRENT", rangeMode: "SKILL" },
        { skill: "hardshell", targetMode: "NONE" },
        { skill: "warcry", targetMode: "NONE" },
      ],
      game,
      actions,
      combat,
      options,
    );
  }
}
