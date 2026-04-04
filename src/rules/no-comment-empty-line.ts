// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { SENTINEL_COMMENT_EMPTY_LINE } from '../processor.js';

/**
 * ESLint rule: require EJS comment tags to use `-%>` (trim-newline close).
 *
 * A standalone `<%# comment %>` tag leaves an empty line in the rendered output.
 * Using `<%# comment -%>` suppresses the trailing newline. This rule enforces
 * the `-%>` close delimiter on all standalone comment tags.
 *
 * The rule detects `//@ejs-comment-empty-line` marker comments that the EJS
 * processor inserts for standalone comment tags that do not end with `-%>`.
 */
export const noCommentEmptyLine: Rule.RuleModule = {
  meta: {
    type: 'layout',
    fixable: 'code',
    docs: {
      description: 'Require EJS comment tags to use `-%>` to avoid leaving empty lines in output',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#no-comment-empty-line',
    },
    messages: {
      noCommentEmptyLine:
        'EJS comment tag should use `-%>` (trim-newline close) to avoid leaving an empty line in the rendered output.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const comments = sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type === 'Line' && comment.value.trim() === '@ejs-comment-empty-line') {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'noCommentEmptyLine',
              fix(fixer) {
                return fixer.replaceTextRange([range[0], range[1]], SENTINEL_COMMENT_EMPTY_LINE);
              },
            });
          }
        }
      },
    };
  },
};
