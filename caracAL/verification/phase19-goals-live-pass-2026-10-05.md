# Phase 19 Goals Live PASS — 2026-10-05

## Scope

Final live verification of Phase 19 Goals using the guarded explicit one-shot Goal dispatch path on the real Windows caracAL runtime.

This evidence is append-only. It records the final user-observed PASS, the verified gameplay/value mutation, the target-state transition from 24 to 25 `cake`, and the restoration of the default-OFF Goal execution safety state.

## Repository baseline

```text
main: e441275bd6a62a4577e92ec13878fe6bcf594458
PR #199: Phase 19.14 bounded gold accumulation runtime path
```

## Live Goal identity

```text
Goal ID: 0-phase19-live-craft-20261004223221
Task ID: 0-phase19-live-craft-20261004223221:2
Goal type: CRAFT_ITEM
Task kind: PLAN_CRAFT
Character: My_Merchant
Target item: cake
Target quantity: 25
Observed quantity before dispatch: 24
Runtime worker: My_Merchant
```

## Runtime correction before final gate

The live failure investigation found that the local Merchant TYPECODE mapping still pointed to the legacy demo runtime:

```text
caracAL/examples/crabs_with_tophats.js
```

That script directly attacked/moved toward crabs and bypassed the Bot V5 controller ownership model. The local runtime mapping was corrected to:

```text
bot/main.js
```

After restart, `My_Merchant` was ONLINE, connected, using `bot/main.js`, and idle near Leo.

An earlier armed attempt had been rejected before mutation with:

```text
HTTP 409
GOAL_ADAPTER_PREFLIGHT_RUNTIME_NOT_READY
runtimeOutcome: null
mutationPathInvoked: false
dispatchPendingAfter: 0
unknownHoldActiveAfter: false
```

No blind retry was performed. The runtime/configuration issue was corrected first, then the read-only gates were rerun before one new explicit armed attempt.

## Craft preflight

The final read-only Craft preflight confirmed:

```text
Outcome: PASS
Reason: CRAFT_PREFLIGHT_E2E_CONFIRMED
Character: My_Merchant
Craft state: READY
Craft reason: CRAFT_CANDIDATE_READY
Execution mode: EXPLICIT_ONE_SHOT
Selected recipe: cake
Cost: 5
Requirement: 10 whiteegg
Item slot: 7
Craftsman: Leo
Runtime map: main
Distance to Leo: 20.08882555101327
Travel required: false
Ready for Craft: true
Mutation dispatched: no
```

## Read-only Goal gate

Immediately before the armed dispatch:

```text
Outcome: PASS
Reason: GOAL_DISPATCH_LIVE_READ_ONLY_CONFIRMED
Execution enabled: true
Execution state: READY
Execution reason: GOAL_EXECUTION_ADAPTER_DISPATCH_READY
Dispatch allowed: true
Goal ID: 0-phase19-live-craft-20261004223221
Task ID: 0-phase19-live-craft-20261004223221:2
Kind: PLAN_CRAFT
Adapter state: READY
Adapter reason: GOAL_ADAPTER_CRAFT_REQUEST_READY
Target character: My_Merchant
Dispatch pending: 0
Unknown hold active: false
```

The direct read-only adapter preflight also passed the internal runtime-readiness guard:

```text
HTTP: 200
ok: true
Outcome: PASS
Reason: GOAL_ADAPTER_PREFLIGHT_CRAFT_CONFIRMED
Character: My_Merchant
Read-only: true
Retry used: false
Lifecycle mutation dispatched: false
Gameplay mutation dispatched: false
Value mutation dispatched: false
```

## Armed one-shot command

```powershell
Set-Location D:\caracAL
$env:CARACAL_GOAL_DISPATCH_ARMED="1"
try {
  npm run test:live:goal-dispatch -- --armed --verbose
}
finally {
  Remove-Item Env:CARACAL_GOAL_DISPATCH_ARMED -ErrorAction SilentlyContinue
}
```

## Armed one-shot observed result

```text
Outcome: PASS
Reason: GOAL_DISPATCH_LIVE_E2E_CONFIRMED
Goal ID: 0-phase19-live-craft-20261004223221
Task ID: 0-phase19-live-craft-20261004223221:2
Kind: PLAN_CRAFT
Target character: My_Merchant
Runtime outcome: PASS
Runtime reason: GOAL_ADAPTER_DISPATCH_CRAFT_CONFIRMED
HTTP status: 200
Response OK: true
Identity valid: true
One-shot valid: true
Terminal outcome: true
Unknown outcome: false
Hold valid: true
Preflight verified: true
Retry used: false
Max execution invocations: 1
Mutation path invoked: true
Lifecycle mutation dispatched: false
Dispatch pending after: 0
Unknown hold active after: false
```

The runtime action ledger confirmed the actual Craft mutation:

```text
Action status: CONFIRMED
Why: CRAFT_POLICY_SELECTED
Recipe: cake
Item slot: 7
```

## Post-condition

The live inventory after dispatch confirmed:

```text
cake before: 24
cake after: 25
target: 25
target reached: yes
```

After the target was reached, the Goal pipeline no longer produced a ready handoff:

```text
Goal handoff state: EMPTY
Goal handoff reason: GOAL_HANDOFF_NO_READY_GOAL
Ready goals: 0
Goal execution state: STABLE
Goal execution reason: GOAL_EXECUTION_NO_READY_HANDOFF
Dispatch allowed: false
Dispatch pending: 0
Unknown hold: none
```

The persisted Goal remains present in the Goal store, but no further executable handoff is produced after the target condition is satisfied.

## Default-OFF restoration

After the live PASS, local Goal execution was restored to the normal safe default:

```text
goal_execution.enabled: false
Goal execution state: DISABLED
Goal execution reason: GOAL_EXECUTION_DISABLED
Dispatch pending: 0
Unknown hold: null
```

The final read-only live verifier confirmed the safe state:

```text
Outcome: PASS
Reason: GOAL_DISPATCH_LIVE_READ_ONLY_CONFIRMED
Execution enabled: false
Execution state: DISABLED
Execution reason: GOAL_EXECUTION_DISABLED
Dispatch allowed: false
Adapter state: EMPTY
Adapter reason: GOAL_ADAPTER_EXECUTION_DISABLED
Dispatch pending: 0
Unknown hold active: false
Dispatch requested: false
Gameplay mutation dispatched: false
Value mutation dispatched: false
Lifecycle mutation dispatched: false
```

## Verification conclusions

- Phase 19 Goal planning, handoff, guarded execution, preflight and one-shot dispatch were exercised end-to-end on the real live runtime.
- The exact Goal/task identity remained stable through the final dispatch.
- The supervisor preflight verified the already-running runtime before mutation.
- Exactly one runtime execution invocation was permitted and observed.
- The Craft mutation executed through the existing CraftController / ActionBoundary path.
- The action was confirmed rather than UNKNOWN.
- The target item count changed from 24 to 25 and satisfied the Goal target.
- No blind retry was used.
- No persistent UNKNOWN hold remained.
- No lifecycle mutation was dispatched by the Goal execution.
- Automatic Goal reconcile remained disabled.
- After the Goal was satisfied, no further ready handoff was produced.
- Goal execution was explicitly returned to default-OFF and verified read-only.

## Phase 19 status

Phase 19 Goals may therefore be treated as complete.

Phase 20 Encounter Intelligence / boss preparation remains the next ROADMAP phase.
