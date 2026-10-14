// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { getTagBlocks, getVirtualCodeMetadata, isOutputTagType, SENTINEL_OUTPUT_CLOSE } from '../processor.js';

/** An `include(…)` in the code of a tag: its output ends with a line break, which a `-%>` keeps from doubling. */
const INCLUDE = /\binclude\s*\(/u;

/**
 * ESLint rule: close an output tag (`<%= … %>`, `<%- … %>`) with `%>`.
 *
 * An output tag cannot slurp what is before it (`<%_` opens a code tag alone), so a close trimming what is after it,
 * `-%>` (the line break that follows) or `_%>` (the blanks that follow and the line break), trims one side of the
 * tag alone. Two are left alone: an output tag whose code has an `include(…)`, the output of a partial ending with a
 * line break, which a `-%>` keeps from doubling the line break of the template; and an output tag ending the template,
 * nothing after it but its final line break, which a `-%>` keeps out of the output of the template, a partial.
 *
 * The fix writes `%>`, and removes from the text what the close removed after it, the output unchanged: the line
 * break after a `-%>`, the blanks and the line break after a `_%>`, the next line then joining the line of the tag.
 * Before a `<%%`, which writes without clearing what the next text loses, the tag is reported without a fix.
 *
 * ```ejs
 * <!-- ✗ violation: the -%> removes nothing -->
 * <%- attributes -%>/>
 *
 * <!-- ✓ fixed -->
 * <%- attributes %>/>
 *
 * <!-- ✗ violation: the -%> removes the line break -->
 * <%= name -%>
 * text
 *
 * <!-- ✓ fixed, the line joined -->
 * <%= name %>text
 * ```
 */
export const outputClose: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Close output tags (`<%= %>`, `<%- %>`) with `%>`, an `include(…)` aside',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#ejs-templatesoutput-close',
    },
    messages: {
      outputClose:
        'An output tag cannot trim what is before it: close it with `%>` rather than `{{closeDelim}}`, which trims what is after it alone.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        // Indexed as the blocks of the tags.
        const endsTemplate = getVirtualCodeMetadata(context.sourceCode.text)?.endsTemplate;
        for (const [index, { block, comment }] of getTagBlocks(context).entries()) {
          if (!isOutputTagType(block.tagType) || block.closeDelim === '%>') continue;
          if (INCLUDE.test(block.codeContent) || endsTemplate?.[index] === true) continue;
          context.report({
            loc: comment.loc,
            messageId: 'outputClose',
            data: { closeDelim: block.closeDelim },
            fix: (fixer) => fixer.replaceTextRange(comment.range, SENTINEL_OUTPUT_CLOSE),
          });
        }
      },
    };
  },
};
