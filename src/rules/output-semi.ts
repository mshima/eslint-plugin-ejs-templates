// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { SENTINEL_OUTPUT_SEMI_ADD, SENTINEL_OUTPUT_SEMI_REMOVE } from '../processor.js';

/**
 * ESLint rule: enforce or disallow semicolons at the end of output tag content.
 *
 * The virtual code for output tags (`<%= %>`, `<%- %>`) always ends with a
 * synthetic `;` (the `virtualBodyInlineSuffix`).  When the original EJS source
 * already has a trailing semicolon, the virtual code ends with `;;`.  This
 * rule inspects that pattern to determine whether the original tag has a
 * trailing semicolon and enforces the configured style.
 *
 * Options:
 * - `"always"`: require a semicolon at the end of every output tag.
 * - `"never"` (default): disallow semicolons at the end of output tags.
 *
 * Only single-line output tags are checked; multiline variants are ignored.
 */
export const outputSemi: Rule.RuleModule = {
  meta: {
    type: 'layout',
    fixable: 'code',
    docs: {
      description: 'Enforce or disallow trailing semicolons inside output tags (`<%= %>`, `<%- %>`)',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#output-semi',
    },
    messages: {
      missingSemi: 'Output tag content should end with a semicolon.',
      extraSemi: 'Output tag content should not end with a semicolon.',
    },
    schema: [
      {
        enum: ['always', 'never'],
      },
    ],
  },

  create(context) {
    const option: 'always' | 'never' = (context.options[0] as 'always' | 'never' | undefined) ?? 'never';

    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        const text = sourceCode.text;

        for (const comment of comments) {
          if (comment.type !== 'Line') continue;
          const tagType = comment.value.trim();
          if (tagType !== '@ejs-tag:escaped-output' && tagType !== '@ejs-tag:raw-output') continue;

          // The virtual code line after the marker is: <lintCodeContent><virtualBodyInlineSuffix>
          // virtualBodyInlineSuffix is always ';' for single-line output tags.
          // If the original EJS content already ends with ';', lintCodeContent ends with ';'
          // and the virtual line ends with ';;'.
          const [, end] = comment.range ?? [0, 0];
          const afterMarker = text.slice(end + 1); // skip '\n'
          const contentLine = afterMarker.split('\n')[0];
          const hasTrailingSemi = contentLine.trimEnd().endsWith(';;');

          if (option === 'always' && !hasTrailingSemi) {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'missingSemi',
              fix(fixer) {
                return fixer.replaceTextRange([range[0], range[1]], SENTINEL_OUTPUT_SEMI_ADD);
              },
            });
          } else if (option === 'never' && hasTrailingSemi) {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'extraSemi',
              fix(fixer) {
                return fixer.replaceTextRange([range[0], range[1]], SENTINEL_OUTPUT_SEMI_REMOVE);
              },
            });
          }
        }
      },
    };
  },
};
