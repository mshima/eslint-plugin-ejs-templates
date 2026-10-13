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
 * ESLint rule: disallow a close delimiter (`%>`, `-%>`, `_%>`) in the text of an EJS template, which EJS drops
 * from the output.
 *
 * The `stray-close-delimiter` diagnostics of ejs-template-parser, in the coordinates of the template: the rule
 * requests them, and the processor answers the request with one message each, with two suggestions, writing the
 * delimiter literally (`%%>`) or deleting it. No fix: a stray delimiter is as often a typo as a literal.
 */
export const noStrayCloseDelimiter: Rule.RuleModule = {
  meta: {
    type: 'problem',
    hasSuggestions: true,
    docs: {
      description: 'Disallow close delimiters in the text of EJS templates, which EJS drops',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#no-stray-close-delimiter',
    },
    messages: {
      request: 'Requests the stray close delimiters of the template, which the EJS processor reports.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        requestDiagnostics(context, 'ejs-templates/no-stray-close-delimiter', 'request');
      },
    };
  },
};
