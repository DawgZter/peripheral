import AVFoundation
import Foundation
import Speech

struct AsrOptions {
    var locale = "en-US"
    var silenceMs = 1100
    var durationSeconds: Double?
    var outFile: String?
    var emitPartials = false
    var requireFinal = false
    var once = false
    var selfTest = false
    var help = false
}

enum AsrError: Error, CustomStringConvertible {
    case usage(String)
    case unavailable(String)

    var description: String {
        switch self {
        case .usage(let message), .unavailable(let message):
            return message
        }
    }
}

func stderr(_ message: String) {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
}

func usage() {
    print("""
peripheral-mac-asr - line-oriented macOS Speech recognizer

Usage:
  peripheral-mac-asr [--line-mode] [--locale en-US] [--silence-ms 1100]
                     [--duration-seconds 30] [--out-file path] [--partials] [--once]

stdout emits one completed transcript line per stable utterance.
stderr emits readiness, permission, partial, and diagnostic messages.
""")
}

func parseOptions(_ args: [String]) throws -> AsrOptions {
    var options = AsrOptions()
    var index = 0
    while index < args.count {
        let arg = args[index]
        switch arg {
        case "--help", "-h":
            options.help = true
        case "--self-test":
            options.selfTest = true
        case "--line-mode":
            break
        case "--locale":
            index += 1
            guard index < args.count else { throw AsrError.usage("--locale requires a value") }
            options.locale = args[index]
        case "--silence-ms":
            index += 1
            guard index < args.count, let value = Int(args[index]) else { throw AsrError.usage("--silence-ms requires an integer") }
            options.silenceMs = max(300, value)
        case "--duration-seconds":
            index += 1
            guard index < args.count, let value = Double(args[index]) else { throw AsrError.usage("--duration-seconds requires a number") }
            options.durationSeconds = max(0.1, value)
        case "--out-file":
            index += 1
            guard index < args.count else { throw AsrError.usage("--out-file requires a path") }
            options.outFile = args[index]
        case "--partials":
            options.emitPartials = true
        case "--require-final":
            options.requireFinal = true
        case "--once":
            options.once = true
        default:
            throw AsrError.usage("unknown option: \(arg)")
        }
        index += 1
    }
    return options
}

func normalizeTranscript(_ value: String) -> String {
    value
        .replacingOccurrences(of: "\n", with: " ")
        .replacingOccurrences(of: "\t", with: " ")
        .split(separator: " ")
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

func transcriptDelta(current: String, previouslyEmitted: String) -> String {
    let clean = normalizeTranscript(current)
    let previous = normalizeTranscript(previouslyEmitted)
    if clean.isEmpty || clean.caseInsensitiveCompare(previous) == .orderedSame {
        return ""
    }
    if !previous.isEmpty && clean.lowercased().hasPrefix(previous.lowercased()) {
        let start = clean.index(clean.startIndex, offsetBy: previous.count)
        return clean[start...]
            .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(.punctuationCharacters))
    }
    return clean
}

func runSelfTest() throws {
    let first = transcriptDelta(current: "Hermes summarize this", previouslyEmitted: "")
    let second = transcriptDelta(current: "Hermes summarize this and make it short", previouslyEmitted: "Hermes summarize this")
    guard first == "Hermes summarize this" else { throw AsrError.unavailable("self-test first delta failed") }
    guard second == "and make it short" else { throw AsrError.unavailable("self-test second delta failed: \(second)") }
    print("macos-speech-asr self-test ok")
}

@available(macOS 10.15, *)
final class MacSpeechLineRecognizer {
    private let options: AsrOptions
    private let recognizer: SFSpeechRecognizer
    private let output: FileHandle
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var stableTimer: DispatchSourceTimer?
    private var lastObserved = ""
    private var lastEmitted = ""
    private var stopped = false

