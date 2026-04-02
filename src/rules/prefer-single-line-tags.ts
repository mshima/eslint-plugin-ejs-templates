// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES, getVirtualCodeMetadata } from '../processor.js';

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
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        const tagComments = comments.filter((c) => c.type === 'Line' && c.value.trim().startsWith('@ejs-tag:'));

        // Provided by the processor from tree-sitter AST analysis (same tag order as markers).
        const metadata = getVirtualCodeMetadata(sourceCode.text);
        const structuralByTag = metadata?.structuralControl;
        const singleLineTrimByTag = metadata?.singleLineTrim;

        for (const comment of comments) {
          if (comment.type !== 'Line' || !comment.value.trim().includes('-multiline')) {
            continue;
          }

          const tagIndex = tagComments.indexOf(comment);
          const hasStructuralInThisBlock = tagIndex !== -1 && structuralByTag?.[tagIndex] === true;
          const fitsSingleLineWhenTrimmed = tagIndex !== -1 && singleLineTrimByTag?.[tagIndex] === true;
          if (!hasStructuralInThisBlock && !fitsSingleLineWhenTrimmed) {
            continue;
          }

          const { range = [0, 0] } = comment;
          context.report({
            loc: comment.loc ?? { line: 0, column: 0 },
            messageId: 'preferSingleLineTags',
            fix(fixer) {
              return fixer.replaceTextRange([range[0], range[1]], SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES);
            },
          });
        }
      },
    };
  },
};
