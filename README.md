# Workshop-Game | Parcel Pals

A game representing how I direct AI in gaming.

A small, original HTML game for a cross-functional student workshop. Improve the
game, explore fictional experiment data, and propose a test of your own.

Plain HTML, CSS and JavaScript in the browser. One Node.js + Express process serves
the game, workshop lab and local API. No frontend build, database, cloud account,
external API, proprietary game assets or company technology.

## Run locally

## Host the free online demo

Connect this repository to a Render **Web Service**, or use its `render.yaml`
Blueprint. The included configuration explicitly selects the free plan and no
paid storage. Build with `npm ci --omit=dev`, start with `npm start`, and use
Node.js 24. Render supplies the port. `HOST=0.0.0.0` lets the host reach the app.

Set `PUBLIC_DEMO=1`, `DEMO_EPHEMERAL=1`, and `DATA_DIR=/tmp/parcel-pals` as in the
Blueprint. This serves the arena at the main address, accepts same-host HTTPS
game requests, and disables workshop-management pages, resets, settings edits,
incident tools and data exports. Local development keeps its original workshop
features. `/healthz` is the host's health check.

Free Render services sleep after inactivity. Saved records and anonymous player
identities may be lost on sleep, restart or redeployment. The demo warns players
about this. Active runs and rooms also reset. Friends must use the same hosted
address for live PvP. Keep one service instance, because active matches live in
that process. Persistent storage can be added later on a paid plan.

No `.local` data, player credentials, installed packages or `.env` secrets belong
in GitHub. The repository includes automated backend checks in GitHub Actions.

## Run on your computer

Install Node.js 24 LTS before the workshop. Node 22 or newer is supported.
If you use nvm, `nvm use` selects the version in `.nvmrc`.

```sh
npm ci
npm start
```

Open:

- Game: <http://127.0.0.1:3000>
- Workshop lab: <http://127.0.0.1:3000/lab.html>
- Incident room: <http://127.0.0.1:3000/incident.html>
- Student pointers: [WORKSHOP.md](WORKSHOP.md), also linked inside the game

Keep the terminal running. Stop with Ctrl+C. If port 3000 is occupied, run
`PORT=3001 npm start` on macOS/Linux, or set `$env:PORT=3001` before `npm start`
in PowerShell. Use the same address consistently: `localhost` and `127.0.0.1`
have separate browser storage.

The server listens on `127.0.0.1`, not the local network. Each team runs its own
copy; teams do not share results. Internet is needed to install npm packages,
but not to run the game, lab or tests once their dependencies are available.
AI assistants, if used, may still require their own network access and accounts.

## Find your way around

| File | Purpose |
|---|---|
| `public/index.html`, `public/game.js` | Game layout and browser interaction |
| `public/styles.css`, `public/assets/` | Styling and original SVG symbols |
| `config.json` | Instructions, hints, timer, parcel count and special-handling rules |
| `public/lab.html`, `public/lab.js` | Settings editor, evidence dashboard and proposals |
| `server.js` | Small local HTTP API and round handling |
| `experiments.js` | Setting validation, experiment rules and stable assignment |
| `events.js` | Event interpretation, metrics and CSV export |
| `data/synthetic/` | Clearly labelled fictional case files and player CSVs |
| `data/incident/` | Fictional LiveOps event configs, catalog and historical scenario |
| `incident.js`, `incident-history.js` | Incident API, correlated traces and store-funnel metrics |
| `public/store.js`, `public/store-offers.js` | Isolated event-store client and catalog resolution |
| `AGENTS.md` | Coaching guidance for compatible AI assistants |

HTML, CSS and browser-JS changes need only a page refresh. The server reads
`config.json` for new experiences, so config changes do not need a restart.
Restart `npm start` after changing backend JavaScript or synthetic CSVs.

## What the starter does

## Competitive arena

Open `/arena.html` or choose **Competitive arena** from the game. This separate
mode never contributes to workshop experiments or synthetic incident evidence.
Use W to wrap and J/K/L to dispatch, with the same three couriers and optional
sound effects. A generated callsign identifies a browser without asking for a
real name. Keep browser storage to retain the same player identity.

**Level climb:** start at level 1 with five lives. Parcels increase and the time
per parcel decreases gradually, within fixed caps. Fragile parcels start from
level 3; express parcels from level 5. Wrong dispatches or unwrapped fragile
parcels cost one life. A timeout costs one life and resets that level and its
unbanked points. Cleared-level points stay banked. Choose when to start the next
level or use **Bank score & finish** to submit the run. Five lost lives ends it.
The campaign contains 220 levels: the original 20 plus 200 more. The full map
can be browsed in blocks of 20, but levels unlock only through play. Finishing
level 220 defeats the final super boss, completes the campaign and automatically
banks the run on the leaderboard. Speed and parcel counts have difficulty caps
so late levels remain playable.

Every multiple of 10 is a boss round with more parcels and less time per parcel.
Multiples of 20 are super bosses instead. Each correct delivery removes one
shield point; clearing the whole level defeats the boss. Bosses restore one
life, super bosses restore two, up to five. These are sorting challenges, not a
separate combat system.

