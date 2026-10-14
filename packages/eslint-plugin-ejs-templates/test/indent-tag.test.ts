// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { lint, applyFix } from './helpers.js';

// ---------------------------------------------------------------------------
// Rule: ejs-templates/indent-tag – violations
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/indent-tag', () => {
  test('flags a standalone <%_ _%> tag with wrong indentation', () => {
    const input = '<%_ if (x) { _%>\n    <%_ doWork(); _%>\n<%_ } _%>';
    const msgs = lint(input, { 'ejs-templates/indent-tag': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent-tag').length).toBeGreaterThan(0);
  });
  test('flags a standalone multiline <%_ _%> tag with wrong indentation', () => {
    const input = '<%_ if (x) { %>\n    <%_\n    doWork();\n    _%>\n<%_ } %>';
    const msgs = lint(input, { 'ejs-templates/indent-tag': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent-tag').length).toBeGreaterThan(0);
  });
  // The `eslint-enable` an `eslint-disable-next-line` synthesizes carries the position of the tag after
  // it: that tag is reported once, on its own block.
  test('flags a tag after an eslint-disable-next-line comment once', () => {
    const input = '<%# eslint-disable-next-line no-var %>\n    <%_ var a = 1; _%>\n';
    const msgs = lint(input, { 'ejs-templates/indent-tag': 'error', 'no-var': 'error' });
    expect(msgs.map(({ ruleId, line, column }) => [ruleId, line, column])).toEqual([
      ['ejs-templates/indent-tag', 2, 5],
    ]);
  });
  test.each([
    ['blanks', '<%_ if (x) { _%>\n    <%_ doWork(); _%>\n<%_ } _%>\n', 'expected 2 spaces, got 4 spaces'],
    ['a tab', '<%_ if (x) { _%>\n\t<%_ doWork(); _%>\n<%_ } _%>\n', 'expected 2 spaces, got 1 tab'],
    ['none, at a depth of 0', '  <%_ doWork(); _%>\n', 'expected 0 spaces, got 2 spaces'],
    [
      'spaces and a tab',
      '<%_ if (x) { _%>\n  \t<%_ doWork(); _%>\n<%_ } _%>\n',
      'expected 2 spaces, got 2 spaces and 1 tab',
    ],
  ])('tells the indentation expected and the one written: %s', (_label, input, values) => {
    expect(lint(input, { 'ejs-templates/indent-tag': 'error' }).map(({ message }) => message)).toEqual([
      `Incorrect indentation for EJS tag; ${values}.`,
    ]);
  });
  test('does not flag tags with correct brace-depth indentation', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>';
    const msgs = lint(input, { 'ejs-templates/indent-tag': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent-tag')).toHaveLength(0);
  });
  test('does not flag inline (non-standalone) tags', () => {
    const msgs = lint('Hello <%_ name _%>!', { 'ejs-templates/indent-tag': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent-tag')).toHaveLength(0);
  });
  test('does not flag non-slurp tags', () => {
    const msgs = lint('<% if (x) { %>\n    <% doWork(); %>\n<% } %>', { 'ejs-templates/indent-tag': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent-tag')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: indent-tag
// ---------------------------------------------------------------------------

describe('autofix: indent-tag', () => {
  test('strips over-indentation from a depth-1 tag', () => {
    const input = '<%_ if (x) { _%>\n    <%_ doWork(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent-tag': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });
  test('adds indentation to an under-indented depth-1 tag', () => {
    const input = '<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent-tag': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });
  test('correctly indents closing tag (depth goes back to 0)', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n  <%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent-tag': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });
  test('handles two-level nesting', () => {
    const input = '<%_ if (a) { _%>\n<%_ if (b) { _%>\n<%_ doWork(); _%>\n<%_ } _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent-tag': 'error' })).toBe(
      '<%_ if (a) { _%>\n  <%_ if (b) { _%>\n    <%_ doWork(); _%>\n  <%_ } _%>\n<%_ } _%>',
    );
  });
  test('fix is idempotent', () => {
    const input = '<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>';
    const first = applyFix(input, { 'ejs-templates/indent-tag': 'error' });
    const second = applyFix(first, { 'ejs-templates/indent-tag': 'error' });
    expect(second).toBe(first);
  });
  test('does not move inline tags', () => {
    const input = 'Hello <%_ name _%>!';
    expect(applyFix(input, { 'ejs-templates/indent-tag': 'error' })).toBe(input);
  });
  test('brace depth tracks <% %> structural tags too', () => {
    // A structural `<% if (x) { %>` (code type) increments brace depth,
    // so the following <%_ %>  slurp tag should be indented.
    const input = '<% if (x) { %>\n<%_ doWork(); _%>\n<% } %>';
    expect(applyFix(input, { 'ejs-templates/indent-tag': 'error' })).toBe(
      '<% if (x) { %>\n  <%_ doWork(); _%>\n<% } %>',
    );
  });
  test('aligns close-open transition tags like } else { with the opening block level', () => {
    const input = '<%_ if (x) { _%>\n  <%_ a(); _%>\n<%_ } else { _%>\n  <%_ b(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent-tag': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ a(); _%>\n<%_ } else { _%>\n  <%_ b(); _%>\n<%_ } _%>',
    );
  });
  test('indents a multiline slurp tag, its lines as written', () => {
    const input = '<%_ if (x) { %>\n<%_\ndoWork();\ndoMore();\n_%>\n<%_ } %>';
    expect(applyFix(input, { 'ejs-templates/indent-tag': 'error' })).toBe(
      '<%_ if (x) { %>\n  <%_ doWork();\ndoMore();\n  _%>\n<%_ } %>',
    );
  });
  test('does not change an already-correctly-indented multiline tag', () => {
    const input = '<%_ if (x) { _%>\n  <%_\n  doWork();\n  doMore();\n  _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent-tag': 'error' })).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// An unused next-line disable directive
// ---------------------------------------------------------------------------

describe('unused eslint-disable-next-line ejs-templates/indent-tag', () => {
  const input = 'a\n<%# eslint-disable-next-line ejs-templates/indent-tag %>\n<%_ if (x) { _%>\nb\n<%_ } _%>\n';

  test('is reported once, at its comment tag', () => {
    expect(lint(input, { 'ejs-templates/indent-tag': 'error' })).toEqual([
      {
        ruleId: null,
        message: "Unused eslint-disable directive (no problems were reported from 'ejs-templates/indent-tag').",
        line: 2,
        column: 1,
        severity: 1,
        fix: { range: [2, 58], text: '' },
      },
    ]);
  });

  test('autofix removes the comment tag alone', () => {
    expect(applyFix(input, { 'ejs-templates/indent-tag': 'error' })).toMatchInlineSnapshot(`
      "a

      <%_ if (x) { _%>
      b
      <%_ } _%>
      "
    `);
  });

  test("is reported once with reportUnusedDisableDirectives='error'", () => {
    expect(lint(input, { 'ejs-templates/indent-tag': 'error' }, { reportUnusedDisableDirectives: 'error' })).toEqual([
      {
        ruleId: null,
        message: "Unused eslint-disable directive (no problems were reported from 'ejs-templates/indent-tag').",
        line: 2,
        column: 1,
        severity: 2,
        fix: { range: [2, 58], text: '' },
      },
    ]);
  });

  test("autofix removes the comment tag alone with reportUnusedDisableDirectives='error'", () => {
    const fixed = applyFix(input, { 'ejs-templates/indent-tag': 'error' }, { reportUnusedDisableDirectives: 'error' });
    expect(fixed).toMatchInlineSnapshot(`
      "a

      <%_ if (x) { _%>
      b
      <%_ } _%>
      "
    `);
    expect(lint(fixed, { 'ejs-templates/indent-tag': 'error' }, { reportUnusedDisableDirectives: 'error' })).toEqual(
      [],
    );
  });
});
