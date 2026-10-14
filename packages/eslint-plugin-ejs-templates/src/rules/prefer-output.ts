// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { getFileBlocks, SENTINEL_PREFER_OUTPUT, SENTINEL_PREFER_OUTPUT_ELSE } from '../processor.js';
import { getTagTypeComments, ifOpening, tokensAre, tokensOf } from '../utils.js';

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
    const sourceCode = context.sourceCode;

    return {
      Program() {
        const tagTypeComments = getTagTypeComments(sourceCode.text);
        const fileBlocks = getFileBlocks(context.filename);

        if (!fileBlocks) {
          throw new Error(`Unexpected missing file blocks for file ${context.filename}`);
        }

        const { nonDirectiveSegments } = fileBlocks;
        if (nonDirectiveSegments.length !== tagTypeComments.length) {
          throw new Error(
            `Unexpected mismatch between tag type comments (${String(tagTypeComments.length)}) and file blocks (${String(nonDirectiveSegments.length)}) for file ${context.filename}`,
          );
        }

        for (let i = 0; i < tagTypeComments.length; i++) {
          const { comment, tagType } = tagTypeComments[i];
          if (tagType !== 'code') continue;

          const firstSegment = nonDirectiveSegments[i];
          const firstBlock = firstSegment.block;

          // `if (…) {`, then `}` or `} else {`: the trees of the tags, which ejs-template-parser parses only when they
          // are read, are read for code written so alone.
          if (!/^\s*if\b/u.test(firstBlock.codeContent) || !/\{\s*$/u.test(firstBlock.codeContent)) continue;
          const firstPartialNode = firstBlock.javascriptPartialNode;
          if (!firstPartialNode || firstPartialNode.multilineOriginal || !ifOpening(tokensOf(firstPartialNode), 0)) {
            continue;
          }

          const nextTagTypeComment = tagTypeComments.at(i + 1);
          if (nextTagTypeComment?.tagType !== 'code') continue;

          const nextBlock = nonDirectiveSegments.at(i + 1)?.block;
          if (nextBlock?.tagType !== 'code') continue;
          if (nextBlock.originalLine !== firstBlock.originalLine || !/^\s*\}/u.test(nextBlock.codeContent)) continue;
          const nextPartialNode = nextBlock.javascriptPartialNode;
          if (!nextPartialNode || nextPartialNode.multilineOriginal) continue;

          // `}`, or `} else {` and the `}` closing it on the line too.
          const nextTokens = tokensOf(nextPartialNode);
          let hasElseClause = false;
          if (!tokensAre(nextTokens, '}')) {
            if (!tokensAre(nextTokens, '}', 'else', '{')) continue;

            const elseCloseBlock = nonDirectiveSegments.at(i + 2)?.block;
            if (
              elseCloseBlock?.originalLine !== firstBlock.originalLine ||
              !/^\s*\}/u.test(elseCloseBlock.codeContent)
            ) {
              continue;
            }
            const elseCloseNode = elseCloseBlock.javascriptPartialNode;
            if (!elseCloseNode || !tokensAre(tokensOf(elseCloseNode), '}')) continue;

            hasElseClause = true;
          }

          context.report({
            loc: comment.loc ?? { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            messageId: 'preferOutput',
            fix: (fixer) => {
              const range = comment.range;
              if (!range) return null;
              return fixer.replaceTextRange(
                [range[0], range[1]],
                hasElseClause ? SENTINEL_PREFER_OUTPUT_ELSE : SENTINEL_PREFER_OUTPUT,
              );
            },
          });
        }
      },
    };
  },
};
