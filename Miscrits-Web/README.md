# Miscrits Field Station

A separate browser client with its own Node.js backend. It connects directly to the official Miscrits service. It does **not** launch, embed, or control Miscrits.exe.

Double-click **Launch Miscrits Website.cmd** in the parent folder, then open <http://127.0.0.1:4318>. Finish any active battle and close the native game before signing in with your Miscrits username/email and password. The backend must stay running while you use it. **Stop Miscrits Website.cmd** stops only this website backend.

## Available controls

- Hunt picker: search portraits by name or filter Common, Rare, Epic, Exotic and Legendary. Click to add one, or use **Add available** to add all matching available families across pages (100-target limit). **Available only** hides unavailable families. Map locks, missing tickets, area locks and daily schedules are checked for the signed-in account using the same rules as hunt routing. Targets already saved remain visible with their current availability and can be removed. Route order and Main priority are under **Route order**; extra capture rules are under **Advanced capture settings**. Save hunt settings before Start.

- Arena: automatic Battle Arena, Platinum Arena and Random Arena; server account win totals and period/streak progress separate from run win rate; Smart matchup/survival strategy with Basic fallback; improved draft coverage; native matchmaking, manual draft after Pause, per-run battle limit and stop-on-loss. Uses current team/HP with no automatic paid heal; team training is suspended during arena runs. See `docs/WEB-ARENA.md` and `docs/ARENA-STRATEGY.md` in the parent package for rules and verification limits. A higher live win rate has not yet been measured.
- Workflow: live current/next search object and per-target reasons; stop reports with recovery guidance; optional wild healing with a virtue budget; up to 20 saved profiles; recent alerts and optional browser notifications; session counters. Hunt targets support up/down ordering and one Main target, saved with settings/profiles. Main searches yield to other available targets during cooldowns. See `docs/WEB-WORKFLOW.md` in the parent package for exact rules and validation.
- Collection: open **Collection** in the sidebar for tier progress, current owned/missing families, best ratings, copy counts and level-30 completion. Search species, evolutions or nicknames; combine tier, ownership, rating and completion filters. Sort by tier/name, best rating or highest level. Each family has an expandable copy list; pages contain up to 24 families. This view is read-only and preserves hunt/team settings.
- Hunt & capture: select names using the existing mapping catalog; choose fighting, targeted/any/rated capture, or pause on a target for a manual battle. Supports normal object cooldowns and fleeing unwanted encounters.
- Live battle: server HP, available abilities, teammate switches, one free capture attempt, keep a captured Miscrit, and flee. Automatic captures keep the Miscrit. There is no paid capture retry or release button.
- Campaign: unlocked next-stage battles, confirmed victory count and a configurable 1–10 victory limit. Heals with 10 virtue when two active teammates have fainted. Stops on defeat, attempts exhausted, insufficient virtue, or a server failure.
- Team: Your active team has four editable slots and a searchable inventory of individual owned copies. Drag a copy onto a slot to replace it, or drag between occupied slots to reorder. Selecting a copy and choosing a slot also works with keyboard or touch. Swaps save immediately and verify the refreshed server team. Pause automation and finish battles/arena queues before editing.
- Auto level-up: toggle it directly in **Your active team**. The change saves immediately. Trains active teammates with earned XP between hunting/campaign battles, one level per cycle up to level 35. Green HP and blue XP bars show current values. Per-copy **Platinum upgrade** switches unlock when auto level-up is on; enabled copies may buy the native bonus stats for 1 platinum after each new earned-XP level. Catch-up purchases are paused rather than spending multiple platinum.
- Collection capture: choose **Capture species I do not own** in Hunt & capture. Compares species families against your current owned roster, including evolved copies. Captures new families at the configured free-capture threshold. Your hunt list supplies search locations.
- History: capped saved battle/capture records and recent in-memory activity.

Outdoor regions unlock area by area: defeating the map-entry boss does not unlock all four search areas. For example, Miscrian Jungle area 4 requires **Magicite Goremand**, so Bunaken and Light Lavarilla remain unavailable until that achievement is present. Locked saved targets are excluded from the route, while accessible alternate locations remain usable. Hover a locked portrait or check Workflow for the missing boss. Definitive server travel rejections exclude that area for the session; reconnect/reload account data or sign in again after checking access to recheck it.

Save changes before pressing Start. Pause also leaves manual battle controls available. F8 in the browser uses the same Start/Pause button. Search cooldown and spawn randomness remain server controlled.

