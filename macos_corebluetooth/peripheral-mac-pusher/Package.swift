// swift-tools-version: 5.8

import PackageDescription

let package = Package(
    name: "PeripheralMacPusher",
    platforms: [
        .macOS(.v11),
    ],
    products: [
        .executable(name: "peripheral-mac-pusher", targets: ["PeripheralMacPusher"]),
        .library(name: "PeripheralFrame", targets: ["PeripheralFrame"]),
    ],
    targets: [
        .target(name: "PeripheralFrame"),
        .executableTarget(
            name: "PeripheralMacPusher",
            dependencies: ["PeripheralFrame"]
        ),
        .testTarget(
            name: "PeripheralMacPusherTests",
            dependencies: ["PeripheralFrame"]
        ),
    ]
)
