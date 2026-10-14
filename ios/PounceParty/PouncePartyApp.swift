import SwiftUI

@main
struct PouncePartyApp: App {
    var body: some Scene {
        WindowGroup {
            GameWebView()
                .ignoresSafeArea()
                .background(Color("LaunchBackground"))
                .statusBarHidden(true)
                // Make it harder for a paw to trigger Home or Control Center.
                .persistentSystemOverlays(.hidden)
                .defersSystemGestures(on: .all)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        }
    }
}
