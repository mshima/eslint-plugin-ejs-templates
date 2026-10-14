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
 * ESLint rule: prefer `<%_ … _%>` (whitespace-slurping) over `<% … %>`
 * for **code-only** tags (not output tags) whose content has balanced braces
 * and does not open or close a brace block by itself.
 *
 * The tags are the ones ejs-template-parser reports with its `prefer-slurping-codeonly`
 * diagnostic (`validateTemplate()`), whose `<% … %>` tag qualifies for promotion to
 * `<%_ … _%>`; the rule reports them on the marker comment of their virtual block.
 */
export const preferSlurpingCodeonly: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Prefer `<%_ … _%>` (whitespace-slurping) over `<% … %>` for code-only tags where safe',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#prefer-slurping-codeonly',
    },
    messages: {
      preferSlurpingCodeonly: 'Prefer `<%_ … _%>` (whitespace-slurping) over `<% … %>` for code-only tags.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        reportConventions(context, 'prefer-slurping-codeonly', () => 'preferSlurpingCodeonly');
      },
    };
  },
};
