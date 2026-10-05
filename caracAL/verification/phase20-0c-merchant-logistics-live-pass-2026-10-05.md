# Phase 20.0c Merchant Parallel Autonomy + Logistics Live PASS — 2026-10-05

## Scope

Final live verification of the Phase 20.0c combined 3-Farmer + Merchant gate on the real Windows caracAL runtime.

This evidence is append-only. It records the successful live result on the merged Phase 20.0c implementation after the evidence-gate correction in PR #206 and the repeatability/readiness correction in PR #207.

## Repository baseline

```text
main: f1c667660cc502a5b2b77abfb10cc448954267ec
PR #206: Phase 20.0c live logistics evidence gate fix
PR #207: Phase 20.0c group-combat readiness/repeatability fix
```

## Live command

```powershell
Set-Location D:\caracAL
npm run test:live:phase20-logistics -- --verbose
```

## Test identity

```text
testId: phase20-integration-live-1791222555907-1
phase: 20.0c
outcome: PASS
reason: PHASE20_INTEGRATION_MERCHANT_LOGISTICS_CONFIRMED
```

## Live topology

```text
Merchant:
- My_Merchant

3-Farmer combat group:
- My_Ranger1 (leader)
- My_Mage (follower)
- My_Priest (follower)
```

All four selected characters were simultaneously ONLINE and RUNNING on the normal `bot/main.js` runtime.

```text
allOnline: true
allRunning: true
normalRuntimeAll: true
activeCharacters: 4
maxOnlineCharacters: 4
slotLimitValid: true
```

## Combat readiness and MP recovery

The controlled Phase 20.0c group probe enabled the existing CombatController MP-recovery path before requiring combat evidence.

Each farmer confirmed an MP potion action through the normal ActionBoundary path:

```text
My_Ranger1:
- potionRecoveryEnabled: true
- MP after recovery: 302 / 1065
- action: A-1791222564937-3
- status: CONFIRMED
- kind: MP_POTION

My_Mage:
- potionRecoveryEnabled: true
- MP after recovery: 313 / 1150
- action: A-1791222565212-3
- status: CONFIRMED
- kind: MP_POTION

My_Priest:
- potionRecoveryEnabled: true
- MP after recovery: 322 / 1150
- action: A-1791222562437-3
- status: CONFIRMED
- kind: MP_POTION
```

No uncertain recovery outcome remained:

```text
resourceRecoveryUnknown: false
```

## Initial 3-Farmer group-combat evidence

Party formation and group combat were confirmed with the leader-authoritative evidence mode.

```text
partyFormed: true
partyEvidenceMode: LEADER_AUTHORITATIVE
leaderPartyFormed: true
allRuntimeSnapshotsPartyFormed: true
leader: My_Ranger1
movementOwnerValid: true
resourceRecoveryUnknown: false
pass: true
```

Every farmer produced confirmed attacks while both followers produced group-focus evidence.

```text
confirmedAttackCount: 46

attackCounts:
- My_Ranger1: 21
- My_Mage: 12
- My_Priest: 13

focusObserved:
- My_Mage: true
- My_Priest: true

unknownAttackCount: 0
unknownMovementCount: 0
merchantOnlineDuringCombat: true
merchantNotInParty: true
```

## Parallel combat evidence during Merchant workflow

The farmers continued fighting while the Merchant performed the economy/logistics sequence.

```text
observed: true
partyFormed: true
partyEvidenceMode: LEADER_AUTHORITATIVE
leaderPartyFormed: true
allRuntimeSnapshotsPartyFormed: true
confirmedAttackCount: 79

attackCounts:
- My_Ranger1: 41
- My_Mage: 21
- My_Priest: 17

focusObserved:
- My_Mage: true
- My_Priest: true

unknownAttackCount: 0
unknownMovementCount: 0
movementOwnerValid: true
resourceRecoveryUnknown: false
pass: true
```

## Merchant independent economy activity before logistics

The Merchant first rendezvoused successfully, then the controlled integration probe exercised the existing BankTravelController while all three farmers remained active.

```text
initial rendezvous:
- destination: goo
- action: A-1791222605194-1
- status: CONFIRMED

autonomy-before BankTravel:
- state: READY
- reason: BANK_AVAILABLE
- destination: bank
- action: A-1791222606123-2
- status: CONFIRMED
```

The MerchantAutonomy projection itself remained disabled; the real independent economy activity proven by this slice is the existing BankTravelController action. No parallel replacement implementation was introduced.

## Logistics rendezvous

The Merchant returned from the bank to the farmer group through the existing MovementController path.

```text
destination: goo
action: A-1791222625282-3
status: CONFIRMED
```

