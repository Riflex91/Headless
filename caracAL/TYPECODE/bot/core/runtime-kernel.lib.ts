import { ActionBoundary } from "./action-boundary.lib";
import {
  ActionAuthorizationDecision,
  ActionIntent,
  ActionLedger,
  ActionRecord,
} from "./action-ledger.lib";
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
  GearScoringController,
  GearScoringEvent,
} from "./gear-scoring-controller.lib";
import {
  FutureGearController,
  FutureGearEvent,
} from "./future-gear-controller.lib";
import {
  UpgradeController,
  UpgradeEvent,
} from "./upgrade-controller.lib";
import {
  CompoundController,
  CompoundEvent,
} from "./compound-controller.lib";
import {
  ExchangeController,
  ExchangeEvent,
} from "./exchange-controller.lib";
import {
  CraftController,
  CraftEvent,
} from "./craft-controller.lib";
import {
  ExpectedValueController,
  ExpectedValueEvent,
} from "./expected-value-controller.lib";
import {
  RiskPolicyController,
  RiskPolicyEvent,
} from "./risk-policy-controller.lib";
import {
  EconomyPrebuffController,
  EconomyPrebuffEvent,
} from "./economy-prebuff-controller.lib";
import {
  EconomyPrebuffExecutionController,
  EconomyPrebuffExecutionEvent,
} from "./economy-prebuff-execution-controller.lib";
import {
  EconomyPrebuffExecutionLiveTestOptions,
  EconomyPrebuffExecutionLiveTestResult,
  EconomyPrebuffExecutionLiveTestRunner,
} from "./economy-prebuff-execution-live-test.lib";
import {
  EconomyArbiterController,
  EconomyArbiterEvent,
  EconomyArbiterLane,
  EconomyArbiterSignal,
  economyArbiterLaneForIntent,
} from "./economy-arbiter-controller.lib";
import {
  CraftPreflightResult,
  CraftPreflightRunner,
} from "./craft-preflight.lib";
import {
  CraftLiveTestOptions,
  CraftLiveTestResult,
  CraftLiveTestRunner,
} from "./craft-live-test.lib";
import {
  CraftMaterialPreparationPlan,
  planCraftMaterialPreparation,
} from "./craft-material-preparation-plan.lib";
import {
  ExchangePreflightResult,
  ExchangePreflightRunner,
} from "./exchange-preflight.lib";
import {
  ExchangeLiveTestOptions,
  ExchangeLiveTestResult,
  ExchangeLiveTestRunner,
} from "./exchange-live-test.lib";
import {
  CompoundGatherPlan,
  planCompoundGatherTarget as buildCompoundGatherPlan,
} from "./compound-gather-plan.lib";
import {
  CompoundLiveTestOptions,
  CompoundLiveTestResult,
  CompoundLiveTestRunner,
} from "./compound-live-test.lib";
import {
  UpgradeLiveTestOptions,
  UpgradeLiveTestResult,
  UpgradeLiveTestRunner,
  UpgradePreflightResult,
} from "./upgrade-live-test.lib";
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
  CharacterGoldTaskOptions,
  CharacterGoldTaskResult,
  CharacterGoldTaskRunner,
} from "./character-gold-task.lib";
import {
  CharacterTrainingTaskOptions,
  CharacterTrainingTaskResult,
  CharacterTrainingTaskRunner,
} from "./character-training-task.lib";
import {
  MaterialGatherTaskOptions,
  MaterialGatherTaskResult,
  MaterialGatheringTaskRunner,
} from "./material-gathering-task.lib";
import {
  GoalAdapterPreflightResult,
  GoalAdapterPreflightRunner,
} from "./goal-adapter-preflight.lib";
import {
  GoalAdapterDispatchResult,
  GoalAdapterDispatchRunner,
} from "./goal-adapter-dispatch.lib";
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
import { NpcTradingController } from "./npc-trading-controller.lib";
import {
  NpcTradingLiveTestOptions,
  NpcTradingLiveTestResult,
  NpcTradingLiveTestRunner,
} from "./npc-trading-live-test.lib";
import { MarketTradingController } from "./market-trading-controller.lib";
import {
  MarketIntelligenceController,
  MarketIntelligenceEvent,
  MarketIntelligenceObservationInput,
} from "./market-intelligence-controller.lib";
import { PontyMarketSnapshotTracker } from "./ponty-market-source.lib";
import {
  MarketTradingLiveTestOptions,
  MarketTradingLiveTestResult,
  MarketTradingLiveTestRunner,
} from "./market-trading-live-test.lib";

const INVENTORY_INTELLIGENCE_JOB_ID = "inventory-intelligence-loop";
const INVENTORY_INTELLIGENCE_INTERVAL_MS = 1000;
const GEAR_SCORING_JOB_ID = "gear-scoring-loop";
const GEAR_SCORING_INTERVAL_MS = 1000;
const FUTURE_GEAR_JOB_ID = "future-gear-loop";
const FUTURE_GEAR_INTERVAL_MS = 1000;
const UPGRADE_JOB_ID = "upgrade-loop";
const UPGRADE_INTERVAL_MS = 1000;
const COMPOUND_JOB_ID = "compound-loop";
const COMPOUND_INTERVAL_MS = 1000;
const EXCHANGE_JOB_ID = "exchange-loop";
const EXCHANGE_INTERVAL_MS = 1000;
const CRAFT_JOB_ID = "craft-loop";
const CRAFT_INTERVAL_MS = 1000;
const EXPECTED_VALUE_JOB_ID = "expected-value-loop";
const EXPECTED_VALUE_INTERVAL_MS = 1000;
const RISK_POLICY_JOB_ID = "risk-policy-loop";
const RISK_POLICY_INTERVAL_MS = 1000;
const ECONOMY_PREBUFF_JOB_ID = "economy-prebuff-loop";
const ECONOMY_PREBUFF_INTERVAL_MS = 1000;
const ECONOMY_ARBITER_JOB_ID = "economy-arbiter-loop";
const ECONOMY_ARBITER_INTERVAL_MS = 1000;
const FARM_INTELLIGENCE_JOB_ID = "farm-intelligence-loop";
const FARM_INTELLIGENCE_INTERVAL_MS = 1000;
const MARKET_INTELLIGENCE_JOB_ID = "market-intelligence-loop";
const MARKET_INTELLIGENCE_INTERVAL_MS = 5000;
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

