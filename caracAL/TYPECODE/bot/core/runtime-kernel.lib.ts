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
  MerchantAutonomyController,
  MerchantAutonomyEvent,
} from "./merchant-autonomy-controller.lib";
import {
  MerchantMerritController,
  MerchantMerritEvent,
} from "./merchant-merrit-controller.lib";
import {
  MerritLiveTestOptions,
  MerritLiveTestResult,
  MerritLiveTestRunner,
} from "./merrit-live-test.lib";
import {
  MerchantFishingController,
  MerchantFishingEvent,
} from "./merchant-fishing-controller.lib";
import {
  FishingLiveTestOptions,
  FishingLiveTestResult,
  FishingLiveTestRunner,
} from "./fishing-live-test.lib";
import {
  MaterialGatherTaskOptions,
  MaterialGatherTaskResult,
  MaterialGatheringTaskRunner,
} from "./material-gathering-task.lib";
import {
  LogisticsClaim,
  LogisticsClaimExecutor,
  LogisticsExecutionResult,
} from "./logistics-claim-executor.lib";
import {
  InventoryLiveTestOptions,
  InventoryLiveTestResult,
  InventoryLiveTestRunner,
} from "./inventory-live-test.lib";
import {
  LogisticsLiveTestOptions,
  LogisticsLiveTestResult,
  LogisticsLiveTestRunner,
} from "./logistics-live-test.lib";
import {
  MerchantLiveTestOptions,
  MerchantLiveTestResult,
  MerchantLiveTestRunner,
} from "./merchant-live-test.lib";
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
import {
  BankTravelController,
  BankTravelEvent,
} from "./bank-travel-controller.lib";
import {
  BankTravelLiveTestOptions,
  BankTravelLiveTestResult,
  BankTravelLiveTestRunner,
} from "./bank-travel-live-test.lib";
import { BankGoldSettlementController } from "./bank-gold-settlement.lib";
import {
  BankGoldLiveTestOptions,
  BankGoldLiveTestResult,
  BankGoldLiveTestRunner,
} from "./bank-gold-live-test.lib";

