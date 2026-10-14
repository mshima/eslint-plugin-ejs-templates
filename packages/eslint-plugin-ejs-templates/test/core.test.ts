// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import ejs from 'ejs';
import stylistic from '@stylistic/eslint-plugin';
import { Linter } from 'eslint';
import plugin from '../src/index.js';
import { lint, applyFix, makeLinter, makeConfig } from './helpers.js';
import { extractTagBlocks } from '../src/ejs-parser.js';
import { buildTemplate, validateTemplate } from 'ejs-template-parser';
import { type Config } from 'eslint/config';
import {
  processor,
  SENTINEL_COMMENT_EMPTY_LINE,
  SENTINEL_FORMAT,
  SENTINEL_INDENT,
  SENTINEL_INDENT_NORMALIZE,
  SENTINEL_NO_MULTILINE_OUTPUT,
  SENTINEL_OUTPUT_SEMI_ADD,
  SENTINEL_OUTPUT_SEMI_REMOVE,
  SENTINEL_PREFER_OUTPUT,
  SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES,
  SENTINEL_PREFER_SLURP_MULTILINE,
  SENTINEL_SLURP_NEWLINE,
} from '../src/processor.js';

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
  /** The blocks of a template, with its diagnostics, which tell the comment tags leaving an empty line. */
  const diagnosedBlocksOf = (text: string) => {
    const template = buildTemplate(text);
    return extractTagBlocks(template.tags, validateTemplate(template));
  };

  test('skips standalone comment tags with -%> (no empty line)', () => {
    const blocks = diagnosedBlocksOf('<%# this is a comment -%>');
    expect(blocks).toHaveLength(0);
  });

  test('skips non-standalone comment tags (inline, no empty line)', () => {
    const blocks = diagnosedBlocksOf('text <%# comment %>');
    expect(blocks).toHaveLength(0);
  });

  test('creates comment-empty-line block for standalone comment tag without -%>', () => {
    const blocks = diagnosedBlocksOf('<%# this is a comment %>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tagType).toBe('comment-empty-line');
    expect(blocks[0].isDirectiveComment).toBe(true);
  });

  test('extracts eslint-disable EJS comment as virtual directive comment', () => {
    const blocks = extractTagBlocks(buildTemplate('<%# eslint-disable no-var %>').tags);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toBe('/* eslint-disable no-var */');
    expect(blocks[0].isDirectiveComment).toBe(true);
  });

  test('extracts a single escaped-output tag (<%= %>)', () => {
    const blocks = extractTagBlocks(buildTemplate('<%= name %>').tags);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:escaped-output\n/);
    expect(blocks[0].virtualCode).toContain(' name');
  });

  test('extracts a raw-output tag (<%- %>)', () => {
    const blocks = extractTagBlocks(buildTemplate('<%- name %>').tags);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:raw-output\n/);
  });

  test('extracts a slurping tag (<%_ … _%>)', () => {
    const blocks = extractTagBlocks(buildTemplate('<%_ code _%>').tags);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:slurp\n/);
  });

  test('tags with slurping close (_%>) get type slurp', () => {
    const blocks = extractTagBlocks(buildTemplate('<% code _%>').tags);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:slurp\n/);
  });

  test('plain code tag with balanced braces → code-slurpable', () => {
    const blocks = extractTagBlocks(buildTemplate('<% const x = 1; %>').tags);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:code-slurpable\n/);
  });

  test('plain code tag with unbalanced braces → code', () => {
    const blocks = extractTagBlocks(buildTemplate('<% if (x) { %>').tags);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:code\n/);
  });

  test('multiple tags are all extracted', () => {
    const blocks = extractTagBlocks(buildTemplate('<% a %> text <%= b %> <%- c %>').tags);
    expect(blocks).toHaveLength(3);
  });

  test('tracks tag position: tagLine and tagColumn', () => {
    // "<%= name %>" starts at line 1, col 0
    const blocks = extractTagBlocks(buildTemplate('<%= name %>').tags);
    expect(blocks[0].tagLine).toBe(1);
    expect(blocks[0].tagColumn).toBe(0);
  });

  test('tracks code-content position: originalLine and originalColumn', () => {
    // code starts after "<%=" (3 chars) so col = 3
    const blocks = extractTagBlocks(buildTemplate('<%= name %>').tags);
    expect(blocks[0].originalLine).toBe(1);
    expect(blocks[0].originalColumn).toBe(3); // right after '<%='
  });

  test('multi-line file: positions are on the correct line', () => {
    const text = 'line1\n<%= value %>\nline3';
    const blocks = extractTagBlocks(buildTemplate(text).tags);
    expect(blocks[0].tagLine).toBe(2);
    expect(blocks[0].originalLine).toBe(2);
  });

  test('tag in the middle of a line: column is correct', () => {
    const text = 'Hello, <%= name %>!';
    const blocks = extractTagBlocks(buildTemplate(text).tags);
    // "Hello, " = 7 chars, then "<%=" starts at col 7
    expect(blocks[0].tagColumn).toBe(7);
    // code starts after '<%=' at col 10
    expect(blocks[0].originalColumn).toBe(10);
  });

  test('tag with trim-newline close (-%>) is tagged as code', () => {
    const blocks = extractTagBlocks(buildTemplate('<% code -%>').tags);
    expect(blocks[0].virtualCode).toMatch(/^\/\/@ejs-tag:code\n/);
  });
});

