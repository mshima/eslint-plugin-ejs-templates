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
// Rule: prefer-encoded
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/prefer-encoded', () => {
  test('flags <%- %> tags', () => {
    const msgs = lint('<%- name %>', { 'ejs-templates/prefer-encoded': 'error' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('ejs-templates/prefer-encoded');
  });

  test('does not flag <%= %> tags', () => {
    const msgs = lint('<%= name %>', { 'ejs-templates/prefer-encoded': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% %> code tags', () => {
    const msgs = lint('<% const x = 1; %>', { 'ejs-templates/prefer-encoded': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('flags all <%- %> tags in a file', () => {
    const msgs = lint('<%- a %> text <%- b %>', { 'ejs-templates/prefer-encoded': 'error' });
    expect(msgs).toHaveLength(2);
  });

  test('reports correct message', () => {
    const msgs = lint('<%- x %>', { 'ejs-templates/prefer-encoded': 'error' });
    expect(msgs[0].message).toContain('<%=');
    expect(msgs[0].message).toContain('<%-');
  });
});

// ---------------------------------------------------------------------------
// Autofix: prefer-encoded
// ---------------------------------------------------------------------------

describe('autofix: prefer-encoded', () => {
  test('fixes <%- %> to <%= %>', () => {
    expect(applyFix('<%- name %>', { 'ejs-templates/prefer-encoded': 'error' })).toBe('<%= name %>');
  });

  test('fixes all <%- %> tags in a file', () => {
    expect(applyFix('<%- a %> and <%- b %>', { 'ejs-templates/prefer-encoded': 'error' })).toBe(
      '<%= a %> and <%= b %>',
    );
  });

  test('does not change <%= %> tags (already fixed)', () => {
    const input = '<%= name %>';
    expect(applyFix(input, { 'ejs-templates/prefer-encoded': 'error' })).toBe(input);
  });

  test('fix is idempotent (re-applying produces no further change)', () => {
    const fixed = applyFix('<%- x %>', { 'ejs-templates/prefer-encoded': 'error' });
    expect(applyFix(fixed, { 'ejs-templates/prefer-encoded': 'error' })).toBe(fixed);
  });
});