    init(options: AsrOptions) throws {
        self.options = options
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: options.locale)) else {
            throw AsrError.unavailable("Speech recognizer is unavailable for locale \(options.locale)")
        }
        self.recognizer = recognizer
        if let outFile = options.outFile {
            if !FileManager.default.fileExists(atPath: outFile) {
                FileManager.default.createFile(atPath: outFile, contents: nil)
            }
            guard let output = FileHandle(forWritingAtPath: outFile) else {
                throw AsrError.unavailable("could not open ASR out file: \(outFile)")
            }
            self.output = output
        } else {
            self.output = FileHandle.standardOutput
        }
    }

    func start() {
        requestAuthorization { [weak self] granted in
            guard let self else { return }
            guard granted else {
                self.stop(code: 2)
                return
            }
            do {
                try self.startRecognition()
            } catch {
                stderr("asr error: \(error)")
                self.stop(code: 3)
            }
        }
    }

    private func requestAuthorization(_ completion: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { speechStatus in
            guard speechStatus == .authorized else {
                stderr("speech recognition permission is \(speechStatus.rawValue); enable it in System Settings.")
                completion(false)
                return
            }

            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized:
                completion(true)
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    if !granted {
                        stderr("microphone permission was denied; enable it in System Settings.")
                    }
                    completion(granted)
                }
            default:
                stderr("microphone permission is not authorized; enable it in System Settings.")
                completion(false)
            }
        }
    }

    private func startRecognition() throws {
        guard recognizer.isAvailable else {
            throw AsrError.unavailable("speech recognizer is not currently available")
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            self?.handleRecognition(result: result, error: error)
        }

        audioEngine.prepare()
        try audioEngine.start()
        stderr("asr ready: locale=\(options.locale) silenceMs=\(options.silenceMs)")

        if let durationSeconds = options.durationSeconds {
            DispatchQueue.main.asyncAfter(deadline: .now() + durationSeconds) { [weak self] in
                self?.stop(code: 0)
            }
        }
    }

    private func handleRecognition(result: SFSpeechRecognitionResult?, error: Error?) {
        if let result {
            let text = normalizeTranscript(result.bestTranscription.formattedString)
            if text != lastObserved {
                lastObserved = text
                if options.emitPartials {
                    stderr("partial: \(text)")
                }
            }
            if result.isFinal {
                emit(text)
            } else if !options.requireFinal {
                scheduleStableEmit(text)
            }
        }

        if let error, !stopped {
            stderr("speech task ended: \(error.localizedDescription)")
        }
    }

    private func scheduleStableEmit(_ text: String) {
        stableTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .milliseconds(options.silenceMs))
        timer.setEventHandler { [weak self] in
            self?.emit(text)
        }
        timer.resume()
        stableTimer = timer
    }

    private func emit(_ text: String) {
        let line = transcriptDelta(current: text, previouslyEmitted: lastEmitted)
        guard line.count >= 2 else { return }
        output.write((line + "\n").data(using: .utf8)!)
        if options.outFile == nil {
            fflush(stdout)
        } else {
            try? output.synchronize()
        }
        lastEmitted = normalizeTranscript(text)
        if options.once {
            stop(code: 0)
        }
    }

    private func stop(code: Int32) {
        guard !stopped else { return }
        stopped = true
        stableTimer?.cancel()
        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        request?.endAudio()
        recognitionTask?.cancel()
        if options.outFile != nil {
            try? output.close()
        }
        fflush(stdout)
        exit(code)
    }
}

do {
    let options = try parseOptions(Array(CommandLine.arguments.dropFirst()))
    if options.help {
        usage()
        exit(0)
    }
    if options.selfTest {
        try runSelfTest()
        exit(0)
    }

    if #available(macOS 10.15, *) {
        let runner = try MacSpeechLineRecognizer(options: options)
        runner.start()
        RunLoop.main.run()
    } else {
        throw AsrError.unavailable("macOS Speech recognition requires macOS 10.15 or newer")
    }
} catch {
    stderr(String(describing: error))
    exit(1)
}
