// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import {
  EJS_CLOSING_DELIMS,
  EJS_OPENING_DELIMS,
  type EjsClosingDelimiter,
  type EjsOpeningDelimiter,
  type EjsSyntaxNode,
  getCommentCloseDelimiter,
  hasAbsorbedSlurpClose,
} from './ejs-parser.js';
import { parseJavaScriptPartial, type RelativeJavascriptNode } from './javascript-parser.js';

/** What an EJS tag is, by its opening delimiter: `<%#`, `<%=`, `<%-`, or any other (`<%`, `<%_`). */
export type EjsTagType = 'comment' | 'escaped-output' | 'raw-output' | 'code';

type EjsTagBase = {
  kind: 'tag';
  /** The tree-sitter node of the tag, valid while its tree is not freed. */
  node: EjsSyntaxNode;
  /** Character offset of the opening delimiter in the template. */
  offset: number;
  /** Length of the whole tag: opening delimiter, code and closing delimiter. */
  length: number;
  /** 1-based line of the opening delimiter. */
  line: number;
  /** 0-based column of the opening delimiter. */
  column: number;
  /** 1-based line where the code starts. */
  codeLine: number;
  /** 0-based column where the code starts. */
  codeColumn: number;
  openDelim: EjsOpeningDelimiter;
  closeDelim: EjsClosingDelimiter;
  /** Everything between the delimiters: the JavaScript of the tag, or the text of a comment. */
  code: string;
  /** The text before the tag on its line. */
  linePrefix: string;
  /** Whether only whitespace precedes the tag on its line. */
  isStandalone: boolean;
  /**
   * Braces the tags before this one left open. Negative in a partial template, whose tags close blocks
   * another template opens.
   */
  depthBefore: number;
  /** Braces left open after this tag. */
  depthAfter: number;
};

export type EjsCommentTag = EjsTagBase & { type: 'comment' };

/**
 * How a code or output tag renders the blanks around it, as eslint-plugin-ejs-templates classifies it: an output
 * tag by its delimiter; `slurp`, a tag opened by `<%_` or closed by `_%>`, which slurps the blanks before it and the
 * line break after it; `code-slurpable`, a `<% %>` tag whose code opens and closes no block, which `<%_ _%>` slurps
 * as safely; `code`, any other code tag: one opening or closing a block, or closed by `-%>`.
 */
export type EjsTagShape = 'escaped-output' | 'raw-output' | 'slurp' | 'code' | 'code-slurpable';

export type EjsCodeTag = EjsTagBase & {
  type: Exclude<EjsTagType, 'comment'>;
  shape: EjsTagShape;
  /**
   * The indentation of the tag: for a slurp tag on a line of its own, two blanks for each block it is in (the
   * depth the line of a `} else {` is at); for any other tag, the one it has (none when text precedes it).
   */
  expectedIndent: string;
  /**
   * The code the JavaScript parser reads: `code` without the line break (and the indentation after it), or
   * the one blank, separating it from the closing delimiter, which changes nothing of its JavaScript.
   */
  parsedCode: string;
  /**
   * `parsedCode` parsed as JavaScript inside the blocks the tags before it left open, which tells the
   * braces it opens and closes. Its trees live in WASM memory: free them with `javascript.cleanup()`.
   */
  javascript: RelativeJavascriptNode;
};

export type EjsTag = EjsCommentTag | EjsCodeTag;

const TAG_NODE_TYPES = ['comment_directive', 'code', 'directive', 'output_directive'];

/** The indentation of a block level. */
const INDENT_UNIT = '  ';

const shapeOf = (openDelim: EjsOpeningDelimiter, closeDelim: EjsClosingDelimiter, balanced: boolean): EjsTagShape => {
  if (openDelim === '<%=') return 'escaped-output';
  if (openDelim === '<%-') return 'raw-output';
  if (openDelim === '<%_' || closeDelim === '_%>') return 'slurp';
  if (closeDelim === '-%>') return 'code';
  return balanced ? 'code-slurpable' : 'code';
};

