// Copyright 2026 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test, expect } from 'vitest';
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { Linter, type Rule, type SourceCode } from 'eslint';
import { type Config } from 'eslint/config';
import plugin from '../src/index.js';
import { conditionalParts, ejsOutput, renderBranches, type OutputLevel } from './ejs-output.js';
import * as fixture1 from './fixtures/1.js';
import * as fixture2 from './fixtures/2.js';
import * as fixture3 from './fixtures/3.js';
import * as fixture4 from './fixtures/4.js';
import * as fixture5 from './fixtures/5.js';

// Each fix keeps what EJS compiles the template to, the function rendering it, as closely as the rule allows
// (`OutputLevel`): the rules of the layout keep it exactly, the ones slurping blank lines keep all but whitespace, and
// the JavaScript rules keep the texts, changing the code of tags alone. Applied together, the rules of the layout keep
// all but whitespace, and every rule of a configuration keeps the template compiling.

type Run = { name: string; level: OutputLevel; config: Config[] };

const pluginRules = (rules: Linter.RulesRecord): Config[] => [
  {
    files: ['**/*.ejs'],
    plugins: { 'ejs-templates': plugin },
    processor: 'ejs-templates/ejs',
    rules,
  },
];

/** A configuration like generator-jhipster's: every rule of the plugin, and fixable JavaScript rules. */
const configuration: Config[] = plugin.configs.customize(
  { html: 'never', prettierBlocklist: true, stylisticBlocklist: true },
  js.configs.recommended,
  stylistic.configs.customize({ jsx: false, semi: true }),
  {
    rules: {
      'dot-notation': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-else-return': 'error',
      'no-negated-condition': 'error',
      'no-useless-return': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-const': 'error',
      'prefer-template': 'error',
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: 'never' }],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
    },
  },
);

/**
 * The JavaScript rules of the configuration, every rule of the plugin off, and `no-negated-condition`, whose fix swaps
 * the texts of branches (a run of its own).
 */
const javascriptRules: Config[] = [
  ...configuration,
  {
    files: ['**/*.ejs'],
    rules: {
      ...Object.fromEntries(Object.keys(plugin.rules).map((rule) => [`ejs-templates/${rule}`, 'off'])),
      'no-negated-condition': 'off',
    },
  },
];

