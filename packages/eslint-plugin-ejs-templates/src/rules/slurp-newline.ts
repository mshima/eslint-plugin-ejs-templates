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
 * ESLint rule: ensure `<%_ … _%>` tags are on their own line.
 *
 * A whitespace-slurping `<%_ … _%>` tag inline after other content on its line slurps the blanks of the text
 * around it, `<%_` the ones before it and `_%>` the ones after it with the line break that follows, joining the
 * text before and after it (`some text <%_ x _%> more` renders `some textmore`); on a line of its own, it slurps
 * its indentation and its line alone. This rule detects such tags and offers an autofix that inserts a newline
 * immediately before the tag.
 *
 * The tags are the ones ejs-template-parser reports with its `slurp-newline` diagnostic (`validateTemplate()`),
 * whose fix `fixOf()` of the parser gives. Apply this rule **after** `prefer-slurping-codeonly` /
 * `prefer-slurp-multiline` and **before** `indent-tag` in your ESLint config.
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
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#slurp-newline',
    },
    messages: {
      slurpNewline: '`<%_ … _%>` slurp tag must be on its own line; insert a newline before the tag.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        reportConventions(context, 'slurp-newline', () => 'slurpNewline');
      },
    };
  },
};
