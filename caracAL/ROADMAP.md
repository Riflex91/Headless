# caracAL Headless Bot – Roadmap

Status: verbindliche Entwicklungsgrundlage  
Repo: `Riflex91/Headless`  
Betrieb: vollständig lokal unter `D:\\caracAL`

---

## 0. Verbindliche Projektregeln

Diese Regeln gelten für die gesamte Entwicklung:

- **Kein Codex verwenden.** Weder für Codeerzeugung, Repo-Änderungen, Tests, Reviews noch für andere Arbeiten am Headless-Bot.
- Der Bot arbeitet **local-first**. Quellcode, Laufzeitdaten, Konfiguration, Secrets, Logs, Telemetrie, Markt-/Wissensdaten, Incidents und Backups liegen lokal auf der SSD.
- Keine Runtime-Abhängigkeit von Supabase, Cloudflare, Backblaze oder anderen Cloud-Diensten.
- Kein Bot-Auto-Updater aus GitHub oder dem Internet.
- Adventure Land selbst bleibt die notwendige externe Spielverbindung.
- Der Merchant arbeitet unabhängig von den drei Combat-Characters und wartet niemals auf eine volle 4/4-Party.
- Tests dürfen keine manuellen Preconditions verlangen. Wenn ein Test seine Voraussetzung nicht selbst herstellen kann, muss der Test angepasst werden.
- Headless-Debugging muss über Dashboard, strukturierte Telemetrie, Logs, Bewegungsdaten und automatisierte Tests vollständig nachvollziehbar sein.
- Normale Config-Änderungen müssen spätestens innerhalb von 60 Sekunden im laufenden Bot ankommen, im Normalfall innerhalb weniger Sekunden.
- Wertverändernde Aktionen mit unklarem Ergebnis dürfen nicht blind erneut ausgeführt werden.
- Vor GitHub-Writes wird der Arbeitsbranch frisch gegen `main` geprüft; bei `behind_by !== 0` wird auf diesem Branch nicht weitergeschrieben.

---

# 1. Lokale Zielstruktur

```text
D:\caracAL\
│
├── TYPECODE\
│   └── bot\                  # eigener TypeScript-Quellcode
├── TYPECODE.out\             # Webpack-Ausgabe
│
├── data\
│   ├── database\
│   │   └── caracal-bot.db
│   ├── state\
│   ├── market\
│   ├── knowledge\
│   ├── encounters\
│   ├── assets\               # lokal gecachte Spiel-/Item-/Map-Assets
│   └── cache\
│
├── config\
│   ├── bot\
│   └── secrets\
│
├── logs\
│   ├── runtime\
│   ├── characters\
│   ├── movement\
│   ├── economy\
│   ├── transactions\
│   └── incidents\
│
├── backups\
├── dev-inbox\                # Development-Pakete
└── caracAL-Systemdateien
```

Keine Cloud-Datenbank, keine Cloud-Telemetrie, kein Remote-State.

---

# 2. Bot-Code laden

caracAL verwendet den lokalen TypeScript-/Webpack-Pfad:

```text
TYPECODE\bot\main.ts
        ↓
Webpack
        ↓
TYPECODE.out\bot\main.js
        ↓
CharacterThread
        ↓
fs.readFile(...)
        ↓
vm.runInContext(...)
```

Alle Characters verwenden möglichst denselben Einstiegspunkt:

```text
TYPECODE\bot\main.ts
```

Die Rolle ergibt sich aus Charactername, Klasse, CharacterConfig und AccountStrategy.
Laufende Character-VMs erhalten keinen Hot-Reload. Neuer Code wird durch kontrollierten Character-Restart geladen.

---

# 3. Development-Workflow

Der Entwicklungszyklus soll weitgehend automatisch sein:

```text
Bot läuft
   ↓
Log kopieren
   ↓
Analyse / Codeänderung
   ↓
Development-Paket herunterladen
   ↓
D:\caracAL\dev-inbox
   ↓
lokaler Dev-Deployer
   ↓
Validierung
   ↓
Tests
   ↓
TypeScript / Webpack Build
   ↓
kontrollierter Character-Reload
   ↓
Healthcheck
   ↓
Bot läuft weiter
```

Kein manuelles Kopieren einzelner Dateien, kein manuelles Starten von Webpack, kein manueller Character-Restart.

---

# 4. Development-Pakete

Ein Paket enthält mindestens:

```text
manifest.json
TYPECODE\
tests\
```

