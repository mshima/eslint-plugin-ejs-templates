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
import { Linter } from 'eslint';
import { type Config } from 'eslint/config';
import plugin from '../src/index.js';
import { ejsOutput, type OutputLevel } from './ejs-output.js';
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
  { html: 'never', prettierBlocklist: true, stylisticBlocklist: true, experimental: true },
  js.configs.recommended,
  stylistic.configs.customize({ jsx: false, semi: true }),
  {
    rules: {
      'dot-notation': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-else-return': 'error',
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

/** The JavaScript rules of the configuration, every rule of the plugin off. */
const javascriptRules: Config[] = [
  ...configuration,
  {
    files: ['**/*.ejs'],
    rules: Object.fromEntries(Object.keys(plugin.rules).map((rule) => [`ejs-templates/${rule}`, 'off'])),
  },
];

const RUNS: Run[] = [
  { name: 'format', level: 'exact', config: pluginRules({ 'ejs-templates/format': 'error' }) },
  { name: 'indent', level: 'exact', config: pluginRules({ 'ejs-templates/indent': 'error' }) },
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
  // Moving a slurp tag to a line of its own renders the line break, and the blanks the tag slurped before it.
  { name: 'slurp-newline', level: 'whitespace', config: pluginRules({ 'ejs-templates/slurp-newline': 'error' }) },
  {
    name: 'prefer-slurping-codeonly',
    level: 'whitespace',
    config: pluginRules({ 'ejs-templates/prefer-slurping-codeonly': 'error' }),
  },
  {
    name: 'experimental-prefer-slurp-multiline',
    level: 'whitespace',
    config: pluginRules({ 'ejs-templates/experimental-prefer-slurp-multiline': 'error' }),
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
      'ejs-templates/indent': 'error',
      'ejs-templates/prefer-single-line-tags': 'error',
      'ejs-templates/output-semi': ['error', 'never'],
      'ejs-templates/slurp-newline': 'error',
      'ejs-templates/prefer-slurping-codeonly': 'error',
      'ejs-templates/experimental-prefer-slurp-multiline': 'error',
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
  // output-semi
  '<%= x; %> <%- y %>\n',
  // slurp-newline, prefer-slurping-codeonly, experimental-prefer-slurp-multiline, no-comment-empty-line
  'text <%_ x(); _%>\nmore\n',
  '  <% x(); %>\nmore\n',
  '<%\n  x();\n%>\nmore\n',
  'a\n  <%# a comment %>\nb\n',
  // prefer-encoded
  '<%- x %> <%= y %>\n',
  // prefer-output, no-multiline-output, no-negated-condition
  '<% if (c) { %>a<% } else { %>b<% } %>\n',
  "<%- c ? 'a\\nb' : '' %>\n",
  '<% if (!a) { %>A<% } else { %>B<% } %>\n',
  // javascript rules
  '<% var a = "x" + y; %><%= a %>\n<% const o = { a: a }; %>\n',
];

/** The changes of what EJS compiles the templates to, each one fixed by a run. */
function outputChanges(run: Run, templates: string[], cwd?: string): { template: string; fixed: string }[] {
  const linter = new Linter({ cwd });
  const changes: { template: string; fixed: string }[] = [];
  for (const template of templates) {
    const { output } = linter.verifyAndFix(template, run.config, { filename: 'template.ejs' });
    if (output !== template && ejsOutput(output, run.level) !== ejsOutput(template, run.level)) {
      changes.push({ template, fixed: output });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Autofix: what EJS renders
// ---------------------------------------------------------------------------

describe('autofix: what EJS renders', () => {
  test.each(RUNS)('$name ($level)', (run) => {
    expect(outputChanges(run, TEMPLATES)).toEqual([]);
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
        "configs.customize()": 19,
        "experimental-prefer-slurp-multiline": 2,
        "format": 7,
        "indent": 6,
        "javascript rules": 2,
        "layout rules together": 15,
        "no-comment-empty-line": 1,
        "no-multiline-output": 1,
        "no-negated-condition": 1,
        "output-semi always": 9,
        "output-semi never": 1,
        "prefer-encoded always": 5,
        "prefer-encoded never": 4,
        "prefer-output": 2,
        "prefer-single-line-tags": 3,
        "prefer-slurping-codeonly": 3,
        "slurp-newline": 1,
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
      const changes = outputChanges(run, templates, root).map(({ template, fixed }) => ({
        file: files[templates.indexOf(template)],
        before: ejsOutput(template, run.level),
        after: ejsOutput(fixed, run.level),
      }));
      expect(changes).toEqual([]);
    },
    30 * 60 * 1000,
  );
});
