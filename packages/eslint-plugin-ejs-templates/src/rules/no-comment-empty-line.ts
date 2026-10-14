// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { reportConventions } from '../processor.js';

/**
 * ESLint rule: require EJS comment tags to use `-%>` (trim-newline close).
 *
 * A standalone `<%# comment %>` tag leaves an empty line in the rendered output.
 * Using `<%# comment -%>` suppresses the trailing newline. This rule enforces
 * the `-%>` close delimiter on all standalone comment tags.
 *
 * The tags are the ones ejs-template-parser reports with its `no-comment-empty-line`
 * diagnostic (`validateTemplate()`): standalone comment tags that do not end with `-%>`,
 * for which the processor inserts a `//@ejs-comment-empty-line` marker comment.
 */
export const noCommentEmptyLine: Rule.RuleModule = {
  meta: {
    type: 'layout',
    fixable: 'code',
    docs: {
      description: 'Require EJS comment tags to use `-%>` to avoid leaving empty lines in output',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#no-comment-empty-line',
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
        reportConventions(context, 'no-comment-empty-line', () => 'noCommentEmptyLine');
      },
    };
  },
};
