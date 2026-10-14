# Pawplay

A touch game for cats. Fish, mice and butterflies move across the screen, and your cat catches them with a paw.

**Play:** https://millad1997.github.io/pawplay/

## How it works

1. Choose **Fish Pond**, **Mouse Chase** or **Butterfly Garden**.
2. Set speed, target size, session length and sound. Pawplay remembers these on the device.
3. Press **Start**, then lay the device flat beside your cat.
4. Targets dart, freeze and wander like prey. A paw touch makes a splash, puff or sparkle, and a new target comes in from the edge.
5. To pause, **hold the ⏸ button for 2 seconds**. A quick paw tap won't stop the game.
6. The finish screen shows targets caught and time played, with **Replay** and **Choose another game**.

There are no ads, purchases or rating prompts, and it works offline after the first visit.

## Put it on an iPhone or iPad

1. Open the link above in Safari.
2. Tap **Share › Add to Home Screen**. It now opens full-screen, like an app.
3. Optional: to keep the cat inside the game, turn on **Settings › Accessibility › Guided Access**, open Pawplay, and triple-click the side (or Home) button.

## Project layout

```
web/    the game: plain HTML, CSS and JS, no build step
ios/    SwiftUI app that wraps web/ for the App Store
.github/workflows/pages.yml   deploys web/ to GitHub Pages on every push to main
```

### Run the web game locally

```bash
python3 -m http.server 8765 --directory web
```

Then open http://localhost:8765. Add `?debug=1` to expose `window.__pawplay` for testing.

### Build the iOS app

The iOS project **has not been built yet**. It was written on a Mac without Xcode, so expect to fix small issues on the first build.

1. Install Xcode from the Mac App Store.
2. Open `ios/Pawplay.xcodeproj`.
3. Under **Signing & Capabilities**, pick your team and change the bundle ID from `com.example.pawplay` to your own.
4. Run on an iPhone or iPad. The app bundles the `web/` folder, so any change to the web game is picked up on the next build.

On real devices, check: touch response, rotation, pause and resume, backgrounding, offline play, and battery use.

## Path to the App Store

1. **Test with cats.** Start at home, then recruit 15–20 households. Note which modes and settings get paws moving, whether owners can start without help, and whether they come back.
2. **Test willingness to pay.** Compare $2.99 and $4.99 upfront. Free alternatives exist, so be clear about why owners would pick this one.
3. **Finish the native app** (above) and test it on real iPhones and iPads.
4. **Run a TestFlight beta.** External testers need Apple's beta review.
5. **Prepare the storefront:** final name, real screenshots and a gameplay video, support and privacy info, and the upfront price.
6. **Launch with videos of your own cats** playing every mode.
7. **Measure:** paid downloads, refunds, crashes, feedback and repeat use. Improve movement and controls before adding games.

The Apple Developer Program costs $99 a year.
