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
