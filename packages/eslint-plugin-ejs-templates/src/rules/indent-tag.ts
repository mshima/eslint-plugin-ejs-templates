// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { conventionSentinel, getDiagnosticBlocks } from '../processor.js';

/**
 * ESLint rule: enforce brace-depth–based indentation on standalone `<%_ … _%>` (whitespace-slurping) EJS tags.
 *
 * This ports the `ejsIndent` option from the original Prettier plugin. ejs-template-parser tracks brace depth across
 * all EJS tags and reports any standalone `<%_ _%>` tag whose actual line-prefix whitespace does not match the
 * expected `brace-depth × 2-space` indentation with its `indent` diagnostic (`validateTemplate()`), whose fix
 * `fixOf()` of the parser gives: the line of the tag and its closing delimiter moved, the lines of a tag spanning lines
 * as written, which `indent-content` indents with the tag.
 *
 * Example:
 * ```ejs
 * <%_ if (generateSpringAuditor) { _%>
 *     <%_ const foo = 1; _%>    ← 4 spaces, but depth is 1 → should be 2
 * <%_ } _%>
 * ```
 * becomes:
 * ```ejs
 * <%_ if (generateSpringAuditor) { _%>
 *   <%_ const foo = 1; _%>
 * <%_ } _%>
 * ```
 */
export const indentTag: Rule.RuleModule = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    docs: {
      description: 'Enforce brace-depth indentation on standalone <%_ _%> tags',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#ejs-templatesindent-tag',
    },
    messages: {
      indent: 'Incorrect indentation for EJS tag; expected {{expected}}, got {{actual}}.',
    },
    schema: [],
  },

  create(context) {
    /** Blanks as the message tells them: `2 spaces`, `1 tab`, `0 spaces`. */
    const describe = (blanks: string): string => {
      const spaces = blanks.match(/ /gu)?.length ?? 0;
      const tabs = blanks.match(/\t/gu)?.length ?? 0;
      const count = (n: number, unit: string) => `${String(n)} ${unit}${n === 1 ? '' : 's'}`;
      if (tabs === 0) return count(spaces, 'space');
      return spaces === 0 ? count(tabs, 'tab') : `${count(spaces, 'space')} and ${count(tabs, 'tab')}`;
    };

    return {
      Program() {
        // The indentation of the tag, against the one of its depth of blocks.
        for (const { block, comment } of getDiagnosticBlocks(context, 'indent')) {
          context.report({
            loc: comment.loc,
            messageId: 'indent',
            data: { expected: describe(block.expectedIndent), actual: describe(block.lineIndent) },
            fix: (fixer) => fixer.replaceTextRange(comment.range, conventionSentinel('indent')),
          });
        }
      },
    };
  },
};
