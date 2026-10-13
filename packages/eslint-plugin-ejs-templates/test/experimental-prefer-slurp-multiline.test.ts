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
// Rule: experimental-prefer-slurp-multiline
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/experimental-prefer-slurp-multiline', () => {
  test('flags a multiline <% %> code tag', () => {
    const msgs = lint('<%\n  if (x) {\n%>\n<% } %>', { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/experimental-prefer-slurp-multiline').length).toBeGreaterThan(
      0,
    );
  });

  test('flags a multiline code-slurpable tag', () => {
    const msgs = lint('<%\n  doWork();\n%>', { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/experimental-prefer-slurp-multiline').length).toBeGreaterThan(
      0,
    );
  });

  test('does not flag single-line <% %> tag', () => {
    const msgs = lint('<% doWork(); %>', { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag multiline <%_ _%> tag (already slurping)', () => {
    const msgs = lint('<%_\n  if (x) {\n_%><% } %>', { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('reports parse error for multiline <%_ _%> tag with missing close brace', () => {
    const msgs = lint('<%_\n  if (x) {\n_%>', { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].message).toContain('Missing token');
  });

  test('does not report return parse error when wrapper fallback applies', () => {
    const msgs = lint('<% return 1; %>', { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' });
    const parseErrors = msgs.filter((msg) => msg.ruleId === null && msg.message.includes('Parsing error'));
    expect(parseErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: experimental-prefer-slurp-multiline
// ---------------------------------------------------------------------------

describe('autofix: experimental-prefer-slurp-multiline', () => {
  test('converts multiline <% %> to <%_ _%> (content trimmed before fix)', () => {
    expect(
      applyFix('<%\n  if (x) {\n%>\n<% } %>', { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' }),
    ).toBe('<%_ if (x) { _%>\n<% } %>');
  });

  test('does not change multiline <%_ _%> (already slurping)', () => {
    const input = '<%_\n  if (x) {\n_%>';
    expect(applyFix(input, { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' })).toBe(input);
  });

  test('experimental-prefer-slurp-multiline then prefer-single-line-tags collapses correctly', () => {
    const result = applyFix('<%\n  if (x) {\n%>\n<% } %>', {
      'ejs-templates/experimental-prefer-slurp-multiline': 'error',
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(result).toBe('<%_ if (x) { _%>\n<% } %>');
  });
});
