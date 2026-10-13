// Copyright 2026 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import ejs from 'ejs';
import { ESLint, type Linter } from 'eslint';
import { lint, makeConfig, makeLinter } from './helpers.js';

const rules = { 'ejs-templates/no-stray-close-delimiter': 'error' } as const;

const message = (delimiter: string) => `EJS drops this ${delimiter} of the text: write %%> for a literal one`;

/** The text a suggestion of a message gives. */
const applySuggestion = (text: string, suggestion: Linter.LintSuggestion): string =>
  text.slice(0, suggestion.fix.range[0]) + suggestion.fix.text + text.slice(suggestion.fix.range[1]);

// ---------------------------------------------------------------------------
// Rule: no-stray-close-delimiter
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-stray-close-delimiter', () => {
  test('reports a %> in a text', () => {
    expect(lint('a %> b\n<%= x %>\n', rules)).toEqual([
      {
        ruleId: 'ejs-templates/no-stray-close-delimiter',
        severity: 2,
        message: message('%>'),
        line: 1,
        column: 3,
        endLine: 1,
        endColumn: 5,
        suggestions: [
          { desc: 'Write it literally, the output then has it', fix: { range: [3, 3], text: '%' } },
          { desc: 'Delete it, the output unchanged', fix: { range: [2, 4], text: '' } },
        ],
      },
    ]);
  });

  test('reports a -%> in a text, deleted with the line break after it', () => {
    expect(lint('<%= x %>\na -%>\nb\n', rules)).toEqual([
      {
        ruleId: 'ejs-templates/no-stray-close-delimiter',
        severity: 2,
        message: message('-%>'),
        line: 2,
        column: 3,
        endLine: 2,
        endColumn: 6,
        suggestions: [
          { desc: 'Write it literally, the output then has it', fix: { range: [13, 13], text: '%' } },
          { desc: 'Delete it, the output unchanged', fix: { range: [11, 15], text: '' } },
        ],
      },
    ]);
  });

  test('reports a _%> in a text, deleted with the blanks and the line break after it', () => {
    expect(lint('<%= x %>\na _%>  \nb\n', rules)).toEqual([
      {
        ruleId: 'ejs-templates/no-stray-close-delimiter',
        severity: 2,
        message: message('_%>'),
        line: 2,
        column: 3,
        endLine: 2,
        endColumn: 6,
        suggestions: [
          { desc: 'Write it literally, the output then has it', fix: { range: [13, 13], text: '%' } },
          { desc: 'Delete it, the output unchanged', fix: { range: [11, 17], text: '' } },
        ],
      },
    ]);
  });

  test('reports each stray delimiter once', () => {
    const msgs = lint('<%_ if (x) { _%>\n  a %>\n  b -%>\n<%_ } _%>\n', rules);
    expect(msgs.map(({ line, column, message }) => [line, column, message])).toEqual([
      [2, 5, message('%>')],
      [3, 5, message('-%>')],
    ]);
  });

  test('reports a %> in a template without blocks', () => {
    expect(lint('a %> b\n', rules)).toEqual([
      {
        ruleId: 'ejs-templates/no-stray-close-delimiter',
        severity: 2,
        message: message('%>'),
        line: 1,
        column: 3,
        endLine: 1,
        endColumn: 5,
        suggestions: [
          { desc: 'Write it literally, the output then has it', fix: { range: [3, 3], text: '%' } },
          { desc: 'Delete it, the output unchanged', fix: { range: [2, 4], text: '' } },
        ],
      },
    ]);
  });

  test.each([
    ['a literal <%% … %>', '<%% x %> y\n'],
    ['a literal %%>', 'a %%> b\n<%= x %>\n'],
    ['the %> closing a tag', '<% x(); %>\n'],
    ['a template without delimiters', 'a b\n'],
  ])('does not report %s', (_label, template) => {
    expect(lint(template, rules)).toEqual([]);
  });

  test('reports with the severity of the configuration', () => {
    expect(lint('a %> b\n', { 'ejs-templates/no-stray-close-delimiter': 'warn' }).map((msg) => msg.severity)).toEqual([
      1,
    ]);
  });

  test('reports nothing when off', () => {
    expect(lint('a %> b\n<%= x %>\n', { 'ejs-templates/no-stray-close-delimiter': 'off' })).toEqual([]);
  });

  test('reports the fatal error alone when the virtual JavaScript does not parse', () => {
    expect(lint('<% if (x) { %>\na %> b\n<% ) %>\n', rules).map(({ fatal, ruleId }) => [fatal, ruleId])).toEqual([
      [true, null],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Suggestions: no-stray-close-delimiter
// ---------------------------------------------------------------------------

describe('suggestions: no-stray-close-delimiter', () => {
  test.each([
    ['%>', 'a %> b\n', 'a %%> b\n', 'a  b\n'],
    ['-%>', 'a -%>\nb\n', 'a -%%>\nb\n', 'a b\n'],
    ['_%>', 'a _%>  \nb\n', 'a _%%>  \nb\n', 'a b\n'],
    ['_%> followed by text', 'a _%>  b\n', 'a _%%>  b\n', 'a b\n'],
    ['-%> before CRLF', 'a -%>\r\nb\n', 'a -%%>\r\nb\n', 'a b\n'],
    ['%> at the end of the template', 'a %>', 'a %%>', 'a '],
    ['%> after a literal', '<%% x %> y %> z\n', '<%% x %> y %%> z\n', '<%% x %> y  z\n'],
    ['-%> before a <%_', 'a -%>\n<%_ x(); _%>\nb\n', 'a -%%>\n<%_ x(); _%>\nb\n', "a<%- ' ' %><%_ x(); _%>\nb\n"],
    ['%> between blanks before a <%_', 'a %> <%_ x(); _%>\n', 'a %%><%_ x(); _%>\n', "a<%- ' ' %><%_ x(); _%>\n"],
  ])('%s: written literally, or deleted', (_label, template, literal, deleted) => {
    const [msg] = lint(template, rules);
    expect(msg.suggestions?.map((suggestion) => applySuggestion(template, suggestion))).toEqual([literal, deleted]);
  });

  test.each([
    ['a %> b\n', ['a %> b\n']],
    ['a -%>\nb\n', ['a -%>\nb\n']],
    ['a _%>  \nb\n', ['a _%>  \nb\n']],
    ['a _%>  b\n', ['a _%>  b\n']],
    ['a %>\r\nb\n', ['a %>\r\nb\n']],
    ['a -%>\r\nb\n', ['a -%>\r\nb\n']],
    ['<%% x %> y %> z\n', ['<% x %> y %> z\n']],
    ['a %>%> b\n', ['a %> b\n', 'a %> b\n']],
    ['a %>-%>\nb\n', ['a %>b\n', 'a -%>\nb\n']],
    ['a -%>\n<%_ const x = 1; _%>\nb\n', ['a -%>\nb\n']],
    ['<%_ if (true) { _%>\n  a _%>\n<%_ } _%>\n', ['  a _%>\n']],
    ['a %> <%_ const x = 1; _%>\n', ['a %>']],
    ['a _%>\n', ['a _%>\n']],
  ])('%j: EJS renders the delimiter written literally, and the template unchanged without it', (template, literals) => {
    const msgs = lint(template, rules);
    expect(
      msgs.map(({ suggestions = [] }) =>
        suggestions.map((suggestion) => ejs.render(applySuggestion(template, suggestion))),
      ),
    ).toEqual(literals.map((literal) => [literal, ejs.render(template)]));
  });
});

// ---------------------------------------------------------------------------
// Directive comments: no-stray-close-delimiter
// ---------------------------------------------------------------------------

describe('directives: no-stray-close-delimiter', () => {
  const config = [...makeConfig(rules), { linterOptions: { reportUnusedDisableDirectives: 'error' as const } }];
  const directive = '<%# eslint-disable ejs-templates/no-stray-close-delimiter %>\n';

  test('a block eslint-disable of the template suppresses its messages', async () => {
    const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config });
    const [result] = await eslint.lintText(`${directive}a %> b\n`, { filePath: 'template.ejs' });
    expect(result.messages).toEqual([]);
    expect(
      result.suppressedMessages.map(({ ruleId, line, column, suppressions }) => [ruleId, line, column, suppressions]),
    ).toEqual([['ejs-templates/no-stray-close-delimiter', 2, 3, [{ kind: 'directive', justification: '' }]]]);
  });

  test('the directive of a template without the problem is reported unused', () => {
    expect(
      makeLinter()
        .verify(`${directive}a b\n`, config, { filename: 'template.ejs' })
        .map(({ ruleId, line, message }) => [ruleId, line, message]),
    ).toEqual([
      [
        null,
        1,
        "Unused eslint-disable directive (no problems were reported from 'ejs-templates/no-stray-close-delimiter').",
      ],
    ]);
  });
});