const RUNS: Run[] = [
  { name: 'format', level: 'exact', config: pluginRules({ 'ejs-templates/format': 'error' }) },
  { name: 'indent-tag', level: 'exact', config: pluginRules({ 'ejs-templates/indent-tag': 'error' }) },
  { name: 'indent-content', level: 'exact', config: pluginRules({ 'ejs-templates/indent-content': 'error' }) },
  {
    name: 'prefer-single-line-tags',
    level: 'exact',
    config: pluginRules({ 'ejs-templates/prefer-single-line-tags': 'error' }),
  },
  {
    name: 'output-semi never',
    level: 'exact',
    config: pluginRules({ 'ejs-templates/output-semi': ['error', 'never'] }),
  },
  {
    name: 'output-semi always',
    level: 'exact',
    config: pluginRules({ 'ejs-templates/output-semi': ['error', 'always'] }),
  },
  { name: 'output-close', level: 'exact', config: pluginRules({ 'ejs-templates/output-close': 'error' }) },
  // Moving a slurp tag to a line of its own renders the line break, and the blanks the tag slurped before it.
  { name: 'slurp-newline', level: 'whitespace', config: pluginRules({ 'ejs-templates/slurp-newline': 'error' }) },
  {
    name: 'prefer-slurping-codeonly',
    level: 'whitespace',
    config: pluginRules({ 'ejs-templates/prefer-slurping-codeonly': 'error' }),
  },
  {
    name: 'prefer-slurp-multiline',
    level: 'whitespace',
    config: pluginRules({ 'ejs-templates/prefer-slurp-multiline': 'error' }),
  },
  {
    name: 'no-comment-empty-line',
    level: 'whitespace',
    config: pluginRules({ 'ejs-templates/no-comment-empty-line': 'error' }),
  },
  {
    name: 'prefer-encoded always',
    level: 'escaping',
    config: pluginRules({ 'ejs-templates/prefer-encoded': ['error', 'always'] }),
  },
  {
    name: 'prefer-encoded never',
    level: 'escaping',
    config: pluginRules({ 'ejs-templates/prefer-encoded': ['error', 'never'] }),
  },
  { name: 'prefer-output', level: 'compiles', config: pluginRules({ 'ejs-templates/prefer-output': 'error' }) },
  {
    name: 'no-multiline-output',
    level: 'compiles',
    config: pluginRules({ 'ejs-templates/no-multiline-output': 'error' }),
  },
  {
    name: 'no-negated-condition',
    level: 'compiles',
    config: [...pluginRules({}), { files: ['**/*.ejs'], rules: { 'no-negated-condition': 'error' } }],
  },
  { name: 'javascript rules', level: 'texts', config: javascriptRules },
  // The rules of the layout together: one fix after another on the same tags.
  {
    name: 'layout rules together',
    level: 'whitespace',
    config: pluginRules({
      'ejs-templates/format': 'error',
      'ejs-templates/indent-tag': 'error',
      'ejs-templates/indent-content': 'error',
      'ejs-templates/prefer-single-line-tags': 'error',
      'ejs-templates/output-semi': ['error', 'never'],
      'ejs-templates/slurp-newline': 'error',
      'ejs-templates/prefer-slurping-codeonly': 'error',
      'ejs-templates/prefer-slurp-multiline': 'error',
      'ejs-templates/no-comment-empty-line': 'error',
    }),
  },
  { name: 'configs.customize()', level: 'compiles', config: configuration },
];

/** Templates the fix of each run changes. */
const TEMPLATES: string[] = [
  fixture1.input,
  fixture2.input,
  fixture3.input,
  fixture4.input,
  fixture5.input,
  // format, indent, prefer-single-line-tags
  '<%_if(a){_%>\n      <%_ b() _%>\n<%_ } _%>\n',
  '<%_ if (a) {\n  b();\n  c();\n} _%>\n',
  '<%_ if (a) { _%>\n<%_ if (b) { _%>\nx\n<%_ } } _%>\n',
  // prefer-single-line-tags: the close of a callback whose tag opens it before a statement, a block in between
  '<%_ if (a) {\n  x.forEach((f) => {\n    const u = f;\n_%>\n<%_ if (u) { _%>\nu\n<%_ } _%>\n<%_ });\n} _%>\n',
  '<%_ if (a) { _%>\n    <%_\n      b();\n        c();\n    _%>\n<%_ } _%>\n',
  'a <%= x\n%> b\n',
  // indent: a tag spanning lines with text before it on its line, alone and after the other rules of the layout
  '<%_ if (x) { _%>\nb + <%_ }\n        y();\n_%>\n',
  'a(<%\n  if (b) { %>B(<% } else\n  if (c) { %>C(<% } else\n  if (d) { %>D(<% } %>x\n',
  // an unused eslint-disable removed with the line break its `-%>` drops, and the blanks before it kept rendering
  '<%# eslint-disable no-var -%>\n<% x(); %>\nA\n',
  'a  <%# eslint-disable no-var -%>\n<%_ y(); _%>\nb\n',
  // output-semi
  '<%= x; %> <%- y %>\n',
  // output-close: a close removing nothing, then one removing a line break
  '<%- x -%>/>\n<%= y _%>>\n<%= z -%>\nw\n',
  // slurp-newline, prefer-slurping-codeonly, prefer-slurp-multiline, no-comment-empty-line
  'text <%_ x(); _%>\nmore\n',
  '  <% x(); %>\nmore\n',
  '<%\n  x();\n%>\nmore\n',
  'a\n  <%# a comment %>\nb\n',
  // prefer-encoded
  '<%- x %> <%= y %>\n',
  // prefer-output, no-multiline-output, no-negated-condition
  '<% if (c) { %>a<% } else { %>b<% } %>\n',
  'a <% if (c) { %>b<% } -%>\nX\n',
  "<%- c ? 'a\\nb' : '' %>\n",
  "<%- c ? 'a\\nb' : '' -%>\nX\n",
  '<% if (!a) { %>A<% } else { %>B<% } %>\n',
  // no-negated-condition: the delimiters next to each body, which move with it
  '<% if (!a) { -%>\nA\n<% } else { %>\nB\n<% } %>\n',
  '<% if (!a) { %>A  <%_ } else { %>B  <% } %>\n',
  '<% if (c) { %>C<% } else if (!a) { -%>\nA\n<% } else { %>\nB\n<% } %>\n',
  // javascript rules
  '<% var a = "x" + y; %><%= a %>\n<% const o = { a: a }; %>\n',
];

