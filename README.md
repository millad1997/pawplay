# Pounce Party: Games for Cats

A touch game for cats. Fish, mice and butterflies move across the screen, and your cat catches them with a paw.

**Play on the web:** https://millad1997.github.io/pawplay/

## How it works

1. Choose **Fish Pond**, **Mouse Chase** or **Butterfly Garden**.
2. Set speed, target size, session length and sound. These are remembered on the device.
3. Press **Start**, then lay the device flat beside your cat.
4. Targets dart, freeze and wander like prey. A paw touch makes a splash, puff or sparkle, and a new target comes in from the edge.
5. To pause, **hold the ⏸ button for 2 seconds**. A quick paw tap won't stop the game.
6. The finish screen shows targets caught and time played, with **Replay** and **Choose another game**.

There are no ads, purchases or accounts, and no data is collected. It works offline.

## Project layout

```
web/        the game: plain HTML, CSS and JS, no build step (also privacy.html, support.html)
ios/        SwiftUI app that bundles web/ in a WKWebView
  release.sh          archive + upload to App Store Connect
appstore/   listing text (metadata.md), screenshots, capture-screenshots.sh
.github/workflows/pages.yml   deploys web/ to GitHub Pages on every push to main
```

### Run the web game locally

```bash
python3 -m http.server 8765 --directory web
```

Then open http://localhost:8765. Add `?debug=1` to expose `window.__pawplay` for testing.

### Build the iOS app

Open `ios/PounceParty.xcodeproj` in Xcode 26 or later and run the **PounceParty** scheme. The app bundles the `web/` folder, so web changes are picked up on the next build.

## Publishing to the App Store

The app ships free under her Apple Developer account. Steps marked **(you)** need her or your Apple ID, payment or identity, so only the two of you can do them.

1. **(you) Join the Apple Developer Program.** She enrolls as an individual at https://developer.apple.com/programs/enroll/ ($99/year). The Apple Developer app on iPhone is the fastest route because it verifies ID with the camera. Approval usually takes up to 48 hours.
2. **(you) Give this Mac access.** Either she adds you in App Store Connect › Users and Access with the **Admin** role, and you sign in with your Apple ID, or she signs in on this Mac herself. Then add that Apple ID in **Xcode › Settings › Accounts**.
3. **(you) Pick a support email** and replace the placeholder in `web/support.html`.
4. **Create the app record** in App Store Connect using the values in `appstore/metadata.md`.
5. **Upload a build:** `TEAM_ID=XXXXXXXXXX ios/release.sh`. The Team ID is at https://developer.apple.com/account.
6. **Test on a real device with a real cat** through TestFlight. Internal testers don't need beta review.
7. **Fill in the listing:** text, screenshots from `appstore/screenshots/`, age rating, App Privacy ("Data Not Collected"), price (Free) and App Review notes. Everything is in `appstore/metadata.md`.
8. **(you) Submit for review.** Review usually takes 1–3 days.

## After launch

Track downloads, crashes, feedback and repeat use in App Store Connect. Improve movement and controls before adding more games.
