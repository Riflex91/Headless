# Phase 14.7 Craft Material Preparation Failure Evidence — 2026-10-03

Append-only evidence for the first controlled Craft material preparation attempt after PR #120.

This is **not** a Craft mutation attempt and **not** a Craft live PASS.

## Observed result

- character: `My_Merchant`
- worker: `My_Ranger1`
- requested recipe: `rod`
- outcome: `FAIL`
- reason: `CRAFT_PREPARATION_MERCHANT_POSITION_UNAVAILABLE`
- `readyForCraftIngredients=false`

The read-only material plan itself selected:

- recipe: `rod`
- existing item slot: `39`
- missing material: `spidersilk ×1`
- selected source: `spiderbl`
- source drop chance: `1`
- source HP: `4,500,000`

## Safety interpretation

The supervisor returned at the merchant-position guard before invoking the material worker. Therefore this attempt did not dispatch the worker movement/combat/loot/delivery path and did not dispatch Craft.

The old launcher verifier displayed `noCraftMutation=false`, `scopeRestricted=false`, and `cleanupComplete=false` because early failure returns did not yet carry the shared evidence/scope/cleanup objects. Those false verifier fields are evidence-shape incompleteness, not evidence that a Craft mutation occurred.

The selected `spiderbl` source also exposed a source-policy defect: the old score favored guaranteed drop chance strongly enough to choose a multi-million-HP instance boss over safer regular monsters.

## Required remediation

Before any new Craft material preparation attempt:

1. Carry the live runtime observer position into the material plan and prefer it over incomplete supervisor `live_state` coordinates.
2. Reject unsafe/non-regular monster sources before efficiency scoring.
3. Reject statistically excessive farming targets using explicit expected-kill and expected-HP budgets.
4. Make early FAIL evidence explicitly state that Craft mutation and blind retry were not allowed or dispatched.
5. Preserve the one-worker/no-blind-retry rule.

No retry of this failed preparation is authorized by this evidence.
