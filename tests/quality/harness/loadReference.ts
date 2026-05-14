// Reference loader. Reads a reference directory and surfaces the prompt
// text, the expectation file, and (optionally) the mocked planner output.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExpectedFile } from './types.js';
import type { DirectorScript } from '../../../src/shared/director/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCES_DIR = resolve(HERE, '../references');
const MOCKS_DIR = resolve(HERE, 'mocks');

export type ReferenceBundle = {
  name: string;
  promptText: string;
  expected: ExpectedFile;
  mockedScriptPath: string;
  mockedScript: DirectorScript | null;
};

export function loadReference(name: string, target = 'orhan'): ReferenceBundle {
  const refDir = resolve(REFERENCES_DIR, name);
  const promptPath = resolve(refDir, 'prompt.txt');
  const expectedPath = resolve(refDir, 'expected.json');
  if (!existsSync(promptPath)) {
    throw new Error(`reference "${name}" has no prompt.txt at ${promptPath}`);
  }
  if (!existsSync(expectedPath)) {
    throw new Error(`reference "${name}" has no expected.json at ${expectedPath}`);
  }
  const promptText = readFileSync(promptPath, 'utf8');
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as ExpectedFile;

  const mockedScriptPath = resolve(MOCKS_DIR, `${name}-on-${target}.json`);
  let mockedScript: DirectorScript | null = null;
  if (existsSync(mockedScriptPath)) {
    mockedScript = JSON.parse(readFileSync(mockedScriptPath, 'utf8')) as DirectorScript;
  }

  return { name, promptText, expected, mockedScriptPath, mockedScript };
}
