// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import plugin from '../src/index.js';
import { extractTagBlocks, canConvertToSlurping } from '../src/processor.js';
import * as fixture1 from './fixtures/1.js';
import * as fixture2 from './fixtures/2.js';
import * as fixture3 from './fixtures/3.js';
import * as fixture4 from './fixtures/4.js';
import * as fixture5 from './fixtures/5.js';
import { lint, applyFix } from './helpers.js';

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

  test('virtual code line 2 is the tag code (no per-tag function wrapper)', () => {
    const blocks = extractTagBlocks('<% const x = 1; %>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[1]).toBe(' const x = 1; ');
  });

  test('virtual code contains tag JS content directly after marker', () => {
    const blocks = extractTagBlocks('<% const x = 1; %>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[1]).toBe(' const x = 1; ');
    expect(lines).not.toContain('})()');
  });

  test('virtual code has no per-tag wrapper close', () => {
    const blocks = extractTagBlocks('<%_ const x = 1;\nconst y = 2; _%>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[lines.length - 1]).not.toBe('})()');
  });

  test('multiline tag gets -multiline suffix and code is wrapped in function', () => {
    const blocks = extractTagBlocks('<%_ const x = 1;\nconst y = 2; _%>');
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[0]).toBe('//@ejs-tag:slurp-multiline');
    expect(lines[1]).toBe(' const x = 1;');
    expect(lines[lines.length - 1]).toBe('const y = 2; ');
  });

  test('output tag virtual code wraps content in void()', () => {
    // Single-line output tags are wrapped as `void (...);` to prevent no-unused-vars.
    const blocks = extractTagBlocks('<%= name %>');
    expect(blocks[0].virtualCode).toContain('name ;');
    expect(blocks[0].virtualBodyPrefix).toBe('');
    expect(blocks[0].virtualBodyPrefixLen).toBe(0);
    expect(blocks[0].virtualBodyInlineSuffix).toBe(';');
  });

  test('raw output tag virtual code wraps content in void()', () => {
    const blocks = extractTagBlocks('<%- name %>');
    expect(blocks[0].virtualCode).toContain('name ;');
  });

  test('code tag ending with { gets void 0 appended', () => {
    const blocks = extractTagBlocks('<%_ if (x) { _%>');
    expect(blocks[0].virtualCode).toContain('void 0;');
    expect(blocks[0].virtualBodyExtraLine).toBe('\nvoid 0;');
  });

  test('code tag NOT ending with { does not get void 0', () => {
    const blocks = extractTagBlocks('<%_ doWork(); _%>');
    expect(blocks[0].virtualCode).not.toContain('void 0;');
  });

  test('structural slurp tag keeps code body in virtual block', () => {
    const blocks = extractTagBlocks('<%_ if (x) { _%>');
    expect(blocks[0].virtualCode).toContain('if (x) {');
    expect(blocks[0].tagType).toBe('slurp');
  });

  test('preprocess outputs one incremental virtual block with all tags in order', () => {
    const parts = plugin.processors.ejs.preprocess?.('<% const x = 1; %>\n<%= x %>', 'template.ejs');
    expect(parts).toBeDefined();
    if (!parts) {
      throw new Error('Expected ejs.preprocess to be defined');
    }

    expect(parts).toHaveLength(1);

    const virtual = parts[0];
    expect(typeof virtual).toBe('string');
    if (typeof virtual !== 'string') {
      throw new Error('Expected preprocess to return a string virtual block');
    }

    expect(virtual.startsWith('(function() {\n')).toBe(true);
    expect(virtual.endsWith('\n})();')).toBe(true);
    expect(virtual).toContain('//@ejs-tag:code-slurpable');
    expect(virtual).toContain('//@ejs-tag:escaped-output');
    expect(virtual.indexOf('//@ejs-tag:code-slurpable')).toBeLessThan(virtual.indexOf('//@ejs-tag:escaped-output'));
  });
});

