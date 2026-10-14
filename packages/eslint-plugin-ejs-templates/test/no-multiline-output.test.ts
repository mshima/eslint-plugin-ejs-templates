// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import ejs from 'ejs';
import { applyFix, lint } from './helpers.js';

const rules = { 'ejs-templates/no-multiline-output': 'error' } as const;

// ---------------------------------------------------------------------------
// Rule: no-multiline-output
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-multiline-output', () => {
  test('flags a raw output ternary that renders multiple lines', () => {
    const msgs = lint(String.raw`<%- condition ? 'aaa\nbbb' : '' %>`, rules);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('ejs-templates/no-multiline-output');
  });

  test('flags an escaped output ternary that renders multiple lines', () => {
    expect(lint(String.raw`<%= condition ? 'aaa\nbbb' : '' %>`, rules)).toHaveLength(1);
  });

  test('flags when only the alternate branch is multiline', () => {
    expect(lint(String.raw`<%- condition ? '' : 'ccc\nddd' %>`, rules)).toHaveLength(1);
  });

  test.each([
    ['a single-line ternary', String.raw`<%- condition ? 'aaa' : '' %>`],
    ['a tag that is not a ternary', String.raw`<%- someValue %>`],
    ['a ternary with a non-literal branch', String.raw`<%- condition ? foo : '' %>`],
    ['a template literal, which can interpolate', "<%- condition ? `aaa\\nbbb` : '' %>"],
    ['a code tag', String.raw`<% condition ? 'aaa\nbbb' : '' %>`],
    ['a tag spanning lines', "<%- condition\n  ? 'aaa\\nbbb'\n  : '' %>"],
    ['a ternary inside a call', String.raw`<%- f(condition ? 'aaa\nbbb' : '') %>`],
    ['a string with an escape it does not decode', String.raw`<%- condition ? 'aaa\nbbb\x41' : '' %>`],
    ['a backslash before an n, which renders no line break', String.raw`<%- condition ? 'aaa\\nbbb' : '' %>`],
  ])('does not flag %s', (_label, template) => {
    expect(lint(template, rules)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: no-multiline-output
// ---------------------------------------------------------------------------

describe('autofix: no-multiline-output', () => {
  test('converts to a conditional block whose text is flush against the tags', () => {
    expect(applyFix(String.raw`<%- condition ? 'aaa\nbbb' : '' %>`, rules)).toBe(
      '<% if (condition) { %>aaa\nbbb<% } %>',
    );
  });

  test('emits an else branch when the alternate is not empty', () => {
    expect(applyFix(String.raw`<%- condition ? 'aaa\nbbb' : 'ccc\nddd' %>`, rules)).toBe(
      '<% if (condition) { %>aaa\nbbb<% } else { %>ccc\nddd<% } %>',
    );
  });

  test('decodes escape sequences other than newlines', () => {
    expect(applyFix(String.raw`<%- c ? 'a\n\tb\'c' : '' %>`, rules)).toBe("<% if (c) { %>a\n\tb'c<% } %>");
  });

  test('keeps surrounding template text intact', () => {
    const template = 'before\n' + String.raw`<%- condition ? 'aaa\nbbb' : '' %>` + '\nafter';
    expect(applyFix(template, rules)).toBe('before\n<% if (condition) { %>aaa\nbbb<% } %>\nafter');
  });

  // Plain `<% %>` tags neither emit nor consume surrounding whitespace, so an indented or
  // inline tag rewrites faithfully — a slurp block would not, since it would swallow the
  // indentation that was literal output.
  test('fixes an indented tag, keeping the indentation as literal output', () => {
    expect(applyFix('  ' + String.raw`<%- condition ? 'aaa\nbbb' : '' %>`, rules)).toBe(
      '  <% if (condition) { %>aaa\nbbb<% } %>',
    );
  });

  // A `-%>` or a `_%>` drops the line break after it (and a `_%>` the blanks before that line
  // break): the last tag of the block closes with it, so that it stays dropped.
  test.each([
    ['-%>', String.raw`<%- c ? 'a\nb' : '' -%>` + '\nX\n', '<% if (c) { %>a\nb<% } -%>\nX\n'],
    ['_%>', String.raw`<%- c ? 'a\nb' : 'd' _%>` + '  \nX\n', '<% if (c) { %>a\nb<% } else { %>d<% } _%>  \nX\n'],
  ])('closes the block with the delimiter of the output tag, %s', (_label, template, fixed) => {
    const output = applyFix(template, rules);
    expect(output).toBe(fixed);
    expect([true, false].map((c) => ejs.render(output, { c }))).toEqual(
      [true, false].map((c) => ejs.render(template, { c })),
    );
  });

  test('fixes an inline tag, keeping the text on both sides', () => {
    expect(applyFix('xx' + String.raw`<%- condition ? 'aaa\nbbb' : '' %>` + 'yy', rules)).toBe(
      'xx<% if (condition) { %>aaa\nbbb<% } %>yy',
    );
  });

  // `<%=` escapes its value; the template text the fix produces is emitted raw.
  test.each([
    ['markup', String.raw`<%= condition ? '<b>\nx' : '' %>`],
    ['an ampersand', String.raw`<%= condition ? 'a&b\nc' : '' %>`],
    ['an apostrophe', String.raw`<%= c ? 'it\'s\nfine' : '' %>`],
  ])('reports but does not fix an escaped output tag containing %s', (_label, template) => {
    expect(lint(template, rules)).toHaveLength(1);
    expect(applyFix(template, rules)).toBe(template);
  });

  test('fixes a raw output tag containing markup, which needs no escaping', () => {
    expect(applyFix(String.raw`<%- condition ? '<b>\nx' : '' %>`, rules)).toBe('<% if (condition) { %><b>\nx<% } %>');
  });

  test('produces output that is stable and no longer reports', () => {
    const fixed = applyFix(String.raw`<%- condition ? 'aaa\nbbb' : '' %>`, rules);

    expect(applyFix(fixed, rules)).toBe(fixed);
    expect(lint(fixed, rules)).toHaveLength(0);
    expect(lint(fixed, {}).filter((msg) => msg.fatal)).toHaveLength(0);
  });

  test('does not collide with prefer-output, which only produces single-line ternaries', () => {
    const both = {
      'ejs-templates/no-multiline-output': 'error',
      'ejs-templates/prefer-output': 'error',
    } as const;
    const template = String.raw`<%- condition ? 'aaa\nbbb' : '' %>`;
    const fixed = applyFix(template, both);

    expect(fixed).toBe('<% if (condition) { %>aaa\nbbb<% } %>');
    expect(applyFix(fixed, both)).toBe(fixed);
  });
});
