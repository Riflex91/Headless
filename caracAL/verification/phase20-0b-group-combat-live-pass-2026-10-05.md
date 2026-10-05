# Phase 20.0b 3-Farmer Group Combat Live PASS — 2026-10-05

## Scope

Final live verification of the Phase 20.0b integrated 3-Farmer group-combat gate on the real Windows caracAL runtime.

This evidence is append-only. It records the live result of the merged Phase 20.0b implementation from PR #203.

## Repository baseline

```text
main: 1523da3a62107df90b827dd93d117138254f4fdf
PR #203: Phase 20.0b: add real 3-farmer group combat gate
```

## Live command

```powershell
Set-Location D:\caracAL
npm run test:live:phase20-group -- --verbose
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

## Result

```text
phase: 20.0b
outcome: PASS
reason: PHASE20_INTEGRATION_GROUP_COMBAT_CONFIRMED

identityValid: true
runtimeValid: true
groupValid: true
scopeValid: true
cleanupValid: true
```

## Group-combat evidence

The three combat characters formed the configured party successfully.

```text
partyFormed: true
leader: My_Ranger1
missingMembers: []
```

The live gate observed shared group focus and confirmed attacks through the existing GroupCombatController / CombatController / ActionBoundary path.

```text
confirmedAttackCount: 73

attackCounts:
- My_Ranger1: 37
- My_Mage: 13
- My_Priest: 23

focusObserved:
- My_Mage: true
- My_Priest: true
```

No uncertain combat or movement outcomes were observed:

```text
unknownAttackCount: 0
unknownMovementCount: 0
movementOwnerValid: true
```

The Merchant remained online during the combat portion:

```text
merchantOnlineDuringCombat: true
```

## Mutation scope

The test intentionally exercised gameplay combat/party behavior but did not claim any Merchant/Logistics value mutation.

```text
normalRuntime: true
lifecycleOnlyProbe: false
lifecycleMutationDispatched: true
gameplayMutationForced: true
valueMutationForced: false
automaticLogisticsDispatchSuppressed: true
combatEvidenceRequired: true
logisticsEvidenceRequired: false
```

## Cleanup and restoration

The explicit group-combat probe was removed successfully.

Each combat character confirmed party-leave cleanup, the probe was cleared, and the previous runtime state was restored.

```text
groupProbeCleared: true
runtimeStateRestored: true

originallyRunning:
- My_Ranger1

restoredRunning:
- My_Ranger1
```

No UNKNOWN cleanup result remained.

## Verification conclusions

- Exactly three account-owned combat characters plus My_Merchant ran concurrently.
- All four used the normal `bot/main.js` runtime.
- The max-four-character slot boundary held.
- A real three-character party formed successfully.
- Leader/follower GroupCombat coordination was observed.
- 73 real ATTACK actions were confirmed through the existing runtime stack.
- Every farmer produced at least one confirmed ATTACK.
- Follower group-focus evidence was observed.
- No ATTACK outcome was UNKNOWN.
- No movement outcome was UNKNOWN.
- Movement ownership remained valid.
- My_Merchant remained online while the three farmers fought.
- Merchant/Logistics value mutation stayed suppressed in this slice.
- Group-combat overrides were cleared.
- Runtime state was restored successfully.

## Phase status

Phase 20.0b is live-verified and complete.

Phase 20.0c — Merchant parallel autonomy plus a real Farmer↔Merchant Logistics interaction — is now unblocked.

The full Phase 20.0 gate is not complete until Phase 20.0c and the final combined 20.0d gate pass.
