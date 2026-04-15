// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { getTagTypeFromLine } from '../ejs-parser.js';

/**
 * ESLint rule: enforce a consistent output-tag style.
 *
 * - `'always'` (default): prefer `<%=` (HTML-encoded) over `<%-` (raw).
 *   Flags every `<%- … %>` tag and offers an autofix that changes `-` → `=`.
 *   Use this when templates render HTML and you want XSS-safe defaults.
 *
 * - `'never'`: prefer `<%-` (raw / unescaped) over `<%=` (HTML-encoded).
 *   Flags every `<%= … %>` tag and offers an autofix that changes `=` → `-`.
 *   Use this when output is already trusted or escaped by other means.
 *
 * The rule reads the `//@ejs-tag:raw-output` or `//@ejs-tag:escaped-output`
 * marker comments that the EJS processor injects into each virtual block.
 */
export const preferEncoded: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Prefer `<%=` (HTML-encoded) or `<%-` (raw) output tags consistently',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#prefer-encoded',
    },
    messages: {
      preferEncoded: 'Prefer `<%=` (HTML-encoded output) over `<%-` (raw / unescaped output).',
      preferRaw: 'Prefer `<%-` (raw / unescaped output) over `<%=` (HTML-encoded output).',
    },
    schema: [
      {
        type: 'string',
        enum: ['always', 'never'],
      },
    ],
  },

  create(context) {
    const when = (context.options[0] as 'always' | 'never' | undefined) ?? 'always';

    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type !== 'Line') continue;
          const tagType = getTagTypeFromLine(comment.value);

          if (when === 'always' && tagType === 'raw-output') {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'preferEncoded',
              fix(fixer) {
                // Sentinel fix: the processor replaces `-` with `=` in `<%-`.
                return fixer.replaceTextRange([range[0], range[1]], '');
              },
            });
          } else if (when === 'never' && tagType === 'escaped-output') {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'preferRaw',
              fix(fixer) {
                // Sentinel fix: the processor replaces `=` with `-` in `<%=`.
                return fixer.replaceTextRange([range[0], range[1]], '');
              },
            });
          }
        }
      },
    };
  },
};
