import SwiftUI

@main
struct PawplayApp: App {
    var body: some Scene {
        WindowGroup {
            GameWebView()
                .ignoresSafeArea()
                .background(Color(red: 1.0, green: 0.969, blue: 0.925))
                .statusBarHidden(true)
                // Make it harder for a paw to trigger Home or Control Center.
                .persistentSystemOverlays(.hidden)
                .defersSystemGestures(on: .all)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        }
    }
}
