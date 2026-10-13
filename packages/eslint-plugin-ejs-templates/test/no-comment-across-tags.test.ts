// Copyright 2026 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { ESLint } from 'eslint';
import { lint, makeConfig, makeLinter } from './helpers.js';

const rules = { 'ejs-templates/no-comment-across-tags': 'error' } as const;

const message = 'A comment opened in this tag ends in a later one: what is in between is commented out';

// ---------------------------------------------------------------------------
// Rule: no-comment-across-tags
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-comment-across-tags', () => {
  test('reports a comment across tags at its first tag', () => {
    expect(lint('<%_ /* if (x) { _%>\na\n<%_ } */ _%>\n', rules)).toEqual([
      {
        ruleId: 'ejs-templates/no-comment-across-tags',
        severity: 2,
        message,
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 20,
      },
    ]);
  });

  test('ends the message at the end of a tag spanning lines', () => {
    expect(lint('<%_ /* if (x) {\n  y(); _%>\na\n<%_ } */ _%>\n', rules)).toEqual([
      {
        ruleId: 'ejs-templates/no-comment-across-tags',
        severity: 2,
        message,
        line: 1,
        column: 1,
        endLine: 2,
        endColumn: 11,
      },
    ]);
  });

  test.each([
    ['a comment within one tag', '<%_ /* x */ y(); _%>\na\n'],
    ['an EJS comment', '<%# /* x %>\na\n<%_ y(); _%>\n'],
  ])('does not report %s', (_label, template) => {
    expect(lint(template, rules)).toEqual([]);
  });

  test('reports with the severity of the configuration', () => {
    expect(
      lint('<%_ /* if (x) { _%>\na\n<%_ } */ _%>\n', { 'ejs-templates/no-comment-across-tags': 'warn' }).map(
        (msg) => msg.severity,
      ),
    ).toEqual([1]);
  });

  test('reports nothing when off', () => {
    expect(lint('<%_ /* if (x) { _%>\na\n<%_ } */ _%>\n', { 'ejs-templates/no-comment-across-tags': 'off' })).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// Directive comments: no-comment-across-tags
// ---------------------------------------------------------------------------

describe('directives: no-comment-across-tags', () => {
  const config = [...makeConfig(rules), { linterOptions: { reportUnusedDisableDirectives: 'error' as const } }];
  const directive = '<%# eslint-disable ejs-templates/no-comment-across-tags %>\n';

  test('a block eslint-disable of the template suppresses its messages', async () => {
    const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config });
    const [result] = await eslint.lintText(`${directive}<%_ /* if (x) { _%>\na\n<%_ } */ _%>\n`, {
      filePath: 'template.ejs',
    });
    expect(result.messages).toEqual([]);
    expect(
      result.suppressedMessages.map(({ ruleId, line, column, suppressions }) => [ruleId, line, column, suppressions]),
    ).toEqual([['ejs-templates/no-comment-across-tags', 2, 1, [{ kind: 'directive', justification: '' }]]]);
  });

  test('the directive of a template without the problem is reported unused', () => {
    expect(
      makeLinter()
        .verify(`${directive}<%_ y(); _%>\n`, config, { filename: 'template.ejs' })
        .map(({ ruleId, line, message }) => [ruleId, line, message]),
    ).toEqual([
      [
        null,
        1,
        "Unused eslint-disable directive (no problems were reported from 'ejs-templates/no-comment-across-tags').",
      ],
    ]);
  });
});
