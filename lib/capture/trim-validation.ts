import { z } from 'zod';

export const captureTrimSchema = z.object({
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().positive(),
  sourceDurationSec: z.number().finite().positive().max(3600),
}).strict().refine(t => t.endSec <= t.sourceDurationSec && t.endSec - t.startSec + 1e-9 >= Math.min(0.1, t.sourceDurationSec), 'Invalid trim interval');
