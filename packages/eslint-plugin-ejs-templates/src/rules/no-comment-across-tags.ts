// Copyright 2026 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { requestDiagnostics } from '../processor.js';

/**
 * ESLint rule: disallow a block comment opened in an EJS tag and closed in a later one, which comments out the
 * template in between.
 *
 * The `comment-across-tags` diagnostics of ejs-template-parser, at the tag opening the comment: the rule requests
 * them, and the processor answers the request with one message each. No fix: what the comment hides is the author's.
 */
export const noCommentAcrossTags: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow block comments opened in an EJS tag and closed in a later one',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#no-comment-across-tags',
    },
    messages: {
      request: 'Requests the comments across tags of the template, which the EJS processor reports.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        requestDiagnostics(context, 'ejs-templates/no-comment-across-tags', 'request');
      },
    };
  },
};
