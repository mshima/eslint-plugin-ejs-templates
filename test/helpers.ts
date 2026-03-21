// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { Linter } from 'eslint';
import plugin from '../src/index.js';
import { type Config } from 'eslint/config';

/** Create a Linter pre-configured with the templates plugin and EJS processor. */
export function makeLinter(): Linter {
  return new Linter({ configType: 'flat' });
}

/** The flat config used for all EJS linting in tests. */
export function makeConfig(
  rules: Record<string, Linter.RuleSeverityAndOptions | Linter.RuleSeverity> = {},
): Config[] {
  return [
    {
      files: ['**/*.ejs'],
      plugins: { templates: plugin },
      processor: 'templates/ejs',
      rules,
    },
  ] as const satisfies Config[];
}

/** Lint an EJS string and return all messages. */
export function lint(
  ejsText: string,
  rules: Record<string, Linter.RuleSeverityAndOptions | Linter.RuleSeverity> = {},
): Linter.LintMessage[] {
  return makeLinter().verify(ejsText, makeConfig(rules), { filename: 'template.ejs' });
}

/**
 * Apply ESLint autofix to an EJS string and return the fixed text.
 * Uses `Linter.verifyAndFix` which iterates until no further fixes are possible.
 */
export function applyFix(
  ejsText: string,
  rules: Record<string, Linter.RuleSeverityAndOptions | Linter.RuleSeverity> = {},
): string {
  return makeLinter().verifyAndFix(ejsText, makeConfig(rules), { filename: 'template.ejs' }).output;
}
