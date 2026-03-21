// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';

/**
 * ESLint rule: collapse multiline EJS tags onto a single line.
 *
 * This ports the `ejsCollapseMultiline` option from the original Prettier
 * plugin.  The processor marks any tag whose raw content contains newlines
 * with a `-multiline` suffix on the tag type (e.g. `slurp-multiline`,
 * `code-multiline`, `escaped-output-multiline`).  This rule detects that
 * suffix and offers an autofix.
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
export const noMultilineTags: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Collapse multiline EJS tags onto a single line (ports ejsCollapseMultiline)',
      url: 'https://github.com/mshima/prettier-plugin-templates#no-multiline-tags',
    },
    messages: {
      noMultilineTags: 'EJS tag content spans multiple lines; collapse to a single line.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type === 'Line' && comment.value.trim().includes('-multiline')) {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'noMultilineTags',
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
