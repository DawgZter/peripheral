import Foundation

public enum PeripheralFrame {
    public static let maxAssistantTextBytes = 488

    public static func displayMode(_ mode: UInt8 = 0x07) -> Data {
        command(group: 0x07, command: 0x01, payload: [mode, 0x00])
    }

    public static func assistantText(_ input: String, slot: UInt8 = 0) -> Data {
        let text = trimUtf8(input.trimmingCharacters(in: .whitespacesAndNewlines), maxBytes: maxAssistantTextBytes)
        let finalText = text.isEmpty ? "Hello from Mac" : text
        return assistantTextPayload(finalText, slot: slot)
    }

    public static func clearAssistantText(slot: UInt8 = 0) -> Data {
        assistantTextPayload(String(repeating: "\u{200B}", count: 8), slot: slot)
    }

    private static func assistantTextPayload(_ text: String, slot: UInt8) -> Data {
        let textBytes = Array(text.utf8)

        var payload = [UInt8](repeating: 0, count: 496)
        payload[0] = 0x07
        payload[1] = 0x00
        payload[2] = slot
        payload[3] = 0x00
        payload[4] = slot == 0 ? 0x01 : 0x00
        payload[5] = 0x00
        payload[6] = 0x00
        payload[7] = 0x00
        payload.replaceSubrange(8..<(8 + textBytes.count), with: textBytes)

        return command(group: 0x07, command: 0x04, payload: payload)
    }

    public static func postSequence(displayMode mode: UInt8 = 0x07) -> [Data] {
        [
            command(group: 0x03, command: 0x03, payload: [0x0a]),
            command(group: 0x07, command: 0x07, payload: [mode]),
        ]
    }

    public static func initialBurst(displayMode mode: UInt8 = 0x07) -> [Data] {
        [
            command(group: 0x03, command: 0x01, payload: timePayload()),
            command(group: 0x02, command: 0x16, payload: []),
            command(group: 0x08, command: 0x06, payload: []),
            command(group: 0x02, command: 0x06, payload: []),
            command(group: 0x02, command: 0x0a, payload: []),
            command(group: 0x02, command: 0x02, payload: []),
            command(group: 0x02, command: 0x0f, payload: []),
            command(group: 0x02, command: 0x14, payload: []),
            command(group: 0x02, command: 0x0e, payload: []),
            command(group: 0x02, command: 0x0d, payload: []),
            command(group: 0x03, command: 0x18, payload: [0x01]),
            command(group: 0x03, command: 0x0c, payload: [0x00]),
            command(group: 0x03, command: 0x19, payload: [0x01, 0x01]),
            command(group: 0x03, command: 0x14, payload: [0x02]),
            displayMode(mode),
        ]
    }

    public static func command(group: UInt8, command: UInt8, payload: [UInt8]) -> Data {
        let dataLength = payload.count
        let innerLength = 4 + dataLength
        var frame = [UInt8](repeating: 0, count: 8 + innerLength)

        frame[0] = 0xbf
        frame[1] = 0x02
        frame[2] = UInt8(innerLength & 0xff)
        frame[3] = UInt8((innerLength >> 8) & 0xff)
        frame[6] = 0x00
        frame[7] = 0x00
        frame[8] = group
        frame[9] = command
        frame[10] = UInt8(dataLength & 0xff)
        frame[11] = UInt8((dataLength >> 8) & 0xff)
        frame.replaceSubrange(12..<(12 + payload.count), with: payload)

        let crc = crc16Ccitt(Array(frame[8..<(8 + innerLength)]))
        frame[4] = UInt8(crc & 0xff)
        frame[5] = UInt8((crc >> 8) & 0xff)
        return Data(frame)
    }

    public static func crc16Ccitt(_ bytes: [UInt8]) -> UInt16 {
        var crc: UInt16 = 0xffff
        for byte in bytes {
            crc ^= UInt16(byte) << 8
            for _ in 0..<8 {
                if (crc & 0x8000) != 0 {
                    crc = (crc << 1) ^ 0x1021
                } else {
                    crc <<= 1
                }
            }
        }
        return crc
    }

    public static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private static func trimUtf8(_ input: String, maxBytes: Int) -> String {
        var output = input
        while output.utf8.count > maxBytes && !output.isEmpty {
            output.removeFirst()
        }
        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func timePayload(date: Date = Date(), calendar: Calendar = .current) -> [UInt8] {
        let components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second, .weekday], from: date)
        let year = components.year ?? 2026
        return [
            UInt8(year & 0xff),
            UInt8((year >> 8) & 0xff),
            UInt8(components.month ?? 1),
            UInt8(components.day ?? 1),
            UInt8(components.hour ?? 0),
            UInt8(components.minute ?? 0),
            UInt8(components.second ?? 0),
            UInt8(components.weekday ?? 1),
            0x00,
        ]
    }
}
