import CoreBluetooth
import Darwin
import Foundation
import PeripheralFrame

private let serviceUUID = CBUUID(string: "00007033-0000-1000-8000-00805f9b34fb")
private let genericAttributeUUID = CBUUID(string: "00001801-0000-1000-8000-00805f9b34fb")
private let writeUUID = CBUUID(string: "00002021-0000-1000-8000-00805f9b34fb")
private let notifyUUIDs = [
    CBUUID(string: "00002025-0000-1000-8000-00805f9b34fb"),
    CBUUID(string: "00002022-0000-1000-8000-00805f9b34fb"),
    CBUUID(string: "00002002-0000-1000-8000-00805f9b34fb"),
    CBUUID(string: "00002a05-0000-1000-8000-00805f9b34fb"),
]
private let streamClearToken = "__PERIPHERAL_CLEAR__"
private let streamBrightnessPrefix = "__PERIPHERAL_BRIGHTNESS__:"
private let streamRawWritePrefix = "__PERIPHERAL_RAW_WRITE__:"
private let streamRawWriteNoResponsePrefix = "__PERIPHERAL_RAW_WRITE_NR__:"
private let streamRawWriteNoResponseFastPrefix = "__PERIPHERAL_RAW_WRITE_NR_FAST__:"
private let streamWaitAppStatusPrefix = "__PERIPHERAL_WAIT_APP_STATUS__:"

private struct RawCommand {
    let group: UInt8
    let command: UInt8
    let payload: [UInt8]
}

private struct Options {
    var text = "Hello from Mac"
    var namePrefix = "Peripheral"
    var slot: UInt8 = 0
    var displayMode: UInt8 = 7
    var timeout: TimeInterval = 25
    var scanOnly = false
    var includeInit = true
    var verboseScan = false
    var targetID = ""
    var keepScanDuringConnect = false
    var streamStdin = false
    var sniffOnly = false
    var notifyAll = false
    var readReadable = false
    var readDescriptors = false
    var replyToState = true
    var notifyLogPath: String?
    var compactNotify = false
    var writeCharUUID = writeUUID
    var textWriteType: CBCharacteristicWriteType = .withResponse
    var rawCommands: [RawCommand] = []
    var rawWrites: [[UInt8]] = []

    var namePrefixes: [String] {
        namePrefix
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    func nameMatches(_ name: String) -> Bool {
        namePrefixes.contains { name.hasPrefix($0) }
    }

    static func parse(_ args: [String]) throws -> Options {
        var options = Options()
        var index = 1
        while index < args.count {
            let arg = args[index]
            switch arg {
            case "--text":
                index += 1
                options.text = try value(args, index, arg)
            case "--name-prefix":
                index += 1
                options.namePrefix = try value(args, index, arg)
            case "--slot":
                index += 1
                options.slot = try parseByte(try value(args, index, arg), arg)
            case "--display-mode":
                index += 1
                options.displayMode = try parseByte(try value(args, index, arg), arg)
            case "--timeout":
                index += 1
                options.timeout = TimeInterval(try value(args, index, arg)) ?? options.timeout
            case "--scan-only":
                options.scanOnly = true
            case "--verbose-scan":
                options.verboseScan = true
            case "--target-id":
                index += 1
                options.targetID = try value(args, index, arg).lowercased()
            case "--keep-scan-during-connect":
                options.keepScanDuringConnect = true
            case "--stdin":
                options.streamStdin = true
            case "--sniff":
                options.sniffOnly = true
                options.includeInit = false
                options.notifyAll = true
            case "--passive-read":
                options.sniffOnly = true
                options.includeInit = false
                options.notifyAll = true
                options.readReadable = true
                options.readDescriptors = true
                options.replyToState = false
            case "--notify-all":
                options.notifyAll = true
            case "--read-readable", "--read-all":
                options.readReadable = true
            case "--read-descriptors":
                options.readDescriptors = true
            case "--no-state-reply":
                options.replyToState = false
            case "--notify-log":
                index += 1
                options.notifyLogPath = try value(args, index, arg)
            case "--compact-notify":
                options.compactNotify = true
            case "--write-char":
                index += 1
                options.writeCharUUID = try parseCharacteristicUUID(try value(args, index, arg), arg)
            case "--no-init":
                options.includeInit = false
            case "--without-response":
                options.textWriteType = .withoutResponse
            case "--with-response":
                options.textWriteType = .withResponse
            case "--raw-command", "--raw":
                index += 1
                options.rawCommands.append(try parseRawCommand(try value(args, index, arg), arg))
            case "--raw-write", "--write-hex":
                index += 1
                options.rawWrites.append(try parseHexBytes(try value(args, index, arg), arg))
            case "--help", "-h":
                printUsage()
                exit(0)
            default:
                if arg.hasPrefix("--") {
                    throw CLIError.message("Unknown option: \(arg)")
                }
                options.text = arg
            }
            index += 1
        }
        return options
    }

    private static func value(_ args: [String], _ index: Int, _ flag: String) throws -> String {
        guard index < args.count else {
            throw CLIError.message("Missing value for \(flag)")
        }
        return args[index]
    }

    private static func parseByte(_ value: String, _ flag: String) throws -> UInt8 {
        let radix = value.lowercased().hasPrefix("0x") ? 16 : 10
        let clean = radix == 16 ? String(value.dropFirst(2)) : value
        guard let parsed = UInt8(clean, radix: radix) else {
            throw CLIError.message("Invalid byte for \(flag): \(value)")
        }
        return parsed
    }

    private static func parseRawCommand(_ value: String, _ flag: String) throws -> RawCommand {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        let group: UInt8
        let command: UInt8
        let payloadText: String

        if parts.count == 2, parts[0].count == 4 {
            let commandBytes = try parseHexBytes(parts[0], flag)
            group = commandBytes[0]
            command = commandBytes[1]
            payloadText = parts[1]
        } else if parts.count == 3 {
            group = try parseFlexibleByte(parts[0], flag)
            command = try parseFlexibleByte(parts[1], flag)
            payloadText = parts[2]
        } else if parts.count == 1, parts[0].count == 4 {
            let commandBytes = try parseHexBytes(parts[0], flag)
            group = commandBytes[0]
            command = commandBytes[1]
            payloadText = ""
        } else {
            throw CLIError.message("Invalid \(flag) value. Use 020d:01, 02:0d:01, or 020d.")
        }

        return RawCommand(group: group, command: command, payload: try parseHexBytes(payloadText, flag))
    }

    private static func parseFlexibleByte(_ value: String, _ flag: String) throws -> UInt8 {
        if value.lowercased().hasPrefix("0x") {
            return try parseByte(value, flag)
        }
        guard let parsed = UInt8(value, radix: 16) ?? UInt8(value, radix: 10) else {
            throw CLIError.message("Invalid byte for \(flag): \(value)")
        }
        return parsed
    }

    private static func parseCharacteristicUUID(_ value: String, _ flag: String) throws -> CBUUID {
        let clean = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "0x", with: "", options: [.caseInsensitive])
        if clean.range(of: #"^[0-9a-fA-F]{4}$"#, options: .regularExpression) != nil {
            return CBUUID(string: "0000\(clean)-0000-1000-8000-00805f9b34fb")
        }
        if clean.range(of: #"^[0-9a-fA-F-]{36}$"#, options: .regularExpression) != nil {
            return CBUUID(string: clean)
        }
        throw CLIError.message("Invalid characteristic UUID for \(flag): \(value)")
    }

