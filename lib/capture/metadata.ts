import { z } from 'zod';

/** Only server-validated fields reach the additive capture column. */
export const captureMetadataSchema = z.object({
  version: z.literal(1),
  loopMode: z.enum(['off', 'smooth']),
  overlapMs: z.number().finite().min(0).max(800),
  requestedDurationSec: z.number().finite().min(5).max(30),
  durationSec: z.number().finite().positive().max(31),
  rawDurationSec: z.number().finite().positive().max(31),
  fps: z.number().int().min(1).max(60),
  width: z.number().int().min(2).max(8192),
  height: z.number().int().min(2).max(8192),
  completed: z.boolean(),
  repeatedFrames: z.number().int().min(0).max(1860),
  rawSrcUrl: z.string().min(1).max(2048).optional(),
}).strict().superRefine((m, ctx) => {
  if (m.loopMode === 'smooth' && (!m.completed || !m.rawSrcUrl || m.overlapMs < 100 || Math.abs(m.rawDurationSec - m.durationSec - m.overlapMs / 1000) > 1 / m.fps))
    ctx.addIssue({ code: 'custom', message: 'Incomplete Smooth provenance' });
  if (m.loopMode === 'off' && (m.overlapMs !== 0 || Math.abs(m.rawDurationSec - m.durationSec) > 1 / m.fps))
    ctx.addIssue({ code: 'custom', message: 'Invalid untreated duration' });
});