/** The rules whose fixes rewrite the branches of a condition, each fix rendered on the way (`conditionalParts()`). */
const BRANCH_RULES = new Set([
  'ejs-templates/prefer-output',
  'ejs-templates/no-multiline-output',
  'no-negated-condition',
]);

/** The fixes of branch rules of a template: how many, how many rendered, and those rendering otherwise. */
type Branches = { fixes: number; rendered: number; changes: { before: string; after: string; rendered: string[] }[] };

/** A template fixed by a run, and its fixes of branch rules. */
type FixedTemplate = { template: string; fixed: string; branches: Branches };

/**
 * A linter rendering each fix of a branch rule in each pass of `verifyAndFix()`, which lints the pass with `verify()`:
 * the part the fix rewrites, before and after (`conditionalParts()`), with the blanks before it, which a `<%_`
 * slurps, and the blanks and the line break after it, which a `_%>` or a `-%>` drops.
 */
class BranchLinter extends Linter {
  branches: Branches = { fixes: 0, rendered: 0, changes: [] };

  override verify(
    code: SourceCode | string,
    config: Linter.Config | Linter.Config[],
    options?: string | Linter.LintOptions,
  ): Linter.LintMessage[] {
    const messages =
      typeof options === 'object' ? super.verify(code, config, options) : super.verify(code, config, options);
    if (typeof code === 'string') {
      for (const { fix, ruleId } of messages) {
        if (fix && ruleId && BRANCH_RULES.has(ruleId)) this.render(code, fix);
      }
    }
    return messages;
  }

  private render(pass: string, fix: Rule.Fix): void {
    this.branches.fixes++;
    // A fix in the code of a tag (a ternary) is rendered with the whole tag.
    const inTag = !pass.startsWith('<%', fix.range[0]);
    const start = inTag ? pass.lastIndexOf('<%', fix.range[0]) : fix.range[0];
    const end = inTag ? pass.indexOf('%>', fix.range[1]) + '%>'.length : fix.range[1];
    const text = `${pass.slice(start, fix.range[0])}${fix.text}${pass.slice(fix.range[1], end)}`;
    const parts = conditionalParts(pass.slice(start, end), text);
    if (!parts) return;
    let from = start;
    while (from > 0 && (pass[from - 1] === ' ' || pass[from - 1] === '\t')) from--;
    let to = end;
    while (pass[to] === ' ' || pass[to] === '\t') to++;
    to += pass.startsWith('\r\n', to) ? 2 : pass[to] === '\r' || pass[to] === '\n' ? 1 : 0;
    const [before, after] = parts.map((part) => `${pass.slice(from, start)}${part}${pass.slice(end, to)}`);
    const rendered = [before, after].map((part) => renderBranches(part) ?? 'does not render alone');
    if (rendered[0] === 'does not render alone') return;
    this.branches.rendered++;
    if (rendered[1] !== rendered[0]) this.branches.changes.push({ before, after, rendered });
  }
}

