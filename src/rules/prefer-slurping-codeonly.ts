// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';

/**
 * ESLint rule: prefer `<%_ … _%>` (whitespace-slurping) over `<% … %>`
 * for **code-only** tags (not output tags) whose content has balanced braces
 * and does not open or close a brace block by itself.
 *
 * The rule detects `//@ejs-tag:code-slurpable` marker comments that the EJS
 * processor inserts at the start of every virtual block extracted from a
 * `<% … %>` tag that qualifies for promotion to `<%_ … _%>`.
 */
export const preferSlurpingCodeonly: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Prefer `<%_ … _%>` (whitespace-slurping) over `<% … %>` for code-only tags where safe',
      url: 'https://github.com/mshima/prettier-plugin-templates#prefer-slurping-codeonly',
    },
    messages: {
      preferSlurpingCodeonly: 'Prefer `<%_ … _%>` (whitespace-slurping) over `<% … %>` for code-only tags.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type === 'Line' && comment.value.trim() === '@ejs-tag:code-slurpable') {
            context.report({
              loc: comment.loc!,
              messageId: 'preferSlurpingCodeonly',
              fix(fixer) {
                // Provide a sentinel fix. The processor's postprocess replaces
                // this with the correct range in the original EJS source
                // (replacing the whole `<% … %>` tag with `<%_ … _%>`).
                return fixer.replaceTextRange([comment.range![0], comment.range![1]], '');
              },
            });
          }
        }
      },
    };
  },
};
