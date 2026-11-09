# Real-phone install checklist

Physical iPhone and Android installation is **UNVERIFIED**.

Playwright, a desktop browser, a phone-sized viewport, and the screenshots from `scripts/pwa-smoke.mjs` do not complete this list. Do not mark a physical install passed from those. This stays UNVERIFIED until Micah, or a BrowserStack Live session Micah starts, does the steps below on a real phone and records the three proofs.

Starhold is not a store app. It needs a connection to play. The live site is https://starhold.stumpysgarage.workers.dev

Use an existing commander when you are checking that the save survived. Do not create a second account for that check.

## What to record

Record all three. A note with the exact words is enough; a photo or screen recording is better.

1. **Standalone launch.** The home screen icon opens Starhold without the Safari or Chrome address bar.
2. **Offline note text.** With the radio or Wi-Fi off, the page shows: `You're offline. Starhold is not playable offline, and orders are not queued on this device.`
3. **Icon present.** The home screen shows the Starhold icon, not a blank or generic shortcut.

Also write the date, phone model, OS version, and browser. After you turn the connection back on, the same commander name is still signed in, and the page says `Back online. Nothing was replayed while the connection was down.` Orders from the offline period are not sent.

## iPhone Safari

Chrome on iPhone does not install this app. Use Safari.

1. Open https://starhold.stumpysgarage.workers.dev in Safari.
2. Sign in as the commander you want to keep.
3. Tap the Share button.
4. Tap **Add to Home Screen**.
5. Confirm the name is Starhold and the icon preview is visible. Tap Add.
6. Leave Safari. Tap the new Starhold icon on the home screen.
7. Record standalone launch and that the icon is on the home screen.
8. Turn on airplane mode. Record the offline note text, exactly.
9. Turn airplane mode off. Record the back-online line and that the commander name did not change.

The in-app note, when Safari is not already installed to the home screen, says: `iPhone: open the Share menu, then tap Add to Home Screen.` There is no Install button on iPhone.

## Android Chrome

Use Chrome. The in-app **Install app** button appears only after Chrome fires its install prompt. If that button is not there, use the browser menu.

1. Open https://starhold.stumpysgarage.workers.dev in Chrome.
2. Sign in as the commander you want to keep.
3. Install with either path:
   - Tap **Install app** in the page note when Chrome shows it, or
   - Open the Chrome menu and tap **Install app** or **Add to Home screen**.
4. Confirm the icon preview, then confirm the install.
5. Open Starhold from the home screen icon, not from the Chrome tab.
6. Record standalone launch (no Chrome address bar) and that the icon is on the home screen.
7. Turn on airplane mode. Record the offline note text, exactly.
8. Turn airplane mode off. Record the back-online line and that the commander name did not change.

## Result

| Check | iPhone Safari | Android Chrome |
| --- | --- | --- |
| Standalone launch | UNVERIFIED | UNVERIFIED |
| Offline note text | UNVERIFIED | UNVERIFIED |
| Icon present | UNVERIFIED | UNVERIFIED |
| Same commander after reconnect | UNVERIFIED | UNVERIFIED |

Status: **UNVERIFIED**. No physical install has been recorded for this build.
