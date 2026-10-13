// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import {
  SENTINEL_INDENT,
  SENTINEL_INDENT_NORMALIZE,
  getDiagnosticBlocks,
  getVirtualCodeMetadata,
} from '../processor.js';
import { getTagTypeComments } from '../utils.js';
import { isRecord } from '../utils.js';

/**
 * ESLint rule: enforce brace-depth–based indentation on standalone
 * `<%_ … _%>` (whitespace-slurping) EJS tags.
 *
 * This ports the `ejsIndent` option from the original Prettier plugin.
 * ejs-template-parser tracks brace depth across all EJS tags and reports any
 * standalone `<%_ _%>` tag whose actual line-prefix whitespace does not
 * match the expected `brace-depth × 2-space` indentation with its `indent`
 * diagnostic (`validateTemplate()`); the processor marks those tags with the
 * `slurp-needs-indent` tag type, which picks the fix.  With `normalizeContent`
 * (the default), the rule also reports the `<%_ _%>` tags spanning lines whose
 * content needs re-indenting, which the parser does not report.
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
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#indent',
    },
    messages: {
      indent: 'Incorrect indentation for EJS tag; expected {{expected}} spaces, got {{actual}} spaces.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          normalizeContent: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const option: unknown = context.options[0];
    const normalizeContent = !isRecord(option) || option.normalizeContent !== false;

    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = getDiagnosticBlocks(context, 'indent').map(({ comment }) => comment);
        if (normalizeContent) {
          // Indexed as the marker comments: the i-th non-directive block.
          const needsNormalizeByTag = getVirtualCodeMetadata(sourceCode.text)?.needsNormalize;
          for (const [tagIndex, { comment, tagType }] of getTagTypeComments(sourceCode.text).entries()) {
            if (tagType === 'slurp-multiline' && needsNormalizeByTag?.[tagIndex] === true) comments.push(comment);
          }
        }

        for (const comment of comments) {
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
              return fixer.replaceTextRange(
                [range[0], range[1]],
                normalizeContent ? SENTINEL_INDENT_NORMALIZE : SENTINEL_INDENT,
              );
            },
          });
        }
      },
    };
  },
};
