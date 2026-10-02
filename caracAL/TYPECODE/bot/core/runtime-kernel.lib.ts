import { ActionBoundary } from "./action-boundary.lib";
import { ActionLedger } from "./action-ledger.lib";
import { EventBus, RuntimeEvent } from "./event-bus.lib";
import {
  ModuleRegistry,
  ModuleRegistryEvent,
} from "./module-registry.lib";
import {
  RuntimeState,
  Scheduler,
  SchedulerEvent,
} from "./scheduler.lib";
import { GameAdapter } from "./game-adapter.lib";
import { CombatController, CombatControllerEvent } from "./combat-controller.lib";
import {
  createClassSkillController,
  ClassSkillControllerEvent,
} from "./class-skill-factory.lib";
import type { ClassSkillController } from "./class-skill-controller.lib";
import {
  GroupCombatController,
  GroupCombatControllerEvent,
} from "./group-combat-controller.lib";
import {
  FarmIntelligenceController,
  FarmIntelligenceEvent,
} from "./farm-intelligence-controller.lib";
import {
  InventoryIntelligenceController,
  InventoryIntelligenceEvent,
} from "./inventory-intelligence-controller.lib";
import {
  MerchantLogisticsController,
  MerchantLogisticsRuntimeEvent,
  MerchantLogisticsRuntimePlan,
} from "./merchant-logistics-controller.lib";
import {
  InventoryLiveTestOptions,
  InventoryLiveTestResult,
  InventoryLiveTestRunner,
} from "./inventory-live-test.lib";
import {
  FarmLiveTestOptions,
  FarmLiveTestResult,
  FarmLiveTestRunner,
} from "./farm-live-test.lib";
import {
  CombatLiveTestOptions,
  CombatLiveTestResult,
  CombatLiveTestRunner,
} from "./combat-live-test.lib";
import {
  ClassSkillLiveTestOptions,
  ClassSkillLiveTestResult,
  ClassSkillLiveTestRunner,
} from "./class-skill-live-test.lib";
import {
  GroupLiveTestOptions,
  GroupLiveTestResult,
  GroupLiveTestRunner,
} from "./group-live-test.lib";
import {
  MovementController,
  MovementControllerEvent,
} from "./movement-controller.lib";
import {
  MovementLiveTestOptions,
  MovementLiveTestResult,
  MovementLiveTestRunner,
} from "./movement-live-test.lib";

const MERCHANT_LOGISTICS_JOB_ID = "merchant-logistics-loop";
const MERCHANT_LOGISTICS_INTERVAL_MS = 500;
const INVENTORY_INTELLIGENCE_JOB_ID = "inventory-intelligence-loop";
const INVENTORY_INTELLIGENCE_INTERVAL_MS = 1000;
const FARM_INTELLIGENCE_JOB_ID = "farm-intelligence-loop";
const FARM_INTELLIGENCE_INTERVAL_MS = 1000;
const GROUP_COMBAT_JOB_ID = "group-combat-loop";
const GROUP_COMBAT_INTERVAL_MS = 250;
const CLASS_SKILL_JOB_ID = "class-skill-loop";
const CLASS_SKILL_INTERVAL_MS = 250;
const COMBAT_JOB_ID = "combat-loop";
const COMBAT_INTERVAL_MS = 250;
const MOVEMENT_SETTLEMENT_JOB_ID = "movement-settlement";
const MOVEMENT_SETTLEMENT_INTERVAL_MS = 100;
const STATUS_JOB_ID = "runtime-status";
const STATUS_INTERVAL_MS = 5000;

interface RuntimeGlobal {
  __caracalBotRuntime?: BotRuntimeKernel;
}

function runtimeState(): RuntimeState {
  return parent.caracAL?.runtime_state || "RUNNING";
}

