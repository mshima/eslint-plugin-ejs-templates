// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import ejs from 'ejs';
import { describe, test, expect } from 'vitest';
import { lint, applyFix } from './helpers.js';

const rules = { 'ejs-templates/no-one-sided-trim': 'error' } as const;
const data = { a: 'A', x: 1, include: () => 'P\n' };

// ---------------------------------------------------------------------------
// Rule: no-one-sided-trim
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-one-sided-trim', () => {
  test.each([
    ['-%>', '<%- a -%>/>\n'],
    ['_%>', '<%= a _%>>\n'],
    ['-%> spanning lines', "<%- a\n  ? 'b' : 'c' -%>\nx\n"],
  ])('reports an output tag closed by %s', (_label, template) => {
    expect(lint(template, rules).map(({ ruleId, line, column, message }) => [ruleId, line, column, message])).toEqual([
      [
        'ejs-templates/no-one-sided-trim',
        1,
        1,
        `An output tag cannot trim what is before it: close it with \`%>\` rather than \`${template.includes('_%>') ? '_%>' : '-%>'}\`, which trims what is after it alone.`,
      ],
    ]);
  });

  test.each([
    ['an output tag closed by %>', '<%= a %>\n'],
    ['the output of an include, which ends with a line break', "<%- include('partial') -%>\nb\n"],
    ['an output tag ending the template, before its final line break', 'a\n<%- a -%>\n'],
    ['an output tag ending the template, before blanks and its final line break', 'a\n<%- a _%>  \n'],
    ['a code tag closed by %>', '<% x = 1 %>\nb\n'],
    ['a slurp tag', '<%_ x = 1 _%>\nb\n'],
    ['a slurp tag closed by -%>', '<%_ x = 1 -%>\nb\n'],
    ['a comment closed by -%>', '<%# a comment -%>\nb\n'],
  ])('reports nothing on %s', (_label, template) => {
    expect(lint(template, rules)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Autofix: no-one-sided-trim
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-one-sided-trim, code tags', () => {
  test.each([
    [
      '<% -%>',
      '<% x = 1 -%>\nb\n',
      'A code tag opened by `<%` trims what is after it alone with `-%>`: open it with `<%_`, which slurps the blanks before it.',
    ],
    [
      '<% _%>',
      '<% x = 1 _%>\nb\n',
      'A code tag opened by `<%` trims what is after it alone with `_%>`: open it with `<%_`, which slurps the blanks before it.',
    ],
    [
      '<%_ %>',
      '<%_ x = 1 %>\nb\n',
      'A code tag opened by `<%_` trims what is before it alone: close it with `_%>` or `-%>`, which trim what is after it.',
    ],
  ])('reports a code tag %s', (_label, template, message) => {
    expect(lint(template, rules).map(({ message }) => message)).toEqual([message]);
  });
});

describe('autofix: no-one-sided-trim, code tags', () => {
  // The output unchanged: nothing before the tag on its line, nothing after it on its line but text.
  test.each([
    ['<% -%> at the start of its line, opened by <%_', '<% x = 1 -%>\nb\n', '<%_ x = 1 -%>\nb\n'],
    ['<%_ %> before text, closed by -%>, which drops nothing', '<%_ x = 1 %> b\n', '<%_ x = 1 -%> b\n'],
    ['<%_ %> at the end of the template, closed by _%>', 'b\n<%_ x = 1 %>', 'b\n<%_ x = 1 _%>'],
    // The empty line the tag rendered written out after it, its line break the one `_%>` slurps.
    [
      '<%_ %> before the end of its line, closed by _%>, its empty line written',
      '<%_ x = 1 %>\nb\n',
      '<%_ x = 1 _%>\n\nb\n',
    ],
    ['<%_ %> before blanks and the end of its line', '<%_ x = 1 %>  \nb\n', '<%_ x = 1 _%>\n  \nb\n'],
    ['<%_ %> before a CRLF', '<%_ x = 1 %>\r\nb\r\n', '<%_ x = 1 _%>\r\n\r\nb\r\n'],
  ])('%s', (_label, template, expected) => {
    const fixed = applyFix(template, rules);
    expect(fixed).toBe(expected);
    expect(ejs.render(fixed, data)).toBe(ejs.render(template, data));
  });

  // `<%_` would slurp the blanks before it, which the tag renders: reported, not fixed.
  test.each([
    ['indented, alone on its line', '  <% x = 1 -%>\nb\n'],
    ['with text before it on its line', 'a <% x = 1 _%> b\n'],
  ])('leaves a <% tag %s', (_label, template) => {
    expect(lint(template, rules)).toHaveLength(1);
    expect(applyFix(template, rules)).toBe(template);
  });
});

describe('autofix: no-one-sided-trim', () => {
  // The close removes nothing: written `%>`, what EJS renders is unchanged.
  test.each([
    ['-%> before text', '<%- a -%>/>\nb\n', '<%- a %>/>\nb\n'],
    ['_%> before text', '<%= a _%>>\n', '<%= a %>>\n'],
    ['-%> at the end of the template', 'b <%= a -%>', 'b <%= a %>'],
    [
      '-%> before a tag, whose close sets anew what the next text loses',
      '<%= a -%><% x = 2 %>\nb\n',
      '<%= a %><% x = 2 %>\nb\n',
    ],
  ])('writes %%> when the close removes nothing: %s', (_label, template, expected) => {
    const fixed = applyFix(template, rules);
    expect(fixed).toBe(expected);
    expect(ejs.render(fixed, data)).toBe(ejs.render(template, data));
    expect(lint(fixed, rules)).toEqual([]);
  });

  // What the close removed, removed from the text: the next line joins the line of the tag, the output unchanged.
  test.each([
    ['-%> before a line break', '<%= a -%>\nb\n', '<%= a %>b\n'],
    ['-%> before a CR', '<%= a -%>\rb\n', '<%= a %>b\n'],
    ['_%> before blanks', '<%= a _%>  b\n', '<%= a %>b\n'],
    ['_%> before blanks and a line break', '<%= a _%>  \n  b\n', '<%= a %>  b\n'],
  ])('writes %%> and removes what the close removed: %s', (_label, template, expected) => {
    const fixed = applyFix(template, rules);
    expect(fixed).toBe(expected);
    expect(ejs.render(fixed, data)).toBe(ejs.render(template, data));
    expect(lint(fixed, rules)).toEqual([]);
  });

  // `<%%` writes without clearing what the next text loses: reported, not fixed.
  test('leaves a close before <%%', () => {
    const template = '<%= a -%><%%\nb\n';
    expect(lint(template, rules)).toHaveLength(1);
    expect(applyFix(template, rules)).toBe(template);
  });
});