    private static func parseHexBytes(_ value: String, _ flag: String) throws -> [UInt8] {
        let cleaned = value
            .replacingOccurrences(of: "0x", with: "", options: [.caseInsensitive])
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
        if cleaned.isEmpty {
            return []
        }
        guard cleaned.count % 2 == 0 else {
            throw CLIError.message("Invalid hex payload for \(flag): \(value)")
        }

        var bytes: [UInt8] = []
        var index = cleaned.startIndex
        while index < cleaned.endIndex {
            let next = cleaned.index(index, offsetBy: 2)
            let chunk = String(cleaned[index..<next])
            guard let byte = UInt8(chunk, radix: 16) else {
                throw CLIError.message("Invalid hex payload for \(flag): \(value)")
            }
            bytes.append(byte)
            index = next
        }
        return bytes
    }
}

private enum CLIError: Error {
    case message(String)
}

private func parseStreamByte(_ value: String) -> UInt8? {
    let clean = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "0x", with: "", options: [.caseInsensitive])
    return UInt8(clean, radix: 16) ?? UInt8(clean, radix: 10)
}

private func parseStreamHexBytes(_ value: String) -> [UInt8]? {
    let cleaned = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "0x", with: "", options: [.caseInsensitive])
        .replacingOccurrences(of: " ", with: "")
        .replacingOccurrences(of: "_", with: "")
        .replacingOccurrences(of: "-", with: "")
    guard !cleaned.isEmpty, cleaned.count % 2 == 0 else {
        return nil
    }

    var bytes: [UInt8] = []
    var index = cleaned.startIndex
    while index < cleaned.endIndex {
        let next = cleaned.index(index, offsetBy: 2)
        guard let byte = UInt8(cleaned[index..<next], radix: 16) else {
            return nil
        }
        bytes.append(byte)
        index = next
    }
    return bytes
}

private func parseStreamRawWrite(_ value: String) -> (characteristic: CBUUID?, bytes: [UInt8]?) {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if let separator = trimmed.firstIndex(of: ":") {
        let characteristicText = String(trimmed[..<separator])
        let payloadText = String(trimmed[trimmed.index(after: separator)...])
        if let characteristic = parseStreamCharacteristicUUID(characteristicText),
           let bytes = parseStreamHexBytes(payloadText) {
            return (characteristic, bytes)
        }
    }
    return (nil, parseStreamHexBytes(trimmed))
}

private func parseStreamAppStatusWait(_ value: String) -> (appID: UInt8, status: UInt8, timeout: TimeInterval)? {
    let parts = value.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 2 || parts.count == 3 else {
        return nil
    }
    guard let appID = parseStreamByte(parts[0]), let status = parseStreamByte(parts[1]) else {
        return nil
    }
    let timeout = parts.count == 3 ? (TimeInterval(parts[2]) ?? 6.0) : 6.0
    return (appID, status, max(0.1, timeout))
}

private func parseStreamCharacteristicUUID(_ value: String) -> CBUUID? {
    let clean = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "0x", with: "", options: [.caseInsensitive])
    if clean.range(of: #"^[0-9a-fA-F]{4}$"#, options: .regularExpression) != nil {
        return CBUUID(string: "0000\(clean)-0000-1000-8000-00805f9b34fb")
    }
    if clean.range(of: #"^[0-9a-fA-F-]{36}$"#, options: .regularExpression) != nil {
        return CBUUID(string: clean)
    }
    return nil
}

private struct PendingWrite {
    let data: Data
    let type: CBCharacteristicWriteType
    let label: String
    let delay: TimeInterval
    let captionWrite: Bool
    let characteristicUUID: CBUUID?
    let waitAppID: UInt8?
    let waitStatus: UInt8?
    let waitTimeout: TimeInterval
    let withoutResponseFollowupDelay: TimeInterval?

