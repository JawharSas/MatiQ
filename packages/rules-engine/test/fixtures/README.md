# Video check fixtures

One-second ffmpeg test patterns (64×48, 10 FPS) used by `video-check.test.ts`:

```sh
ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -f lavfi -i sine=frequency=440:sample_rate=16000 -t 1 \
  -c:v libx264 -pix_fmt yuv420p -preset ultrafast -c:a aac -b:a 16k h264-aac.mp4
ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -f lavfi -i sine=frequency=440:sample_rate=16000 -t 1 \
  -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p -preset ultrafast -c:a aac -b:a 16k -f mov hevc-aac.mov
ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -t 1 -c:v libx264 -preset ultrafast -movflags +faststart faststart.mp4
ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -t 1 -c:v libx264 -preset ultrafast -movflags frag_keyframe+empty_moov fragmented.mp4
ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -f lavfi -i sine=frequency=440:sample_rate=8000 -t 1 \
  -c:v libx264 -preset ultrafast -c:a pcm_s16le -f mov pcm-audio.mov
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000 -t 1 -c:a aac audio.m4a
ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -frames:v 1 frame.jpg
# With phone-style personal metadata (GPS, make, model):
ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -f lavfi -i sine=frequency=440:sample_rate=16000 -t 1 \
  -c:v libx264 -preset ultrafast -c:a aac -b:a 16k -metadata location="+37.7858-122.4064/" \
  -metadata make=Samsung -metadata model=SM-S918B android-gps.mp4
ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -t 1 -c:v libx264 -preset ultrafast -movflags use_metadata_tags \
  -metadata com.apple.quicktime.location.ISO6709="+51.5072-000.1276+011.000/" \
  -metadata com.apple.quicktime.make=Apple -metadata com.apple.quicktime.model="iPhone 17" -f mov iphone-gps.mov
```
