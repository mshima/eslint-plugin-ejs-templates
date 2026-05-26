// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { getFileBlocks, SENTINEL_PREFER_OUTPUT, SENTINEL_PREFER_OUTPUT_ELSE } from '../processor.js';
import { getTagTypeComments } from '../utils.js';

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
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#prefer-output',
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

          const firstPartialNode = firstBlock.javascriptPartialNode;
          if (!firstPartialNode || firstPartialNode.multilineOriginal || firstPartialNode.contentNode.childCount !== 1)
            continue;

          const ifStatement = firstPartialNode.contentNode.child(0);
          if (ifStatement?.type !== 'if_statement' || ifStatement.child(ifStatement.childCount - 1)?.text !== '{')
            continue;

          const nextTagTypeComment = tagTypeComments.at(i + 1);
          if (nextTagTypeComment?.tagType !== 'code') continue;

          const nextBlock = nonDirectiveSegments.at(i + 1)?.block;
          if (nextBlock?.tagType !== 'code') continue;
          if (nextBlock.originalLine !== firstBlock.originalLine) continue;
          const nextPartialNode = nextBlock.javascriptPartialNode;
          if (!nextPartialNode || nextPartialNode.multilineOriginal || nextPartialNode.contentNode.childCount !== 1) {
            continue;
          }

          const errorNode = nextPartialNode.contentNode.child(0);
          if (errorNode?.type !== 'ERROR' || errorNode.child(0)?.type !== '}') continue;

          let hasElseClause = false;
          if (errorNode.childCount > 1) {
            // Treat else clauses
            if (errorNode.child(1)?.type !== 'else' || errorNode.child(2)?.type !== '{') continue;

            const elseCloseBlock = nonDirectiveSegments.at(i + 2)?.block;
            if (elseCloseBlock?.originalLine !== firstBlock.originalLine) continue;
            const elseCloseErrorNode = elseCloseBlock.javascriptPartialNode?.contentNode.child(0);
            if (elseCloseErrorNode?.type !== 'ERROR' || elseCloseErrorNode.child(0)?.type !== '}') continue;

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