**Clear all targets** in Hunt & capture empties the hunt list in one click. Save hunt settings to apply; the button is disabled when the list is empty.

Normal item-drop and cooldown responses keep the hunt running. Other rejected requests pause with the request name, search location and any server explanation in the activity log. If no explanation was supplied, the log says so. After updating/restarting the backend, sign in again; any active server battle is restored.

In Hunt & capture, the minimum-grade override permits lower-rated selected hunt targets. It defaults off. Capture chance, turn ownership and one-free-attempt limits still apply.

**Remove targets after a kept capture** defaults on. Only a confirmed keep removes and saves that species from the hunt list. Visible removals preserve unrelated unsaved edits. When no hunt targets remain, automation stops.

Collection progress still checks the owned roster and official Miscrits index. Automatic tier training, level-35 replacements and replacement lists have been removed from the website. Old settings and loaded profiles cannot reactivate them. See [Team management](../docs/WEB-TEAM-MANAGEMENT.md).

## Data and operation

In **Workflow**, wild healing defaults off, with a 30-virtue session budget when enabled. It heals fainted teammates between wild encounters using the normal 10-virtue endpoint. Insufficient virtue, budget exhaustion, rejected healing or unconfirmed HP stop automation. Counter reset and profile changes do not reset budget usage; a fresh sign-in/backend restart does. Campaign retains its existing two-fainted healing rule.

Profiles save only validated preferences in `data/profiles.json`; they contain no game session or credentials. Save the current form under a name, then pause/finish any battle before loading another profile. Loading saves settings but never starts automation. Saving the same name replaces its profile. In-app alerts cover kept 17+ captures, completed training, stops and connection failures. Browser notifications need an explicit button click/permission and an open page; after closing it, recent alerts remain available from the backend but no desktop push is sent. Session stats count submitted search requests, observed encounters, free capture requests, confirmed keeps/duplicates, wins, flees, earned-XP levels, server-awarded team XP and confirmed heal expenditure. Elapsed time includes pauses. Counts reset at sign-in/backend restart or via Reset counters while paused and outside battle.

Collection completion checks every owned copy and the loaded official index: a level-30+ copy or captured fourth evolution marks its family complete, including a released old copy. Missing means absent from the current owned roster, so a family can be missing and historically complete. If the index is unavailable, historical completion is labeled unconfirmed. Data comes from the latest account snapshot and updates when the backend reloads the roster after gameplay. No account data is invented while signed out. Filters remain set while data updates. This frontend update needs only a browser refresh; it does not require restarting the backend or signing out.

The backend binds to `127.0.0.1` on this PC. This release is a local website, not a hosted public domain. A hosted version needs a separate persistent server capable of running Node and maintaining the game socket; static website hosting alone cannot run this backend.

Storage limits are separate: this browser project may use up to **10 GB**; the original script package (excluding `Miscrits-Web`) remains capped at **2 GB**. The release verifier measures and enforces both limits.

Passwords are forwarded only to the official HTTPS authentication endpoint and never written to files, logs, or browser storage. Game sessions remain in backend memory. The first browser session owns the local backend until it restarts. Its HttpOnly/SameSite cookie now survives browser close for seven days, renewed when reopening the website, so background automation can be reopened in the same browser/profile. This cookie is separate from the game password/tokens. A stale tab refreshes its local browser token automatically after a backend restart or another tab reconnects, retrying once only when the local session check rejected the request before execution. Game/network failures are not replayed. If another browser/profile owns the backend, use its original window; to switch, finish any battle, stop the website backend and launch it in the preferred browser. Sign out clears the game connection. Settings and capped history use `data/settings.json` and `data/history.json`. Native game settings are imported once as preferences and are never overwritten.

The Node 22 runtime is included, with its official license and verified checksum. The small `ws` WebSocket library is bundled in `vendor/ws`, with its license and verified npm integrity record. The React frontend is already built in `dist/`, so the normal Windows launcher still needs no npm installation. The mapping catalog is read from the sibling installer source. Keep this directory in the supplied package.

### React frontend development

The UI uses React 19, Vite 8 and React Icons. Dark mode is the default; the theme button remembers an explicit light/dark choice on this device. Source components live in `src/App.jsx`, `src/Workspace.jsx` and `src/panels/`, with semantic appearance tokens in `src/styles.css`. `src/base.css` retains the existing automation layout primitives. `src/controller.js` preserves the existing API, policies, form handling and dynamic result rendering while React supplies the component tree. Credentials are never stored in browser storage.

