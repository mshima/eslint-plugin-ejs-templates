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
import { collectNodesInRanges, parseTagCode, type RelativeJavascriptNode } from './javascript-parser.js';
import { parseJavaScript, type SyntaxNode, type Tree } from './ts-parser.js';

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
 * The JavaScript of a template as EJS compiles it into a function, a statement for each text and code tag in order,
 * the blocks its tags leave unopened opened before them and the ones they leave open closed after them: one parse of
 * the whole template, where the code of an unbalanced tag is read in its blocks, and validateTemplate finds its errors
 * and its comments.
 */
export type EjsProgram = {
  /** The source parsed: `function __ejs_template__() {`, then the statements. */
  source: string;
  /** The range of each code tag in `source`: its code, an output tag's in its `__append(…)`. */
  ranges: { tag: EjsCodeTag; start: number; end: number }[];
  /** The root of its tree, parsed when read; freed with the last tag freed. */
  readonly root: SyntaxNode;
};

/** The program of the template of each code tag. */
const programs = new WeakMap<EjsCodeTag, EjsProgram>();

/** The program of the template of a code tag of {@link getEjsTags}. */
export const programOf = (tag: EjsCodeTag): EjsProgram | undefined => programs.get(tag);

/**
 * The tags of a template, from the nodes {@link getEjsNodes} gives, each code tag parsed as JavaScript alone, and its
 * nodes, when its braces do not balance, read in the program of the template ({@link EjsProgram}), where the blocks
 * it opens and closes are: a `<% } %>` closes the block of an `if` there rather than being an error. Free the trees of
 * the code tags with `tag.javascript.cleanup()`; the program is freed with the last of them.
 */
export function getEjsTags(nodes: readonly EjsSyntaxNode[]): EjsTag[] {
  const tags: EjsTag[] = [];

  let braceDepth = 0;
  /** The lowest depth the tags reach: the blocks they close without opening, below 0. */
  let lowestDepth = 0;
  // The program of the template, built once every tag is read, parsed when read, freed with the last tag freed.
  let source = '';
  /** Where the code of each code tag starts in the program, once it is built. */
  const codeStarts = new Map<EjsCodeTag, { start: number }>();
  let tree: Tree | undefined;
  const program: EjsProgram = {
    get source() {
      return source;
    },
    ranges: [],
    get root() {
      tree ??= parseJavaScript(source);
      return tree.rootNode;
    },
  };
  /** The ranges of the code of the unbalanced tags in the program, which read their nodes there. */
  const unbalanced: { start: number; end: number }[] = [];
  let unbalancedNodes: Map<number, SyntaxNode[]> | undefined;
  const nodesAt = (start: number): SyntaxNode[] =>
    (unbalancedNodes ??= collectNodesInRanges(program.root, unbalanced)).get(start) ?? [];
  let live = 0;
  const release = (): void => {
    if (--live > 0) return;
    tree?.delete();
    tree = undefined;
  };

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
    const codeStart = { start: 0 };
    live++;
    const javascript = parseTagCode(
      parsedCode,
      () => ({ start: codeStart.start, nodes: () => nodesAt(codeStart.start) }),
      release,
    );
    const { contentNode } = javascript;

    // ── Brace-depth tracking ──────────────────────────────────────────────
    // Updated for EVERY non-comment tag so structural `<% if %>` / `<% } %>`
    // tags are included in the depth count.
    const depthBefore = braceDepth;
    // If contentNode doesn't have errors, its a balanced snippet we can just use current depth.
    if (contentNode.hasError) {
      lowestDepth = Math.min(lowestDepth, depthBefore - javascript.missingOpenBracesCount);
      braceDepth += javascript.bracesDelta;
    }

    const shape = shapeOf(openDelim, closeDelim, !contentNode.hasError);
    // The depth of the line of the tag: the lowest one, before or after it, the blocks it closes closed.
    const lowerDepth = Math.max(0, Math.min(depthBefore - javascript.missingOpenBracesCount, braceDepth));
    const lineIndent = base.isStandalone ? linePrefix : '';
    const codeTag: EjsCodeTag = {
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
    };
    codeStarts.set(codeTag, codeStart);
    tags.push(codeTag);
  }

  // The program: what EJS compiles, its texts appending a value, the blocks unopened opened before and the ones left
  // open closed after.
  const unopened = -lowestDepth;
  source = `function __ejs_template__() {\n${'{\n'.repeat(unopened)}`;
  let tagIndex = 0;
  for (const node of nodes) {
    if (!isTagNode(node)) {
      source += ';__append(0)\n';
      continue;
    }
    const tag = tags[tagIndex++];
    if (tag.type === 'comment') continue;
    // A line comment ending the code ends with a line break, as EJS adds it, before an output tag appends its value.
    let code = tag.code.lastIndexOf('//') > tag.code.lastIndexOf('\n') ? `${tag.code}\n` : tag.code;
    // An output tag without the semicolon it ends with, as EJS strips it.
    const output = tag.type !== 'code';
    if (output) code = `__append(${code.replace(/;(\s*$)/, '$1')})`;
    source += ';';
    program.ranges.push({ tag, start: source.length, end: source.length + code.length });
    const codeStart = codeStarts.get(tag);
    if (codeStart) {
      codeStart.start = source.length + (output ? '__append('.length : 0);
      if (tag.javascript.contentNode.hasError) {
        unbalanced.push({ start: codeStart.start, end: codeStart.start + tag.parsedCode.length });
      }
    }
    programs.set(tag, program);
    source += `${code}\n`;
  }
  source += `${'}\n'.repeat(Math.max(0, unopened + braceDepth))}}\n`;

  return tags;
}
