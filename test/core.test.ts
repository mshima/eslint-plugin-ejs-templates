// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import stylistic from '@stylistic/eslint-plugin';
import { Linter } from 'eslint';
import plugin from '../src/index.js';
import { lint, applyFix, makeLinter, makeConfig } from './helpers.js';
import { extractTagBlocks, getEjsNodes } from '../src/ejs-parser.js';
import { type Config } from 'eslint/config';

type RuleConfigMap = Record<string, Linter.RuleSeverityAndOptions | Linter.RuleSeverity>;

function makeStylisticConfig(rules: RuleConfigMap, ...configs: Config[]): Config[] {
  return [
    ...configs,
    {
      files: ['**/*.ejs'],
      plugins: { 'ejs-templates': plugin, '@stylistic': stylistic },
      processor: 'ejs-templates/ejs',
      rules,
    },
  ] as const satisfies Config[];
}

function lintWithStylistic(ejsText: string, rules: RuleConfigMap, ...configs: Config[]): ReturnType<typeof lint> {
  return makeLinter().verify(ejsText, makeStylisticConfig(rules, ...configs), { filename: 'template.ejs' });
}

function applyFixWithStylistic(ejsText: string, rules: RuleConfigMap, ...configs: Config[]): string {
  return makeLinter().verifyAndFix(ejsText, makeStylisticConfig(rules, ...configs), { filename: 'template.ejs' })
    .output;
}

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
  test('skips standalone comment tags with -%> (no empty line)', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%# this is a comment -%>'));
    expect(blocks).toHaveLength(0);
  });

  test('skips non-standalone comment tags (inline, no empty line)', () => {
    const blocks = extractTagBlocks(getEjsNodes('text <%# comment %>'));
    expect(blocks).toHaveLength(0);
  });

  test('creates comment-empty-line block for standalone comment tag without -%>', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%# this is a comment %>'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tagType).toBe('comment-empty-line');
    expect(blocks[0].isDirectiveComment).toBe(true);
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
    expect(blocks[0].virtualCode).toContain(' name');
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
    expect(lines[1]).toBe(' const x = 1;');
  });

  test('virtual code contains tag JS content directly after marker', () => {
    const blocks = extractTagBlocks(getEjsNodes('<% const x = 1; %>'));
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[1]).toBe(' const x = 1;');
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
    expect(lines[lines.length - 1]).toBe('const y = 2;');
  });

  test('output tag virtual code wraps content in void()', () => {
    // Single-line output tags are wrapped as `void (...);` to prevent no-unused-vars.
    const blocks = extractTagBlocks(getEjsNodes('<%= name %>'));
    expect(blocks[0].virtualCode).toContain('name;');
    expect(blocks[0].virtualBodyInlineSuffix).toBe(';');
  });

  test('raw output tag virtual code wraps content in void()', () => {
    const blocks = extractTagBlocks(getEjsNodes('<%- name %>'));
    expect(blocks[0].virtualCode).toContain('name;');
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

  test('comment tags with -%> produce no virtual blocks (no lint errors)', () => {
    const msgs = lint('<%# this is a comment -%>', { 'no-var': 'error' });
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
      '<%# eslint-disable eqeqeq, ejs-templates/prefer-encoded %>\n<%= a == b %>',
      {
        eqeqeq: 'error',
        'ejs-templates/prefer-encoded': ['error', 'never'],
      },
    );
    const unusedDirectiveMsgs = msgs.filter(
      (msg) => msg.ruleId === null && msg.message.includes('Unused eslint-disable directive'),
    );
    expect(unusedDirectiveMsgs).toHaveLength(0);
    expect(msgs).toHaveLength(0);
  });

  test("reportUnusedDisableDirectives='error': reports unused directive for ejs-templates/* when truly unused", () => {
    const msgs = lintWithUnusedDisableDirectivesError(
      '<%# eslint-disable ejs-templates/prefer-encoded %>\n<%- value %>',
      {
        'ejs-templates/prefer-encoded': ['error', 'never'],
      },
    );
    const unusedDirectiveMsgs = msgs.filter(
      (msg) =>
        msg.ruleId === null &&
        msg.message.includes('Unused eslint-disable directive') &&
        msg.message.includes('ejs-templates/prefer-encoded'),
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

  test('plugin exposes prefer-encoded rule', () => {
    expect(plugin.rules['prefer-encoded']).toBeDefined();
  });

  test('plugin exposes prefer-slurping-codeonly rule', () => {
    expect(plugin.rules['prefer-slurping-codeonly']).toBeDefined();
  });

  test('plugin exposes no-global-function-call rule', () => {
    expect(plugin.rules['no-global-function-call']).toBeDefined();
  });

  test('plugin exposes no-function-block rule', () => {
    expect(plugin.rules['no-function-block']).toBeDefined();
  });

  test('plugin exposes base config', () => {
    expect(Array.isArray(plugin.configs.base)).toBe(true);
    expect(plugin.configs.base.length).toBeGreaterThan(0);
  });

  test('base config targets *.ejs files', () => {
    const config = plugin.configs.base[0];
    expect(config.files).toEqual(['**/*.ejs']);
  });

  test('plugin exposes configure', () => {
    expect(typeof plugin.configs.customize).toBe('function');
    expect(plugin.configs.customize({}).length).toBeGreaterThan(0);
  });

  test('all config targets *.ejs files', () => {
    const config = plugin.configs.customize({});
    for (const cfg of config) {
      expect(cfg.files?.every((f) => (f as string).endsWith('.ejs'))).toBe(true);
    }
  });

  test('all config enables all rules as error', () => {
    const configs = plugin.configs.customize({});
    expect(configs[1].rules?.['ejs-templates/prefer-encoded']).toEqual(['error', 'always']);
    expect(configs[2].rules?.['ejs-templates/prefer-encoded']).toEqual(['error', 'never']);
    const config = configs[0];
    expect(config.rules?.['ejs-templates/prefer-output']).toBe('error');
    expect(config.rules?.['ejs-templates/prefer-slurping-codeonly']).toBe('error');
    expect(config.rules?.['ejs-templates/experimental-prefer-slurp-multiline']).toBe('off');
    expect(config.rules?.['ejs-templates/prefer-single-line-tags']).toBe('error');
    expect(config.rules?.['ejs-templates/format']).toBe('error');
    expect(config.rules?.['ejs-templates/slurp-newline']).toBe('error');
    expect(config.rules?.['ejs-templates/indent']).toBe('error');
    expect(config.rules?.['ejs-templates/no-global-function-call']).toEqual(['error', { allow: [] }]);
    expect(config.rules?.['ejs-templates/no-function-block']).toBe('error');
  });

  test('customize scopes extra configs to *.ejs without trailing whitespace in the glob', () => {
    const configs = plugin.configs.customize(
      {},
      {
        plugins: { '@stylistic': stylistic },
        rules: { '@stylistic/semi': ['error', 'always'] },
      },
    );

    for (const cfg of configs) {
      expect(cfg.files?.every((f) => (f as string).endsWith('.ejs'))).toBe(true);
    }
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

describe('interoperability: @stylistic/eslint-plugin', () => {
  test('@stylistic/block-spacing fixes content inside EJS tags', () => {
    const result = applyFixWithStylistic('<% if (foo) {bar();} %>', {
      '@stylistic/block-spacing': ['error', 'always'],
    });

    expect(result).toBe('<% if (foo) { bar(); } %>');
  });

  test('@stylistic/brace-style fixes multiline tags without corrupting delimiters', () => {
    const result = applyFixWithStylistic('<% if (foo) {\n  bar();\n}\nelse {\n  baz();\n} %>', {
      '@stylistic/brace-style': ['error', '1tbs'],
    });

    expect(result).toContain('} else {');
    expect(result.startsWith('<%')).toBe(true);
    expect(result.endsWith('%>')).toBe(true);
  });

  test('@stylistic/no-trailing-spaces removes trailing spaces inside multiline tags', () => {
    const result = applyFixWithStylistic('<% const foo = 1;   \nconst bar = 2; \n %>', {
      '@stylistic/no-trailing-spaces': 'error',
    });

    expect(result).toBe('<% const foo = 1;\nconst bar = 2;\n %>');
  });

  test('@stylistic/semi inserts a semicolon at the end of code content', () => {
    const result = applyFixWithStylistic('<% const foo = 1 %>', {
      '@stylistic/semi': ['error', 'always'],
    });

    expect(result).toBe('<% const foo = 1; %>');
  });

  test('@stylistic/semi does not insert a semicolon at the end of code content when not needed', () => {
    const result = applyFixWithStylistic('<%- foo %>', {
      '@stylistic/semi': ['error', 'always'],
    });

    expect(result).toBe('<%- foo %>');
  });

  test('@stylistic/semi does not insert a semicolon at the end of code content when not needed', () => {
    const result = applyFixWithStylistic('<%_ if (buildToolUnknown) { _%>\n<%_ } _%>', {
      '@stylistic/semi': ['error', 'always'],
    });

    expect(result).toBe('<%_ if (buildToolUnknown) { _%>\n<%_ } _%>');
  });

  test('@stylistic/semi keeps multiline content unchanged when semicolons already exist', () => {
    const input =
      "<%_ const { fieldName/* , fieldValidationRequired */, id } = field;\n      const tsType = `${field.fieldIsEnum ? 'keyof typeof ' : ''}${field.tsType}`; _%>";
    const result = applyFixWithStylistic(input, {
      '@stylistic/semi': 'error',
    });

    expect(result).toBe(input);
  });

  test('customize can apply extra Stylistic configs to EJS files', () => {
    const result = makeLinter().verifyAndFix(
      '<% const foo = 1 %>',
      plugin.configs.customize(
        {},
        {
          plugins: { '@stylistic': stylistic },
          rules: { '@stylistic/semi': ['error', 'always'] },
        },
      ),
      { filename: 'template.ejs' },
    ).output;

    expect(result).toContain('const foo = 1;');
  });

  test('stylistic rules report diagnostics through the processor', () => {
    const messages = lintWithStylistic('<% if (foo) {bar();} %>', {
      '@stylistic/block-spacing': ['error', 'always'],
    });

    expect(messages.some((message) => message.ruleId === '@stylistic/block-spacing')).toBe(true);
  });

  test('@stylistic/spaced-comment does not report errors on @ejs-tag: marker comments', () => {
    const messages = lintWithStylistic('<% const x = 1; %>', {
      '@stylistic/spaced-comment': ['error', 'always'],
    });

    // The //@ejs-tag: marker line is generated code; all errors on it are suppressed.
    expect(messages.filter((m) => m.ruleId === '@stylistic/spaced-comment')).toHaveLength(0);
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

  test('lintCodeContent removes one trailing blank char', () => {
    const [b] = extractTagBlocks(getEjsNodes('<%= name   %>'));
    expect(b.codeContent).toBe(' name   ');
    expect(b.lintCodeContent).toBe(' name  ');
  });

  test('lintCodeContent removes trailing empty last line', () => {
    const [b] = extractTagBlocks(getEjsNodes('<%_ const x = 1;\n_%>'));
    expect(b.codeContent).toBe(' const x = 1;\n');
    expect(b.lintCodeContent).toBe(' const x = 1;');
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
// no-unused-vars / void() wrapping
// ---------------------------------------------------------------------------

describe('void() wrapping for output tags', () => {
  test('output tag virtual code wraps expression in void()', () => {
    // The void() wrapper ensures the expression is syntactically valid as a statement
    // and does not introduce new `no-undef` errors for `debug`.
    const blocks = extractTagBlocks(getEjsNodes('<%- foo %>'));
    expect(blocks[0].virtualCode).toContain('foo;');
  });

  test('void() wrapping does not introduce debug-related no-undef errors', () => {
    // Previously `debug(foo)` was used; now `void (foo)` avoids debug globals.
    const msgs = lint('<%- foo %>', { 'no-undef': 'error' });
    // Only `foo` should be flagged as undef, not `debug`
    const debugErrors = msgs.filter((m) => m.message.includes("'debug'"));
    expect(debugErrors).toHaveLength(0);
  });
});
