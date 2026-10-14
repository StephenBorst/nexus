# Android app — the runbook

The Android app is the live site (trade.nexustradinglabs.com) packaged for Google Play as a
Trusted Web Activity: Chrome runs the site full-screen, with no browser bar. Every deploy updates the
app; there is no second codebase. Phone alerts are Web Push (`workers/nexus-lab-api/push.mjs`).

## Status
- [x] Push alerts built, shipped dark (PR "Phone alerts…"). Off until step 1.
- [x] Manifest: brand background `#0a0a0b`, maskable icon (`public/icon-maskable-512.png`).
- [x] 1. Push key set (borst, 2026-10-11). Live-tested: Send test landed on borst's Android phone (Chrome).
- [ ] 2. D-U-N-S number + Play Console organization account (borst)
- [ ] 3. Android package from PWABuilder (borst)
- [ ] 4. `public/.well-known/assetlinks.json` with both fingerprints (Claude, from step 3's numbers)
- [x] 5a. Privacy policy page `nexustradinglabs.com/privacy` (nexus-landing PR #14)
- [x] 5b. Store listing copy + graphics: `marketing/play-store/` (icon, feature graphic, 3 phone screenshots, listing.md)
- [ ] 5c. Data safety form + listing submitted (borst)
- [ ] 6. Solana dApp Store, same package (optional second lane)

## 1. Turn push on (5 minutes, once)
In VS Code's terminal (PowerShell), from the repo:

```
cd workers/nexus-lab-api
node ../../tools/push/vapid-keys.mjs | npx wrangler secret put VAPID_PRIVATE_JWK
```

The key goes straight from the script into Cloudflare. It is never shown and never pasted.
**Run it once.** A second run makes a new key, and every device already signed up stops getting
alerts until it switches them off and on.

Check: `https://og.nexustradinglabs.com/push/config` should read `"enabled":true`. Then, in the app:
bell → PHONE ALERTS → Turn on → Send test. The test should land on the device within seconds.

## 2. Google Play account (lead time: the D-U-N-S number)
- Get the LLC's D-U-N-S number (free from Dun & Bradstreet; Play Console links to the lookup). A new
  one can take a couple of weeks.
- Play Console → create an **Organization** account under the LLC ($25 once). Organization accounts
  skip the 12-testers-for-14-days rule that new personal accounts have.

## 3. Build the Android package (PWABuilder, ~15 minutes)
1. Go to pwabuilder.com, enter `https://trade.nexustradinglabs.com`, Package for stores → Android.
2. Options (change only these):
   - Package ID: `com.nexustradinglabs.app` (permanent: it can never change after the first upload)
   - App name: `Nexus Trading Labs` · Launcher name: `Nexus`
   - Theme / background / nav bar colour: `#0a0a0b`
   - **Notification delegation: ON** (this is what routes push alerts into the app)
   - Signing key: **Create new**
3. Download the zip. It holds the `.aab` (what Play wants), a `.keystore` file and a text file with
   its passwords.
4. **The keystore + passwords are like a seed phrase.** Lose them and you can't ship updates under the
   same listing. Store them in your password manager and an offline backup. Never commit them, never
   paste them in chat.
5. Play Console → your app → Testing → Internal testing → upload the `.aab`.
6. Play Console → Setup → App integrity → **App signing**: copy the **SHA-256 certificate
   fingerprint** of the *App signing key* (Google's). Also open PWABuilder's `assetlinks.json` from
   the zip and copy its fingerprint (your upload key). Send both to Claude. They're public numbers,
   not secrets.

## 4. Prove the site and the app belong together
Claude adds `public/.well-known/assetlinks.json` with both fingerprints
(`node tools/android/assetlinks.mjs <app-signing SHA-256> <upload SHA-256>`; `tools/android/assetlinks.test.mjs`
then fails CI if the file is malformed or lists fewer than two). Until it's live, the app opens
with a browser bar on top; after, it's full-screen. Check:
`https://trade.nexustradinglabs.com/.well-known/assetlinks.json`.

## 5. Store listing
- **Financial features declaration:** non-custodial. The app connects the user's own wallet; trades
  settle on Orderly Network; Nexus never holds keys or funds.
- Copy follows `marketing/VOICE.md`. No "proven edge", no returns language.
- Graphics: 512×512 icon, 1024×500 feature graphic, phone screenshots.
- If a reviewer treats it as an exchange that needs a licence, the fallback is to leave the US, EU and
  UK out of the Play listing first. The website stays open everywhere either way.

## How push works (for whoever touches it next)
- `public/push-sw.js`: shows pushes, opens the app on tap. Scope `/push/` (no pages), no fetch
  handler, no cache. `app/main.tsx` deletes every other service worker on load; never let it delete
  this one, and never give this one a fetch handler (the old caching worker broke wallet browsers).
- Bell → PHONE ALERTS (`app/components/PushAlertsPanel.tsx`, `app/lib/pushAlerts.ts`). Turning on needs
  the Lab signature the app already holds for a day; a device belongs to the wallet that signed last.
- Server: `/push/config|subscribe|topics|unsubscribe|test` (`routes-push.mjs`). Graded calls push from
  `appendNotification` (shared.mjs). Agent opens/closes: a 5-minute cron (`runAgentWatch`) that READS
  `agent:state` and writes only `push:agentseen:*`. The first look at a wallet records a baseline.
- Topics: calls (on), agent (on), social (off: comments, follows, copies, challenges).
