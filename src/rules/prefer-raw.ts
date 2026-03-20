// Copyright 2024 The prettier-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';

/**
 * ESLint rule: prefer `<%-` (raw / unescaped output) over `<%= `(HTML-escaped
 * output).
 *
 * The rule detects `//@ejs-tag:escaped-output` marker comments that the EJS
 * processor inserts at the start of every virtual block extracted from a
 * `<%= … %>` tag.
 */
export const preferRaw: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Prefer `<%-` (raw output) over `<%=` (HTML-escaped output)',
      url: 'https://github.com/mshima/prettier-plugin-templates',
    },
    messages: {
      preferRaw: 'Prefer `<%-` (raw / unescaped output) over `<%=` (HTML-escaped output).',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type === 'Line' && comment.value.trim() === '@ejs-tag:escaped-output') {
            context.report({
              loc: comment.loc!,
              messageId: 'preferRaw',
              fix(fixer) {
                // Provide a sentinel fix. The processor's postprocess replaces
                // this with the correct range in the original EJS source
                // (changing `=` to `-` in the `<%=` opening delimiter).
                return fixer.replaceTextRange([comment.range![0], comment.range![1]], '');
              },
            });
          }
        }
      },
    };
  },
};