    init(
        data: Data,
        type: CBCharacteristicWriteType,
        label: String,
        delay: TimeInterval,
        captionWrite: Bool,
        characteristicUUID: CBUUID?,
        waitAppID: UInt8? = nil,
        waitStatus: UInt8? = nil,
        waitTimeout: TimeInterval = 0,
        withoutResponseFollowupDelay: TimeInterval? = nil
    ) {
        self.data = data
        self.type = type
        self.label = label
        self.delay = delay
        self.captionWrite = captionWrite
        self.characteristicUUID = characteristicUUID
        self.waitAppID = waitAppID
        self.waitStatus = waitStatus
        self.waitTimeout = waitTimeout
        self.withoutResponseFollowupDelay = withoutResponseFollowupDelay
    }
}

private final class PeripheralMacPusher: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private let options: Options
    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var writeCharacteristic: CBCharacteristic?
    private var writableCharacteristics: [String: CBCharacteristic] = [:]
    private var timeoutTimer: Timer?
    private var queue: [PendingWrite] = []
    private var inFlightWithResponse = false
    private var writeScheduled = false
    private var startedWrites = false
    private var finished = false
    private var stdinReaderStarted = false
    private var stdinClosed = false
    private var discoveredNames = Set<String>()
    private var notifyLogHandle: FileHandle?
    private var notifyCounts: [String: Int] = [:]
    private var lastAppStatuses: [UInt8: UInt8] = [:]
    private var pendingAppStatusWait: (appID: UInt8, status: UInt8, timer: Timer)?
    private let logStartedAt = Date().timeIntervalSince1970
    private var inFlightWriteLabel: String?
    private var waitingForWriteWithoutResponseCapacity = false

    init(options: Options) {
        self.options = options
        super.init()
    }

    func start() {
        openNotifyLogIfNeeded()
        timeoutTimer = Timer.scheduledTimer(withTimeInterval: options.timeout, repeats: false) { [weak self] _ in
            guard let self else { return }
            if self.options.scanOnly || self.options.sniffOnly {
                self.log(self.options.scanOnly ? "Scan finished" : "Sniff finished")
                self.finishAndDisconnect()
                self.exitCleanly()
            }
            self.fail("Timed out after \(Int(self.options.timeout))s")
        }
        central = CBCentralManager(delegate: self, queue: nil)
        RunLoop.main.run()
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        log("Bluetooth state: \(stateName(central.state))")
        guard central.state == .poweredOn else {
            if central.state == .unsupported || central.state == .unauthorized || central.state == .poweredOff {
                fail("Bluetooth is \(stateName(central.state))")
            }
            return
        }

        if !options.scanOnly {
            if connectCachedTargetIfPossible(central) {
                return
            }
            if connectSystemServicePeripheralIfPossible(central) {
                return
            }
        }

        log("Scanning for Peripheral devices named \(options.namePrefixes.map { $0 + "*" }.joined(separator: ", "))")
        central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let advertisedName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let name = peripheral.name ?? advertisedName ?? "unknown"
        if options.nameMatches(name) && !discoveredNames.contains(peripheral.identifier.uuidString) {
            discoveredNames.insert(peripheral.identifier.uuidString)
            log("Discovered \(name) rssi=\(RSSI) id=\(peripheral.identifier.uuidString)")
        }

        if options.verboseScan {
            log("Advertisement \(name) id=\(peripheral.identifier.uuidString) \(advertisementSummary(advertisementData))")
        }

        guard !options.scanOnly else {
            return
        }
        guard self.peripheral == nil else {
            return
        }
        let idMatches = !options.targetID.isEmpty && peripheral.identifier.uuidString.lowercased().hasPrefix(options.targetID)
        let nameMatches = options.nameMatches(name)
        guard idMatches || nameMatches else {
            return
        }

        connect(peripheral, central: central, label: name)
    }

    private func connectCachedTargetIfPossible(_ central: CBCentralManager) -> Bool {
        guard !options.targetID.isEmpty else {
            return false
        }
        guard let targetUUID = UUID(uuidString: options.targetID) else {
            log("Target id is not a full CoreBluetooth UUID; will match during scan")
            return false
        }

        let retrieved = central.retrievePeripherals(withIdentifiers: [targetUUID])
        guard let cached = retrieved.first else {
            log("No cached CoreBluetooth peripheral for \(targetUUID.uuidString)")
            return false
        }

        log("Retrieved cached peripheral \(cached.name ?? "unknown") id=\(cached.identifier.uuidString) state=\(peripheralStateName(cached.state))")
        connect(cached, central: central, label: cached.name ?? "cached target")
        return true
    }

    private func connectSystemServicePeripheralIfPossible(_ central: CBCentralManager) -> Bool {
        let connected = central.retrieveConnectedPeripherals(withServices: [serviceUUID])
        if connected.isEmpty {
            return false
        }
        for peripheral in connected {
            log("System service peripheral \(peripheral.name ?? "unknown") id=\(peripheral.identifier.uuidString) state=\(peripheralStateName(peripheral.state))")
            let name = peripheral.name ?? ""
            if options.nameMatches(name) || connected.count == 1 {
                connect(peripheral, central: central, label: name.isEmpty ? "system service peripheral" : name)
                return true
            }
        }
        return false
    }

    private func connect(_ peripheral: CBPeripheral, central: CBCentralManager, label: String) {
        guard self.peripheral == nil else {
            return
        }
        self.peripheral = peripheral
        peripheral.delegate = self
        if !options.keepScanDuringConnect {
            central.stopScan()
        }
        log("Connecting to \(label) id=\(peripheral.identifier.uuidString) state=\(peripheralStateName(peripheral.state))")
        central.connect(peripheral, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        let serviceFilter: [CBUUID]? = shouldDiscoverAllServices ? nil : [serviceUUID, genericAttributeUUID]
        log(shouldDiscoverAllServices ? "Connected. Discovering all services" : "Connected. Discovering Peripheral services")
        peripheral.discoverServices(serviceFilter)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        fail("Failed to connect: \(error?.localizedDescription ?? "unknown error")")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        if finished {
            exitCleanly()
        } else {
            fail("Disconnected: \(error?.localizedDescription ?? "no error detail")")
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            fail("Service discovery failed: \(error.localizedDescription)")
        }
        for service in peripheral.services ?? [] {
            if service.uuid == serviceUUID {
                log("Found Peripheral service 7033")
            } else if service.uuid == genericAttributeUUID {
                log("Found Generic Attribute service")
            } else {
                log("Found service \(service.uuid.uuidString)")
            }

            if shouldDiscoverAllServices || service.uuid == serviceUUID || service.uuid == genericAttributeUUID {
                peripheral.discoverCharacteristics(nil, for: service)
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let error {
            fail("Characteristic discovery failed: \(error.localizedDescription)")
        }

        for characteristic in service.characteristics ?? [] {
            log("Characteristic service=\(service.uuid.uuidString) char=\(characteristic.uuid.uuidString) props=\(properties(characteristic.properties))")
            if characteristic.properties.contains(.write) || characteristic.properties.contains(.writeWithoutResponse) {
                writableCharacteristics[characteristic.uuid.uuidString.uppercased()] = characteristic
            }

            if options.readReadable && characteristic.properties.contains(.read) {
                log("Reading \(characteristic.uuid.uuidString)")
                peripheral.readValue(for: characteristic)
            }

            if options.readDescriptors {
                log("Discovering descriptors for \(characteristic.uuid.uuidString)")
                peripheral.discoverDescriptors(for: characteristic)
            }

            if characteristic.uuid == options.writeCharUUID {
                writeCharacteristic = characteristic
                log("Found selected write characteristic \(characteristic.uuid.uuidString) props=\(properties(characteristic.properties))")
                log("Max write with response: \(peripheral.maximumWriteValueLength(for: .withResponse)) bytes")
                log("Max write without response: \(peripheral.maximumWriteValueLength(for: .withoutResponse)) bytes")
            }

            let shouldNotify = options.notifyAll || notifyUUIDs.contains(characteristic.uuid)
            if shouldNotify && (characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate)) {
                log("Enabling notifications for \(characteristic.uuid.uuidString)")
                peripheral.setNotifyValue(true, for: characteristic)
            }
        }

        if writeCharacteristic != nil {
            startWritesIfNeeded()
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        if let error {
            log("Notification setup failed for \(characteristic.uuid.uuidString): \(error.localizedDescription)")
        } else {
            log("Notification state \(characteristic.uuid.uuidString): \(characteristic.isNotifying)")
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverDescriptorsFor characteristic: CBCharacteristic, error: Error?) {
        if let error {
            log("Descriptor discovery failed service=\(characteristic.service?.uuid.uuidString ?? "unknown") char=\(characteristic.uuid.uuidString): \(error.localizedDescription)")
            return
        }
        guard let descriptors = characteristic.descriptors, !descriptors.isEmpty else {
            log("Descriptors service=\(characteristic.service?.uuid.uuidString ?? "unknown") char=\(characteristic.uuid.uuidString): none")
            return
        }
        for descriptor in descriptors {
            log("Descriptor service=\(characteristic.service?.uuid.uuidString ?? "unknown") char=\(characteristic.uuid.uuidString) desc=\(descriptor.uuid.uuidString)")
            peripheral.readValue(for: descriptor)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor descriptor: CBDescriptor, error: Error?) {
        let serviceUUID = descriptor.characteristic?.service?.uuid.uuidString ?? "unknown"
        let characteristicUUID = descriptor.characteristic?.uuid.uuidString ?? "unknown"
        if let error {
            log("Descriptor read failed service=\(serviceUUID) char=\(characteristicUUID) desc=\(descriptor.uuid.uuidString): \(error.localizedDescription)")
            return
        }
        log("Descriptor read service=\(serviceUUID) char=\(characteristicUUID) desc=\(descriptor.uuid.uuidString) value=\(descriptorPreview(descriptor.value))")
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let value = characteristic.value else {
            return
        }
        recordNotify(characteristic: characteristic, value: value)
        let bytes = Array(value)
        if characteristic.properties.contains(.read) {
            log("Read/notify service=\(characteristic.service?.uuid.uuidString ?? "unknown") char=\(characteristic.uuid.uuidString) bytes=\(bytes.count) hex=\(PeripheralFrame.hex(value)) ascii=\(asciiPreview(bytes))")
        }
        if options.replyToState && bytes.count >= 14 && bytes[0] == 0xbf && bytes[8] == 0x06 && bytes[9] == 0x01 {
            let state = bytes[13]
            log("Replying to 0601 state \(String(format: "%02x", state))")
            writeImmediately(PeripheralFrame.command(group: 0x07, command: 0x09, payload: [state]), type: .withoutResponse, label: "0709 reply")
        }
        handleAppStatusNotification(bytes)
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        inFlightWithResponse = false
        let label = inFlightWriteLabel ?? "unknown"
        inFlightWriteLabel = nil
        if let error {
            fail("Write failed: \(error.localizedDescription)")
        }
        log("Write ack label=\(label)")
        processNextWrite()
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        guard waitingForWriteWithoutResponseCapacity else {
            return
        }
        waitingForWriteWithoutResponseCapacity = false
        log("Write without-response capacity ready")
        processNextWrite()
    }

    private func startWritesIfNeeded() {
        guard !startedWrites else {
            return
        }
        startedWrites = true

        if options.includeInit {
            for frame in PeripheralFrame.initialBurst(displayMode: options.displayMode) {
                queue.append(PendingWrite(data: frame, type: .withResponse, label: commandName(frame), delay: 0.18, captionWrite: false, characteristicUUID: nil))
            }
        } else if options.sniffOnly && options.rawCommands.isEmpty && options.rawWrites.isEmpty {
            log("Sniff mode ready; no display writes will be sent")
            return
        } else if options.rawCommands.isEmpty && options.rawWrites.isEmpty && !options.streamStdin {
            queue.append(PendingWrite(data: PeripheralFrame.displayMode(options.displayMode), type: .withResponse, label: "0701 display mode", delay: 0.0, captionWrite: false, characteristicUUID: nil))
        }

        if !options.rawCommands.isEmpty || !options.rawWrites.isEmpty {
            for rawCommand in options.rawCommands {
                let frame = PeripheralFrame.command(group: rawCommand.group, command: rawCommand.command, payload: rawCommand.payload)
                queue.append(PendingWrite(data: frame, type: .withResponse, label: commandName(frame) + " raw", delay: 0.18, captionWrite: false, characteristicUUID: nil))
            }
            for rawWrite in options.rawWrites {
                let data = Data(rawWrite)
                queue.append(PendingWrite(data: data, type: .withResponse, label: "raw write " + hexPreview(data), delay: 0.18, captionWrite: false, characteristicUUID: nil))
            }
            processNextWrite()
            return
        }

        if options.streamStdin {
            processNextWrite()
            return
        }

        enqueueCaption(options.text, refreshDisplayMode: false)
    }

    private var shouldDiscoverAllServices: Bool {
        options.sniffOnly || options.notifyAll || options.readReadable || options.readDescriptors
    }

    private func enqueueCaption(_ text: String, refreshDisplayMode: Bool, clear: Bool = false) {
        coalescePendingCaptionWrites()
        if refreshDisplayMode {
            queue.append(PendingWrite(data: PeripheralFrame.displayMode(options.displayMode), type: .withResponse, label: "0701 display mode", delay: 0.0, captionWrite: false, characteristicUUID: nil))
        }
        let textFrame = clear ? PeripheralFrame.clearAssistantText(slot: options.slot) : PeripheralFrame.assistantText(text, slot: options.slot)
        let textLabel = clear ? "0704 assistant clear" : "0704 assistant text"
        queue.append(PendingWrite(data: textFrame, type: options.textWriteType, label: textLabel, delay: 0.05, captionWrite: true, characteristicUUID: nil))
        queue.append(PendingWrite(data: PeripheralFrame.postSequence(displayMode: options.displayMode)[0], type: .withResponse, label: "0303 post", delay: 0.03, captionWrite: true, characteristicUUID: nil))
        queue.append(PendingWrite(data: PeripheralFrame.postSequence(displayMode: options.displayMode)[1], type: .withResponse, label: "0707 post", delay: 0.03, captionWrite: true, characteristicUUID: nil))
        processNextWrite()
    }

    private func coalescePendingCaptionWrites() {
        let previousCount = queue.count
        queue.removeAll { $0.captionWrite }
        let droppedCount = previousCount - queue.count
        if droppedCount > 0 {
            log("Dropped \(droppedCount) stale caption writes")
        }
    }

    private func enqueueRawCommand(_ rawCommand: RawCommand, labelSuffix: String = "raw") {
        let frame = PeripheralFrame.command(group: rawCommand.group, command: rawCommand.command, payload: rawCommand.payload)
        queue.append(PendingWrite(data: frame, type: .withResponse, label: commandName(frame) + " " + labelSuffix, delay: 0.18, captionWrite: false, characteristicUUID: nil))
        processNextWrite()
    }

    private func processNextWrite() {
        guard !inFlightWithResponse, !writeScheduled else {
            return
        }
        guard pendingAppStatusWait == nil else {
            return
        }
        guard let next = queue.first else {
            if options.streamStdin {
                if stdinClosed {
                    finished = true
                    log("Stdin drained. Disconnecting")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                        guard let self else { return }
                        if let peripheral = self.peripheral {
                            self.central?.cancelPeripheralConnection(peripheral)
                        } else {
                            self.exitCleanly()
                        }
                    }
                    return
                }
                startStdinReaderIfNeeded()
                return
            }
            finished = true
            log("Done. Disconnecting")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self else { return }
                if let peripheral = self.peripheral {
                    self.central?.cancelPeripheralConnection(peripheral)
                } else {
                    self.exitCleanly()
                }
            }
            return
        }
        if next.type == .withoutResponse, let peripheral, !peripheral.canSendWriteWithoutResponse {
            if !waitingForWriteWithoutResponseCapacity {
                waitingForWriteWithoutResponseCapacity = true
                log("Waiting for write without-response capacity")
            }
            return
        }
        waitingForWriteWithoutResponseCapacity = false
        queue.removeFirst()
        writeScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + next.delay) { [weak self] in
            guard let self else { return }
            self.writeScheduled = false
            self.writeQueued(next)
        }
    }

    private func startStdinReaderIfNeeded() {
        guard !stdinReaderStarted else {
            return
        }
        stdinReaderStarted = true
        log("Stream stdin ready")
        DispatchQueue.global(qos: .userInitiated).async(group: nil, qos: .unspecified, flags: [], execute: { [weak self] in
            while let line = readLine(strippingNewline: true) {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.hasPrefix(streamBrightnessPrefix) {
                    let rawValue = String(trimmed.dropFirst(streamBrightnessPrefix.count))
                    guard let value = parseStreamByte(rawValue) else {
                        DispatchQueue.main.async {
                            self?.log("Ignored invalid brightness value: \(rawValue)")
                        }
                        continue
                    }
                    DispatchQueue.main.async {
                        guard let self else { return }
                        self.log("Queue brightness \(String(format: "%02x", value))")
                        self.enqueueRawCommand(RawCommand(group: 0x03, command: 0x02, payload: [value]), labelSuffix: "brightness")
                    }
                    continue
                }
                if trimmed == streamClearToken {
                    DispatchQueue.main.async {
                        guard let self else { return }
                        self.log("Queue caption clear")
                        self.enqueueCaption("", refreshDisplayMode: false, clear: true)
                    }
                    continue
                }
                if trimmed.hasPrefix(streamRawWritePrefix) {
                    let rawValue = String(trimmed.dropFirst(streamRawWritePrefix.count))
                    let parsed = parseStreamRawWrite(rawValue)
                    guard let bytes = parsed.bytes else {
                        DispatchQueue.main.async {
                            self?.log("Ignored invalid raw write: \(rawValue)")
                        }
                        continue
                    }
                    DispatchQueue.main.async {
                        guard let self else { return }
                        let data = Data(bytes)
                        let target = parsed.characteristic?.uuidString ?? self.options.writeCharUUID.uuidString
                        self.log("Queue raw write " + hexPreview(data) + " char=" + target)
                        self.queue.append(PendingWrite(data: data, type: .withResponse, label: "raw write " + hexPreview(data), delay: 0.0, captionWrite: false, characteristicUUID: parsed.characteristic))
                        self.processNextWrite()
                    }
                    continue
                }
                if trimmed.hasPrefix(streamRawWriteNoResponsePrefix) {
                    let rawValue = String(trimmed.dropFirst(streamRawWriteNoResponsePrefix.count))
                    let parsed = parseStreamRawWrite(rawValue)
                    guard let bytes = parsed.bytes else {
                        DispatchQueue.main.async {
                            self?.log("Ignored invalid raw no-response write: \(rawValue)")
                        }
                        continue
                    }
                    DispatchQueue.main.async {
                        guard let self else { return }
                        let data = Data(bytes)
                        let target = parsed.characteristic?.uuidString ?? self.options.writeCharUUID.uuidString
                        self.log("Queue raw no-response write " + hexPreview(data) + " char=" + target)
                        self.queue.append(PendingWrite(
                            data: data,
                            type: .withoutResponse,
                            label: "raw no-response write " + hexPreview(data),
                            delay: 0.0,
                            captionWrite: false,
                            characteristicUUID: parsed.characteristic,
                            withoutResponseFollowupDelay: 0.01
                        ))
                        self.processNextWrite()
                    }
                    continue
                }
                if trimmed.hasPrefix(streamRawWriteNoResponseFastPrefix) {
                    let rawValue = String(trimmed.dropFirst(streamRawWriteNoResponseFastPrefix.count))
                    let parsed = parseStreamRawWrite(rawValue)
                    guard let bytes = parsed.bytes else {
                        DispatchQueue.main.async {
                            self?.log("Ignored invalid fast raw no-response write: \(rawValue)")
                        }
                        continue
                    }
                    DispatchQueue.main.async {
                        guard let self else { return }
                        let data = Data(bytes)
                        let target = parsed.characteristic?.uuidString ?? self.options.writeCharUUID.uuidString
                        self.log("Queue fast raw no-response write " + hexPreview(data) + " char=" + target)
                        self.queue.append(PendingWrite(
                            data: data,
                            type: .withoutResponse,
                            label: "fast raw no-response write " + hexPreview(data),
                            delay: 0.0,
                            captionWrite: false,
                            characteristicUUID: parsed.characteristic,
                            withoutResponseFollowupDelay: 0.002
                        ))
                        self.processNextWrite()
                    }
                    continue
                }
                if trimmed.hasPrefix(streamWaitAppStatusPrefix) {
                    let rawValue = String(trimmed.dropFirst(streamWaitAppStatusPrefix.count))
                    guard let wait = parseStreamAppStatusWait(rawValue) else {
                        DispatchQueue.main.async(group: nil, qos: .unspecified, flags: [], execute: {
                            self?.log("Ignored invalid app-status wait: \(rawValue)")
                        })
                        continue
                    }
                    let appID = wait.appID
                    let status = wait.status
                    let timeout = wait.timeout
                    DispatchQueue.main.async(group: nil, qos: .unspecified, flags: [], execute: {
                        guard let self else { return }
                        self.log("Queue wait for 0602 app=\(String(format: "%02x", appID)) status=\(String(format: "%02x", status)) timeout=\(String(format: "%.1f", timeout))s")
                        self.queue.append(PendingWrite(
                            data: Data(),
                            type: .withResponse,
                            label: "wait 0602 app status",
                            delay: 0.0,
                            captionWrite: false,
                            characteristicUUID: nil,
                            waitAppID: appID,
                            waitStatus: status,
                            waitTimeout: timeout
                        ))
                        self.processNextWrite()
                    })
                    continue
                }
                guard !trimmed.isEmpty else {
                    continue
                }
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.log("Queue caption bytes=\(trimmed.utf8.count)")
                    self.enqueueCaption(trimmed, refreshDisplayMode: false)
                }
            }
            DispatchQueue.main.async {
                guard let self else { return }
                self.log("Stdin closed. Waiting for queued writes")
                self.stdinClosed = true
                self.processNextWrite()
            }
        })
    }

    private func writeQueued(_ item: PendingWrite) {
        if let appID = item.waitAppID, let status = item.waitStatus {
            beginAppStatusWait(appID: appID, status: status, timeout: item.waitTimeout)
            return
        }
        if item.type == .withResponse {
            inFlightWithResponse = true
            inFlightWriteLabel = item.label
        }
        writeImmediately(item.data, type: item.type, label: item.label, characteristicUUID: item.characteristicUUID)
        if item.type == .withoutResponse {
            DispatchQueue.main.asyncAfter(deadline: .now() + (item.withoutResponseFollowupDelay ?? 0.15)) { [weak self] in
                self?.processNextWrite()
            }
        }
    }

    private func writeImmediately(_ data: Data, type: CBCharacteristicWriteType, label: String, characteristicUUID: CBUUID? = nil) {
        guard let peripheral else {
            fail("Not ready to write")
        }
        let targetCharacteristic: CBCharacteristic?
        if let characteristicUUID {
            targetCharacteristic = characteristicKeyCandidates(characteristicUUID).compactMap { writableCharacteristics[$0] }.first
        } else {
            targetCharacteristic = writeCharacteristic
        }
        guard let targetCharacteristic else {
            fail("Missing write characteristic \(characteristicUUID?.uuidString ?? options.writeCharUUID.uuidString)")
        }
        let maxLength = peripheral.maximumWriteValueLength(for: type)
        if data.count > maxLength {
            log("Warning: \(label) is \(data.count) bytes; CoreBluetooth max for \(writeTypeName(type)) is \(maxLength)")
        }
        log("Write \(label) bytes=\(data.count) type=\(writeTypeName(type)) char=\(targetCharacteristic.uuid.uuidString)")
        peripheral.writeValue(data, for: targetCharacteristic, type: type)
    }

    private func handleAppStatusNotification(_ bytes: [UInt8]) {
        guard bytes.count >= 15, bytes[0] == 0xbf, bytes[8] == 0x06, bytes[9] == 0x02 else {
            return
        }
        let appID = bytes[13]
        let status = bytes[14]
        lastAppStatuses[appID] = status
        log("App status 0602 app=\(String(format: "%02x", appID)) status=\(String(format: "%02x", status)) \(appStatusName(status))")
        guard let pending = pendingAppStatusWait,
              pending.appID == appID,
              pending.status == status else {
            return
        }
        pending.timer.invalidate()
        pendingAppStatusWait = nil
        log("Matched wait for 0602 app=\(String(format: "%02x", appID)) status=\(String(format: "%02x", status))")
        processNextWrite()
    }

    private func beginAppStatusWait(appID: UInt8, status: UInt8, timeout: TimeInterval) {
        if lastAppStatuses[appID] == status {
            log("Wait already satisfied for 0602 app=\(String(format: "%02x", appID)) status=\(String(format: "%02x", status))")
            processNextWrite()
            return
        }
        pendingAppStatusWait?.timer.invalidate()
        log("Waiting for 0602 app=\(String(format: "%02x", appID)) status=\(String(format: "%02x", status)) \(appStatusName(status))")
        let timer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.pendingAppStatusWait = nil
            self.fail("Timed out waiting for 0602 app=\(String(format: "%02x", appID)) status=\(String(format: "%02x", status))")
        }
        pendingAppStatusWait = (appID, status, timer)
    }

    private func characteristicKeyCandidates(_ uuid: CBUUID) -> [String] {
        let value = uuid.uuidString.uppercased()
        let shortPrefix = "0000"
        let shortSuffix = "-0000-1000-8000-00805F9B34FB"
        if value.hasPrefix(shortPrefix), value.hasSuffix(shortSuffix), value.count >= shortPrefix.count + 4 {
            let start = value.index(value.startIndex, offsetBy: shortPrefix.count)
            let end = value.index(start, offsetBy: 4)
            return [value, String(value[start..<end])]
        }
        return [value]
    }

    private func openNotifyLogIfNeeded() {
        guard let path = options.notifyLogPath else {
            return
        }
        FileManager.default.createFile(atPath: path, contents: nil)
        do {
            notifyLogHandle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
            try notifyLogHandle?.seekToEnd()
            log("Writing notification log to \(path)")
        } catch {
            fail("Failed to open notification log \(path): \(error.localizedDescription)")
        }
    }

    private func recordNotify(characteristic: CBCharacteristic, value: Data) {
        let serviceUUID = characteristic.service?.uuid.uuidString ?? "unknown"
        let uuid = characteristic.uuid.uuidString
        let notifyKey = "\(serviceUUID)/\(uuid)"
        notifyCounts[notifyKey, default: 0] += 1
        let prefix = PeripheralFrame.hex(Data(value.prefix(16)))
        if options.sniffOnly || notifyLogHandle != nil {
            log("Notify service=\(serviceUUID) char=\(uuid) bytes=\(value.count) prefix=\(prefix)")
        } else if options.compactNotify {
            log("Notify \(PeripheralFrame.hex(value))")
        } else {
            log("Notify service=\(serviceUUID) char=\(uuid) \(PeripheralFrame.hex(value))")
        }
        guard let notifyLogHandle else {
            return
        }

        let record: [String: Any] = [
            "time": Date().timeIntervalSince1970,
            "service_uuid": serviceUUID,
            "uuid": uuid,
            "length": value.count,
            "hex": PeripheralFrame.hex(value),
        ]
        do {
            let data = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
            notifyLogHandle.write(data)
            notifyLogHandle.write(Data([0x0a]))
        } catch {
            log("Failed to write notification record: \(error.localizedDescription)")
        }
    }

    private func finishAndDisconnect() {
        finished = true
        if !notifyCounts.isEmpty {
            let summary = notifyCounts
                .sorted { $0.key < $1.key }
                .map { "\($0.key)=\($0.value)" }
                .joined(separator: " ")
            log("Notify summary \(summary)")
        }
        try? notifyLogHandle?.close()
        notifyLogHandle = nil
        if let peripheral {
            central?.cancelPeripheralConnection(peripheral)
        }
    }

    private func fail(_ message: String) -> Never {
        log("ERROR: \(message)")
        timeoutTimer?.invalidate()
        central?.stopScan()
        if let peripheral {
            central?.cancelPeripheralConnection(peripheral)
        }
        exit(1)
    }

    private func exitCleanly() -> Never {
        timeoutTimer?.invalidate()
        central?.stopScan()
        try? notifyLogHandle?.close()
        exit(0)
    }

    private func log(_ message: String) {
        let elapsed = Date().timeIntervalSince1970 - logStartedAt
        print(String(format: "[peripheral-mac] t=%.3f %@", elapsed, message))
        fflush(stdout)
    }
}

