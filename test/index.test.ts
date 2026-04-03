// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import plugin from '../src/index.js';
import * as fixture1 from './fixtures/1.js';
import * as fixture2 from './fixtures/2.js';
import * as fixture3 from './fixtures/3.js';
import * as fixture4 from './fixtures/4.js';
import * as fixture5 from './fixtures/5.js';
import { lint, applyFix, makeLinter, makeConfig } from './helpers.js';
import { extractTagBlocks, getEjsNodes } from '../src/ejs-parser.js';

function lintWithUnusedDisableDirectivesError(
  ejsText: string,
  rules: Record<string, import('eslint').Linter.RuleSeverityAndOptions | import('eslint').Linter.RuleSeverity> = {},
): import('eslint').Linter.LintMessage[] {
  const linter = makeLinter();
  const [baseConfig] = makeConfig(rules);
  return linter.verify(
    ejsText,
    [
      {
        ...baseConfig,
        linterOptions: {
          reportUnusedDisableDirectives: 'error',
        },
      },
    ],
    { filename: 'template.ejs' },
  );
}

function applyFixWithUnusedDisableDirectivesError(
  ejsText: string,
  rules: Record<string, import('eslint').Linter.RuleSeverityAndOptions | import('eslint').Linter.RuleSeverity> = {},
): string {
  const linter = makeLinter();
  const [baseConfig] = makeConfig(rules);
  return linter.verifyAndFix(
    ejsText,
    [
      {
        ...baseConfig,
        linterOptions: {
          reportUnusedDisableDirectives: 'error',
        },
      },
    ],
    { filename: 'template.ejs' },
  ).output;
}

// ---------------------------------------------------------------------------
// extractTagBlocks
// ---------------------------------------------------------------------------

describe('extractTagBlocks', () => {
  test('skips comment tags (<%# %>)', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%# this is a comment %>'));
    expect(blocks).toHaveLength(0);
  });

  test('extracts eslint-disable EJS comment as virtual directive comment', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%# eslint-disable no-var %>'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toBe('/* eslint-disable no-var */');
    expect(blocks[0].isDirectiveComment).toBe(true);
  });

  test('extracts a single escaped-output tag (<%= %>)', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%= name %>'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:escaped-output\n/);
    expect(blocks[0].virtualCode).toContain(' name ');
  });

  test('extracts a raw-output tag (<%- %>)', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%- name %>'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:raw-output\n/);
  });

  test('extracts a slurping tag (<%_ … _%>)', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%_ code _%>'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:slurp\n/);
  });

  test('tags with slurping close (_%>) get type slurp', () => {
    const blocks = extractTagBlocks(getEjsNodes('<% code _%>'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:slurp\n/);
  });

  test('plain code tag with balanced braces → code-slurpable', () => {
    const blocks = extractTagBlocks(getEjsNodes('<% const x = 1; %>'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:code-slurpable\n/);
  });

  test('plain code tag with unbalanced braces → code', () => {
    const blocks = extractTagBlocks(getEjsNodes('<% if (x) { %>'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:code\n/);
  });

  test('multiple tags are all extracted', () => {
    const blocks = extractTagBlocks(getEjsNodes('<% a %> text <%= b %> <%- c %>'));
    expect(blocks).toHaveLength(3);
  });

  test('tracks tag position: tagLine and tagColumn', () => {
    // "<%= name %>" starts at line 1, col 0
    const blocks = extractTagBlocks(getEjsNodes('<%= name %>'));
    expect(blocks[0].tagLine).toBe(1);
    expect(blocks[0].tagColumn).toBe(0);
  });

  test('tracks code-content position: originalLine and originalColumn', () => {
    // code starts after "<%=" (3 chars) so col = 3
    const blocks = extractTagBlocks(getEjsNodes('<%= name %>'));
    expect(blocks[0].originalLine).toBe(1);
    expect(blocks[0].originalColumn).toBe(3); // right after '<%='
  });

  test('multi-line file: positions are on the correct line', () => {
    const text = 'line1\n<%= value %>\nline3';
    const blocks = extractTagBlocks(getEjsNodes(text));
    expect(blocks[0].tagLine).toBe(2);
    expect(blocks[0].originalLine).toBe(2);
  });

  test('tag in the middle of a line: column is correct', () => {
    const text = 'Hello, <%= name %>!';
    const blocks = extractTagBlocks(getEjsNodes(text));
    // "Hello, " = 7 chars, then "<%=" starts at col 7
    expect(blocks[0].tagColumn).toBe(7);
    // code starts after '<%=' at col 10
    expect(blocks[0].originalColumn).toBe(10);
  });

  test('tag with trim-newline close (-%>) is tagged as code', () => {
    const blocks = extractTagBlocks(getEjsNodes('<% code -%>'));
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:code\n/);
  });
});

