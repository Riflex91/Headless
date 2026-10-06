# Phase 20.0d combined live gate – FAIL (2026-10-06)

Test ID: `phase20-integration-live-1791300485704-1`

Outcome: `FAIL`

Reason: `PHASE20_INTEGRATION_GROUP_COMBAT_EVIDENCE_INCOMPLETE`

## Confirmed evidence

- Selected runtime: `My_Ranger1`, `My_Mage`, `My_Priest`, `My_Merchant`.
- All four were ONLINE and RUNNING with normal `bot/main.js` runtimes.
- Active character count was exactly 4 and the slot limit was valid.
- Party formation succeeded in leader-authoritative mode.
- Combat was active for all three farmers with 145 confirmed attacks total:
  - Ranger: 62
  - Mage: 45
  - Priest: 38
- Unknown attacks: 0.
- Unknown movement commands: 0.
- Movement ownership remained valid.
- Merchant remained online and outside the combat party.
- Cleanup restored the pre-test runtime state and cleared the probes.

## Blocking evidence

Follower GroupCombat focus evidence was incomplete:

- `My_Mage`: `focusObserved=false`
- `My_Priest`: `focusObserved=true`

At the final capture the leader and both followers were nevertheless targeting the same live Goo (`1572538`) in CombatController state, while follower GroupCombat snapshots still showed `focusTargetId=null`.

## Diagnosis

The leader-focus relay introduced before this run stores a relayed target hint on followers, but the hint is consumed only by a later GroupCombat scheduler tick. With 100 HP Goo targets, the target can disappear before a follower tick validates and commits the hint. The result is nondeterministic explicit GroupCombat focus evidence even though combat itself continues normally.

## Required follow-up

Keep the Phase 20.0d acceptance gate unchanged. Fix the follower focus relay/application path so a valid relayed leader target is consumed deterministically by the follower runtime, then rerun:

`npm run test:live:phase20-combined -- --verbose`

Required final result remains:

- `Outcome: PASS`
- `Reason: PHASE20_INTEGRATION_COMBINED_CONFIRMED`