## Real Farmer -> Merchant value mutation

The existing MerchantLogisticsPlanner produced exactly one READY claim.

```text
board total: 1
board ready: 1
GOLD_PICKUP claims: 1
merchantIndependent: true

claim:
- id: GOLD_PICKUP:My_Ranger1:My_Merchant::
- type: GOLD_PICKUP
- source farmer: My_Ranger1
- target merchant: My_Merchant
- amount: 1
- priority: 50
- reason: GOLD_ABOVE_RESERVE
- direction: My_Ranger1->My_Merchant
- status: READY

planner source gold: 1315718
keepGold: 1315717
pickupAbove: 1315717
```

Exactly one controlled production dispatch was performed.

```text
dispatchStarted: true
settled: true
dispatchCount: 1
```

The value mutation was confirmed by the existing LogisticsClaimExecutor / ActionBoundary path:

```text
requestId: logistics-claim-1791222650373-1
actionId: A-1791222650702-77
outcome: CONFIRMED
reason: GOLD_ABOVE_RESERVE
amount: 1
fulfilled: true

confirmed: true
claimReasonMatched: true
completionSuppressed: true
pingPongValid: true
noBlindRetry: true
```

No UNKNOWN or TIMEOUT logistics outcome was retried.

## Merchant independent economy activity after logistics

After the logistics interaction, the Merchant resumed BankTravel with a distinct confirmed action.

```text
autonomy-after:
- state: READY
- reason: BANK_AVAILABLE
- destination: bank
- action: A-1791222651573-4
- status: CONFIRMED

autonomousBeforeValid: true
logisticsRendezvousValid: true
autonomousAfterValid: true
merchantOnlineAfter: true
merchantNotInParty: true
unknownMovementCount: 0
processExitCount: 0
reconnectCount: 0
```

The post-logistics BankTravel action ID differs from the pre-logistics action ID, confirming a new independent Merchant action after the value mutation.

## Mutation scope

```text
normalRuntime: true
lifecycleOnlyProbe: false
lifecycleMutationDispatched: true
gameplayMutationForced: true
valueMutationForced: true
automaticLogisticsDispatchSuppressed: true
controlledLogisticsDispatchEnabled: true
combatEvidenceRequired: true
logisticsEvidenceRequired: true
merchantAutonomyEvidenceRequired: true
```

Automatic logistics dispatch remained suppressed outside the single controlled dispatch window.

## Cleanup and restoration

All test-specific state was cleared and the prior runtime state was restored.

```text
runtimeStateRestored: true
groupProbeCleared: true
merchantProbeCleared: true
logisticsOverridesRestored: true

originallyRunning:
- My_Ranger1

restoredRunning:
- My_Ranger1
```

Merchant cleanup had no uncertain result:

```text
merchant cleanup ok: true
unknownCleanup: false
movementCancelStatus: null
```

The group probe was cleared for all three farmers; party-leave cleanup was confirmed where applicable.

## Final evaluator gates

```text
identityValid: true
runtimeValid: true
groupValid: true
merchantValid: true
logisticsValid: true
scopeValid: true
cleanupValid: true
```

## Verification conclusions

- Exactly three account-owned combat characters plus My_Merchant ran concurrently.
- All four used the normal `bot/main.js` runtime.
- The max-four-character slot boundary held.
- 20.0c recovered low farmer MP through the existing CombatController/ActionBoundary path.
- No MP-recovery outcome was UNKNOWN.
- The configured three-character party formed.
- Every farmer produced confirmed attacks and both followers produced focus evidence.
- The farmers continued combat throughout the Merchant workflow.
- My_Merchant remained outside the combat party.
- The Merchant performed a confirmed BankTravel economy action before logistics.
- The Merchant returned to the farmer group through the existing MovementController.
- MerchantLogisticsPlanner produced exactly one real GOLD_PICKUP claim.
- Exactly one controlled logistics dispatch was performed.
- A 1-gold Farmer -> Merchant transfer was CONFIRMED through the existing LogisticsClaimExecutor / ActionBoundary path.
- Claim reason matching and recent-completion suppression were confirmed.
- No blind retry occurred.
- The ping-pong guard remained valid.
- The Merchant resumed independent BankTravel after logistics with a distinct confirmed action.
- No Merchant movement UNKNOWN occurred.
- No process exit or reconnect storm occurred.
- Group, Merchant, logistics overrides, and runtime state were restored cleanly.
- All final evaluator gates passed.

## Phase status

Phase 20.0c is live-verified and complete.

Phase 20.0d — the complete combined one-click live gate — is now unblocked.

Do not begin Phase 20.1 until Phase 20.0d is implemented and live-verified.
