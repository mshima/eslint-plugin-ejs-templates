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
// Rule: ejs-templates/format
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/format', () => {
  test('flags tag without spacing around content', () => {
    const msgs = lint('<%foo%>', { 'ejs-templates/format': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/format').length).toBeGreaterThan(0);
  });

  test('does not flag tag already spaced', () => {
    const msgs = lint('<% foo %>', { 'ejs-templates/format': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/format')).toHaveLength(0);
  });

  test("flags multiline close with default multilineClose='new-line'", () => {
    const input = '<%_\n  doWork(); _%>';
    const msgs = lint(input, { 'ejs-templates/format': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/format').length).toBeGreaterThan(0);
  });

  test("does not require multiline close newline when multilineClose='same-line'", () => {
    const input = '<%_ doWork(); _%>';
    const msgs = lint(input, { 'ejs-templates/format': ['error', { multilineClose: 'same-line' }] });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/format')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: ejs-templates/format
// ---------------------------------------------------------------------------

describe('autofix: format', () => {
  test('adds a single space around single-line content', () => {
    expect(applyFix('<%foo%>', { 'ejs-templates/format': 'error' })).toBe('<% foo %>');
  });

  test('formats slurp tag content by trimming outer whitespace', () => {
    expect(applyFix('<%_  doWork();   _%>', { 'ejs-templates/format': 'error' })).toBe('<%_ doWork(); _%>');
  });

  test("moves multiline close to a new line aligned with opening indent by default (multilineClose='new-line')", () => {
    const input = '  <%_\n  doWork(); _%>';
    expect(applyFix(input, { 'ejs-templates/format': 'error' })).toBe('  <%_ doWork(); _%>');
  });

  test("keeps close on same line when multilineClose='same-line'", () => {
    const input = '  <%_\n  doWork(); _%>';
    expect(applyFix(input, { 'ejs-templates/format': ['error', { multilineClose: 'same-line' }] })).toBe(
      '  <%_ doWork(); _%>',
    );
  });

  test('does not move close tag to new line when open tag is not slurp', () => {
    const input = '  <%\n  doWork(); %>';
    expect(applyFix(input, { 'ejs-templates/format': 'error' })).toBe('  <% doWork(); %>');
  });
});