/** The templates fixed by a run, each fix of a branch rule rendered on the way (see `BranchLinter`). */
function fixTemplates(run: Run, templates: string[], cwd?: string): FixedTemplate[] {
  const linter = new BranchLinter({ cwd });
  return templates.map((template) => {
    linter.branches = { fixes: 0, rendered: 0, changes: [] };
    const { output } = linter.verifyAndFix(template, run.config, { filename: 'template.ejs' });
    return { template, fixed: output, branches: linter.branches };
  });
}

/** What the fixes of a run change of what EJS compiles the templates to, at the level of the run. */
const outputChanged = (run: Run, { template, fixed }: FixedTemplate): boolean =>
  fixed !== template && ejsOutput(fixed, run.level) !== ejsOutput(template, run.level);

// ---------------------------------------------------------------------------
// Autofix: what EJS renders
// ---------------------------------------------------------------------------

describe('autofix: what EJS renders', () => {
  test.each(RUNS)('$name ($level)', (run) => {
    const fixed = fixTemplates(run, TEMPLATES);
    expect({
      output: fixed
        .filter((template) => outputChanged(run, template))
        .map(({ template, fixed }) => ({ template, fixed })),
      branches: fixed.flatMap(({ branches }) => branches.changes),
    }).toEqual({ output: [], branches: [] });
  });

  // Every run fixes templates of the list, so that each fix keeps being checked.
  test('every run fixes templates of the list', () => {
    const linter = new Linter();
    const fixedCount = (run: Run): number =>
      TEMPLATES.filter(
        (template) => linter.verifyAndFix(template, run.config, { filename: 'template.ejs' }).output !== template,
      ).length;
    expect(Object.fromEntries(RUNS.map((run) => [run.name, fixedCount(run)]))).toMatchInlineSnapshot(`
      {
        "configs.customize()": 29,
        "format": 10,
        "indent-content": 5,
        "indent-tag": 7,
        "javascript rules": 10,
        "layout rules together": 20,
        "no-comment-empty-line": 3,
        "no-multiline-output": 4,
        "no-negated-condition": 6,
        "output-close": 4,
        "output-semi always": 13,
        "output-semi never": 3,
        "prefer-encoded always": 9,
        "prefer-encoded never": 7,
        "prefer-output": 5,
        "prefer-single-line-tags": 6,
        "prefer-slurp-multiline": 5,
        "prefer-slurping-codeonly": 5,
        "slurp-newline": 4,
      }
    `);
  });

  // Every fix of a branch of the list renders alone, so that none is left unchecked.
  test('renders every fix of a branch of the list', () => {
    const counts = RUNS.flatMap((run) => {
      const branches = fixTemplates(run, TEMPLATES).map((template) => template.branches);
      const fixes = branches.reduce((sum, { fixes }) => sum + fixes, 0);
      const rendered = branches.reduce((sum, { rendered }) => sum + rendered, 0);
      return fixes > 0 ? [[run.name, `${String(rendered)} of ${String(fixes)}`]] : [];
    });
    expect(Object.fromEntries(counts)).toMatchInlineSnapshot(`
      {
        "configs.customize()": "11 of 11",
        "no-multiline-output": "2 of 2",
        "no-negated-condition": "4 of 4",
        "prefer-output": "3 of 3",
      }
    `);
  });
});

