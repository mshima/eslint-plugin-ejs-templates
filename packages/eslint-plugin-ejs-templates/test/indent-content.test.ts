// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Linter } from 'eslint';
import { describe, test, expect } from 'vitest';
import { lint, applyFix } from './helpers.js';

// ---------------------------------------------------------------------------
// Rule: ejs-templates/indent-content
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/indent-content', () => {
  test('tells the lines of a tag spanning lines not indented with it', () => {
    const input = '<%_ if (x) { _%>\n  <%_\n  doWork();\n  doMore();\n  _%>\n<%_ } _%>';
    expect(
      lint(input, { 'ejs-templates/indent-content': 'error' }).map(({ line, message }) => [line, message]),
    ).toEqual([[2, 'The lines of an EJS tag spanning lines are not indented with the tag.']]);
  });
});

// ---------------------------------------------------------------------------
// Autofix: indent-content
// ---------------------------------------------------------------------------

describe('autofix: indent-content', () => {
  // The line of a right operand as indented as the line its expression starts on: one level more by default, as written
  // with `binaryOperands: 'greaterOrEqual'`, as `@stylistic/indent-binary-ops` asks for some lines.
  test.each<[string, Linter.RuleEntry, string]>([
    ['by default', 'error', '<%_ const y = c ||\n      b;\n_%>\n'],
    ['with greaterOrEqual', ['error', { binaryOperands: 'greaterOrEqual' }], '<%_ const y = c ||\n    b;\n_%>\n'],
  ])('the line of a right operand %s', (_label, setting, expected) => {
    expect(applyFix('<%_ const y = c ||\n    b;\n_%>\n', { 'ejs-templates/indent-content': setting })).toBe(expected);
  });

  test('the line of a right operand less indented than its expression, with greaterOrEqual', () => {
    expect(
      applyFix('<%_ const y = c ||\n  b;\n_%>\n', {
        'ejs-templates/indent-content': ['error', { binaryOperands: 'greaterOrEqual' }],
      }),
    ).toBe('<%_ const y = c ||\n      b;\n_%>\n');
  });

  // The tag where it is, `indent-tag` placing it: its lines indented from its column.
  test('indents the lines of a tag where it is, misplaced or not', () => {
    const input = '<%_ if (x) { _%>\n    <%_ a(\n  b);\n    _%>\n<%_ } _%>\n';
    expect(applyFix(input, { 'ejs-templates/indent-content': 'error' })).toBe(
      '<%_ if (x) { _%>\n    <%_ a(\n          b);\n    _%>\n<%_ } _%>\n',
    );
  });

  // The fix rewrites the line from its start: a tag with text before it on its line would lose that text.
  test('leaves the content of a multiline tag with text before it on its line', () => {
    const input = '<%_ if (x) { _%>\nb + <%_ }\n        y();\n_%>\n';
    expect(lint(input, { 'ejs-templates/indent-content': 'error' })).toEqual([]);
    expect(applyFix(input, { 'ejs-templates/indent-content': 'error' })).toBe(input);
  });
  test('normalizes content of already-correctly-indented multiline tag', () => {
    const input = '<%_ if (x) { _%>\n  <%_\n  doWork();\n  doMore();\n  _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent-content': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork();\n      doMore();\n  _%>\n<%_ } _%>',
    );
  });
  test('does not re-report already-normalized multiline tag (idempotent)', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork();\n      doMore();\n  _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent-content': 'error' })).toBe(input);
  });
  test('does not normalize slurp-multiline when close is on same content line (avoids conflict with format same-line)', () => {
    // close on same line as last content → normalizeContent skips it to avoid circular fix
    const input = '<%_ if (x) { _%>\n  <%_ doWork();\n  doMore(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent-content': 'error' })).toBe(input);
  });
});