**PvP:** create a room, share its six-character code, and have both players ready
up. A shared three-second countdown starts a two-minute duel. Both players get
the same seeded parcel sequence at each level. Cleared levels advance after
1.8 seconds. The higher server-calculated score wins; equal scores are a draw.
If one player loses all lives, their score freezes while their rival can finish
the match. Leaving after the countdown begins forfeits; closing a waiting room
does not create a match result. Inactivity does not pause the match clock.
Waiting rooms expire after 15 minutes.

The **Open player 2 to test** button creates a separate guest session in a new
tab. It is for testing locally; for simultaneous play on separate devices, host
this same server at a shared address. The default 127.0.0.1 binding remains local
to this computer. An invite link to 127.0.0.1 will not reach this laptop from a
friend's device. No hosting or network access is enabled by this feature.

The shared leaderboard stores the best finished solo run per player, ordered by
levels cleared then score, and a separate PvP record ordered by wins then fewer
losses. Records and hashed player credentials persist in
`.local/competitive/players.json`. Active runs and rooms are in memory and reset
when the server restarts. Solo runs resume after a page refresh; PvP rooms
reconnect using the same browser identity. Classroom resets do not clear arena
records. Player credentials stay out of public room and leaderboard responses.

Scores, lives, deadlines, ownership and action revisions are checked on the
server. This remains a small single-server teaching game, without public-scale
matchmaking, moderation, or bot detection. It needs the previously described
hosting, storage and access-control work before a public launch.

## Classic sorting game

Choose Nova, Bolt or Pip as your courier before starting. The animated depot
shows your character carrying successful deliveries to the matching bay, reacting
to mistakes, wrapping fragile parcels and celebrating a completed shift. All
three characters have identical abilities; selection is cosmetic and remembered
in this browser. Optional synthesised sound effects start muted and can be
toggled throughout a shift. Reduced-motion preferences disable continuous scene
animation and particles. Dispatch with J/K/L under your right hand; wrap with W
under your left. The buttons and original 1/2/3 shortcuts still work. A quick W
then J/K/L queues one dispatch until wrapping finishes successfully, so it does
not disappear while the wrapping request is saving. Holding a key never repeats
deliveries. Multiplier progress, coloured button reactions, courier celebrations
and optional milestone sounds reward clean streaks without changing the rules.

The personal-best score is stored only in this browser, separately for each
complete game configuration. Preview rounds do not update it. It is a practice
record, not a multiplayer leaderboard or experiment result. Animation does not
delay input, change difficulty, or change server-validated scoring. The scene
uses original canvas drawings in `public/courier-scene.js`, with no remote assets.

The game is a small sorting-station arcade challenge: 18 parcels, 45 seconds,
and a five-mistake budget by default. A conveyor shows the front parcel and the
next two deliveries. Use buttons or J, K and L for destinations, and W to
wrap a fragile parcel before dispatch. Express deliveries earn 75 extra points
if delivered within their bonus window; missing that window does not prevent
delivery. Special parcels are introduced gradually, with more fragile mail
later in the shift. The first two parcels are always ordinary deliveries.

Each delivery earns 100 points multiplied by the current clean streak: x2 at
three deliveries, x3 at six, and x4 at nine. A wrong destination or an unwrapped
fragile delivery costs 25 points (never below zero), resets the streak and uses
one mistake. Reaching the mistake limit ends the shift. Hints are not penalised.

The server checks wrapping, scoring, express deadlines, the mistake budget,
the shift timer and valid parcel order. Wrapping and awarded points are included
in the event CSV. Closing a page does not stop the timer; an unfinished round
becomes timed out. Existing events and frozen classic experiments remain
readable; old snapshots without special-handling settings retain classic rules.

The lab exposes `fragileParcels`, `expressParcels`, `mistakeLimit` (0 disables
the cap) and `expressBonusSeconds`, alongside the original settings. They can
also be variant overrides, so the added complexity creates more experiment
opportunities without adding services or dependencies.

The lab separates **synthetic historical cases** from **live local playtests**.
It shows player counts, pending first rounds, completion, completion without
hints, round duration, attempt accuracy and Wilson 95% completion intervals.
Live results also show average score and support it as a primary metric.
The fictional case files describe the classic eight-parcel game without
fragile or express handling, not a benchmark for the new arcade mode.
It never declares an automatic winner. Comparing interval overlap alone is
not a significance test of a difference.

Create a proposal with a hypothesis, primary metric, guardrail, evidence/stopping
plan and variant-B settings. Drafts can be previewed without entering live
results. Launching freezes the base config and assigns browsers A/B with a
deterministic 50/50 hash of experiment ID and random browser ID. This is an
expected allocation, not guaranteed equal-sized groups.

Only one experiment runs at a time. Stop it before changing base settings.
Editing `config.json` directly during a running test does not change its frozen
variants. Existing rounds keep their original settings even if the test stops.
Stopped tests cannot be relaunched; create a new proposal for a new test.