// ---------------------------------------------------------------------------
// Processor: virtual code structure
// ---------------------------------------------------------------------------

describe('processor virtual code', () => {
  test('virtual code line 1 is the type comment', () => {
    const blocks = extractTagBlocks(buildTemplate('<%= name %>').tags);
    const [line1] = blocks[0].virtualCode.split('\n');
    expect(line1).toBe('//@ejs-tag:escaped-output');
  });

  test('virtual code line 2 is the tag code (no per-tag function wrapper)', () => {
    const blocks = extractTagBlocks(buildTemplate('<% const x = 1; %>').tags);
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[1]).toBe(' const x = 1;');
  });

  test('virtual code contains tag JS content directly after marker', () => {
    const blocks = extractTagBlocks(buildTemplate('<% const x = 1; %>').tags);
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[1]).toBe(' const x = 1;');
    expect(lines).not.toContain('})()');
  });

  test('virtual code has no per-tag wrapper close', () => {
    const blocks = extractTagBlocks(buildTemplate('<%_ const x = 1;\nconst y = 2; _%>').tags);
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[lines.length - 1]).not.toBe('})()');
  });

  test('multiline tag gets -multiline suffix and code is wrapped in function', () => {
    const blocks = extractTagBlocks(buildTemplate('<%_ const x = 1;\nconst y = 2; _%>').tags);
    const lines = blocks[0].virtualCode.split('\n');
    expect(lines[0]).toBe('//@ejs-tag:slurp-multiline');
    expect(lines[1]).toBe(' const x = 1;');
    expect(lines[lines.length - 1]).toBe('const y = 2;');
  });

  test('output tag virtual code wraps content in void()', () => {
    // Single-line output tags are wrapped as `void (...);` to prevent no-unused-vars.
    const blocks = extractTagBlocks(buildTemplate('<%= name %>').tags);
    expect(blocks[0].virtualCode).toContain('name;');
    expect(blocks[0].virtualBodyInlineSuffix).toBe(';');
  });

  test('raw output tag virtual code wraps content in void()', () => {
    const blocks = extractTagBlocks(buildTemplate('<%- name %>').tags);
    expect(blocks[0].virtualCode).toContain('name;');
  });

  test('code tag ending with { gets void 0 appended', () => {
    const blocks = extractTagBlocks(buildTemplate('<%_ if (x) { _%>').tags);
    expect(blocks[0].virtualCode).toContain('void 0;');
    expect(blocks[0].virtualBodyExtraLine).toBe('\nvoid 0;');
  });

  test('code tag NOT ending with { does not get void 0', () => {
    const blocks = extractTagBlocks(buildTemplate('<%_ doWork(); _%>').tags);
    expect(blocks[0].virtualCode).not.toContain('void 0;');
  });

  test('structural slurp tag keeps code body in virtual block', () => {
    const blocks = extractTagBlocks(buildTemplate('<%_ if (x) { _%>').tags);
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

  // Parsing the virtual JavaScript and running every rule on it is most of the time of a lint: once by template.
  test('ESLint lints the virtual JavaScript of a template once', () => {
    let runs = 0;
    const counter = { rules: { runs: { create: () => ({ Program: () => void runs++ }) } } };
    makeLinter().verify(
      '<% const x = 1; %>\n<%= x %>\n',
      [
        {
          files: ['**/*.ejs'],
          plugins: { 'ejs-templates': plugin, counter },
          processor: 'ejs-templates/ejs',
          rules: { 'counter/runs': 'error' },
        },
      ],
      { filename: 'template.ejs' },
    );
    expect(runs).toBe(1);
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

  // A directive removed goes with what EJS drops after its tag, which would render once the tag is gone: the line break
  // after its `-%>`, the blanks and the line break after its `_%>`.
  test.each([
    ['-%>', '<%# eslint-disable no-var -%>\nA\n', 'A\n'],
    ['_%>', '<%# eslint-disable no-var _%>  \nA\n', 'A\n'],
    ['%>, which drops nothing', '<%# eslint-disable no-var %>\nA\n', '\nA\n'],
    ['-%>, with its eslint-enable', '<%# eslint-disable no-var -%>\nA\n<%# eslint-enable no-var -%>\nB\n', 'A\nB\n'],
    // The blanks before the tag, which the `<%_` after it would slurp, are written in an output tag.
    ['-%>, blanks before it', 'a  <%# eslint-disable no-var -%>\n<%_ y(); _%>\nb\n', "a<%- '  ' %><%_ y(); _%>\nb\n"],
    // The `%` and the `>` it leaves side by side, which EJS would read as a close delimiter, are written `%%>`.
    ['-%>, between the characters of a delimiter', '%<%# eslint-disable no-var -%>\n>\n', '%%>\n'],
  ])(
    "reportUnusedDisableDirectives='error': autofix removes an unused directive closed by %s, the output unchanged",
    (_label, input, fixed) => {
      const output = applyFixWithUnusedDisableDirectivesError(input, {});
      expect(output).toBe(fixed);
      expect(ejs.render(output, { y: () => undefined })).toBe(ejs.render(input, { y: () => undefined }));
    },
  );

  test("reportUnusedDisableDirectives='error': the fix removing a directive covers its tag, a tag alike after it", () => {
    // The tag after it starts with the same `<%# `: the fix deletes the directive all the same, not from there on.
    expect(lintWithUnusedDisableDirectivesError('<%# eslint-disable no-var -%>\n<%# a %>\nA\n')).toEqual([
      {
        ruleId: null,
        message: "Unused eslint-disable directive (no problems were reported from 'no-var').",
        line: 1,
        column: 0,
        severity: 2,
        fix: { range: [0, 30], text: '' },
      },
    ]);
  });

  test("reportUnusedDisableDirectives='error': autofix keeps an eslint-enable without rule list", () => {
    const input = '<%# eslint-disable no-var, eqeqeq %>\n<% var x = 1; %>\n<%# eslint-enable %>\n';
    const rules = { 'no-var': 'error', eqeqeq: 'error' } as const;
    expect(lintWithUnusedDisableDirectivesError(input, rules)).toEqual([
      {
        ruleId: null,
        message: "Unused eslint-disable directive (no problems were reported from 'eqeqeq').",
        line: 1,
        column: 0,
        severity: 2,
        fix: { range: [0, 36], text: '<%# eslint-disable no-var %>' },
      },
    ]);
    expect(applyFixWithUnusedDisableDirectivesError(input, rules)).toMatchInlineSnapshot(`
      "<%# eslint-disable no-var %>
      <% var x = 1; %>
      <%# eslint-enable %>
      "
    `);
  });

  test('reports a parsing error the JavaScript parser of ESLint finds in a tag', () => {
    expect(lint('<% let a = 1; let a = 2; %>\n')).toEqual([
      {
        ruleId: null,
        fatal: true,
        severity: 2,
        message: "Parsing error: Identifier 'a' has already been declared",
        line: 1,
        column: 19,
      },
    ]);
  });

  test('reports a parsing error after a bare return at its tag', () => {
    expect(lint('<% return; %>\n<% let a = 1; let a = 2; %>\n')).toEqual([
      {
        ruleId: null,
        fatal: true,
        severity: 2,
        message: "Parsing error: Identifier 'a' has already been declared",
        line: 2,
        column: 19,
      },
    ]);
  });

  // The virtual JavaScript not parsing, the errors ejs-template-parser tells of the JavaScript of the template are the
  // parsing errors, at their tags.
  test('reports a block no tag closes as the parsing error, at the tag opening it', () => {
    expect(lint('<% if (x) { %>\n<div>body</div>', { 'no-var': 'error' })).toEqual([
      {
        ruleId: null,
        fatal: true,
        severity: 2,
        message: 'Parsing error: No tag closes the block this tag opens',
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 15,
      },
    ]);
  });

  test('reports a tag closing a block no tag opens as the parsing error', () => {
    expect(lint('<% } %>\nx')).toEqual([
      {
        ruleId: null,
        fatal: true,
        severity: 2,
        message: 'Parsing error: This tag closes a block no tag before it opens',
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 8,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Plugin shape
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sentinel fixes re-validate the tag they rewrite
// ---------------------------------------------------------------------------

let sentinelFileCount = 0;

/**
 * Run `postprocess()` on one message whose fix replaces the marker of a tag (or `range`, relative
 * to the marker) with `text`, as a rule would; the translator sees the tag as `preprocess()` built it.
 */
function postprocessFix(ejsText: string, text: string, tagIndex = 0, range?: [number, number]): Linter.LintMessage[] {
  const filename = `sentinel-${String(++sentinelFileCount)}.ejs`;
  const [virtualCode] = processor.preprocess?.(ejsText, filename) ?? [];
  if (typeof virtualCode !== 'string') throw new Error('preprocess gave no virtual code');
  const marker = [...virtualCode.matchAll(/\/\/@ejs-tag:[^\n]*/gu)][tagIndex];
  const start = marker.index;
  const line = virtualCode.slice(0, start).split('\n').length;
  const fixRange: [number, number] = range ? [start + range[0], start + range[1]] : [start, start + marker[0].length];
  return (
    processor.postprocess?.(
      [
        [
          {
            ruleId: 'ejs-templates/test',
            severity: 2,
            message: 'test',
            line,
            column: 1,
            fix: { range: fixRange, text },
          },
        ],
      ],
      filename,
    ) ?? []
  );
}

describe('processor: a fix that does not fit its tag is dropped', () => {
  test.each([
    ['prefer-slurp-multiline on a single-line tag', '<% a(); %>', SENTINEL_PREFER_SLURP_MULTILINE],
    ['slurp-newline on a standalone slurp tag', '<%_ a(); _%>', SENTINEL_SLURP_NEWLINE],
    ['indent on an indented slurp tag', '<%_ a(); _%>', SENTINEL_INDENT],
    ['indent normalize on a code tag', '<% a(); %>', SENTINEL_INDENT_NORMALIZE],
    ['indent normalize on a normalized slurp tag', '<%_ a();\n    b();\n_%>', SENTINEL_INDENT_NORMALIZE],
    ['format on a formatted tag', '<% a(); %>', SENTINEL_FORMAT],
    ['prefer-single-line-tags on a single-line tag', '<% a(); %>', SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES],
    [
      'prefer-single-line-tags on statements without braces',
      '<%\n a();\n b();\n%>',
      SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES,
    ],
    ['output-semi add on a code tag', '<% a(); %>', SENTINEL_OUTPUT_SEMI_ADD],
    ['output-semi remove on an output tag without semicolon', '<%= a %>', SENTINEL_OUTPUT_SEMI_REMOVE],
    ['prefer-output on an output tag', '<%= a %>', SENTINEL_PREFER_OUTPUT],
    ['prefer-output on a tag without condition', '<% a(); %>x<% b(); %>', SENTINEL_PREFER_OUTPUT],
    ['prefer-output on a branch spanning lines', '<% if (a) { %>x\ny<% } %>', SENTINEL_PREFER_OUTPUT],
    ['no-multiline-output on a code tag', '<% a(); %>', SENTINEL_NO_MULTILINE_OUTPUT],
    ['no-comment-empty-line on a code tag', '<% a(); %>', SENTINEL_COMMENT_EMPTY_LINE],
    ['an unknown sentinel', '<% a(); %>', 'UNKNOWN'],
  ])('%s', (_label, ejsText, text) => {
    expect(postprocessFix(ejsText, text)).toEqual([
      { ruleId: 'ejs-templates/test', severity: 2, message: 'test', line: 1, column: 0 },
    ]);
  });

  test('prefer-output on the last tag', () => {
    expect(postprocessFix('<% if (a) { %>x<% } %>', SENTINEL_PREFER_OUTPUT, 1)).toEqual([
      { ruleId: 'ejs-templates/test', severity: 2, message: 'test', line: 1, column: 15 },
    ]);
  });

  test('a JavaScript fix of the marker', () => {
    expect(postprocessFix('<% a(); %>', 'x', 0, [2, 4])).toEqual([
      { ruleId: 'ejs-templates/test', severity: 2, message: 'test', line: 1, column: 0 },
    ]);
  });
});

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
      expect(cfg.files?.flat().every((pattern) => pattern.endsWith('.ejs'))).toBe(true);
    }
  });
  test('enable prefer-encoded rule based on file extension', () => {
    const configs = plugin.configs.customize({});
    expect(configs[1].rules?.['ejs-templates/prefer-encoded']).toEqual(['error', 'always']);
    expect(configs[2].rules?.['ejs-templates/prefer-encoded']).toEqual(['error', 'never']);
  });

  test('customize enables experimental-prefer-slurp-multiline with experimental', () => {
    const [config] = plugin.configs.customize({ experimental: true });
    expect(config.rules?.['ejs-templates/experimental-prefer-slurp-multiline']).toBe('error');
  });

  test('customize turns off the stylistic rules of the blocklist with stylisticBlocklist', () => {
    const [config] = plugin.configs.customize({ stylisticBlocklist: true });
    expect(config.rules?.['@stylistic/eol-last']).toBe('off');
  });

  test('customize turns off prettier/prettier with prettierBlocklist', () => {
    const [config] = plugin.configs.customize({ prettierBlocklist: true });
    expect(config.rules?.['prettier/prettier']).toBe('off');
  });

  test('customize should generate a config with correct rules', () => {
    const configs = plugin.configs.customize({ html: 'never' });
    const config = configs[0];
    expect(config.rules).toMatchInlineSnapshot(`
      {
        "ejs-templates/experimental-prefer-slurp-multiline": "off",
        "ejs-templates/format": "error",
        "ejs-templates/indent": "error",
        "ejs-templates/no-comment-across-tags": "error",
        "ejs-templates/no-comment-empty-line": "error",
        "ejs-templates/no-complex-statements": "error",
        "ejs-templates/no-function-block": "error",
        "ejs-templates/no-global-function-call": [
          "error",
          {
            "allow": [],
          },
        ],
        "ejs-templates/no-multiline-output": "error",
        "ejs-templates/no-stray-close-delimiter": "error",
        "ejs-templates/output-semi": "error",
        "ejs-templates/prefer-encoded": [
          "error",
          "never",
        ],
        "ejs-templates/prefer-output": "error",
        "ejs-templates/prefer-single-line-tags": "error",
        "ejs-templates/prefer-slurping-codeonly": "error",
        "ejs-templates/slurp-newline": "error",
      }
    `);
  });

  test('customize should not override existing ejs rules', () => {
    const configs = plugin.configs.customize(
      { html: 'never' },
      {
        rules: {
          'ejs-templates/format': 'off',
          'ejs-templates/indent': 'off',
          'ejs-templates/no-comment-empty-line': 'off',
          'ejs-templates/no-complex-statements': 'off',
          'ejs-templates/no-function-block': 'off',
          'ejs-templates/no-global-function-call': 'off',
          'ejs-templates/output-semi': 'off',
          'ejs-templates/prefer-encoded': 'off',
          'ejs-templates/prefer-output': 'off',
          'ejs-templates/prefer-single-line-tags': 'off',
          'ejs-templates/prefer-slurping-codeonly': 'off',
          'ejs-templates/slurp-newline': 'off',
        },
      },
    );
    const config = configs.at(-1);
    expect(config?.rules).toMatchInlineSnapshot(`
      {
        "ejs-templates/experimental-prefer-slurp-multiline": "off",
        "ejs-templates/no-comment-across-tags": "error",
        "ejs-templates/no-multiline-output": "error",
        "ejs-templates/no-stray-close-delimiter": "error",
      }
    `);
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
      expect(cfg.files?.flat().every((pattern) => pattern.endsWith('.ejs'))).toBe(true);
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
    const [b] = extractTagBlocks(buildTemplate('<%= name %>').tags);
    expect(b.tagType).toBe('escaped-output');
    expect(b.openDelim).toBe('<%=');
    expect(b.closeDelim).toBe('%>');
  });

  test('single-line <%- %> gets raw-output type', () => {
    const [b] = extractTagBlocks(buildTemplate('<%- name %>').tags);
    expect(b.tagType).toBe('raw-output');
  });

  test('structural <% if (x) { %> gets code type', () => {
    const [b] = extractTagBlocks(buildTemplate('<% if (x) { %>').tags);
    expect(b.tagType).toBe('code');
  });

  test('balanced <% code %> gets code-slurpable type', () => {
    const [b] = extractTagBlocks(buildTemplate('<% doWork(); %>').tags);
    expect(b.tagType).toBe('code-slurpable');
  });

  test('single-line <%_ _%> gets slurp type', () => {
    const [b] = extractTagBlocks(buildTemplate('<%_ if (x) { _%>').tags);
    expect(b.tagType).toBe('slurp');
  });

  test('multiline <%_ _%> gets slurp-multiline type', () => {
    const [b] = extractTagBlocks(buildTemplate('<%_\n  if (x) {\n_%>').tags);
    expect(b.tagType).toBe('slurp-multiline');
  });

  test('multiline <%= %> gets escaped-output-multiline type', () => {
    const [b] = extractTagBlocks(buildTemplate('<%=\n  value\n%>').tags);
    expect(b.tagType).toBe('escaped-output-multiline');
  });

  test('multiline <% %> code tag gets code-multiline type', () => {
    const [b] = extractTagBlocks(buildTemplate('<%\n  if (x) {\n%>').tags);
    expect(b.tagType).toBe('code-multiline');
  });

  // Where the tag is, on a line of its own or after text, is no part of its type: `slurp-newline` reports the
  // diagnostic of the parser.
  test('inline slurp tag gets slurp type', () => {
    const [b] = extractTagBlocks(buildTemplate('text<%_ doWork(); _%>').tags);
    expect(b.tagType).toBe('slurp');
    expect(b.isStandalone).toBe(false);
  });

  test('standalone slurp tag gets slurp type', () => {
    const [b] = extractTagBlocks(buildTemplate('<%_ doWork(); _%>').tags);
    expect(b.tagType).toBe('slurp');
    expect(b.isStandalone).toBe(true);
  });

  test('stores openDelim and closeDelim', () => {
    const [b] = extractTagBlocks(buildTemplate('<%_ code _%>').tags);
    expect(b.openDelim).toBe('<%_');
    expect(b.closeDelim).toBe('_%>');
  });

  test('stores codeContent (with surrounding spaces)', () => {
    const [b] = extractTagBlocks(buildTemplate('<%= name %>').tags);
    expect(b.codeContent).toBe(' name ');
  });

  test('lintCodeContent removes one trailing blank char', () => {
    const [b] = extractTagBlocks(buildTemplate('<%= name   %>').tags);
    expect(b.codeContent).toBe(' name   ');
    expect(b.lintCodeContent).toBe(' name  ');
  });

  test('lintCodeContent removes trailing empty last line', () => {
    const [b] = extractTagBlocks(buildTemplate('<%_ const x = 1;\n_%>').tags);
    expect(b.codeContent).toBe(' const x = 1;\n');
    expect(b.lintCodeContent).toBe(' const x = 1;');
  });

  test('standalone tag has lineIndent equal to whitespace before it', () => {
    const [b] = extractTagBlocks(buildTemplate('  <%_ if (x) { _%>').tags);
    expect(b.lineIndent).toBe('  ');
    expect(b.tagColumn).toBe(2);
  });

  test('inline tag has empty lineIndent', () => {
    const [b] = extractTagBlocks(buildTemplate('Hello <%- name %>!').tags);
    expect(b.lineIndent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Tree-sitter: brace-depth / expectedIndent
// ---------------------------------------------------------------------------

describe('brace-depth tracking (indent foundation)', () => {
  test('block at depth 0 has expectedIndent = ""', () => {
    const [open] = extractTagBlocks(buildTemplate('<%_ if (x) { _%>').tags);
    expect(open.expectedIndent).toBe('');
  });

  test('block inside depth-1 gets expectedIndent = "  "', () => {
    const [, inner] = extractTagBlocks(buildTemplate('<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>').tags);
    expect(inner.expectedIndent).toBe('  ');
  });

  test('closing block at depth 0 after open (lowerBraceDepth = 0)', () => {
    const [, , close] = extractTagBlocks(buildTemplate('<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>').tags);
    expect(close.expectedIndent).toBe('');
  });

  test('nested depth produces 4-space expectedIndent', () => {
    const blocks = extractTagBlocks(
      buildTemplate('<%_ if (a) { _%>\n<%_ if (b) { _%>\n<%_ doWork(); _%>\n<%_ } _%>\n<%_ } _%>').tags,
    );
    expect(blocks[2].expectedIndent).toBe('    '); // depth 2
  });

  test('non-standalone slurp tag has expectedIndent = lineIndent (not changed)', () => {
    const [b] = extractTagBlocks(buildTemplate('Hello <%_ name _%>').tags);
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
    const blocks = extractTagBlocks(buildTemplate('<%- foo %>').tags);
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

// ---------------------------------------------------------------------------
// Slurp marker handling (tree-sitter integration)
// ---------------------------------------------------------------------------

describe('slurp marker parsing', () => {
  test('raw-output tag with identifier does not cause parse error', () => {
    // Regression test: <%- testcontainerClassInitialization _%> used to fail
    // because tree-sitter includes trailing `_` in code node text
    const msgs = lint('<%- testcontainerClassInitialization _%>', {});
    const fatalErrors = msgs.filter((msg) => msg.fatal);
    expect(fatalErrors).toHaveLength(0);
  });

  test('escaped-output tag with slurp close does not cause parse error', () => {
    // <%= expression _%> should not produce "Missing token: _" error
    const msgs = lint('<%= testcontainerClassInitialization _%>', {});
    const fatalErrors = msgs.filter((msg) => msg.fatal);
    expect(fatalErrors).toHaveLength(0);
  });

  test('code tag with slurp open does not cause parse error', () => {
    // <%_ expression %> should be parseable
    const msgs = lint('<%_ testcontainerClassInitialization %>', {});
    const fatalErrors = msgs.filter((msg) => msg.fatal);
    expect(fatalErrors).toHaveLength(0);
  });

  test('code tag with slurp delimiters does not cause parse error', () => {
    // <%_ expression _%> should be parseable
    const msgs = lint('<%_ testcontainerClassInitialization _%>', {});
    const fatalErrors = msgs.filter((msg) => msg.fatal);
    expect(fatalErrors).toHaveLength(0);
  });

  test('multiline raw-output tag with slurp close does not cause parse error', () => {
    const msgs = lint('<%- line1\nline2 _%>', {});
    const fatalErrors = msgs.filter((msg) => msg.fatal);
    expect(fatalErrors).toHaveLength(0);
  });

  test('the absorbed close-delimiter marker is removed from the code', () => {
    const [b] = extractTagBlocks(buildTemplate('<%- identifier _%>').tags);
    expect(b.codeContent).toBe(' identifier ');
    expect(b.lintCodeContent).toBe(' identifier');
  });

  test('the tag keeps its real _%> close delimiter', () => {
    const [b] = extractTagBlocks(buildTemplate('<%- identifier _%>').tags);
    expect(b.openDelim).toBe('<%-');
    expect(b.closeDelim).toBe('_%>');
  });

  test('a trailing underscore that is part of the code is left alone', () => {
    const [b] = extractTagBlocks(buildTemplate('<%- identifier_ %>').tags);
    expect(b.closeDelim).toBe('%>');
    expect(b.codeContent).toBe(' identifier_ ');
  });

  test('an identifier ending in an underscore keeps both it and the slurp close', () => {
    const [b] = extractTagBlocks(buildTemplate('<%- identifier_ _%>').tags);
    expect(b.closeDelim).toBe('_%>');
    expect(b.codeContent).toBe(' identifier_ ');
  });

  // Rules that rebuild a tag from its delimiters must not silently drop the newline-slurping
  // the author asked for. Rewriting the source to strip the `_` instead of correcting the
  // delimiter would turn every one of these into a `%>`.
  const slurpCloseFixCases: [string, string, string, RuleConfigMap][] = [
    ['no-negated-condition', '<%= !c ? a : b _%>', '<%= c ? b : a _%>', { 'no-negated-condition': 'error' }],
    ['format', '<%-   foo   _%>', '<%- foo _%>', { 'ejs-templates/format': 'error' }],
    ['prefer-encoded', '<%- foo _%>', '<%= foo _%>', { 'ejs-templates/prefer-encoded': 'error' }],
    ['output-semi', '<%- foo _%>', '<%- foo; _%>', { 'ejs-templates/output-semi': ['error', 'always'] }],
  ];

  test.each(slurpCloseFixCases)(
    '%s preserves the _%%> close delimiter when fixing',
    (_label, template, expected, rules) => {
      expect(applyFix(template, rules)).toBe(expected);
    },
  );

  test('multiline slurp tags parse without fatal errors', () => {
    const msgs = lint(
      `<%_
      const x = 1;
      const y = 2;
    _%>`,
      {},
    );
    const fatalErrors = msgs.filter((msg) => msg.fatal);
    expect(fatalErrors).toHaveLength(0);
  });

  test('mixed slurp and non-slurp tags all parse correctly', () => {
    const msgs = lint(
      `<%- raw _%>
<%= escaped %>
<%_ code _%>
<% balanced %>`,
      {},
    );
    const fatalErrors = msgs.filter((msg) => msg.fatal);
    expect(fatalErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The synthetic semicolon appended to output tags
//
// An output tag holds an expression, so the processor appends a `;` to make the virtual
// JavaScript a statement. That character is generated, not written by the author, so semicolon
// rules must not see it — and it must be appended consistently, whether or not the tag's
// content spans lines.
// ---------------------------------------------------------------------------

describe('synthetic semicolon in virtual code', () => {
  const multiline = ['<%- a', '  ? `x`', '  : `y` %>'].join('\n');
  const multilineWithSemi = ['<%- a', '  ? `x`', '  : `y`; %>'].join('\n');

  test.each([
    ['a single-line output tag', '<%- foo %>'],
    ['an escaped output tag', '<%= foo %>'],
    ['a multiline output tag', multiline],
  ])('semi:never does not report the synthetic semicolon on %s', (_label, template) => {
    expect(lintWithStylistic(template, { '@stylistic/semi': ['error', 'never'] })).toHaveLength(0);
  });

  test.each([
    ['a single-line output tag', '<%- foo %>'],
    ['a multiline output tag', multiline],
  ])('semi:always is satisfied by the synthetic semicolon on %s', (_label, template) => {
    expect(lintWithStylistic(template, { '@stylistic/semi': ['error', 'always'] })).toHaveLength(0);
  });

  // Before the suffix was appended for multiline tags too, `output-semi` removed the semicolon
  // and `@stylistic/semi` in `always` mode put it straight back, so the two fixed each other
  // forever and ESLint bailed out with ESLintCircularFixesWarning.
  test.each([
    ['a single-line tag', '<%- foo; %>', '<%- foo %>'],
    ['a multiline tag', multilineWithSemi, ['<%- a', '  ? `x`', '  : `y` %>'].join('\n')],
  ])('semi:always and output-semi:never converge on %s', (_label, template, expected) => {
    const rules: RuleConfigMap = {
      '@stylistic/semi': ['error', 'always'],
      'ejs-templates/output-semi': ['error', 'never'],
    };
    expect(applyFixWithStylistic(template, rules)).toBe(expected);
    expect(lintWithStylistic(expected, rules)).toHaveLength(0);
  });

  test('a semicolon the author wrote is still reported by semi:never', () => {
    const msgs = lintWithStylistic('<%- foo; %>', { '@stylistic/semi': ['error', 'never'] });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('@stylistic/semi');
  });

  test('the semicolon is not doubled when the content already ends with one', () => {
    const [block] = extractTagBlocks(buildTemplate('<%- foo; %>').tags);
    try {
      expect(block.virtualBodyInlineSuffix).toBe('');
      expect(block.virtualCode.endsWith(';;')).toBe(false);
    } finally {
      block.javascriptPartialNode?.cleanup();
    }
  });
});

describe('processor preprocess', () => {
  test('reports a template that does not parse at the line and column of its syntax error', () => {
    expect(lint('a\n<%= b')).toEqual([
      {
        ruleId: null,
        fatal: true,
        severity: 2,
        message: "Preprocessing error: Failed to parse EJS template at line 2, column 6: unexpected token ''",
        line: 2,
        column: 6,
      },
    ]);
  });
});
