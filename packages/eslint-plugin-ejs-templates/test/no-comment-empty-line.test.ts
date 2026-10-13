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
// Rule: no-comment-empty-line
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-comment-empty-line', () => {
  test('flags standalone <%# %> comment closed with %>', () => {
    const msgs = lint('<%# comment %>', { 'ejs-templates/no-comment-empty-line': 'error' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('ejs-templates/no-comment-empty-line');
  });

  test('does not flag standalone <%# -%> comment', () => {
    const msgs = lint('<%# comment -%>', { 'ejs-templates/no-comment-empty-line': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag inline <%# %> comment', () => {
    const msgs = lint('before <%# comment %> after', { 'ejs-templates/no-comment-empty-line': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('flags each standalone <%# %> comment in file', () => {
    const input = '<%# one %>\n<%# two %>\n<%# ok -%>';
    const msgs = lint(input, { 'ejs-templates/no-comment-empty-line': 'error' });
    expect(msgs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Autofix: no-comment-empty-line
// ---------------------------------------------------------------------------

describe('autofix: no-comment-empty-line', () => {
  test('fixes standalone <%# %> to <%# -%>', () => {
    expect(applyFix('<%# comment %>', { 'ejs-templates/no-comment-empty-line': 'error' })).toBe('<%# comment -%>');
  });

  test('fixes multiple standalone comments in file', () => {
    expect(applyFix('<%# one %>\n<%# two %>', { 'ejs-templates/no-comment-empty-line': 'error' })).toBe(
      '<%# one -%>\n<%# two -%>',
    );
  });

  test('does not change inline comments', () => {
    const input = 'before <%# comment %> after';
    expect(applyFix(input, { 'ejs-templates/no-comment-empty-line': 'error' })).toBe(input);
  });

  test('fix is idempotent (re-applying produces no further change)', () => {
    const fixed = applyFix('<%# x %>', { 'ejs-templates/no-comment-empty-line': 'error' });
    expect(applyFix(fixed, { 'ejs-templates/no-comment-empty-line': 'error' })).toBe(fixed);
  });
});