private func printUsage() {
    print("""
    Usage:
      peripheral-mac-pusher --text "Hello" [--slot 0] [--display-mode 7]

    Options:
      --scan-only            Scan and print matching Peripheral devices without connecting.
      --verbose-scan         Print advertisement details for every discovered device.
      --target-id VALUE      Connect to a discovered CoreBluetooth UUID prefix.
      --name-prefix VALUE    Advertised name prefix, comma-separated. Default: Peripheral.
      --keep-scan-during-connect
                             Keep discovery scanning active during connect.
      --stdin                Keep the display connection open and read caption lines from stdin.
      --sniff                Subscribe to notify characteristics without display writes.
      --passive-read        Read readable chars and subscribe to notifications with no app/state replies.
      --notify-all           Subscribe to every notify/indicate characteristic discovered.
      --read-readable        Read every readable characteristic discovered. Also discovers all services.
      --read-descriptors     Discover and read characteristic descriptors. Also discovers all services.
      --no-state-reply       Do not auto-reply to 0601 state packets with 0709.
      --notify-log PATH      Write notification records as NDJSON.
      --compact-notify       Print compact hot-path notify lines for stream parsers.
      --write-char UUID      Characteristic for writes. Accepts 2021 or full UUID. Default: 2021.
      --slot VALUE           Assistant slot byte. Default: 0.
      --display-mode VALUE   Display mode byte. Default: 7.
      --timeout SECONDS      Overall timeout. Default: 25.
      --no-init              Skip the initial command burst.
      --with-response        Write the text frame with response. Default.
      --without-response     Write the text frame without response.
      --raw VALUE            Write a raw Peripheral command, e.g. 020d:01 or 02:0d:01.
                             With --no-init this sends only the raw command.
      --raw-write HEX        Write raw bytes to --write-char without Peripheral bf framing.
                             Example: --write-char 2025 --raw-write 52010000
    """)
}

