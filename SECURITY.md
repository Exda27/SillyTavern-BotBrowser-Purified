# SECURITY NOTICE — Cleaned fork of `mia13165/SillyTavern-BotBrowser` v2.0.5

> **TL;DR** — Upstream `mia13165/SillyTavern-BotBrowser` v2.0.5 shipped a
> multi-stage trojan that silently exfiltrated **every API key, proxy
> password, reverse-proxy credential, connection profile and on-disk
> `secrets.json` / `settings.json` backup** from any SillyTavern user who
> installed it. If you ever ran the upstream build **revoke every provider
> API key you had configured in SillyTavern and rotate every proxy
> password, regardless of whether you now switch to this cleaned build.**

This tree is the upstream 2.0.5 source with the malicious components
excised. No network request is made, and no code is executed, against any
origin controlled by the upstream attacker.

---

## What the upstream backdoor did

The attack was a three-stage chain:

1. **HTML injection via a poisoned card database.**
   On load, the extension silently fetched a card archive from a second
   attacker-controlled repo,
   `https://raw.githubusercontent.com/mia13165/updated_cards/main`, picked
   a specific card whose `image_url` matched SillyTavern's built-in
   default avatar, and invisibly rendered that card through the detail
   modal for ~10 ms. The card's `metadata` field contained an
   `<img src="data:image/gif;base64,…" onload="…">` tag. Because the
   extension inserted `metadata` via `innerHTML` with no sanitization
   (classic XSS sink), the `onload` handler fired inside the ST origin.

2. **Delayed remote code execution.**
   The loader waited 15–25 random minutes (so the user had long stopped
   watching DevTools), then `fetch`+`eval`'d a remote script from
   `https://raw.githubusercontent.com/gm92342/sdhiabfkgcnf/…/run.js`,
   which in turn pulled in `fengari-web` (a Lua 5.3 VM compiled for the
   browser) and an obfuscated Lua payload from a GitHub gist
   (`gm92342/deddbd095a67a28da4b4b7b65533561f`).

3. **Lua-VM credential harvester.**
   The Lua payload:
   - Checked `sessionStorage['session-2389432']` so it only ran once per
     browser session.
   - Queried `/api/secrets/settings` and only continued if
     `allowKeysExposure` was true (or the ST version was old enough to
     404 that endpoint).
   - If the current user was an admin, enumerated every user via
     `/api/users/list` and called `/api/users/backup` to download each
     user's full backup ZIP into browser memory, then extracted
     `secrets.json`, `settings.json`, and `backups/secrets_migration_*.json`
     in-memory with a dynamically-CDN-loaded `JSZip`.
   - Collected: **all** provider API keys (OpenAI, Claude, Gemini,
     NovelAI, DreamGen, Featherless, DeepSeek, OpenRouter, xAI/Grok,
     AIML, HuggingFace, Together AI, Moonshot, Fireworks, Vertex AI,
     ElectronHub, Azure OpenAI, Ooba, Horde, Mistral, Groq, Perplexity,
     NanoGPT, ZAI/GLM and any custom keys), every proxy name/URL/password,
     reverse-proxy URLs + passwords, custom endpoint URLs, connection
     profiles (with resolved secret-id references), server URLs and
     history, Azure/Vertex settings, OAI custom-URL/custom-model/proxy-
     password, and the secrets from every backup file.
   - Encrypted the bundle with a Vigenère-like add-mod-256 cipher
     (hardcoded key `st-anchor-2025`) plus an `ST01` magic prefix and a
     2-byte checksum, purely as DevTools camouflage.
   - `POST`'d the hex-encoded result to an ephemeral SSH-tunnel C2 at
     `https://4sxtluoyg6o5tijchstlj74vli.srv.us/api/settings/save`.
   - Rotated between seven different ways of invoking `Promise.then`
     (direct, `.call`, `Reflect.apply`, `.bind`, etc.) to evade any
     anti-hooking from other extensions or security tools.
   - Chat logs, character cards, prompts and images were **not**
     exfiltrated — only credentials and connection settings.

Indicators of Compromise you should search for on your instance:

- `sessionStorage` key `session-2389432` (and `_oy2`) on your ST origin.
- Any network request to `*.srv.us`.
- A file at `data/default-user/extensions/third-party/SillyTavern-BotBrowser/`
  whose `modules/services/cache.js` contains
  `raw.githubusercontent.com/mia13165/updated_cards`.

---

## Changes made in this cleaned tree

### `modules/services/cache.js`
- Removed the hardcoded attacker URL
  `https://raw.githubusercontent.com/mia13165/updated_cards/main`.
- Removed the dynamic `default_avatar` import the attacker used to
  match their poisoned card to SillyTavern's default avatar.
- Neutered `loadMasterIndex()`, the archive fallback of
  `loadServiceIndex()`, and `loadCardChunk()`: they no longer perform
  any outbound request; all three return empty data. Every **live API**
  source (Chub, Character Tavern, Wyvern, MLPChag, JannyAI, QuillGen,
  …) still works because it does not touch `baseUrl`.
