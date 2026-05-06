#!/usr/bin/env tsx
/**
 * Automated caption template refinement loop.
 *
 * Renders still frames with the current template, compares against reference
 * frames via Claude Vision, applies fixes, and repeats until convergence.
 *
 * Usage:
 *   tsx scripts/reel-analysis/refine-template.ts --slug DXhn5HNhTxy
 */
try { process.loadEnvFile(); } catch {}

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import { renderStillLocal } from './lib/render-still.js';
import { compareFrames, generateFixes, type FrameComparison } from './lib/compare-vision.js';
import { enrichTranscript } from '../../src/stages/enrichTranscript.js';

const RUNS_DIR = join(import.meta.dirname, 'runs');
const MAX_ITERATIONS = 10;
const TARGET_SCORE = 95;
const STALE_THRESHOLD = 3; // stop if no improvement for N iterations

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  let slug = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slug' && args[i + 1]) slug = args[++i];
  }
  if (!slug) {
    console.error('Usage: refine-template.ts --slug <reel-slug>');
    process.exit(1);
  }
  return { slug };
}

// ---------------------------------------------------------------------------
// Select reference frames — pick diverse caption states
// ---------------------------------------------------------------------------
function selectReferenceFrames(uniqueDir: string, maxFrames = 8): { path: string; index: number; sec: number }[] {
  const allFrames = readdirSync(uniqueDir)
    .filter((f) => f.endsWith('.png'))
    .sort();

  if (allFrames.length <= maxFrames) {
    return allFrames.map((f, i) => ({
      path: join(uniqueDir, f),
      index: i + 1,
      sec: i + 1, // 1fps extraction = frame N is at second N
    }));
  }

  // Evenly sample
  const step = allFrames.length / maxFrames;
  return Array.from({ length: maxFrames }, (_, i) => {
    const idx = Math.floor(i * step);
    return {
      path: join(uniqueDir, allFrames[idx]),
      index: idx + 1,
      sec: idx + 1,
    };
  });
}

// ---------------------------------------------------------------------------
// Transcribe the reference reel (cached)
// ---------------------------------------------------------------------------
async function transcribeReel(reelPath: string, runDir: string): Promise<{ transcript: any; captionPlan: any; faces: any }> {
  const cachePath = join(runDir, 'transcription_cache.json');
  if (existsSync(cachePath)) {
    console.log('  Using cached transcription');
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }

  console.log('  Transcribing reference reel...');

  // Extract audio
  const audioPath = join(runDir, 'audio.wav');
  if (!existsSync(audioPath)) {
    execSync(`ffmpeg -y -i "${reelPath}" -ac 1 -ar 16000 "${audioPath}"`, { stdio: 'pipe' });
  }

  // Transcribe using Python sidecar
  const pythonBin = process.env.PYTHON_BIN ?? './.venv/bin/python';
  const transcribeScript = process.env.TRANSCRIBE_SCRIPT ?? resolve('transcribe-py/transcribe.py');
  const transcriptOutPath = join(runDir, 'transcript.json');
  execSync(
    `${pythonBin} "${transcribeScript}" "${audioPath}" "${transcriptOutPath}"`,
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, stdio: 'inherit' },
  );

  let transcript: any;
  if (existsSync(transcriptOutPath)) {
    transcript = JSON.parse(readFileSync(transcriptOutPath, 'utf-8'));
  } else {
    throw new Error('Transcription produced no output');
  }

  // Enrich with Claude for semantic chunking + emphasis detection
  console.log('  Enriching transcript (semantic chunking + emphasis)...');
  const captionPlan = await enrichTranscript(transcript);
  if (captionPlan) {
    console.log(`  Enriched: ${captionPlan.chunks.length} chunks`);
  } else {
    console.log('  Enrichment returned null — falling back to fixed-N chunker (check ANTHROPIC_API_KEY)');
  }

  // Detect faces (optional)
  let faces = null;
  try {
    const facesScript = resolve('transcribe-py/detect_faces.py');
    const facesOutput = execSync(
      `${pythonBin} "${facesScript}" "${reelPath}"`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
    );
    const facesMatch = facesOutput.match(/done -> (.+)/);
    if (facesMatch) {
      faces = JSON.parse(readFileSync(facesMatch[1], 'utf-8'));
    }
  } catch {
    console.log('  Face detection skipped');
  }

  const cache = { transcript, captionPlan, faces };
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  console.log(`  Transcription cached (${transcript.words.length} words)`);
  return cache;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
