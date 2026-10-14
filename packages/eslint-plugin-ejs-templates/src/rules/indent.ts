// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import {
  SENTINEL_INDENT_NORMALIZE,
  SENTINEL_INDENT_NORMALIZE_GREATER_OR_EQUAL,
  conventionSentinel,
  getDiagnosticBlocks,
  getTagBlocks,
  getVirtualCodeMetadata,
} from '../processor.js';
import { isRecord, type VirtualMarkerComment } from '../utils.js';

/**
 * ESLint rule: enforce brace-depth–based indentation on standalone
 * `<%_ … _%>` (whitespace-slurping) EJS tags.
 *
 * This ports the `ejsIndent` option from the original Prettier plugin.
 * ejs-template-parser tracks brace depth across all EJS tags and reports any
 * standalone `<%_ _%>` tag whose actual line-prefix whitespace does not
 * match the expected `brace-depth × 2-space` indentation with its `indent`
 * diagnostic (`validateTemplate()`), whose fix `fixOf()` of the parser gives.  With `normalizeContent`
 * (the default), the rule also reports the `<%_ _%>` tags spanning lines whose
 * content needs re-indenting, which the parser does not report. The line where the right operand of a binary
 * expression starts, apart from its left one, is accepted indented more than the line the expression starts on, by any
 * amount (`binaryOperands: 'greater'`, the default), or as much (`'greaterOrEqual'`), as `@stylistic/indent-binary-ops`
 * asks for some lines: `customize()` sets it when the configurations it is given enable that rule.
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
      indent: 'Incorrect indentation for EJS tag; expected {{expected}}, got {{actual}}.',
      indentContent: 'The lines of an EJS tag spanning lines are not indented with the tag.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          normalizeContent: { type: 'boolean' },
          binaryOperands: { enum: ['greater', 'greaterOrEqual'] },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    /** Blanks as the message tells them: `2 spaces`, `1 tab`, `0 spaces`. */
    const describe = (blanks: string): string => {
      const spaces = blanks.match(/ /gu)?.length ?? 0;
      const tabs = blanks.match(/\t/gu)?.length ?? 0;
      const count = (n: number, unit: string) => `${String(n)} ${unit}${n === 1 ? '' : 's'}`;
      if (tabs === 0) return count(spaces, 'space');
      return spaces === 0 ? count(tabs, 'tab') : `${count(spaces, 'space')} and ${count(tabs, 'tab')}`;
    };
    const option: unknown = context.options[0];
    const normalizeContent = !isRecord(option) || option.normalizeContent !== false;
    const binaryOperands =
      isRecord(option) && option.binaryOperands === 'greaterOrEqual' ? 'greaterOrEqual' : 'greater';

    return {
      Program() {
        const sourceCode = context.sourceCode;
        const reports: { comment: VirtualMarkerComment; data?: Record<string, string> }[] = [];
        // The indentation of the tag, against the one of its depth of blocks.
        for (const { block, comment } of getDiagnosticBlocks(context, 'indent')) {
          reports.push({
            comment,
            data: { expected: describe(block.expectedIndent), actual: describe(block.lineIndent) },
          });
        }
        if (normalizeContent) {
          // Indexed as the blocks of the tags.
          const needsNormalizeByTag = getVirtualCodeMetadata(sourceCode.text)?.needsNormalize[binaryOperands];
          for (const [tagIndex, { comment }] of getTagBlocks(context).entries()) {
            if (needsNormalizeByTag?.[tagIndex] === true) reports.push({ comment });
          }
        }

        for (const { comment, data } of reports) {
          const { range } = comment;
          context.report({
            loc: comment.loc,
            ...(data ? { messageId: 'indent', data } : { messageId: 'indentContent' }),
            fix(fixer) {
              // Sentinel fix — the processor's postprocess translates this
              // to replacing the line-prefix whitespace before the tag.
              return fixer.replaceTextRange(
                [range[0], range[1]],
                normalizeContent
                  ? binaryOperands === 'greater'
                    ? SENTINEL_INDENT_NORMALIZE
                    : SENTINEL_INDENT_NORMALIZE_GREATER_OR_EQUAL
                  : conventionSentinel('indent'),
              );
            },
          });
        }
      },
    };
  },
};