const OUTPUT_TAG_TYPES: Partial<Record<EjsOpeningDelimiter, EjsCodeTag['type']>> = {
  '<%=': 'escaped-output',
  '<%-': 'raw-output',
};

/** Whether a top-level node of the template is a tag (the others are its text). */
export const isTagNode = (node: EjsSyntaxNode): boolean => TAG_NODE_TYPES.includes(node.type);

function normalizeParsedCode(code: string): string {
  // Remove a single trailing empty line (optionally with indentation).
  if (/(?:\r?\n)[ \t]*$/u.test(code)) {
    return code.replace(/(?:\r?\n)[ \t]*$/u, '');
  }

  // Otherwise remove a single trailing blank character.
  if (/[ \t]$/u.test(code)) {
    return code.slice(0, -1);
  }

  return code;
}

/**
 * The tags of a template, from the nodes {@link getEjsNodes} gives, each code tag parsed as JavaScript
 * in the context of the blocks still open before it, so that a `<% } %>` parses as a close rather than an
 * error. Free the trees of the code tags with `tag.javascript.cleanup()`.
 */
export function getEjsTags(nodes: readonly EjsSyntaxNode[]): EjsTag[] {
  const tags: EjsTag[] = [];

  let braceDepth = 0;
  /**
   * Still-open brace context preceding the current tag, as a stack rather than a
   * flat accumulating string.
   *
   * Only unbalanced (error) content is recorded here, so every entry exists purely
   * to give tree-sitter the enclosing block structure a later tag needs — e.g. the
   * `if (a) {` that makes a subsequent `<% } %>` parse as a close rather than an
   * error. Once a block closes, its context can no longer affect any following tag,
   * so the entry is dropped.
   *
   * Each entry remembers the brace depth it was pushed at; a tag that nets a close
   * prunes every entry at or above the new depth. Keeping this pruned bounds the
   * context by nesting depth instead of template length, which is what keeps
   * `getEjsTags` linear — an ever-growing string made tag N re-parse all
   * preceding tags, giving O(n²) bytes through the parser.
   */
  const openContext: { depth: number; code: string; isContinuation: boolean }[] = [];
  let incrementalCode = '';

  for (const node of nodes) {
    // Skip content nodes.
    if (!isTagNode(node)) continue;

    const line = node.startPosition.row + 1;
    const column = node.startPosition.column;
    const linePrefix = node.linePrefix;
    const base = {
      kind: 'tag' as const,
      node,
      offset: node.startIndex,
      length: node.endIndex - node.startIndex,
      line,
      column,
      linePrefix,
      // A tag is "standalone" when everything before it on the same line is
      // whitespace (i.e. `column` characters of pure whitespace).
      isStandalone: /^\s*$/u.test(linePrefix),
    };

    if (node.type === 'comment_directive') {
      const closeDelim = getCommentCloseDelimiter(node.text);
      tags.push({
        ...base,
        type: 'comment',
        codeLine: line,
        codeColumn: column + '<%#'.length,
        openDelim: '<%#',
        closeDelim,
        code: node.text.slice('<%#'.length, node.text.length - closeDelim.length),
        depthBefore: braceDepth,
        depthAfter: braceDepth,
      });
      continue;
    }

    // Extract opening/closing delimiters and code content from tree-sitter nodes.
    const openDelimText = node.children[0]?.text;
    const closeDelimText = node.children[node.childCount - 1]?.text;
    const openDelim = EJS_OPENING_DELIMS.find((delim) => delim === openDelimText) ?? '<%';
    const parsedCloseDelim = EJS_CLOSING_DELIMS.find((delim) => delim === closeDelimText) ?? '%>';
    const codeNode = node.namedChildren.find((c) => c.type === 'code');
    const parsedCodeContent: string = codeNode?.text ?? '';

    // Correcting the delimiter here, rather than by rewriting the source and re-parsing, keeps
    // the tag's real `_%>` so consumers that rebuild a tag from its delimiters do not
    // quietly drop the newline-slurping the author asked for.
    const absorbedSlurpClose = hasAbsorbedSlurpClose(node);
    const closeDelim: EjsClosingDelimiter = absorbedSlurpClose ? '_%>' : parsedCloseDelim;
    const code: string = absorbedSlurpClose ? parsedCodeContent.slice(0, -1) : parsedCodeContent;
    const parsedCode = normalizeParsedCode(code);
    const javascript = parseJavaScriptPartial(parsedCode, incrementalCode);
    const { contentNode } = javascript;

    // ── Brace-depth tracking ──────────────────────────────────────────────
    // Updated for EVERY non-comment tag so structural `<% if %>` / `<% } %>`
    // tags are included in the depth count.
    const depthBefore = braceDepth;
    // If contentNode doesn't have errors, its a balanced snippet we can just use current depth.
    if (contentNode.hasError) {
      braceDepth += javascript.bracesDelta;
      const { missingOpenBracesCount, missingCloseBracesCount, bracesDelta } = javascript;
      // A continuation both closes the previous branch and opens the next one
      // (`<% } else if (c) { %>`, `<% } catch (e) { %>`, `<% } finally { %>`), so it is
      // self-balancing: the branch it opens is closed by the next continuation at the
      // same depth. That makes the earlier continuation droppable — the survivor's `}`
      // still pairs with the chain head's `{`, so the context stays textually coherent
      // and the enclosing structure a later tag parses inside is unchanged. Without
      // this, a long `else if` ladder never prunes (its delta is 0) and the context
      // grows with the chain, which is the remaining quadratic case.
      const isContinuation = bracesDelta === 0 && missingOpenBracesCount > 0 && missingCloseBracesCount > 0;
      if (isContinuation) {
        const superseded = openContext.findIndex((entry) => entry.depth === depthBefore && entry.isContinuation);
        if (superseded !== -1) {
          openContext.splice(superseded, 1);
        }
      }
      openContext.push({ depth: depthBefore, code: parsedCode, isContinuation });
      if (bracesDelta < 0) {
        // This tag closed one or more blocks. Their context is now unreachable for
        // any following tag, so drop it — including this tag's own entry when it
        // sits at or above the depth we just returned to. A tag that opens or merely
        // continues a block (`<% } else { %>`, delta 0) keeps its context, since the
        // next tag still parses inside it.
        const keepBelow = Math.max(braceDepth, 0);
        let keep = openContext.length;
        while (keep > 0 && openContext[keep - 1].depth >= keepBelow) {
          keep--;
        }
        openContext.length = keep;
      }
      incrementalCode = openContext.map((entry) => entry.code).join('\n');
      if (incrementalCode) incrementalCode += '\n';
    }

    const shape = shapeOf(openDelim, closeDelim, !contentNode.hasError);
    // The depth of the line of the tag: the lowest one, before or after it, the blocks it closes closed.
    const lowerDepth = Math.max(0, Math.min(depthBefore - javascript.missingOpenBracesCount, braceDepth));
    const lineIndent = base.isStandalone ? linePrefix : '';
    tags.push({
      ...base,
      type: OUTPUT_TAG_TYPES[openDelim] ?? 'code',
      shape,
      expectedIndent: base.isStandalone && shape === 'slurp' ? INDENT_UNIT.repeat(lowerDepth) : lineIndent,
      // tree-sitter gives us precise position info directly.
      codeLine: codeNode ? codeNode.startPosition.row + 1 : line,
      codeColumn: codeNode ? codeNode.startPosition.column : column + openDelim.length,
      openDelim,
      closeDelim,
      code,
      parsedCode,
      javascript,
      depthBefore,
      depthAfter: braceDepth,
    });
  }

  return tags;
}
