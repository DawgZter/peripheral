import XCTest
@testable import PeripheralFrame

final class PeripheralFrameTests: XCTestCase {
    func testAssistantTextFrameMatchesKnownBuilderShape() {
        let frame = PeripheralFrame.assistantText("Peripheral listening...", slot: 2)
        let bytes = Array(frame)
        XCTAssertEqual(bytes.count, 508)
        XCTAssertEqual(bytes[8], 0x07)
        XCTAssertEqual(bytes[9], 0x04)
        XCTAssertEqual(bytes[10], 0xf0)
        XCTAssertEqual(bytes[11], 0x01)

        let crc = UInt16(bytes[4]) | (UInt16(bytes[5]) << 8)
        XCTAssertEqual(crc, 0x931c)
    }

    func testCapturedInnerCrcStillMatches() {
        let capturedInnerPrefix = "0704f00107000200000000004e494d4fe5908ce5ada6e6ada3e59ca8e88186e590ac7e"
        let capturedInner = capturedInnerPrefix.padding(toLength: 1000, withPad: "0", startingAt: 0)
        XCTAssertEqual(PeripheralFrame.crc16Ccitt(hexToBytes(capturedInner)), 0x624d)
    }

    private func hexToBytes(_ value: String) -> [UInt8] {
        var output: [UInt8] = []
        var index = value.startIndex
        while index < value.endIndex {
            let next = value.index(index, offsetBy: 2)
            output.append(UInt8(value[index..<next], radix: 16) ?? 0)
            index = next
        }
        return output
    }
}