Use Node 22.12+ (the bundled runtime qualifies). Install dependencies with `npm ci`, then run `npm run build` to update the packaged `dist/` files. With the backend running on port 4318, `npm run dev` serves the frontend at `http://127.0.0.1:5173` and proxies `/api` to it. The proxy translates this exact loopback development origin; foreign origins retain the backend's normal rejection. `npm test` runs offline policy and server checks. After a production build, `npm run test:ui` runs isolated Chrome checks for themes, navigation, preserved form values, catalog filters, login dismissal and mobile layouts without signing into the game. Google Chrome must be installed for the UI suite.

If the system Node is older than required, run `runtime\node.exe node_modules\vite\bin\vite.js build` or `runtime\node.exe --test test/*.test.mjs` directly. The existing `Launch Miscrits Website.cmd` continues to serve the prebuilt frontend on port 4318; refresh the browser to load UI updates.

Connections use WebSocket control-frame ping/pong, matching the native client. JSON ping messages are not sent: live tests showed that the game closes those connections. A short disconnect triggers up to three reconnection attempts using the in-memory refresh token and the current official server address. Player data and an active battle are loaded again from the server. Automation stays paused; unresolved game mutations are never resent. Expired sessions expose a working Sign in button; exhausted recovery attempts expose Reconnect. Signing out clears the session and cancels recovery.

Tests: `runtime\node.exe --test test/*.test.mjs` from this directory. Tests use isolated mock accounts and servers; they do not log in to the user's game account or spend currency.

## Verification limits

All 172 offline protocol, connection, policy, HTTP, frontend wiring and state-machine tests pass. The user confirmed login and manual browser controls. Live checks with the authorized dummy account also verified stable connection/recovery, a fresh wild search, weakening/capturing/keeping Cubsprout at the normal 70% threshold, fleeing after a failed free capture, and one campaign stage victory whose progress appeared in the next login. These gameplay tests spent no virtue or platinum. See `docs/WEB-GAMEPLAY-FIX.md` and `docs/validation/web-gameplay-*.json`.

The dummy team's levels were 30 and 1, with no fainted members, so level-35 replacement and two-fainted-teammate virtue healing were tested with mocks rather than forced live mutations. Other campaign stages and special ability combinations still need live coverage. Browser automation was unavailable in the coding session, so rendered desktop/mobile layout has not yet been visually verified.

Source updates are loaded when the backend starts. Use Stop Miscrits Website.cmd followed by Launch Miscrits Website.cmd after an update. Sign in once after restarting the backend; temporary network recovery does not require entering the password again while the refresh token remains valid.

This version focuses on hunting, battles, arenas, campaign, earned-XP training, and replacements. It does not port the native game's full animated world, shop, inventory management, paid/token training, platinum bonus upgrades, Google/Apple/Steam sign-in, or every special ability effect. Unexpected or unsupported battle responses pause automation instead of repeating requests. A timed-out mutation blocks restart until sign-out/sign-in checks server state. Arena protocol and state transitions were verified offline against native source, but live arena matchmaking/PvP and rendered layout are not yet verified.

## Capture grades and server search limits (v16)

Capture rules show selectable grade badges using the native mapping: F- 6, F 7, F+ 8, D 9, D+ 10, C 11, C+ 12, B 13, B+ 14, A 15, A+ 16, S 17, S+ 18. Any uses the existing minimum of 0. Legacy numeric thresholds are preserved. The chosen threshold is still stored as a number. Modes that ignore the minimum disable those badges and explain why. The advanced minimum-grade override permits selected targets at any grade; training eligibility still requires S or S+.

Wild searches default to 8 seconds between cycles instead of 3. Change **Seconds between searches** in Advanced capture settings (3-120 seconds). Search-object cooldowns remain separate. Battle controls and campaign/arena timing are unchanged.

`create_battle` daily-limit messages come from the server's `limit` response flag, not a local search counter. The native client also displays a daily-limit message for this flag. Its response does not establish whether the quota is per object, species or account, nor its count or reset time. A limit pauses automation for review and excludes the reported object for the session, including after account polling/reconnection. Other targets may also be affected. Slower pacing does not clear a quota. Unknown/disabled/uncertain failures still pause. No live searches were made to test rate limits.

The specific catalog entry sunfall_shores / area 4 / object 46 is Peepsie's rainbow turtle eggs. That object identity alone does not establish why the server rejected the user's searches.
