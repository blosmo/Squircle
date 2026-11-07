#if os(iOS)
import SwiftUI

/// Present from your app's own Help or Feedback action. No injected overlays or private APIs.
@MainActor
public struct FeedbackForm: View {
    private let client: FeedbackClient
    private let context: [String: String]
    @State private var text = ""
    @State private var kind = FeedbackRequest.Kind.bug
    @State private var sending = false
    @State private var pending: FeedbackRequest?
    @State private var receipt: FeedbackReceipt?
    @State private var failed = false
    public init(client: FeedbackClient, context: [String: String] = [:]) { self.client = client; self.context = context }
    public var body: some View {
        Form {
            if receipt != nil {
                Text("Feedback received")
            } else {
                Picker("Feedback", selection: $kind) {
                    Text("Report a problem").tag(FeedbackRequest.Kind.bug)
                    Text("Suggest an idea").tag(FeedbackRequest.Kind.idea)
                }
                TextEditor(text: $text).frame(minHeight: 160).accessibilityLabel("Your feedback")
                if failed { Text("Couldn’t confirm delivery. Try sending again.").foregroundStyle(.red) }
                Button(sending ? "Sending…" : "Send feedback") {
                    let report = pending ?? FeedbackRequest(kind: kind, text: text, context: context)
                    pending = report; sending = true; failed = false
                    Task {
                        defer { sending = false }
                        do { receipt = try await client.submit(report) } catch { failed = true }
                    }
                }.disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.count > 8000)
            }
        }
        .disabled(sending)
        .navigationTitle("Feedback")
        .onChange(of: text) { _ in pending = nil }
        .onChange(of: kind) { _ in pending = nil }
    }
}
#endif