describe('ejsOutput', () => {
  test('gives the texts, the code tokens and the outputs EJS compiles a template to', () => {
    expect(ejsOutput('a <%= x %>\n<%_ if (b) { _%>\n  c <%- y; %>\n<%_ } _%>\n<%# d %>', 'exact'))
      .toMatchInlineSnapshot(`
        "compiles
        text "a "
        escaped ["x"]
        text "\\n"
        code ["if","(","b",")","{"]
        text "  c "
        raw ["y"]
        text "\\n"
        code ["}"]"
      `);
  });

  test('joins the code tags in a row, whatever their whitespace and semicolons', () => {
    expect(ejsOutput('<%_ a(); _%>\n<%_ b(); _%>', 'exact')).toBe(ejsOutput('<% a()\n   b() %>', 'exact'));
  });

  test('whitespace: leaves aside the whitespace of the texts', () => {
    expect(ejsOutput('a <%= x %>\n', 'whitespace')).toBe(ejsOutput('a  <%= x %>', 'whitespace'));
    expect(ejsOutput('a <%= x %>\n', 'exact')).toMatchInlineSnapshot(`
      "compiles
      text "a "
      escaped ["x"]
      text "\\n""
    `);
    expect(ejsOutput('a  <%= x %>', 'exact')).toMatchInlineSnapshot(`
      "compiles
      text "a  "
      escaped ["x"]"
    `);
  });

  test('escaping: leaves aside whether an output is escaped', () => {
    expect(ejsOutput('<%= x %>', 'escaping')).toBe(ejsOutput('<%- x %>', 'escaping'));
    expect(ejsOutput('<%= x %>', 'exact')).toMatchInlineSnapshot(`
      "compiles
      escaped ["x"]"
    `);
    expect(ejsOutput('<%- x %>', 'exact')).toMatchInlineSnapshot(`
      "compiles
      raw ["x"]"
    `);
  });

  test('texts: leaves aside the code of tags', () => {
    expect(ejsOutput("<% a('x'); %>b", 'texts')).toBe(ejsOutput("<% a('y'); %>b", 'texts'));
    expect(ejsOutput("<% a('x'); %>b", 'exact')).toMatchInlineSnapshot(`
      "compiles
      code ["a","(","'","x","'",")"]
      text "b""
    `);
    expect(ejsOutput("<% a('y'); %>b", 'exact')).toMatchInlineSnapshot(`
      "compiles
      code ["a","(","'","y","'",")"]
      text "b""
    `);
  });

  test('reads an output of a string literal alone as the text it renders', () => {
    expect(ejsOutput("a<%- '  ' %>b", 'exact')).toBe(ejsOutput('a  b', 'exact'));
    expect(ejsOutput("a<%= '<\\x3E' %>b", 'exact')).toBe(ejsOutput('a&lt;&gt;b', 'exact'));
    expect(ejsOutput("a<%- x %>b<%- 'c' + d %>", 'exact')).toMatchInlineSnapshot(`
      "compiles
      text "a"
      raw ["x"]
      text "b"
      raw ["'","c","'","+","d"]"
    `);
  });

  test('tells whether EJS compiles a template', () => {
    expect(ejsOutput('<% a(); %>', 'compiles')).toBe('compiles');
    expect(ejsOutput('<% a(); %', 'compiles')).toBe('does not compile');
    expect(ejsOutput('<% a(() => { %>x<% }); %>', 'exact')).toMatchInlineSnapshot(`
      "compiles
      code ["a","(","(",")","=>","{"]
      text "x"
      code ["}",")"]"
    `);
    expect(ejsOutput('<% a(() => { %>x<% } %><% ); %>', 'exact')).toMatchInlineSnapshot(`
      "does not compile
      code ["a","(","(",")","=>","{"]
      text "x"
      code ["}",")"]"
    `);
  });
});