Every round is saved, but the comparison includes only the first recorded round
per browser per experiment, or per base-config version outside an experiment.
Pending first rounds are excluded from finished-round rates until resolved.
Completion measures **starters**, not all page visitors; the starter does not
measure onboarding conversion, enjoyment, retention or business outcomes.
People can learn between experiments, and small classroom samples do not prove
a causal winner. Real experiments need stronger design and analysis.

## Incident exercise

The incident room starts with falling spend in **Game Bits (GB)**, an invented
currency. Two original fictional LiveOps events run side by side. One released
configuration is intentionally incompatible with the item catalog. The event
store really fails while resolving its offers in the browser; a safety boundary
stops that store client and records the error rather than crashing the arcade
game or investigation room. Do not automatically repair the released fixture
when maintaining unrelated code.

Students can compare equal historical windows, inspect a store funnel, reproduce
both clients, follow a trace ID, inspect errors and stacks, compare config
versions, and publish a minimal change. The synthetic historical funnels are
derived from the same generated traces shown in the explorer; local browser
actions are labelled separately and never change historical results.

Each sandbox store client starts with 100 pretend GB. Purchases are local,
server-validated and idempotent; nothing costs money or grants a real reward.
The two stores share a catalog, but each client keeps its config/catalog
snapshot. After publishing a config, open a new client to verify rendering and
a purchase. Publishing checks enabled offers and increments the revision, with
an expected-version check to reject stale edits. Pausing an event is supported
as a mitigation, but does not prove a working store or recovered spending.

Incident actions persist in `.local/incident/events.jsonl`. The incident reset
button clears only that log, not event configs, historical evidence, game rounds
or experiments. The normal lab's reset does not clear incident evidence.
Published config changes are saved in `data/incident/events/`; a fresh project
copy restores the initial exercise. Direct config file edits are read for new
clients without restarting. Restart after catalog or history changes.

The trace explorer filters source, event and severity, searches IDs/messages/
attributes, and follows an individual trace chronologically. Up to 150 matching
entries are displayed; the JSONL export contains all synthetic and sandbox
entries with explicit source labels. All store and incident tooling stays on
the same local Express process, with no new dependencies or external services.

## Local data and reset

Runtime data is saved in `.local/events.jsonl` and `.local/experiments.json`.
It survives restarts and is excluded from Git. Game settings are saved directly
to `config.json`, so intentional config edits can be shared with the project.

The lab's reset button asks for confirmation and clears local events and
proposals. It does **not** restore game settings or change synthetic datasets.
Do not reset while another person is using the same copy. The random browser ID
stays in browser local storage; no names, emails or accounts are requested.
Do not enter personal or confidential information into proposal text.

Live event CSVs include `preview` and `configVersion`. Filter previews out when
doing your own analysis, and avoid treating repeated rounds as independent
first-time players.

This is a trusted local teaching tool, not a production backend or secure
multi-user service. There is no login or facilitator-only access control.
The lab and exports are available to anyone using this local copy.

## Facilitation and AI

Start with [WORKSHOP.md](WORKSHOP.md). Its pointers are options, not a requirement
to finish every feature. Participants can contribute through observation,
design, writing, analysis or code.

The guide includes optional stretch ideas. They are only for participants who
want to and can try them with their available time and tools; no stretch, code
change or AI use is required for a successful session.

Tell participants that compatible assistants are configured to coach rather
than choose the solution. `AGENTS.md` is guidance, not enforcement. Check that
the actual student tool loads it; `.github/copilot-instructions.md` also points
Copilot-compatible tools to the same brief. Keep any facilitator answer notes
outside the student copy. AI use is optional.

When using AI, a local/workspace-connected project agent is preferred. This
means project access, not necessarily an offline model. The
[browser-only tutor brief](WORKSHOP.md#browser-only-ai-fallback) is just a fallback
for participants without a working local project agent; it is not an extra
setup step for everyone. Browser assistants may need relevant snippets pasted
explicitly and must not be assumed to have read local files. Neither route
requires sharing private documents or student information.

Before the session, try a game, an incorrect sort, a hint, a proposal, both
previews, launch/stop, and export on the actual laptops. Set up Node and packages
in advance. No GitHub access or remote repository is required: a clean folder
copy works. Exclude `node_modules`, `.local`, test results and any private notes
when packaging the starter. Use `npm ci` on each laptop.

## Development checks

```sh
npm test
```

Backend tests use Node's built-in test runner and isolated temporary data.
Browser checks use Playwright as a development-only dependency:

```sh
npx playwright install chromium
npm run test:browser
```

These checks also use isolated data and never modify the workshop's config or
`.local` directory. To regenerate the checked-in fictional player CSVs
deterministically, run `npm run generate:data`.

## Provenance

The game concept, code, styling and SVG artwork in this starter are original
workshop material. Case-file participants and outcomes are entirely synthetic.
No student roster, private planning material, company game code, production
data or credentials are included. Third-party packages retain their own
licenses. No remote repository is configured by this project.

