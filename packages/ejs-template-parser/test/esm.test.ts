// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Installed at the root of the workspaces.
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

describe('the built package', () => {
  // Vitest, like jiti, defines the `require` an ES module lacks: only Node itself tells whether the module loads.
  test('loads in Node as a plain ES module', { timeout: 60_000 }, () => {
    execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: root });
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "const { parseTemplate } = await import('./dist/index.js'); const template = parseTemplate('<%= a %>'); console.log(template.tags.length); template.delete();",
      ],
      { cwd: root, encoding: 'utf8' },
    );
    expect(output).toBe('1\n');
  });
});
