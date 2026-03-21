// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { SENTINEL_PREFER_SLURP_MULTILINE } from '../processor.js';

/**
 * ESLint rule: convert multiline `<% … %>` tags to `<%_ … _%>`.
 *
 * A `<% … %>` tag that spans multiple lines (i.e. its content contains
 * newlines) should use the whitespace-slurping form `<%_ … _%>` so that
 * the surrounding whitespace / newlines are cleaned up when the tag is
 * later collapsed by `no-multiline-tags`.
 *
 * The processor marks such tags with `code-multiline` or
 * `code-slurpable-multiline` tag types.  This rule detects those marker
 * comments and provides an autofix that changes the delimiters.
 *
 * Note: apply this rule **before** `no-multiline-tags` in your config so
 * that multiline `<% %>` tags get their delimiters changed first.
 *
 * ```ejs
 * <!-- ✗ violation -->
 * <%
 *   if (condition) {
 * %>
 *
 * <!-- ✓ fixed -->
 * <%_
 *   if (condition) {
 * _%>
 * ```
 */
export const preferSlurpMultiline: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Prefer `<%_ … _%>` over `<% … %>` for multiline code tags',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#experimental-prefer-slurp-multiline',
    },
    messages: {
      preferSlurpMultiline: 'Multiline `<% … %>` tag should use whitespace-slurping `<%_ … _%>` delimiters.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          if (
            comment.type === 'Line' &&
            (comment.value.trim() === '@ejs-tag:code-multiline' ||
              comment.value.trim() === '@ejs-tag:code-slurpable-multiline')
          ) {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'preferSlurpMultiline',
              fix(fixer) {
                // Use a distinct sentinel text so that `translateFix` in the
                // processor can tell this fix apart from the generic `''`
                // sentinel used by `no-multiline-tags` (which fires on the
                // same `code-multiline` / `code-slurpable-multiline` types).
                return fixer.replaceTextRange([range[0], range[1]], SENTINEL_PREFER_SLURP_MULTILINE);
              },
            });
          }
        }
      },
    };
  },
};
