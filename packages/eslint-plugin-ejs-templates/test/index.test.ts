// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import * as fixture1 from './fixtures/1.js';
import * as fixture2 from './fixtures/2.js';
import * as fixture3 from './fixtures/3.js';
import * as fixture4 from './fixtures/4.js';
import { lint, applyFix } from './helpers.js';

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
        column: 0,
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