private func stateName(_ state: CBManagerState) -> String {
    switch state {
    case .unknown: return "unknown"
    case .resetting: return "resetting"
    case .unsupported: return "unsupported"
    case .unauthorized: return "unauthorized"
    case .poweredOff: return "poweredOff"
    case .poweredOn: return "poweredOn"
    @unknown default: return "unknownFuture"
    }
}

private func appStatusName(_ status: UInt8) -> String {
    switch status {
    case 0x01: return "entered"
    case 0x02: return "next"
    case 0x03: return "exited"
    default: return "unknown"
    }
}

private func properties(_ properties: CBCharacteristicProperties) -> String {
    var names: [String] = []
    if properties.contains(.read) { names.append("read") }
    if properties.contains(.write) { names.append("write") }
    if properties.contains(.writeWithoutResponse) { names.append("writeWithoutResponse") }
    if properties.contains(.notify) { names.append("notify") }
    if properties.contains(.indicate) { names.append("indicate") }
    return names.isEmpty ? "none" : names.joined(separator: ",")
}

private func asciiPreview(_ bytes: [UInt8]) -> String {
    String(bytes.map { byte in
        byte >= 0x20 && byte <= 0x7e ? Character(UnicodeScalar(byte)) : "."
    })
}

private func descriptorPreview(_ value: Any?) -> String {
    guard let value else {
        return "nil"
    }
    if let data = value as? Data {
        return "data bytes=\(data.count) hex=\(PeripheralFrame.hex(data)) ascii=\(asciiPreview(Array(data)))"
    }
    if let string = value as? String {
        return "string=\(string)"
    }
    if let number = value as? NSNumber {
        return "number=\(number)"
    }
    if let array = value as? [Any] {
        return "array=" + array.map { descriptorPreview($0) }.joined(separator: ",")
    }
    return String(describing: value)
}

