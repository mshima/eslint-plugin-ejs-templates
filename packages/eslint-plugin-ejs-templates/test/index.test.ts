// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect, vi } from 'vitest';
import ejs from 'ejs';
import stylistic from '@stylistic/eslint-plugin';
import * as fixture1 from './fixtures/1.js';
import * as fixture2 from './fixtures/2.js';
import * as fixture3 from './fixtures/3.js';
import * as fixture4 from './fixtures/4.js';
import plugin from '../src/index.js';
import { lint, applyFix, makeLinter } from './helpers.js';

// ---------------------------------------------------------------------------
// Autofix: both rules together
// ---------------------------------------------------------------------------

describe('autofix: prefer-encoded (never) and prefer-slurping-codeonly together', () => {
  test('fixes both types of violations in a single pass', () => {
    const input = '<%= a %>\n<% doWork(); %>';
    const fixed = applyFix(input, {
      'ejs-templates/prefer-encoded': ['error', 'never'],
      'ejs-templates/prefer-slurping-codeonly': 'error',
    });
    expect(fixed).toBe('<%- a %>\n<%_ doWork(); _%>');
  });
});

// ---------------------------------------------------------------------------
// Fixture tests
// ---------------------------------------------------------------------------

describe('fixture tests', () => {
  test('fixture 1 (real-world EJS) produces no violations with both rules enabled', () => {
    const msgs = lint(fixture1.input, {
      'ejs-templates/prefer-encoded': ['error', 'never'],
      'ejs-templates/prefer-slurping-codeonly': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('fixture 2 (real-world EJS) produces no violations with both rules enabled', () => {
    const msgs = lint(fixture2.input, {
      'ejs-templates/prefer-encoded': ['error', 'never'],
      'ejs-templates/prefer-slurping-codeonly': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('fixture 2 is already in expected form (input === expected)', () => {
    expect(fixture2.input).toBe(fixture2.expected);
  });

  test('fixture 3 input has violations (needs prefer-encoded:never and prefer-slurping fixes)', () => {
    const msgs = lint(fixture3.input, {
      'ejs-templates/prefer-encoded': ['error', 'never'],
      'ejs-templates/prefer-slurping-codeonly': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-encoded').length).toBeGreaterThan(0);
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-slurping-codeonly').length).toBeGreaterThan(0);
  });

  test('fixture 3 autofix produces the expected output', () => {
    const fixed = applyFix(fixture3.input, {
      'ejs-templates/prefer-encoded': ['error', 'never'],
      'ejs-templates/prefer-slurping-codeonly': 'error',
    });
    expect(fixed).toBe(fixture3.expected);
  });
});

// ---------------------------------------------------------------------------
// Fixture tests – formatting (prefer-single-line-tags + ejs-indent)
// ---------------------------------------------------------------------------

describe('formatting fixture tests', () => {
  test('fixture 4 (prefer-single-line-tags + prefer-encoded:never) autofix produces expected output', () => {
    const fixed = applyFix(fixture4.input, fixture4.rules);
    expect(fixed).toBe(fixture4.expected);
  });

  test('fixture 4 expected is already fixed (idempotent)', () => {
    const fixed = applyFix(fixture4.expected, fixture4.rules);
    expect(fixed).toBe(fixture4.expected);
  });
});

// ---------------------------------------------------------------------------
// A next-line disable directive partly unused
// ---------------------------------------------------------------------------

describe('eslint-disable-next-line partly unused', () => {
  const input = '<%# eslint-disable-next-line no-var, eqeqeq %>\n<% var x = 1; %>\n<% var y = 1; %>\n';
  const rules = { 'no-var': 'error', eqeqeq: 'error' } as const;

  test('is reported once, at its comment tag', () => {
    expect(lint(input, rules)).toEqual([
      {
        ruleId: null,
        message: "Unused eslint-disable directive (no problems were reported from 'eqeqeq').",
        line: 1,
        column: 1,
        severity: 1,
        fix: { range: [0, 46], text: '<%# eslint-disable-next-line no-var %>' },
      },
      {
        ruleId: 'no-var',
        severity: 2,
        message: 'Unexpected var, use let or const instead.',
        line: 3,
        column: 4,
        messageId: 'unexpectedVar',
        endLine: 3,
        endColumn: 14,
        fix: { range: [67, 70], text: 'let' },
      },
    ]);
  });

  test('autofix keeps the used rule in the next-line directive and the tag after it', () => {
    expect(applyFix(input, rules)).toMatchInlineSnapshot(`
      "<%# eslint-disable-next-line no-var %>
      <% var x = 1; %>
      <% let y = 1; %>
      "
    `);
  });

  test("autofix keeps the used rule in the next-line directive with reportUnusedDisableDirectives='error'", () => {
    const fixed = applyFix(input, rules, { reportUnusedDisableDirectives: 'error' });
    expect(fixed).toMatchInlineSnapshot(`
      "<%# eslint-disable-next-line no-var %>
      <% var x = 1; %>
      <% let y = 1; %>
      "
    `);
    expect(lint(fixed, rules, { reportUnusedDisableDirectives: 'error' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rules on a file the processor did not read
// ---------------------------------------------------------------------------

describe('experimental-prefer-slurp-multiline, format and indent together', () => {
  // Each pass fixes the tags the one before rewrote: slurp delimiters, the close on a line of its own, then the
  // indentation, which leaves alone a tag with text before it on its line.
  test('keep the texts of an else if chain written inline', () => {
    const input = 'a(<%\n  if (b) { %>B(<% } else\n  if (c) { %>C(<% } else\n  if (d) { %>D(<% } %>x\n';
    const fixed = applyFix(input, {
      'ejs-templates/experimental-prefer-slurp-multiline': 'error',
      'ejs-templates/format': 'error',
      'ejs-templates/indent': 'error',
    });
    expect(fixed).toMatchInlineSnapshot(`
      "a(<%_ if (b) { _%>B(<%_ } else
        if (c) {
      _%>C(<%_ } else
        if (d) {
      _%>D(<% } %>x
      "
    `);
    const data = [
      { b: true, c: false, d: false },
      { b: false, c: true, d: false },
      { b: false, c: false, d: true },
      { b: false, c: false, d: false },
    ];
    expect(data.map((locals) => ejs.render(fixed, locals))).toEqual(data.map((locals) => ejs.render(input, locals)));
  });
});

describe('indent and @stylistic/indent-binary-ops', () => {
  // `@stylistic/indent-binary-ops` indents the line of the right operand of a binary expression from the line of its
  // left one; `ejs-templates/indent` re-indents the lines of a tag spanning lines (`normalizeContent`). It accepts that
  // line indented as much as or more than the line the expression starts on, which customize() sets when the rule is
  // on: until it did, the two fixed each other until ESLint gave up (ESLintCircularFixesWarning).
  test('fix a tag spanning lines without fixing each other', () => {
    const config = plugin.configs.customize(
      { stylisticBlocklist: true },
      stylistic.configs.customize({ jsx: false, semi: true }),
      { rules: { 'ejs-templates/indent': 'error' } },
    );
    const input = "  <%_ if ((a === 'x' || (a === 'y' && b === true))\n                && !c) { _%>\nx\n  <%_ } _%>\n";
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      const { output, messages } = makeLinter().verifyAndFix(input, config, { filename: 'template.ejs' });
      expect(output).toMatchInlineSnapshot(`
        "<%_ if ((a === 'x' || (a === 'y' && b === true))
              && !c) {
        _%>
        x
        <%_ } _%>
        "
      `);
      expect(messages).toEqual([]);
      expect(emitWarning).not.toHaveBeenCalled();
    } finally {
      emitWarning.mockRestore();
    }
  });
});

describe('rules on a JavaScript file', () => {
  test.each([
    'experimental-prefer-slurp-multiline',
    'format',
    'indent',
    'no-comment-empty-line',
    'no-complex-statements',
    'no-function-block',
    'no-global-function-call',
    'no-multiline-output',
    'output-semi',
    'prefer-encoded',
    'prefer-single-line-tags',
    'prefer-slurping-codeonly',
    'slurp-newline',
  ])('ejs-templates/%s reports nothing', (rule) => {
    const messages = makeLinter().verify(
      'const value = 1;\n',
      [{ files: ['**/*.js'], plugins: { 'ejs-templates': plugin }, rules: { [`ejs-templates/${rule}`]: 'error' } }],
      { filename: 'file.js' },
    );
    expect(messages).toEqual([]);
  });
});
