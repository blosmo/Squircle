# Squircle Feedback

This fork adds an embeddable customer feedback SDK and gateway. A customer can
report a bug or suggest an idea inside your app. The gateway saves the report
and immediately sends it to that app's existing Squircle agent. In `implement`
mode the agent is asked to investigate, change code, test it and prepare work for
developer review. In `propose` mode it investigates and proposes a change.
No model runs in the gateway. T3 and Squircle still own execution.

## Components

- Root Swift package `SquircleFeedback`: iOS 16+ form, async submission and status client.
- `packages/feedback-web`: dependency-free JavaScript client, usable with web or React Native fetch.
- `packages/feedback-gateway`: Node 24+ HTTP service and durable SQLite receipts, no npm dependencies.
- `examples/FeedbackDemo`: standalone iOS example. It asks for a customer session token for testing; a shipping app obtains one from its authenticated backend.

## Run the gateway

First follow the upstream [setup](../README.md#quick-start), register your app
and configure its T3 project. Use the **project ID**, not a filesystem path or
Squircle app ID. Keep the Squircle service private.

```sh
cd packages/feedback-gateway
cp feedback.config.example.json feedback.config.json
# Edit squircleURL to match your running service and apps.my-app.project to your T3 project.
# Choose mode "implement" or "propose" explicitly for each app.
export FEEDBACK_SECRET="$(openssl rand -hex 32)"
export FEEDBACK_ADMIN_TOKEN="$(openssl rand -hex 32)"
# Set SQUIRCLE_CONTROL_TOKEN securely to your existing service control token.
node cli.mjs serve feedback.config.json
```

Keep the three credentials server-side. Persist the private database directory
across restarts; protect it and your backups as customer data. Run **one gateway
process per database**. Put the gateway behind your HTTPS reverse proxy. For web,
proxy `/v1/feedback` under your existing app origin; the gateway deliberately
does not enable cross-origin access. The admin endpoint must stay private.
The gateway defaults to loopback and never changes your network routes.

Your authenticated backend imports `issueToken` from `gateway.mjs` and issues a
one-hour session with an app ID from the configured allowlist and a pseudonymous
customer ID derived from its own authenticated session. Never accept an arbitrary
app or subject supplied by a client. Refresh via that backend when needed. For
local testing only, generate one with:

```sh
node cli.mjs token my-app demo-customer
```

## Add to iOS

Add `https://github.com/blosmo/Squircle` as a Swift Package dependency, branch
`main`, and select `SquircleFeedback`. The SDK uses public APIs and contains no
Squircle overlay, developer connection file or developer credentials.

```swift
import SquircleFeedback

let client = try FeedbackClient(endpoint: URL(string: "https://your-app.example.com")!) {
    // Your backend authenticates the current user and returns a short-lived feedback token.
    try await accountAPI.feedbackSessionToken()
}

// In your existing Help sheet or navigation stack:
FeedbackForm(client: client, context: ["screen": "Reader", "appVersion": "1.2"])

// Or build your own UI, including UIKit:
let report = FeedbackRequest(kind: .bug, text: "Audio skips when I turn the page")
let receipt = try await client.submit(report)
let progress = try await client.status(id: receipt.id)
```

Keep the same `FeedbackRequest` when retrying an uncertain submission. The form
retains it while open; a custom UI should persist it if retries must survive app
termination. Reusing a request ID with different contents returns 409.
Only pass explicitly selected, non-sensitive context. Nothing captures screenshots,
logs, audio, identity, or device data automatically.

To build the demo: `xcodegen generate --spec examples/FeedbackDemo/project.yml`,
then open its generated Xcode project. Enter the HTTPS gateway endpoint and a
test customer token, open the form, and submit a report.

## Add to web or React Native

Use a Git checkout or copy/install the `packages/feedback-web` package locally
(the npm package is not published yet).

```js
import { createFeedback } from '@squircle/feedback';
const feedback = createFeedback({
  endpoint: location.origin, // React Native: your HTTPS endpoint
  token: () => accountAPI.feedbackSessionToken(),
});
const report = {
  requestID: crypto.randomUUID(), // persist and reuse this value on retry
  kind: 'idea',
  text: 'Let me change the narrator for each chapter.',
  context: { screen: 'Reader' },
};
const receipt = await feedback.submit(report);
const progress = await feedback.status(receipt.id);
```

## Delivery and progress

`POST /v1/feedback` requires a customer bearer session and returns 202 with
`id`, `state`, `created` and `result`. `GET /v1/feedback/:id` requires the same
app and customer identity. It never returns agent threads, internal prompts or
secrets. Reports are bounded to 16 KiB, text to 8,000 characters, context to 12
short string fields, and new reports to 10 per customer per app per hour.

States: `received`, `dispatching`, `delivered`, `delivery_unknown`, `working`,
`ready`, `declined`. **Delivered means accepted by the agent, not implemented.**
Delivery errors or process termination during dispatch become `delivery_unknown`.
There are no background retry timers. An operator must check the agent's tracker
for the report ID before explicitly retrying. This avoids duplicate agent work
when the response was lost after the agent received a report.

A trusted developer integration can publish customer-safe progress:

```sh
curl -X POST "$GATEWAY/v1/admin/feedback/$REPORT_ID" \
  -H "Authorization: Bearer $FEEDBACK_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"state":"ready","summary":"The fix is ready for the next beta build."}'
```

For a reconciled undelivered report, the same private endpoint accepts
`{"action":"retry","confirmNotDelivered":true}`. Never place admin credentials
in a customer app or return internal agent output as its summary. Automatic
agent-result callbacks are not implemented; progress beyond delivery is explicit.

## Execution boundary

Customer content is delivered as untrusted data with a fixed developer policy;
it cannot choose a project, provider, model or permission mode. Existing Squircle
agent permissions still determine actual capabilities. A prompt is not a sandbox:
use restricted repository credentials and your normal review/CI controls on the
agent host. Automatic implementation prepares a change for review; this gateway
does not grant automatic merge, production deployment or App Store publishing.

## Validation

Run `node --test packages/feedback-gateway/gateway.test.mjs`, `swift build`, and
`xcodebuild -scheme SquircleFeedback -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`. Tests cover the HTTP contract, app/customer
isolation, invalid sessions, input limits, idempotency, ambiguous delivery and
restart recovery using a fake Squircle peer. These tests do not run an agent.

Initial scope: text bugs/ideas and explicit context. Screenshot attachments,
Android-native UI, hosted multi-tenant onboarding, automated result callbacks,
retention scheduling, and published npm releases are not implemented.

Validated locally on 2026-11-07: seven gateway tests passed, Swift package
built, and the iOS SDK plus FeedbackDemo built unsigned with Xcode 27.1.
A local HTTP peer verified the Squircle request/response contract. Live agent
execution, physical-device UI, and hosted deployment are not yet verified.
