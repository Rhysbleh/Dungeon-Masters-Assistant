# Discord Scribe to Foundry

This increment extends the existing Scribe application. Discord continues to carry all voice audio. Foundry receives finalized text through an authenticated server-sent event stream (SSE); it does not implement voice chat. Node/SQLite remain the shared backend and database, so SignalR and a second Discord client/session manager are unnecessary.

## Implementation and compatibility

- Existing Manager, Recorder, Python ASR, scheduling, exports, Discord publishing and Notes remain in use.
- An opt-in HTTP service runs in the existing Node process. Migration `migrations/001-copilot.sql` extends `data/scribe.sqlite` transactionally with a checksum/version ledger.
- A SQLite trigger creates an immutable delivery event in the same transaction as a final recognition commit. The event preserves the complete final text even if Discord publishing later splits its source entry. This is delivery/evidence persistence in the same database, not a second transcription service or a second campaign database.
- New sessions snapshot the current pairing. Historical/ongoing unlinked sessions are never automatically adopted. Unlinking prevents delivery and capture; stop the old session and drain recognition before pairing again.
- Existing transcript retention deletes associated delivery events through cascading session foreign keys. No separate longer-lived transcript archive is created. Small association/configuration records remain; no AI world-state facts are written.
- Scribe emits finalized segments only. Event `status` is `final`; no fabricated interim speech is shown.
- The installable module v0.1.1 targets Foundry **v13 and v14**, using their public sidebar, compendium and UUID APIs. The remote setup screen was identified as v14 build 369. A local Foundry runtime and the active game system remain unavailable for in-world verification. The manifest deliberately does not assert a verified runtime version. v12 is outside this adapter's declared compatibility.

The existing local config, credentials and live database were not modified during development. Enabling the service and first starting it applies the migration. Existing deployments without a Copilot block still work. Once a database has paired channels, their consent checks continue even if the HTTP service is disabled; disabling the service must not bypass consent. Unpaired legacy channels retain the original Scribe behavior.

## Initial setup

1. Stop Scribe between sessions using the existing stop launcher. Back up the data directory while stopped, including SQLite/WAL files, plus private configuration. Keep that backup private. Do not copy only the main SQLite file while it is being written.
2. Add this optional block to your existing `config.json`; preserve every existing field:

```json
"copilot": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 47832,
  "allowedOrigins": ["http://localhost:30000"]
}
```

Use the exact browser origin of your Foundry installation, including port. For remote deployments use an HTTPS reverse proxy on this loopback service and put the HTTPS Foundry origin in allowedOrigins. The Foundry browser must be able to reach the backend. HTTPS Foundry pages cannot reliably use a plain HTTP backend. Forward Authorization and SSE without buffering; configure a proxy idle timeout longer than the ten-second stream heartbeat. Do not expose the loopback port directly or enable wildcard origins. Cookies and query-string credentials are not used.

3. The server operator verifies the intended Foundry GM's world/user IDs and intended Discord DM's guild/user IDs, then provisions a private credential while Scribe is stopped:

```powershell
.\runtime\node\node.exe scripts/copilot-admin.js provision campaign-demo "Demo Campaign" WORLD_ID FOUNDRY_GM_USER_ID DISCORD_GUILD_ID DISCORD_DM_USER_ID
```

The command creates the campaign and DM association and prints a newly generated world credential once. This credential can read that campaign/world's linked transcripts, create pairing codes, unlink, submit scene context and request/read the session journal. Give it only to the verified GM. It contains no Discord token or AI provider secret. Repeating provisioning for the same campaign/world/Foundry user rotates that credential. To authorize another DM, provision a separate verified Foundry user and Discord DM under the same campaign/world.

**Trust boundary:** Foundry client modules cannot prove their authenticated Foundry role to an unrelated HTTP server using an `isGM` field. This implementation anchors authorization in operator-provisioned, hashed, revocable GM capabilities. The module additionally checks its actual Foundry user/world and GM role, while the backend selects scope exclusively from the stored capability. It does not perform automatic Foundry account federation or server-side revalidation of subsequent Foundry role changes. Revoke credentials when a GM loses access; do not reuse a GM browser profile for players.

4. Install `foundry/dm-copilot` into Foundry's `Data/modules/dm-copilot`. The packaged ZIP has that directory at its root; extract it into `Data/modules`, then enable **Scribe DM Copilot** for your world and reload. The public installation manifest is https://raw.githubusercontent.com/Rhysbleh/Dungeon-Masters-Assistant/main/module.json.

