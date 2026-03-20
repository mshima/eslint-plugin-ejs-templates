// Copyright 2024 The prettier-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { Linter } from 'eslint';
import plugin from '../src/index.js';
import { extractTagBlocks, canConvertToSlurping } from '../src/processor.js';
import * as fixture1 from './fixtures/1.js';
import * as fixture2 from './fixtures/2.js';
import * as fixture3 from './fixtures/3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a Linter pre-configured with the templates plugin and EJS processor. */
function makeLinter(): Linter {
  return new Linter({ configType: 'flat' });
}

/** The flat config used for all EJS linting in tests. */
function makeConfig(
  rules: Record<string, Linter.RuleSeverityAndOptions | Linter.RuleSeverity> = {},
): Linter.FlatConfig[] {
  return [
    {
      files: ['**/*.ejs'],
      plugins: { templates: plugin },
      processor: 'templates/ejs',
      rules,
    },
  ];
}

/** Lint an EJS string and return all messages. */
function lint(
  ejsText: string,
  rules: Record<string, Linter.RuleSeverityAndOptions | Linter.RuleSeverity> = {},
): Linter.LintMessage[] {
  return makeLinter().verify(ejsText, makeConfig(rules), { filename: 'template.ejs' });
}

/**
 * Apply ESLint autofix to an EJS string and return the fixed text.
 * Uses `Linter.verifyAndFix` which iterates until no further fixes are possible.
 */
function applyFix(
  ejsText: string,
  rules: Record<string, Linter.RuleSeverityAndOptions | Linter.RuleSeverity> = {},
): string {
  return makeLinter().verifyAndFix(ejsText, makeConfig(rules), { filename: 'template.ejs' }).output;
}

// ---------------------------------------------------------------------------
// canConvertToSlurping
// ---------------------------------------------------------------------------

