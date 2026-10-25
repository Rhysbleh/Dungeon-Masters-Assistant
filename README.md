# Dungeon Masters Assistant — Scribe DM Copilot

Foundry VTT module for the existing Discord Scribe application. Discord remains the voice platform; this module receives finalized transcripts from Scribe's shared backend and displays them in a GM-only sidebar.

## Install in Foundry

In Foundry's **Add-on Modules → Install Module**, paste this Manifest URL:

```text
https://raw.githubusercontent.com/Rhysbleh/Dungeon-Masters-Assistant/main/module.json
```

Install, enable **Scribe DM Copilot** for your world, and reload. This version targets **Foundry v13**. Live Foundry rendering has not yet been acceptance-tested; v12/v14 compatibility is not declared.

For manual installation, extract [dm-copilot-0.1.0.zip](https://raw.githubusercontent.com/Rhysbleh/Dungeon-Masters-Assistant/main/artifacts/dm-copilot-0.1.0.zip) into Foundry's `Data/modules` directory. The archive contains `dm-copilot/module.json` and its scripts, template and stylesheet.

## Required backend setup

This repository distributes the Foundry client. It requires the updated **existing Scribe backend**; installing the client alone does not run the Discord bot or provide transcription.

Follow the [integration and security guide](https://github.com/Rhysbleh/Dungeon-Masters-Assistant/blob/main/docs/DISCORD-FOUNDRY.md) in your existing Scribe workspace to enable its optional Copilot service, provision a private world/GM credential, register commands and pair the world with a Discord voice channel. Backend commands in that guide run from the Scribe workspace, not from this module distribution.

The backend operator must verify the intended GM before issuing a credential. Each participant personally consents using `/scribe consent allow:true` before linked capture. The existing `/session` commands and recorder capacity remain in use. A second simultaneous voice channel in one Discord server needs a second configured recorder account.

Do not put Discord tokens or AI provider keys in Foundry settings. Remote installations require an HTTPS backend endpoint and an explicitly allowed Foundry origin.

## Included

- GM-only, timestamped live transcripts with connection status, display pause and search.
- Single-use, five-minute world/channel pairing codes and scoped backend authentication.
- Persistent final-segment delivery with reconnect replay and duplicate suppression.
- Local compendium name matching, source labels, duplicate-edition choices and native document opening.
- Session-journal actions using the existing Scribe Notes queue.

Compendium contents remain in Foundry; matching does not make a paid AI request per transcript. Speech and AI interpretations do not automatically change campaign canon.

## Verification

The companion Scribe workspace passed **39 Node tests and 10 Python tests**, including the existing Scribe regressions and an automated two-world integration fixture. External Discord/ASR/Foundry boundaries were mocked in that fixture. Real live speech, Foundry rendering and native sheet opening still require acceptance on the deployed installation. Installing this module does not imply those live checks have passed.

For the exact flow, limitations, credential revocation and consent behavior, see the integration guide.
