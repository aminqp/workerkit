#!/usr/bin/env node
/**
 * Runs the React example against your working copy of the library — for
 * testing changes before publishing anything.
 *
 *   pnpm example:react
 *
 * 1. Builds the library in watch mode: every save under src/ rebuilds dist/,
 *    which is exactly what would be published.
 * 2. Once the first build is done, starts the example's dev server. The
 *    example imports the library through a pnpm workspace link to dist/, so
 *    each rebuild reaches the open page as a hot update (the example's
 *    factory module terminates its old factory and creates a new one).
 *
 * Ctrl+C stops both.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const exampleDir = join(root, 'examples', 'react-mui');
const children = new Set();
/** Resolvers of startVite() calls still waiting for their ready line. */
const waiting = new Set();
let stopping = false;

const stripColors = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

/**
 * Runs the Vite CLI installed in `cwd` with Node directly (no shell, on every
 * platform), prefixing its output; resolves on the first `readyLine` match.
 */
function startVite(label, cwd, args, readyLine) {
  return new Promise((resolve) => {
    waiting.add(resolve);
    const vite = join(cwd, 'node_modules', 'vite', 'bin', 'vite.js');
    const child = spawn(process.execPath, [vite, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1', WORKERKIT_LIB_WATCH: '1' },
    });
    children.add(child);
    let ready = false;
    const forward = (stream, target) =>
      stream.on('data', (chunk) => {
        if (stopping) return;
        for (const line of String(chunk).split('\n')) {
          if (line.trim()) target.write(`[${label}] ${line}\n`);
        }
        if (!ready && readyLine.test(stripColors(String(chunk)))) {
          ready = true;
          waiting.delete(resolve);
          resolve();
        }
      });
    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);
    child.on('exit', (code) => {
      children.delete(child);
      if (!stopping) {
        console.error(`[${label}] exited (${code}); stopping.`);
        stop(code ?? 1);
      }
    });
  });
}

function stop(code = 0) {
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  // Let the startup sequence below finish instead of exiting mid-await.
  for (const resolve of waiting) resolve();
  waiting.clear();
  process.exitCode = code;
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

await startVite(
  'library',
  root,
  ['build', '--config', 'vite.lib.config.ts', '--watch'],
  /built in/,
);
if (!stopping) {
  await startVite('example', exampleDir, [], /Local:/);
  console.log(
    '\nEdit the library under src/ — it rebuilds and the example picks it up.\n',
  );
}