private func writeTypeName(_ type: CBCharacteristicWriteType) -> String {
    type == .withResponse ? "withResponse" : "withoutResponse"
}

private func peripheralStateName(_ state: CBPeripheralState) -> String {
    switch state {
    case .disconnected: return "disconnected"
    case .connecting: return "connecting"
    case .connected: return "connected"
    case .disconnecting: return "disconnecting"
    @unknown default: return "unknownFuture"
    }
}

private func commandName(_ data: Data) -> String {
    let bytes = Array(data)
    guard bytes.count >= 10 else {
        return "unknown"
    }
    return String(format: "%02x%02x", bytes[8], bytes[9])
}

private func hexPreview(_ data: Data, maxBytes: Int = 32) -> String {
    let prefix = PeripheralFrame.hex(Data(data.prefix(maxBytes)))
    return data.count <= maxBytes ? prefix : "(prefix)..."
}

private func advertisementSummary(_ advertisementData: [String: Any]) -> String {
    var parts: [String] = []
    if let connectable = advertisementData[CBAdvertisementDataIsConnectable] {
        parts.append("connectable=\(connectable)")
    }
    if let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String {
        parts.append("localName=\(localName)")
    }
    if let uuids = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID], !uuids.isEmpty {
        parts.append("services=" + uuids.map { $0.uuidString }.joined(separator: ","))
    }
    if let solicited = advertisementData[CBAdvertisementDataSolicitedServiceUUIDsKey] as? [CBUUID], !solicited.isEmpty {
        parts.append("solicited=" + solicited.map { $0.uuidString }.joined(separator: ","))
    }
    if let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data], !serviceData.isEmpty {
        let value = serviceData.map { key, data in "\(key.uuidString):\(PeripheralFrame.hex(data))" }.joined(separator: ",")
        parts.append("serviceData=\(value)")
    }
    if let manufacturerData = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data {
        parts.append("manufacturer=\(PeripheralFrame.hex(manufacturerData))")
    }
    return parts.isEmpty ? "no-advertisement-details" : parts.joined(separator: " ")
}

do {
    let options = try Options.parse(CommandLine.arguments)
    PeripheralMacPusher(options: options).start()
} catch CLIError.message(let message) {
    fputs(message + "\n\n", stderr)
    printUsage()
    exit(2)
} catch {
    fputs(error.localizedDescription + "\n", stderr)
    exit(2)
}