function runtimeIdentity(): Record<string, unknown> {
  const runtimeConfigRevision = (
    parent.caracAL as typeof parent.caracAL & {
      runtime_config_revision?: number;
    }
  )?.runtime_config_revision;

  return {
    character: character.name,
    ctype: character.ctype,
    map: character.map,
    codeRevision: parent.caracAL?.code_revision || null,
    configRevision: parent.caracAL?.config_revision || null,
    runtimeConfigRevision: runtimeConfigRevision ?? 0,
    sourceRevision: parent.caracAL?.source_revision || null,
  };
}

function forwardEvent(event: RuntimeEvent): void {
  const sent = parent.caracAL?.emit_event(event);
  if (sent === false) {
    console.warn("runtime event rejected by caracAL bridge", event.type);
  }
}

export class BotRuntimeKernel {
  readonly eventBus: EventBus;
  readonly scheduler: Scheduler;
  readonly modules: ModuleRegistry;
  readonly actionLedger: ActionLedger;
  readonly game: GameAdapter;
  readonly actions: ActionBoundary;
  readonly movement: MovementController;
  readonly combat: CombatController;
  readonly classSkills: ClassSkillController | null;
  readonly groupCombat: GroupCombatController;
  readonly farmIntelligence: FarmIntelligenceController;
  readonly inventoryIntelligence: InventoryIntelligenceController;
  readonly merchantLogistics: MerchantLogisticsController;

  private started = false;
  private stopping = false;
  private movementLiveTestRunning = false;
  private combatLiveTestRunning = false;
  private classSkillLiveTestRunning = false;
  private groupLiveTestRunning = false;
  private farmLiveTestRunning = false;
  private inventoryLiveTestRunning = false;

