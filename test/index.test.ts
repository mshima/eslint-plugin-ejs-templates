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
import * as fixture4 from './fixtures/4.js';
import * as fixture5 from './fixtures/5.js';

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

  test('virtual code line 2 is the function wrapper open', () => {
    const blocks = extractTagBlocks('<% const x = 1; %>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[1]).toBe('(function() {');
  });

  test('virtual code contains the tag JS content inside the function wrapper', () => {
    const blocks = extractTagBlocks('<% const x = 1; %>');
    const lines = blocks[0].virtualCode.split('\n');
    // Line 3 (index 2) is the first (and only) code line; line 4 is always `})()`
    expect(lines[2]).toBe(' const x = 1; ');
    expect(lines[3]).toBe('})()');
  });

  test('virtual code last line is the function wrapper close', () => {
    // For multiline content the wrapper close is always on its own last line.
    const blocks = extractTagBlocks('<%_ const x = 1;\nconst y = 2; _%>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[lines.length - 1]).toBe('})()');
  });

  test('multiline tag with complete content gets -multiline suffix and code is wrapped in function', () => {
    // Multiline content → tag type gets `-multiline` suffix; body included in wrapper.
    const blocks = extractTagBlocks('<%_ const x = 1;\nconst y = 2; _%>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[0]).toBe('//@ejs-tag:slurp-multiline');
    expect(lines[1]).toBe('(function() {');
    // First code line is at index 2 (no synthetic prefix for balanced content)
    expect(lines[2]).toBe(' const x = 1;');
    expect(lines[3]).toBe('const y = 2; ');
    expect(lines[lines.length - 1]).toBe('})()');
  });

  test('structural slurp tag (unbalanced braces) includes code body inside function wrapper', () => {
    // `if (x) {` has unbalanced braces; a synthetic `}` is added to balance,
    // and the whole thing is wrapped in a function so ESLint can parse it.
    const blocks = extractTagBlocks('<%_ if (x) { _%>');
    expect(blocks[0].virtualCode).toContain('if (x) {');
    expect(blocks[0].virtualCode).toContain('(function() {');
    expect(blocks[0].tagType).toBe('slurp');
    // syntheticSuffix closes the `{`
    expect(blocks[0].syntheticSuffix).toBe('}\n');
    expect(blocks[0].syntheticPrefix).toBe('');
  });

  test('code tag with closing brace includes body with synthetic opening prefix', () => {
    // `<% } %>` needs a synthetic opening brace to balance the closing brace.
    const blocks = extractTagBlocks('<% } %>');
    expect(blocks[0].virtualCode).toContain('if (true) {');
    expect(blocks[0].syntheticPrefix).toBe('if (true) {\n');
    expect(blocks[0].syntheticPrefixLineCount).toBe(1);
    expect(blocks[0].syntheticSuffix).toBe('');
  });

  test('code tag (plain <% %> with opening brace) includes body with synthetic closing suffix', () => {
    // `<% if (x) { %>` ends with `{` → synthetic `}` suffix is added.
    const blocks = extractTagBlocks('<% if (x) { %>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[0]).toBe('//@ejs-tag:code');
    expect(blocks[0].virtualCode).toContain('if (x) {');
    expect(blocks[0].syntheticSuffix).toBe('}\n');
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
    const undefMsg = msgs.find((m) => m.message.includes("'undefinedVar'"));
    expect(undefMsg).toBeDefined();
    expect(undefMsg!.line).toBe(2);
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

  test('plugin exposes all config', () => {
    expect(Array.isArray(plugin.configs.all)).toBe(true);
    expect(plugin.configs.all.length).toBeGreaterThan(0);
  });

  test('all config targets *.ejs files', () => {
    const config = plugin.configs.all[0];
    expect(config.files).toEqual(['**/*.ejs']);
  });

  test('all config enables all four rules as error', () => {
    const config = plugin.configs.all[0];
    expect(config.rules?.['templates/prefer-raw']).toBe('error');
    expect(config.rules?.['templates/prefer-slurping']).toBe('error');
    expect(config.rules?.['templates/no-multiline-tags']).toBe('error');
    expect(config.rules?.['templates/ejs-indent']).toBe('error');
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

  test('no-undef detects undefined variable inside structural tag (function wrapper enables body linting)', () => {
    // Previously the body was omitted for structural tags; now it is always
    // included and wrapped in a function so ESLint can lint it.
    const msgs = lint('<% if (undefinedVar) { %>', { 'no-undef': 'error' });
    const undefMsg = msgs.find((m) => m.message.includes("'undefinedVar'"));
    expect(undefMsg).toBeDefined();
  });

  test('no-undef detects undefined variable inside closing-brace tag', () => {
    // `<% } else if (undefinedVar) { %>` — the synthetic `if (true) {` prefix
    // makes the content parseable; `undefinedVar` should still be flagged.
    const msgs = lint('<% } else if (undefinedCond) { %>', { 'no-undef': 'error' });
    const undefMsg = msgs.find((m) => m.message.includes("'undefinedCond'"));
    expect(undefMsg).toBeDefined();
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
// Autofix: general JS rules via processor
// ---------------------------------------------------------------------------

describe('autofix: general JS rules via processor', () => {
  test('no-var fix is mapped back to the correct position in the EJS source', () => {
    // `no-var` converts `var` declarations to `const`/`let`.
    const result = applyFix('<% var x = 1; %>', { 'no-var': 'error' });
    // The fix must operate inside the EJS tag, not corrupt the delimiters.
    expect(result).toMatch(/^<%[\s_]*\s*(const|let)\s+x\s*=\s*1\s*;/);
    expect(result).not.toContain('var');
  });

  test('no-var fix does not corrupt EJS delimiters', () => {
    const result = applyFix('<% var x = 1; %>', { 'no-var': 'error' });
    expect(result.startsWith('<%')).toBe(true);
    expect(result.endsWith('%>')).toBe(true);
  });

  test('no-var fix works on a tag in the middle of surrounding text', () => {
    const result = applyFix('before\n<% var x = 1; %>\nafter', { 'no-var': 'error' });
    expect(result).not.toContain('var');
    expect(result).toContain('before\n');
    expect(result).toContain('\nafter');
  });

  test('standard JS fix and plugin fix can both fire in the same pass', () => {
    // no-var should fire on `var` in a code-slurpable block.
    // prefer-slurping should also fire on the same block.
    // verifyAndFix iterates until stable – both fixes must be applied.
    const result = applyFix('<% var x = 1; %>', { 'no-var': 'error', 'templates/prefer-slurping': 'error' });
    expect(result).not.toContain('var');
    expect(result.startsWith('<%_')).toBe(true);
    expect(result.endsWith('_%>')).toBe(true);
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

// ---------------------------------------------------------------------------
// Tree-sitter: tag-type classification (via extractTagBlocks)
// ---------------------------------------------------------------------------

describe('extractTagBlocks (tree-sitter parser)', () => {
  test('single-line <%= %> gets escaped-output type', () => {
    const [b] = extractTagBlocks('<%= name %>');
    expect(b.tagType).toBe('escaped-output');
    expect(b.openDelim).toBe('<%=');
    expect(b.closeDelim).toBe('%>');
  });

  test('single-line <%- %> gets raw-output type', () => {
    const [b] = extractTagBlocks('<%- name %>');
    expect(b.tagType).toBe('raw-output');
  });

  test('structural <% if (x) { %> gets code type', () => {
    const [b] = extractTagBlocks('<% if (x) { %>');
    expect(b.tagType).toBe('code');
  });

  test('balanced <% code %> gets code-slurpable type', () => {
    const [b] = extractTagBlocks('<% doWork(); %>');
    expect(b.tagType).toBe('code-slurpable');
  });

  test('single-line <%_ _%> gets slurp type', () => {
    const [b] = extractTagBlocks('<%_ if (x) { _%>');
    expect(b.tagType).toBe('slurp');
  });

  test('multiline <%_ _%> gets slurp-multiline type', () => {
    const [b] = extractTagBlocks('<%_\n  if (x) {\n_%>');
    expect(b.tagType).toBe('slurp-multiline');
  });

  test('multiline <%= %> gets escaped-output-multiline type', () => {
    const [b] = extractTagBlocks('<%=\n  value\n%>');
    expect(b.tagType).toBe('escaped-output-multiline');
  });

  test('multiline <% %> code tag gets code-multiline type', () => {
    const [b] = extractTagBlocks('<%\n  if (x) {\n%>');
    expect(b.tagType).toBe('code-multiline');
  });

  test('stores openDelim and closeDelim', () => {
    const [b] = extractTagBlocks('<%_ code _%>');
    expect(b.openDelim).toBe('<%_');
    expect(b.closeDelim).toBe('_%>');
  });

  test('stores codeContent (with surrounding spaces)', () => {
    const [b] = extractTagBlocks('<%= name %>');
    expect(b.codeContent).toBe(' name ');
  });

  test('standalone tag has lineIndent equal to whitespace before it', () => {
    const [b] = extractTagBlocks('  <%_ if (x) { _%>');
    expect(b.lineIndent).toBe('  ');
    expect(b.tagColumn).toBe(2);
  });

  test('inline tag has empty lineIndent', () => {
    const [b] = extractTagBlocks('Hello <%- name %>!');
    expect(b.lineIndent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Tree-sitter: brace-depth / expectedIndent
// ---------------------------------------------------------------------------

describe('brace-depth tracking (ejsIndent foundation)', () => {
  test('block at depth 0 has expectedIndent = ""', () => {
    const [open] = extractTagBlocks('<%_ if (x) { _%>');
    expect(open.expectedIndent).toBe('');
  });

  test('block inside depth-1 gets expectedIndent = "  "', () => {
    const [, inner] = extractTagBlocks('<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>');
    expect(inner.expectedIndent).toBe('  ');
  });

  test('closing block at depth 0 after open (lowerBraceDepth = 0)', () => {
    const [, , close] = extractTagBlocks('<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>');
    expect(close.expectedIndent).toBe('');
  });

  test('nested depth produces 4-space expectedIndent', () => {
    const blocks = extractTagBlocks('<%_ if (a) { _%>\n<%_ if (b) { _%>\n<%_ doWork(); _%>\n<%_ } _%>\n<%_ } _%>');
    expect(blocks[2].expectedIndent).toBe('    '); // depth 2
  });

  test('non-standalone slurp tag has expectedIndent = lineIndent (not changed)', () => {
    const [b] = extractTagBlocks('Hello <%_ name _%>');
    expect(b.expectedIndent).toBe(b.lineIndent);
  });
});

// ---------------------------------------------------------------------------
// Rule: no-multiline-tags – violations
// ---------------------------------------------------------------------------

describe('rule: templates/no-multiline-tags', () => {
  test('flags a multiline <%_ _%> tag', () => {
    const msgs = lint('<%_\nif (x) {\n_%>', { 'templates/no-multiline-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'templates/no-multiline-tags').length).toBeGreaterThan(0);
  });

  test('flags a multiline <%= %> output tag', () => {
    const msgs = lint('<%=\n  value\n%>', { 'templates/no-multiline-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'templates/no-multiline-tags').length).toBeGreaterThan(0);
  });

  test('does not flag a single-line tag', () => {
    const msgs = lint('<%_ if (x) { _%>', { 'templates/no-multiline-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'templates/no-multiline-tags')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: no-multiline-tags
// ---------------------------------------------------------------------------

describe('autofix: no-multiline-tags', () => {
  test('collapses single-non-empty-line multiline tag (problem-statement example)', () => {
    expect(applyFix('<%_\nif (generateSpringAuditor) {\n_%>', { 'templates/no-multiline-tags': 'error' })).toBe(
      '<%_ if (generateSpringAuditor) { _%>',
    );
  });

  test('splits multiline tag with 2 content lines into two single-line tags', () => {
    expect(applyFix('<%_\n  const x = 1;\n  const y = 2;\n_%>', { 'templates/no-multiline-tags': 'error' })).toBe(
      '<%_ const x = 1; _%>\n<%_ const y = 2; _%>',
    );
  });

  test('ignores blank-only lines inside the tag', () => {
    // blank-only lines are stripped; remaining single line keeps original delimiters
    expect(applyFix('<%\n\n  doSomething();\n\n%>', { 'templates/no-multiline-tags': 'error' })).toBe(
      '<% doSomething(); %>',
    );
  });

  test('collapses multiline <%= %> output tag (keeps delimiter unchanged)', () => {
    // no-multiline-tags only collapses; prefer-raw is a separate rule
    expect(applyFix('<%=\n  value\n%>', { 'templates/no-multiline-tags': 'error' })).toBe('<%= value %>');
  });

  test('collapses multiline <%- %> raw-output tag', () => {
    expect(applyFix('<%-\n  value\n%>', { 'templates/no-multiline-tags': 'error' })).toBe('<%- value %>');
  });

  test('preserves surrounding text', () => {
    expect(applyFix('before\n<%_\n  code;\n_%>\nafter', { 'templates/no-multiline-tags': 'error' })).toBe(
      'before\n<%_ code; _%>\nafter',
    );
  });

  test('splits multi-line tag into separate tags per logical phrase, preserving indentation', () => {
    expect(applyFix('  <%_\n  const a = 1;\n  const b = 2;\n  _%>', { 'templates/no-multiline-tags': 'error' })).toBe(
      '  <%_ const a = 1; _%>\n  <%_ const b = 2; _%>',
    );
  });

  test('fix is idempotent', () => {
    const fixed = applyFix('<%_\n  code;\n_%>', { 'templates/no-multiline-tags': 'error' });
    expect(applyFix(fixed, { 'templates/no-multiline-tags': 'error' })).toBe(fixed);
  });

  test('no-multiline-tags does not change already-single-line tags', () => {
    const input = '<%_ code; _%>';
    expect(applyFix(input, { 'templates/no-multiline-tags': 'error' })).toBe(input);
  });

  test('combined with prefer-raw: multiline <%= %> is both collapsed and converted', () => {
    const result = applyFix('<%=\n  value\n%>', {
      'templates/no-multiline-tags': 'error',
      'templates/prefer-raw': 'error',
    });
    expect(result).toBe('<%- value %>');
  });

  test('joins chained method call across lines (problem-statement example)', () => {
    const input = "<%_\n  const arr = 'foo.bar'\n    .split();\n_%>";
    expect(applyFix(input, { 'templates/no-multiline-tags': 'error' })).toBe("<%_ const arr = 'foo.bar'.split(); _%>");
  });

  test('handles multiple phrases where some lines have dot-continuation', () => {
    // Two independent statements, the second using a chained call.
    const input = "<%_\n  const x = 1;\n  const arr = 'a.b'\n    .split();\n_%>";
    expect(applyFix(input, { 'templates/no-multiline-tags': 'error' })).toBe(
      "<%_ const x = 1; _%>\n<%_ const arr = 'a.b'.split(); _%>",
    );
  });
});

// ---------------------------------------------------------------------------
// Rule: ejs-indent – violations
// ---------------------------------------------------------------------------

describe('rule: templates/ejs-indent', () => {
  test('flags a standalone <%_ _%> tag with wrong indentation', () => {
    const input = '<%_ if (x) { _%>\n    <%_ doWork(); _%>\n<%_ } _%>';
    const msgs = lint(input, { 'templates/ejs-indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'templates/ejs-indent').length).toBeGreaterThan(0);
  });

  test('does not flag tags with correct brace-depth indentation', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>';
    const msgs = lint(input, { 'templates/ejs-indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'templates/ejs-indent')).toHaveLength(0);
  });

  test('does not flag inline (non-standalone) tags', () => {
    const msgs = lint('Hello <%_ name _%>!', { 'templates/ejs-indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'templates/ejs-indent')).toHaveLength(0);
  });

  test('does not flag non-slurp tags', () => {
    const msgs = lint('<% if (x) { %>\n    <% doWork(); %>\n<% } %>', { 'templates/ejs-indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'templates/ejs-indent')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: ejs-indent
// ---------------------------------------------------------------------------

describe('autofix: ejs-indent', () => {
  test('strips over-indentation from a depth-1 tag', () => {
    const input = '<%_ if (x) { _%>\n    <%_ doWork(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'templates/ejs-indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('adds indentation to an under-indented depth-1 tag', () => {
    const input = '<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'templates/ejs-indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('correctly indents closing tag (depth goes back to 0)', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n  <%_ } _%>';
    expect(applyFix(input, { 'templates/ejs-indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('handles two-level nesting', () => {
    const input = '<%_ if (a) { _%>\n<%_ if (b) { _%>\n<%_ doWork(); _%>\n<%_ } _%>\n<%_ } _%>';
    expect(applyFix(input, { 'templates/ejs-indent': 'error' })).toBe(
      '<%_ if (a) { _%>\n  <%_ if (b) { _%>\n    <%_ doWork(); _%>\n  <%_ } _%>\n<%_ } _%>',
    );
  });

  test('fix is idempotent', () => {
    const input = '<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>';
    const first = applyFix(input, { 'templates/ejs-indent': 'error' });
    const second = applyFix(first, { 'templates/ejs-indent': 'error' });
    expect(second).toBe(first);
  });

  test('does not move inline tags', () => {
    const input = 'Hello <%_ name _%>!';
    expect(applyFix(input, { 'templates/ejs-indent': 'error' })).toBe(input);
  });

  test('brace depth tracks <% %> structural tags too', () => {
    // A structural `<% if (x) { %>` (code type) increments brace depth,
    // so the following <%_ %>  slurp tag should be indented.
    const input = '<% if (x) { %>\n<%_ doWork(); _%>\n<% } %>';
    expect(applyFix(input, { 'templates/ejs-indent': 'error' })).toBe('<% if (x) { %>\n  <%_ doWork(); _%>\n<% } %>');
  });
});

// ---------------------------------------------------------------------------
// Fixture tests – formatting (no-multiline-tags + ejs-indent)
// ---------------------------------------------------------------------------

describe('formatting fixture tests', () => {
  test('fixture 4 (no-multiline-tags + prefer-raw) autofix produces expected output', () => {
    const fixed = applyFix(fixture4.input, fixture4.rules);
    expect(fixed).toBe(fixture4.expected);
  });

  test('fixture 4 expected is already fixed (idempotent)', () => {
    const fixed = applyFix(fixture4.expected, fixture4.rules);
    expect(fixed).toBe(fixture4.expected);
  });

  test('fixture 5 (ejs-indent) autofix produces expected output', () => {
    const fixed = applyFix(fixture5.input, fixture5.rules);
    expect(fixed).toBe(fixture5.expected);
  });

  test('fixture 5 expected is already fixed (idempotent)', () => {
    const fixed = applyFix(fixture5.expected, fixture5.rules);
    expect(fixed).toBe(fixture5.expected);
  });
});