describe('conditionalParts', () => {
  test('negates the condition of an if statement whose branches a fix swaps', () => {
    expect(conditionalParts('<% if (!a) { %>A<% } else { %>B<% } %>', '<% if (a) { %>B<% } else { %>A<% } %>')).toEqual(
      ['<% if (!fixedCondition) { %>A<% } else { %>B<% } %>', '<% if (fixedCondition) { %>B<% } else { %>A<% } %>'],
    );
  });

  test('continues an if (false) with an else if link', () => {
    expect(
      conditionalParts(
        '<%_ } else if (a !== b) { _%>A<% } else { %>B<% } %>',
        '<%_ } else if (a === b) { _%>B<% } else { %>A<% } %>',
      ),
    ).toEqual([
      '<% if (false) { %><%_ } else if (!fixedCondition) { _%>A<% } else { %>B<% } %>',
      '<% if (false) { %><%_ } else if (fixedCondition) { _%>B<% } else { %>A<% } %>',
    ]);
  });

  test('writes the same condition in an if statement and the output tag of a ternary it becomes, or replaces', () => {
    expect(conditionalParts('<% if (a.b) { %>x<% } -%>', "<%= (a.b) ? 'x' : '' -%>")).toEqual([
      '<% if (fixedCondition) { %>x<% } -%>',
      "<%= (fixedCondition) ? 'x' : '' -%>",
    ]);
    expect(conditionalParts("<%- c ? 'a\\nb' : '' %>", '<% if (c) { %>a\nb<% } %>')).toEqual([
      "<%- (fixedCondition) ? 'a\\nb' : '' %>",
      '<% if (fixedCondition) { %>a\nb<% } %>',
    ]);
  });

  test('negates the condition of the ternary of an output tag whose branches a fix swaps', () => {
    expect(conditionalParts("<%= (!a) ? 'A' : 'B' -%>", "<%= a ? 'B' : 'A' -%>")).toEqual([
      "<%= (!fixedCondition) ? 'A' : 'B' -%>",
      "<%= (fixedCondition) ? 'B' : 'A' -%>",
    ]);
  });

  test.each([
    ['a tag of code', '<% a(); %>', '<% a() %>'],
    ['a ternary in a tag, not the tag', '!c ? a : b', 'c ? b : a'],
    ['a ternary in the output of a tag', "<%= x + (!c ? 'a' : 'b') %>", "<%= x + (c ? 'b' : 'a') %>"],
  ])('gives nothing for another fix: %s', (_label, before, after) => {
    expect(conditionalParts(before, after)).toBeUndefined();
  });
});

describe('renderBranches', () => {
  test('renders a part with its condition true, then false, every other variable anything', () => {
    expect(
      renderBranches(
        '<% if (fixedCondition) { %>a<%= x.y() %><% } else { %>b<% for (const z of x) { %>z<% } %><% } %>',
      ),
    ).toBe('true: "aanything"\nfalse: "b"');
  });

  test('tells the branch a fix renders otherwise', () => {
    // The fix of no-negated-condition before it moved the delimiters with the bodies: B lost its line break.
    const parts = conditionalParts(
      '<% if (!a) { -%>\nA\n<% } else { %>\nB\n<% } %>\n',
      '<% if (a) { -%>\nB\n<% } else { %>\nA\n<% } %>\n',
    );
    expect(parts?.map((part) => renderBranches(part))).toEqual([
      'true: "\\nB\\n\\n"\nfalse: "A\\n\\n"',
      'true: "B\\n\\n"\nfalse: "\\nA\\n\\n"',
    ]);
  });

  test('gives nothing for a part that does not render alone', () => {
    expect(renderBranches("<% if (fixedCondition) { %><%- include('a') %><% } %>")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The templates of a directory: `EJS_TEMPLATES=<directory> npx vitest run test/ejs-output.test.ts`
// ---------------------------------------------------------------------------

const templatesRoot = process.env.EJS_TEMPLATES;

describe.runIf(templatesRoot)(`autofix: what EJS renders of the templates of ${templatesRoot ?? ''}`, () => {
  const root = path.resolve(templatesRoot ?? '.');
  const files = globSync('**/*.ejs', { cwd: root, exclude: ['**/node_modules/**'] }).sort();
  const templates = files.map((file) => readFileSync(path.join(root, file), 'utf8'));

  test.each(RUNS)(
    '$name ($level)',
    (run) => {
      const fixed = fixTemplates(run, templates, root);
      expect({
        output: fixed.flatMap((template, index) =>
          outputChanged(run, template)
            ? [
                {
                  file: files[index],
                  before: ejsOutput(template.template, run.level),
                  after: ejsOutput(template.fixed, run.level),
                },
              ]
            : [],
        ),
        branches: fixed.flatMap(({ branches }, index) =>
          branches.changes.map((change) => ({ file: files[index], ...change })),
        ),
      }).toEqual({ output: [], branches: [] });
    },
    30 * 60 * 1000,
  );
});