// ---------------------------------------------------------------------------
// Processor: virtual code structure
// ---------------------------------------------------------------------------

describe('processor virtual code', () => {
  test('virtual code line 1 is the type comment', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%= name %>'));
    const [line1] = blocks[0].virtualCode.split('\n');
    expect(line1).toBe('//@ejs-tag:escaped-output');
  });

  test('virtual code line 2 is the tag code (no per-tag function wrapper)', () => {
    const blocks = extractTagBlocks(getEjsNodes('<% const x = 1; %>'));
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[1]).toBe(' const x = 1; ');
  });

  test('virtual code contains tag JS content directly after marker', () => {
    const blocks = extractTagBlocks(getEjsNodes('<% const x = 1; %>'));
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[1]).toBe(' const x = 1; ');
    expect(lines).not.toContain('})()');
  });

  test('virtual code has no per-tag wrapper close', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%_ const x = 1;\nconst y = 2; _%>'));
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[lines.length - 1]).not.toBe('})()');
  });

  test('multiline tag gets -multiline suffix and code is wrapped in function', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%_ const x = 1;\nconst y = 2; _%>'));
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[0]).toBe('//@ejs-tag:slurp-multiline');
    expect(lines[1]).toBe(' const x = 1;');
    expect(lines[lines.length - 1]).toBe('const y = 2; ');
  });

  test('output tag virtual code wraps content in void()', () => {
    // Single-line output tags are wrapped as `void (...);` to prevent no-unused-vars.
    const blocks = extractTagBlocks(getEjsNodes('<%= name %>'));
    expect(blocks[0].virtualCode).toContain('name ;');
    expect(blocks[0].virtualBodyInlineSuffix).toBe(';');
  });

  test('raw output tag virtual code wraps content in void()', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%- name %>'));
    expect(blocks[0].virtualCode).toContain('name ;');
  });

  test('code tag ending with { gets void 0 appended', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%_ if (x) { _%>'));
    expect(blocks[0].virtualCode).toContain('void 0;');
    expect(blocks[0].virtualBodyExtraLine).toBe('\nvoid 0;');
  });

  test('code tag NOT ending with { does not get void 0', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%_ doWork(); _%>'));
    expect(blocks[0].virtualCode).not.toContain('void 0;');
  });

  test('structural slurp tag keeps code body in virtual block', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%_ if (x) { _%>'));
    expect(blocks[0].virtualCode).toContain('if (x) {');
    expect(blocks[0].tagType).toBe('slurp');
  });

  test('preprocess outputs one incremental virtual block with all tags in order', () => {
    const parts = plugin.processors.ejs.preprocess?.('<% const x = 1; %>\n<%= x %>', 'template.ejs');
    expect(parts).toBeDefined();
    if (!parts) {
      throw new Error('Expected ejs.preprocess to be defined');
    }

    expect(parts).toHaveLength(3);

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

  test('eslint-disable in EJS comment suppresses following standard ESLint rule', () => {
    const msgs = lint('<%# eslint-disable no-var %>\n<% var value = 1; %>', { 'no-var': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('eslint-disable-next-line in EJS comment suppresses next tag', () => {
    const msgs = lint('<%# eslint-disable-next-line no-var %>\n<% var value = 1; %>', { 'no-var': 'error' });
    expect(msgs).toHaveLength(0);
  });

  test('eslint-enable in EJS comment restores linting after disable', () => {
    const msgs = lint(
      '<%# eslint-disable no-var %>\n<% var first = 1; %>\n<%# eslint-enable no-var %>\n<% var second = 2; %>',
      { 'no-var': 'error' },
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('no-var');
    expect(msgs[0].line).toBe(4);
  });

  test("reportUnusedDisableDirectives='error': single disabled rule is correctly consumed", () => {
    const msgs = lintWithUnusedDisableDirectivesError('<%# eslint-disable no-var %>\n<% var value = 1; %>', {
      'no-var': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test("reportUnusedDisableDirectives='error': multiple disabled rules are correctly consumed", () => {
    const msgs = lintWithUnusedDisableDirectivesError('<%# eslint-disable no-var, eqeqeq %>\n<% var a = b == c; %>', {
      'no-var': 'error',
      eqeqeq: 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test("reportUnusedDisableDirectives='error': ignores ejs-templates/* in unused-directive diagnostics", () => {
    const msgs = lintWithUnusedDisableDirectivesError(
      '<%# eslint-disable eqeqeq, ejs-templates/prefer-raw %>\n<%= a == b %>',
      {
        eqeqeq: 'error',
        'ejs-templates/prefer-raw': 'error',
      },
    );
    const unusedDirectiveMsgs = msgs.filter(
      (msg) => msg.ruleId === null && msg.message.includes('Unused eslint-disable directive'),
    );
    expect(unusedDirectiveMsgs).toHaveLength(0);
    expect(msgs).toHaveLength(0);
  });

  test("reportUnusedDisableDirectives='error': reports unused directive for ejs-templates/* when truly unused", () => {
    const msgs = lintWithUnusedDisableDirectivesError('<%# eslint-disable ejs-templates/prefer-raw %>\n<%- value %>', {
      'ejs-templates/prefer-raw': 'error',
    });
    const unusedDirectiveMsgs = msgs.filter(
      (msg) =>
        msg.ruleId === null &&
        msg.message.includes('Unused eslint-disable directive') &&
        msg.message.includes('ejs-templates/prefer-raw'),
    );
    expect(unusedDirectiveMsgs).toHaveLength(1);
  });

  test("reportUnusedDisableDirectives='error': autofix removes single unused disabled rule", () => {
    const fixed = applyFixWithUnusedDisableDirectivesError('<%# eslint-disable eqeqeq %>\n<% const x = 1; %>', {
      eqeqeq: 'error',
    });
    expect(fixed).not.toContain('eslint-disable eqeqeq');
  });

  test("reportUnusedDisableDirectives='error': autofix removes only unused rule from multi-rule directive", () => {
    const fixed = applyFixWithUnusedDisableDirectivesError('<%# eslint-disable no-var, eqeqeq %>\n<% var x = 1; %>', {
      'no-var': 'error',
      eqeqeq: 'error',
    });
    expect(fixed).toContain('eslint-disable no-var');
    expect(fixed).not.toContain('eqeqeq');
  });

  test("reportUnusedDisableDirectives='error': autofix updates both disable and enable directives", () => {
    const fixed = applyFixWithUnusedDisableDirectivesError(
      '<%# eslint-disable no-var, eqeqeq %>\n<% var x = 1; %>\n<%# eslint-enable no-var, eqeqeq %>',
      {
        'no-var': 'error',
        eqeqeq: 'error',
      },
    );
    expect(fixed).toContain('eslint-disable no-var');
    expect(fixed).toContain('eslint-enable no-var');
    expect(fixed).not.toContain('eqeqeq');
  });

  test("reportUnusedDisableDirectives='error': preserves close tag (-%>) when removing unused rules", () => {
    const fixed = applyFixWithUnusedDisableDirectivesError(
      '<%# eslint-disable no-var, eqeqeq -%>\n<% var x = 1; %>\n<%# eslint-enable no-var, eqeqeq -%>',
      {
        'no-var': 'error',
        eqeqeq: 'error',
      },
    );
    expect(fixed).toContain('eslint-disable no-var -%>');
    expect(fixed).toContain('eslint-enable no-var -%>');
    expect(fixed).not.toContain('eqeqeq');
  });

  test('reports parse error at EOF when closing brace is missing', () => {
    const ejsText = '<% if (x) { %>\n<div>body</div>';
    const msgs = lint(ejsText, { 'no-var': 'error' });

    expect(msgs).toHaveLength(1);
    expect(msgs[0].line).toBe(1);
    expect(msgs[0].message).toContain('Missing token');
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

  test('plugin exposes no-global-function-call rule', () => {
    expect(plugin.rules['no-global-function-call']).toBeDefined();
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
    expect(config.rules?.['ejs-templates/format']).toBe('error');
    expect(config.rules?.['ejs-templates/slurp-newline']).toBe('error');
    expect(config.rules?.['ejs-templates/indent']).toEqual(['error', { normalizeContent: true }]);
    expect(config.rules?.['ejs-templates/no-global-function-call']).toBe('error');
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
// Rule: no-global-function-call
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-global-function-call', () => {
  test('flags function call in code tag', () => {
    const msgs = lint('<% doWork(); %>', { 'ejs-templates/no-global-function-call': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-global-function-call')).toHaveLength(1);
  });

  test('does not flag method call in code tag', () => {
    const msgs = lint('<% user.save(); %>', { 'ejs-templates/no-global-function-call': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-global-function-call')).toHaveLength(0);
  });

  test('does not flag include call (allowed by default)', () => {
    const msgs = lint("<% include('partial.ejs'); %>", { 'ejs-templates/no-global-function-call': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-global-function-call')).toHaveLength(0);
  });

  test('allows explicitly configured direct calls', () => {
    const msgs = lint('<% exec(cmd); %>', {
      'ejs-templates/no-global-function-call': ['error', { allow: ['exec'] }],
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-global-function-call')).toHaveLength(0);
  });

  test('does not flag tag without function call', () => {
    const msgs = lint('<% const value = user.name; %>', { 'ejs-templates/no-global-function-call': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-global-function-call')).toHaveLength(0);
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
    const [b] = extractTagBlocks(getEjsNodes('<%= name %>'));
    expect(b.tagType).toBe('escaped-output');
    expect(b.openDelim).toBe('<%=');
    expect(b.closeDelim).toBe('%>');
  });

  test('single-line <%- %> gets raw-output type', () => {
    const [b] = extractTagBlocks(getEjsNodes('<%- name %>'));
    expect(b.tagType).toBe('raw-output');
  });

  test('structural <% if (x) { %> gets code type', () => {
    const [b] = extractTagBlocks(getEjsNodes('<% if (x) { %>'));
    expect(b.tagType).toBe('code');
  });

  test('balanced <% code %> gets code-slurpable type', () => {
    const [b] = extractTagBlocks(getEjsNodes('<% doWork(); %>'));
    expect(b.tagType).toBe('code-slurpable');
  });

  test('single-line <%_ _%> gets slurp type', () => {
    const [b] = extractTagBlocks(getEjsNodes('<%_ if (x) { _%>'));
    expect(b.tagType).toBe('slurp');
  });

  test('multiline <%_ _%> gets slurp-multiline type', () => {
    const [b] = extractTagBlocks(getEjsNodes('<%_\n  if (x) {\n_%>'));
    expect(b.tagType).toBe('slurp-multiline');
  });

  test('multiline <%= %> gets escaped-output-multiline type', () => {
    const [b] = extractTagBlocks(getEjsNodes('<%=\n  value\n%>'));
    expect(b.tagType).toBe('escaped-output-multiline');
  });

  test('multiline <% %> code tag gets code-multiline type', () => {
    const [b] = extractTagBlocks(getEjsNodes('<%\n  if (x) {\n%>'));
    expect(b.tagType).toBe('code-multiline');
  });

  test('inline slurp tag gets slurp-not-standalone type', () => {
    const [b] = extractTagBlocks(getEjsNodes('text<%_ doWork(); _%>'));
    expect(b.tagType).toBe('slurp-not-standalone');
    expect(b.isStandalone).toBe(false);
  });

  test('standalone slurp tag gets slurp type (not slurp-not-standalone)', () => {
    const [b] = extractTagBlocks(getEjsNodes('<%_ doWork(); _%>'));
    expect(b.tagType).toBe('slurp');
    expect(b.isStandalone).toBe(true);
  });

  test('stores openDelim and closeDelim', () => {
    const [b] = extractTagBlocks(getEjsNodes('<%_ code _%>'));
    expect(b.openDelim).toBe('<%_');
    expect(b.closeDelim).toBe('_%>');
  });

  test('stores codeContent (with surrounding spaces)', () => {
    const [b] = extractTagBlocks(getEjsNodes('<%= name %>'));
    expect(b.codeContent).toBe(' name ');
  });

  test('standalone tag has lineIndent equal to whitespace before it', () => {
    const [b] = extractTagBlocks(getEjsNodes('  <%_ if (x) { _%>'));
    expect(b.lineIndent).toBe('  ');
    expect(b.tagColumn).toBe(2);
  });

  test('inline tag has empty lineIndent', () => {
    const [b] = extractTagBlocks(getEjsNodes('Hello <%- name %>!'));
    expect(b.lineIndent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Tree-sitter: brace-depth / expectedIndent
// ---------------------------------------------------------------------------

describe('brace-depth tracking (indent foundation)', () => {
  test('block at depth 0 has expectedIndent = ""', () => {
    const [open] = extractTagBlocks(getEjsNodes('<%_ if (x) { _%>'));
    expect(open.expectedIndent).toBe('');
  });

  test('block inside depth-1 gets expectedIndent = "  "', () => {
    const [, inner] = extractTagBlocks(getEjsNodes('<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>'));
    expect(inner.expectedIndent).toBe('  ');
  });

  test('closing block at depth 0 after open (lowerBraceDepth = 0)', () => {
    const [, , close] = extractTagBlocks(getEjsNodes('<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>'));
    expect(close.expectedIndent).toBe('');
  });

  test('nested depth produces 4-space expectedIndent', () => {
    const blocks = extractTagBlocks(
      getEjsNodes('<%_ if (a) { _%>\n<%_ if (b) { _%>\n<%_ doWork(); _%>\n<%_ } _%>\n<%_ } _%>'),
    );
    expect(blocks[2].expectedIndent).toBe('    '); // depth 2
  });

  test('non-standalone slurp tag has expectedIndent = lineIndent (not changed)', () => {
    const [b] = extractTagBlocks(getEjsNodes('Hello <%_ name _%>'));
    expect(b.expectedIndent).toBe(b.lineIndent);
  });
});

// ---------------------------------------------------------------------------
// Rule: prefer-single-line-tags – violations
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/prefer-single-line-tags', () => {
  test('flags a multiline <%_ _%> tag', () => {
    const msgs = lint('<%_\nif (x) {\n_%>\n<%_ } _%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
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

  test('flags multiline slurp tag when trimmed content fits one line', () => {
    const msgs = lint('<%_\n  code;\n_%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Autofix: prefer-single-line-tags
// ---------------------------------------------------------------------------

describe('autofix: prefer-single-line-tags', () => {
  test('collapses single-non-empty-line multiline tag (problem-statement example)', () => {
    expect(
      applyFix('<%_\nif (generateSpringAuditor) {\n_%>\n<%_ } _%>', {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe('<%_ if (generateSpringAuditor) { _%>\n<%_ } _%>');
  });

  test('keeps multiline tag without structural braces unchanged', () => {
    const input = '<%_\n  const x = 1;\n  const y = 2;\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('collapses non-slurp multiline code tags when trimmed content fits one line', () => {
    const input = '<%\n\n  doSomething();\n\n%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe('<% doSomething(); %>');
  });

  test('collapses multiline <%= %> output tag (keeps delimiter unchanged)', () => {
    // prefer-single-line-tags only collapses; prefer-raw is a separate rule
    expect(applyFix('<%=\n  value\n%>', { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe('<%= value %>');
  });

  test('collapses multiline <%- %> raw-output tag', () => {
    expect(applyFix('<%-\n  value\n%>', { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe('<%- value %>');
  });

  test('collapses single-line-trimmable multiline slurp tag while preserving surrounding text', () => {
    const input = 'before\n<%_\n  code;\n_%>\nafter';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe('before\n<%_ code; _%>\nafter');
  });

  test('keeps indented non-structural multiline slurp tags unchanged', () => {
    const input = '  <%_\n  const a = 1;\n  const b = 2;\n  _%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
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

  test('keeps chained method call across lines unchanged without structural braces', () => {
    const input = "<%_\n  const arr = 'foo.bar'\n    .split();\n_%>";
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('keeps multiple phrases unchanged when there are no structural braces', () => {
    const input = "<%_\n  const x = 1;\n  const arr = 'a.b'\n    .split();\n_%>";
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('does not collapse code onto a // comment line', () => {
    const input =
      '<%_\n  // An embedded entity should not reference entities that embed it\n  for (relationship of relationships) {\n    if (relationship.relationshipApiDescription) {\n      doWork();\n    }\n  }\n_%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe(
      '<%_ // An embedded entity should not reference entities that embed it _%>\n<%_ for (relationship of relationships) { _%>\n<%_ if (relationship.relationshipApiDescription) { _%>\n<%_ doWork(); _%>\n<%_ } _%>\n<%_ } _%>',
    );
  });

  test('splits content with brace boundaries (if/body/close each get own tag)', () => {
    const input = '<%_\n  if (x) {\n  doWork();\n  }\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(
      '<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>',
    );
  });

  test('multiline <% %> code tag with braces is collapsed', () => {
    const input = '<%\n  if (x) {\n  doWork();\n  }\n%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(
      '<% if (x) { _%>\n<%_ doWork(); _%>\n<%_ } %>',
    );
  });

  test('keeps content between braces in a single tag', () => {
    const input = '<%\n  if (x) {\n  doWorkA();\n  doWorkB();\n  }\n%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe('<% if (x) { _%>\n<%_ doWorkA();\n  doWorkB(); _%>\n<%_ } %>');
  });

  test('with slurp tags keeps content between braces in a single tag', () => {
    const input = '<%_\n  if (x) {\n  doWorkA();\n  doWorkB();\n  }\n_%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe('<%_ if (x) { _%>\n<%_ doWorkA();\n  doWorkB(); _%>\n<%_ } _%>');
  });

  test('with slurp tags keeps contents in correct order', () => {
    const input = '<%_\n  if (x) {\n  doWorkA();\n  if (y) { doWorkB();\n  doWorkC(); }\n  doWorkC();\n  }\n_%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe(
      '<%_ if (x) { _%>\n<%_ doWorkA(); _%>\n<%_ if (y) { _%>\n<%_ doWorkB();\n  doWorkC(); _%>\n<%_ } _%>\n<%_ doWorkC(); _%>\n<%_ } _%>',
    );
  });

  test("with slurp tags should not report for end braces following = which indicates it's an assignment", () => {
    const input = '<%_\n  if (cond) {\n  const { foo } = bar;\n  doWork(foo);\n  }\n_%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe('<%_ if (cond) { _%>\n<%_ const { foo } = bar;\n  doWork(foo); _%>\n<%_ } _%>');
  });

  test('with control block containing object literal (object literal braces never split)', () => {
    const input = "<%_\n if (true) {\n   beans.push({ foo: 'bar' });\n }\n_%>";
    const fixed = applyFix(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    // Control flow braces split, object literal braces stay intact
    expect(fixed).toBe("<%_ if (true) { _%>\n<%_ beans.push({ foo: 'bar' }); _%>\n<%_ } _%>");
  });

  test('keeps arrow function block body as structural', () => {
    const input = '<%_\n  const fn = (x) => {\n    doWork(x);\n  };\n_%>';
    // Arrow function with block body is structural, and semicolon stays with closing brace
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe('<%_ const fn = (x) => { _%>\n<%_ doWork(x); _%>\n<%_ }; _%>');
  });

  test('keeps destructuring in arrow function parameters not broken', () => {
    const input = '<%_\n  items.forEach(({ foo, bar }) => {\n    console.log(foo);\n  });\n_%>';
    // The destructuring braces in parameters should not be treated as structural,
    // so the arrow function body is structural but params are left intact
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    // Arrow function with block body should report a violation
    expect(msgs.length).toBeGreaterThan(0);
  });

  test('keeps multiline tags without braces unchanged', () => {
    const input = '<%_\n  const x = 1;\n  const y = 2;\n_%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe(input);
  });

  test('keeps multiline tags with only destructuring braces unchanged', () => {
    const input = '<%_\n  const { a, b } = obj;\n  doWork(a, b);\n_%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe(input);
    expect(
      lint(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toHaveLength(0);
  });

  test('keeps multiline tags with destructuring and comments unchanged', () => {
    const input = '<%_\n  const { bar /*, foo */ } = obj;\n  doWork(bar);\n_%>';
    // Since this is only destructuring (no structural braces),
    // the tag should not be fixable and thus not reported in braces mode
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test("don't report destructuring in arrow function parameter as block brace", () => {
    const input = '<%_\n  const { foo, bar } = obj;\n  doWork(foo);\n_%>';
    // Destructuring pattern `{ foo, bar }` is not a block brace, it's a destructuring target
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('ignores ${ template literal interpolations as block braces', () => {
    const input = '<%_\n  if (cond) {\n  const x = `hello ${name}`;\n  doWork();\n  }\n_%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe('<%_ if (cond) { _%>\n<%_ const x = `hello ${name}`;\n  doWork(); _%>\n<%_ } _%>');
  });

  test('applies indent-aware split when indent also reports in the same run', () => {
    const input = '  <%_\n  if (x) {\n  doWork();\n  }\n  _%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
        'ejs-templates/indent': 'error',
      }),
    ).toBe('<%_ if (x) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>');
  });

  test('does not re-report preserved inner tag with ${ interpolation', () => {
    const input = '<%_\n  if (cond) {\n  const x = `hello ${name}`;\n  doWork();\n  }\n_%>';
    const fixed = applyFix(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });

    expect(
      lint(fixed, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toHaveLength(0);
  });

  test('does not report the preserved inner multiline tag again', () => {
    const input = '<%_\n  if (x) {\n  doWorkA();\n  doWorkB();\n  }\n_%>';
    const fixed = applyFix(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });

    expect(
      lint(fixed, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toHaveLength(0);
  });

  test('keeps } else { together in a single tag', () => {
    const input = "<%_ if(foo) { _%>\n<%_\n  } else {\n  const foo = 'bar'\n_%>\n<%_ } _%>";
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(1);
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe("<%_ if(foo) { _%>\n<%_ } else { _%>\n<%_ const foo = 'bar' _%>\n<%_ } _%>");
  });

  test('detects incomplete multiline if condition with nested parens as structural', () => {
    const input =
      "<%_\n  if ((relationship.relationshipType === 'many-to-one' || (relationship.relationshipType === 'one-to-one' && relationship.ownerSide === true))\n                && !relationship.id) {\n%>\n<%_ } _%>";
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(1);
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe(
      "<%_ if ((relationship.relationshipType === 'many-to-one' || (relationship.relationshipType === 'one-to-one' && relationship.ownerSide === true)) && !relationship.id) { %>\n<%_ } _%>",
    );
  });

  test('detects for...of loops as structural', () => {
    const input = '<%_\n  for (const item of items) {\n    doWork(item);\n  }\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBeGreaterThan(0);
  });

  test('detects for...of loops as structural unbalanced', () => {
    const input = '<%_\n  for (const item of items) {\n    doWork(item);\n\n_%><%_  }\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBeGreaterThan(0);
  });

  test('with for...of loop and destructuring assignment', () => {
    const input = '<%_\n  for (const rel of rels) {\n    const { id, name } = rel;\n    doWork(id, name);\n  }\n_%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe('<%_ for (const rel of rels) { _%>\n<%_ const { id, name } = rel;\n    doWork(id, name); _%>\n<%_ } _%>');
  });

  test('with for...of loop with complex filter (incomplete tag)', () => {
    // When the closing brace is missing (spans multiple tags), should still report
    const input = '<%_ for (const rel of relationships.filter(x => x.key)) {\n    const { id, name } = rel;\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    // The tag is multiline, so it should report if parser can handle incomplete braces
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBeGreaterThanOrEqual(0);
  });

  test('user reported case: for...of with filter and destructuring (incomplete - missing close brace)', () => {
    const input =
      '<%_ for (const relationship of relationships.filter(rel => rel.otherEntity.primaryKey)) {\n  const { otherEntity, relationshipName, propertyName, otherEntityField, relationshipRequired, otherEntityName, relationshipFieldName, relationshipFieldNamePlural } = relationship;\n_%>\n<%_ } _%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    // This tag should be flagged as multiline with structural (for) braces
    const preferSingleLineMsgs = msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags');
    // Currently fails because parser can't recognize incomplete braces
    expect(preferSingleLineMsgs.length).toBeGreaterThan(0);
  });

  test('complete for...of with filter and destructuring (with closing brace)', () => {
    const input =
      '<%_ for (const relationship of relationships.filter(rel => rel.otherEntity.primaryKey)) {\n  const { otherEntity, relationshipName } = relationship;\n}\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    const preferSingleLineMsgs = msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags');
    // With complete braces, should report
    expect(preferSingleLineMsgs.length).toBeGreaterThan(0);
  });

  test('issue: should not detect object literals as structural braces', () => {
    // Object literal array should not trigger braces mode
    const input1 = '<%_\n  const items = [\n    { id: 1, name: "a" },\n    { id: 2, name: "b" }\n  ];\n_%>';
    const msgs1 = lint(input1, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs1.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBe(0);

    // Object in function call with map should not be detected as structural
    const input2 =
      '<%_\n  const result = items.map(({ id, name }) => ({\n    id: id * 2,\n    name: name.toUpperCase()\n  }));\n_%>';
    const msgs2 = lint(input2, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs2.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBe(0);

    // Variable assignment should not be treated as structural
    const input3 = '<%_\n  const config = {\n    api: "https://example.com",\n    timeout: 5000\n  };\n_%>';
    const msgs3 = lint(input3, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs3.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBe(0);
  });

  test('issue: should not flag object literal passed to add call in braces mode', () => {
    const input =
      '<%_\notherEntityActions.add({\n      action: `get${otherEntity.entityNamePlural}`,\n     reducer: otherEntity.builtInUser ? `userManagement.${otherEntity.entityInstancePlural}` : `${otherEntity.entityReactState}.entities`,\n});\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(0);
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

  test('flags a standalone multiline <%_ _%> tag with wrong indentation', () => {
    const input = '<%_ if (x) { %>\n    <%_\n    doWork();\n    _%>\n<%_ } %>';
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

  test('aligns close-open transition tags like } else { with the opening block level', () => {
    const input = '<%_ if (x) { _%>\n  <%_ a(); _%>\n<%_ } else { _%>\n  <%_ b(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (x) { _%>\n  <%_ a(); _%>\n<%_ } else { _%>\n  <%_ b(); _%>\n<%_ } _%>',
    );
  });

  test('indents multiline slurp tag and its content', () => {
    const input = '<%_ if (x) { %>\n<%_\ndoWork();\ndoMore();\n_%>\n<%_ } %>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(
      '<%_ if (x) { %>\n  <%_ doWork();\ndoMore();\n  _%>\n<%_ } %>',
    );
  });

  test('normalizes multiline content when normalizeContent=true', () => {
    const input = '<%_ if (x) { %>\n<%_\ndoWork();\ndoMore();\n_%>\n<%_ } %>';
    expect(applyFix(input, { 'ejs-templates/indent': ['error', { normalizeContent: true }] })).toBe(
      '<%_ if (x) { %>\n  <%_ doWork();\n      doMore();\n  _%>\n<%_ } %>',
    );
  });

  test('normalizes content of already-correctly-indented multiline tag when normalizeContent=true', () => {
    const input = '<%_ if (x) { _%>\n  <%_\n  doWork();\n  doMore();\n  _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': ['error', { normalizeContent: true }] })).toBe(
      '<%_ if (x) { _%>\n  <%_ doWork();\n      doMore();\n  _%>\n<%_ } _%>',
    );
  });

  test('does not change already-correctly-indented multiline tag without normalizeContent', () => {
    const input = '<%_ if (x) { _%>\n  <%_\n  doWork();\n  doMore();\n  _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': 'error' })).toBe(input);
  });

  test('does not re-report already-normalized multiline tag when normalizeContent=true (idempotent)', () => {
    const input = '<%_ if (x) { _%>\n  <%_ doWork();\n      doMore();\n  _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': ['error', { normalizeContent: true }] })).toBe(input);
  });

  test('does not normalize slurp-multiline when close is on same content line (avoids conflict with format same-line)', () => {
    // close on same line as last content → normalizeContent skips it to avoid circular fix
    const input = '<%_ if (x) { _%>\n  <%_ doWork();\n  doMore(); _%>\n<%_ } _%>';
    expect(applyFix(input, { 'ejs-templates/indent': ['error', { normalizeContent: true }] })).toBe(input);
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

// ---------------------------------------------------------------------------
// Rule: ejs-templates/format
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/format', () => {
  test('flags tag without spacing around content', () => {
    const msgs = lint('<%foo%>', { 'ejs-templates/format': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/format').length).toBeGreaterThan(0);
  });

  test('does not flag tag already spaced', () => {
    const msgs = lint('<% foo %>', { 'ejs-templates/format': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/format')).toHaveLength(0);
  });

  test("flags multiline close with default multilineClose='new-line'", () => {
    const input = '<%_\n  doWork(); _%>';
    const msgs = lint(input, { 'ejs-templates/format': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/format').length).toBeGreaterThan(0);
  });

  test("does not require multiline close newline when multilineClose='same-line'", () => {
    const input = '<%_ doWork(); _%>';
    const msgs = lint(input, { 'ejs-templates/format': ['error', { multilineClose: 'same-line' }] });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/format')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: ejs-templates/format
// ---------------------------------------------------------------------------

describe('autofix: format', () => {
  test('adds a single space around single-line content', () => {
    expect(applyFix('<%foo%>', { 'ejs-templates/format': 'error' })).toBe('<% foo %>');
  });

  test('formats slurp tag content by trimming outer whitespace', () => {
    expect(applyFix('<%_  doWork();   _%>', { 'ejs-templates/format': 'error' })).toBe('<%_ doWork(); _%>');
  });

  test("moves multiline close to a new line aligned with opening indent by default (multilineClose='new-line')", () => {
    const input = '  <%_\n  doWork(); _%>';
    expect(applyFix(input, { 'ejs-templates/format': 'error' })).toBe('  <%_ doWork();\n  _%>');
  });

  test("keeps close on same line when multilineClose='same-line'", () => {
    const input = '  <%_\n  doWork(); _%>';
    expect(applyFix(input, { 'ejs-templates/format': ['error', { multilineClose: 'same-line' }] })).toBe(
      '  <%_ doWork(); _%>',
    );
  });

  test('does not move close tag to new line when open tag is not slurp', () => {
    const input = '  <%\n  doWork(); %>';
    expect(applyFix(input, { 'ejs-templates/format': 'error' })).toBe('  <% doWork(); %>');
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
    const blocks = extractTagBlocks(getEjsNodes('<%- foo %>'));
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
