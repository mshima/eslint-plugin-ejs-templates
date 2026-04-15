// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { SENTINEL_SLURP_NEWLINE } from '../processor.js';
import { getTagTypeComments } from '../utils.js';

/**
 * ESLint rule: ensure `<%_ … _%>` tags are on their own line.
 *
 * A whitespace-slurping `<%_ … _%>` tag that appears inline after other
 * content on the same line will not behave as intended — the leading
 * whitespace/newline of that line will not be eaten.  This rule detects
 * such tags and offers an autofix that inserts a newline immediately
 * before the tag.
 *
 * The processor marks such tags with the `slurp-not-standalone` type.
 * Apply this rule **after** `prefer-slurping-codeonly` / `experimental-prefer-slurp-multiline`
 * and **before** `indent` in your ESLint config.
 *
 * ```ejs
 * <!-- ✗ violation: slurp tag is inline after other content -->
 * some text<%_ doWork(); _%>
 *
 * <!-- ✓ fixed: slurp tag on its own line -->
 * some text
 * <%_ doWork(); _%>
 * ```
 */
export const slurpNewline: Rule.RuleModule = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    docs: {
      description: 'Ensure `<%_ … _%>` slurp tags are on their own line',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates#slurp-newline',
    },
    messages: {
      slurpNewline: '`<%_ … _%>` slurp tag must be on its own line; insert a newline before the tag.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode;
        const tagTypeComments = getTagTypeComments(sourceCode.getAllComments());
        for (const { comment, tagType } of tagTypeComments) {
          if (tagType === 'slurp-not-standalone') {
            const { range = [0, 0] } = comment;
            context.report({
              loc: comment.loc ?? { line: 0, column: 0 },
              messageId: 'slurpNewline',
              fix(fixer) {
                // Use a distinct sentinel text so that `translateFix` in the
                // processor can identify this as a slurp-newline fix and insert
                // a newline before the tag in the original EJS source.
                return fixer.replaceTextRange([range[0], range[1]], SENTINEL_SLURP_NEWLINE);
              },
            });
          }
        }
      },
    };
  },
};
