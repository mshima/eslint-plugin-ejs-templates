// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { getFileBlocks, getMultilineOutputConditionalParts, SENTINEL_NO_MULTILINE_OUTPUT } from '../processor.js';
import { getTagTypeComments } from '../utils.js';

/**
 * ESLint rule: prefer a conditional block over an output tag that renders multiple lines.
 *
 * An output ternary whose branches carry `\n` escapes hides the template's structure inside a
 * string: the markup it produces cannot be seen, indented, or edited as markup.
 *
 * Before:
 *   <%- condition ? 'first\nsecond' : '' %>
 *
 * After:
 *   <% if (condition) { %>first
 *   second<% } %>
 *
 * The branch text is written flush against plain `<% %>` tags rather than laid out inside
 * slurp tags, so the rendered output is byte-for-byte what the output tag produced.
 *
 * This is the counterpart to `prefer-output`, which collapses the opposite case — a wrapper
 * whose content stays on a single line. The two never apply to the same tag: `prefer-output`
 * only produces single-line ternaries, and this rule only reports multiline ones.
 */
export const noMultilineOutput: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Disallow output tags whose conditional renders multiple lines',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#no-multiline-output',
    },
    messages: {
      noMultilineOutput:
        'Avoid rendering multiple lines from an output tag. Use a conditional block (`<%_ if (condition) { _%>`) so the markup stays markup.',
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
          if (commentLine === undefined) {
            continue;
          }

          const block = nonDirectiveSegments.find((segment) => segment.startLine === commentLine)?.block;
          if (!block || !getMultilineOutputConditionalParts(block)) {
            continue;
          }

          // Reported whether or not it can be fixed: `translateFix` withholds the fix for a
          // `<%=` tag whose text needs escaping, where no rewrite preserves the output.
          context.report({
            loc: comment.loc ?? { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            messageId: 'noMultilineOutput',
            fix: (fixer) => {
              const range = comment.range;
              if (!range) {
                return null;
              }
              return fixer.replaceTextRange([range[0], range[1]], SENTINEL_NO_MULTILINE_OUTPUT);
            },
          });
        }
      },
    };
  },
};
