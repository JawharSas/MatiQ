package app.matiq.videocompressor

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.EncoderUtil
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File

class CompressOptions : Record {
  /** Chosen by the caller; names the job in progress events and cancel(). */
  @Field val id: String = ""

  /** File (path or file:// URI) the compressed MP4 is written to. */
  @Field val output: String = ""

  /** "hevc" or "h264". */
  @Field val codec: String = "hevc"

  /** Video bits per second. */
  @Field val bitRate: Int = 0

  /** Short side of the output picture; the long side keeps the aspect ratio. */
  @Field val shortSide: Int = 0
}

class CompressionFailed(message: String?, cause: Throwable?) :
  CodedException("ERR_COMPRESSION_FAILED", message ?: "Video compression failed", cause)

class CompressionCancelled : CodedException("ERR_COMPRESSION_CANCELLED", "Video compression was cancelled", null)

/**
 * Re-encodes a video once with the phone's hardware encoder (AndroidX Media3
 * Transformer): HEVC or H.264 at the given bit rate, scaled to the given
 * short side, every frame kept (same frame rate) and the audio track copied
 * as is. HDR stays HDR where the encoder supports it and is tone-mapped to
 * SDR otherwise.
 */
@OptIn(UnstableApi::class)
class VideoCompressorModule : Module() {
  private class Job(val transformer: Transformer, val promise: Promise, val output: File)

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  // Transformer is used from the main thread only (its application thread);
  // `jobs` is only touched there too.
  private val main = Handler(Looper.getMainLooper())
  private val jobs = mutableMapOf<String, Job>()

  override fun definition() = ModuleDefinition {
    Name("VideoCompressor")

    Events("onProgress")

    /** Codecs this phone can encode, most efficient first. */
    Function("encoders") {
      listOf("hevc" to MimeTypes.VIDEO_H265, "h264" to MimeTypes.VIDEO_H264)
        .filter { (_, mimeType) -> EncoderUtil.getSupportedEncoders(mimeType).isNotEmpty() }
        .map { (codec, _) -> codec }
    }

    AsyncFunction("compress") { source: String, options: CompressOptions, promise: Promise ->
      val context = context
      main.post { start(context, source, options, promise) }
    }

    AsyncFunction("cancel") { id: String ->
      main.post {
        val job = jobs.remove(id) ?: return@post
        job.transformer.cancel()
        job.output.delete()
        job.promise.reject(CompressionCancelled())
      }
    }

    OnDestroy {
      main.post {
        for (job in jobs.values) {
          job.transformer.cancel()
          job.output.delete()
        }
        jobs.clear()
      }
    }
  }

  private fun start(context: Context, source: String, options: CompressOptions, promise: Promise) {
    val output = File(Uri.parse(options.output).path ?: options.output)
    try {
      require(options.id.isNotEmpty() && !jobs.containsKey(options.id)) { "Each compression needs its own id" }
      require(options.bitRate > 0 && options.shortSide > 0) { "Bit rate and size must be positive" }
      output.parentFile?.mkdirs()
      output.delete()

      val encoderFactory =
        DefaultEncoderFactory
          .Builder(context)
          .setRequestedVideoEncoderSettings(
            VideoEncoderSettings
              .Builder()
              .setBitrate(options.bitRate)
              // A keyframe every 2 seconds: quick seeking in the player.
              .setiFrameIntervalSeconds(2f)
              .build(),
          ).build()

      val transformer =
        Transformer
          .Builder(context)
          .setLooper(Looper.getMainLooper())
          .setVideoMimeType(if (options.codec == "h264") MimeTypes.VIDEO_H264 else MimeTypes.VIDEO_H265)
          .setEncoderFactory(encoderFactory)
          .addListener(
            object : Transformer.Listener {
              override fun onCompleted(
                composition: Composition,
                exportResult: ExportResult,
              ) {
                if (jobs.remove(options.id) == null) return
                promise.resolve(
                  mapOf(
                    "uri" to Uri.fromFile(output).toString(),
                    "sizeBytes" to output.length().toDouble(),
                    "codec" to if (exportResult.videoMimeType == MimeTypes.VIDEO_H264) "h264" else "hevc",
                  ),
                )
              }

              override fun onError(
                composition: Composition,
                exportResult: ExportResult,
                exportException: ExportException,
              ) {
                if (jobs.remove(options.id) == null) return
                output.delete()
                promise.reject(CompressionFailed(exportException.message, exportException))
              }
            },
          ).build()

      val item =
        EditedMediaItem
          .Builder(MediaItem.fromUri(Uri.parse(source)))
          .setEffects(Effects(listOf(), listOf(Presentation.createForShortSide(options.shortSide))))
          .build()

      jobs[options.id] = Job(transformer, promise, output)
      transformer.start(item, output.absolutePath)
      reportProgress(options.id, transformer)
    } catch (error: Exception) {
      jobs.remove(options.id)
      output.delete()
      promise.reject(CompressionFailed(error.message, error))
    }
  }

  private fun reportProgress(
    id: String,
    transformer: Transformer,
  ) {
    val holder = ProgressHolder()
    main.postDelayed(
      object : Runnable {
        override fun run() {
          if (jobs[id]?.transformer !== transformer) return
          if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
            sendEvent("onProgress", mapOf("id" to id, "progress" to holder.progress / 100.0))
          }
          main.postDelayed(this, PROGRESS_INTERVAL_MS)
        }
      },
      PROGRESS_INTERVAL_MS,
    )
  }

  private companion object {
    const val PROGRESS_INTERVAL_MS = 250L
  }
}