Das Manifest beschreibt u. a.:

- Revision
- Basisrevision
- geänderte Module
- betroffene Characters
- Reload-Modus
- erwartete Healthchecks

Sobald das Paket lokal im `dev-inbox` landet, beginnt der Deploy automatisch. Es gibt keinen zusätzlichen „Anwenden“-Button.

---

# 5. Automatischer Dev-Deploy

Pipeline:

```text
Paket erkannt
   ↓
Validierung
   ↓
lokaler Snapshot
   ↓
Staging
   ↓
automatische Tests
   ↓
TypeScript Compile
   ↓
Webpack Build
   ↓
betroffene Characters reloaden
   ↓
Healthcheck
```

Bei Fehler:

```text
Deployment abbrechen
↓
vorherigen funktionierenden Stand wiederherstellen
↓
Healthcheck
↓
FAILED / ROLLED BACK
```

Dashboard:

```text
CODE REVISION
Installed: 18
Running:   18
Status:    HEALTHY
```

oder:

```text
Attempted: 19
Running:   18
Status:    ROLLED BACK
```

Zusätzlich: **Deployment-Log kopieren**.

---

# 6. Account Supervisor

Der zentrale Supervisor besitzt allein Autorität über:

- Start
- Pause
- Stop
- Restart
- Server
- Character-Slots
- Rotation
- Code-Reload
- Config-Verteilung

Maximal vier Characters gleichzeitig online.
Alle acht Account-Characters bleiben im Roster registriert.
Lifecycle-Zustände:

```text
STOPPED
STARTING
CONNECTING
ONLINE
PAUSED
STOPPING
BACKOFF
SUSPENDED
ERROR
```

---

# 7. Start / Pause / Stop pro Character

Jede Character-Karte im Dashboard erhält:

```text
[ Start ] [ Pause ] [ Stop ]
[ Konfiguration ]
[ Log kopieren ]
```

## Start

- Offline → Character starten.
- Pausiert → Autonomie wieder aktivieren.

## Pause

- Character bleibt verbunden.
- Keine neue Arbeit starten.
- Kritische laufende Transaktionen sicher abschließen.
- Danach idle.

## Stop

- Autonomie stoppen.
- Character sauber herunterfahren.
- CharacterThread beenden.
- Supervisor darf ihn nicht automatisch neu starten, bis wieder `Start` gesetzt wurde.

Desired Runtime State:

```text
RUNNING
PAUSED
STOPPED
```

Manuelles `STOPPED` hat Vorrang vor AccountStrategy und Full Autonomy.

---

# 8. Merchant arbeitet unabhängig

Sobald `My_Merchant` online und RUNNING ist, startet MerchantAutonomy sofort.
Der Merchant wartet nicht auf 4/4.
Unabhängige Merchant-Arbeit:

- Merrit
- Ponty
- Fishing
- Mining
- Wishlist / Buy Orders
- Giveaways beitreten
- Bank
- Exchange
- Craft
- Upgrade
- Compound
- Merchant Stand
- Market Intelligence
- eigene Supplies
- Merchant Skills

Farmerabhängig sind nur:

- Potion Delivery
- Item Pickup
- Gold Transfer
- MLuck
- Gear Delivery
- Inventory Pressure

---

# 9. Runtime Kernel

Grundmodule:

- EventBus
- Scheduler
- ModuleRegistry
- EmergencyStop
- StructuredLogger
- Diagnostics
- ConfigService
- PersistenceService
- GameAdapter
- ActionBoundary
- OutcomeTransaction

Jede relevante Aktion erhält:

- actionId
- correlationId
- character
- module
- intent
- reason
- timestamp
- result
- duration

Outcome-Zustände:

```text
DISPATCHED
CONFIRMED
REJECTED
UNKNOWN
BLOCKED
TIMEOUT
```

---

# 10. Lokale Persistence

Schreibautorität:

```text
Character
   ↓ IPC
Supervisor
   ↓
PersistenceService
   ↓
SSD
```

SQLite:

```text
D:\caracAL\data\database\caracal-bot.db
```

Persistiert werden u. a.:

- Character Profiles
- Character Config
- Goals
- Inventory Snapshots
- Equipment Snapshots
- Market History
- Ponty History
- Farm Statistics
- Lifecycle
- Cooldowns
- Economy State
- Encounter History
- Test Results
- Incident Index
- Config Revisions
- Code Revisions

