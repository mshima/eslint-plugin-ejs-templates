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

const rules = { 'ejs-templates/output-close': 'error' } as const;
const data = { a: 'A', x: 1, include: () => 'P\n' };

// ---------------------------------------------------------------------------
// Rule: output-close
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/output-close', () => {
  test.each([
    ['-%>', '<%- a -%>/>\n'],
    ['_%>', '<%= a _%>>\n'],
    ['-%> spanning lines', "<%- a\n  ? 'b' : 'c' -%>\nx\n"],
  ])('reports an output tag closed by %s', (_label, template) => {
    expect(lint(template, rules).map(({ ruleId, line, column, message }) => [ruleId, line, column, message])).toEqual([
      [
        'ejs-templates/output-close',
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
    ['a code tag', '<% x = 1 -%>\nb\n'],
    ['a slurp tag', '<%_ x = 1 _%>\nb\n'],
  ])('reports nothing on %s', (_label, template) => {
    expect(lint(template, rules)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Autofix: output-close
// ---------------------------------------------------------------------------

describe('autofix: output-close', () => {
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