describe('canConvertToSlurping', () => {
  test('balanced braces with no leading } or trailing { → true', () => {
    expect(canConvertToSlurping(' const x = 1; ')).toBe(true);
    expect(canConvertToSlurping(' const obj = { a: 1 }; ')).toBe(true);
    expect(canConvertToSlurping(' doWork(); ')).toBe(true);
  });

  test('unbalanced braces → false', () => {
    expect(canConvertToSlurping(' if (foo) { ')).toBe(false); // trailing {
    expect(canConvertToSlurping(' } ')).toBe(false); // leading }
    expect(canConvertToSlurping(' } else { ')).toBe(false); // both
  });

  test('leading } → false even when braces are otherwise balanced', () => {
    expect(canConvertToSlurping(' } else { x(); } ')).toBe(false);
  });

  test('trailing { → false even when braces are otherwise balanced', () => {
    expect(canConvertToSlurping(' if (a) { ')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractTagBlocks
// ---------------------------------------------------------------------------

describe('extractTagBlocks', () => {
  test('skips comment tags (<%# %>)', () => {
    const blocks = extractTagBlocks('<%# this is a comment %>');
    expect(blocks).toHaveLength(0);
  });

  test('extracts a single escaped-output tag (<%= %>)', () => {
    const blocks = extractTagBlocks('<%= name %>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:escaped-output\n/);
    expect(blocks[0].virtualCode).toContain(' name ');
  });

  test('extracts a raw-output tag (<%- %>)', () => {
    const blocks = extractTagBlocks('<%- name %>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:raw-output\n/);
  });

  test('extracts a slurping tag (<%_ … _%>)', () => {
    const blocks = extractTagBlocks('<%_ code _%>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:slurp\n/);
  });

  test('tags with slurping close (_%>) get type slurp', () => {
    const blocks = extractTagBlocks('<% code _%>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:slurp\n/);
  });

  test('plain code tag with balanced braces → code-slurpable', () => {
    const blocks = extractTagBlocks('<% const x = 1; %>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:code-slurpable\n/);
  });

  test('plain code tag with unbalanced braces → code', () => {
    const blocks = extractTagBlocks('<% if (x) { %>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:code\n/);
  });

  test('multiple tags are all extracted', () => {
    const blocks = extractTagBlocks('<% a %> text <%= b %> <%- c %>');
    expect(blocks).toHaveLength(3);
  });

  test('tracks tag position: tagLine and tagColumn', () => {
    // "<%= name %>" starts at line 1, col 0
    const blocks = extractTagBlocks('<%= name %>');
    expect(blocks[0].tagLine).toBe(1);
    expect(blocks[0].tagColumn).toBe(0);
  });

  test('tracks code-content position: originalLine and originalColumn', () => {
    // code starts after "<%=" (3 chars) so col = 3
    const blocks = extractTagBlocks('<%= name %>');
    expect(blocks[0].originalLine).toBe(1);
    expect(blocks[0].originalColumn).toBe(3); // right after '<%='
  });

  test('multi-line file: positions are on the correct line', () => {
    const text = 'line1\n<%= value %>\nline3';
    const blocks = extractTagBlocks(text);
    expect(blocks[0].tagLine).toBe(2);
    expect(blocks[0].originalLine).toBe(2);
  });

  test('tag in the middle of a line: column is correct', () => {
    const text = 'Hello, <%= name %>!';
    const blocks = extractTagBlocks(text);
    // "Hello, " = 7 chars, then "<%=" starts at col 7
    expect(blocks[0].tagColumn).toBe(7);
    // code starts after '<%=' at col 10
    expect(blocks[0].originalColumn).toBe(10);
  });

  test('tag with trim-newline close (-%>) is tagged as code', () => {
    const blocks = extractTagBlocks('<% code -%>');
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:code\n/);
  });
});

// ---------------------------------------------------------------------------
// Processor: virtual code structure
// ---------------------------------------------------------------------------

describe('processor virtual code', () => {
  test('virtual code line 1 is the type comment', () => {
    const blocks = extractTagBlocks('<%= name %>');
    const [line1] = blocks[0].virtualCode.split('\n');
    expect(line1).toBe('//@ejs-tag:escaped-output');
  });

  test('virtual code lines 2+ contain the tag JS content', () => {
    const blocks = extractTagBlocks('<% const x = 1; %>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines.slice(1).join('\n')).toBe(' const x = 1; ');
  });

  test('multiline tag with complete content preserves newlines in virtual code', () => {
    // Content with balanced braces → body is included in virtual code.
    const blocks = extractTagBlocks('<%_ const x = 1;\nconst y = 2; _%>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[0]).toBe('//@ejs-tag:slurp');
    expect(lines[1]).toBe(' const x = 1;');
    expect(lines[2]).toBe('const y = 2; ');
  });

  test('structural slurp tag (unbalanced braces) omits code body to prevent parse errors', () => {
    // `if (x) {` is unbalanced → body must be omitted so ESLint can parse the virtual code.
    const blocks = extractTagBlocks('<%_ if (x) { _%>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[0]).toBe('//@ejs-tag:slurp');
    // Body omitted – only the marker comment is present.
    expect(lines.slice(1).join('\n').trim()).toBe('');
  });

  test('code tag (unbalanced plain <% %>) omits code body to prevent parse errors', () => {
    // `<% if (x) { %>` is classified as `code` (not `code-slurpable`) because the
    // content ends with `{`.  Its body must be omitted to avoid ESLint parse errors.
    const blocks = extractTagBlocks('<% if (x) { %>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[0]).toBe('//@ejs-tag:code');
    expect(lines.slice(1).join('\n').trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Processor: position mapping via ESLint Linter
// ---------------------------------------------------------------------------

describe('processor position mapping', () => {
  test('error in single-line tag maps to correct line', () => {
    // Line 2 has the EJS tag; the undefined var is inside it.
    const msgs = lint('line1\n<% undefinedVar; %>\nline3', { 'no-undef': 'error' });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].line).toBe(2);
  });

  test('error column accounts for opening delimiter length', () => {
    // Code starts right after '<%=' (3 chars), so the mapped column is
    // virtual_column + 3.  See mapMessage() in processor.ts for details.
    const msgs = lint('<%= undefinedVar %>', { 'no-undef': 'error' });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].line).toBe(1);
    // Column is within the tag on line 1 (≥ 3 because code starts after '<%=')
    expect(msgs[0].column).toBeGreaterThanOrEqual(3);
  });

  test('error in second line of multiline tag maps to correct line', () => {
    // The tag starts on file line 1 (`<%_`), the code with the error is on
    // file line 2 (` undefinedVar;`), and the closing delimiter is on line 3 (`_%>`).
    // The mapped error must report file line 2.
    const ejsText = '<%_\n undefinedVar;\n_%>';
    const msgs = lint(ejsText, { 'no-undef': 'error' });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].line).toBe(2);
  });

  test('no messages when there are no EJS tags', () => {
    const msgs = lint('Just plain HTML with no tags.', { 'no-undef': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('comment tags produce no virtual blocks (no lint errors)', () => {
    const msgs = lint('<%# this is a comment %>', { 'no-undef': 'error' });
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rule: prefer-raw
// ---------------------------------------------------------------------------

describe('rule: templates/prefer-raw', () => {
  test('flags <%= %> tags', () => {
    const msgs = lint('<%= name %>', { 'templates/prefer-raw': 'error' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('templates/prefer-raw');
  });

  test('does not flag <%- %> tags', () => {
    const msgs = lint('<%- name %>', { 'templates/prefer-raw': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% %> code tags', () => {
    const msgs = lint('<% const x = 1; %>', { 'templates/prefer-raw': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('flags all <%= %> tags in a file', () => {
    const msgs = lint('<%= a %> text <%= b %>', { 'templates/prefer-raw': 'error' });
    expect(msgs).toHaveLength(2);
  });

  test('error is reported at the tag position', () => {
    // Tag is at line 2
    const msgs = lint('text\n<%= value %>', { 'templates/prefer-raw': 'error' });
    expect(msgs[0].line).toBe(2);
  });

  test('reports correct message', () => {
    const msgs = lint('<%= x %>', { 'templates/prefer-raw': 'error' });
    expect(msgs[0].message).toContain('<%-');
    expect(msgs[0].message).toContain('<%=');
  });
});

// ---------------------------------------------------------------------------
// Rule: prefer-slurping
// ---------------------------------------------------------------------------

describe('rule: templates/prefer-slurping', () => {
  test('flags <% %> tags with balanced braces', () => {
    const msgs = lint('<% const x = 1; %>', { 'templates/prefer-slurping': 'error' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('templates/prefer-slurping');
  });

  test('does not flag <%_ _%> tags (already slurping)', () => {
    const msgs = lint('<%_ const x = 1; _%>', { 'templates/prefer-slurping': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% if (x) { %> (trailing open brace)', () => {
    const msgs = lint('<% if (x) { %>', { 'templates/prefer-slurping': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% } %> (leading close brace)', () => {
    const msgs = lint('<% } %>', { 'templates/prefer-slurping': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% } else { %> (both braces)', () => {
    const msgs = lint('<% } else { %>', { 'templates/prefer-slurping': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <%= %> output tags', () => {
    const msgs = lint('<%= val %>', { 'templates/prefer-slurping': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <%- %> raw-output tags', () => {
    const msgs = lint('<%- val %>', { 'templates/prefer-slurping': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% code -%> trim-newline tags', () => {
    const msgs = lint('<% doWork(); -%>', { 'templates/prefer-slurping': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('flags inline balanced-brace tag with inline object literal', () => {
    const msgs = lint('<% const obj = { a: 1 }; %>', { 'templates/prefer-slurping': 'error' });
    expect(msgs).toHaveLength(1);
  });

  test('reports correct message', () => {
    const msgs = lint('<% doWork(); %>', { 'templates/prefer-slurping': 'error' });
    expect(msgs[0].message).toContain('<%_');
  });
});

// ---------------------------------------------------------------------------
// Plugin shape
// ---------------------------------------------------------------------------

describe('plugin shape', () => {
  test('plugin has meta', () => {
    expect(plugin.meta.name).toBe('eslint-plugin-templates');
  });

  test('plugin exposes ejs processor', () => {
    expect(plugin.processors.ejs).toBeDefined();
    expect(typeof plugin.processors.ejs.preprocess).toBe('function');
    expect(typeof plugin.processors.ejs.postprocess).toBe('function');
  });

  test('plugin exposes prefer-raw rule', () => {
    expect(plugin.rules['prefer-raw']).toBeDefined();
  });

  test('plugin exposes prefer-slurping rule', () => {
    expect(plugin.rules['prefer-slurping']).toBeDefined();
  });

  test('plugin exposes recommended config', () => {
    expect(Array.isArray(plugin.configs.recommended)).toBe(true);
    expect(plugin.configs.recommended.length).toBeGreaterThan(0);
  });

  test('recommended config targets *.ejs files', () => {
    const config = plugin.configs.recommended[0];
    expect(config.files).toEqual(['**/*.ejs']);
  });
});

// ---------------------------------------------------------------------------
// Standard JS rules via processor (integration)
// ---------------------------------------------------------------------------

describe('standard JS rules via processor', () => {
  test('no-undef detects undefined variable in EJS code tag', () => {
    const msgs = lint('<% undefinedVar; %>', { 'no-undef': 'error' });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].message).toContain('undefinedVar');
  });

  test('no-undef is silent when variable is defined within same tag', () => {
    const msgs = lint('<% const x = 1; x; %>', { 'no-undef': 'error' });
    // 'x' is defined in the same block so no undef error
    expect(msgs.filter((m) => m.message.includes("'x'"))).toHaveLength(0);
  });

  test('eqeqeq detects == in EJS output tag', () => {
    const msgs = lint('<% if (a == b) {} %>', { eqeqeq: 'error', 'no-undef': 'off' });
    expect(msgs.filter((m) => m.ruleId === 'eqeqeq').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: prefer-raw
// ---------------------------------------------------------------------------

describe('autofix: prefer-raw', () => {
  test('fixes <%= %> to <%- %>', () => {
    expect(applyFix('<%= name %>', { 'templates/prefer-raw': 'error' })).toBe('<%- name %>');
  });

  test('fixes all <%= %> tags in a file', () => {
    expect(applyFix('<%= a %> and <%= b %>', { 'templates/prefer-raw': 'error' })).toBe('<%- a %> and <%- b %>');
  });

  test('does not change <%- %> tags (already fixed)', () => {
    const input = '<%- name %>';
    expect(applyFix(input, { 'templates/prefer-raw': 'error' })).toBe(input);
  });

  test('does not change <% %> code tags', () => {
    const input = '<% const x = 1; %>';
    expect(applyFix(input, { 'templates/prefer-raw': 'error' })).toBe(input);
  });

  test('fixes a tag in the middle of surrounding text', () => {
    expect(applyFix('Hello, <%= name %>!', { 'templates/prefer-raw': 'error' })).toBe('Hello, <%- name %>!');
  });

  test('fixes a tag on a non-first line', () => {
    expect(applyFix('line1\n<%= value %>\nline3', { 'templates/prefer-raw': 'error' })).toBe(
      'line1\n<%- value %>\nline3',
    );
  });

  test('fix is idempotent (re-applying produces no further change)', () => {
    const fixed = applyFix('<%= x %>', { 'templates/prefer-raw': 'error' });
    expect(applyFix(fixed, { 'templates/prefer-raw': 'error' })).toBe(fixed);
  });
});

// ---------------------------------------------------------------------------
// Autofix: prefer-slurping
// ---------------------------------------------------------------------------

describe('autofix: prefer-slurping', () => {
  test('fixes <% code %> to <%_ code _%>', () => {
    expect(applyFix('<% doWork(); %>', { 'templates/prefer-slurping': 'error' })).toBe('<%_ doWork(); _%>');
  });

  test('fixes a slurpable tag with inline object literal', () => {
    expect(applyFix('<% const x = { a: 1 }; %>', { 'templates/prefer-slurping': 'error' })).toBe(
      '<%_ const x = { a: 1 }; _%>',
    );
  });

  test('does not change <%_ _%> tags (already slurping)', () => {
    const input = '<%_ code _%>';
    expect(applyFix(input, { 'templates/prefer-slurping': 'error' })).toBe(input);
  });

  test('does not change <% if (x) { %> (trailing open brace)', () => {
    const input = '<% if (x) { %>';
    expect(applyFix(input, { 'templates/prefer-slurping': 'error' })).toBe(input);
  });

  test('does not change <% } %> (leading close brace)', () => {
    const input = '<% } %>';
    expect(applyFix(input, { 'templates/prefer-slurping': 'error' })).toBe(input);
  });

  test('preserves surrounding text when fixing', () => {
    expect(applyFix('before\n<% doWork(); %>\nafter', { 'templates/prefer-slurping': 'error' })).toBe(
      'before\n<%_ doWork(); _%>\nafter',
    );
  });

  test('fix is idempotent (re-applying produces no further change)', () => {
    const fixed = applyFix('<% doWork(); %>', { 'templates/prefer-slurping': 'error' });
    expect(applyFix(fixed, { 'templates/prefer-slurping': 'error' })).toBe(fixed);
  });
});

// ---------------------------------------------------------------------------
// Autofix: both rules together
// ---------------------------------------------------------------------------

describe('autofix: prefer-raw and prefer-slurping together', () => {
  test('fixes both types of violations in a single pass', () => {
    const input = '<%= a %>\n<% doWork(); %>';
    const fixed = applyFix(input, { 'templates/prefer-raw': 'error', 'templates/prefer-slurping': 'error' });
    expect(fixed).toBe('<%- a %>\n<%_ doWork(); _%>');
  });
});

// ---------------------------------------------------------------------------
// Fixture tests
// ---------------------------------------------------------------------------

describe('fixture tests', () => {
  test('fixture 1 (real-world EJS) produces no violations with both rules enabled', () => {
    const msgs = lint(fixture1.input, {
      'templates/prefer-raw': 'error',
      'templates/prefer-slurping': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('fixture 2 (real-world EJS) produces no violations with both rules enabled', () => {
    const msgs = lint(fixture2.input, {
      'templates/prefer-raw': 'error',
      'templates/prefer-slurping': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('fixture 2 is already in expected form (input === expected)', () => {
    expect(fixture2.input).toBe(fixture2.expected);
  });

  test('fixture 3 input has violations (needs prefer-raw and prefer-slurping fixes)', () => {
    const msgs = lint(fixture3.input, {
      'templates/prefer-raw': 'error',
      'templates/prefer-slurping': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'templates/prefer-raw').length).toBeGreaterThan(0);
    expect(msgs.filter((m) => m.ruleId === 'templates/prefer-slurping').length).toBeGreaterThan(0);
  });

  test('fixture 3 autofix produces the expected output', () => {
    const fixed = applyFix(fixture3.input, {
      'templates/prefer-raw': 'error',
      'templates/prefer-slurping': 'error',
    });
    expect(fixed).toBe(fixture3.expected);
  });
});
