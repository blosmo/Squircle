import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Contains only customer-safe fields. Internal agent conversations never leave the gateway.
public struct FeedbackReceipt: Codable, Sendable {
    public struct Result: Codable, Sendable { public let summary: String }
    public let id: String
    public let state: String
    public let created: String
    public let result: Result?
}

public struct FeedbackRequest: Codable, Sendable {
    public enum Kind: String, Codable, Sendable { case bug, idea }
    public let requestID: String
    public let kind: Kind
    public let text: String
    public let context: [String: String]
    /// Keep this value when retrying after a lost connection to avoid duplicate tasks.
    public init(kind: Kind, text: String, context: [String: String] = [:], requestID: String = UUID().uuidString) {
        self.kind = kind; self.text = text; self.context = context; self.requestID = requestID
    }
}

public struct FeedbackClient: Sendable {
    public enum Failure: Error { case invalidEndpoint, rejected(Int) }
    private let endpoint: URL
    private let session: URLSession
    private let token: @Sendable () async throws -> String
    /// Supply a short-lived session from your backend, never a Squircle or admin token.
    public init(endpoint: URL, session: URLSession = .shared, token: @escaping @Sendable () async throws -> String) throws {
        guard endpoint.scheme == "https" || (endpoint.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(endpoint.host ?? "")) else { throw Failure.invalidEndpoint }
        self.endpoint = endpoint; self.session = session; self.token = token
    }
    public func submit(_ feedback: FeedbackRequest) async throws -> FeedbackReceipt {
        try await perform(path: "v1/feedback", payload: JSONEncoder().encode(feedback))
    }
    public func status(id: String) async throws -> FeedbackReceipt {
        guard UUID(uuidString: id) != nil else { throw Failure.rejected(400) }
        return try await perform(path: "v1/feedback/\(id)", payload: nil)
    }
    private func perform(path: String, payload: Data?) async throws -> FeedbackReceipt {
        var request = URLRequest(url: endpoint.appendingPathComponent(path))
        request.httpMethod = payload == nil ? "GET" : "POST"
        request.httpBody = payload
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(try await token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw Failure.rejected((response as? HTTPURLResponse)?.statusCode ?? 0) }
        return try JSONDecoder().decode(FeedbackReceipt.self, from: data)
    }
}