async function main() {
  const { slug } = parseArgs();
  const runDir = join(RUNS_DIR, slug);

  if (!existsSync(runDir)) {
    console.error(`Run directory not found: ${runDir}`);
    process.exit(1);
  }

  const uniqueDir = join(runDir, 'unique');
  const reelPath = join(runDir, 'input', 'reel.mp4');
  const templatePath = resolve('remotion/src/templates/ReelClone.tsx');

  // Load initial state
  const presetPath = join(runDir, 'preset.json');
  let currentStyleSpec = existsSync(presetPath)
    ? JSON.parse(readFileSync(presetPath, 'utf-8')).styleSpec
    : {};

  console.log('\n=== Automated Template Refinement ===\n');

  // Step 1: Select reference frames
  console.log('Step 1: Selecting reference frames...');
  const refFrames = selectReferenceFrames(uniqueDir);
  console.log(`  Selected ${refFrames.length} frames for comparison\n`);

  // Step 2: Transcribe reference reel (cached)
  console.log('Step 2: Preparing reference reel transcription...');
  const { transcript, captionPlan, faces } = await transcribeReel(reelPath, runDir);
  console.log('');

  // Iteration loop
  let bestScore = 0;
  let staleCount = 0;

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    const iterDir = join(runDir, 'iterations', String(iter));
    const renderedDir = join(iterDir, 'rendered');
    mkdirSync(renderedDir, { recursive: true });

    console.log(`\n--- Iteration ${iter}/${MAX_ITERATIONS} ---\n`);

    // Save current StyleSpec
    writeFileSync(join(iterDir, 'styleSpec.json'), JSON.stringify(currentStyleSpec, null, 2));

    // Step 3: Render still frames
    console.log('  Rendering still frames...');
    for (const ref of refFrames) {
      const outputPath = join(renderedDir, `frame_${String(ref.index).padStart(3, '0')}.png`);
      if (existsSync(outputPath)) {
        continue; // Skip if already rendered this iteration
      }
      try {
        renderStillLocal({
          inputVideo: reelPath,
          transcript,
          captionPlan,
          faces,
          styleSpec: currentStyleSpec,
          templateId: 'reel-clone',
          frameSec: ref.sec,
          outputPath,
        });
        process.stdout.write(`    Frame ${ref.index} ✓\n`);
      } catch (err) {
        console.error(`    Frame ${ref.index} ✗: ${(err as Error).message}`);
      }
    }

    // Step 4: Compare each pair
    console.log('\n  Comparing with Claude Vision...');
    const comparisons: FrameComparison[] = [];

    for (const ref of refFrames) {
      const renderedPath = join(renderedDir, `frame_${String(ref.index).padStart(3, '0')}.png`);
      if (!existsSync(renderedPath)) continue;

      try {
        const result = await compareFrames(
          ref.path,
          renderedPath,
          `frame ${ref.index} at ${ref.sec}s`,
        );
        comparisons.push({
          frameIndex: ref.index,
          frameSec: ref.sec,
          result,
        });
        console.log(`    Frame ${ref.index}: score ${result.matchScore}/100 (${result.issues.length} issues)`);
      } catch (err) {
        console.error(`    Frame ${ref.index}: comparison failed — ${(err as Error).message}`);
      }
    }

    if (comparisons.length === 0) {
      console.error('  No comparisons succeeded, stopping.');
      break;
    }

    // Save comparison results
    writeFileSync(join(iterDir, 'feedback.json'), JSON.stringify(comparisons, null, 2));

    const avgScore = comparisons.reduce((sum, c) => sum + c.result.matchScore, 0) / comparisons.length;
    console.log(`\n  Average match score: ${avgScore.toFixed(1)}/100`);

    // Step 5: Check convergence
    if (avgScore >= TARGET_SCORE) {
      console.log(`\n✅ Target score reached (${avgScore.toFixed(1)} >= ${TARGET_SCORE})!`);
      writeFileSync(join(iterDir, 'summary.json'), JSON.stringify({
        iteration: iter,
        avgScore,
        converged: true,
        comparisons: comparisons.length,
      }, null, 2));
      break;
    }

    if (avgScore <= bestScore + 1) {
      staleCount++;
      if (staleCount >= STALE_THRESHOLD) {
        console.log(`\n⚠ No improvement for ${STALE_THRESHOLD} iterations. Remaining issues:`);
        const allIssues = comparisons.flatMap((c) => c.result.issues);
        const uniqueProps = [...new Set(allIssues.map((i) => i.property))];
        uniqueProps.forEach((p) => {
          const issues = allIssues.filter((i) => i.property === p);
          console.log(`  - ${p}: ${issues[0].expected} (expected) vs ${issues[0].actual} (actual)`);
        });
        break;
      }
    } else {
      staleCount = 0;
      bestScore = avgScore;
    }

    // Step 6: Generate fixes
    console.log('\n  Generating fixes...');
    const templateCode = readFileSync(templatePath, 'utf-8');
    const fixes = await generateFixes(comparisons, currentStyleSpec, templateCode);

    console.log(`  Reasoning: ${fixes.reasoning}`);
    if (fixes.templateChanges.length > 0) {
      console.log(`  ⚠ Template code changes needed:`);
      fixes.templateChanges.forEach((tc) => console.log(`    - ${tc}`));
    }

    // Apply StyleSpec changes
    currentStyleSpec = fixes.updatedStyleSpec;
    writeFileSync(join(iterDir, 'fixes.json'), JSON.stringify(fixes, null, 2));

    writeFileSync(join(iterDir, 'summary.json'), JSON.stringify({
      iteration: iter,
      avgScore,
      converged: false,
      improvementFromPrevious: avgScore - bestScore,
      templateChangesNeeded: fixes.templateChanges,
    }, null, 2));
  }

  // Save final StyleSpec
  const finalPath = join(runDir, 'refined_preset.json');
  writeFileSync(finalPath, JSON.stringify({
    id: `reel-${slug}-refined`,
    name: `Reel ${slug} (Refined)`,
    description: 'Auto-refined caption style from Instagram reel',
    templateId: 'reel-clone',
    styleSpec: currentStyleSpec,
  }, null, 2));

  console.log(`\n✅ Final refined preset saved: ${finalPath}`);
  console.log(`   Best score achieved: ${bestScore.toFixed(1)}/100`);
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message ?? err);
  process.exit(1);
});