const INVENTORY_INTELLIGENCE_JOB_ID = "inventory-intelligence-loop";
const INVENTORY_INTELLIGENCE_INTERVAL_MS = 1000;
const FARM_INTELLIGENCE_JOB_ID = "farm-intelligence-loop";
const FARM_INTELLIGENCE_INTERVAL_MS = 1000;
const MERCHANT_AUTONOMY_JOB_ID = "merchant-autonomy-loop";
const MERCHANT_AUTONOMY_INTERVAL_MS = 1000;
const BANK_TRAVEL_JOB_ID = "bank-travel-loop";
const BANK_TRAVEL_INTERVAL_MS = 1000;
const MERRIT_AUTONOMY_JOB_ID = "merchant-merrit-loop";
const MERRIT_AUTONOMY_INTERVAL_MS = 1000;
const FISHING_AUTONOMY_JOB_ID = "merchant-fishing-loop";
const FISHING_AUTONOMY_INTERVAL_MS = 1000;
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
  readonly logisticsClaims: LogisticsClaimExecutor;
  readonly movement: MovementController;
  readonly combat: CombatController;
  readonly classSkills: ClassSkillController | null;
  readonly groupCombat: GroupCombatController;
  readonly farmIntelligence: FarmIntelligenceController;
  readonly inventoryIntelligence: InventoryIntelligenceController;
  readonly merchantAutonomy: MerchantAutonomyController;
  readonly bankTravel: BankTravelController;
  readonly bankGoldSettlement: BankGoldSettlementController;
  readonly merchantMerrit: MerchantMerritController;
  readonly merchantFishing: MerchantFishingController;

  private started = false;
  private stopping = false;
  private movementLiveTestRunning = false;
  private combatLiveTestRunning = false;
  private classSkillLiveTestRunning = false;
  private groupLiveTestRunning = false;
  private farmLiveTestRunning = false;
  private inventoryLiveTestRunning = false;
  private logisticsLiveTestRunning = false;
  private merchantLiveTestRunning = false;
  private bankTravelLiveTestRunning = false;
  private bankGoldLiveTestRunning = false;
  private merritLiveTestRunning = false;
  private fishingLiveTestRunning = false;
  private materialGatherTaskRunning = false;
  private logisticsClaimRunning = false;
  private lastLogisticsExecution: LogisticsExecutionResult | null = null;

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
    this.merchantAutonomy = new MerchantAutonomyController(
      this.game,
      this.actions,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleMerchantAutonomyEvent(event),
      },
    );
    this.bankTravel = new BankTravelController(this.game, this.movement, {
      config: () => runtimeConfig?.config || {},
      onEvent: (event) => this.handleBankTravelEvent(event),
    });
    this.bankGoldSettlement = new BankGoldSettlementController(
      this.game,
      this.actions,
    );
    this.merchantMerrit = new MerchantMerritController(
      this.game,
      this.actions,
      this.movement,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleMerchantMerritEvent(event),
      },
    );
    this.merchantFishing = new MerchantFishingController(
      this.game,
      this.actions,
      this.movement,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleMerchantFishingEvent(event),
      },
    );
    this.logisticsClaims = new LogisticsClaimExecutor(
      this.actions,
      this.game,
      this.inventoryIntelligence,
    );

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

    this.registerMerchantAutonomyJob();
    this.registerBankTravelJob();
    this.registerMerritJob();
    this.registerFishingJob();
    this.registerGroupCombatJob();
    this.registerClassSkillJob();
    this.registerCombatJob();
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
            merchantAutonomy: this.merchantAutonomy.status(),
            bankTravel: this.bankTravel.status(),
            merchantMerrit: this.merchantMerrit.status(),
            merchantFishing: this.merchantFishing.status(),
            logisticsExecution: {
              busy: this.logisticsClaimRunning,
              last: this.lastLogisticsExecution,
            },
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
      merchantAutonomy: this.merchantAutonomy.status(),
      bankTravel: this.bankTravel.status(),
      merchantMerrit: this.merchantMerrit.status(),
      merchantFishing: this.merchantFishing.status(),
      logisticsExecution: {
        busy: this.logisticsClaimRunning,
        last: this.lastLogisticsExecution,
      },
      recentActions: this.actionLedger.list(20),
      ...runtimeIdentity(),
    };
  }

  async executeLogisticsClaim(
    claim: LogisticsClaim,
  ): Promise<LogisticsExecutionResult> {
    if (this.logisticsLiveTestRunning) {
      throw new Error("logistics live test is running");
    }
    if (this.logisticsClaimRunning) {
      throw new Error("logistics claim already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for logistics claim");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for logistics claim");
    }

    this.logisticsClaimRunning = true;
    this.eventBus.emit({
      module: "MerchantLogistics",
      type: "LOGISTICS_CLAIM_STARTED",
      why: claim.reason || claim.type,
      correlationId: claim.id,
      data: {
        claim,
        ...runtimeIdentity(),
      },
    });

    try {
      const result = await this.logisticsClaims.execute(claim);
      this.lastLogisticsExecution = result;
      this.eventBus.emit({
        module: "MerchantLogistics",
        type: "LOGISTICS_CLAIM_COMPLETED",
        why: result.reason,
        correlationId: claim.id,
        ...(result.actionId && { actionId: result.actionId }),
        data: {
          claim,
          result,
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "MerchantLogistics",
        type: "LOGISTICS_CLAIM_FAILED",
        why: "LOGISTICS_CLAIM_RUNTIME_ERROR",
        correlationId: claim.id,
        data: {
          claim,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    } finally {
      this.logisticsClaimRunning = false;
    }
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

  async runLogisticsLiveTest(
    options: LogisticsLiveTestOptions = {},
  ): Promise<LogisticsLiveTestResult> {
    if (this.logisticsLiveTestRunning) {
      throw new Error("logistics live test already running");
    }
    if (this.logisticsClaimRunning) {
      throw new Error("logistics claim already running");
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
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for logistics live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for logistics live test");
    }

    this.logisticsLiveTestRunning = true;
    const requestId = options.requestId || `logistics-live-${Date.now()}`;
    this.eventBus.emit({
      module: "LogisticsLiveTest",
      type: "LOGISTICS_LIVE_TEST_STARTED",
      why: "AUTONOMOUS_LOGISTICS_NON_FORCING_E2E",
      correlationId: requestId,
      data: {
        requestId,
        inventoryIntelligence: this.inventoryIntelligence.status(),
        logisticsExecution: {
          busy: this.logisticsClaimRunning,
          last: this.lastLogisticsExecution,
        },
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new LogisticsLiveTestRunner({
        logisticsClaims: this.logisticsClaims,
        inventoryIntelligence: this.inventoryIntelligence,
        character: () => {
          const snapshot = this.game.character();
          return {
            name: snapshot.name || "",
            ctype: snapshot.ctype,
          };
        },
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "LogisticsLiveTest",
        type: "LOGISTICS_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          inventoryIntelligence: this.inventoryIntelligence.status(),
          logisticsExecution: {
            busy: this.logisticsClaimRunning,
            last: this.lastLogisticsExecution,
          },
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "LogisticsLiveTest",
        type: "LOGISTICS_LIVE_TEST_FAILED",
        why: "LOGISTICS_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          inventoryIntelligence: this.inventoryIntelligence.status(),
        },
      });
      throw error;
    } finally {
      this.logisticsLiveTestRunning = false;
    }
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

  reportFishingMaterialRequestResult(result: {
    itemName: string;
    success: boolean;
    reason?: string | null;
  }): void {
    this.merchantFishing.reportMaterialRequestResult(result);
  }

  async runMaterialGatherTask(
    options: MaterialGatherTaskOptions,
  ): Promise<MaterialGatherTaskResult> {
    if (this.materialGatherTaskRunning) {
      throw new Error("material gathering task already running");
    }
    if (
      this.movementLiveTestRunning ||
      this.combatLiveTestRunning ||
      this.classSkillLiveTestRunning ||
      this.groupLiveTestRunning ||
      this.farmLiveTestRunning ||
      this.inventoryLiveTestRunning ||
      this.logisticsLiveTestRunning ||
      this.merchantLiveTestRunning ||
      this.merritLiveTestRunning ||
      this.fishingLiveTestRunning ||
      this.logisticsClaimRunning
    ) {
      throw new Error("runtime is busy with another controlled activity");
    }
    if (!this.started || this.stopping || runtimeState() !== "RUNNING") {
      throw new Error("runtime is not ready for material gathering task");
    }

    const worker = this.game.character();
    if (worker.ctype !== "ranger") {
      throw new Error("material gathering task requires ranger character");
    }

    this.materialGatherTaskRunning = true;
    const requestId =
      options.requestId || `material-gather-${Date.now()}`;
    const suspended = {
      groupCombat: this.scheduler.unregister(GROUP_COMBAT_JOB_ID),
      classSkill: this.scheduler.unregister(CLASS_SKILL_JOB_ID),
      combat: this.scheduler.unregister(COMBAT_JOB_ID),
    };

    this.eventBus.emit({
      module: "MaterialGatheringTask",
      type: "MATERIAL_GATHER_TASK_STARTED",
      why: "FISHING_MATERIAL_WORKER",
      correlationId: requestId,
      data: {
        requestId,
        itemName: options.itemName,
        monsterType: options.monsterType,
        quantity: options.quantity,
        recipient: options.recipient,
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new MaterialGatheringTaskRunner({
        game: this.game,
        combat: this.combat,
        movement: this.movement,
        actions: this.actions,
        logistics: this.logisticsClaims,
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "MaterialGatheringTask",
        type: "MATERIAL_GATHER_TASK_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          suspended,
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "MaterialGatheringTask",
        type: "MATERIAL_GATHER_TASK_FAILED",
        why: "MATERIAL_GATHER_TASK_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          suspended,
        },
      });
      throw error;
    } finally {
      if (suspended.groupCombat) this.registerGroupCombatJob();
      if (suspended.classSkill) this.registerClassSkillJob();
      if (suspended.combat) this.registerCombatJob();
      this.materialGatherTaskRunning = false;
    }
  }

  async runFishingLiveTest(
    options: FishingLiveTestOptions = {},
  ): Promise<FishingLiveTestResult> {
    if (this.fishingLiveTestRunning) {
      throw new Error("Fishing live test already running");
    }
    if (this.merritLiveTestRunning) {
      throw new Error("Merrit live test already running");
    }
    if (this.merchantLiveTestRunning) {
      throw new Error("merchant live test already running");
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
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (this.logisticsLiveTestRunning || this.logisticsClaimRunning) {
      throw new Error("logistics activity is running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for Fishing live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for Fishing live test");
    }

    const character = this.game.character();
    if (character.ctype !== "merchant") {
      throw new Error("Fishing live test requires merchant character");
    }

    this.fishingLiveTestRunning = true;
    const requestId = options.requestId || `fishing-live-${Date.now()}`;
    const suspended = {
      fishing: this.scheduler.unregister(FISHING_AUTONOMY_JOB_ID),
      merrit: this.scheduler.unregister(MERRIT_AUTONOMY_JOB_ID),
      groupCombat: this.scheduler.unregister(GROUP_COMBAT_JOB_ID),
      classSkill: this.scheduler.unregister(CLASS_SKILL_JOB_ID),
      combat: this.scheduler.unregister(COMBAT_JOB_ID),
    };

    this.eventBus.emit({
      module: "FishingLiveTest",
      type: "FISHING_LIVE_TEST_STARTED",
      why: "PHASE12_FISHING_ROADMAP_E2E",
      correlationId: requestId,
      data: {
        requestId,
        fishing: this.merchantFishing.status(),
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new FishingLiveTestRunner({
        fishing: this.merchantFishing,
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "FishingLiveTest",
        type: "FISHING_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          fishing: this.merchantFishing.status(),
          suspended,
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "FishingLiveTest",
        type: "FISHING_LIVE_TEST_FAILED",
        why: "FISHING_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          fishing: this.merchantFishing.status(),
          suspended,
        },
      });
      throw error;
    } finally {
      if (suspended.merrit) this.registerMerritJob();
      if (suspended.fishing) this.registerFishingJob();
      if (suspended.groupCombat) this.registerGroupCombatJob();
      if (suspended.classSkill) this.registerClassSkillJob();
      if (suspended.combat) this.registerCombatJob();
      this.fishingLiveTestRunning = false;
    }
  }

  async runBankGoldLiveTest(
    options: BankGoldLiveTestOptions = {},
  ): Promise<BankGoldLiveTestResult> {
    if (this.bankGoldLiveTestRunning) {
      throw new Error("bank gold live test already running");
    }
    if (this.bankTravelLiveTestRunning) {
      throw new Error("bank travel live test is running");
    }
    if (this.merritLiveTestRunning || this.fishingLiveTestRunning) {
      throw new Error("merchant travel activity is running");
    }
    if (
      this.movementLiveTestRunning ||
      this.combatLiveTestRunning ||
      this.classSkillLiveTestRunning ||
      this.groupLiveTestRunning ||
      this.merchantLiveTestRunning
    ) {
      throw new Error("movement, combat, or merchant live test is running");
    }
    if (
      this.farmLiveTestRunning ||
      this.inventoryLiveTestRunning ||
      this.logisticsLiveTestRunning ||
      this.logisticsClaimRunning
    ) {
      throw new Error("another live or logistics test is running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for bank gold live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for bank gold live test");
    }

    const character = this.game.character();
    if (character.ctype !== "merchant") {
      throw new Error("bank gold live test requires merchant character");
    }

    this.bankGoldLiveTestRunning = true;
    const requestId = options.requestId || `bank-gold-live-${Date.now()}`;
    const suspended = {
      merchantAutonomy: this.scheduler.unregister(MERCHANT_AUTONOMY_JOB_ID),
      bankTravel: this.scheduler.unregister(BANK_TRAVEL_JOB_ID),
      fishing: this.scheduler.unregister(FISHING_AUTONOMY_JOB_ID),
      merrit: this.scheduler.unregister(MERRIT_AUTONOMY_JOB_ID),
      groupCombat: this.scheduler.unregister(GROUP_COMBAT_JOB_ID),
      classSkill: this.scheduler.unregister(CLASS_SKILL_JOB_ID),
      combat: this.scheduler.unregister(COMBAT_JOB_ID),
    };

    this.eventBus.emit({
      module: "BankGoldLiveTest",
      type: "BANK_GOLD_LIVE_TEST_STARTED",
      why: "PHASE13_BANK_GOLD_SETTLEMENT_E2E",
      correlationId: requestId,
      data: {
        requestId,
        amount: options.amount ?? 1,
        bankTravel: this.bankTravel.status(),
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new BankGoldLiveTestRunner({
        bankTravel: this.bankTravel,
        bankGold: this.bankGoldSettlement,
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "BankGoldLiveTest",
        type: "BANK_GOLD_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          bankTravel: this.bankTravel.status(),
          suspended,
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "BankGoldLiveTest",
        type: "BANK_GOLD_LIVE_TEST_FAILED",
        why: "BANK_GOLD_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          bankTravel: this.bankTravel.status(),
          suspended,
        },
      });
      throw error;
    } finally {
      if (suspended.merchantAutonomy) this.registerMerchantAutonomyJob();
      if (suspended.bankTravel) this.registerBankTravelJob();
      if (suspended.merrit) this.registerMerritJob();
      if (suspended.fishing) this.registerFishingJob();
      if (suspended.groupCombat) this.registerGroupCombatJob();
      if (suspended.classSkill) this.registerClassSkillJob();
      if (suspended.combat) this.registerCombatJob();
      this.bankGoldLiveTestRunning = false;
    }
  }

  async runBankTravelLiveTest(
    options: BankTravelLiveTestOptions = {},
  ): Promise<BankTravelLiveTestResult> {
    if (this.bankTravelLiveTestRunning) {
      throw new Error("bank travel live test already running");
    }
    if (this.merritLiveTestRunning || this.fishingLiveTestRunning) {
      throw new Error("merchant travel activity is running");
    }
    if (
      this.movementLiveTestRunning ||
      this.combatLiveTestRunning ||
      this.classSkillLiveTestRunning ||
      this.groupLiveTestRunning
    ) {
      throw new Error("movement or combat live test is running");
    }
    if (
      this.farmLiveTestRunning ||
      this.inventoryLiveTestRunning ||
      this.logisticsLiveTestRunning ||
      this.logisticsClaimRunning
    ) {
      throw new Error("another live or logistics test is running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for bank travel live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for bank travel live test");
    }

    this.bankTravelLiveTestRunning = true;
    const requestId = options.requestId || `bank-travel-live-${Date.now()}`;
    const suspended = {
      bankTravel: this.scheduler.unregister(BANK_TRAVEL_JOB_ID),
      fishing: this.scheduler.unregister(FISHING_AUTONOMY_JOB_ID),
      merrit: this.scheduler.unregister(MERRIT_AUTONOMY_JOB_ID),
      groupCombat: this.scheduler.unregister(GROUP_COMBAT_JOB_ID),
      classSkill: this.scheduler.unregister(CLASS_SKILL_JOB_ID),
      combat: this.scheduler.unregister(COMBAT_JOB_ID),
    };

    this.eventBus.emit({
      module: "BankTravelLiveTest",
      type: "BANK_TRAVEL_LIVE_TEST_STARTED",
      why: "PHASE13_BANK_TRAVEL_E2E",
      correlationId: requestId,
      data: {
        requestId,
        bankTravel: this.bankTravel.status(),
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new BankTravelLiveTestRunner({
        bankTravel: this.bankTravel,
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "BankTravelLiveTest",
        type: "BANK_TRAVEL_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          bankTravel: this.bankTravel.status(),
          suspended,
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "BankTravelLiveTest",
        type: "BANK_TRAVEL_LIVE_TEST_FAILED",
        why: "BANK_TRAVEL_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          bankTravel: this.bankTravel.status(),
          suspended,
        },
      });
      throw error;
    } finally {
      if (suspended.bankTravel) this.registerBankTravelJob();
      if (suspended.merrit) this.registerMerritJob();
      if (suspended.fishing) this.registerFishingJob();
      if (suspended.groupCombat) this.registerGroupCombatJob();
      if (suspended.classSkill) this.registerClassSkillJob();
      if (suspended.combat) this.registerCombatJob();
      this.bankTravelLiveTestRunning = false;
    }
  }

  async runMerritLiveTest(
    options: MerritLiveTestOptions = {},
  ): Promise<MerritLiveTestResult> {
    if (this.merritLiveTestRunning) {
      throw new Error("Merrit live test already running");
    }
    if (this.fishingLiveTestRunning) {
      throw new Error("Fishing live test already running");
    }
    if (this.merchantLiveTestRunning) {
      throw new Error("merchant live test already running");
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
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (this.logisticsLiveTestRunning || this.logisticsClaimRunning) {
      throw new Error("logistics activity is running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for Merrit live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for Merrit live test");
    }

    const character = this.game.character();
    if (character.ctype !== "merchant") {
      throw new Error("Merrit live test requires merchant character");
    }

    this.merritLiveTestRunning = true;
    const requestId = options.requestId || `merrit-live-${Date.now()}`;
    const schedulerJobWasRegistered =
      this.scheduler.unregister(MERRIT_AUTONOMY_JOB_ID);

    this.eventBus.emit({
      module: "MerritLiveTest",
      type: "MERRIT_LIVE_TEST_STARTED",
      why: "PHASE12_MERRIT_ROADMAP_E2E",
      correlationId: requestId,
      data: {
        requestId,
        merrit: this.merchantMerrit.status(),
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new MerritLiveTestRunner({
        merrit: this.merchantMerrit,
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "MerritLiveTest",
        type: "MERRIT_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          merrit: this.merchantMerrit.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "MerritLiveTest",
        type: "MERRIT_LIVE_TEST_FAILED",
        why: "MERRIT_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          merrit: this.merchantMerrit.status(),
        },
      });
      throw error;
    } finally {
      if (schedulerJobWasRegistered) this.registerMerritJob();
      this.merritLiveTestRunning = false;
    }
  }

  runMerchantLiveTest(
    options: MerchantLiveTestOptions = {},
  ): MerchantLiveTestResult {
    if (this.merchantLiveTestRunning) {
      throw new Error("merchant live test already running");
    }
    if (this.merritLiveTestRunning) {
      throw new Error("Merrit live test already running");
    }
    if (this.fishingLiveTestRunning) {
      throw new Error("Fishing live test already running");
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
    if (this.inventoryLiveTestRunning) {
      throw new Error("inventory live test already running");
    }
    if (this.logisticsLiveTestRunning) {
      throw new Error("logistics live test already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for merchant live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for merchant live test");
    }

    const character = this.game.character();
    if (character.ctype !== "merchant") {
      throw new Error("merchant live test requires merchant character");
    }

    this.merchantLiveTestRunning = true;
    const requestId = options.requestId || `merchant-live-${Date.now()}`;
    this.eventBus.emit({
      module: "MerchantLiveTest",
      type: "MERCHANT_LIVE_TEST_STARTED",
      why: "AUTONOMOUS_MERCHANT_NON_FORCING_E2E",
      correlationId: requestId,
      data: {
        requestId,
        merchantAutonomy: this.merchantAutonomy.status(),
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new MerchantLiveTestRunner({
        merchantAutonomy: this.merchantAutonomy,
      });
      const result = runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "MerchantLiveTest",
        type: "MERCHANT_LIVE_TEST_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          merchantAutonomy: this.merchantAutonomy.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "MerchantLiveTest",
        type: "MERCHANT_LIVE_TEST_FAILED",
        why: "MERCHANT_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          merchantAutonomy: this.merchantAutonomy.status(),
        },
      });
      throw error;
    } finally {
      this.merchantLiveTestRunning = false;
    }
  }

  private registerMerchantAutonomyJob(): void {
    if (this.scheduler.has(MERCHANT_AUTONOMY_JOB_ID)) return;
    this.scheduler.register({
      id: MERCHANT_AUTONOMY_JOB_ID,
      intervalMs: MERCHANT_AUTONOMY_INTERVAL_MS,
      priority: 75,
      tick: () => {
        this.merchantAutonomy.tick();
      },
    });
  }

  private registerBankTravelJob(): void {
    if (this.scheduler.has(BANK_TRAVEL_JOB_ID)) return;
    this.scheduler.register({
      id: BANK_TRAVEL_JOB_ID,
      intervalMs: BANK_TRAVEL_INTERVAL_MS,
      priority: 76,
      tick: async () => {
        await this.bankTravel.tick();
      },
    });
  }

  private registerFishingJob(): void {
    if (this.scheduler.has(FISHING_AUTONOMY_JOB_ID)) return;
    this.scheduler.register({
      id: FISHING_AUTONOMY_JOB_ID,
      intervalMs: FISHING_AUTONOMY_INTERVAL_MS,
      priority: 73,
      tick: async () => {
        await this.merchantFishing.tick();
      },
    });
  }

  private registerGroupCombatJob(): void {
    if (this.scheduler.has(GROUP_COMBAT_JOB_ID)) return;
    this.scheduler.register({
      id: GROUP_COMBAT_JOB_ID,
      intervalMs: GROUP_COMBAT_INTERVAL_MS,
      priority: 70,
      tick: async () => {
        await this.groupCombat.tick();
      },
    });
  }

  private registerClassSkillJob(): void {
    if (!this.classSkills || this.scheduler.has(CLASS_SKILL_JOB_ID)) return;
    this.scheduler.register({
      id: CLASS_SKILL_JOB_ID,
      intervalMs: CLASS_SKILL_INTERVAL_MS,
      priority: 60,
      tick: async () => {
        await this.classSkills?.tick();
      },
    });
  }

  private registerCombatJob(): void {
    if (this.scheduler.has(COMBAT_JOB_ID)) return;
    this.scheduler.register({
      id: COMBAT_JOB_ID,
      intervalMs: COMBAT_INTERVAL_MS,
      priority: 50,
      tick: async () => {
        await this.combat.tick();
      },
    });
  }

  private handleMerchantFishingEvent(event: MerchantFishingEvent): void {
    this.eventBus.emit({
      module: "MerchantFishingController",
      type: event.type,
      why: event.reason,
      ...(event.actionId && { actionId: event.actionId }),
      data: {
        merchantFishing: event.status,
        ...(event.data || {}),
      },
    });
  }

  private registerMerritJob(): void {
    if (this.scheduler.has(MERRIT_AUTONOMY_JOB_ID)) return;
    this.scheduler.register({
      id: MERRIT_AUTONOMY_JOB_ID,
      intervalMs: MERRIT_AUTONOMY_INTERVAL_MS,
      priority: 74,
      tick: async () => {
        await this.merchantMerrit.tick();
      },
    });
  }

  private handleMerchantMerritEvent(event: MerchantMerritEvent): void {
    this.eventBus.emit({
      module: "MerchantMerritController",
      type: event.type,
      why: event.reason,
      ...(event.actionId && { actionId: event.actionId }),
      data: {
        merchantMerrit: event.status,
        ...(event.data || {}),
      },
    });
  }

  private handleBankTravelEvent(event: BankTravelEvent): void {
    this.eventBus.emit({
      module: "BankTravelController",
      type: event.type,
      why: event.reason,
      data: {
        bankTravel: event.status,
      },
    });
  }

  private handleMerchantAutonomyEvent(
    event: MerchantAutonomyEvent,
  ): void {
    this.eventBus.emit({
      module: "MerchantAutonomyController",
      type: event.type,
      why: event.reason,
      data: {
        merchantAutonomy: event.status,
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
