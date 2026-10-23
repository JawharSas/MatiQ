/**
 * Structured-output schemas for the vision model, generated from the rules
 * engine's vocabulary so the model can only emit event types the engine
 * understands. Fields that do not apply to an event type are null.
 *
 * The rules engine re-validates every event anyway: model output is treated
 * as untrusted input.
 */

import { z } from 'zod';
import {
  BJJ_EVENT_TYPES,
  BJJ_POSITIONS,
  CONTROL_POSITIONS,
  type Discipline,
  FINISH_METHODS,
  MMA_EVENT_TYPES,
  PENALTY_KINDS,
  STRIKE_KINDS,
  STRIKE_POSITIONS,
  STRIKE_TARGETS,
  SUBMISSION_DEPTHS,
  WRESTLING_EVENT_TYPES,
} from '../rules-engine/index.ts';

const ms = z.number().int().describe('Milliseconds from the start of the recording');
const endMs = z.number().int().nullable().describe('End time in ms for interval events (positions, control, near falls); otherwise null');
const athlete = z.enum(['A', 'B']).nullable().describe('Athlete performing / benefiting from the event; the penalised athlete for penalties');
const confidence = z.number().describe('Your confidence in this event, from 0 to 1');

const bjjEvent = z.object({
  type: z.enum(BJJ_EVENT_TYPES),
  t: ms,
  endT: endMs,
  athlete,
  position: z.enum(BJJ_POSITIONS).nullable(),
  technique: z.string().nullable().describe('Submission technique name, e.g. "armbar"'),
  depth: z.enum(SUBMISSION_DEPTHS).nullable(),
  reason: z.string().nullable(),
  confidence,
});

const wrestlingEvent = z.object({
  type: z.enum(WRESTLING_EVENT_TYPES),
  t: ms,
  endT: endMs,
  athlete,
  toDangerPosition: z.boolean().nullable(),
  grandAmplitude: z.boolean().nullable(),
  kind: z.enum(PENALTY_KINDS).nullable().describe('Penalty kind, for penalty events only'),
  confidence,
});

const mmaEvent = z.object({
  type: z.enum(MMA_EVENT_TYPES),
  t: ms,
  endT: endMs,
  athlete,
  landed: z.boolean().nullable(),
  significant: z.boolean().nullable(),
  target: z.enum(STRIKE_TARGETS).nullable(),
  kind: z.enum(STRIKE_KINDS).nullable(),
  position: z.enum([...STRIKE_POSITIONS, ...CONTROL_POSITIONS]).nullable(),
  technique: z.string().nullable(),
  depth: z.enum(SUBMISSION_DEPTHS).nullable(),
  method: z.enum(FINISH_METHODS).nullable(),
  points: z.number().int().nullable().describe('Points deducted, for point_deduction events only'),
  confidence,
});

function batchSchema<T extends z.ZodType>(event: T) {
  return z.object({
    events: z.array(event),
    observations: z
      .array(z.string())
      .describe('Up to 5 short technical observations about this segment (habits, openings, defensive gaps)'),
  });
}

export const BATCH_SCHEMAS = {
  bjj: batchSchema(bjjEvent),
  wrestling: batchSchema(wrestlingEvent),
  mma: batchSchema(mmaEvent),
} as const satisfies Record<Discipline, z.ZodType>;

export interface BatchOutput {
  events: Record<string, unknown>[];
  observations: string[];
}
