import AVFoundation
import ExpoModulesCore

internal struct CompressOptions: Record {
  /// Chosen by the caller; names the job in progress events and cancel().
  @Field var id: String = ""
  /// file:// URL the compressed MP4 is written to.
  @Field var output: String = ""
  /// "hevc" or "h264".
  @Field var codec: String = "hevc"
  /// Requested video bits per second. AVAssetExportSession picks its own
  /// rate for the preset, close to the camera's, so this is informational.
  @Field var bitRate: Int = 0
  /// Short side of the output picture: 1080 (the preset size, never scaled
  /// up), or 720 or less for H.264's 1280x720 preset.
  @Field var shortSide: Int = 0
}

internal final class CompressionFailedException: GenericException<String> {
  override var reason: String {
    "Video compression failed: \(param)"
  }
}

internal final class CompressionCancelledException: Exception {
  override var reason: String {
    "Video compression was cancelled"
  }
}

/**
 Re-encodes a video once with the hardware encoder (AVFoundation export
 presets): HEVC, or H.264 where HEVC is missing, at most 1920x1080 (never
 scaled up), every frame kept and the audio track copied. Location, device
 and other personal metadata are not written to the copy.
 */
public final class VideoCompressorModule: Module {
  // Only touched on the main queue.
  private var sessions: [String: AVAssetExportSession] = [:]

  public func definition() -> ModuleDefinition {
    Name("VideoCompressor")

    Events("onProgress")

    // Codecs this phone can encode, most efficient first.
    Function("encoders") { () -> [String] in
      let presets = AVAssetExportSession.allExportPresets()
      var codecs: [String] = []
      if presets.contains(AVAssetExportPresetHEVC1920x1080) {
        codecs.append("hevc")
      }
      if presets.contains(AVAssetExportPreset1920x1080) && presets.contains(AVAssetExportPreset1280x720) {
        codecs.append("h264")
      }
      return codecs
    }

    AsyncFunction("compress") { (source: String, options: CompressOptions, promise: Promise) in
      self.start(source: source, options: options, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("cancel") { (id: String) in
      self.sessions.removeValue(forKey: id)?.cancelExport()
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async {
        for session in self.sessions.values {
          session.cancelExport()
        }
        self.sessions.removeAll()
      }
    }
  }

  private func start(source: String, options: CompressOptions, promise: Promise) {
    guard let sourceUrl = URL(string: source), let outputUrl = URL(string: options.output), outputUrl.isFileURL else {
      promise.reject(CompressionFailedException("invalid file address"))
      return
    }
    guard !options.id.isEmpty, sessions[options.id] == nil else {
      promise.reject(CompressionFailedException("each compression needs its own id"))
      return
    }
    // HEVC has no preset below 1080p; a 720p request (the fallback for a
    // video that must fit the upload limit) uses H.264 at 1280x720.
    let preset = options.codec == "h264"
      ? (options.shortSide <= 720 ? AVAssetExportPreset1280x720 : AVAssetExportPreset1920x1080)
      : AVAssetExportPresetHEVC1920x1080
    guard let session = AVAssetExportSession(asset: AVURLAsset(url: sourceUrl), presetName: preset) else {
      promise.reject(CompressionFailedException("this video can't be exported with \(preset)"))
      return
    }
    try? FileManager.default.removeItem(at: outputUrl)
    session.outputURL = outputUrl
    session.outputFileType = .mp4
    // Movie header first: the video starts playing before it has fully loaded.
    session.shouldOptimizeForNetworkUse = true
    // Location, device and other personal metadata stay on the phone.
    session.metadataItemFilter = AVMetadataItemFilter.forSharing()
    sessions[options.id] = session

    let id = options.id
    let codec = options.codec == "h264" ? "h264" : "hevc"
    let timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self, weak session] _ in
      guard let session else {
        return
      }
      self?.sendEvent("onProgress", ["id": id, "progress": Double(session.progress)])
    }

    session.exportAsynchronously { [weak self] in
      DispatchQueue.main.async {
        timer.invalidate()
        self?.sessions.removeValue(forKey: id)
        switch session.status {
        case .completed:
          let attributes = try? FileManager.default.attributesOfItem(atPath: outputUrl.path)
          let size = (attributes?[.size] as? NSNumber)?.doubleValue ?? 0
          promise.resolve(["uri": outputUrl.absoluteString, "sizeBytes": size, "codec": codec])
        case .cancelled:
          try? FileManager.default.removeItem(at: outputUrl)
          promise.reject(CompressionCancelledException())
        default:
          try? FileManager.default.removeItem(at: outputUrl)
          promise.reject(CompressionFailedException(session.error?.localizedDescription ?? "unknown error"))
        }
      }
    }
  }
}
