// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "SquircleFeedback", platforms: [.iOS(.v16), .macOS(.v13)], products: [.library(name: "SquircleFeedback", targets: ["SquircleFeedback"])], targets: [.target(name: "SquircleFeedback", path: "packages/SquircleFeedback/Sources/SquircleFeedback")])
