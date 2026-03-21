// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';

/**
 * ESLint rule: enforce brace-depth–based indentation on standalone
 * `<%_ … _%>` (whitespace-slurping) EJS tags.
 *
 * This ports the `ejsIndent` option from the original Prettier plugin.
 * The processor tracks brace depth across all EJS tags and marks any
 * standalone `<%_ _%>` tag whose actual line-prefix whitespace does not
 * match the expected `brace-depth × 2-space` indentation with the
 * `slurp-needs-indent` tag type.  This rule detects that type and offers
 * an autofix.
 *
 * Example:
 * ```ejs
 * <%_ if (generateSpringAuditor) { _%>
 *     <%_ const foo = 1; _%>    ← 4 spaces, but depth is 1 → should be 2
 * <%_ } _%>
 * ```
 * becomes:
 * ```ejs
 * <%_ if (generateSpringAuditor) { _%>
 *   <%_ const foo = 1; _%>
 * <%_ } _%>
 * ```
 */
export const indent: Rule.RuleModule = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    docs: {
      description: 'Enforce brace-depth indentation on standalone <%_ _%> tags',
      url: 'https://github.com/mshima/prettier-plugin-templates#indent',
    },
    messages: {
      indent: 'Incorrect indentation for EJS tag; expected {{expected}} spaces, got {{actual}} spaces.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type === 'Line' && comment.value.trim() === '@ejs-tag:slurp-needs-indent') {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'indent',
              data: {
                // The exact indent values are not available in the virtual
                // code; use generic placeholders so the message is still
                // meaningful.
                expected: '?',
                actual: '?',
              },
              fix(fixer) {
                // Sentinel fix — the processor's postprocess translates this
                // to replacing the line-prefix whitespace before the tag.
                return fixer.replaceTextRange([range[0], range[1]], '');
              },
            });
          }
        }
      },
    };
  },
};
