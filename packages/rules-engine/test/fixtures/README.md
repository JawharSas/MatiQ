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
```
