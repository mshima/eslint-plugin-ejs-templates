// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { getFileBlocks, getNegatedOutputConditionalParts, SENTINEL_NO_OUTPUT_NEGATED_TERNARY } from '../processor.js';
import { getTagTypeComments } from '../utils.js';

/**
 * ESLint rule: avoid negated conditions in output ternaries.
 *
 * Detects `<%= !cond ? a : b %>` / `<%- !cond ? a : b %>` and suggests
 * the positive conditional form with swapped branches:
 * `<%= cond ? b : a %>`.
 */
export const noOutputNegatedTernary: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Disallow negated conditional tests in output ternaries',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#no-output-negated-ternary',
    },
    messages: {
      noOutputNegatedTernary:
        'Avoid negated conditional tests in output ternaries. Use a positive condition and swap ternary branches.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program() {
        const tagTypeComments = getTagTypeComments(sourceCode.text);
        const fileBlocks = getFileBlocks(context.filename);
        if (!fileBlocks) {
          return;
        }
        const { nonDirectiveSegments } = fileBlocks;

        for (const { comment, tagType } of tagTypeComments) {
          if (tagType !== 'escaped-output' && tagType !== 'raw-output') {
            continue;
          }

          const commentLine = comment.loc?.start.line;
          if (!commentLine) {
            continue;
          }

          const segment = nonDirectiveSegments.find((s) => s.startLine === commentLine);
          const block = segment?.block;
          if (!block) {
            continue;
          }

          const parts = getNegatedOutputConditionalParts(block);
          if (!parts) {
            continue;
          }

          context.report({
            loc: comment.loc ?? { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            messageId: 'noOutputNegatedTernary',
            fix(fixer) {
              const range = comment.range;
              if (!range) {
                return null;
              }
              return fixer.replaceTextRange([range[0], range[1]], SENTINEL_NO_OUTPUT_NEGATED_TERNARY);
            },
          });
        }
      },
    };
  },
};