Große Telemetrie als JSONL/NDJSON.

---

# 11. Character-Konfiguration

Jeder Character erhält eine eigene Config-Seite.
Änderungsfluss:

```text
Dashboard
↓
Supervisor
↓
SQLite
↓
CONFIG_CHANGED IPC
↓
Character ConfigService
↓
Controller
```

Normalerweise innerhalb weniger Sekunden, garantiert spätestens innerhalb von 60 Sekunden. Zusätzlich periodischer Revision-Check als Fallback.
Normale Gameplay-Config benötigt keinen Character-Restart.

## Allgemein

- Bot aktiv
- Auto-Reconnect
- Auto-Respawn
- Standardrolle
- bevorzugter Server

## Skills

Nur Skills der jeweiligen Klasse:

- Skill AN/AUS
- MP-Reserve
- minimale MP nach Skill

## Potion-Beschaffung

- HP-Potion Typ
- HP Zielbestand
- HP Nachbestellgrenze
- HP Reserve
- MP-Potion Typ
- MP Zielbestand
- MP Nachbestellgrenze
- MP Reserve

## Potion-Benutzung

- HP Pot unter X %
- MP Pot unter X %
- kritische HP-Grenze
- Skillreserve berücksichtigen

## Combat

- Combat AN/AUS
- Auto Target
- AoE
- Kiting
- Retreat
- Retreat HP %
- Aggressive Pulls
- max. Targets
- Kill-Steal vermeiden
- gefährliche Targets vermeiden

## Farming

- Auto Farming
- Farmziel
- bevorzugte Monster
- verbotene Monster
- XP Gewicht
- Gold Gewicht
- Drop Gewicht
- Catch-up Training

## Party

- Auto Party
- Account Party bevorzugen
- Group Focus
- Leader AUTO/manuell
- Formation
- max. Abstand
- Auto Regroup

## Inventory

- min. freie Slots
- Merchant rufen unter X Slots
- Loot
- Unknown Items behalten
- Locked Items schützen
- Event Items schützen

## Gear

- Auto Equip
- Gear Optimierung
- Future Gear
- Account Reservation
- Role

## Safety

- Auto Retreat
- Auto Respawn
- UNKNOWN-Verhalten
- Death Limit
- Connection Recovery

## Erweitert

- Tick Rate
- Timeouts
- Log Level
- Diagnostic Detail

---

# 12. Merchant-Konfiguration

Zusätzliche Tabs:

## Merchant Autonomy

- Merrit
- Ponty
- Fishing
- Mining
- Giveaways
- Wishlist
- Merchant Stand
- Bank
- Exchange
- Craft
- Upgrade
- Compound

## Farmer-Versorgung

- HP-Potions liefern
- MP-Potions liefern
- Items abholen
- Gold abholen
- MLuck
- Gear liefern
- Inventory Pressure

Der Merchant liest die individuelle Config jedes Farmers.

---

# 13. Dashboard V1

Das Dashboard wird früh gebaut und ist Kernbestandteil des Headless-Betriebs.
Adresse:

```text
http://localhost:924
```

Account-Übersicht:

- Account Health
- aktive Characters
- Character Slots
- Code Revision
- Config Revision
- Goals
- Lifecycle
- Economy
- letzte Fehler

Character-Karte:

- Name
- Klasse
- Server
- Map
- Position
- HP
- MP
- Role
- Task
- Target
- Code Revision
- Config Revision
- Runtime State
- Start / Pause / Stop
- Konfiguration
- Log kopieren

---

# 14. Live-Bewegungsvisualisierung

Da der Bot headless läuft, muss Bewegung direkt nachvollziehbar sein.

## Gemeinsame Live-Karte

Für alle aktiven Characters gleichzeitig:

- aktuelle Position
- Name
- Rolle
- Status
- Blickrichtung
- aktuelles Target
- gelaufener Weg
- geplanter Weg

## Blickrichtung

Character-Marker zeigt Heading / Richtungspfeil.

## Gelaufener Weg

Trail/Breadcrumbs der letzten:

- 30 Sekunden
- 2 Minuten
- 5 Minuten

## Geplanter Weg

- aktueller Path
- Waypoints
- nächster Punkt
- Endziel

## Overlays

Optional:

- Target-Linie
- Leader-Linie
- Attack Range
- Aggro Range
- Hard Tether
- Soft Tether
- Farmspot
- Gathering Zone
- Merrit Area
- Bank
- Ponty
- NPC

