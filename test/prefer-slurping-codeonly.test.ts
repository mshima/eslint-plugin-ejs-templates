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
// Rule: prefer-slurping-codeonly
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/prefer-slurping-codeonly', () => {
  test('flags <% %> tags with balanced braces', () => {
    const msgs = lint('<% const x = 1; %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('ejs-templates/prefer-slurping-codeonly');
  });

  test('does not flag <%_ _%> tags (already slurping)', () => {
    const msgs = lint('<%_ const x = 1; _%>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% if (x) { %><% } %> (trailing open brace)', () => {
    const msgs = lint('<% if (x) { %><% } %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% if (x) { %><% } else { %><% } %> (both braces)', () => {
    const msgs = lint('<% if (x) { %><% } else { %><% } %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <%= %> output tags', () => {
    const msgs = lint('<%= val %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <%- %> raw-output tags', () => {
    const msgs = lint('<%- val %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% code -%> trim-newline tags', () => {
    const msgs = lint('<% doWork(); -%>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('flags inline balanced-brace tag with inline object literal', () => {
    const msgs = lint('<% const obj = { a: 1 }; %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs).toHaveLength(1);
  });

  test('reports correct message', () => {
    const msgs = lint('<% doWork(); %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs[0].message).toContain('<%_');
  });
});

// ---------------------------------------------------------------------------
// Autofix: prefer-slurping-codeonly
// ---------------------------------------------------------------------------

describe('autofix: prefer-slurping-codeonly', () => {
  test('fixes <% code %> to <%_ code _%>', () => {
    expect(applyFix('<% doWork(); %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' })).toBe(
      '<%_ doWork(); _%>',
    );
  });

  test('fixes a slurpable tag with inline object literal', () => {
    expect(applyFix('<% const x = { a: 1 }; %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' })).toBe(
      '<%_ const x = { a: 1 }; _%>',
    );
  });

  test('does not change <%_ _%> tags (already slurping)', () => {
    const input = '<%_ code _%>';
    expect(applyFix(input, { 'ejs-templates/prefer-slurping-codeonly': 'error' })).toBe(input);
  });

  test('does not change <% if (x) { %> (trailing open brace)', () => {
    const input = '<% if (x) { %>';
    expect(applyFix(input, { 'ejs-templates/prefer-slurping-codeonly': 'error' })).toBe(input);
  });

  test('does not change <% } %> (leading close brace)', () => {
    const input = '<% } %>';
    expect(applyFix(input, { 'ejs-templates/prefer-slurping-codeonly': 'error' })).toBe(input);
  });

  test('preserves surrounding text when fixing', () => {
    expect(applyFix('before\n<% doWork(); %>\nafter', { 'ejs-templates/prefer-slurping-codeonly': 'error' })).toBe(
      'before\n<%_ doWork(); _%>\nafter',
    );
  });

  test('fix is idempotent (re-applying produces no further change)', () => {
    const fixed = applyFix('<% doWork(); %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(applyFix(fixed, { 'ejs-templates/prefer-slurping-codeonly': 'error' })).toBe(fixed);
  });
});
