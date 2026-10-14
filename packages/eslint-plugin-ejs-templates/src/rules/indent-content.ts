// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import {
  SENTINEL_INDENT_CONTENT,
  SENTINEL_INDENT_CONTENT_GREATER_OR_EQUAL,
  getTagBlocks,
  getVirtualCodeMetadata,
} from '../processor.js';
import { isRecord } from '../utils.js';

/**
 * ESLint rule: indent the lines of a standalone `<%_ … _%>` tag spanning lines with the tag, each at the depth of its
 * own blocks, wherever the tag is: `indent-tag` places the tag. The parser does not diagnose it; the fix is the one of
 * the parser's `indent` convention with `normalizeContent`, the tag left where it is (`indentTag: false`).
 *
 * The line where the right operand of a binary expression starts, apart from its left one, is accepted indented more
 * than the line the expression starts on, by any amount (`binaryOperands: 'greater'`, the default), or as much
 * (`'greaterOrEqual'`), as `@stylistic/indent-binary-ops` asks for some lines: `customize()` sets it when the
 * configurations it is given enable that rule.
 *
 * Example:
 * ```ejs
 * <%_ items.forEach((item) => {
 * show(item);
 * });
 * _%>
 * ```
 * becomes:
 * ```ejs
 * <%_ items.forEach((item) => {
 *       show(item);
 *     });
 * _%>
 * ```
 */
export const indentContent: Rule.RuleModule = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    docs: {
      description: 'Indent the lines of a standalone <%_ _%> tag spanning lines with the tag',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#ejs-templatesindent-content',
    },
    messages: {
      indentContent: 'The lines of an EJS tag spanning lines are not indented with the tag.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          binaryOperands: { enum: ['greater', 'greaterOrEqual'] },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const option: unknown = context.options[0];
    const binaryOperands =
      isRecord(option) && option.binaryOperands === 'greaterOrEqual' ? 'greaterOrEqual' : 'greater';

    return {
      Program() {
        // Indexed as the blocks of the tags.
        const needsIndent = getVirtualCodeMetadata(context.sourceCode.text)?.needsNormalize[binaryOperands];
        for (const [tagIndex, { comment }] of getTagBlocks(context).entries()) {
          if (needsIndent?.[tagIndex] !== true) continue;
          context.report({
            loc: comment.loc,
            messageId: 'indentContent',
            fix: (fixer) =>
              fixer.replaceTextRange(
                comment.range,
                binaryOperands === 'greater' ? SENTINEL_INDENT_CONTENT : SENTINEL_INDENT_CONTENT_GREATER_OR_EQUAL,
              ),
          });
        }
      },
    };
  },
};
