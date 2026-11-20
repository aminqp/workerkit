// @vitest-environment node
/**
 * Runs the shipped ESLint plugin the way a consumer does — through
 * `configs.recommended` — against this repository's real worker files and
 * against inline examples of what must (and must not) be flagged.
 */
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const workerPlugin = require('./index.cjs');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function createLinter() {
  return new ESLint({
    cwd: repoRoot,
    // Lint whichever worker folders exist; a missing one is not an error.
    errorOnUnmatchedPattern: false,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.ts'], languageOptions: { parser: tsParser } },
      ...workerPlugin.configs.recommended,
    ],
  });
}

async function lint(code: string) {
  const [result] = await createLinter().lintText(code, {
    filePath: `${repoRoot}example.worker.ts`,
  });
  return result.messages.map((m) => m.ruleId);
}

describe('ESLint plugin configs.recommended', () => {
  it('registers every rule it enables (the config loads without errors)', () => {
    const [config] = workerPlugin.configs.recommended;
    for (const ruleId of Object.keys(config.rules)) {
      const ruleName = ruleId.replace('workerkit/', '');
      expect(config.plugins.workerkit.rules[ruleName]).toBeDefined();
    }
  });

  it("is clean on this repository's real worker files", async () => {
    const results = await createLinter().lintFiles([
      'src/demo/examples/*.worker.ts',
      'e2e/harness/workers/*.worker.ts',
    ]);
    const problems = results
      .filter((r) => !r.filePath.endsWith('broken.worker.ts'))
      .flatMap((r) =>
        r.messages.map(
          (m) => `${r.filePath.replace(repoRoot, '')}:${m.line} ${m.ruleId}`,
        ),
      );
    expect(results.length).toBeGreaterThan(10);
    expect(problems).toEqual([]);
  });

  it('allows the documented `export default defineWorker(...)` pattern', async () => {
    expect(
      await lint(
        "import { defineWorker } from '@offmain/workerkit/define-worker';\n" +
          'export interface Params { data: number[] }\n' +
          'export default defineWorker(({ data }: Params) => data);\n',
      ),
    ).toEqual([]);
  });

  it('allows a bare `defineWorker(fn)` call without named exports', async () => {
    expect(
      await lint(
        "import { defineWorker } from '@offmain/workerkit/define-worker';\n" +
          'const double = ({ data }: { data: number[] }) => data.map((n) => n * 2);\n' +
          'defineWorker(double);\n',
      ),
    ).toEqual([]);
  });

  it('allows hand-written worker scripts that listen for messages themselves', async () => {
    for (const listener of [
      'self.onmessage = (event) => self.postMessage(event.data);\n',
      'onmessage = (event) => postMessage(event.data);\n',
      "self.addEventListener('message', (event) => self.postMessage(event.data));\n",
      "addEventListener('message', (event) => postMessage(event.data));\n",
    ]) {
      expect(await lint(listener), listener).toEqual([]);
    }
  });

  it('still requires an export when a file neither exports nor listens for messages', async () => {
    for (const code of [
      'const double = (n: number) => n * 2;\n',
      // Listening for other events, or on another object, does not count.
      "self.addEventListener('error', () => {});\n",
      'port.onmessage = () => {};\n',
    ]) {
      expect(await lint(code), code).toContain('workerkit/worker-exportable');
    }
  });

  it('still flags default exports, classes and values', async () => {
    expect(await lint('export default function () { return 1; }\n')).toContain(
      'workerkit/worker-exportable',
    );
    expect(
      await lint('export function ok() {}\nexport class Nope {}\n'),
    ).toContain('workerkit/worker-exportable');
    expect(
      await lint('export function ok() {}\nexport const value = 42;\n'),
    ).toContain('workerkit/worker-exportable');
  });

  it('still flags DOM access inside workers', async () => {
    expect(
      await lint('export function w() { return document.title; }\n'),
    ).toContain('workerkit/no-dom-in-worker');
  });
});
