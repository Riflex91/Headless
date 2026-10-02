import type { ActionBoundary } from "./action-boundary.lib";
import type { ClassSkillController } from "./class-skill-controller.lib";
import type { CombatController } from "./combat-controller.lib";
import type { GroupCombatController } from "./group-combat-controller.lib";
import type { CharacterSnapshot } from "./game-adapter.lib";

export type GroupLiveTestOutcome = "PASS" | "FAIL" | "UNKNOWN" | "TIMEOUT";
export type GroupLiveTestRole = "leader" | "follower";

export interface GroupLiveTestOptions {
  requestId?: string;
  role: GroupLiveTestRole;
  leader: string;
  peer: string;
  baselinePairFormed?: boolean;
  coordinatedPair?: boolean;
  timeoutMs?: number;
  holdMs?: number;
  pollIntervalMs?: number;
}

export interface GroupLiveTestResult {
  requestId: string;
  outcome: GroupLiveTestOutcome;
  reason: string;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  character: string | null;
  role: GroupLiveTestRole;
  leader: string;
  peer: string;
  start: {
    ctype: string | null;
    map: string | null;
    x: number | null;
    y: number | null;
    partyMembers: string[];
  };
  preparation: {
    initialPairFormed: boolean;
    observedInitialPairFormed: boolean;
    baselinePairOverrideApplied: boolean;
    pairLifecycleOwner: boolean;
    dissolvedInitialPair: boolean;
    existingPartyConflict: boolean;
  };
  party: {
    formed: boolean;
    members: string[];
    roleProjected: boolean;
    leaderProjected: boolean;
    partyActionObserved: boolean;
    lastActionId: string | null;
    lastActionStatus: string | null;
    lastActionKind: string | null;
  };
  scope: {
    partyMutationAllowed: true;
    combatMutationForced: false;
    aoeMutationForced: false;
    healingMutationForced: false;
    consumableMutationForced: false;
  };
  cleanup: {
    partyLeaveStatus: string | null;
    initialPartyRestored: boolean;
    groupOverrideCleared: boolean;
    combatOverrideCleared: boolean;
    classSkillOverrideCleared: boolean;
  };
}

interface GroupLiveTestDependencies {
  groupCombat: Pick<
    GroupCombatController,
    "setConfigOverride" | "clearConfigOverride" | "status" | "tick"
  >;
  combat: Pick<CombatController, "setConfigOverride" | "clearConfigOverride">;
  classSkills:
    | Pick<ClassSkillController, "setConfigOverride" | "clearConfigOverride">
    | null;
  actions: Pick<ActionBoundary, "partyLeave">;
  character(): CharacterSnapshot;
  party(): Record<string, unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function members(party: Record<string, unknown>): string[] {
  return Object.keys(party).sort((a, b) => a.localeCompare(b));
}

function pairFormed(
  party: Record<string, unknown>,
  leader: string,
  peer: string,
): boolean {
  const current = new Set(Object.keys(party));
  return current.has(leader) && current.has(peer);
}

export class GroupLiveTestRunner {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: GroupLiveTestDependencies) {
    this.now = deps.now || (() => Date.now());
    this.sleep = deps.sleep || defaultSleep;
  }