## Movement-Telemetrie

Pro Character:

- current x/y
- previous x/y
- heading
- movement state
- destination
- waypoints
- movement reason
- owner
- distance
- speed
- replans
- stuck score

Movement States:

```text
IDLE
MOVING
SMART_MOVING
KITING
REGROUPING
RETREATING
MERCHANT_TRAVEL
STUCK
```

Movement Reasons z. B.:

```text
MOVE_TO_FARMSPOT
MOVE_INTO_ATTACK_RANGE
RANGER_KITE
REGROUP_TO_LEADER
RETREAT_LOW_HP
MOVE_TO_BANK
MOVE_TO_PONTY
MOVE_TO_MERRIT
MOVE_TO_GATHER_ZONE
DELIVER_TO_FARMER
```

Später: Movement Replay für 30 Sekunden / 2 Minuten / 5 Minuten.

---

# 15. Live-Inventar- und Ausrüstungsansicht

Pflichtbestandteil von Dashboard V1.
Ziel: Inventar **und** Ausrüstung aller aktuell eingeloggten Characters gleichzeitig beobachten können.

## Gemeinsame Account-Ansicht

Vier aktive Characters nebeneinander:

- Equipment
- Inventory Slots
- freie/belegte Slots
- Supplies
- Itemstatus
- Änderungen live

## Item-Icons

Inventory und Equipment zeigen die passenden Adventure-Land-Item-Icons.
Icons werden lokal gecacht:

```text
D:\caracAL\data\assets\items\
```

Kein permanenter externer Asset-Download beim Öffnen des Dashboards.

## Inventory

- echte Slot-Reihenfolge beibehalten
- Icon pro Item
- Stack-Menge direkt am Icon
- Upgrade-Level direkt am Icon
- geänderte Slots kurz hervorheben

## Equipment

Adventure-Land-Slotlayout mit Icons:

- Helmet
- Earrings
- Amulet
- Mainhand
- Offhand
- Chest
- Rings
- Pants
- Shoes
- Cape
- weitere vorhandene Slots

## Itemstatus

Visuelle Marker:

```text
LOCKED
EQUIPPED
RESERVED
FUTURE_GEAR
QUEST
EVENT
UPGRADE
EXCHANGE
SELL
BANK
UNKNOWN
```

## Itemdetails

Tooltip/Klick zeigt:

- Name
- Icon
- Level
- Menge
- Stats
- Slot
- Locked
- Reservation
- Future Gear
- Bot Classification
- letzte Änderung

## Supply-Status

Pro Character:

- HP-Potion Ist/Ziel/Nachbestellgrenze
- MP-Potion Ist/Ziel/Nachbestellgrenze
- Request-Status

Merchant zusätzlich:

- offene Supply Requests der Farmer

## Accountweite Item-Suche

Suche über:

- aktive Characters
- später alle Character-Snapshots
- später Bank

## Historie

Slot-/Equipment-Historie auf Klick.

---

# 16. Log kopieren

Jeder Character erhält **Log kopieren**.
Export enthält:

- Characterdaten
- Runtime State
- Code Revision
- Config Revision
- aktuelles Goal
- aktueller Task
- aktuelle Entscheidung
- WHY
- Action History
- Movement
- Combat
- Skills
- Inventory Snapshot
- Equipment Snapshot
- Supplies
- Party
- Lifecycle
- Supervisor Events
- Merchant-Interaktionen
- Fehler
- Stacktraces
- aktueller Snapshot

Zeitbereiche:

- letzte 5 Minuten
- letzte 15 Minuten
- letzte Stunde
- aktuelle Session
- nur Fehler
- letztes Incident

Zusätzlich:

- Account-Log kopieren
- Testlog kopieren
- Deployment-Log kopieren

Alle Secrets werden vor Export zentral entfernt.

---

# 17. Testprinzip

Tests laufen vollständig autonom.
Unzulässig:

- „Geh zur Bank.“
- „Stell Ranger neben Monster X.“
- „Öffne Ponty.“
- „Geh zum Fishing Spot.“
- „Sprich mit NPC X.“
- „Ziehe Item X in Slot Y.“

Jeder Test muss selbst:

```text
Ist-Zustand erfassen
↓
benötigten Character starten
↓
benötigte Items beschaffen
↓
benötigte Map bestimmen
↓
hinreisen
↓
NPC / Bank / Zone erreichen
↓
Testzustand herstellen
↓
Aktion ausführen
↓
Ergebnis beobachten
↓
verifizieren
↓
aufräumen
```

