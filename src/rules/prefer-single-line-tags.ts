// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES, getFileBlocks } from '../processor.js';
import { getTagTypeComments } from '../utils.js';

/**
 * ESLint rule: collapse multiline EJS tags onto a single line.
 *
 * The processor marks tags with a `-multiline` suffix in the marker comment
 * (e.g. `//@ejs-tag:code-multiline`). This rule reports those tags and emits
 * a sentinel fix so the processor can translate the fix back to the original
 * EJS source.
 */
export const preferSingleLineTags: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Collapse multiline EJS tags onto a single line (ports ejsCollapseMultiline)',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#prefer-single-line-tags',
    },
    messages: {
      preferSingleLineTags: 'EJS tag content spans multiple lines; collapse to a single line.',
      oneBraceBoundaryPerTag: 'EJS tag holds more than one brace boundary; give each its own tag.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const tagTypeComments = getTagTypeComments(sourceCode.text);
        const fileBlocks = getFileBlocks(context.filename);
        if (!fileBlocks) {
          return;
        }
        const { nonDirectiveSegments } = fileBlocks;

        for (const [index, tagTypeComment] of tagTypeComments.entries()) {
          const { comment, tagType } = tagTypeComment;
          const isMultiline = tagType.includes('-multiline');

          const block = nonDirectiveSegments.at(index)?.block;
          if (!block?.javascriptPartialNode) {
            continue;
          }

          // A single-line tag is only reported when it closes more than one block, which is
          // what makes `<%_ } } _%>` impossible to place at a single indent depth. A tag that
          // closes one block and opens another (`<%_ } else { _%>`) is an ordinary
          // continuation and is left alone — in a partial template, whose enclosing `if` lives
          // in another file, its content parses as two fragments rather than one continuation.
          if (!isMultiline && block.javascriptPartialNode.missingOpenBracesCount <= 1) {
            continue;
          }
          const { hasStructuralBraces, multilineTrimmed } = block.javascriptPartialNode;
          if (!hasStructuralBraces && multilineTrimmed) {
            continue;
          }

          const splitStatements = block.javascriptPartialNode.splitStatements();
          if (splitStatements.length <= 1) {
            continue;
          }

          // A single-line tag is reported too, when it carries more than one brace boundary —
          // `<%_ } } _%>` closes two blocks at once, so neither `indent` nor a reader can place
          // it at a single depth. The fix already puts each boundary in its own tag, which is
          // what this rule does for the multiline case; only the message differs.
          const { range = [0, 0] } = comment;
          context.report({
            loc: comment.loc ?? { line: 0, column: 0 },
            messageId: isMultiline ? 'preferSingleLineTags' : 'oneBraceBoundaryPerTag',
            fix(fixer) {
              return fixer.replaceTextRange([range[0], range[1]], SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES);
            },
          });
        }
      },
    };
  },
};
