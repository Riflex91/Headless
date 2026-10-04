# Phase 16 Market Intelligence Ponty Source Probe WATCH — 2026-10-04

## Scope

Read-only live verification of Phase 16 Market Intelligence after the PAUSED Ponty source-probe integration.

This evidence records the actual user-observed result. It does not claim Ponty coverage that was not observed.

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
Observations: 27
Aggregates: 16
Sources: LIVE_VISIBLE=22 | PONTY=0 | LOCAL_HISTORY=5
Metrics valid: yes
Market read-only: yes
Dashboard GET only: no
Movement probe dispatched: yes
Ponty read request dispatched: yes
Value mutation dispatched: no
Bootstrap runtime: PAUSED
WATCH sources: PONTY
```

## Verification conclusions

- Market Intelligence reached `READY`.
- `LIVE_VISIBLE` was observed with 22 samples.
- `LOCAL_HISTORY` was observed with 5 samples.
- Metrics were structurally valid.
- The dedicated Ponty probe dispatched controlled movement to Ponty.
- The dedicated read-only Ponty request was dispatched.
- No value mutation was dispatched.
- The runtime remained in the dedicated `PAUSED` verification mode.
- Ponty still contributed 0 samples, so the run correctly remained `WATCH`.
- This result is not a complete Phase 16 source-coverage PASS.

## Follow-up

PR #165 subsequently replaced the legacy Ponty fire-and-forget request path with a correlated `get_secondhands()` response and explicit runtime snapshot ingestion. A new live run is required before any Ponty PASS claim.