Kann ein Test das nicht, wird der Test angepasst.
Normale Testresultate:

```text
PASS
FAIL
UNKNOWN
TIMEOUT
```

Kein `PRECONDITION_UNAVAILABLE` als akzeptiertes Endergebnis für normal automatisierbare Spielzustände.

---

# 18. Test-Diagnostik

Jeder Test protokolliert:

- Test-ID
- Character
- Startzustand
- Vorbereitung
- Navigation
- Aktionen
- Live-Evidence
- Expected
- Observed
- Result
- Duration
- Incident-ID

Bei Fehler wird automatisch Diagnosematerial erzeugt.

---

# 19. Entwicklungsphasen

## Phase 0 – caracAL härten

- PR21-Basis
- Login-Fix
- TypeScript
- max. 4 Characters
- staggered startup
- Restart Backoff
- sauberer Shutdown
- Lifecycle State Machine
- kontrollierter Reload
- Supervisor Events

Gate: vier Characters stabil, keine Connection-/Restart-Stürme.

## Phase 1 – Runtime + Observability + Dashboard V1

- EventBus
- Scheduler
- Logger
- Action IDs
- Outcome-Modell
- Diagnostics
- ConfigService
- Character Cards
- Start/Pause/Stop
- Log kopieren
- Bewegungsbasis
- Live-Karte
- Live-Inventar
- Live-Equipment mit Icons

Ab hier wird nicht mehr blind entwickelt.

## Phase 1A – GUI Foundation

Diese Subphase ist verbindlicher Bestandteil von Phase 1 und schafft die technische Grundlage für alle späteren Dashboard-Funktionen.

### Technische Basis

- lokaler Web Server unter `http://localhost:924`
- Frontend Shell
- Hauptnavigation und Seitenstruktur
- gemeinsames Design System
- Shared Component Library
- zentrales Frontend State Management
- Realtime Transport über WebSocket oder SSE
- klar versionierter Dashboard-/Supervisor-API-Vertrag
- saubere Loading-, Offline-, Error- und Reconnect-Zustände

### Character- und Account-Komponenten

- Character Cards
- gemeinsame Account-Übersicht
- Start / Pause / Stop Controls
- Status-/Health-Komponenten
- Code- und Config-Revision-Anzeige
- wiederverwendbare Character Detail Views

### Adventure-Land-Visualisierung

- lokaler Adventure-Land Asset Loader
- lokaler Asset Cache
- Item Icon Renderer
- Inventory Renderer
- Equipment Renderer
- Map Renderer
- Character Marker mit Blickrichtung
- Trail Renderer für gelaufenen Weg
- Path Renderer für geplanten Weg
- Range-/Tether-/Target-Overlays

### Konfigurationsoberfläche

- wiederverwendbare Config Form Engine
- klassenspezifische Skill Controls
- Potion-/Supply-Konfiguration
- Combat-/Farming-/Party-/Inventory-/Gear-/Safety-Konfiguration
- Merchant-spezifische Config Tabs
- Config Revision / Applied Status
- Live-Übernahme ohne Character-Restart

### Diagnose und Bedienung

- Clipboard Diagnostics für Character-, Account-, Test- und Deployment-Logs
- Filter-/Suchkomponenten
- Incident-/Fehleranzeige
- Timeline-Komponente
- Decision-/WHY-Darstellung
- klare Kennzeichnung von RUNNING / PAUSED / STOPPED / ERROR / SUSPENDED

### Layout-Ziel

Die GUI muss so aufgebaut sein, dass die gleichzeitig eingeloggten Characters parallel beobachtet werden können. Insbesondere müssen gemeinsame Ansichten für Bewegung, Inventar und Ausrüstung ohne ständiges Umschalten zwischen Character-Seiten möglich sein.

### Entwicklungsregel

Jede spätere Bot-Phase liefert ihre zugehörigen GUI-Elemente direkt mit. Neue Runtime-Funktionen gelten erst dann als vollständig integriert, wenn ihre relevanten Zustände, Aktionen, Fehler und Konfigurationsmöglichkeiten im Dashboard sichtbar bzw. bedienbar sind.

## Phase 2 – Persistence

- SQLite
- Schema Versioning
- Migrations
- Structured State
- Log Storage
- Incident Storage
- Config Storage

