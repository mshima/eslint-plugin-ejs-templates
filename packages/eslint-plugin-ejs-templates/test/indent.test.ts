// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import * as fixture5 from './fixtures/5.js';
import { lint, applyFix } from './helpers.js';

// ---------------------------------------------------------------------------
// Rule: ejs-templates/indent – violations
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/indent', () => {
  test('flags a standalone <%_ _%> tag with wrong indentation', () => {
    const input = '<%_ if (x) { _%>\n    <%_ doWork(); _%>\n<%_ } _%>';
    const msgs = lint(input, { 'ejs-templates/indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent').length).toBeGreaterThan(0);
  });

  test('flags a standalone multiline <%_ _%> tag with wrong indentation', () => {
    const input = '<%_ if (x) { %>\n    <%_\n    doWork();\n    _%>\n<%_ } %>';
    const msgs = lint(input, { 'ejs-templates/indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent').length).toBeGreaterThan(0);
  });

  // The `eslint-enable` an `eslint-disable-next-line` synthesizes carries the position of the tag after
  // it: that tag is reported once, on its own block.
  test('flags a tag after an eslint-disable-next-line comment once', () => {
    const input = '<%# eslint-disable-next-line no-var %>\n    <%_ var a = 1; _%>\n';
    const msgs = lint(input, { 'ejs-templates/indent': 'error', 'no-var': 'error' });
    expect(msgs.map(({ ruleId, line, column }) => [ruleId, line, column])).toEqual([['ejs-templates/indent', 2, 5]]);
  });

  test.each([
    ['blanks', '<%_ if (x) { _%>\n    <%_ doWork(); _%>\n<%_ } _%>\n', 'expected 2 spaces, got 4 spaces'],
    ['a tab', '<%_ if (x) { _%>\n\t<%_ doWork(); _%>\n<%_ } _%>\n', 'expected 2 spaces, got 1 tab'],
    ['none, at a depth of 0', '  <%_ doWork(); _%>\n', 'expected 0 spaces, got 2 spaces'],
  ])('tells the indentation expected and the one written: %s', (_label, input, values) => {
    expect(lint(input, { 'ejs-templates/indent': 'error' }).map(({ message }) => message)).toEqual([
      `Incorrect indentation for EJS tag; ${values}.`,
    ]);
  });

  test('tells the lines of a tag spanning lines not indented with it', () => {
    const input = '<%_ if (x) { _%>\n  <%_\n  doWork();\n  doMore();\n  _%>\n<%_ } _%>';
    expect(lint(input, { 'ejs-templates/indent': 'error' }).map(({ line, message }) => [line, message])).toEqual([
      [2, 'The lines of an EJS tag spanning lines are not indented with the tag.'],
    ]);
  });

  test('does not flag tags with correct brace-depth indentation', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>';
    const msgs = lint(input, { 'ejs-templates/indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent')).toHaveLength(0);
  });

  test('does not flag inline (non-standalone) tags', () => {
    const msgs = lint('Hello <%_ name _%>!', { 'ejs-templates/indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent')).toHaveLength(0);
  });

  test('does not flag non-slurp tags', () => {
    const msgs = lint('<% if (x) { %>\n    <% doWork(); %>\n<% } %>', { 'ejs-templates/indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: ejs-indent
// ---------------------------------------------------------------------------

describe('autofix: indent', () => {
  test('strips over-indentation from a depth-1 tag', () => {
    const input = '<%_ if (x) { _%>\n    <%_ doWork(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('adds indentation to an under-indented depth-1 tag', () => {
    const input = '<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('correctly indents closing tag (depth goes back to 0)', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n  <%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('handles two-level nesting', () => {
    const input = '<%_ if (a) { _%>\n<%_ if (b) { _%>\n<%_ doWork(); _%>\n<%_ } _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (a) { _%>\n  <%_ if (b) { _%>\n    <%_ doWork(); _%>\n  <%_ } _%>\n<%_ } _%>',
    );
  });

  test('fix is idempotent', () => {
    const input = '<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>';
    const first = applyFix(input, { 'ejs-templates/indent': 'error' });
    const second = applyFix(first, { 'ejs-templates/indent': 'error' });
    expect(second).toBe(first);
  });

  test('does not move inline tags', () => {
    const input = 'Hello <%_ name _%>!';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(input);
  });

  test('brace depth tracks <% %> structural tags too', () => {
    // A structural `<% if (x) { %>` (code type) increments brace depth,
    // so the following <%_ %>  slurp tag should be indented.
    const input = '<% if (x) { %>\n<%_ doWork(); _%>\n<% } %>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe('<% if (x) { %>\n  <%_ doWork(); _%>\n<% } %>');
  });

  test('aligns close-open transition tags like } else { with the opening block level', () => {
    const input = '<%_ if (x) { _%>\n  <%_ a(); _%>\n<%_ } else { _%>\n  <%_ b(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ a(); _%>\n<%_ } else { _%>\n  <%_ b(); _%>\n<%_ } _%>',
    );
  });

  test('indents multiline slurp tag and its content', () => {
    const input = '<%_ if (x) { %>\n<%_\ndoWork();\ndoMore();\n_%>\n<%_ } %>';
    expect(applyFix(input, { 'ejs-templates/indent': ['error', { normalizeContent: false }] })).toBe(
      '<%_ if (x) { %>\n  <%_ doWork();\ndoMore();\n  _%>\n<%_ } %>',
    );
  });

  test('normalizes multiline content when normalizeContent=true', () => {
    const input = '<%_ if (x) { %>\n<%_\ndoWork();\ndoMore();\n_%>\n<%_ } %>';
    expect(applyFix(input, { 'ejs-templates/indent': ['error', { normalizeContent: true }] })).toBe(
      '<%_ if (x) { %>\n  <%_ doWork();\n      doMore();\n  _%>\n<%_ } %>',
    );
  });

  // The fix rewrites the line from its start: a tag with text before it on its line would lose that text.
  test('leaves the content of a multiline tag with text before it on its line', () => {
    const input = '<%_ if (x) { _%>\nb + <%_ }\n        y();\n_%>\n';
    expect(lint(input, { 'ejs-templates/indent': 'error' })).toEqual([]);
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(input);
  });

  test('normalizes content of already-correctly-indented multiline tag when normalizeContent=true', () => {
    const input = '<%_ if (x) { _%>\n  <%_\n  doWork();\n  doMore();\n  _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': ['error', { normalizeContent: true }] })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork();\n      doMore();\n  _%>\n<%_ } _%>',
    );
  });

  test('does not change already-correctly-indented multiline tag without normalizeContent', () => {
    const input = '<%_ if (x) { _%>\n  <%_\n  doWork();\n  doMore();\n  _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': ['error', { normalizeContent: false }] })).toBe(input);
  });

  test('does not re-report already-normalized multiline tag when normalizeContent=true (idempotent)', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork();\n      doMore();\n  _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': ['error', { normalizeContent: true }] })).toBe(input);
  });

  test('does not normalize slurp-multiline when close is on same content line (avoids conflict with format same-line)', () => {
    // close on same line as last content → normalizeContent skips it to avoid circular fix
    const input = '<%_ if (x) { _%>\n  <%_ doWork();\n  doMore(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': ['error', { normalizeContent: true }] })).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// An unused next-line disable directive