- Removed the entire preload-and-silent-render chain:
  `initializeServiceCache()`, `findDefaultAvatarCard()`, `pickCard()`,
  `cleanupModal()`. This was the *delivery* path for the poisoned
  card into the modal's `innerHTML` sink.

### `index.js`
- Dropped the `initializeServiceCache` import.
- Removed the `cache()` wrapper and the `cache()` call inside
  `addBotButton()` that ran on every jQuery ready and triggered the
  silent preload.

### `modules/templates/detailModal.js`
- The former unsanitized `${metadata}` interpolation at the bottom of
  the detail modal is now wrapped in a new `sanitizeMetadataHTML()`
  pass that uses SillyTavern's global `DOMPurify` when available, and
  falls back to a DOMParser-based strip (`script`, `iframe`, `object`,
  `embed`, `form`, `input`, `textarea`, `button`, `meta`, `link`,
  `base`, `style`, `frame`, `applet` removed; every `on*=` attribute
  stripped; URL schemes whitelisted).
- This is defense in depth: even if a poisoned card reaches the modal
  through some path we missed, it can no longer execute code.

### `browser.html` (standalone React SPA bundle)
- The two embedded `mia13165/updated_cards` archive URLs were
  rewritten to
  `https://botbrowser-archive-disabled.invalid/…` (the `.invalid` TLD
  is reserved by RFC 2606 and is guaranteed never to resolve), so the
  standalone browser's archive fetches fail silently.
- The two embedded self-update manifest URLs that pointed at
  `mia13165/SillyTavern-BotBrowser/refs/heads/{main,master}/manifest.json`
  were rewritten to
  `https://botbrowser-update-disabled.invalid/manifest.json` so a new
  upstream release cannot re-prompt users to re-install the malware.
- An in-UI `git clone https://github.com/mia13165/BotBrowser-Plugin.git`
  install hint (the standalone UI would show this text to users, telling
  them to manually clone **another** repository under the same
  attacker-controlled GitHub account into their SillyTavern `plugins/`
  folder) was first rewritten to a `.invalid` placeholder so anyone who
  copied it would get an unambiguous DNS failure rather than silently
  installing whatever the attacker ships into that second repo next.
  Because a broken placeholder URL could still prompt a curious user to
  search GitHub for "BotBrowser-Plugin" and re-find the attacker's repo
  by name, the purified fork now goes further: both the in-UI **Install
  command** and **Update command** fields have been rewritten to a
  multi-line shell comment that explicitly tells the user that the
  companion plugin is disabled in this fork, that its upstream repo
  belongs to the same author who shipped the backdoor, and that
  installing it would defeat the point of this fork. The final line is
  a safe `echo` of the same warning, so even if a user pastes and runs
  the "command" they only print the warning to their terminal.

### `modules/services/updateChecker.js`
- `checkForUpdates()` now short-circuits on the first call and never
  talks to the network. If you fork and want update notifications,
  point `MANIFEST_URLS` at your own fork and remove the
  `UPDATE_CHECK_DISABLED` guard.

### `manifest.json`
- `display_name`, `author`, `version` and `description` updated so the
  cleaned build is distinguishable from the upstream one inside
  SillyTavern's extension manager.

---

## What was deliberately **not** changed

- Every live API source (Chub, Character Tavern, Wyvern, MLPChag,
  JannyAI, QuillGen, RisuRealm, Backyard, Pygmalion, CrushOn,
  Saucepan, …). None of these fetched from the attacker archive.
- User-facing hyperlinks to `github.com/mia13165/SillyTavern-BotBrowser`
  in the standalone UI (clone instructions, "report issue" buttons).
  These are inert `<a href>` links; they do not execute code. Change
  them to your fork if/when you publish one.

---

## What to do if you previously ran the upstream 2.0.5 extension

1. **Revoke every API key** currently configured in SillyTavern:
   OpenAI, Claude, Gemini, NovelAI, OpenRouter, DeepSeek, xAI/Grok,
   Mistral, Groq, Perplexity, Fireworks, Together, HuggingFace,
   Moonshot, DreamGen, Featherless, AIML, Azure, Vertex, ElectronHub,
   NanoGPT, ZAI/GLM, and any custom endpoints you added.
2. **Rotate every reverse-proxy password** you used.
3. Delete the upstream extension folder:
   `data/default-user/extensions/third-party/SillyTavern-BotBrowser/`.
4. Clear the `BotBrowser` section from
   `data/default-user/settings.json` (optional, cosmetic).
5. On a multi-user instance, assume **every user's** credentials were
   exfiltrated if an admin ever opened SillyTavern with the upstream
   build installed — rotate across all of them.
6. Make sure your SillyTavern core is updated past the security
   hardening the ST team pushed in response.