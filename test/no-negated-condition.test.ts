// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { applyFix, lint } from './helpers.js';

// The built-in ESLint rule does the reporting; this plugin only supplies the autofix it
// lacks, so the tests enable the core rule rather than a plugin rule.
const rules = { 'no-negated-condition': 'error' } as const;

// ---------------------------------------------------------------------------
// Rule: no-negated-condition
// ---------------------------------------------------------------------------

describe('rule: core no-negated-condition in EJS', () => {
  test('flags a negated if/else tag pair', () => {
    const msgs = lint('<% if (!foo) { %>A<% } else { %>B<% } %>', rules);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('no-negated-condition');
  });

  test.each([
    ['strict inequality', '<% if (a !== b) { %>A<% } else { %>B<% } %>'],
    ['loose inequality', '<% if (a != b) { %>A<% } else { %>B<% } %>'],
    ['parenthesised negation', '<% if (!(a && b)) { %>A<% } else { %>B<% } %>'],
    ['negated member access', '<% if (!user.active) { %>A<% } else { %>B<% } %>'],
  ])('flags %s', (_label, template) => {
    expect(lint(template, rules)).toHaveLength(1);
  });

  test.each([
    ['a positive condition', '<% if (foo) { %>A<% } else { %>B<% } %>'],
    ['a positive comparison', '<% if (a === b) { %>A<% } else { %>B<% } %>'],
    ['an if without else', '<% if (!foo) { %>A<% } %>'],
    ['an else if chain', '<% if (!foo) { %>A<% } else if (bar) { %>B<% } else { %>C<% } %>'],
    ['an else if without a final else', '<% if (!foo) { %>A<% } else if (bar) { %>B<% } %>'],
  ])('does not flag %s', (_label, template) => {
    expect(lint(template, rules)).toHaveLength(0);
  });

  test('flags each statement of a nested pair independently', () => {
    const template = '<% if (!a) { %>\n  <% if (!b) { %>X<% } else { %>Y<% } %>\n<% } else { %>\n  Z\n<% } %>\n';
    expect(lint(template, rules)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Autofix: no-negated-condition
// ---------------------------------------------------------------------------

describe('autofix: core no-negated-condition', () => {
  test('drops the negation and swaps the branches', () => {
    expect(applyFix('<% if (!foo) { %>A<% } else { %>B<% } %>', rules)).toBe('<% if (foo) { %>B<% } else { %>A<% } %>');
  });

  test('inverts a strict inequality rather than wrapping it', () => {
    expect(applyFix('<% if (a !== b) { %>A<% } else { %>B<% } %>', rules)).toBe(
      '<% if (a === b) { %>B<% } else { %>A<% } %>',
    );
  });

  test('inverts a loose inequality', () => {
    expect(applyFix('<% if (a != b) { %>A<% } else { %>B<% } %>', rules)).toBe(
      '<% if (a == b) { %>B<% } else { %>A<% } %>',
    );
  });

  test('does not double up parentheses around a negated group', () => {
    expect(applyFix('<% if (!(a && b)) { %>A<% } else { %>B<% } %>', rules)).toBe(
      '<% if (a && b) { %>B<% } else { %>A<% } %>',
    );
  });

  test('preserves markup, indentation and line structure of both branches', () => {
    const template = '<% if (!foo) { %>\n  A\n<% } else { %>\n  B\n<% } %>\n';
    expect(applyFix(template, rules)).toBe('<% if (foo) { %>\n  B\n<% } else { %>\n  A\n<% } %>\n');
  });

  test('preserves slurp delimiters', () => {
    const template = '<%_ if (!foo) { _%>\n  A\n<%_ } else { _%>\n  B\n<%_ } _%>\n';
    expect(applyFix(template, rules)).toBe('<%_ if (foo) { _%>\n  B\n<%_ } else { _%>\n  A\n<%_ } _%>\n');
  });

  test('swaps branch bodies that contain other tags', () => {
    const template = '<% if (!ok) { %>\n  <div><%= x %></div>\n<% } else { %>\n  <span><%- y %></span>\n<% } %>\n';
    expect(applyFix(template, rules)).toBe(
      '<% if (ok) { %>\n  <span><%- y %></span>\n<% } else { %>\n  <div><%= x %></div>\n<% } %>\n',
    );
  });

  test('matches the branches of a statement wrapping a nested conditional', () => {
    const template = '<% if (!a) { %>\n  <% if (b) { %>X<% } else { %>Y<% } %>\n<% } else { %>\n  Z\n<% } %>\n';
    expect(applyFix(template, rules)).toBe(
      '<% if (a) { %>\n  Z\n<% } else { %>\n  <% if (b) { %>X<% } else { %>Y<% } %>\n<% } %>\n',
    );
  });

  test('matches the branches of a statement wrapping a loop', () => {
    const template = '<% if (!a) { %>\n  <% items.forEach((i) => { %><%= i %><% }); %>\n<% } else { %>\n  Z\n<% } %>\n';
    expect(applyFix(template, rules)).toBe(
      '<% if (a) { %>\n  Z\n<% } else { %>\n  <% items.forEach((i) => { %><%= i %><% }); %>\n<% } %>\n',
    );
  });

  test('fixes sibling statements independently', () => {
    const template = '<% if (!a) { %>A<% } else { %>B<% } %>\n<% if (!c) { %>C<% } else { %>D<% } %>\n';
    expect(applyFix(template, rules)).toBe(
      '<% if (a) { %>B<% } else { %>A<% } %>\n<% if (c) { %>D<% } else { %>C<% } %>\n',
    );
  });

  test('leaves an else if chain untouched', () => {
    const template = '<% if (!foo) { %>A<% } else if (bar) { %>B<% } else { %>C<% } %>';
    expect(applyFix(template, rules)).toBe(template);
  });

  test('produces output that is stable and no longer reports', () => {
    const template = '<% if (!ok) { %>\n  <div><%= x %></div>\n<% } else { %>\n  <span><%- y %></span>\n<% } %>\n';
    const fixed = applyFix(template, rules);

    expect(applyFix(fixed, rules)).toBe(fixed);
    expect(lint(fixed, rules)).toHaveLength(0);
    expect(lint(fixed, {}).filter((msg) => msg.fatal)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Output ternaries
//
// The core rule reports a negated ternary inside an output tag as well as an if/else pair,
// and cannot fix either: its fixer would have to rewrite the EJS tag around the expression.
// This coverage moved here when the separate no-output-negated-ternary rule was removed.
// ---------------------------------------------------------------------------

describe('output ternaries', () => {
  test.each([
    ['an escaped output tag', '<%= !cond ? a : b %>', '<%= cond ? b : a %>'],
    ['a raw output tag', '<%- !cond ? a : b %>', '<%- cond ? b : a %>'],
    ['a parenthesised negation', '<%= !(a && b) ? x : y %>', '<%= a && b ? y : x %>'],
    ['a strict inequality', '<%= a !== b ? x : y %>', '<%= a === b ? y : x %>'],
    ['a loose inequality', '<%= a != b ? x : y %>', '<%= a == b ? y : x %>'],
    ['a trailing semicolon, which is preserved', '<%= !cond ? a : b; %>', '<%= cond ? b : a; %>'],
  ])('inverts %s', (_label, template, expected) => {
    expect(lint(template, rules)).toHaveLength(1);
    expect(applyFix(template, rules)).toBe(expected);
  });

  test('does not report a positive ternary', () => {
    expect(lint('<%= cond ? a : b %>', rules)).toHaveLength(0);
  });

  test('reports but does not fix a ternary in a code tag, which produces no output', () => {
    const template = '<% !cond ? a : b %>';
    expect(lint(template, rules)).toHaveLength(1);
    expect(applyFix(template, rules)).toBe(template);
  });

  test('produces output that is stable and no longer reports', () => {
    const fixed = applyFix('<%= !cond ? a : b %>', rules);

    expect(fixed).toBe('<%= cond ? b : a %>');
    expect(applyFix(fixed, rules)).toBe(fixed);
    expect(lint(fixed, rules)).toHaveLength(0);
  });
});