// ---------------------------------------------------------------------------

describe('unused eslint-disable-next-line ejs-templates/indent', () => {
  const input = 'a\n<%# eslint-disable-next-line ejs-templates/indent %>\n<%_ if (x) { _%>\nb\n<%_ } _%>\n';

  test('is reported once, at its comment tag', () => {
    expect(lint(input, { 'ejs-templates/indent': 'error' })).toEqual([
      {
        ruleId: null,
        message: "Unused eslint-disable directive (no problems were reported from 'ejs-templates/indent').",
        line: 2,
        column: 1,
        severity: 1,
        fix: { range: [2, 54], text: '' },
      },
    ]);
  });

  test('autofix removes the comment tag alone', () => {
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toMatchInlineSnapshot(`
      "a

      <%_ if (x) { _%>
      b
      <%_ } _%>
      "
    `);
  });

  test("is reported once with reportUnusedDisableDirectives='error'", () => {
    expect(lint(input, { 'ejs-templates/indent': 'error' }, { reportUnusedDisableDirectives: 'error' })).toEqual([
      {
        ruleId: null,
        message: "Unused eslint-disable directive (no problems were reported from 'ejs-templates/indent').",
        line: 2,
        column: 1,
        severity: 2,
        fix: { range: [2, 54], text: '' },
      },
    ]);
  });

  test("autofix removes the comment tag alone with reportUnusedDisableDirectives='error'", () => {
    const fixed = applyFix(input, { 'ejs-templates/indent': 'error' }, { reportUnusedDisableDirectives: 'error' });
    expect(fixed).toMatchInlineSnapshot(`
      "a

      <%_ if (x) { _%>
      b
      <%_ } _%>
      "
    `);
    expect(lint(fixed, { 'ejs-templates/indent': 'error' }, { reportUnusedDisableDirectives: 'error' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fixture tests – indent
// ---------------------------------------------------------------------------

describe('indent fixture tests', () => {
  test('fixture 5 (indent) autofix produces expected output', () => {
    const fixed = applyFix(fixture5.input, fixture5.rules);
    expect(fixed).toBe(fixture5.expected);
  });

  test('fixture 5 expected is already fixed (idempotent)', () => {
    const fixed = applyFix(fixture5.expected, fixture5.rules);
    expect(fixed).toBe(fixture5.expected);
  });
});