  constructor() {
    this.eventBus = new EventBus({
      sink: forwardEvent,
    });

    this.scheduler = new Scheduler({
      getRuntimeState: runtimeState,
      onEvent: (event) => this.handleSchedulerEvent(event),
    });

    this.modules = new ModuleRegistry({
      onEvent: (event) => this.handleModuleEvent(event),
    });

    this.actionLedger = new ActionLedger({
      isEmergencyStopActive: () => !!parent.caracAL?.emergency_stop,
      emit: (event) => {
        this.eventBus.emit({
          module: event.module,
          type: event.type,
          why: event.why,
          actionId: event.actionId,
          correlationId: event.correlationId,
          ...(event.data && { data: event.data }),
        });
      },
    });

    this.game = new GameAdapter();
    this.actions = new ActionBoundary(this.actionLedger, this.game);
    this.movement = new MovementController(this.actions, {
      onEvent: (event) => this.handleMovementEvent(event),
      position: () => {
        const snapshot = this.game.character();
        return {
          map: snapshot.map,
          x: snapshot.x,
          y: snapshot.y,
          moving: snapshot.moving,
        };
      },
    });

    const runtimeConfig = parent.caracAL as
      | (NonNullable<typeof parent.caracAL> & { config?: unknown })
      | undefined;
    this.combat = new CombatController(this.game, this.actions, this.movement, {
      config: () => runtimeConfig?.config || {},
      onEvent: (event) => this.handleCombatEvent(event),
    });
    this.classSkills = createClassSkillController(
      this.game.character().ctype,
      this.game,
      this.actions,
      this.combat,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleClassSkillEvent(event),
      },
    );
    this.groupCombat = new GroupCombatController(
      this.game,
      this.actions,
      this.movement,
      this.combat,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleGroupCombatEvent(event),
      },
    );
    this.farmIntelligence = new FarmIntelligenceController(this.game, {
      config: () => runtimeConfig?.config || {},
      onEvent: (event) => this.handleFarmIntelligenceEvent(event),
    });
    this.inventoryIntelligence = new InventoryIntelligenceController(
      this.game,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleInventoryIntelligenceEvent(event),
      },
    );
    this.merchantLogistics = new MerchantLogisticsController(
      this.game,
      this.actions,
      this.movement,
      this.inventoryIntelligence,
      {
        onEvent: (event) => this.handleMerchantLogisticsEvent(event),
      },
    );

    this.scheduler.register({
      id: MERCHANT_LOGISTICS_JOB_ID,
      intervalMs: MERCHANT_LOGISTICS_INTERVAL_MS,
      priority: 83,
      tick: async () => {
        await this.merchantLogistics.tick();
      },
    });

    this.scheduler.register({
      id: INVENTORY_INTELLIGENCE_JOB_ID,
      intervalMs: INVENTORY_INTELLIGENCE_INTERVAL_MS,
      priority: 85,
      tick: () => {
        this.inventoryIntelligence.tick();
      },
    });

    this.scheduler.register({
      id: FARM_INTELLIGENCE_JOB_ID,
      intervalMs: FARM_INTELLIGENCE_INTERVAL_MS,
      priority: 80,
      tick: () => {
        this.farmIntelligence.tick();
      },
    });

    this.scheduler.register({
      id: GROUP_COMBAT_JOB_ID,
      intervalMs: GROUP_COMBAT_INTERVAL_MS,
      priority: 70,
      tick: async () => {
        await this.groupCombat.tick();
      },
    });

    if (this.classSkills) {
      this.scheduler.register({
        id: CLASS_SKILL_JOB_ID,
        intervalMs: CLASS_SKILL_INTERVAL_MS,
        priority: 60,
        tick: async () => {
          await this.classSkills?.tick();
        },
      });
    }

    this.scheduler.register({
      id: COMBAT_JOB_ID,
      intervalMs: COMBAT_INTERVAL_MS,
      priority: 50,
      tick: async () => {
        await this.combat.tick();
      },
    });
    this.scheduler.register({
      id: MOVEMENT_SETTLEMENT_JOB_ID,
      intervalMs: MOVEMENT_SETTLEMENT_INTERVAL_MS,
      priority: 100,
      runWhenPaused: true,
      tick: () => {
        this.movement.observe();
      },
    });

    this.scheduler.register({
      id: STATUS_JOB_ID,
      intervalMs: STATUS_INTERVAL_MS,
      priority: -1000,
      runWhenPaused: true,
      tick: () => {
        this.eventBus.emit({
          module: "RuntimeKernel",
          type: "RUNTIME_STATUS",
          why: "PERIODIC_RUNTIME_HEALTH",
          data: {
            ...runtimeIdentity(),
            runtimeState: runtimeState(),
            emergencyStop: !!parent.caracAL?.emergency_stop,
            emergencyStopState:
              parent.caracAL?.emergency_stop_state || null,
            modules: this.modules.list(),
            schedulerJobs: this.scheduler.list(),
            gameAdapterReads: this.game.capabilities(),
            actionBoundaryMutations: this.actions.capabilities(),
            movement: this.movement.status(),
            combat: this.combat.status(),
            classSkills: this.classSkills?.status() || null,
            groupCombat: this.groupCombat.status(),
            farmIntelligence: this.farmIntelligence.status(),
            inventoryIntelligence: this.inventoryIntelligence.status(),
            merchantLogistics: this.merchantLogistics.status(),
            recentActions: this.actionLedger.list(20),
          },
        });
      },
    });
  }

  async start(): Promise<void> {
    if (this.started || this.stopping) return;

    this.eventBus.emit({
      module: "RuntimeKernel",
      type: "RUNTIME_STARTING",
      why: "HEADLESS_BOOT",
      data: runtimeIdentity(),
    });

    try {
      await this.modules.startAll();
      this.scheduler.start();
      this.started = true;

      this.eventBus.emit({
        module: "RuntimeKernel",
        type: "RUNTIME_STARTED",
        why: "CORE_MODULES_READY",
        data: {
          ...runtimeIdentity(),
          runtimeState: runtimeState(),
        },
      });
    } catch (error) {
      this.scheduler.stop();
      this.eventBus.emit({
        module: "RuntimeKernel",
        type: "RUNTIME_START_FAILED",
        why: "CORE_START_FAILURE",
        data: {
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack }),
        },
      });
      throw error;
    }
  }

  async stop(reason = "RUNTIME_STOP"): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    this.eventBus.emit({
      module: "RuntimeKernel",
      type: "RUNTIME_STOPPING",
      why: reason,
      data: runtimeIdentity(),
    });

    this.scheduler.stop();
    await this.modules.stopAll(reason);
    this.started = false;
    this.stopping = false;

    this.eventBus.emit({
      module: "RuntimeKernel",
      type: "RUNTIME_STOPPED",
      why: reason,
      data: runtimeIdentity(),
    });
  }

  status(): Record<string, unknown> {
    return {
      started: this.started,
      stopping: this.stopping,
      runtimeState: runtimeState(),
      emergencyStop: !!parent.caracAL?.emergency_stop,
      emergencyStopState: parent.caracAL?.emergency_stop_state || null,
      modules: this.modules.list(),
      schedulerJobs: this.scheduler.list(),
      movement: this.movement.status(),
      combat: this.combat.status(),
      classSkills: this.classSkills?.status() || null,
      groupCombat: this.groupCombat.status(),
      farmIntelligence: this.farmIntelligence.status(),
      inventoryIntelligence: this.inventoryIntelligence.status(),
      merchantLogistics: this.merchantLogistics.status(),
      recentActions: this.actionLedger.list(20),
      ...runtimeIdentity(),
    };
  }

  async runMovementLiveTest(
    options: MovementLiveTestOptions = {},
  ): Promise<MovementLiveTestResult> {
    if (this.movementLiveTestRunning) {
      throw new Error("movement live test already running");
    }
    if (this.combatLiveTestRunning) {
      throw new Error("combat live test already running");
    }
    if (this.classSkillLiveTestRunning) {
      throw new Error("class skill live test already running");
    }
    if (this.groupLiveTestRunning) {
      throw new Error("group live test already running");
    }
    if (this.farmLiveTestRunning) {
      throw new Error("farm live test already running");
    }
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for movement live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for movement live test");
    }

    this.movementLiveTestRunning = true;
    const requestId =
      options.requestId || `movement-live-${Date.now()}`;
    this.eventBus.emit({
      module: "MovementLiveTest",
      type: "MOVEMENT_LIVE_TEST_STARTED",
      why: "AUTONOMOUS_MOVEMENT_E2E",
      correlationId: requestId,
      data: {
        requestId,
        movement: this.movement.status(),
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new MovementLiveTestRunner({
        movement: this.movement,
        character: () => this.game.character(),
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "MovementLiveTest",
        type: "MOVEMENT_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          movement: this.movement.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "MovementLiveTest",
        type: "MOVEMENT_LIVE_TEST_FAILED",
        why: "MOVEMENT_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          movement: this.movement.status(),
        },
      });
      throw error;
    } finally {
      this.movementLiveTestRunning = false;
    }
  }

  async runCombatLiveTest(
    options: CombatLiveTestOptions = {},
  ): Promise<CombatLiveTestResult> {
    if (this.combatLiveTestRunning) {
      throw new Error("combat live test already running");
    }
    if (this.movementLiveTestRunning) {
      throw new Error("movement live test already running");
    }
    if (this.classSkillLiveTestRunning) {
      throw new Error("class skill live test already running");
    }
    if (this.groupLiveTestRunning) {
      throw new Error("group live test already running");
    }
    if (this.farmLiveTestRunning) {
      throw new Error("farm live test already running");
    }
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for combat live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for combat live test");
    }

    this.combatLiveTestRunning = true;
    const requestId = options.requestId || `combat-live-${Date.now()}`;
    this.eventBus.emit({
      module: "CombatLiveTest",
      type: "COMBAT_LIVE_TEST_STARTED",
      why: "AUTONOMOUS_COMBAT_E2E",
      correlationId: requestId,
      data: {
        requestId,
        combat: this.combat.status(),
        movement: this.movement.status(),
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new CombatLiveTestRunner({
        combat: this.combat,
        movement: this.movement,
        character: () => this.game.character(),
        entities: () => this.game.entities(),
        gameData: () => this.game.gameData(),
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "CombatLiveTest",
        type: "COMBAT_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          combat: this.combat.status(),
          movement: this.movement.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "CombatLiveTest",
        type: "COMBAT_LIVE_TEST_FAILED",
        why: "COMBAT_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          combat: this.combat.status(),
          movement: this.movement.status(),
        },
      });
      throw error;
    } finally {
      this.combatLiveTestRunning = false;
    }
  }

  async runClassSkillLiveTest(
    options: ClassSkillLiveTestOptions = {},
  ): Promise<ClassSkillLiveTestResult> {
    if (this.classSkillLiveTestRunning) {
      throw new Error("class skill live test already running");
    }
    if (this.movementLiveTestRunning) {
      throw new Error("movement live test already running");
    }
    if (this.combatLiveTestRunning) {
      throw new Error("combat live test already running");
    }
    if (!this.classSkills) {
      throw new Error("class skill controller is unavailable");
    }
    if (this.groupLiveTestRunning) {
      throw new Error("group live test already running");
    }
    if (this.farmLiveTestRunning) {
      throw new Error("farm live test already running");
    }
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for class skill live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for class skill live test");
    }

    this.classSkillLiveTestRunning = true;
    const requestId =
      options.requestId || `class-skill-live-${Date.now()}`;
    this.eventBus.emit({
      module: "ClassSkillLiveTest",
      type: "CLASS_SKILL_LIVE_TEST_STARTED",
      why: "AUTONOMOUS_CLASS_SKILL_E2E",
      correlationId: requestId,
      data: {
        requestId,
        classSkills: this.classSkills.status(),
        combat: this.combat.status(),
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new ClassSkillLiveTestRunner({
        classSkills: this.classSkills,
        combat: this.combat,
        character: () => this.game.character(),
        skills: () => this.game.skills(false),
        cooldowns: () => this.game.cooldowns(),
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "ClassSkillLiveTest",
        type: "CLASS_SKILL_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          classSkills: this.classSkills.status(),
          combat: this.combat.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "ClassSkillLiveTest",
        type: "CLASS_SKILL_LIVE_TEST_FAILED",
        why: "CLASS_SKILL_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          classSkills: this.classSkills.status(),
          combat: this.combat.status(),
        },
      });
      throw error;
    } finally {
      this.classSkillLiveTestRunning = false;
    }
  }

  async runGroupLiveTest(
    options: GroupLiveTestOptions,
  ): Promise<GroupLiveTestResult> {
    if (this.groupLiveTestRunning) {
      throw new Error("group live test already running");
    }
    if (this.movementLiveTestRunning) {
      throw new Error("movement live test already running");
    }
    if (this.combatLiveTestRunning) {
      throw new Error("combat live test already running");
    }
    if (this.classSkillLiveTestRunning) {
      throw new Error("class skill live test already running");
    }
    if (this.farmLiveTestRunning) {
      throw new Error("farm live test already running");
    }
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for group live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for group live test");
    }

    this.groupLiveTestRunning = true;
    const requestId = options.requestId || "group-live-" + Date.now();
    this.eventBus.emit({
      module: "GroupLiveTest",
      type: "GROUP_LIVE_TEST_STARTED",
      why: "AUTONOMOUS_GROUP_E2E",
      correlationId: requestId,
      data: {
        requestId,
        role: options.role,
        leader: options.leader,
        peer: options.peer,
        groupCombat: this.groupCombat.status(),
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new GroupLiveTestRunner({
        groupCombat: this.groupCombat,
        combat: this.combat,
        classSkills: this.classSkills,
        actions: this.actions,
        character: () => this.game.character(),
        party: () => this.game.party(),
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "GroupLiveTest",
        type: "GROUP_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          groupCombat: this.groupCombat.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "GroupLiveTest",
        type: "GROUP_LIVE_TEST_FAILED",
        why: "GROUP_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          groupCombat: this.groupCombat.status(),
        },
      });
      throw error;
    } finally {
      this.groupLiveTestRunning = false;
    }
  }

  async runFarmIntelligenceLiveTest(
    options: FarmLiveTestOptions = {},
  ): Promise<FarmLiveTestResult> {
    if (this.farmLiveTestRunning) {
      throw new Error("farm live test already running");
    }
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (this.movementLiveTestRunning) {
      throw new Error("movement live test already running");
    }
    if (this.combatLiveTestRunning) {
      throw new Error("combat live test already running");
    }
    if (this.classSkillLiveTestRunning) {
      throw new Error("class skill live test already running");
    }
    if (this.groupLiveTestRunning) {
      throw new Error("group live test already running");
    }
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for farm live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for farm live test");
    }

    this.farmLiveTestRunning = true;
    const requestId = options.requestId || `farm-live-${Date.now()}`;
    this.eventBus.emit({
      module: "FarmLiveTest",
      type: "FARM_LIVE_TEST_STARTED",
      why: "AUTONOMOUS_FARM_INTELLIGENCE_E2E",
      correlationId: requestId,
      data: {
        requestId,
        farmIntelligence: this.farmIntelligence.status(),
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new FarmLiveTestRunner({
        farmIntelligence: this.farmIntelligence,
        character: () => this.game.character(),
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "FarmLiveTest",
        type: "FARM_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          farmIntelligence: this.farmIntelligence.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "FarmLiveTest",
        type: "FARM_LIVE_TEST_FAILED",
        why: "FARM_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          farmIntelligence: this.farmIntelligence.status(),
        },
      });
      throw error;
    } finally {
      this.farmLiveTestRunning = false;
    }
  }

  setMerchantLogisticsPlan(
    plan: MerchantLogisticsRuntimePlan,
  ): Record<string, unknown> {
    const status = this.merchantLogistics.setPlan(plan);
    return {
      accepted: true,
      claimCount: status.claimCount,
      planGeneratedAt: status.planGeneratedAt,
    };
  }

  runInventoryIntelligenceLiveTest(
    options: InventoryLiveTestOptions = {},
  ): InventoryLiveTestResult {
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (this.movementLiveTestRunning) {
      throw new Error("movement live test already running");
    }
    if (this.combatLiveTestRunning) {
      throw new Error("combat live test already running");
    }
    if (this.classSkillLiveTestRunning) {
      throw new Error("class skill live test already running");
    }
    if (this.groupLiveTestRunning) {
      throw new Error("group live test already running");
    }
    if (this.farmLiveTestRunning) {
      throw new Error("farm live test already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for inventory live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for inventory live test");
    }

    this.inventoryLiveTestRunning = true;
    const requestId = options.requestId || `inventory-live-${Date.now()}`;
    this.eventBus.emit({
      module: "InventoryLiveTest",
      type: "INVENTORY_LIVE_TEST_STARTED",
      why: "AUTONOMOUS_INVENTORY_INTELLIGENCE_E2E",
      correlationId: requestId,
      data: {
        requestId,
        inventoryIntelligence: this.inventoryIntelligence.status(),
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new InventoryLiveTestRunner({
        inventoryIntelligence: this.inventoryIntelligence,
        inventory: () => this.game.inventory(),
      });
      const result = runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "InventoryLiveTest",
        type: "INVENTORY_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          inventoryIntelligence: this.inventoryIntelligence.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "InventoryLiveTest",
        type: "INVENTORY_LIVE_TEST_FAILED",
        why: "INVENTORY_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          inventoryIntelligence: this.inventoryIntelligence.status(),
        },
      });
      throw error;
    } finally {
      this.inventoryLiveTestRunning = false;
    }
  }

  private handleMerchantLogisticsEvent(
    event: MerchantLogisticsRuntimeEvent,
  ): void {
    this.eventBus.emit({
      module: "MerchantLogisticsController",
      type: event.type,
      why: event.reason,
      data: {
        merchantLogistics: event.status,
        ...(event.completion && { completion: event.completion }),
      },
    });
  }

  private handleInventoryIntelligenceEvent(
    event: InventoryIntelligenceEvent,
  ): void {
    this.eventBus.emit({
      module: "InventoryIntelligenceController",
      type: event.type,
      why: event.reason,
      data: {
        inventoryIntelligence: event.status,
      },
    });
  }

  private handleFarmIntelligenceEvent(
    event: FarmIntelligenceEvent,
  ): void {
    this.eventBus.emit({
      module: "FarmIntelligenceController",
      type: event.type,
      why: event.reason,
      data: {
        farmIntelligence: event.status,
        ...(event.sample && { sample: event.sample }),
      },
    });
  }

  private handleGroupCombatEvent(event: GroupCombatControllerEvent): void {
    this.eventBus.emit({
      module: "GroupCombatController",
      type: event.type,
      why: event.reason,
      ...(event.actionId && { actionId: event.actionId }),
      data: {
        state: event.state,
        actionStatus: event.actionStatus || null,
        groupCombat: event.status,
      },
    });
  }

  private handleClassSkillEvent(event: ClassSkillControllerEvent): void {
    this.eventBus.emit({
      module: event.module,
      type: event.type,
      why: event.reason,
      ...(event.actionId && { actionId: event.actionId }),
      data: {
        className: event.className,
        skill: event.skill || null,
        targetId: event.targetId || null,
        actionStatus: event.actionStatus || null,
        classSkills: event.status,
      },
    });
  }

  private handleCombatEvent(event: CombatControllerEvent): void {
    this.eventBus.emit({
      module: "CombatController",
      type: event.type,
      why: event.reason,
      ...(event.actionId && { actionId: event.actionId }),
      data: {
        state: event.state,
        targetId: event.targetId ?? null,
        actionStatus: event.actionStatus ?? null,
        combat: event.status,
      },
    });
  }

  private handleMovementEvent(event: MovementControllerEvent): void {
    this.eventBus.emit({
      module: "MovementController",
      type: event.type,
      ...(event.reason && { why: event.reason }),
      data: {
        owner: event.owner,
        ...(event.previousOwner !== undefined && {
          previousOwner: event.previousOwner,
        }),
        ...(event.commandType && { commandType: event.commandType }),
        ...(event.commandId !== undefined && {
          commandId: event.commandId,
        }),
        ...(event.actionId && { actionId: event.actionId }),
        ...(event.status !== undefined && { status: event.status }),
        ...(event.pathId !== undefined && { pathId: event.pathId }),
        ...(event.waypointIndex !== undefined && {
          waypointIndex: event.waypointIndex,
        }),
        ...(event.waypointCount !== undefined && {
          waypointCount: event.waypointCount,
        }),
        ...(event.safePoint !== undefined && {
          safePoint: event.safePoint,
        }),
        ...(event.stuckSince !== undefined && {
          stuckSince: event.stuckSince,
        }),
        movement: this.movement.status(),
      },
    });
  }

  private handleSchedulerEvent(event: SchedulerEvent): void {
    this.eventBus.emit({
      module: "Scheduler",
      type: event.type,
      ...(event.reason && { why: event.reason }),
      data: {
        jobId: event.jobId,
        ...(event.durationMs !== undefined && {
          durationMs: event.durationMs,
        }),
        ...(event.error && { error: event.error }),
        ...(event.stack && { stack: event.stack }),
      },
    });
  }

  private handleModuleEvent(event: ModuleRegistryEvent): void {
    this.eventBus.emit({
      module: "ModuleRegistry",
      type: event.type,
      ...(event.reason && { why: event.reason }),
      data: {
        moduleId: event.moduleId,
        ...(event.error && { error: event.error }),
        ...(event.stack && { stack: event.stack }),
      },
    });
  }
}

export function bootRuntime(): BotRuntimeKernel {
  const runtimeGlobal = globalThis as unknown as RuntimeGlobal;
  const previous = runtimeGlobal.__caracalBotRuntime;

  if (previous) {
    void previous.stop("SCRIPT_CONTEXT_REPLACED");
  }

  const runtime = new BotRuntimeKernel();
  runtimeGlobal.__caracalBotRuntime = runtime;

  void runtime.start().catch((error) => {
    console.error("Headless bot runtime failed to start", error);
  });

  return runtime;
}