describe('processor virtual code link', () => {
  test('no no-var errors for muntiple tags virtual code', () => {
    // Line 2 has the EJS tag; the undefined var is inside it.
    const msgs = lint('line1\n<% const x = 1; const y = 2; %>\nline3\n<%- x %>\n<%= x %>', {
      'no-var': 'error',
    });
    expect(msgs).toHaveLength(0);
  });
  test('no no-var errors for muntiple tags virtual code and braces', () => {
    // Line 2 has the EJS tag; the undefined var is inside it.
    const msgs = lint('line1\n<% [1, 2, 3].forEach(x => { %>\nline3\n<%- x %>\n<% }) %>', {
      'no-var': 'error',
    });
    expect(msgs).toHaveLength(0);
  });
  test('no no-empty errors for muntiple tags virtual code', () => {
    // Line 2 has the EJS tag; the undefined var is inside it.
    const msgs = lint('line1\n<% if (true) { %>\nline3\n<% } %>', { 'no-empty': 'error' });
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Processor: position mapping via ESLint Linter
// ---------------------------------------------------------------------------

describe('processor position mapping', () => {
  test('error in single-line tag maps to correct line', () => {
    // Line 2 has the EJS tag; a `var` declaration inside it should be reported.
    const msgs = lint('line1\n<% var value = 1; %>\nline3', { 'no-var': 'error' });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].line).toBe(2);
  });

  test('error column accounts for opening delimiter length', () => {
    // Code starts right after '<%_' (3 chars), so the mapped column is
    // virtual_column + 3. See mapMessage() in processor.ts for details.
    const msgs = lint('<%_ var value = 1; _%>', { 'no-var': 'error' });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].line).toBe(1);
    // Column is within the tag on line 1 (>= 3 because code starts after '<%_')
    expect(msgs[0].column).toBeGreaterThanOrEqual(3);
  });

  test('error in second line of multiline tag maps to correct line', () => {
    // The tag starts on file line 1 (`<%_`), the code with the error is on
    // file line 2 (` var value = 1;`), and the closing delimiter is on line 3 (`_%>`).
    // The mapped error must report file line 2.
    const ejsText = '<%_\n var value = 1;\n_%>';
    const msgs = lint(ejsText, { 'no-var': 'error' });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].line).toBe(2);
  });

  test('no messages when there are no EJS tags', () => {
    const msgs = lint('Just plain HTML with no tags.', { 'no-var': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('comment tags produce no virtual blocks (no lint errors)', () => {
    const msgs = lint('<%# this is a comment %>', { 'no-var': 'error' });
    expect(msgs).toHaveLength(0);
  });
});

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
// Rule: prefer-slurping
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

  test('does not flag <% if (x) { %> (trailing open brace)', () => {
    const msgs = lint('<% if (x) { %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% } %> (leading close brace)', () => {
    const msgs = lint('<% } %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag <% } else { %> (both braces)', () => {
    const msgs = lint('<% } else { %>', { 'ejs-templates/prefer-slurping-codeonly': 'error' });
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
// Plugin shape
// ---------------------------------------------------------------------------

describe('plugin shape', () => {
  test('plugin has meta', () => {
    expect(plugin.meta.name).toBe('eslint-plugin-ejs-templates');
  });

  test('plugin exposes ejs processor', () => {
    expect(plugin.processors.ejs).toBeDefined();
    expect(typeof plugin.processors.ejs.preprocess).toBe('function');
    expect(typeof plugin.processors.ejs.postprocess).toBe('function');
  });

  test('plugin exposes prefer-raw rule', () => {
    expect(plugin.rules['prefer-raw']).toBeDefined();
  });

  test('plugin exposes prefer-slurping-codeonly rule', () => {
    expect(plugin.rules['prefer-slurping-codeonly']).toBeDefined();
  });

  test('plugin exposes base config', () => {
    expect(Array.isArray(plugin.configs.base)).toBe(true);
    expect(plugin.configs.base.length).toBeGreaterThan(0);
  });

  test('base config targets *.ejs files', () => {
    const config = plugin.configs.base[0];
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

  test('all config enables all rules as error', () => {
    const config = plugin.configs.all[0];
    expect(config.rules?.['ejs-templates/prefer-raw']).toBe('error');
    expect(config.rules?.['ejs-templates/prefer-slurping-codeonly']).toBe('error');
    expect(config.rules?.['ejs-templates/experimental-prefer-slurp-multiline']).toBe('error');
    expect(config.rules?.['ejs-templates/prefer-single-line-tags']).toBe('error');
    expect(config.rules?.['ejs-templates/slurp-newline']).toBe('error');
    expect(config.rules?.['ejs-templates/indent']).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Standard JS rules via processor (integration)
// ---------------------------------------------------------------------------

describe('standard JS rules via processor', () => {
  test('no-var detects var declaration in EJS code tag', () => {
    const msgs = lint('<% var value = 1; %>', { 'no-var': 'error' });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].message).toContain('Unexpected var');
  });

  test('no-var is silent when using const in same tag', () => {
    const msgs = lint('<% const x = 1; x; %>', { 'no-var': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('eqeqeq detects == in EJS output tag', () => {
    const msgs = lint('<% if (a == b) {} %>', { eqeqeq: 'error' });
    expect(msgs.filter((m) => m.ruleId === 'eqeqeq').length).toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------
// Autofix: prefer-slurping
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

// ---------------------------------------------------------------------------
// Autofix: both rules together
// ---------------------------------------------------------------------------

describe('autofix: prefer-raw and prefer-slurping-codeonly together', () => {
  test('fixes both types of violations in a single pass', () => {
    const input = '<%= a %>\n<% doWork(); %>';
    const fixed = applyFix(input, {
      'ejs-templates/prefer-raw': 'error',
      'ejs-templates/prefer-slurping-codeonly': 'error',
    });
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
    const result = applyFix('<% var x = 1; %>', {
      'no-var': 'error',
      'ejs-templates/prefer-slurping-codeonly': 'error',
    });
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
      'ejs-templates/prefer-raw': 'error',
      'ejs-templates/prefer-slurping-codeonly': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('fixture 2 (real-world EJS) produces no violations with both rules enabled', () => {
    const msgs = lint(fixture2.input, {
      'ejs-templates/prefer-raw': 'error',
      'ejs-templates/prefer-slurping-codeonly': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('fixture 2 is already in expected form (input === expected)', () => {
    expect(fixture2.input).toBe(fixture2.expected);
  });

  test('fixture 3 input has violations (needs prefer-raw and prefer-slurping fixes)', () => {
    const msgs = lint(fixture3.input, {
      'ejs-templates/prefer-raw': 'error',
      'ejs-templates/prefer-slurping-codeonly': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-raw').length).toBeGreaterThan(0);
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-slurping-codeonly').length).toBeGreaterThan(0);
  });

  test('fixture 3 autofix produces the expected output', () => {
    const fixed = applyFix(fixture3.input, {
      'ejs-templates/prefer-raw': 'error',
      'ejs-templates/prefer-slurping-codeonly': 'error',
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

  test('inline slurp tag gets slurp-not-standalone type', () => {
    const [b] = extractTagBlocks('text<%_ doWork(); _%>');
    expect(b.tagType).toBe('slurp-not-standalone');
    expect(b.isStandalone).toBe(false);
  });

  test('standalone slurp tag gets slurp type (not slurp-not-standalone)', () => {
    const [b] = extractTagBlocks('<%_ doWork(); _%>');
    expect(b.tagType).toBe('slurp');
    expect(b.isStandalone).toBe(true);
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

describe('brace-depth tracking (indent foundation)', () => {
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
// Rule: prefer-single-line-tags – violations
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/prefer-single-line-tags', () => {
  test('flags a multiline <%_ _%> tag', () => {
    const msgs = lint('<%_\nif (x) {\n_%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBeGreaterThan(0);
  });

  test('flags a multiline <%= %> output tag', () => {
    const msgs = lint('<%=\n  value\n%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBeGreaterThan(0);
  });

  test('does not flag a single-line tag', () => {
    const msgs = lint('<%_ if (x) { _%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: prefer-single-line-tags
// ---------------------------------------------------------------------------

describe('autofix: prefer-single-line-tags', () => {
  test('collapses single-non-empty-line multiline tag (problem-statement example)', () => {
    expect(
      applyFix('<%_\nif (generateSpringAuditor) {\n_%>', { 'ejs-templates/prefer-single-line-tags': 'error' }),
    ).toBe('<%_ if (generateSpringAuditor) { _%>');
  });

  test('splits multiline tag with 2 content lines into two single-line tags', () => {
    expect(
      applyFix('<%_\n  const x = 1;\n  const y = 2;\n_%>', { 'ejs-templates/prefer-single-line-tags': 'error' }),
    ).toBe('<%_ const x = 1; _%>\n<%_ const y = 2; _%>');
  });

  test('ignores blank-only lines inside the tag', () => {
    // blank-only lines are stripped; remaining single line keeps original delimiters
    expect(applyFix('<%\n\n  doSomething();\n\n%>', { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(
      '<% doSomething(); %>',
    );
  });

  test('collapses multiline <%= %> output tag (keeps delimiter unchanged)', () => {
    // prefer-single-line-tags only collapses; prefer-raw is a separate rule
    expect(applyFix('<%=\n  value\n%>', { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe('<%= value %>');
  });

  test('collapses multiline <%- %> raw-output tag', () => {
    expect(applyFix('<%-\n  value\n%>', { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe('<%- value %>');
  });

  test('preserves surrounding text', () => {
    expect(applyFix('before\n<%_\n  code;\n_%>\nafter', { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(
      'before\n<%_ code; _%>\nafter',
    );
  });

  test('splits multi-line tag into separate tags per logical phrase, preserving indentation', () => {
    expect(
      applyFix('  <%_\n  const a = 1;\n  const b = 2;\n  _%>', {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe('  <%_ const a = 1; _%>\n  <%_ const b = 2; _%>');
  });

  test('fix is idempotent', () => {
    const fixed = applyFix('<%_\n  code;\n_%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
    expect(applyFix(fixed, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(fixed);
  });

  test('prefer-single-line-tags does not change already-single-line tags', () => {
    const input = '<%_ code; _%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('combined with prefer-raw: multiline <%= %> is both collapsed and converted', () => {
    const result = applyFix('<%=\n  value\n%>', {
      'ejs-templates/prefer-single-line-tags': 'error',
      'ejs-templates/prefer-raw': 'error',
    });
    expect(result).toBe('<%- value %>');
  });

  test('joins chained method call across lines (problem-statement example)', () => {
    const input = "<%_\n  const arr = 'foo.bar'\n    .split();\n_%>";
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(
      "<%_ const arr = 'foo.bar'.split(); _%>",
    );
  });

  test('handles multiple phrases where some lines have dot-continuation', () => {
    // Two independent statements, the second using a chained call.
    const input = "<%_\n  const x = 1;\n  const arr = 'a.b'\n    .split();\n_%>";
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(
      "<%_ const x = 1; _%>\n<%_ const arr = 'a.b'.split(); _%>",
    );
  });

  test('splits content with brace boundaries (if/body/close each get own tag)', () => {
    const input = '<%_\n  if (x) {\n  doWork();\n  }\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(
      '<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('non-slurp code tag with braces uses slurp delimiters for open tags', () => {
    const input = '<%\n  if (x) {\n  doWork();\n  }\n%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(
      '<% if (x) { _%>\n<%_ doWork(); _%>\n<%_ } %>',
    );
  });
});

// ---------------------------------------------------------------------------
// Rule: ejs-indent – violations
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/indent', () => {
  test('flags a standalone <%_ _%> tag with wrong indentation', () => {
    const input = '<%_ if (x) { _%>\n    <%_ doWork(); _%>\n<%_ } _%>';
    const msgs = lint(input, { 'ejs-templates/indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent').length).toBeGreaterThan(0);
  });

  test('does not flag tags with correct brace-depth indentation', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>';
    const msgs = lint(input, { 'ejs-templates/indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent')).toHaveLength(0);
  });

  test('does not flag inline (non-standalone) tags', () => {
    const msgs = lint('Hello <%_ name _%>!', { 'ejs-templates/indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent')).toHaveLength(0);
  });

  test('does not flag non-slurp tags', () => {
    const msgs = lint('<% if (x) { %>\n    <% doWork(); %>\n<% } %>', { 'ejs-templates/indent': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/indent')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: ejs-indent
// ---------------------------------------------------------------------------

describe('autofix: indent', () => {
  test('strips over-indentation from a depth-1 tag', () => {
    const input = '<%_ if (x) { _%>\n    <%_ doWork(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('adds indentation to an under-indented depth-1 tag', () => {
    const input = '<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('correctly indents closing tag (depth goes back to 0)', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n  <%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('handles two-level nesting', () => {
    const input = '<%_ if (a) { _%>\n<%_ if (b) { _%>\n<%_ doWork(); _%>\n<%_ } _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (a) { _%>\n  <%_ if (b) { _%>\n    <%_ doWork(); _%>\n  <%_ } _%>\n<%_ } _%>',
    );
  });

  test('fix is idempotent', () => {
    const input = '<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>';
    const first = applyFix(input, { 'ejs-templates/indent': 'error' });
    const second = applyFix(first, { 'ejs-templates/indent': 'error' });
    expect(second).toBe(first);
  });

  test('does not move inline tags', () => {
    const input = 'Hello <%_ name _%>!';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(input);
  });

  test('brace depth tracks <% %> structural tags too', () => {
    // A structural `<% if (x) { %>` (code type) increments brace depth,
    // so the following <%_ %>  slurp tag should be indented.
    const input = '<% if (x) { %>\n<%_ doWork(); _%>\n<% } %>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe('<% if (x) { %>\n  <%_ doWork(); _%>\n<% } %>');
  });
});

// ---------------------------------------------------------------------------
// Fixture tests – formatting (prefer-single-line-tags + ejs-indent)
// ---------------------------------------------------------------------------

describe('formatting fixture tests', () => {
  test('fixture 4 (prefer-single-line-tags + prefer-raw) autofix produces expected output', () => {
    const fixed = applyFix(fixture4.input, fixture4.rules);
    expect(fixed).toBe(fixture4.expected);
  });

  test('fixture 4 expected is already fixed (idempotent)', () => {
    const fixed = applyFix(fixture4.expected, fixture4.rules);
    expect(fixed).toBe(fixture4.expected);
  });

  test('fixture 5 (indent) autofix produces expected output', () => {
    const fixed = applyFix(fixture5.input, fixture5.rules);
    expect(fixed).toBe(fixture5.expected);
  });

  test('fixture 5 expected is already fixed (idempotent)', () => {
    const fixed = applyFix(fixture5.expected, fixture5.rules);
    expect(fixed).toBe(fixture5.expected);
  });
});

// ---------------------------------------------------------------------------
// Rule: experimental-prefer-slurp-multiline
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/experimental-prefer-slurp-multiline', () => {
  test('flags a multiline <% %> code tag', () => {
    const msgs = lint('<%\n  if (x) {\n%>', { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' });
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
    const msgs = lint('<%_\n  if (x) {\n_%>', { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' });
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: experimental-prefer-slurp-multiline
// ---------------------------------------------------------------------------

describe('autofix: experimental-prefer-slurp-multiline', () => {
  test('converts multiline <% %> to <%_ _%> (content unchanged)', () => {
    expect(applyFix('<%\n  if (x) {\n%>', { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' })).toBe(
      '<%_\n  if (x) {\n_%>',
    );
  });

  test('does not change multiline <%_ _%> (already slurping)', () => {
    const input = '<%_\n  if (x) {\n_%>';
    expect(applyFix(input, { 'ejs-templates/experimental-prefer-slurp-multiline': 'error' })).toBe(input);
  });

  test('experimental-prefer-slurp-multiline then prefer-single-line-tags collapses correctly', () => {
    const result = applyFix('<%\n  if (x) {\n%>', {
      'ejs-templates/experimental-prefer-slurp-multiline': 'error',
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(result).toBe('<%_ if (x) { _%>');
  });
});

// ---------------------------------------------------------------------------
// Rule: slurp-newline
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

// ---------------------------------------------------------------------------
// no-unused-vars / void() wrapping
// ---------------------------------------------------------------------------

describe('void() wrapping for output tags', () => {
  test('output tag virtual code wraps expression in void()', () => {
    // The void() wrapper ensures the expression is syntactically valid as a statement
    // and does not introduce new `no-undef` errors for `debug`.
    const blocks = extractTagBlocks('<%- foo %>');
    expect(blocks[0].virtualCode).toContain('foo ;');
  });

  test('void() wrapping does not introduce debug-related no-undef errors', () => {
    // Previously `debug(foo)` was used; now `void (foo)` avoids debug globals.
    const msgs = lint('<%- foo %>', { 'no-undef': 'error' });
    // Only `foo` should be flagged as undef, not `debug`
    const debugErrors = msgs.filter((m) => m.message.includes("'debug'"));
    expect(debugErrors).toHaveLength(0);
  });
});
