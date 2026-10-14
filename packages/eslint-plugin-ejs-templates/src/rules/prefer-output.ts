// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { getTagBlocks, SENTINEL_PREFER_OUTPUT, SENTINEL_PREFER_OUTPUT_ELSE } from '../processor.js';
import { ifOpening, tokensAre, tokensOf } from '../utils.js';

/**
 * ESLint rule: suggest converting conditional output patterns to ternary expressions.
 *
 * Detects when an if statement opens with an empty body (e.g., `<% if (foo) { %>`)
 * and suggests converting the pattern to a ternary output tag:
 *
 * Before:
 *   <% if (foo) { %>output<% } %>
 *
 * After:
 *   <%- foo ? 'output' : '' %>
 *
 * This keeps templates more concise and readable by combining conditional logic
 * with output into a single expression.
 */
export const preferOutput: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Suggest converting if statements that wrap output to ternary output expressions',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#prefer-output',
    },
    messages: {
      preferOutput:
        "Consider converting this if statement to a ternary output expression. Instead of `<% if (condition) { %>content<% } %>`, use `<%= condition ? 'content' : '' %>`.",
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const blocks = getTagBlocks(context);
        for (const [i, { block: firstBlock, comment }] of blocks.entries()) {
          if (firstBlock.tagType !== 'code') continue;

          // `if (…) {`, then `}` or `} else {`: the trees of the tags, which ejs-template-parser parses only when they
          // are read, are read for code written so alone.
          if (!/^\s*if\b/u.test(firstBlock.codeContent) || !/\{\s*$/u.test(firstBlock.codeContent)) continue;
          if (!ifOpening(tokensOf(firstBlock.javascriptPartialNode), 0)) continue;

          const nextBlock = blocks.at(i + 1)?.block;
          if (nextBlock?.tagType !== 'code') continue;
          if (nextBlock.originalLine !== firstBlock.originalLine || !/^\s*\}/u.test(nextBlock.codeContent)) continue;
          const nextPartialNode = nextBlock.javascriptPartialNode;

          // `}`, or `} else {` and the `}` closing it on the line too.
          const nextTokens = tokensOf(nextPartialNode);
          let hasElseClause = false;
          if (!tokensAre(nextTokens, '}')) {
            if (!tokensAre(nextTokens, '}', 'else', '{')) continue;

            const elseCloseBlock = blocks.at(i + 2)?.block;
            if (
              elseCloseBlock?.originalLine !== firstBlock.originalLine ||
              !/^\s*\}/u.test(elseCloseBlock.codeContent)
            ) {
              continue;
            }
            if (!tokensAre(tokensOf(elseCloseBlock.javascriptPartialNode), '}')) continue;

            hasElseClause = true;
          }

          context.report({
            loc: comment.loc,
            messageId: 'preferOutput',
            fix: (fixer) =>
              fixer.replaceTextRange(
                comment.range,
                hasElseClause ? SENTINEL_PREFER_OUTPUT_ELSE : SENTINEL_PREFER_OUTPUT,
              ),
          });
        }
      },
    };
  },
};