function runtimeRealm(): string | null {
  const runtimeConfig = parent.caracAL as
    | (typeof parent.caracAL & { realm?: unknown })
    | undefined;
  return typeof runtimeConfig?.realm === "string" &&
    runtimeConfig.realm.trim().length > 0
    ? runtimeConfig.realm.trim()
    : null;
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
  readonly marketIntelligence: MarketIntelligenceController;
  readonly inventoryIntelligence: InventoryIntelligenceController;
  readonly gearScoring: GearScoringController;
  readonly futureGear: FutureGearController;
  readonly upgrade: UpgradeController;
  readonly compound: CompoundController;
  readonly exchange: ExchangeController;
  readonly craft: CraftController;
  readonly expectedValue: ExpectedValueController;
  readonly riskPolicy: RiskPolicyController;
  readonly economyPrebuff: EconomyPrebuffController;
  readonly economyPrebuffExecution: EconomyPrebuffExecutionController;
  readonly economyArbiter: EconomyArbiterController;
  readonly merchantAutonomy: MerchantAutonomyController;
  readonly bankTravel: BankTravelController;
  readonly bankGoldSettlement: BankGoldSettlementController;
  readonly npcTrading: NpcTradingController;
  readonly marketTrading: MarketTradingController;
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
  private upgradeLiveTestRunning = false;
  private upgradePreflightRunning = false;
  private compoundLiveTestRunning = false;
  private exchangePreflightRunning = false;
  private exchangeLiveTestRunning = false;
  private craftPreflightRunning = false;
  private craftLiveTestRunning = false;
  private logisticsLiveTestRunning = false;
  private merchantLiveTestRunning = false;
  private bankTravelLiveTestRunning = false;
  private bankGoldLiveTestRunning = false;
  private npcTradingLiveTestRunning = false;
  private marketTradingLiveTestRunning = false;
  private marketIntelligenceSourceProbeRunning = false;
  private merritLiveTestRunning = false;
  private fishingLiveTestRunning = false;
  private materialGatherTaskRunning = false;
  private characterTrainingTaskRunning = false;
  private characterGoldTaskRunning = false;
  private goalAdapterPreflightRunning = false;
  private goalAdapterDispatchRunning = false;
  private economyPrebuffExecutionRunning = false;
  private logisticsClaimRunning = false;
  private lastLogisticsExecution: LogisticsExecutionResult | null = null;
  private marketLocalHistory: MarketIntelligenceObservationInput[] = [];
  private readonly pontyMarketSnapshotTracker =
    new PontyMarketSnapshotTracker();

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
      authorizeIntent: (intent) => this.authorizeEconomyIntent(intent),
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
    this.marketIntelligence = new MarketIntelligenceController(this.game, {
      server: runtimeRealm,
      ponty: () =>
        this.pontyMarketSnapshotTracker.observations(this.game, {
          server: runtimeRealm,
        }),
      localHistory: () => this.marketLocalHistory,
      onEvent: (event) => this.handleMarketIntelligenceEvent(event),
    });
    this.gearScoring = new GearScoringController(this.game, {
      config: () => runtimeConfig?.config || {},
      onEvent: (event) => this.handleGearScoringEvent(event),
    });
    this.futureGear = new FutureGearController(this.game, this.gearScoring, {
      config: () => runtimeConfig?.config || {},
      onEvent: (event) => this.handleFutureGearEvent(event),
    });
    this.inventoryIntelligence = new InventoryIntelligenceController(
      this.game,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleInventoryIntelligenceEvent(event),
      },
    );
    this.upgrade = new UpgradeController(
      this.game,
      this.actions,
      this.inventoryIntelligence,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleUpgradeEvent(event),
      },
    );
    this.compound = new CompoundController(
      this.game,
      this.actions,
      this.inventoryIntelligence,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleCompoundEvent(event),
      },
    );
    this.exchange = new ExchangeController(
      this.game,
      this.actions,
      this.inventoryIntelligence,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleExchangeEvent(event),
      },
    );
    this.craft = new CraftController(
      this.game,
      this.actions,
      this.inventoryIntelligence,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleCraftEvent(event),
      },
    );
    this.expectedValue = new ExpectedValueController(
      this.game,
      this.upgrade,
      this.compound,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleExpectedValueEvent(event),
      },
    );
    this.riskPolicy = new RiskPolicyController(this.expectedValue, {
      config: () => runtimeConfig?.config || {},
      onEvent: (event) => this.handleRiskPolicyEvent(event),
    });
    this.economyPrebuff = new EconomyPrebuffController(
      this.game,
      this.riskPolicy,
      {
        config: () => runtimeConfig?.config || {},
        onEvent: (event) => this.handleEconomyPrebuffEvent(event),
      },
    );
    this.economyArbiter = new EconomyArbiterController({
      config: () => runtimeConfig?.config || {},
      signals: () => this.economyArbiterSignals(),
      onEvent: (event) => this.handleEconomyArbiterEvent(event),
    });
    this.economyPrebuffExecution = new EconomyPrebuffExecutionController(
      () => {
        this.inventoryIntelligence.tick();
        this.upgrade.tick();
        this.compound.tick();
        this.expectedValue.tick();
        this.riskPolicy.tick();
        this.economyPrebuff.tick();
      },
      this.economyPrebuff,
      this.riskPolicy,
      this.economyArbiter,
      this.actions,
      this.upgrade,
      this.compound,
      {
        onEvent: (event) => this.handleEconomyPrebuffExecutionEvent(event),
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
    this.npcTrading = new NpcTradingController(
      this.game,
      this.actions,
      this.movement,
    );
    this.marketTrading = new MarketTradingController(
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
      id: GEAR_SCORING_JOB_ID,
      intervalMs: GEAR_SCORING_INTERVAL_MS,
      priority: 86,
      tick: () => {
        this.gearScoring.tick();
      },
    });

    this.scheduler.register({
      id: FUTURE_GEAR_JOB_ID,
      intervalMs: FUTURE_GEAR_INTERVAL_MS,
      priority: 85,
      tick: () => {
        this.futureGear.tick();
        this.inventoryIntelligence.setDynamicFutureGearSlots(
          this.futureGear.candidateSlots(),
        );
      },
    });

    this.scheduler.register({
      id: INVENTORY_INTELLIGENCE_JOB_ID,
      intervalMs: INVENTORY_INTELLIGENCE_INTERVAL_MS,
      priority: 84,
      tick: () => {
        this.inventoryIntelligence.tick();
      },
    });

    this.scheduler.register({
      id: UPGRADE_JOB_ID,
      intervalMs: UPGRADE_INTERVAL_MS,
      priority: 83,
      tick: () => {
        this.upgrade.tick();
      },
    });

    this.scheduler.register({
      id: COMPOUND_JOB_ID,
      intervalMs: COMPOUND_INTERVAL_MS,
      priority: 82,
      tick: () => {
        this.compound.tick();
      },
    });

    this.scheduler.register({
      id: EXCHANGE_JOB_ID,
      intervalMs: EXCHANGE_INTERVAL_MS,
      priority: 81,
      tick: () => {
        this.exchange.tick();
      },
    });

    this.scheduler.register({
      id: CRAFT_JOB_ID,
      intervalMs: CRAFT_INTERVAL_MS,
      priority: 80,
      tick: () => {
        this.craft.tick();
      },
    });

    this.scheduler.register({
      id: EXPECTED_VALUE_JOB_ID,
      intervalMs: EXPECTED_VALUE_INTERVAL_MS,
      priority: 79,
      tick: () => {
        this.expectedValue.tick();
      },
    });

    this.scheduler.register({
      id: RISK_POLICY_JOB_ID,
      intervalMs: RISK_POLICY_INTERVAL_MS,
      priority: 78,
      tick: () => {
        this.riskPolicy.tick();
      },
    });

    this.scheduler.register({
      id: ECONOMY_PREBUFF_JOB_ID,
      intervalMs: ECONOMY_PREBUFF_INTERVAL_MS,
      priority: 77,
      tick: () => {
        this.economyPrebuff.tick();
      },
    });

    this.scheduler.register({
      id: ECONOMY_ARBITER_JOB_ID,
      intervalMs: ECONOMY_ARBITER_INTERVAL_MS,
      priority: 72,
      tick: () => {
        this.economyArbiter.tick();
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
      id: MARKET_INTELLIGENCE_JOB_ID,
      intervalMs: MARKET_INTELLIGENCE_INTERVAL_MS,
      priority: 10,
      runWhenPaused: true,
      tick: () => {
        this.marketIntelligence.tick();
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
            marketIntelligence: this.marketIntelligence.status(),
            inventoryIntelligence: this.inventoryIntelligence.status(),
            gearScoring: this.gearScoring.status(),
            futureGear: this.futureGear.status(),
            expectedValue: this.expectedValue.status(),
            riskPolicy: this.riskPolicy.status(),
            economyPrebuff: this.economyPrebuff.status(),
            economyPrebuffExecution: this.economyPrebuffExecution.status(),
            economyArbiter: this.economyArbiter.status(),
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
      marketIntelligence: this.marketIntelligence.status(),
      inventoryIntelligence: this.inventoryIntelligence.status(),
      gearScoring: this.gearScoring.status(),
      futureGear: this.futureGear.status(),
      upgrade: this.upgrade.status(),
      compound: this.compound.status(),
      exchange: this.exchange.status(),
      craft: this.craft.status(),
      expectedValue: this.expectedValue.status(),
      riskPolicy: this.riskPolicy.status(),
      economyPrebuff: this.economyPrebuff.status(),
      economyPrebuffExecution: this.economyPrebuffExecution.status(),
      economyArbiter: this.economyArbiter.status(),
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

  setMarketLocalHistory(observations: unknown): void {
    const normalized = Array.isArray(observations)
      ? observations
          .filter(
            (observation): observation is Record<string, unknown> =>
              !!observation &&
              typeof observation === "object" &&
              !Array.isArray(observation),
          )
          .slice(0, 250)
          .map(
            (observation) =>
              JSON.parse(
                JSON.stringify(observation),
              ) as MarketIntelligenceObservationInput,
          )
      : [];

    this.marketLocalHistory = normalized;
    this.eventBus.emit({
      module: "MarketIntelligenceController",
      type: "MARKET_INTELLIGENCE_LOCAL_HISTORY_APPLIED",
      why: "SUPERVISOR_LOCAL_HISTORY_SYNC",
      data: {
        samples: normalized.length,
        server: runtimeRealm(),
      },
    });
  }

  async runMarketIntelligenceSourceProbe(
    options: { requestId?: string; timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    if (this.marketIntelligenceSourceProbeRunning) {
      throw new Error("Market Intelligence source probe already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for Market Intelligence source probe");
    }
    if (runtimeState() !== "PAUSED") {
      throw new Error(
        "runtime must be PAUSED for Market Intelligence source probe",
      );
    }

    const requestId =
      options.requestId || `market-intelligence-source-probe-${Date.now()}`;
    const requestedTimeoutMs = Number(options.timeoutMs);
    const timeoutMs = Math.max(
      1000,
      Math.min(
        30000,
        Number.isFinite(requestedTimeoutMs) ? requestedTimeoutMs : 10000,
      ),
    );
    const module = "MarketIntelligenceLiveProbe";
    let projection = this.marketIntelligence.tick();
    let movementAction: ActionRecord | null = null;
    let snapshotAction: ActionRecord | null = null;
    let pontyNormalizedListings = this.game.ponty().length;

    const complete = (
      outcome: "PASS" | "WATCH" | "UNKNOWN",
      reason: string,
    ): Record<string, unknown> => {
      const result = {
        requestId,
        outcome,
        reason,
        projection,
        evidence: {
          pontySamples: projection.summary.ponty,
          pontySnapshotResponseReceived:
            snapshotAction?.evidence?.responseReceived === true,
          pontySnapshotItems: Number(snapshotAction?.evidence?.itemCount ?? 0),
          pontyNormalizedListings,
          observations: projection.summary.observations,
          aggregates: projection.summary.aggregates,
        },
        actions: {
          movement: movementAction,
          pontySnapshotRequest: snapshotAction,
        },
        scope: {
          readOnlyMarketProbe: true,
          runtimeState: runtimeState(),
          movementMutationAllowed: true,
          movementMutationDispatched: movementAction?.dispatchedAt !== undefined,
          socketReadRequestAllowed: true,
          socketReadRequestDispatched:
            snapshotAction?.dispatchedAt !== undefined,
          valueMutationAllowed: false,
          valueMutationDispatched: false,
          pontyBuyAllowed: false,
          tradeMutationAllowed: false,
          bankMutationAllowed: false,
          blindRetryAllowed: false,
        },
      };

      this.eventBus.emit({
        module,
        type: "MARKET_INTELLIGENCE_SOURCE_PROBE_COMPLETED",
        why: reason,
        correlationId: requestId,
        data: {
          result,
          marketIntelligence: projection,
        },
      });
      return result;
    };

    this.marketIntelligenceSourceProbeRunning = true;
    this.eventBus.emit({
      module,
      type: "MARKET_INTELLIGENCE_SOURCE_PROBE_STARTED",
      why: "PHASE16_SOURCE_COVERAGE",
      correlationId: requestId,
      data: {
        requestId,
        timeoutMs,
        marketIntelligence: projection,
        ...runtimeIdentity(),
      },
    });

    try {
      if (projection.summary.ponty > 0) {
        return complete(
          "PASS",
          "MARKET_INTELLIGENCE_PONTY_SOURCE_ALREADY_VISIBLE",
        );
      }

      movementAction = await this.movement.smart({
        owner: module,
        module,
        why: "PHASE16_PONTY_READ_PROBE",
        destination: "secondhands",
        correlationId: requestId,
      });

      if (movementAction.status === "UNKNOWN") {
        return complete(
          "UNKNOWN",
          "MARKET_INTELLIGENCE_PONTY_MOVEMENT_UNKNOWN",
        );
      }
      if (
        movementAction.status === "BLOCKED" ||
        movementAction.status === "REJECTED"
      ) {
        return complete(
          "WATCH",
          "MARKET_INTELLIGENCE_PONTY_MOVEMENT_UNAVAILABLE",
        );
      }

      snapshotAction = await this.actions.requestPontySnapshot({
        module,
        why: "PHASE16_PONTY_READ_REQUEST",
        correlationId: requestId,
      });

      if (snapshotAction.status === "UNKNOWN") {
        return complete(
          "UNKNOWN",
          "MARKET_INTELLIGENCE_PONTY_READ_REQUEST_UNKNOWN",
        );
      }
      if (
        snapshotAction.status === "BLOCKED" ||
        snapshotAction.status === "REJECTED"
      ) {
        return complete(
          "WATCH",
          "MARKET_INTELLIGENCE_PONTY_READ_REQUEST_UNAVAILABLE",
        );
      }

      const pontySnapshotItems = Number(snapshotAction.evidence?.itemCount ?? 0);
      pontyNormalizedListings = this.game.ponty().length;
      if (
        snapshotAction.status === "CONFIRMED" &&
        snapshotAction.evidence?.responseReceived === true &&
        pontySnapshotItems === 0
      ) {
        projection = this.marketIntelligence.tick();
        return complete(
          "WATCH",
          "MARKET_INTELLIGENCE_PONTY_SOURCE_EMPTY",
        );
      }

      const deadline = Date.now() + timeoutMs;
      do {
        projection = this.marketIntelligence.tick();
        if (projection.summary.ponty > 0) {
          return complete(
            "PASS",
            "MARKET_INTELLIGENCE_PONTY_SOURCE_OBSERVED",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      } while (Date.now() < deadline);

      projection = this.marketIntelligence.tick();
      return complete(
        "WATCH",
        "MARKET_INTELLIGENCE_PONTY_SOURCE_PENDING",
      );
    } catch (error) {
      this.eventBus.emit({
        module,
        type: "MARKET_INTELLIGENCE_SOURCE_PROBE_FAILED",
        why: "MARKET_INTELLIGENCE_SOURCE_PROBE_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          movementAction,
          snapshotAction,
          marketIntelligence: projection,
        },
      });
      throw error;
    } finally {
      this.marketIntelligenceSourceProbeRunning = false;
    }
  }

  async executeEconomyPrebuffNext(): Promise<Record<string, unknown>> {
    if (
      this.economyPrebuffExecutionRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning ||
      this.craftLiveTestRunning
    ) {
      throw new Error("mutation verification or coupled economy execution is running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for coupled Economy Prebuff execution");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error(
        "runtime must be RUNNING for coupled Economy Prebuff execution",
      );
    }

    this.economyPrebuffExecutionRunning = true;
    try {
      return (await this.economyPrebuffExecution.executeNext()) as unknown as Record<
        string,
        unknown
      >;
    } finally {
      this.economyPrebuffExecutionRunning = false;
    }
  }

  async executeUpgradeNext(): Promise<Record<string, unknown>> {
    if (
      this.economyPrebuffExecutionRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning
    ) {
      throw new Error("mutation verification is running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for upgrade execution");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for upgrade execution");
    }
    return this.upgrade.executeNext() as unknown as Record<string, unknown>;
  }

  async executeCompoundNext(): Promise<Record<string, unknown>> {
    if (
      this.economyPrebuffExecutionRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning
    ) {
      throw new Error("mutation verification is running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for compound execution");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for compound execution");
    }
    return this.compound.executeNext() as unknown as Record<string, unknown>;
  }

  async executeExchangeNext(): Promise<Record<string, unknown>> {
    if (
      this.economyPrebuffExecutionRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning
    ) {
      throw new Error("mutation verification is running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for exchange execution");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for exchange execution");
    }
    return this.exchange.executeNext() as unknown as Record<string, unknown>;
  }

  async executeCraftNext(): Promise<Record<string, unknown>> {
    if (
      this.economyPrebuffExecutionRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning
    ) {
      throw new Error("mutation verification is running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for craft execution");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for craft execution");
    }
    return this.craft.executeNext() as unknown as Record<string, unknown>;
  }

  runCraftMaterialPlan(
    recipe?: string | null,
  ): CraftMaterialPreparationPlan {
    if (
      this.craftPreflightRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.compoundLiveTestRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning
    ) {
      throw new Error("mutation verification already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for craft material planning");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for craft material planning");
    }

    this.craftPreflightRunning = true;
    try {
      const intelligence = this.inventoryIntelligence.tick();
      if (!["READY", "EMPTY"].includes(intelligence.state)) {
        throw new Error("inventory intelligence is not ready");
      }

      const gameData = this.game.gameData();
      const craftData =
        gameData.craft &&
        typeof gameData.craft === "object" &&
        !Array.isArray(gameData.craft)
          ? (gameData.craft as Record<string, unknown>)
          : {};
      const recipes = Object.keys(craftData).sort((left, right) =>
        left.localeCompare(right),
      );

      this.craft.setConfigOverride({
        craft: {
          enabled: true,
          allowedRecipes: recipes,
        },
      });
      const status = this.craft.tick();
      const characterSnapshot = this.game.character();
      const observerPosition =
        typeof characterSnapshot.map === "string" &&
        characterSnapshot.map.trim() &&
        typeof characterSnapshot.x === "number" &&
        Number.isFinite(characterSnapshot.x) &&
        typeof characterSnapshot.y === "number" &&
        Number.isFinite(characterSnapshot.y)
          ? {
              map: characterSnapshot.map.trim(),
              x: characterSnapshot.x,
              y: characterSnapshot.y,
            }
          : null;
      return planCraftMaterialPreparation(gameData, status, {
        recipe,
        observerPosition,
      });
    } finally {
      this.craft.clearConfigOverride();
      this.craft.tick();
      this.craftPreflightRunning = false;
    }
  }

  async runEconomyPrebuffExecutionLiveTest(
    options: EconomyPrebuffExecutionLiveTestOptions,
  ): Promise<EconomyPrebuffExecutionLiveTestResult> {
    if (
      this.economyPrebuffExecutionRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning ||
      this.craftLiveTestRunning
    ) {
      throw new Error("mutation verification already running");
    }
    if (!this.started || this.stopping) {
      throw new Error(
        "runtime is not ready for Economy Prebuff execution live test",
      );
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error(
        "runtime must be RUNNING for Economy Prebuff execution live test",
      );
    }

    this.economyPrebuffExecutionRunning = true;
    const requestId =
      options.requestId ||
      `economy-prebuff-execution-live-${Date.now()}`;
    const preflightOnly = options.preflightOnly === true;
    const suspended = {
      merchantAutonomy: this.scheduler.unregister(MERCHANT_AUTONOMY_JOB_ID),
      bankTravel: this.scheduler.unregister(BANK_TRAVEL_JOB_ID),
      merrit: this.scheduler.unregister(MERRIT_AUTONOMY_JOB_ID),
      fishing: this.scheduler.unregister(FISHING_AUTONOMY_JOB_ID),
      groupCombat: this.scheduler.unregister(GROUP_COMBAT_JOB_ID),
      classSkill: this.scheduler.unregister(CLASS_SKILL_JOB_ID),
      combat: this.scheduler.unregister(COMBAT_JOB_ID),
    };

    this.eventBus.emit({
      module: "EconomyPrebuffExecutionLiveTest",
      type: "ECONOMY_PREBUFF_EXECUTION_LIVE_TEST_STARTED",
      why: preflightOnly
        ? "EXPLICIT_READ_ONLY_COUPLED_PREBUFF_ECONOMY_PREFLIGHT"
        : "EXPLICIT_SINGLE_COUPLED_PREBUFF_ECONOMY_E2E",
      correlationId: requestId,
      data: {
        requestId,
        expectedKind: options.expectedKind,
        expectedName: options.expectedName,
        expectedSlots: [...options.expectedSlots],
        preflightOnly,
        irreversibleMutation: !preflightOnly,
        maxValueMutations: preflightOnly ? 0 : 1,
        blindRetryAllowed: false,
        suspended,
        ...runtimeIdentity(),
      },
    });

    let result: EconomyPrebuffExecutionLiveTestResult | null = null;
    let verificationPolicyApplied = false;
    let verificationPolicyConfigOverrideCleared = false;
    let verificationPolicyPlanningRestored = false;
    let prebuffVerificationPolicyApplied = false;
    let prebuffVerificationConfigOverrideCleared = false;
    let prebuffVerificationPlanningRestored = false;

    const refreshPlanning = () => {
      this.inventoryIntelligence.tick();
      this.upgrade.tick();
      this.compound.tick();
      this.expectedValue.tick();
      this.riskPolicy.tick();
      this.economyPrebuff.tick();
    };

    try {
      const intelligence = this.inventoryIntelligence.tick();
      const intelligenceBySlot = new Map(
        intelligence.entries.map((entry) => [entry.slot, entry]),
      );
      const inventory = this.game.inventory();
      const expectedSlots = [...options.expectedSlots].sort(
        (left, right) => left - right,
      );
      const targetItems = expectedSlots.map(
        (slot) => inventory.find((entry) => entry.slot === slot)?.item || null,
      );

      if (targetItems.some((item) => !item)) {
        throw new Error(
          "ECONOMY_PREBUFF_EXECUTION_VERIFICATION_TARGET_MISSING",
        );
      }

      for (let index = 0; index < expectedSlots.length; index += 1) {
        const slot = expectedSlots[index];
        const item = targetItems[index] as Record<string, unknown>;
        const entry = intelligenceBySlot.get(slot);
        if (
          item.name !== options.expectedName ||
          !entry ||
          entry.protected ||
          entry.protections.length > 0
        ) {
          throw new Error(
            "ECONOMY_PREBUFF_EXECUTION_VERIFICATION_TARGET_NOT_SAFE",
          );
        }
      }

      const levels = targetItems.map((item) => {
        const level = Number((item as Record<string, unknown>).level ?? 0);
        return Number.isInteger(level) && level >= 0 ? level : null;
      });
      if (levels.some((level) => level === null)) {
        throw new Error(
          "ECONOMY_PREBUFF_EXECUTION_VERIFICATION_LEVEL_UNKNOWN",
        );
      }
      if (
        options.expectedKind === "COMPOUND" &&
        new Set(levels).size !== 1
      ) {
        throw new Error(
          "ECONOMY_PREBUFF_EXECUTION_VERIFICATION_COMPOUND_LEVEL_MISMATCH",
        );
      }

      const grades = targetItems.map((item) =>
        this.game.itemGrade(item as Record<string, unknown>),
      );
      if (
        grades.some(
          (grade) =>
            grade === null ||
            !Number.isInteger(grade) ||
            Number(grade) < 0,
        ) ||
        (options.expectedKind === "COMPOUND" && new Set(grades).size !== 1)
      ) {
        throw new Error(
          "ECONOMY_PREBUFF_EXECUTION_VERIFICATION_GRADE_UNKNOWN",
        );
      }

      const level = levels[0] as number;
      const grade = grades[0] as number;
      const scrollName =
        options.expectedKind === "UPGRADE"
          ? `scroll${grade}`
          : `cscroll${grade}`;
      const scrollSafe = inventory.some((inventorySlot) => {
        const item = inventorySlot.item as Record<string, unknown> | null;
        const entry = intelligenceBySlot.get(inventorySlot.slot);
        return (
          item?.name === scrollName &&
          !!entry &&
          !entry.protected &&
          entry.protections.length === 0
        );
      });
      if (!scrollSafe) {
        throw new Error(
          "ECONOMY_PREBUFF_EXECUTION_VERIFICATION_SCROLL_MISSING",
        );
      }

      if (options.expectedKind === "UPGRADE") {
        this.upgrade.setConfigOverride({
          upgrade: {
            enabled: true,
            allowedSlots: expectedSlots,
            maxLevel: level + 1,
            scrollByCurrentLevel: {
              [level]: scrollName,
            },
          },
        });
      } else {
        this.compound.setConfigOverride({
          compound: {
            enabled: true,
            allowedSlots: expectedSlots,
            maxLevel: level + 1,
            scrollByGrade: {
              [grade]: scrollName,
            },
          },
        });
      }
      verificationPolicyApplied = true;

      this.economyPrebuff.setConfigOverride({
        economyPrebuff: {
          enabled: true,
          preferEnhanced: true,
        },
        classSkills: {
          merchant: {
            enabled: true,
            skills: {
              massproduction: {
                enabled: true,
              },
              massproductionpp: {
                enabled: true,
              },
            },
          },
        },
      });
      prebuffVerificationPolicyApplied = true;
      refreshPlanning();

      const runner = new EconomyPrebuffExecutionLiveTestRunner({
        game: this.game,
        refreshPlanning,
        riskPolicy: this.riskPolicy,
        prebuff: this.economyPrebuff,
        arbiter: this.economyArbiter,
        execution: this.economyPrebuffExecution,
        characterName: () => character.name,
      });
      result = await runner.run({
        ...options,
        requestId,
      });

      this.eventBus.emit({
        module: "EconomyPrebuffExecutionLiveTest",
        type:
          result.outcome === "PASS"
            ? "ECONOMY_PREBUFF_EXECUTION_LIVE_TEST_COMPLETED"
            : result.outcome === "UNKNOWN"
              ? "ECONOMY_PREBUFF_EXECUTION_LIVE_TEST_UNKNOWN"
              : "ECONOMY_PREBUFF_EXECUTION_LIVE_TEST_FAILED",
        why: result.reason,
        correlationId: requestId,
        ...(result.execution?.economyAction?.id && {
          actionId: result.execution.economyAction.id,
        }),
        data: {
          result,
          economyPrebuffExecution: this.economyPrebuffExecution.status(),
        },
      });
    } finally {
      if (verificationPolicyApplied) {
        if (options.expectedKind === "UPGRADE") {
          this.upgrade.clearConfigOverride();
        } else {
          this.compound.clearConfigOverride();
        }
        verificationPolicyConfigOverrideCleared = true;
      }

      if (prebuffVerificationPolicyApplied) {
        this.economyPrebuff.clearConfigOverride();
        prebuffVerificationConfigOverrideCleared = true;
      }

      if (verificationPolicyApplied || prebuffVerificationPolicyApplied) {
        refreshPlanning();
        verificationPolicyPlanningRestored = verificationPolicyApplied;
        prebuffVerificationPlanningRestored =
          prebuffVerificationPolicyApplied;
      }

      if (result) {
        result.cleanup.verificationPolicyConfigOverrideCleared =
          verificationPolicyConfigOverrideCleared;
        result.cleanup.verificationPolicyPlanningRestored =
          verificationPolicyPlanningRestored;
        result.cleanup.prebuffVerificationConfigOverrideCleared =
          prebuffVerificationConfigOverrideCleared;
        result.cleanup.prebuffVerificationPlanningRestored =
          prebuffVerificationPlanningRestored;
      }

      if (suspended.merchantAutonomy) this.registerMerchantAutonomyJob();
      if (suspended.bankTravel) this.registerBankTravelJob();
      if (suspended.merrit) this.registerMerritJob();
      if (suspended.fishing) this.registerFishingJob();
      if (suspended.groupCombat) this.registerGroupCombatJob();
      if (suspended.classSkill) this.registerClassSkillJob();
      if (suspended.combat) this.registerCombatJob();
      this.economyPrebuffExecutionRunning = false;
    }

    if (!result) {
      throw new Error(
        "Economy Prebuff execution live test returned no result",
      );
    }
    return result;
  }

  async runEconomyArbiterEnforcementProbe(
    options: { requestId?: string } = {},
  ): Promise<Record<string, unknown>> {
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for Economy Arbiter enforcement probe");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error(
        "runtime must be RUNNING for Economy Arbiter enforcement probe",
      );
    }

    const requestId =
      options.requestId || `economy-arbiter-enforcement-${Date.now()}`;
    const before = this.economyArbiter.tick();
    let enforced: ReturnType<EconomyArbiterController["status"]> | null = null;
    let action: Awaited<ReturnType<ActionBoundary["useSkill"]>> | null = null;
    let result: Record<string, unknown> | null = null;

    this.economyArbiter.setConfigOverride({
      economyArbiter: {
        enabled: true,
        enforcementEnabled: true,
      },
    });

    try {
      enforced = this.economyArbiter.tick();
      action = await this.actions.useSkill({
        skill: "massproduction",
        targetId: "__economy_arbiter_probe__",
        targetIds: ["__economy_arbiter_probe__"],
        module: "MerchantSkillController",
        why: "ECONOMY_ARBITER_ENFORCEMENT_PROBE",
        correlationId: requestId,
      });

      const metadata =
        action.metadata &&
        typeof action.metadata === "object" &&
        !Array.isArray(action.metadata)
          ? action.metadata
          : {};
      const rawPolicyBlock = metadata.policyBlock;
      const policyBlock =
        rawPolicyBlock &&
        typeof rawPolicyBlock === "object" &&
        !Array.isArray(rawPolicyBlock)
          ? (rawPolicyBlock as Record<string, unknown>)
          : {};
      const blockedByArbiter =
        action.status === "BLOCKED" &&
        policyBlock.lane === "ECONOMY_PREBUFF" &&
        typeof policyBlock.reason === "string" &&
        policyBlock.reason.startsWith("ECONOMY_ARBITER_");
      const mutationDispatched = action.dispatchedAt !== undefined;
      const passed =
        enforced.policy.enforcementEnabled === true &&
        blockedByArbiter &&
        !mutationDispatched;

      result = {
        requestId,
        outcome: passed ? "PASS" : "FAIL",
        reason: passed
          ? "ECONOMY_ARBITER_ENFORCEMENT_PROBE_CONFIRMED"
          : "ECONOMY_ARBITER_ENFORCEMENT_PROBE_INCOMPLETE",
        before,
        enforced,
        action,
        evidence: {
          enforcementEnabledObserved:
            enforced.policy.enforcementEnabled === true,
          requestedLane: "ECONOMY_PREBUFF",
          blockedByArbiter,
          policyBlock,
          actionBlocked: action.status === "BLOCKED",
          actionDispatched: mutationDispatched,
          secondaryPreflightGuardPresent: true,
        },
        scope: {
          readOnly: true,
          adventureLandMutationDispatched: mutationDispatched,
          movementMutationForced: false,
          combatMutationForced: false,
          valueMutationForced: false,
          equipmentMutationForced: false,
          economyArbiterMutationForced: false,
          upgradeMutationForced: false,
          compoundMutationForced: false,
          exchangeMutationForced: false,
          craftMutationForced: false,
          logisticsMutationForced: false,
          merchantMutationForced: false,
        },
      };
    } finally {
      this.economyArbiter.clearConfigOverride();
      const restored = this.economyArbiter.tick();
      const configRestored =
        restored.policy.enforcementEnabled ===
        before.policy.enforcementEnabled;

      result = {
        ...(result || {
          requestId,
          outcome: "FAIL",
          reason: "ECONOMY_ARBITER_ENFORCEMENT_PROBE_RUNTIME_ERROR",
          before,
          enforced,
          action,
        }),
        restored,
        cleanup: {
          configRestored,
        },
      };
    }

    return result;
  }

  async runCraftLiveTest(
    options: CraftLiveTestOptions,
  ): Promise<CraftLiveTestResult> {
    if (
      this.craftLiveTestRunning ||
      this.craftPreflightRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.compoundLiveTestRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning
    ) {
      throw new Error("mutation verification already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for craft live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for craft live test");
    }
    if (
      this.movementLiveTestRunning ||
      this.combatLiveTestRunning ||
      this.classSkillLiveTestRunning ||
      this.groupLiveTestRunning ||
      this.bankTravelLiveTestRunning ||
      this.merritLiveTestRunning ||
      this.fishingLiveTestRunning
    ) {
      throw new Error("movement activity is running during craft live test");
    }

    this.craftLiveTestRunning = true;
    const requestId = options.requestId || `craft-live-${Date.now()}`;
    const suspended = {
      merchantAutonomy: this.scheduler.unregister(MERCHANT_AUTONOMY_JOB_ID),
      bankTravel: this.scheduler.unregister(BANK_TRAVEL_JOB_ID),
      merrit: this.scheduler.unregister(MERRIT_AUTONOMY_JOB_ID),
      fishing: this.scheduler.unregister(FISHING_AUTONOMY_JOB_ID),
      groupCombat: this.scheduler.unregister(GROUP_COMBAT_JOB_ID),
      classSkill: this.scheduler.unregister(CLASS_SKILL_JOB_ID),
      combat: this.scheduler.unregister(COMBAT_JOB_ID),
    };

    this.eventBus.emit({
      module: "CraftLiveTest",
      type: "CRAFT_LIVE_TEST_STARTED",
      why: "EXPLICIT_SINGLE_CRAFT_E2E",
      correlationId: requestId,
      data: {
        requestId,
        recipe: options.recipe,
        itemSlots: [...options.itemSlots],
        irreversibleMutation: true,
        stationTravelAllowed: true,
        blindRetryAllowed: false,
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new CraftLiveTestRunner({
        game: this.game,
        inventoryIntelligence: this.inventoryIntelligence,
        craft: this.craft,
        movement: this.movement,
        characterName: () => character.name,
        runtimePreflight: () => {
          const runtimeCharacter = character as unknown as {
            map?: unknown;
            q?: {
              craft?: unknown;
            };
          };
          return {
            map:
              typeof runtimeCharacter.map === "string" &&
              runtimeCharacter.map.trim().length > 0
                ? runtimeCharacter.map
                : null,
            craftInProgress: !!runtimeCharacter.q?.craft,
          };
        },
      });

      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "CraftLiveTest",
        type:
          result.outcome === "PASS"
            ? "CRAFT_LIVE_TEST_COMPLETED"
            : "CRAFT_LIVE_TEST_FAILED",
        why: result.reason,
        correlationId: requestId,
        ...(result.craft?.lastAction?.id && {
          actionId: result.craft.lastAction.id,
        }),
        data: {
          result,
          craft: this.craft.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "CraftLiveTest",
        type: "CRAFT_LIVE_TEST_FAILED",
        why: "CRAFT_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          craft: this.craft.status(),
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
      this.craftLiveTestRunning = false;
    }
  }

  async runCraftPreflight(): Promise<CraftPreflightResult> {
    if (
      this.craftPreflightRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.compoundLiveTestRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning
    ) {
      throw new Error("mutation verification already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for craft preflight");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for craft preflight");
    }

    this.craftPreflightRunning = true;
    const requestId = `craft-preflight-${Date.now()}`;
    this.eventBus.emit({
      module: "CraftPreflight",
      type: "CRAFT_PREFLIGHT_STARTED",
      why: "READ_ONLY_CRAFT_SCAN",
      correlationId: requestId,
      data: {
        requestId,
        readOnly: true,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new CraftPreflightRunner({
        game: this.game,
        inventoryIntelligence: this.inventoryIntelligence,
        craft: this.craft,
        characterName: () => character.name,
      });
      const result = runner.run();
      this.eventBus.emit({
        module: "CraftPreflight",
        type:
          result.outcome === "PASS"
            ? "CRAFT_PREFLIGHT_COMPLETED"
            : "CRAFT_PREFLIGHT_FAILED",
        why: result.reason,
        correlationId: requestId,
        data: {
          requestId,
          result,
          craft: this.craft.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "CraftPreflight",
        type: "CRAFT_PREFLIGHT_FAILED",
        why: "CRAFT_PREFLIGHT_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          craft: this.craft.status(),
        },
      });
      throw error;
    } finally {
      this.craftPreflightRunning = false;
    }
  }

  async runExchangePreflight(): Promise<ExchangePreflightResult> {
    if (
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning
    ) {
      throw new Error("mutation verification already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for exchange preflight");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for exchange preflight");
    }

    this.exchangePreflightRunning = true;
    const requestId = `exchange-preflight-${Date.now()}`;
    this.eventBus.emit({
      module: "ExchangePreflight",
      type: "EXCHANGE_PREFLIGHT_STARTED",
      why: "READ_ONLY_EXCHANGE_SCAN",
      correlationId: requestId,
      data: {
        requestId,
        readOnly: true,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new ExchangePreflightRunner({
        game: this.game,
        inventoryIntelligence: this.inventoryIntelligence,
        exchange: this.exchange,
        characterName: () => character.name,
      });
      const result = runner.run();
      this.eventBus.emit({
        module: "ExchangePreflight",
        type:
          result.outcome === "PASS"
            ? "EXCHANGE_PREFLIGHT_COMPLETED"
            : "EXCHANGE_PREFLIGHT_FAILED",
        why: result.reason,
        correlationId: requestId,
        data: {
          requestId,
          result,
          exchange: this.exchange.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "ExchangePreflight",
        type: "EXCHANGE_PREFLIGHT_FAILED",
        why: "EXCHANGE_PREFLIGHT_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          exchange: this.exchange.status(),
        },
      });
      throw error;
    } finally {
      this.exchangePreflightRunning = false;
    }
  }

  async runExchangeLiveTest(
    options: ExchangeLiveTestOptions,
  ): Promise<ExchangeLiveTestResult> {
    if (
      this.exchangeLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.craftPreflightRunning ||
      this.compoundLiveTestRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning
    ) {
      throw new Error("mutation verification already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for exchange live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for exchange live test");
    }
    if (
      this.movementLiveTestRunning ||
      this.combatLiveTestRunning ||
      this.classSkillLiveTestRunning ||
      this.groupLiveTestRunning ||
      this.bankTravelLiveTestRunning ||
      this.merritLiveTestRunning ||
      this.fishingLiveTestRunning
    ) {
      throw new Error("movement activity is running during exchange live test");
    }

    this.exchangeLiveTestRunning = true;
    const requestId = options.requestId || `exchange-live-${Date.now()}`;
    const suspended = {
      merchantAutonomy: this.scheduler.unregister(MERCHANT_AUTONOMY_JOB_ID),
      bankTravel: this.scheduler.unregister(BANK_TRAVEL_JOB_ID),
      merrit: this.scheduler.unregister(MERRIT_AUTONOMY_JOB_ID),
      fishing: this.scheduler.unregister(FISHING_AUTONOMY_JOB_ID),
      groupCombat: this.scheduler.unregister(GROUP_COMBAT_JOB_ID),
      classSkill: this.scheduler.unregister(CLASS_SKILL_JOB_ID),
      combat: this.scheduler.unregister(COMBAT_JOB_ID),
    };

    this.eventBus.emit({
      module: "ExchangeLiveTest",
      type: "EXCHANGE_LIVE_TEST_STARTED",
      why: "EXPLICIT_SINGLE_EXCHANGE_E2E",
      correlationId: requestId,
      data: {
        requestId,
        itemName: options.itemName,
        itemSlot: options.itemSlot,
        irreversibleMutation: true,
        stationTravelAllowed: true,
        blindRetryAllowed: false,
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new ExchangeLiveTestRunner({
        game: this.game,
        inventoryIntelligence: this.inventoryIntelligence,
        exchange: this.exchange,
        movement: this.movement,
        characterName: () => character.name,
        runtimePreflight: () => {
          const runtimeCharacter = character as unknown as {
            map?: unknown;
            q?: {
              exchange?: unknown;
            };
          };
          return {
            map:
              typeof runtimeCharacter.map === "string" &&
              runtimeCharacter.map.trim().length > 0
                ? runtimeCharacter.map
                : null,
            exchangeInProgress: !!runtimeCharacter.q?.exchange,
          };
        },
      });

      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "ExchangeLiveTest",
        type:
          result.outcome === "PASS"
            ? "EXCHANGE_LIVE_TEST_COMPLETED"
            : "EXCHANGE_LIVE_TEST_FAILED",
        why: result.reason,
        correlationId: requestId,
        ...(result.exchange?.lastAction?.id && {
          actionId: result.exchange.lastAction.id,
        }),
        data: {
          result,
          exchange: this.exchange.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "ExchangeLiveTest",
        type: "EXCHANGE_LIVE_TEST_FAILED",
        why: "EXCHANGE_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          exchange: this.exchange.status(),
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
      this.exchangeLiveTestRunning = false;
    }
  }

  compoundGatherPlan(): CompoundGatherPlan {
    const runtimeCharacter = character as unknown as {
      q?: {
        compound?: unknown;
      };
    };
    return buildCompoundGatherPlan(this.game, {
      compoundInProgress: !!runtimeCharacter.q?.compound,
    });
  }

  async runCompoundLiveTest(
    options: CompoundLiveTestOptions,
  ): Promise<CompoundLiveTestResult> {
    if (
      this.compoundLiveTestRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning
    ) {
      throw new Error("mutation verification already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for compound live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for compound live test");
    }
    if (
      this.movementLiveTestRunning ||
      this.combatLiveTestRunning ||
      this.classSkillLiveTestRunning ||
      this.groupLiveTestRunning ||
      this.bankTravelLiveTestRunning ||
      this.merritLiveTestRunning ||
      this.fishingLiveTestRunning
    ) {
      throw new Error("movement activity is running during compound live test");
    }

    this.compoundLiveTestRunning = true;
    const requestId = options.requestId || `compound-live-${Date.now()}`;
    const suspended = {
      merchantAutonomy: this.scheduler.unregister(MERCHANT_AUTONOMY_JOB_ID),
      bankTravel: this.scheduler.unregister(BANK_TRAVEL_JOB_ID),
      merrit: this.scheduler.unregister(MERRIT_AUTONOMY_JOB_ID),
      fishing: this.scheduler.unregister(FISHING_AUTONOMY_JOB_ID),
      groupCombat: this.scheduler.unregister(GROUP_COMBAT_JOB_ID),
      classSkill: this.scheduler.unregister(CLASS_SKILL_JOB_ID),
      combat: this.scheduler.unregister(COMBAT_JOB_ID),
    };
    this.eventBus.emit({
      module: "CompoundLiveTest",
      type: "COMPOUND_LIVE_TEST_STARTED",
      why: "EXPLICIT_SINGLE_COMPOUND_E2E",
      correlationId: requestId,
      data: {
        requestId,
        itemName: options.itemName,
        itemSlots: options.itemSlots,
        scrollName: options.scrollName,
        irreversibleMutation: true,
        stationTravelAllowed: true,
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new CompoundLiveTestRunner({
        game: this.game,
        inventoryIntelligence: this.inventoryIntelligence,
        compound: this.compound,
        movement: this.movement,
        characterName: () => character.name,
        runtimePreflight: () => {
          const runtimeCharacter = character as unknown as {
            map?: unknown;
            q?: {
              compound?: unknown;
            };
          };
          return {
            map:
              typeof runtimeCharacter.map === "string" &&
              runtimeCharacter.map.trim().length > 0
                ? runtimeCharacter.map
                : null,
            compoundInProgress: !!runtimeCharacter.q?.compound,
          };
        },
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "CompoundLiveTest",
        type:
          result.outcome === "PASS"
            ? "COMPOUND_LIVE_TEST_COMPLETED"
            : "COMPOUND_LIVE_TEST_FAILED",
        why: result.reason,
        correlationId: requestId,
        ...(result.compound?.lastAction?.id && {
          actionId: result.compound.lastAction.id,
        }),
        data: {
          result,
          compound: this.compound.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "CompoundLiveTest",
        type: "COMPOUND_LIVE_TEST_FAILED",
        why: "COMPOUND_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          compound: this.compound.status(),
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
      this.compoundLiveTestRunning = false;
    }
  }

  async runUpgradePreflight(): Promise<UpgradePreflightResult> {
    if (
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning
    ) {
      throw new Error("mutation verification already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for upgrade preflight");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for upgrade preflight");
    }

    this.upgradePreflightRunning = true;
    const requestId = `upgrade-preflight-${Date.now()}`;
    this.eventBus.emit({
      module: "UpgradePreflight",
      type: "UPGRADE_PREFLIGHT_STARTED",
      why: "READ_ONLY_UPGRADE_INVENTORY_SCAN",
      correlationId: requestId,
      data: {
        requestId,
        readOnly: true,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new UpgradeLiveTestRunner({
        game: this.game,
        inventoryIntelligence: this.inventoryIntelligence,
        upgrade: this.upgrade,
        characterName: () => character.name,
      });
      const result = runner.preflight();
      this.eventBus.emit({
        module: "UpgradePreflight",
        type:
          result.outcome === "PASS"
            ? "UPGRADE_PREFLIGHT_COMPLETED"
            : "UPGRADE_PREFLIGHT_FAILED",
        why: result.reason,
        correlationId: requestId,
        data: {
          requestId,
          result,
        },
      });
      return result;
    } finally {
      this.upgradePreflightRunning = false;
    }
  }

  async runUpgradeLiveTest(
    options: UpgradeLiveTestOptions,
  ): Promise<UpgradeLiveTestResult> {
    if (
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning
    ) {
      throw new Error("mutation verification already running");
    }
    if (!this.started || this.stopping) {
      throw new Error("runtime is not ready for upgrade live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for upgrade live test");
    }

    this.upgradeLiveTestRunning = true;
    const requestId = options.requestId || `upgrade-live-${Date.now()}`;
    this.eventBus.emit({
      module: "UpgradeLiveTest",
      type: "UPGRADE_LIVE_TEST_STARTED",
      why: "EXPLICIT_SINGLE_UPGRADE_E2E",
      correlationId: requestId,
      data: {
        requestId,
        itemName: options.itemName,
        itemSlot: options.itemSlot ?? null,
        scrollName: options.scrollName,
        irreversibleMutation: true,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new UpgradeLiveTestRunner({
        game: this.game,
        inventoryIntelligence: this.inventoryIntelligence,
        upgrade: this.upgrade,
        characterName: () => character.name,
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "UpgradeLiveTest",
        type:
          result.outcome === "PASS"
            ? "UPGRADE_LIVE_TEST_COMPLETED"
            : "UPGRADE_LIVE_TEST_FAILED",
        why: result.reason,
        correlationId: requestId,
        ...(result.upgrade?.lastAction?.id && {
          actionId: result.upgrade.lastAction.id,
        }),
        data: {
          result,
          upgrade: this.upgrade.status(),
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "UpgradeLiveTest",
        type: "UPGRADE_LIVE_TEST_FAILED",
        why: "UPGRADE_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          upgrade: this.upgrade.status(),
        },
      });
      throw error;
    } finally {
      this.upgradeLiveTestRunning = false;
    }
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
        members: Array.isArray(options.members) ? [...options.members] : null,
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

  setAccountGearReservedSlots(slots: unknown): void {
    const normalized = Array.isArray(slots)
      ? slots.filter(
          (slot): slot is number =>
            Number.isInteger(slot) && Number(slot) >= 0,
        )
      : [];

    this.inventoryIntelligence.setDynamicReservedSlots(normalized);
    this.eventBus.emit({
      module: "AccountGearReservation",
      type: "ACCOUNT_GEAR_RESERVATIONS_APPLIED",
      why: "SUPERVISOR_ACCOUNT_GEAR_RESERVATION_SYNC",
      data: {
        reservedSlots: [...normalized],
      },
    });
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

  async runGoalAdapterPreflight(
    request: unknown,
    options: { requestId?: string } = {},
  ): Promise<GoalAdapterPreflightResult> {
    if (this.goalAdapterPreflightRunning) {
      throw new Error("Goal adapter preflight already running");
    }
    if (
      this.materialGatherTaskRunning ||
      this.characterTrainingTaskRunning ||
      this.characterGoldTaskRunning ||
      this.economyPrebuffExecutionRunning ||
      this.movementLiveTestRunning ||
      this.combatLiveTestRunning ||
      this.classSkillLiveTestRunning ||
      this.groupLiveTestRunning ||
      this.farmLiveTestRunning ||
      this.inventoryLiveTestRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning ||
      this.craftLiveTestRunning ||
      this.logisticsLiveTestRunning ||
      this.merchantLiveTestRunning ||
      this.bankTravelLiveTestRunning ||
      this.bankGoldLiveTestRunning ||
      this.npcTradingLiveTestRunning ||
      this.marketTradingLiveTestRunning ||
      this.marketIntelligenceSourceProbeRunning ||
      this.merritLiveTestRunning ||
      this.fishingLiveTestRunning ||
      this.logisticsClaimRunning
    ) {
      throw new Error("runtime is busy with another controlled activity");
    }
    if (!this.started || this.stopping || runtimeState() !== "RUNNING") {
      throw new Error("runtime is not ready for Goal adapter preflight");
    }

    this.goalAdapterPreflightRunning = true;
    const requestId =
      options.requestId || `goal-adapter-preflight-${Date.now()}`;
    this.eventBus.emit({
      module: "GoalAdapterPreflight",
      type: "GOAL_ADAPTER_PREFLIGHT_STARTED",
      why: "PHASE19_READ_ONLY_RUNTIME_PREFLIGHT",
      correlationId: requestId,
      data: {
        requestId,
        readOnly: true,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new GoalAdapterPreflightRunner({
        farmIntelligence: this.farmIntelligence,
        character: () => {
          const snapshot = this.game.character();
          return {
            name: snapshot.name,
            ctype: snapshot.ctype,
            level: snapshot.level,
            xp: snapshot.xp,
            gold: snapshot.gold,
          };
        },
        craftMaterialPlan: (recipe) => this.runCraftMaterialPlan(recipe),
      });
      const result = await runner.run(request, { requestId });

      this.eventBus.emit({
        module: "GoalAdapterPreflight",
        type: "GOAL_ADAPTER_PREFLIGHT_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          readOnly: true,
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "GoalAdapterPreflight",
        type: "GOAL_ADAPTER_PREFLIGHT_FAILED",
        why: "GOAL_ADAPTER_PREFLIGHT_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          readOnly: true,
        },
      });
      throw error;
    } finally {
      this.goalAdapterPreflightRunning = false;
    }
  }

  async runGoalAdapterDispatch(
    request: unknown,
    options: { requestId?: string; authorized?: boolean } = {},
  ): Promise<GoalAdapterDispatchResult> {
    if (this.goalAdapterDispatchRunning) {
      throw new Error("Goal adapter dispatch already running");
    }
    if (
      this.goalAdapterPreflightRunning ||
      this.materialGatherTaskRunning ||
      this.characterTrainingTaskRunning ||
      this.characterGoldTaskRunning ||
      this.economyPrebuffExecutionRunning ||
      this.movementLiveTestRunning ||
      this.combatLiveTestRunning ||
      this.classSkillLiveTestRunning ||
      this.groupLiveTestRunning ||
      this.farmLiveTestRunning ||
      this.inventoryLiveTestRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning ||
      this.craftLiveTestRunning ||
      this.logisticsLiveTestRunning ||
      this.merchantLiveTestRunning ||
      this.bankTravelLiveTestRunning ||
      this.bankGoldLiveTestRunning ||
      this.npcTradingLiveTestRunning ||
      this.marketTradingLiveTestRunning ||
      this.marketIntelligenceSourceProbeRunning ||
      this.merritLiveTestRunning ||
      this.fishingLiveTestRunning ||
      this.logisticsClaimRunning
    ) {
      throw new Error("runtime is busy with another controlled activity");
    }
    if (!this.started || this.stopping || runtimeState() !== "RUNNING") {
      throw new Error("runtime is not ready for Goal adapter dispatch");
    }

    this.goalAdapterDispatchRunning = true;
    const requestId =
      options.requestId || `goal-adapter-dispatch-${Date.now()}`;
    this.eventBus.emit({
      module: "GoalAdapterDispatch",
      type: "GOAL_ADAPTER_DISPATCH_STARTED",
      why: "PHASE19_EXPLICIT_ONE_SHOT_RUNTIME_DISPATCH",
      correlationId: requestId,
      data: {
        requestId,
        authorized: options.authorized === true,
        preflightRequired: true,
        maxExecutionInvocations: 1,
        blindRetryAllowed: false,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new GoalAdapterDispatchRunner({
        preflight: async (rawRequest, preflightOptions) => {
          const preflightRunner = new GoalAdapterPreflightRunner({
            farmIntelligence: this.farmIntelligence,
            character: () => {
              const snapshot = this.game.character();
              return {
                name: snapshot.name,
                ctype: snapshot.ctype,
                level: snapshot.level,
                xp: snapshot.xp,
                gold: snapshot.gold,
              };
            },
            craftMaterialPlan: (recipe) => this.runCraftMaterialPlan(recipe),
          });
          return preflightRunner.run(rawRequest, preflightOptions);
        },
        runMaterialGatherTask: (materialOptions) =>
          this.runMaterialGatherTask(materialOptions),
        runCharacterTrainingTask: (trainingOptions) =>
          this.runCharacterTrainingTask(trainingOptions),
        runCharacterGoldTask: (goldOptions) =>
          this.runCharacterGoldTask(goldOptions),
        craft: {
          setConfigOverride: (config) => this.craft.setConfigOverride(config),
          clearConfigOverride: () => this.craft.clearConfigOverride(),
          tick: () => this.craft.tick(),
          executeNext: () => this.craft.executeNext(),
        },
      });

      const result = await runner.run(request, {
        requestId,
        authorized: options.authorized === true,
      });
      this.eventBus.emit({
        module: "GoalAdapterDispatch",
        type: "GOAL_ADAPTER_DISPATCH_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          authorized: options.authorized === true,
          maxExecutionInvocations: 1,
          blindRetryAllowed: false,
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "GoalAdapterDispatch",
        type: "GOAL_ADAPTER_DISPATCH_FAILED",
        why: "GOAL_ADAPTER_DISPATCH_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          authorized: options.authorized === true,
          blindRetryAllowed: false,
        },
      });
      throw error;
    } finally {
      this.goalAdapterDispatchRunning = false;
    }
  }

  async runCharacterGoldTask(
    options: CharacterGoldTaskOptions,
  ): Promise<CharacterGoldTaskResult> {
    if (this.characterGoldTaskRunning) {
      throw new Error("character gold task already running");
    }
    if (
      this.materialGatherTaskRunning ||
      this.characterTrainingTaskRunning ||
      this.economyPrebuffExecutionRunning ||
      this.movementLiveTestRunning ||
      this.combatLiveTestRunning ||
      this.classSkillLiveTestRunning ||
      this.groupLiveTestRunning ||
      this.farmLiveTestRunning ||
      this.inventoryLiveTestRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning ||
      this.craftLiveTestRunning ||
      this.logisticsLiveTestRunning ||
      this.merchantLiveTestRunning ||
      this.bankTravelLiveTestRunning ||
      this.bankGoldLiveTestRunning ||
      this.npcTradingLiveTestRunning ||
      this.marketTradingLiveTestRunning ||
      this.marketIntelligenceSourceProbeRunning ||
      this.merritLiveTestRunning ||
      this.fishingLiveTestRunning ||
      this.logisticsClaimRunning
    ) {
      throw new Error("runtime is busy with another controlled activity");
    }
    if (!this.started || this.stopping || runtimeState() !== "RUNNING") {
      throw new Error("runtime is not ready for character gold task");
    }
    if (!this.scheduler.has(COMBAT_JOB_ID)) {
      throw new Error("character gold task requires active Combat scheduler");
    }

    this.characterGoldTaskRunning = true;
    const requestId = options.requestId || `character-gold-${Date.now()}`;
    const suspended = {
      groupCombat: this.scheduler.unregister(GROUP_COMBAT_JOB_ID),
      classSkill: this.scheduler.unregister(CLASS_SKILL_JOB_ID),
      combat: false,
    };

    this.eventBus.emit({
      module: "CharacterGoldTask",
      type: "CHARACTER_GOLD_TASK_STARTED",
      why: "PHASE19_BOUNDED_SCHEDULER_DRIVEN_GOLD",
      correlationId: requestId,
      data: {
        requestId,
        goalAmount: options.goalAmount,
        scope: options.scope,
        monsterType: options.monsterType,
        combatSchedulerRetained: true,
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new CharacterGoldTaskRunner({
        game: this.game,
        combat: this.combat,
        movement: this.movement,
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "CharacterGoldTask",
        type: "CHARACTER_GOLD_TASK_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          combatSchedulerRetained: true,
          suspended,
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "CharacterGoldTask",
        type: "CHARACTER_GOLD_TASK_FAILED",
        why: "CHARACTER_GOLD_TASK_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          combatSchedulerRetained: true,
          suspended,
        },
      });
      throw error;
    } finally {
      if (suspended.groupCombat) this.registerGroupCombatJob();
      if (suspended.classSkill) this.registerClassSkillJob();
      this.characterGoldTaskRunning = false;
    }
  }

  async runCharacterTrainingTask(
    options: CharacterTrainingTaskOptions,
  ): Promise<CharacterTrainingTaskResult> {
    if (this.characterTrainingTaskRunning) {
      throw new Error("character training task already running");
    }
    if (
      this.materialGatherTaskRunning ||
      this.characterGoldTaskRunning ||
      this.economyPrebuffExecutionRunning ||
      this.movementLiveTestRunning ||
      this.combatLiveTestRunning ||
      this.classSkillLiveTestRunning ||
      this.groupLiveTestRunning ||
      this.farmLiveTestRunning ||
      this.inventoryLiveTestRunning ||
      this.upgradeLiveTestRunning ||
      this.upgradePreflightRunning ||
      this.compoundLiveTestRunning ||
      this.exchangePreflightRunning ||
      this.exchangeLiveTestRunning ||
      this.craftPreflightRunning ||
      this.craftLiveTestRunning ||
      this.logisticsLiveTestRunning ||
      this.merchantLiveTestRunning ||
      this.bankTravelLiveTestRunning ||
      this.bankGoldLiveTestRunning ||
      this.npcTradingLiveTestRunning ||
      this.marketTradingLiveTestRunning ||
      this.marketIntelligenceSourceProbeRunning ||
      this.merritLiveTestRunning ||
      this.fishingLiveTestRunning ||
      this.logisticsClaimRunning
    ) {
      throw new Error("runtime is busy with another controlled activity");
    }
    if (!this.started || this.stopping || runtimeState() !== "RUNNING") {
      throw new Error("runtime is not ready for character training task");
    }
    if (!this.scheduler.has(COMBAT_JOB_ID)) {
      throw new Error("character training task requires active Combat scheduler");
    }

    this.characterTrainingTaskRunning = true;
    const requestId =
      options.requestId || `character-training-${Date.now()}`;
    const suspended = {
      groupCombat: this.scheduler.unregister(GROUP_COMBAT_JOB_ID),
      classSkill: this.scheduler.unregister(CLASS_SKILL_JOB_ID),
      combat: false,
    };

    this.eventBus.emit({
      module: "CharacterTrainingTask",
      type: "CHARACTER_TRAINING_TASK_STARTED",
      why: "PHASE19_BOUNDED_SCHEDULER_DRIVEN_TRAINING",
      correlationId: requestId,
      data: {
        requestId,
        targetLevel: options.targetLevel,
        monsterType: options.monsterType,
        combatSchedulerRetained: true,
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new CharacterTrainingTaskRunner({
        game: this.game,
        combat: this.combat,
        movement: this.movement,
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "CharacterTrainingTask",
        type: "CHARACTER_TRAINING_TASK_COMPLETED",
        why: result.reason,
        correlationId: requestId,
        data: {
          result,
          combatSchedulerRetained: true,
          suspended,
        },
      });
      return result;
    } catch (error) {
      this.eventBus.emit({
        module: "CharacterTrainingTask",
        type: "CHARACTER_TRAINING_TASK_FAILED",
        why: "CHARACTER_TRAINING_TASK_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          combatSchedulerRetained: true,
          suspended,
        },
      });
      throw error;
    } finally {
      if (suspended.groupCombat) this.registerGroupCombatJob();
      if (suspended.classSkill) this.registerClassSkillJob();
      this.characterTrainingTaskRunning = false;
    }
  }

  async runMaterialGatherTask(
    options: MaterialGatherTaskOptions,
  ): Promise<MaterialGatherTaskResult> {
    if (this.materialGatherTaskRunning) {
      throw new Error("material gathering task already running");
    }
    if (
      this.characterTrainingTaskRunning ||
      this.characterGoldTaskRunning ||
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

  async runMarketTradingLiveTest(
    options: MarketTradingLiveTestOptions = {},
  ): Promise<MarketTradingLiveTestResult> {
    if (this.marketTradingLiveTestRunning) {
      throw new Error("market trading live test already running");
    }
    if (
      this.npcTradingLiveTestRunning ||
      this.bankGoldLiveTestRunning ||
      this.bankTravelLiveTestRunning
    ) {
      throw new Error("bank or NPC trading live test is running");
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
      throw new Error("runtime is not ready for market trading live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for market trading live test");
    }

    const character = this.game.character();
    if (character.ctype !== "merchant") {
      throw new Error("market trading live test requires merchant character");
    }

    this.marketTradingLiveTestRunning = true;
    const requestId =
      options.requestId || `market-trading-live-${Date.now()}`;
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
      module: "MarketTradingLiveTest",
      type: "MARKET_TRADING_LIVE_TEST_STARTED",
      why: "PHASE13_MARKET_TRADING_E2E",
      correlationId: requestId,
      data: {
        requestId,
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new MarketTradingLiveTestRunner({
        marketTrading: this.marketTrading,
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "MarketTradingLiveTest",
        type: "MARKET_TRADING_LIVE_TEST_COMPLETED",
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
        module: "MarketTradingLiveTest",
        type: "MARKET_TRADING_LIVE_TEST_FAILED",
        why: "MARKET_TRADING_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
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
      this.marketTradingLiveTestRunning = false;
    }
  }

  async runNpcTradingLiveTest(
    options: NpcTradingLiveTestOptions = {},
  ): Promise<NpcTradingLiveTestResult> {
    if (this.npcTradingLiveTestRunning) {
      throw new Error("NPC trading live test already running");
    }
    if (this.bankGoldLiveTestRunning || this.bankTravelLiveTestRunning) {
      throw new Error("bank live test is running");
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
      throw new Error("runtime is not ready for NPC trading live test");
    }
    if (runtimeState() !== "RUNNING") {
      throw new Error("runtime must be RUNNING for NPC trading live test");
    }

    const character = this.game.character();
    if (character.ctype !== "merchant") {
      throw new Error("NPC trading live test requires merchant character");
    }

    this.npcTradingLiveTestRunning = true;
    const requestId = options.requestId || `npc-trading-live-${Date.now()}`;
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
      module: "NpcTradingLiveTest",
      type: "NPC_TRADING_LIVE_TEST_STARTED",
      why: "PHASE13_NPC_TRADING_E2E",
      correlationId: requestId,
      data: {
        requestId,
        suspended,
        ...runtimeIdentity(),
      },
    });

    try {
      const runner = new NpcTradingLiveTestRunner({
        npcTrading: this.npcTrading,
      });
      const result = await runner.run({
        ...options,
        requestId,
      });
      this.eventBus.emit({
        module: "NpcTradingLiveTest",
        type: "NPC_TRADING_LIVE_TEST_COMPLETED",
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
        module: "NpcTradingLiveTest",
        type: "NPC_TRADING_LIVE_TEST_FAILED",
        why: "NPC_TRADING_LIVE_TEST_RUNTIME_ERROR",
        correlationId: requestId,
        data: {
          error: error instanceof Error ? error.message : String(error),
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
      this.npcTradingLiveTestRunning = false;
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

  private handleGearScoringEvent(event: GearScoringEvent): void {
    this.eventBus.emit({
      module: "GearScoringController",
      type: event.type,
      why: event.reason,
      data: {
        gearScoring: event.status,
      },
    });
  }

  private handleFutureGearEvent(event: FutureGearEvent): void {
    this.eventBus.emit({
      module: "FutureGearController",
      type: event.type,
      why: event.reason,
      data: {
        futureGear: event.status,
      },
    });
  }

  private handleUpgradeEvent(event: UpgradeEvent): void {
    this.eventBus.emit({
      module: "UpgradeController",
      type: event.type,
      why: event.reason,
      ...(event.actionId && { actionId: event.actionId }),
      data: {
        upgrade: event.status,
      },
    });
  }

  private handleCompoundEvent(event: CompoundEvent): void {
    this.eventBus.emit({
      module: "CompoundController",
      type: event.type,
      why: event.reason,
      ...(event.actionId && { actionId: event.actionId }),
      data: {
        compound: event.status,
      },
    });
  }

  private handleExchangeEvent(event: ExchangeEvent): void {
    this.eventBus.emit({
      module: "ExchangeController",
      type: event.type,
      why: event.reason,
      ...(event.actionId && { actionId: event.actionId }),
      data: {
        exchange: event.status,
      },
    });
  }

  private handleCraftEvent(event: CraftEvent): void {
    this.eventBus.emit({
      module: "CraftController",
      type: event.type,
      why: event.reason,
      ...(event.actionId && { actionId: event.actionId }),
      data: {
        craft: event.status,
      },
    });
  }

  private handleExpectedValueEvent(event: ExpectedValueEvent): void {
    this.eventBus.emit({
      module: "ExpectedValueController",
      type: event.type,
      why: event.reason,
      data: {
        expectedValue: event.status,
      },
    });
  }

  private authorizeEconomyIntent(
    intent: ActionIntent,
  ): ActionAuthorizationDecision | null {
    const lane = economyArbiterLaneForIntent(intent);
    if (!lane) return null;

    const authorization = this.economyArbiter.authorize(lane);
    if (!authorization.enforced || authorization.allowed) return null;

    return {
      allowed: false,
      reason: authorization.reason,
      data: {
        lane,
        selectedLane: authorization.selectedLane,
        arbiterState: authorization.state,
      },
    };
  }

  private economyArbiterSignals(): Partial<
    Record<EconomyArbiterLane, EconomyArbiterSignal>
  > {
    const emergencyStop = !!parent.caracAL?.emergency_stop;
    const merrit = this.merchantMerrit.status();
    const riskPolicy = this.riskPolicy.status();
    const prebuff = this.economyPrebuff.status();
    const prebuffExecution = this.economyPrebuffExecution.status();
    const merchant = this.merchantAutonomy.status();
    const fishing = this.merchantFishing.status();
    const logisticsUnknown =
      this.lastLogisticsExecution?.outcome === "UNKNOWN" ||
      this.lastLogisticsExecution?.outcome === "DISPATCHED";
    const merritActive =
      merrit.enabled &&
      !["UNSUPPORTED_CLASS", "COOLDOWN"].includes(merrit.state);
    const economyUnknown =
      riskPolicy.state === "PARTIAL" || riskPolicy.summary.unknown > 0;
    const prebuffExecutionActive =
      prebuffExecution.activeLane === "ECONOMY_PREBUFF";
    const prebuffExecutionUnknown =
      prebuffExecution.state === "UNKNOWN_HOLD" &&
      prebuffExecution.unknownStage === "PREBUFF";
    const economyExecutionActive =
      prebuffExecution.activeLane === "ECONOMY";
    const economyExecutionUnknown =
      prebuffExecution.state === "UNKNOWN_HOLD" &&
      prebuffExecution.unknownStage === "ECONOMY";
    const economyActive =
      economyUnknown ||
      economyExecutionActive ||
      riskPolicy.selected !== null;
    const standActive =
      merchant.state === "READY" && merchant.merrit.activeListings > 0;
    const backgroundVisible =
      merchant.state === "READY" &&
      (merchant.giveaways.visibleCount > 0 ||
        merchant.wishlist.activeSlots.length > 0 ||
        merchant.ponty.npcPresent ||
        (merchant.gathering.fishing.skillPresent &&
          merchant.gathering.fishing.zones.length > 0) ||
        (merchant.gathering.mining.skillPresent &&
          merchant.gathering.mining.zones.length > 0));
    const fishingActive =
      fishing.enabled &&
      !["UNSUPPORTED_CLASS", "COMPLETE"].includes(fishing.state);

    return {
      SAFETY: {
        active: emergencyStop,
        blocked: emergencyStop,
        reason: emergencyStop ? "EMERGENCY_STOP_ACTIVE" : "SAFETY_CLEAR",
        data: {
          emergencyStop,
        },
      },
      MERRIT: {
        active: merritActive,
        blocked: merrit.state === "BLOCKED",
        unknown: merrit.state === "UNKNOWN",
        reason: merrit.reason,
        data: {
          state: merrit.state,
          roadmapStage: merrit.roadmapStage,
        },
      },
      CRITICAL_FARMER_LOGISTICS: {
        active: this.logisticsClaimRunning || logisticsUnknown,
        unknown: logisticsUnknown,
        reason: logisticsUnknown
          ? "LOGISTICS_OUTCOME_UNCERTAIN"
          : this.logisticsClaimRunning
            ? "LOGISTICS_EXECUTION_ACTIVE"
            : "LOGISTICS_IDLE",
        data: {
          busy: this.logisticsClaimRunning,
          lastOutcome: this.lastLogisticsExecution?.outcome ?? null,
          lastReason: this.lastLogisticsExecution?.reason ?? null,
        },
      },
      ECONOMY_PREBUFF: {
        active: prebuffExecutionActive,
        unknown: prebuffExecutionUnknown,
        reason: prebuffExecutionActive
          ? prebuffExecution.reason
          : prebuff.state === "READY"
            ? "ECONOMY_PREBUFF_READY_EXECUTION_DEFERRED"
            : prebuff.reason,
        data: {
          state: prebuff.state,
          demandKind: prebuff.demand.kind,
          demandName: prebuff.demand.name,
          selectedSkill: prebuff.selectedSkill,
          riskPolicyState: prebuff.demand.riskPolicyState,
          unknown: prebuff.demand.unknown,
          executionEnabled: prebuff.policy.executionEnabled,
          arbiterLaneActivationEnabled:
            prebuff.policy.arbiterLaneActivationEnabled,
          coupledExecutionState: prebuffExecution.state,
          coupledExecutionReason: prebuffExecution.reason,
          coupledExecutionCorrelationId: prebuffExecution.correlationId,
          coupledExecutionUnknownStage: prebuffExecution.unknownStage,
        },
      },
      ECONOMY: {
        active: economyActive,
        blocked: riskPolicy.state === "BLOCKED",
        unknown: economyUnknown || economyExecutionUnknown,
        reason: economyExecutionActive
          ? prebuffExecution.reason
          : riskPolicy.reason,
        data: {
          state: riskPolicy.state,
          selectedKind: riskPolicy.selected?.kind ?? null,
          selectedName: riskPolicy.selected?.name ?? null,
          unknown: riskPolicy.summary.unknown,
          coupledExecutionState: prebuffExecution.state,
          coupledExecutionReason: prebuffExecution.reason,
          coupledExecutionCorrelationId: prebuffExecution.correlationId,
          coupledExecutionUnknownStage: prebuffExecution.unknownStage,
        },
      },
      MERCHANT_STAND: {
        active: standActive,
        reason: standActive ? "MERCHANT_STAND_ACTIVE" : "MERCHANT_STAND_IDLE",
        data: {
          activeListings: merchant.merrit.activeListings,
        },
      },
      BACKGROUND: {
        active: backgroundVisible || fishingActive,
        blocked: fishing.state === "BLOCKED",
        unknown: fishing.state === "UNKNOWN",
        reason:
          fishing.state === "UNKNOWN"
            ? fishing.reason
            : backgroundVisible || fishingActive
              ? "MERCHANT_BACKGROUND_AVAILABLE"
              : "MERCHANT_BACKGROUND_IDLE",
        data: {
          fishingState: fishing.state,
          visibleGiveaways: merchant.giveaways.visibleCount,
          wishlistSlots: merchant.wishlist.activeSlots.length,
          pontyVisible: merchant.ponty.npcPresent,
        },
      },
    };
  }

  private handleEconomyPrebuffExecutionEvent(
    event: EconomyPrebuffExecutionEvent,
  ): void {
    this.eventBus.emit({
      module: "EconomyPrebuffExecutionController",
      type: event.type,
      why: event.reason,
      data: {
        economyPrebuffExecution: event.status,
      },
    });
  }

  private handleEconomyPrebuffEvent(event: EconomyPrebuffEvent): void {
    this.eventBus.emit({
      module: "EconomyPrebuffController",
      type: event.type,
      why: event.reason,
      data: {
        economyPrebuff: event.status,
      },
    });
  }

  private handleRiskPolicyEvent(event: RiskPolicyEvent): void {
    this.eventBus.emit({
      module: "RiskPolicyController",
      type: event.type,
      why: event.reason,
      data: {
        riskPolicy: event.status,
      },
    });
  }

  private handleEconomyArbiterEvent(event: EconomyArbiterEvent): void {
    this.eventBus.emit({
      module: "EconomyArbiterController",
      type: event.type,
      why: event.reason,
      data: {
        economyArbiter: event.status,
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

  private handleMarketIntelligenceEvent(
    event: MarketIntelligenceEvent,
  ): void {
    this.eventBus.emit({
      module: "MarketIntelligenceController",
      type: event.type,
      why: event.reason,
      data: {
        marketIntelligence: event.status,
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