## Phase 3 – Account Supervisor + IPC

- alle 8 Characters registrieren
- max. 4 Slots
- Desired/Actual State
- Start/Pause/Stop/Restart
- Rotation
- Heartbeats
- Versioned IPC
- Config Push
- Code Revision

## Phase 4 – GameAdapter + ActionBoundary

GameAdapter liest:

- Character
- Entities
- Party
- Inventory
- Equipment
- NPC
- Bank
- Market
- Skills
- Cooldowns
- Map
- Zones
- G

ActionBoundary mutiert:

- Move
- Attack
- Skills
- Loot
- Buy
- Sell
- Send
- Bank
- Equip
- Upgrade
- Compound
- Exchange
- Craft
- Wishlist
- Ponty
- Party
- Lifecycle

## Phase 5 – Movement

- Direct Move
- Smart Move
- Movement Ownership
- Cancel
- Settlement
- Path
- Waypoints
- Anti-Pingpong
- Safe Point
- Return
- Stuck Detection
- vollständige Movement-Visualisierung

## Phase 6 – Ressourcen + Combat

- HP/MP Management
- Potion Usage
- Target Selection
- Attack
- Range
- Cooldown
- Retreat
- Death
- Respawn

## Phase 7 – Class Skills

Separate Controller:

- Warrior
- Ranger
- Mage
- Priest
- Rogue
- Merchant

Skill-Verwendung folgt individueller CharacterConfig.

## Phase 8 – Party + Group Combat + AoE

- Party Formation
- Leader
- Follower
- Focus
- Healing
- Support
- Regroup
- Hard Tether
- Soft Tether
- AoE
- Warrior Anchor
- Ranger Kiting

## Phase 9 – Farm Intelligence

Bewertung:

- XP/h
- Gold/h
- Drops
- Goal Utility
- Gefahr
- Travel Cost
- Respawn
- Party DPS
- Tank Safety
- observed performance

Dashboard zeigt WHY THIS MONSTER / WHY THIS SPOT.

## Phase 10 – Inventory Intelligence

Disposition:

```text
KEEP
BANK
SELL
EXCHANGE
CRAFT
GEAR
UPGRADE
CONSUMABLE
QUEST
RESERVED
UNKNOWN
```

Schutz:

- locked
- event
- quest
- future gear
- reserved
- unknown
- valuable

## Phase 11 – Merchant + Farmer Logistics

- MLuck
- Potion Delivery
- Item Delivery
- Gold Pickup
- Inventory Pressure
- Gear Delivery
- Farmer Claims
- Anti-Pingpong

Merchant bleibt unabhängig.

## Phase 12 – Merchant Autonomy

Aus ALFinal 0.26.57-h26 übernehmen/neu strukturieren:

- Merrit
- Wishlist
- Merchant Skills

Giveaways, Ponty, Fishing und Mining werden in Phase 12 nicht weitergeführt. Bereits vorhandene Implementierung, Tests und Live-Evidence bleiben unverändert erhalten; die weitere Umsetzung und Live-Verifikation wird nach Phase 12 in Phase 22 fortgeführt.

### Merrit

```text
Cooldown
→ Zone
→ Travel
→ Position
→ Stand
→ Listing
→ 120 s settle
→ Handoff
→ Parcel
→ Cooldown persistieren
```

## Phase 13 – Bank + Trading

- Bank automatisch finden
- hinreisen
- Deposit/Withdraw
- Settlement verifizieren
- NPC-/Market-Trading automatisch

## Phase 14 – Gear / Upgrade / Compound / Exchange / Craft

- Gear Scoring
- Future Gear
- Account Gear Reservation
- Upgrade
- Compound
- Exchange
- Craft
- Expected Value
- Risk Policy

Wertverändernde UNKNOWN-Aktionen: kein Blind-Retry.

## Phase 15 – Economy Arbiter

Priorität:

```text
SAFETY
↓
MERRIT
↓
kritische Farmer Logistics
↓
Economy Prebuff
↓
Economy
↓
Merchant Stand
↓
Ponty / Giveaways / Wishlist / Gathering
```

Background-Arbeit später dynamisch scoren.

## Phase 16 – lokale Market Intelligence

Quellen:

```text
LIVE_VISIBLE
PONTY
LOCAL_HISTORY
```

Speichern:

- item
- level
- price
- quantity
- server
- seller
- timestamp
- source

Berechnen:

- Median
- Preisband
- Volatilität
- Samples
- Age
- Confidence

