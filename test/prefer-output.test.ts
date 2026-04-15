// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { applyFix, lint } from './helpers.js';

// ---------------------------------------------------------------------------
// Rule: prefer-output
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/prefer-output', () => {
  test('flags if statement with empty block body', () => {
    const msgs = lint('<% if (foo) { %>content<% } %>', { 'ejs-templates/prefer-output': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(1);
  });

  test('reports message about ternary conversion', () => {
    const msgs = lint('<% if (foo) { %>content<% } %>', { 'ejs-templates/prefer-output': 'error' });
    const preferOutputMsgs = msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output');
    expect(preferOutputMsgs[0].message).toContain('ternary');
  });

  test('flags multiple if statements with empty blocks', () => {
    const msgs = lint(
      `
    <% if (foo) { %>a<% } %>
    <% if (bar) { %>b<% } %>
    `,
      { 'ejs-templates/prefer-output': 'error' },
    );
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(2);
  });

  test('does not flag if statements with body statements', () => {
    const msgs = lint('<% if (foo) { const x = 1; } %>', {
      'ejs-templates/prefer-output': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(0);
  });

  test('does not flag if statements with method calls', () => {
    const msgs = lint('<% if (foo) { bar(); } %>', { 'ejs-templates/prefer-output': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(0);
  });

  test('does not flag if statements with else clause', () => {
    const msgs = lint('<% if (foo) { } else { } %>', { 'ejs-templates/prefer-output': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(0);
  });

  test('does not flag if statements without braces (arrow or expression)', () => {
    const msgs = lint('<% if (foo) bar(); %>', { 'ejs-templates/prefer-output': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(0);
  });

  test('does not flag whitespace-only inline if body (code-slurpable)', () => {
    const msgs = lint('<% if (foo) {  } %>', { 'ejs-templates/prefer-output': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(0);
  });

  test('detects pattern with output content between tags', () => {
    // This is the typical use case:
    // <% if (foo) { %>content<% } %>
    // Which should be converted to:
    // <%- foo ? 'content' : '' %>
    const msgs = lint('<% if (condition) { %>content<% } %>', { 'ejs-templates/prefer-output': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(1);
    expect(msgs[0].message).toContain('condition');
  });

  test('does not flag for loops with empty body (common pattern)', () => {
    // Note: This would be flagged as a code tag, not an if statement
    const msgs = lint('<% for (let i = 0; i < 10; i++) { } %>', {
      'ejs-templates/prefer-output': 'error',
    });
    // ForStatement should not be flagged (only IfStatement is checked)
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(0);
  });

  test('does not flag while loops with empty body', () => {
    const msgs = lint('<% while (condition) { %>x<% } %>', { 'ejs-templates/prefer-output': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(0);
  });

  test('flags nested if with empty body', () => {
    const msgs = lint(
      `
    <% if (outer) { %>
      <% if (inner) { %>
      <% } %>
    <% } %>
    `,
      { 'ejs-templates/prefer-output': 'error' },
    );
    const results = msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test('message includes example transformation', () => {
    const msgs = lint('<% if (value) { %>x<% } %>', { 'ejs-templates/prefer-output': 'error' });
    const preferOutputMsgs = msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output');
    expect(preferOutputMsgs[0].message).toContain('<%=');
  });
});

// ---------------------------------------------------------------------------
// Code tags (should not have autofix, only suggestions)
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/prefer-output (in code tags)', () => {
  test('does not flag code-slurpable inline if tag', () => {
    const msgs = lint('<% if (show) { } %>', { 'ejs-templates/prefer-output': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output')).toHaveLength(0);
  });

  test('no autofix for code-slurpable inline if tag', () => {
    const msgs = lint('<% if (condition) { } %>', { 'ejs-templates/prefer-output': 'error' });
    const preferOutputMsgs = msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-output');
    expect(preferOutputMsgs).toHaveLength(0);
  });

  test('autofix converts if-wrapper pattern to output ternary', () => {
    const fixed = applyFix('<% if (show) { %>content<% } %>', { 'ejs-templates/prefer-output': 'error' });
    expect(fixed).toBe("<%= (show) ? 'content' : '' %>");
  });

  test('does not apply autofix when wrapped content spans multiple lines', () => {
    const fixed = applyFix("<% if (show) { %>a\n'b'<% } %>", { 'ejs-templates/prefer-output': 'error' });
    expect(fixed).toBe("<% if (show) { %>a\n'b'<% } %>");
  });

  test('autofix converts if/else wrapper pattern to output ternary', () => {
    const fixed = applyFix('<% if (show) { %>yes<% } else { %>no<% } %>', {
      'ejs-templates/prefer-output': 'error',
    });
    expect(fixed).toBe("<%= (show) ? 'yes' : 'no' %>");
  });

  test('does not apply to multiline if/else wrapper content', () => {
    const fixed = applyFix('<% if (show) { %>a\n<% } else { %>b\n<% } %>', {
      'ejs-templates/prefer-output': 'error',
    });
    expect(fixed).toBe('<% if (show) { %>a\n<% } else { %>b\n<% } %>');
  });

  test('does not apply to multiline if wrapper content', () => {
    const fixed = applyFix('<% if (show) { %>a\n<% } %>', {
      'ejs-templates/prefer-output': 'error',
    });
    expect(fixed).toBe('<% if (show) { %>a\n<% } %>');
  });
});
