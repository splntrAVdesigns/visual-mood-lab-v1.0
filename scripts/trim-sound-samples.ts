/**
 * Trims leading/trailing silence from sample-backed sound preset WAVs and
 * flags any that still won't loop cleanly after trimming.
 *
 * This is meant to be a standing step, not a one-off cleanup: run it on
 * public/sounds/*.wav any time a new sample-backed preset is added, the
 * same way verify-seed.ts gates the seed library. See scripts/lib/wav-trim.ts
 * for the actual decode/trim/re-encode logic and why it's Node-only.
 *
 * Defaults to a dry-run report — nothing is written unless --write is
 * passed, and even then an .orig.wav backup is kept unless --no-backup.
 *
 *   npx tsx scripts/trim-sound-samples.ts                       # report only, all files in public/sounds
 *   npx tsx scripts/trim-sound-samples.ts --write                # trim and overwrite, with backups
 *   npx tsx scripts/trim-sound-samples.ts public/sounds/jaded-pad.wav --write
 *   npx tsx scripts/trim-sound-samples.ts --threshold -45 --pad 12
 */

import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trimSilence } from './lib/wav-trim';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOUNDS_DIR = join(ROOT, 'public', 'sounds');

function parseArgs(argv: string[]) {
  const files: string[] = [];
  let write = false;
  let backup = true;
  let thresholdDb: number | undefined;
  let padMs: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') write = true;
    else if (a === '--no-backup') backup = false;
    else if (a === '--threshold') thresholdDb = Number(argv[++i]);
    else if (a === '--pad') padMs = Number(argv[++i]);
    else if (!a.startsWith('--')) files.push(a);
  }
  return { files, write, backup, thresholdDb, padMs };
}

function fmtS(s: number): string {
  return `${s.toFixed(3)}s`;
}

function main(): void {
  const { files, write, backup, thresholdDb, padMs } = parseArgs(process.argv.slice(2));

  const targets =
    files.length > 0
      ? files.map((f) => (f.startsWith('/') ? f : join(ROOT, f)))
      : readdirSync(SOUNDS_DIR)
          .filter((f) => f.toLowerCase().endsWith('.wav') && !f.toLowerCase().endsWith('.orig.wav'))
          .map((f) => join(SOUNDS_DIR, f));

  if (targets.length === 0) {
    console.log('No WAV files found.');
    return;
  }

  console.log(
    `\n${write ? 'Trimming' : 'Dry-run — checking'} ${targets.length} sample(s)` +
      `${write ? '' : ' (pass --write to actually modify files)'}\n`,
  );

  let warnings = 0;
  let trimmedCount = 0;

  for (const file of targets) {
    let result;
    try {
      result = trimSilence(file, { write, backup, thresholdDb, padMs });
    } catch (err) {
      console.error(`  FAIL  ${file}: ${(err as Error).message}`);
      continue;
    }

    const name = file.split('/').pop();

    if (result.skipped) {
      console.log(`  --    ${name}: ${result.reason}`);
      continue;
    }

    trimmedCount++;
    const action = write ? 'trimmed' : 'would trim';
    console.log(
      `  ${write ? 'ok' : '->'}    ${name}: ${action} ${fmtS(result.trimmedFromStartS)} from start, ` +
        `${fmtS(result.trimmedFromEndS)} from end ` +
        `(${fmtS(result.originalDurationS)} -> ${fmtS(result.trimmedDurationS)})`,
    );

    if (result.loopMismatch?.warning) {
      warnings++;
      const pct = Math.round(result.loopMismatch.diff * 100);
      console.log(
        `        WARN  loop point mismatch: start/end samples differ by ~${pct}% of full scale after trim.`,
      );
      console.log(
        `              Trimming silence won't fix this — the recording doesn't end where it began in phase.`,
      );
      console.log(
        `              A short crossfade loop or a cleaner source clip is needed if this preset should loop seamlessly.`,
      );
    }
  }

  console.log('');
  if (!write && trimmedCount > 0) {
    console.log(`${trimmedCount} file(s) have trimmable silence. Re-run with --write to apply.`);
  }
  if (warnings > 0) {
    console.log(`${warnings} file(s) flagged a loop-phase mismatch — see WARN lines above.`);
  }
  console.log('');
}

main();
