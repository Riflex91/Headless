# Phase 16 Market Intelligence Ponty Correlated Snapshot WATCH — 2026-10-04

## Scope

Read-only live verification of Phase 16 Market Intelligence after correlated Ponty snapshot ingestion was added.

This evidence records the actual user-observed result. It does not claim Ponty observation coverage that was not achieved.

## Command

```powershell
Set-Location D:\caracAL
npm run test:live:market-intelligence -- My_Merchant
```

## Observed result

```text
Market Intelligence Live E2E
Outcome: WATCH
Reason: MARKET_INTELLIGENCE_LIVE_SOURCE_COVERAGE_PENDING
Character: My_Merchant
Realm: SR_EUII
State: READY
Observations: 23
Aggregates: 12
Sources: LIVE_VISIBLE=18 | PONTY=0 | LOCAL_HISTORY=5
Metrics valid: yes
Market read-only: yes
Dashboard GET only: no
Movement probe dispatched: yes
Ponty read request dispatched: yes
Value mutation dispatched: no
Bootstrap runtime: PAUSED
Ponty snapshot response: yes
Ponty snapshot items: 208
WATCH sources: PONTY
```

## Verification conclusions

- Market Intelligence reached `READY`.
- `LIVE_VISIBLE` was observed with 18 samples.
- `LOCAL_HISTORY` was observed with 5 samples.
- Metrics were valid.
- The dedicated PAUSED Ponty probe dispatched movement and one read-only request.
- The correlated Ponty server response was received.
- The response contained 208 raw Ponty items.
- No value mutation was dispatched.
- Despite the valid response, `GameAdapter.ponty()` produced no usable Ponty samples in this run.
- Therefore the run correctly remained `WATCH` rather than inventing a PASS.

## Follow-up

PR #167 subsequently updates Ponty normalization to prefer Adventure Land's public `item_value(item)` runtime API, consume current `G.multipliers.secondhands_*` pricing factors, and expose the normalized listing count.

A new live run is required before any Ponty or complete Phase 16 source-coverage PASS claim.
