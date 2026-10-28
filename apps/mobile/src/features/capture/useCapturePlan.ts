/**
 * Resolves the best CapturePlan for this device by asking VisionCamera to
 * negotiate each candidate configuration (resolveConstraints) and checking
 * that the result can actually be configured (isSessionConfigSupported).
 * Probing happens once per device/preference, before the session starts,
 * so recording never begins in a configuration the hardware cannot sustain.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  type CameraDevice,
  type CameraFrameOutput,
  type CameraOutput,
  type CameraVideoOutput,
  VisionCamera,
} from 'react-native-vision-camera';
import {
  candidatesFor,
  captureConstraints,
  type CapturePlan,
  choosePlan,
  FALLBACK_PLAN,
  type FpsPreference,
  meetsTarget,
  type ProbeResult,
} from './capture-plan';

export interface CapturePlanState {
  plan: CapturePlan | null;
  probing: boolean;
  /** Set when probing failed and the fallback plan is used. */
  degraded: boolean;
}

async function probe(
  device: CameraDevice,
  outputs: CameraOutput[],
  candidate: CapturePlan,
  videoOutput: CameraVideoOutput,
): Promise<ProbeResult> {
  if (!device.supportsFPS(candidate.fps)) return { candidate, supported: false, selectedFps: undefined };
  const config = await VisionCamera.resolveConstraints(
    device,
    outputs.map((output) => ({ output, mirrorMode: 'auto' as const })),
    captureConstraints(candidate.fps, videoOutput),
  );
  return { candidate, supported: device.isSessionConfigSupported(config), selectedFps: config.selectedFPS };
}

export function useCapturePlan(
  device: CameraDevice | undefined,
  videoOutput: CameraVideoOutput,
  frameOutput: CameraFrameOutput,
  preference: FpsPreference,
): CapturePlanState {
  // Stand-in for the preview stream that <Camera> creates internally; the
  // negotiation only depends on the output type.
  const probePreview = useMemo(() => VisionCamera.createPreviewOutput(), []);
  const [state, setState] = useState<CapturePlanState>({ plan: null, probing: true, degraded: false });

  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    setState({ plan: null, probing: true, degraded: false });

    (async () => {
      const results: ProbeResult[] = [];
      for (const candidate of candidatesFor(preference)) {
        const outputs: CameraOutput[] = candidate.liveSampling
          ? [probePreview, videoOutput, frameOutput]
          : [probePreview, videoOutput];
        try {
          const result = await probe(device, outputs, candidate, videoOutput);
          results.push(result);
          if (meetsTarget(result)) break;
        } catch {
          results.push({ candidate, supported: false, selectedFps: undefined });
        }
      }
      if (cancelled) return;
      const plan = choosePlan(results);
      setState({ plan: plan ?? FALLBACK_PLAN, probing: false, degraded: plan === null });
    })();

    return () => {
      cancelled = true;
    };
  }, [device, preference, probePreview, videoOutput, frameOutput]);

  return state;
}
