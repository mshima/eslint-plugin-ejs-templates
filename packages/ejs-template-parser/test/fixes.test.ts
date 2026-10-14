// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import ejs from 'ejs';
import { describe, expect, test } from 'vitest';
import {
  type EjsDiagnosticCode,
  type EjsFixOptions,
  buildTemplate,
  cleanupTemplate,
  fixOf,
  validateTemplate,
} from '../src/index.js';

/** The template fixed at its diagnostic of a code, and the fix; the template as it is without one. */
const fixed = (text: string, code: EjsDiagnosticCode, options?: EjsFixOptions): string => {
  const template = buildTemplate(text);
  try {
    const diagnostic = validateTemplate(template).find((d) => d.code === code);
    const fix = diagnostic && fixOf(template, diagnostic, options);
    return fix ? text.slice(0, fix.offset) + fix.text + text.slice(fix.offset + fix.length) : text;
  } finally {
    cleanupTemplate(template);
  }
};

const data = { a: true, b: () => undefined, c: () => '', items: [1, 2] };

describe('fixOf', () => {
  // The fixes of the slurp tags and of the comment tags change the blanks and the line breaks the template renders.
  test.each([
    ['no-comment-empty-line', 'a\n<%# note %>\nb\n', 'a\n<%# note -%>\nb\n'],
    ['slurp-newline', 'a <%_ b() _%>\nc\n', 'a \n<%_ b() _%>\nc\n'],
    ['prefer-slurping-codeonly', 'a\n<%   b()   %>\nc\n', 'a\n<%_ b() _%>\nc\n'],
  ] as const)('%s', (code, text, expected) => {
    expect(fixed(text, code)).toBe(expected);
  });

  // The fixes of indent and prefer-single-line-tags keep what the template renders.
  test.each([
    ['indent', '<%_ if (a) { _%>\n<%_ b() _%>\n<%_ } _%>\n', {}, '<%_ if (a) { _%>\n  <%_ b() _%>\n<%_ } _%>\n'],
    [
      'indent',
      '<%_ if (a) { _%>\n<%_ b(\n      1)\n_%>\n<%_ } _%>\n',
      { normalizeContent: true },
      '<%_ if (a) { _%>\n  <%_ b(\n        1)\n  _%>\n<%_ } _%>\n',
    ],
    [
      'prefer-single-line-tags',
      '  <%_ if (a) {\n  b(); _%>\n  <%_ } _%>\n',
      {},
      '  <%_ if (a) { _%>\n  <%_ b(); _%>\n  <%_ } _%>\n',
    ],
    [
      'prefer-single-line-tags',
      '  <%_ if (a) {\n  b(); _%>\n  <%_ } _%>\n',
      { indentSplitTags: true },
      '<%_ if (a) { _%>\n  <%_ b(); _%>\n  <%_ } _%>\n',
    ],
    [
      'prefer-single-line-tags',
      '<% if (a) { %><% if (b) { %>x <% } } %> y\n',
      {},
      '<% if (a) { %><% if (b) { %>x <% } %><% } %> y\n',
    ],
    [
      'indent',
      '<%_ if (a) { _%>\n<%_ b(\n      1)\n_%>\n<%_ } _%>\n',
      {},
      '<%_ if (a) { _%>\n  <%_ b(\n      1)\n  _%>\n<%_ } _%>\n',
    ],
    [
      'indent',
      '<%_ if (a) { _%>\n<%_ items.forEach((i) => {\nc(i)\n.toString();\n});\n_%>\n<%_ } _%>\n',
      { normalizeContent: true },
      '<%_ if (a) { _%>\n  <%_ items.forEach((i) => {\n        c(i)\n          .toString();\n      });\n  _%>\n<%_ } _%>\n',
    ],
    [
      'prefer-single-line-tags',
      '<% if (a) { %><% if (b) { %>x <%_ } } _%> y\n',
      {},
      '<% if (a) { %><% if (b) { %>x <%_ } _%><%_ } _%> y\n',
    ],
    [
      'prefer-single-line-tags',
      '<%_ if (a) {\n  b();\n} else { _%>\nx\n<%_ } _%>\n',
      { indentSplitTags: true },
      '<%_ if (a) { _%>\n  <%_ b(); _%>\n<%_ } else { _%>\nx\n<%_ } _%>\n',
    ],
    [
      'indent',
      '<%_ if (a) { _%>\n<%_ items.forEach((i) => {\nif (i) {\nc(i);\n}\n});\n_%>\n<%_ } _%>\n',
      { normalizeContent: true },
      '<%_ if (a) { _%>\n  <%_ items.forEach((i) => {\n        if (i) {\n          c(i);\n        }\n      });\n  _%>\n<%_ } _%>\n',
    ],
    [
      'indent',
      '<%_ if (a) { _%>\n<%_ b();\n   c();\n_%>\n<%_ } _%>\n',
      { normalizeContent: true },
      '<%_ if (a) { _%>\n  <%_ b();\n      c();\n  _%>\n<%_ } _%>\n',
    ],
    // The line where the right operand of a binary expression starts, apart from the left one: as written indented more
    // than the line the expression starts on, by any amount; one level more than it otherwise.
    [
      'indent',
      '<%_ if (a) { _%>\n<%_ const x = a\n          && b;\nconst y = c ||\n b;\n_%>\n<%_ } _%>\n',
      { normalizeContent: true },
      '<%_ if (a) { _%>\n  <%_ const x = a\n          && b;\n      const y = c ||\n        b;\n  _%>\n<%_ } _%>\n',
    ],
    // As much indented as that line: one level more by default, as written with `greaterOrEqual`.
    [
      'indent',
      '<%_ if (a) { _%>\n<%_ b();\nconst y = c ||\n      b;\n_%>\n<%_ } _%>\n',
      { normalizeContent: true },
      '<%_ if (a) { _%>\n  <%_ b();\n      const y = c ||\n        b;\n  _%>\n<%_ } _%>\n',
    ],
    [
      'indent',
      '<%_ if (a) { _%>\n<%_ b();\nconst y = c ||\n      b;\n_%>\n<%_ } _%>\n',
      { normalizeContent: true, binaryOperands: 'greaterOrEqual' },
      '<%_ if (a) { _%>\n  <%_ b();\n      const y = c ||\n      b;\n  _%>\n<%_ } _%>\n',
    ],
    // An operator at a line break, of no binary expression spanning lines.
    [
      'indent',
      '<%_ if (a) { _%>\n<%_ const x = a + 1;\n!a && b();\n_%>\n<%_ } _%>\n',
      { normalizeContent: true },
      '<%_ if (a) { _%>\n  <%_ const x = a + 1;\n      !a && b();\n  _%>\n<%_ } _%>\n',
    ],
  ] as const)('%s %j', (code, text, options, expected) => {
    const result = fixed(text, code, options);
    expect(result).toBe(expected);
    expect(ejs.render(result, data)).toBe(ejs.render(text, data));
  });

  test('gives no fix where the convention changes nothing, or has none', () => {
    const template = buildTemplate('<%_ a() _%>\n<%# b %>\n');
    try {
      expect([
        fixOf(template, { code: 'indent', offset: 0 }),
        fixOf(template, { code: 'javascript-error', offset: 0 }),
        fixOf(template, { code: 'indent', offset: 12 }),
        fixOf(template, { code: 'indent', offset: 3 }),
      ]).toEqual([undefined, undefined, undefined, undefined]);
    } finally {
      cleanupTemplate(template);
    }
  });

  test('reads a template before it is freed', () => {
    const template = buildTemplate('<% a() %>');
    cleanupTemplate(template);
    expect(() => fixOf(template, { code: 'indent', offset: 0 })).toThrow(
      'fixOf reads a template before cleanupTemplate frees it',
    );
  });
});
