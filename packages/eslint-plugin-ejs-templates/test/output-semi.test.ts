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
// Rule: output-semi
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/output-semi', () => {
  // ── always ───────────────────────────────────────────────────────────────
  describe('always', () => {
    test('flags <%= %> without trailing semicolon', () => {
      const msgs = lint('<%= name %>', { 'ejs-templates/output-semi': ['error', 'always'] });
      expect(msgs).toHaveLength(1);
      expect(msgs[0].ruleId).toBe('ejs-templates/output-semi');
    });

    test('flags <%- %> without trailing semicolon', () => {
      const msgs = lint('<%- name %>', { 'ejs-templates/output-semi': ['error', 'always'] });
      expect(msgs).toHaveLength(1);
      expect(msgs[0].ruleId).toBe('ejs-templates/output-semi');
    });

    test('does not flag <%= %> that already has a semicolon', () => {
      const msgs = lint('<%= name; %>', { 'ejs-templates/output-semi': ['error', 'always'] });
      expect(msgs).toHaveLength(0);
    });

    test('does not flag <%- %> that already has a semicolon', () => {
      const msgs = lint('<%- name; %>', { 'ejs-templates/output-semi': ['error', 'always'] });
      expect(msgs).toHaveLength(0);
    });

    test('does not flag code tags', () => {
      const msgs = lint('<% const x = 1; %>', { 'ejs-templates/output-semi': ['error', 'always'] });
      expect(msgs).toHaveLength(0);
    });

    test('flags all output tags missing semicolons', () => {
      const msgs = lint('<%= a %> text <%- b %>', { 'ejs-templates/output-semi': ['error', 'always'] });
      expect(msgs).toHaveLength(2);
    });

    test('reports correct message', () => {
      const msgs = lint('<%= x %>', { 'ejs-templates/output-semi': ['error', 'always'] });
      expect(msgs[0].message).toContain('semicolon');
    });
  });

  // ── never ────────────────────────────────────────────────────────────────
  describe('never', () => {
    test('flags <%= %> with trailing semicolon', () => {
      const msgs = lint('<%= name; %>', { 'ejs-templates/output-semi': ['error', 'never'] });
      expect(msgs).toHaveLength(1);
      expect(msgs[0].ruleId).toBe('ejs-templates/output-semi');
    });

    test('flags <%- %> with trailing semicolon', () => {
      const msgs = lint('<%- name; %>', { 'ejs-templates/output-semi': ['error', 'never'] });
      expect(msgs).toHaveLength(1);
    });

    test('does not flag <%= %> without semicolon', () => {
      const msgs = lint('<%= name %>', { 'ejs-templates/output-semi': ['error', 'never'] });
      expect(msgs).toHaveLength(0);
    });

    test('does not flag <%- %> without semicolon', () => {
      const msgs = lint('<%- name %>', { 'ejs-templates/output-semi': ['error', 'never'] });
      expect(msgs).toHaveLength(0);
    });

    test('does not flag code tags', () => {
      const msgs = lint('<% const x = 1; %>', { 'ejs-templates/output-semi': ['error', 'never'] });
      expect(msgs).toHaveLength(0);
    });
  });

  // ── default (never) ─────────────────────────────────────────────────────
  describe('default option', () => {
    test('defaults to never and flags trailing semicolon', () => {
      const msgs = lint('<%= name; %>', { 'ejs-templates/output-semi': 'error' });
      expect(msgs).toHaveLength(1);
      expect(msgs[0].ruleId).toBe('ejs-templates/output-semi');
    });

    test('defaults to never and does not flag output tags without semicolon', () => {
      const msgs = lint('<%= name %>', { 'ejs-templates/output-semi': 'error' });
      expect(msgs).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Autofix: output-semi
// ---------------------------------------------------------------------------

describe('autofix: output-semi', () => {
  // ── always ────────────────────────────────────────────────────────────
  test('always: inserts semicolon into <%= %>', () => {
    expect(applyFix('<%= name %>', { 'ejs-templates/output-semi': ['error', 'always'] })).toBe('<%= name; %>');
  });

  test('always: inserts semicolon into <%- %>', () => {
    expect(applyFix('<%- name %>', { 'ejs-templates/output-semi': ['error', 'always'] })).toBe('<%- name; %>');
  });

  test('always: inserts semicolon into expression with no trailing space', () => {
    expect(applyFix('<%=name%>', { 'ejs-templates/output-semi': ['error', 'always'] })).toBe('<%=name;%>');
  });

  test('always: fixes all output tags in a file', () => {
    const result = applyFix('<%= a %> text <%- b %>', { 'ejs-templates/output-semi': ['error', 'always'] });
    expect(result).toBe('<%= a; %> text <%- b; %>');
  });

  test('always: does not modify tags that already have a semicolon', () => {
    const src = '<%= name; %>';
    expect(applyFix(src, { 'ejs-templates/output-semi': ['error', 'always'] })).toBe(src);
  });

  // ── never ───────────────────────────────────────────────────────────────
  test('never: removes semicolon from <%= %>', () => {
    expect(applyFix('<%= name; %>', { 'ejs-templates/output-semi': ['error', 'never'] })).toBe('<%= name %>');
  });

  test('never: removes semicolon from <%- %>', () => {
    expect(applyFix('<%- name; %>', { 'ejs-templates/output-semi': ['error', 'never'] })).toBe('<%- name %>');
  });

  test('never: fixes all output tags in a file', () => {
    const result = applyFix('<%= a; %> text <%- b; %>', { 'ejs-templates/output-semi': ['error', 'never'] });
    expect(result).toBe('<%= a %> text <%- b %>');
  });

  test('never: does not modify tags without semicolons', () => {
    const src = '<%= name %>';
    expect(applyFix(src, { 'ejs-templates/output-semi': ['error', 'never'] })).toBe(src);
  });

  test('default: removes semicolon from <%= %> (same as never)', () => {
    expect(applyFix('<%= name; %>', { 'ejs-templates/output-semi': 'error' })).toBe('<%= name %>');
  });
});

// ---------------------------------------------------------------------------
// Multiline output tags
//
// These were skipped entirely: the tag-type guard rejected the `-multiline` variants, and the
// check looked for a doubled `;;` on the first virtual line — the tag's semicolon plus the
// synthetic one the processor appends — which a multiline tag never has, since no synthetic
// semicolon is added for those and the semicolon is not on the first line.
// ---------------------------------------------------------------------------

type RuleConfigMap = Parameters<typeof lint>[1];

describe('rule: ejs-templates/output-semi (multiline tags)', () => {
  const never: RuleConfigMap = { 'ejs-templates/output-semi': ['error', 'never'] };
  const always: RuleConfigMap = { 'ejs-templates/output-semi': ['error', 'always'] };

  test.each([
    ['escaped', '<%=\n  foo;\n%>', '<%=\n  foo\n%>'],
    ['raw', '<%-\n  foo;\n%>', '<%-\n  foo\n%>'],
    ['a trailing member access', '<%= foo\n  .bar; %>', '<%= foo\n  .bar %>'],
    ['a multiline ternary', "<%= cond\n  ? 'a'\n  : 'b'; %>", "<%= cond\n  ? 'a'\n  : 'b' %>"],
  ])('never: removes the semicolon from %s multiline output', (_label, template, expected) => {
    expect(lint(template, never)).toHaveLength(1);
    expect(applyFix(template, never)).toBe(expected);
  });

  test.each([
    ['escaped', '<%=\n  foo\n%>', '<%=\n  foo;\n%>'],
    ['raw', '<%-\n  foo\n%>', '<%-\n  foo;\n%>'],
  ])('always: adds the semicolon to %s multiline output', (_label, template, expected) => {
    expect(lint(template, always)).toHaveLength(1);
    expect(applyFix(template, always)).toBe(expected);
  });

  test.each([
    ['never on multiline without a semicolon', '<%=\n  foo\n%>', never],
    ['always on multiline with a semicolon', '<%=\n  foo;\n%>', always],
  ])('reports nothing for %s', (_label, template, rules) => {
    expect(lint(template, rules)).toHaveLength(0);
    expect(applyFix(template, rules)).toBe(template);
  });

  test('leaves a multiline code tag alone', () => {
    const template = '<%\n  foo;\n%>';
    expect(lint(template, never)).toHaveLength(0);
    expect(applyFix(template, never)).toBe(template);
  });
});
