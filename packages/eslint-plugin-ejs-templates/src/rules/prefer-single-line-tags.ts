// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Rule } from 'eslint';
import { SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES, getDiagnosticBlocks } from '../processor.js';

/**
 * ESLint rule: collapse multiline EJS tags onto a single line.
 *
 * The tags are the ones ejs-template-parser reports with its `prefer-single-line-tags`
 * diagnostic (`validateTemplate()`): a tag of several statements opening or closing blocks
 * over several lines, or a single-line tag closing more than one block. This rule reports
 * them on the marker comment of their virtual block and emits a sentinel fix so the
 * processor can translate the fix back to the original EJS source.
 */
export const preferSingleLineTags: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description: 'Collapse multiline EJS tags onto a single line (ports ejsCollapseMultiline)',
      url: 'https://github.com/mshima/eslint-plugin-ejs-templates/blob/main/packages/eslint-plugin-ejs-templates/README.md#prefer-single-line-tags',
    },
    messages: {
      preferSingleLineTags: 'EJS tag content spans multiple lines; collapse to a single line.',
      oneBraceBoundaryPerTag: 'EJS tag holds more than one brace boundary; give each its own tag.',
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        for (const { block, comment } of getDiagnosticBlocks(context, 'prefer-single-line-tags')) {
          // A single-line tag is reported when it carries more than one brace boundary —
          // `<%_ } } _%>` closes two blocks at once, so neither `indent` nor a reader can place
          // it at a single depth. The fix puts each boundary in its own tag, as it does for the
          // multiline case; only the message differs.
          const isMultiline = block.tagType.includes('-multiline');
          const { range = [0, 0] } = comment;
          context.report({
            loc: comment.loc ?? { line: 0, column: 0 },
            messageId: isMultiline ? 'preferSingleLineTags' : 'oneBraceBoundaryPerTag',
            fix(fixer) {
              return fixer.replaceTextRange([range[0], range[1]], SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES);
            },
          });
        }
      },
    };
  },
};
