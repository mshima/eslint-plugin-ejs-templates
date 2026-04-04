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
// Rule: prefer-raw
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/prefer-raw', () => {
  test('flags <%= %> tags', () => {
    const msgs = lint('<%= name %>', { 'ejs-templates/prefer-raw': 'error' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('ejs-templates/prefer-raw');
  });

  test('does not flag <%- %> tags', () => {
    const msgs = lint('<%- name %>', { 'ejs-templates/prefer-raw': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% %> code tags', () => {
    const msgs = lint('<% const x = 1; %>', { 'ejs-templates/prefer-raw': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('flags all <%= %> tags in a file', () => {
    const msgs = lint('<%= a %> text <%= b %>', { 'ejs-templates/prefer-raw': 'error' });
    expect(msgs).toHaveLength(2);
  });

  test('error is reported at the tag position', () => {
    // Tag is at line 2
    const msgs = lint('text\n<%= value %>', { 'ejs-templates/prefer-raw': 'error' });
    expect(msgs[0].line).toBe(2);
  });

  test('reports correct message', () => {
    const msgs = lint('<%= x %>', { 'ejs-templates/prefer-raw': 'error' });
    expect(msgs[0].message).toContain('<%-');
    expect(msgs[0].message).toContain('<%=');
  });
});

// ---------------------------------------------------------------------------
// Autofix: prefer-raw
// ---------------------------------------------------------------------------

describe('autofix: prefer-raw', () => {
  test('fixes <%= %> to <%- %>', () => {
    expect(applyFix('<%= name %>', { 'ejs-templates/prefer-raw': 'error' })).toBe('<%- name %>');
  });

  test('fixes all <%= %> tags in a file', () => {
    expect(applyFix('<%= a %> and <%= b %>', { 'ejs-templates/prefer-raw': 'error' })).toBe('<%- a %> and <%- b %>');
  });

  test('does not change <%- %> tags (already fixed)', () => {
    const input = '<%- name %>';
    expect(applyFix(input, { 'ejs-templates/prefer-raw': 'error' })).toBe(input);
  });

  test('does not change <% %> code tags', () => {
    const input = '<% const x = 1; %>';
    expect(applyFix(input, { 'ejs-templates/prefer-raw': 'error' })).toBe(input);
  });

  test('fixes a tag in the middle of surrounding text', () => {
    expect(applyFix('Hello, <%= name %>!', { 'ejs-templates/prefer-raw': 'error' })).toBe('Hello, <%- name %>!');
  });

  test('fixes a tag on a non-first line', () => {
    expect(applyFix('line1\n<%= value %>\nline3', { 'ejs-templates/prefer-raw': 'error' })).toBe(
      'line1\n<%- value %>\nline3',
    );
  });

  test('fix is idempotent (re-applying produces no further change)', () => {
    const fixed = applyFix('<%= x %>', { 'ejs-templates/prefer-raw': 'error' });
    expect(applyFix(fixed, { 'ejs-templates/prefer-raw': 'error' })).toBe(fixed);
  });
});