## Phase 17 – Account Strategy

Profile aller acht Characters:

- Klasse
- Level
- Gear
- Stats
- Capabilities
- Training
- Online
- Map
- Gold
- History

Capabilities:

```text
TANK
HEALER
DPS
AOE
RANGED
MELEE
SUPPORT
ECONOMY
LOGISTICS
```

Farm: 3 Combat + Merchant, aber Merchant unabhängig.

## Phase 18 – Full Autonomy

Verknüpft:

- Account Strategy
- Lifecycle
- Farming
- Merchant
- Economy
- Encounters

Desired State wird automatisch reconciled.

## Phase 19 – Goals

Beispiele:

- Farme Item X
- Level Character Y
- Besorge Gear Z
- Sammle Gold
- Craft Item
- Boss vorbereiten

## Phase 20 – Boss / Event / Quest / World

- Boss Detection
- Event Detection
- Encounter Catalog
- Party Composition
- Travel
- Combat Ownership
- Quest Autonomy
- Rare Spawns
- Server Selection

## Phase 21 – Recovery + 24/7

- Flight Recorder
- Health Monitor
- Stall Detection
- Watchdog
- Known Recovery
- Crash Recovery
- State Reconciliation
- Incident Recorder

## Phase 22 – Dashboard V2

- komplette Account-Ansicht
- Goals
- Economy
- Market
- Merchant
- Lifecycle
- Test Center
- Incident Center
- Movement Replay
- Decision Inspector
- erweiterte Inventory-/Equipment-Historie

### Abschluss von Phase 22 – Giveaways / Ponty / Fishing / Mining

Giveaways, Ponty, Fishing und Mining werden erst nach Abschluss der übrigen Phase-22-Arbeiten weitergeführt und live verifiziert.

#### Giveaways

Nur `join_giveaway`, niemals Giveaway erstellen.

#### Ponty

```text
finden
→ Travel
→ Scan
→ bewerten
→ Budget
→ revalidieren
→ kaufen
→ Gold/Inventory bestätigen
```

#### Fishing / Mining

```text
Skill
→ Tool
→ Tool beschaffen
→ Zone
→ Travel
→ Equip
→ Skill
→ Ergebnis
→ alte Waffe restaurieren
```

Reihenfolge am Ende von Phase 22:

```text
Giveaways
→ Ponty
→ Fishing
→ Mining
```

## Phase 23 – Production Hardening

- Long-Run Tests
- Restart Tests
- Crash Tests
- Config Reload Tests
- Deployment Rollback Tests
- Movement Stress
- Party Rotation
- Economy Recovery
- Merchant 24/7
- Memory Leak Checks
- Log Rotation
- DB Recovery

---

# 20. Praktische Entwicklungsreihenfolge

```text
0  caracAL stabilisieren
1  Runtime + Observability + Dashboard V1
1A GUI Foundation
2  lokale Persistence
3  Supervisor + IPC
4  GameAdapter + ActionBoundary
5  Movement
6  Combat
7  Skills
8  Party/AoE
9  Farming
10 Inventory Intelligence
11 Merchant Logistics
12 Merchant Autonomy
13 Bank/Trading
14 Gear/Upgrade/Craft
15 Economy
16 Market Intelligence
17 Account Strategy
18 Full Autonomy
19 Goals
20 Boss/Event/Quest
21 Recovery
22 Dashboard V2 → Giveaways → Ponty → Fishing → Mining
23 Production Hardening
```

Dashboard und Tests wachsen während aller Phasen mit.

---

# 21. Definition of Done für Headless-Debugging

Für jede wichtige Aktion muss rekonstruierbar sein:

- Was wollte der Bot tun?
- Warum?
- Welcher Controller war Owner?
- Welche Preconditions wurden geprüft?
- Welche Aktion wurde tatsächlich gesendet?
- Welche Live-Evidence kam zurück?
- Wurde das Ergebnis CONFIRMED / REJECTED / UNKNOWN?
- Wo stand der Character?
- Wohin wollte er laufen?
- Wie verlief der echte Weg?
- Welche Items/Ausrüstung hatte er davor und danach?
- Welche Config-Revision galt?
- Welche Code-Revision galt?

Der Benutzer soll für normale Entwicklung im Wesentlichen nur noch:

```text
Bots laufen lassen
→ bei Auffälligkeit Log kopieren
→ Log weitergeben
```

müssen.
