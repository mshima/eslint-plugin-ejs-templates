// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { getFileBlocks, isOutputTagType, SENTINEL_OUTPUT_SEMI_ADD, SENTINEL_OUTPUT_SEMI_REMOVE } from '../processor.js';
import { getTagTypeComments } from '../utils.js';

/**
 * ESLint rule: enforce or disallow semicolons at the end of output tag content.
 *
 * The virtual code for output tags (`<%= %>`, `<%- %>`) always ends with a
 * synthetic `;` (the `virtualBodyInlineSuffix`).  When the original EJS source
 * already has a trailing semicolon, the virtual code ends with `;;`.  This
 * rule inspects that pattern to determine whether the original tag has a
 * trailing semicolon and enforces the configured style.
 *
 * Options:
 * - `"always"`: require a semicolon at the end of every output tag.
 * - `"never"` (default): disallow semicolons at the end of output tags.
 *
 * Only single-line output tags are checked; multiline variants are ignored.
 */
export const outputSemi: Rule.RuleModule = {
  meta: {
    type: 'layout',
    fixable: 'code',
    docs: {
      description: 'Enforce or disallow trailing semicolons inside output tags (`<%= %>`, `<%- %>`)',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#output-semi',
    },
    messages: {
      missingSemi: 'Output tag content should end with a semicolon.',
      extraSemi: 'Output tag content should not end with a semicolon.',
    },
    schema: [
      {
        enum: ['always', 'never'],
      },
    ],
  },

  create(context) {
    const rawOption: unknown = context.options[0];
    const option: 'always' | 'never' = rawOption === 'always' ? 'always' : 'never';

    return {
      Program() {
        const sourceCode = context.sourceCode;
        const tagTypeComments = getTagTypeComments(sourceCode.text);
        const fileBlocks = getFileBlocks(context.filename);
        if (!fileBlocks) {
          return;
        }
        const { nonDirectiveSegments } = fileBlocks;

        for (const { comment, tagType } of tagTypeComments) {
          if (!isOutputTagType(tagType)) continue;

          const commentLine = comment.loc?.start.line;
          if (commentLine === undefined) continue;
          const block = nonDirectiveSegments.find((segment) => segment.startLine === commentLine)?.block;
          if (!block) continue;

          // Read the tag's own content rather than the virtual line. The previous check looked
          // for a doubled `;;` on the first virtual line — the tag's semicolon plus the
          // synthetic one the processor appends — which cannot work for a multiline tag: no
          // synthetic semicolon is added for those, and the semicolon is not on the first line.
          const hasTrailingSemi = block.codeContent.trimEnd().endsWith(';');

          if (option === 'always' && !hasTrailingSemi) {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'missingSemi',
              fix(fixer) {
                return fixer.replaceTextRange([range[0], range[1]], SENTINEL_OUTPUT_SEMI_ADD);
              },
            });
          } else if (option === 'never' && hasTrailingSemi) {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'extraSemi',
              fix(fixer) {
                return fixer.replaceTextRange([range[0], range[1]], SENTINEL_OUTPUT_SEMI_REMOVE);
              },
            });
          }
        }
      },
    };
  },
};
