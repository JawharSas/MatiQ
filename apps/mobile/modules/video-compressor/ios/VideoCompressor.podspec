Pod::Spec.new do |s|
  s.name           = 'VideoCompressor'
  s.version        = '1.0.0'
  s.summary        = 'Compresses videos with HEVC before upload'
  s.description    = 'Re-encodes a video once with the hardware HEVC encoder (AVFoundation), keeping frame rate and audio.'
  s.license        = 'UNLICENSED'
  s.author         = 'MatIQ'
  s.homepage       = 'https://github.com/JawharSas/MatiQ'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/JawharSas/MatiQ.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
