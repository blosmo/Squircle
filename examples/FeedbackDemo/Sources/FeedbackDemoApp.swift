import SwiftUI
import SquircleFeedback

@main
struct FeedbackDemoApp: App {
    var body: some Scene { WindowGroup { DemoHome() } }
}

struct DemoHome: View {
    @State private var endpoint = "https://feedback.example.com"
    @State private var sessionToken = ""
    @State private var client: FeedbackClient?
    @State private var showing = false
    @State private var error = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Demo connection") {
                    TextField("Feedback endpoint", text: $endpoint).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Customer session token", text: $sessionToken)
                }
                Button("Send feedback") {
                    guard let url = URL(string: endpoint) else { error = true; return }
                    let token = sessionToken
                    do {
                        client = try FeedbackClient(endpoint: url, token: { token })
                        showing = true
                    } catch { self.error = true }
                }.disabled(sessionToken.isEmpty)
                if error { Text("Enter a valid HTTPS endpoint.").foregroundStyle(.red) }
            }.navigationTitle("Feedback demo")
                .sheet(isPresented: $showing) {
                    if let client {
                        NavigationStack {
                            FeedbackForm(client: client, context: ["appVersion": "1.0", "screen": "Demo home"])
                                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showing = false } } }
                        }
                    }
                }
        }
    }
}
