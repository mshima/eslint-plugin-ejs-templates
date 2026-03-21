// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';

/**
 * ESLint rule: collapse multiline `<%_` EJS tags onto a single line.
 *
 * The processor marks any slurp tag (`<%_ … _%>`) whose raw content contains
 * newlines with the `slurp-multiline` tag type.  This rule detects that type
 * and offers an autofix.  Only `<%_`-style (slurp) tags are targeted;
 * multiline `<% %>`, `<%= %>`, and `<%- %>` tags are left unchanged.
 *
 * All non-empty content lines are joined into a single line.  Lines that
 * start with `.` (method / property chaining) are joined without a leading
 * space to preserve the original intent:
 *
 * ```ejs
 * <%_
 *   if (generateSpringAuditor) {
 * _%>
 * ```
 * → `<%_ if (generateSpringAuditor) { _%>`
 *
 * ```ejs
 * <%_
 *   const notSortableFields = 'foo.bar'
 *     .split();
 * _%>
 * ```
 * → `<%_ const notSortableFields = 'foo.bar'.split(); _%>`
 */
export const preferSingleLineSlurp: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Collapse multiline <%_ EJS tags onto a single line',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#prefer-single-line-slurp',
    },
    messages: {
      preferSingleLineSlurp: 'Slurp tag (<%_) content spans multiple lines; collapse to a single line.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type === 'Line' && comment.value.trim() === '@ejs-tag:slurp-multiline') {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'preferSingleLineSlurp',
              fix(fixer) {
                // Sentinel fix — the processor's postprocess translates this
                // to a replacement of the entire original EJS tag.
                return fixer.replaceTextRange([range[0], range[1]], '');
              },
            });
          }
        }
      },
    };
  },
};