  async run(options: GroupLiveTestOptions): Promise<GroupLiveTestResult> {
    const startedAt = this.now();
    const requestId = options.requestId || "group-live-" + startedAt;
    const timeoutMs = Math.max(5000, options.timeoutMs || 45000);
    const holdMs = Math.max(1000, options.holdMs || 5000);
    const pollIntervalMs = Math.max(50, options.pollIntervalMs || 150);
    const first = this.deps.character();
    const startMembers = members(this.deps.party());
    const observedInitialPairFormed = pairFormed(
      this.deps.party(),
      options.leader,
      options.peer,
    );
    const baselinePairOverrideApplied =
      typeof options.baselinePairFormed === "boolean";
    const initialPairFormed = baselinePairOverrideApplied
      ? options.baselinePairFormed === true
      : observedInitialPairFormed;
    const pairLifecycleOwner =
      options.coordinatedPair !== true || options.role === "leader";
    const allowed = new Set([options.leader, options.peer]);
    const existingPartyConflict = startMembers.some(
      (name) => !allowed.has(name),
    );

    const result: GroupLiveTestResult = {
      requestId,
      outcome: "FAIL",
      reason: "GROUP_LIVE_E2E_NOT_COMPLETED",
      startedAt,
      completedAt: null,
      durationMs: null,
      character: first.name,
      role: options.role,
      leader: options.leader,
      peer: options.peer,
      start: {
        ctype: first.ctype,
        map: first.map,
        x: first.x,
        y: first.y,
        partyMembers: startMembers,
      },
      preparation: {
        initialPairFormed,
        observedInitialPairFormed,
        baselinePairOverrideApplied,
        pairLifecycleOwner,
        dissolvedInitialPair: false,
        existingPartyConflict,
      },
      party: {
        formed: false,
        members: startMembers,
        roleProjected: false,
        leaderProjected: false,
        partyActionObserved: false,
        lastActionId: null,
        lastActionStatus: null,
        lastActionKind: null,
      },
      scope: {
        partyMutationAllowed: true,
        combatMutationForced: false,
        aoeMutationForced: false,
        healingMutationForced: false,
        consumableMutationForced: false,
      },
      cleanup: {
        partyLeaveStatus: null,
        initialPartyRestored: false,
        groupOverrideCleared: false,
        combatOverrideCleared: false,
        classSkillOverrideCleared: this.deps.classSkills === null,
      },
    };

    if (!first.name || !first.ctype) {
      result.reason = "GROUP_LIVE_E2E_CHARACTER_IDENTITY_MISSING";
      return this.finishWithoutOverrides(result, startedAt);
    }
    if (
      options.leader === options.peer ||
      ![options.leader, options.peer].includes(first.name)
    ) {
      result.reason = "GROUP_LIVE_E2E_PAIR_INVALID";
      return this.finishWithoutOverrides(result, startedAt);
    }
    if (
      (options.role === "leader" && first.name !== options.leader) ||
      (options.role === "follower" && first.name === options.leader)
    ) {
      result.reason = "GROUP_LIVE_E2E_ROLE_INVALID";
      return this.finishWithoutOverrides(result, startedAt);
    }
    if (existingPartyConflict) {
      result.reason = "GROUP_LIVE_E2E_EXISTING_PARTY_CONFLICT";
      return this.finishWithoutOverrides(result, startedAt);
    }

    const disabledCombat = {
      combat: { enabled: false },
      potionUsage: { enabled: false },
      safety: { autoRespawn: false },
    };
    const disabledClassSkills = {
      classSkills: {
        [first.ctype]: {
          enabled: false,
          skills: {},
        },
      },
    };
    const disabledGroup = { groupCombat: { enabled: false } };
    const enabledGroup = {
      groupCombat: {
        enabled: true,
        role: options.role,
        leader: options.leader,
        members: [options.leader, options.peer],
        party: {
          enabled: true,
          reconcileMs: 750,
          retryMs: 500,
        },
        focus: true,
        healing: { enabled: false },
        support: { enabled: false },
        aoe: { enabled: false },
        tether: { enabled: false },
        warriorAnchor: { enabled: false },
        rangerKiting: { enabled: false },
      },
    };

    this.deps.combat.setConfigOverride(disabledCombat);
    this.deps.classSkills?.setConfigOverride(disabledClassSkills);
    this.deps.groupCombat.setConfigOverride(disabledGroup);

    try {
      if (initialPairFormed && pairLifecycleOwner) {
        const leave = await this.deps.actions.partyLeave({
          module: "GroupLiveTest",
          why: "CREATE_AUTONOMOUS_PARTY_TEST_CONDITION",
          correlationId: requestId,
        });
        result.preparation.dissolvedInitialPair = true;
        if (leave.status === "UNKNOWN") {
          result.outcome = "UNKNOWN";
          result.reason = "GROUP_LIVE_E2E_PREPARE_LEAVE_UNKNOWN";
          return result;
        }

        const dissolved = await this.waitFor(
          () =>
            !pairFormed(
              this.deps.party(),
              options.leader,
              options.peer,
            ),
          5000,
          pollIntervalMs,
        );
        if (!dissolved) {
          result.outcome = "TIMEOUT";
          result.reason = "GROUP_LIVE_E2E_PREPARE_LEAVE_TIMEOUT";
          return result;
        }
      }

      this.deps.groupCombat.setConfigOverride(enabledGroup);
      const formed = await this.waitFor(
        async () => {
          const status = await this.deps.groupCombat.tick();
          const action = status.lastAction;
          if (action?.kind?.startsWith("PARTY_")) {
            result.party.partyActionObserved = true;
            result.party.lastActionId = action.id;
            result.party.lastActionStatus = action.status;
            result.party.lastActionKind = action.kind;
          }
          if (status.party.pendingAction?.status === "UNKNOWN") {
            result.outcome = "UNKNOWN";
            result.reason = "GROUP_LIVE_E2E_PARTY_OUTCOME_UNKNOWN";
            return true;
          }
          return pairFormed(
            this.deps.party(),
            options.leader,
            options.peer,
          );
        },
        timeoutMs,
        pollIntervalMs,
      );

      if (
        result.outcome === "UNKNOWN" &&
        result.reason === "GROUP_LIVE_E2E_PARTY_OUTCOME_UNKNOWN"
      ) {
        return result;
      }
      if (!formed) {
        result.outcome = "TIMEOUT";
        result.reason = "GROUP_LIVE_E2E_PARTY_FORMATION_TIMEOUT";
        return result;
      }

      const status = this.deps.groupCombat.status();
      result.party.formed = true;
      result.party.members = members(this.deps.party());
      result.party.roleProjected =
        status.role ===
        (options.role === "leader" ? "LEADER" : "FOLLOWER");
      result.party.leaderProjected = status.leader === options.leader;
      if (status.lastAction?.kind?.startsWith("PARTY_")) {
        result.party.partyActionObserved = true;
        result.party.lastActionId = status.lastAction.id;
        result.party.lastActionStatus = status.lastAction.status;
        result.party.lastActionKind = status.lastAction.kind;
      }

      await this.sleep(holdMs);

      if (!result.party.roleProjected || !result.party.leaderProjected) {
        result.reason = "GROUP_LIVE_E2E_ROLE_PROJECTION_MISSING";
        return result;
      }
      if (!result.party.partyActionObserved && !initialPairFormed) {
        result.reason = "GROUP_LIVE_E2E_PARTY_ACTION_MISSING";
        return result;
      }

      result.outcome = "PASS";
      result.reason = "GROUP_LIVE_E2E_CONFIRMED";
      return result;
    } finally {
      this.deps.groupCombat.setConfigOverride(disabledGroup);

      if (!initialPairFormed) {
        if (
          pairLifecycleOwner &&
          pairFormed(this.deps.party(), options.leader, options.peer)
        ) {
          const leave = await this.deps.actions.partyLeave({
            module: "GroupLiveTest",
            why: "GROUP_LIVE_TEST_CLEANUP",
            correlationId: requestId,
          });
          result.cleanup.partyLeaveStatus = leave.status;
          if (leave.status === "UNKNOWN" && result.outcome === "PASS") {
            result.outcome = "UNKNOWN";
            result.reason = "GROUP_LIVE_E2E_CLEANUP_UNKNOWN";
          }
        }
        const restored = await this.waitFor(
          () =>
            !pairFormed(
              this.deps.party(),
              options.leader,
              options.peer,
            ),
          5000,
          pollIntervalMs,
        );
        result.cleanup.initialPartyRestored =
          restored &&
          !pairFormed(this.deps.party(), options.leader, options.peer);
      } else {
        const restored = await this.waitFor(
          () =>
            pairFormed(
              this.deps.party(),
              options.leader,
              options.peer,
            ),
          5000,
          pollIntervalMs,
        );
        result.cleanup.initialPartyRestored =
          restored &&
          pairFormed(this.deps.party(), options.leader, options.peer);
      }

      this.deps.groupCombat.clearConfigOverride();
      result.cleanup.groupOverrideCleared = true;
      this.deps.combat.clearConfigOverride();
      result.cleanup.combatOverrideCleared = true;
      this.deps.classSkills?.clearConfigOverride();
      result.cleanup.classSkillOverrideCleared = true;
      result.completedAt = this.now();
      result.durationMs = Math.max(0, result.completedAt - startedAt);

      if (
        result.outcome === "PASS" &&
        !result.cleanup.initialPartyRestored
      ) {
        result.outcome = "FAIL";
        result.reason = "GROUP_LIVE_E2E_CLEANUP_NOT_RESTORED";
      }
    }
  }

  private finishWithoutOverrides(
    result: GroupLiveTestResult,
    startedAt: number,
  ): GroupLiveTestResult {
    result.completedAt = this.now();
    result.durationMs = Math.max(0, result.completedAt - startedAt);
    return result;
  }

  private async waitFor(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs: number,
    pollIntervalMs: number,
  ): Promise<boolean> {
    const startedAt = this.now();
    while (this.now() - startedAt <= timeoutMs) {
      if (await predicate()) return true;
      await this.sleep(pollIntervalMs);
    }
    return false;
  }
}
