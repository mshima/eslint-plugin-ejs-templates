// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';

/**
 * ESLint rule: prefer `<%=` (HTML-escaped output) over `<%-` (raw output).
 *
 * Use this rule when your templates output HTML and you want to ensure values
 * are HTML-encoded to prevent XSS vulnerabilities.  It is the inverse of the
 * `prefer-raw` rule.
 *
 * The rule detects `//@ejs-tag:raw-output` marker comments that the EJS
 * processor inserts at the start of every virtual block extracted from a
 * `<%- … %>` tag.
 */
export const preferEncoded: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Prefer `<%=` (HTML-encoded output) over `<%-` (raw output)',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#prefer-encoded',
    },
    messages: {
      preferEncoded: 'Prefer `<%=` (HTML-encoded output) over `<%-` (raw / unescaped output).',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type === 'Line' && comment.value.trim() === '@ejs-tag:raw-output') {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'preferEncoded',
              fix(fixer) {
                // Provide a sentinel fix (empty string). The processor's postprocess
                // recognises the raw-output block type and replaces `-` with `=`
                // in the `<%-` opening delimiter.
                return fixer.replaceTextRange([range[0], range[1]], '');
              },
            });
          }
        }
      },
    };
  },
};