The supplied archive is `artifacts/dm-copilot-0.1.2.zip`. Rebuild it after source edits with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-foundry.ps1`.
5. Register the full command list using the existing controller:

```powershell
.\runtime\node\node.exe --env-file-if-exists=.env src/main.js --register
```

This retains all `/session` subcommands and adds `/scribe pair`, `/scribe unlink` and `/scribe consent`. It retains the pre-existing guild-command replacement behavior, so use the dedicated Scribe application. Start Scribe using the existing launcher.

6. As the provisioned Foundry GM, open the scroll-icon **DM Copilot** sidebar, expand Connection and pairing, enter the backend URL and private world credential, then Connect. The credential is held in that GM's browser tab session storage, scoped by world/user; it is never put in shared world settings. Disconnect and forget clears it. Protect the browser profile and trust installed Foundry modules because same-origin scripts can access browser storage.

## Pair and record

### Remote HTTP Foundry with Scribe on the DM's PC

A public HTTP Foundry page can be blocked by browser local-network protection when it fetches a loopback backend. CORS alone does not authorize that access. The optional fixed-destination local reverse proxy lets the DM open the **same remote Foundry server** on a loopback browser origin; Foundry is not installed or moved locally.

For this mode, add the proxy to the existing Copilot configuration (replace the upstream example with the actual Foundry origin):

```json
"copilot": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 47832,
  "allowedOrigins": ["http://127.0.0.1:47833"],
  "foundryProxy": {
    "enabled": true,
    "port": 47833,
    "upstream": "http://foundry.example:30000"
  }
}
```

Restart Scribe between sessions. On that same PC, open **http://127.0.0.1:47833/join**, sign into the remote world as the same GM, and use **http://127.0.0.1:47833/__scribe** as the sidebar Backend URL. Copy the existing private world credential again; browser storage belongs to the new origin. The `/__scribe/v1/` routes forward to the authenticated local backend, while other HTTP routes and WebSockets forward to the fixed Foundry upstream.

The proxy listens only on loopback, rejects foreign Origin/Host headers, preserves upstream CSP and cookie security attributes, and does not create another Discord client, transcription process, database or session manager. It does not introduce a public tunnel, disable browser security or add a third-party transcript relay. It preserves the upstream transport: an HTTP Foundry server still uses HTTP between this PC and that server. Other participants continue using their usual Foundry address. Remote login and in-world behavior require a real browser check; synthetic WebSocket transport tests alone do not establish that.

1. In Foundry, Generate pairing code. The backend issues a 128-bit random code, stores its hash, and expires it after five minutes. Generating another invalidates the previous code for that credential.
2. In the configured Discord guild, redeem `/scribe pair code:CODE channel:VOICE_CHANNEL`. Only a stored campaign DM or a Discord administrator who can view/connect to that voice channel can redeem it. Codes cannot be redeemed in another guild. Competing channel/world associations must be unlinked first.
3. The existing Scribe allowlist still controls `/session` operations. A campaign DM/admin who redeems a code also needs the existing allowlist to operate sessions. New campaign checks additionally restrict paired session start, status, export, notes and lifecycle controls. Keep the existing Discord transcript channel restricted to its intended audience; the new Foundry authorization cannot change its inherited Discord thread permissions.
4. Every human participant joins the paired voice channel and personally invokes `/scribe consent allow:true`. This records permission for local audio processing, saved transcripts and delivery to the paired DM world for up to twelve hours. Consent belongs to that guild/channel and is cleared when the pairing changes. Another user cannot consent on someone's behalf.
5. Run the existing `/session start`. Every current human participant must have consented. Scribe must successfully post its disclosure in both the existing transcript thread and the voice channel's text chat before joining/capture. Grant the controller **Send Messages** in that voice channel in addition to its existing permissions. Permission failure blocks linked capture; it does not silently record.
6. New participants are excluded from audio capture until they personally consent. After consent, Scribe subscribes them if capture is active. The packet gate rechecks consent and association before accepting audio, including expiry/revocation. Withdrawing via `/scribe consent allow:false` interrupts that channel's capture. Other simultaneous sessions remain active. Resume requires all current participants to consent again where needed.

Pause/stop/interruption notices are also sent to the voice channel text chat. Already consented saved audio continues draining after stop or withdrawal; withdrawal is not retroactive deletion. Existing audio quotas and transcript retention remain applicable. Pause display in Foundry pauses only its UI and buffers up to 500 messages; use Discord `/session pause` to pause capture. No Foundry control joins voice or starts recording.

## Events, reconnects and context

Final events contain `eventId` (the stable recognition job ID), delivery `sequence`, `campaignId`, `worldId`, `linkId`, `sessionId`, `guildId`, `voiceChannelId`, `speakerId`, `displayName`, `text`, epoch-millisecond `timestamp`, `status`, `uncertain`, `sceneId` and `sceneTimestamp`.

The backend authenticates every request and periodically rechecks open stream credentials. Callers cannot choose their campaign by changing a path, query or payload. A revoked credential closes an open stream on the next check. Each credential is limited to three open streams, with a global stream cap and bounded request/pairing rates.

Foundry consumes SSE using fetch so the bearer credential stays in an Authorization header. On a dropped connection it reconnects with the last accepted sequence, ignoring duplicates and foreign link IDs. Final events remain in SQLite while Foundry is disconnected, subject to the same transcript retention. Reloading rebuilds display from backend replay. Only the last 500 segments remain in browser memory; search is explicitly over the displayed transcript. Full transcripts remain available through existing Scribe exports. There is no persistent browser transcript cache.

Scene context is submitted at connection, scene changes and approximately every 30 seconds. Events use the latest scene observation no later than the capture timestamp and no more than two minutes old; otherwise scene is null. This is sampled context, not proof that a particular action occurred in that scene. The backend does not infer NPC deaths or approve canon from speech, speculative statements or token changes.

## References and journal

Accessible compendium name indexes load sequentially and asynchronously after connection or explicit refresh, with a 50,000-name cap. Full documents load only on Open document. Matching uses normalized names, exact phrases, aliases and conservative fuzzy recognition following action cues; no AI request is made for each segment.

The panel shows source pack IDs/labels, generic document type and match confidence. Duplicate editions remain separate UUID results, including when one source is preferred. Preferences prioritize pack IDs and exclude packs; use edition-specific pack choices rather than guessing editions from names. Alias arrays can be stored under UUID keys in the GM-editable `references` world setting. Pin/unpin and dismissal are local UI operations; pins persist for that browser tab session. Dismissed suggestions reset on page reload. The source matching is deterministic and remains a suggestion, including for hypothetical speech.

The adapter checks pack visibility/OBSERVER permission when indexing and again before UUID lookup and native sheet opening; it also checks document permission. Pack contents and indexes never upload to the backend. There is no system-specific spell/monster preview in this increment because the actual game system/schema is unavailable; Open document displays the installed system's real native sheet. No spell rules, editions or mechanical fields are fabricated. Journal pages without an appropriate native sheet may report that no sheet is available.

Session summary requests reuse the existing local Notes queue and provider. The panel can refresh the evidence-linked journal. Categories and uncertainty remain intact; this is the existing incremental story journal, not a new verified whole-session narrative summarizer. It never promotes hypothetical plans into approved world state. Existing automatic notes and `/session notes` continue to work.

## Revoke, unlink and change worlds

Unlink from Foundry or `/scribe unlink channel:VOICE_CHANNEL`. Delivery stops; the recorder gate excludes further audio and active capture interrupts. Stop the old Discord session and let saved audio drain. Generate/redeem a fresh pairing, obtain participant consent again and start a new session. Old queued segments retain their original association and cannot appear in the replacement world.

To revoke a specific world/user credential:

```powershell
.\runtime\node\node.exe scripts/copilot-admin.js revoke campaign-demo WORLD_ID FOUNDRY_GM_USER_ID
```

Run administrative migration/provisioning tools between sessions. Revocation can be applied while running when immediate removal is required; it does not call recovery or create recorder clients. Removing a Discord DM's access additionally requires removing that campaign/guild/user membership from `cp_discord_dms` through an operator-controlled database administration process; no public membership editor exists yet.

## Verification and remaining acceptance

Automated tests run without real participant audio or a live Foundry license:

Executed on 25 October 2026: **41 Node tests and 10 Python tests passed**, including all 21 original Node regressions. JavaScript source syntax checks passed. Tests create disposable SQLite stores rather than modifying live campaign data.

```powershell
.\runtime\node\node.exe --test --test-concurrency=1 test/*.test.js
.\runtime\python\python.exe -m unittest discover -s test -p test_worker.py
```

The integration test uses the real Manager, Scheduler, Store, HTTP/SSE server, parser, client state and compendium adapter. Discord voice transport, ASR output and Foundry documents are controlled test doubles. Separate real-codec tests check packet gating and preserve the previous audio/decryption regressions. This is automated integration evidence, not a live eight-step acceptance claim.

On the actual Foundry v13 or v14 installation, record the exact Foundry/game-system versions and run:

1. Provision GM credentials for two campaigns/worlds; pair two different Discord voice channels in the same guild. Configure two existing recorder accounts to supply that guild's two voice slots.
2. Confirm an ordinary Foundry player sees no sidebar and cannot access a stream without a provisioned capability. Confirm another campaign's capability cannot retrieve the first world's events, summaries or session history.
3. Attempt start before consent and verify refusal. Have each participant consent, start Scribe, and verify disclosure and visible recorder presence.
4. Speak distinct phrases in each channel; confirm real recognition produces finalized, attributed text only in its paired world while existing Discord publishing remains operational.
5. Say a spell present in an installed pack; inspect source labels and click Open document. Confirm the exact UUID/native sheet, including separate 2014/2024 variants where installed. Check a plain “pick up my shield” does not trigger Shield.
6. Pause/resume display, search, pin/dismiss, disconnect/reconnect the browser, refresh the page and temporarily disconnect Foundry. Verify replay without duplicate display; Discord recording continues independently.
7. Withdraw consent or expire/revoke a world credential. Verify affected capture/stream behavior and that the other world's session continues. Unlink/relink with queued audio and verify no old-world speech enters the new association.
8. Request and refresh notes; inspect sources and hypothetical statements. Stop/restart Scribe between sessions, explicitly resume when appropriate, and verify persisted campaign links/history. Rehearse retention against a disposable database.

The backend currently shares the pre-existing process startup lifecycle, including Discord login before service initialization. A Discord outage during startup can therefore prevent the API starting; an already-running backend continues serving saved text during gateway disruption. Public deployment/TLS, live Foundry rendering and target-server capacity have not been acceptance-tested here.

## API contract

All routes require the scoped bearer credential and explicit browser-origin policy:

| Route | Purpose |
| --- | --- |
| `GET /v1/status` | Credential scope, current pairing and linked session status |
| `POST /v1/pairings` | Mint a five-minute, single-use code |
| `DELETE /v1/link` | Remove current association |
| `GET /v1/events?after=SEQUENCE` | Replay up to 100 persisted final events |
| `GET /v1/stream?after=SEQUENCE` | Live/replayed SSE, ten-second heartbeat |
| `POST /v1/scene` | Record sampled scene context, JSON sceneId |
| `POST /v1/summary` | Queue existing Notes, JSON sessionId |
| `GET /v1/summaries?sessionId=ID` | Read scoped evidence-linked journal batches |

## Public APIs checked

The implementation targets the official [v13 sidebar base](https://foundryvtt.com/api/v13/classes/foundry.applications.sidebar.AbstractSidebarTab.html), [sidebar descriptors](https://foundryvtt.com/api/v13/interfaces/foundry.SidebarTabDescriptor.html), [UI configuration](https://foundryvtt.com/api/v13/variables/CONFIG.ui.html), [compendium collection](https://foundryvtt.com/api/v13/classes/foundry.documents.collections.CompendiumCollection.html), [UUID resolution](https://foundryvtt.com/api/v13/functions/foundry.utils.fromUuid.html) and [application rendering](https://foundryvtt.com/api/v13/classes/foundry.applications.api.ApplicationV2.html). These are version-specific design references, not evidence of a live runtime test.

### v14 adapter references

The v0.1.1 patch also checks the official [v14 sidebar base](https://foundryvtt.com/api/classes/foundry.applications.sidebar.AbstractSidebarTab.html), [sidebar descriptors](https://foundryvtt.com/api/interfaces/foundry.SidebarTabDescriptor.html), [UI configuration](https://foundryvtt.com/api/variables/CONFIG.ui.html), [compendium collection](https://foundryvtt.com/api/classes/foundry.documents.collections.CompendiumCollection.html) and [UUID resolver](https://foundryvtt.com/api/functions/foundry.utils.fromUuid.html). Tests cover v13/v14 registration, player exclusion, existing custom sidebar preservation and rejection of unsupported generations. No server addresses or credentials are included in the distribution.
