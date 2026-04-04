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
// Rule: ejs-templates/slurp-newline
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/slurp-newline', () => {
  test('flags an inline <%_ _%> tag (not standalone)', () => {
    const msgs = lint('text<%_ doWork(); _%>', { 'ejs-templates/slurp-newline': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/slurp-newline').length).toBeGreaterThan(0);
  });

  test('does not flag a standalone <%_ _%> tag', () => {
    const msgs = lint('<%_ doWork(); _%>', { 'ejs-templates/slurp-newline': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag a standalone indented <%_ _%> tag', () => {
    const msgs = lint('  <%_ doWork(); _%>', { 'ejs-templates/slurp-newline': 'error' });
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: slurp-newline
// ---------------------------------------------------------------------------

describe('autofix: slurp-newline', () => {
  test('inserts newline before inline slurp tag', () => {
    expect(applyFix('text<%_ doWork(); _%>', { 'ejs-templates/slurp-newline': 'error' })).toBe(
      'text\n<%_ doWork(); _%>',
    );
  });

  test('does not change standalone slurp tag', () => {
    const input = '<%_ doWork(); _%>';
    expect(applyFix(input, { 'ejs-templates/slurp-newline': 'error' })).toBe(input);
  });
});
