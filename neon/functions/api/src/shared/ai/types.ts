/**
 * What every AI provider implements. The rules engine scores whatever events
 * a provider returns, so providers only need to describe what they see.
 */

import type { Discipline } from '@matiq/rules-engine';
import type { BatchContext } from './prompts.ts';
import type { BatchOutput, Safety } from './schemas.ts';

export interface Frame {
  t: number;
  /** Base64-encoded JPEG. */
  data: string;
}

export class AnalysisError extends Error {
  override name = 'AnalysisError';
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export interface AnalysisProvider {
  readonly model: string;
  analyzeBatch(context: BatchContext, frames: Frame[]): Promise<BatchOutput>;
  coachingSummary(discipline: Discipline, digest: unknown, observations: string[]): Promise<string>;
  /** Content check of one JPEG; null when the model declined to look at it. */
  checkImage(jpegBase64: string): Promise<Safety | null>;
}
