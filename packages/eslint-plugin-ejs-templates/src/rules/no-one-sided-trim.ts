// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import {
  getTagBlocks,
  getVirtualCodeMetadata,
  isOutputTagType,
  SENTINEL_CODE_CLOSE,
  SENTINEL_CODE_OPEN,
  SENTINEL_OUTPUT_CLOSE,
} from '../processor.js';

/** An `include(…)` in the code of a tag: its output ends with a line break, which a `-%>` keeps from doubling. */
const INCLUDE = /\binclude\s*\(/u;

/**
 * ESLint rule: a tag trims on both sides of it or on none. `<%_` slurps the blanks before a tag on its line; `-%>`
 * drops the line break after it, `_%>` the blanks after it and the line break. A tag trimming one side alone:
 *
 * - an output tag (`<%=`, `<%-`) closed by `-%>` or `_%>`, which cannot open with `<%_`: closed by `%>`, the fix
 *   removing from the text what the close removed (`editTemplate()`), the output unchanged, the next line then joining
 *   the line of the tag; not before a `<%%`, which writes without clearing what the next text loses. Two are left
 *   alone: one whose code has an `include(…)`, the output of a partial ending with a line break, which a `-%>` keeps
 *   from doubling; and one ending the template, before its final line break alone, which a `-%>` keeps out of the
 *   output of a partial;
 * - a code tag opened by `<%` and closed by `-%>` or `_%>`: opened by `<%_` when the tag is alone on its line, which
 *   slurps its indentation, the blanks the tag rendered at the start of the next line; reported alone when text is
 *   before it on its line, whose blanks `<%_` would slurp;
 * - a code tag opened by `<%_` and closed by `%>`: closed by `_%>` when the end of its line is after it, which drops
 *   the empty line it rendered; by `-%>` when text is after it, which drops nothing then.
 *
 * Comment tags are left alone: a comment on a line of its own closes with `-%>` (`no-comment-empty-line`).
 */
export const noOneSidedTrim: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Trim on both sides of a tag or on none: `<%_` with `_%>` or `-%>`, `<%` and output tags with `%>`',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#ejs-templatesno-one-sided-trim',
    },
    messages: {
      outputClose:
        'An output tag cannot trim what is before it: close it with `%>` rather than `{{closeDelim}}`, which trims what is after it alone.',
      codeOpen:
        'A code tag opened by `<%` trims what is after it alone with `{{closeDelim}}`: open it with `<%_`, which slurps the blanks before it.',
      codeClose:
        'A code tag opened by `<%_` trims what is before it alone: close it with `_%>` or `-%>`, which trim what is after it.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        // Indexed as the blocks of the tags.
        const endsTemplate = getVirtualCodeMetadata(context.sourceCode.text)?.endsTemplate;
        for (const [index, { block, comment }] of getTagBlocks(context).entries()) {
          const { openDelim, closeDelim } = block;
          const report = (messageId: string, sentinel: string) => {
            context.report({
              loc: comment.loc,
              messageId,
              data: { closeDelim },
              fix: (fixer) => fixer.replaceTextRange(comment.range, sentinel),
            });
          };
          if (isOutputTagType(block.tagType)) {
            if (closeDelim === '%>' || INCLUDE.test(block.codeContent) || endsTemplate?.[index] === true) continue;
            report('outputClose', SENTINEL_OUTPUT_CLOSE);
          } else if (openDelim === '<%' && closeDelim !== '%>') {
            report('codeOpen', SENTINEL_CODE_OPEN);
          } else if (openDelim === '<%_' && closeDelim === '%>') {
            report('codeClose', SENTINEL_CODE_CLOSE);
          }
        }
      },
    };
  },
};
