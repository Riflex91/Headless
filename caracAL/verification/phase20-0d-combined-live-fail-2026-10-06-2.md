# Phase 20.0d combined live gate – second focus failure (2026-10-06)

Test ID: `phase20-integration-live-1791302850088-1`

Outcome: `FAIL`

Reason: `PHASE20_INTEGRATION_GROUP_COMBAT_EVIDENCE_INCOMPLETE`

## Confirmed runtime evidence

- Selected runtime: `My_Ranger1`, `My_Mage`, `My_Priest`, `My_Merchant`.
- All four characters were ONLINE and RUNNING under normal `bot/main.js` runtime.
- Active character count: 4 of 4; slot limit valid.
- Group probe applied successfully to leader and both followers.
- Party formation succeeded in leader-authoritative mode.
- 156 confirmed attacks:
  - Ranger: 65
  - Mage: 46
  - Priest: 45
- Unknown attacks: 0.
- Unknown movement commands: 0.
- Movement ownership valid.
- Resource recovery did not enter UNKNOWN.
- Merchant remained online and outside the combat party.
- Cleanup restored runtime state and cleared probes.

## Blocking evidence

Follower focus evidence was asymmetric:

- `My_Mage`: `focusObserved=true`
- `My_Priest`: `focusObserved=false`

The final follower GroupCombat snapshots were stale relative to their current CombatController snapshots:

- Mage GroupCombat timestamp: `1791302933543`
- Priest GroupCombat timestamp: `1791302865742`
- Mage current Combat timestamp: `1791302978977`
- Priest current Combat timestamp: `1791302978711`

Both followers continued attacking live Goo targets while their final GroupCombat snapshots showed `focusTargetId=null`.

## Diagnosis

The immediate follower focus application introduced on PR #214 improved the result (Mage now produced explicit focus evidence), but a one-shot coordinator relay still permits per-recipient loss or timing gaps. The relay was only sent on the leader's `GROUP_COMBAT_FOCUS_CHANGED` event.

The production relay is therefore made redundant: every accepted leader `GroupCombatController` event carrying leader status re-sends the current focus to connected configured followers. Follower application remains idempotent, stale same-leader timestamps remain rejected, and the normal GroupCombat tick continues to validate/clear the target.

The Phase 20.0d acceptance gate is unchanged.
