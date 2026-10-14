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
import {
  type CodeInTree,
  collectNodesInRanges,
  readTagCode,
  type RelativeJavascriptNode,
} from './javascript-parser.js';
import { errorNodes, parseJavaScript, type SyntaxNode, type Tree } from './ts-parser.js';

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
 * the whole template, where the code of each tag is read inside its blocks, and validateTemplate finds its errors and
 * its comments.
 */
export type EjsProgram = {
  /** The source parsed: `function __ejs_template__() {`, then the statements. */
  source: string;
  /** The range of each code tag in `source`: its code, an output tag's in its `__append(…)`. */
  ranges: { tag: EjsCodeTag; start: number; end: number }[];
  /** The root of its tree, freed with the last tag freed. */
  readonly root: SyntaxNode;
};

/** The program of the template of each code tag. */
const programs = new WeakMap<EjsCodeTag, EjsProgram>();

/** The program of the template of a code tag of {@link getEjsTags}. */
export const programOf = (tag: EjsCodeTag): EjsProgram | undefined => programs.get(tag);

/** A code tag as written, before its JavaScript is read. */
type WrittenCodeTag = Omit<EjsCodeTag, 'shape' | 'expectedIndent' | 'javascript' | 'depthBefore' | 'depthAfter'>;

/** A tag as written: its delimiters and its code. */
type WrittenTag = Omit<EjsCommentTag, 'depthBefore' | 'depthAfter'> | WrittenCodeTag;

/** A tag node as written. */
function writtenTagOf(node: EjsSyntaxNode): WrittenTag {
  const line = node.startPosition.row + 1;
  const column = node.startPosition.column;
  const { linePrefix } = node;
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
    return {
      ...base,
      type: 'comment',
      codeLine: line,
      codeColumn: column + '<%#'.length,
      openDelim: '<%#',
      closeDelim,
      code: node.text.slice('<%#'.length, node.text.length - closeDelim.length),
    };
  }

  // Extract opening/closing delimiters and code content from tree-sitter nodes.
  const openDelimText = node.children[0]?.text;
  const closeDelimText = node.children[node.childCount - 1]?.text;
  // tree-sitter opens and closes a tag with a delimiter of these.
  /* v8 ignore next -- @preserve */
  const openDelim = EJS_OPENING_DELIMS.find((delim) => delim === openDelimText) ?? '<%';
  /* v8 ignore next -- @preserve */
  const parsedCloseDelim = EJS_CLOSING_DELIMS.find((delim) => delim === closeDelimText) ?? '%>';
  const codeNode = node.namedChildren.find((c) => c.type === 'code');
  const parsedCodeContent: string = codeNode?.text ?? '';

  // Correcting the delimiter here, rather than by rewriting the source and re-parsing, keeps
  // the tag's real `_%>` so consumers that rebuild a tag from its delimiters do not
  // quietly drop the newline-slurping the author asked for.
  const absorbedSlurpClose = hasAbsorbedSlurpClose(node);
  const closeDelim: EjsClosingDelimiter = absorbedSlurpClose ? '_%>' : parsedCloseDelim;
  const code: string = absorbedSlurpClose ? parsedCodeContent.slice(0, -1) : parsedCodeContent;
  return {
    ...base,
    type: OUTPUT_TAG_TYPES[openDelim] ?? 'code',
    // tree-sitter gives us precise position info directly.
    codeLine: codeNode ? codeNode.startPosition.row + 1 : line,
    codeColumn: codeNode ? codeNode.startPosition.column : column + openDelim.length,
    openDelim,
    closeDelim,
    code,
    parsedCode: normalizeParsedCode(code),
  };
}

/** The code of a code tag in the source of a program: where it starts, and the code written there. */
type CodeInProgram = { index: number; start: number; end: number; codeStart: number; code: string };

/**
 * The source of the program of a template ({@link EjsProgram}), the blocks `unopened` opened before its statements
 * and `unclosed` closed after them, and the code of each code tag there.
 */
function programSource(
  nodes: readonly EjsSyntaxNode[],
  written: WrittenTag[],
  unopened: number,
  unclosed: number,
): { source: string; codes: CodeInProgram[] } {
  let source = `function __ejs_template__() {\n${'{\n'.repeat(unopened)}`;
  const codes: CodeInProgram[] = [];
  let index = 0;
  for (const node of nodes) {
    if (!isTagNode(node)) {
      source += ';__append(0)\n';
      continue;
    }
    const tag = written[index++];
    if (tag.type === 'comment') continue;
    // A line comment ending the code ends with a line break, as EJS adds it, before an output tag appends its value.
    let code = tag.code.lastIndexOf('//') > tag.code.lastIndexOf('\n') ? `${tag.code}\n` : tag.code;
    // An output tag without the semicolon it ends with, as EJS strips it.
    const output = tag.type !== 'code';
    if (output) code = code.replace(/;(\s*$)/, '$1');
    const statement = output ? `__append(${code})` : code;
    source += ';';
    const codeStart = source.length + (output ? '__append('.length : 0);
    codes.push({ index: index - 1, start: source.length, end: source.length + statement.length, codeStart, code });
    source += `${statement}\n`;
  }
  source += `${'}\n'.repeat(unclosed)}}\n`;
  return { source, codes };
}

/** What the code of a tag is read as in a program: its braces, whether it parses alone. */
type CodeRead = { braces: { open: number; close: number }; parsesAlone: boolean };

/**
 * The code of each code tag read in the program of its template.
 *
 * Its braces are its `{`, `${` and `}` tokens in order, a `}` closing the brace before it or, without one, a block
 * the code does not open: not the braces of a comment, even of one across tags, which comments out the code of the
 * tags between, nor the ones tree-sitter adds to recover from an error. It parses alone when they balance, no error of
 * the program is in it (or after it, before the next code), and no node of the program crosses an edge of its code: a
 * `case 1:`, whose case goes on in the next tags, an `else x();`, whose `if` begins in a tag before, and the code of
 * a tag in a comment across tags, which is the comment's, do not. The blanks around the code, and the `;` EJS ends it
 * with, are not in it: `const a = 1`, whose statement ends with that `;`, parses alone.
 */
function readInProgram(root: SyntaxNode, source: string, codes: CodeInProgram[]): CodeRead[] {
  /** The index of the code an offset of the program is in, -1 for none. */
  const codeAt = (offset: number): number => {
    let low = 0;
    let high = codes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (codes[middle].codeStart + codes[middle].code.length <= offset) low = middle + 1;
      else high = middle;
    }
    return low < codes.length && codes[low].codeStart <= offset ? low : -1;
  };
  const read: CodeRead[] = codes.map(() => ({ braces: { open: 0, close: 0 }, parsesAlone: true }));
  for (const brace of root.descendantsOfType(['{', '}', '${'])) {
    // The braces of the function of the program are in no code, and the ones tree-sitter adds are none.
    const index = brace.isMissing ? -1 : codeAt(brace.startIndex);
    if (index === -1) continue;
    const { braces } = read[index];
    if (brace.type !== '}') braces.open++;
    else if (braces.open > 0) braces.open--;
    else braces.close++;
  }
  // The code of each error: the one it is in, or the one before it, as validateTemplate reports it.
  const broken = new Set(errorNodes(root).map((node) => codes.findLastIndex(({ start }) => start <= node.startIndex)));
  for (const [index, { codeStart, code }] of codes.entries()) {
    const { braces } = read[index];
    read[index].parsesAlone =
      braces.open === 0 && braces.close === 0 && !broken.has(index) && !crossesCode(root, source, codeStart, code);
  }
  return read;
}

/**
 * Whether a node of a program crosses an edge of some code of it, the blanks around and the `;` after it aside: one
 * ending in it, one starting in it, or a token around it, a comment or a template string across tags.
 */
function crossesCode(root: SyntaxNode, source: string, codeStart: number, code: string): boolean {
  const start = codeStart + code.length - code.trimStart().length;
  const end = codeStart + code.trimEnd().length;
  if (start >= end) return false;
  let limit = end;
  while (limit < source.length && /\s/u.test(source[limit])) limit++;
  if (source[limit] === ';') limit++;
  const first = root.descendantForIndex(start);
  if (first?.childCount === 0 && first.startIndex < start && first.endIndex > limit) return true;
  for (let node: SyntaxNode | null = first; node; node = node.parent) {
    if (node.startIndex < start && node.endIndex > start && node.endIndex <= limit) return true;
  }
  for (let node = root.descendantForIndex(end - 1); node; node = node.parent) {
    if (node.startIndex >= start && node.endIndex > limit) return true;
  }
  return false;
}

/**
 * The program of a template parsed, and the code of each code tag read there; none without a code tag. The program of
 * a partial template is parsed again, once its braces are read: the blocks its tags close without opening opened
 * before them, and the ones they leave open closed after them.
 */
function readProgram(
  nodes: readonly EjsSyntaxNode[],
  written: WrittenTag[],
): { source: string; codes: CodeInProgram[]; tree: Tree; read: CodeRead[] } | undefined {
  const plain = programSource(nodes, written, 0, 0);
  if (plain.codes.length === 0) return undefined;
  const tree = parseJavaScript(plain.source);
  const read = readInProgram(tree.rootNode, plain.source, plain.codes);
  /** The depth after the codes, and the lowest one they reach: the blocks they close without opening, below 0. */
  let depth = 0;
  let lowest = 0;
  for (const { braces } of read) {
    lowest = Math.min(lowest, depth - braces.close);
    depth += braces.open - braces.close;
  }
  if (lowest === 0 && depth === 0) return { ...plain, tree, read };
  tree.delete();
  const blocks = programSource(nodes, written, -lowest, depth - lowest);
  const blocksTree = parseJavaScript(blocks.source);
  return { ...blocks, tree: blocksTree, read: readInProgram(blocksTree.rootNode, blocks.source, blocks.codes) };
}

/**
 * The tags of a template, from the nodes {@link getEjsNodes} gives, each code tag read in the program of the template
 * ({@link EjsProgram}), parsed once, inside the blocks the tags before it left open: a `<% } %>` closes the block of
 * an `if` there rather than being an error. Its braces and whether it parses alone are read there, and its nodes, when
 * it does not parse alone; otherwise its code is parsed alone when its nodes, or its `contentNode`, are read. The code
 * a comment across tags comments out is a comment there, as EJS compiles it: its braces open and close no block. Free
 * the trees of the code tags with `tag.javascript.cleanup()`; the program is freed with the last of them.
 */
export function getEjsTags(nodes: readonly EjsSyntaxNode[]): EjsTag[] {
  const written = nodes.filter((node) => isTagNode(node)).map((node) => writtenTagOf(node));
  const parsed = readProgram(nodes, written);

  // The tree of the program, freed with the last code tag freed.
  let tree = parsed?.tree;
  let live = parsed?.codes.length ?? 0;
  const release = (): void => {
    if (--live > 0) return;
    tree?.delete();
    tree = undefined;
  };
  const root = (): SyntaxNode => {
    if (!tree) throw new Error('The program of the template is freed: read it before the code of its tags is freed');
    return tree.rootNode;
  };
  const ejsProgram: EjsProgram = {
    source: parsed?.source ?? '',
    ranges: [],
    get root() {
      return root();
    },
  };
  /** The ranges of the code of the tags not parsing alone, whose nodes are read in the program, in one walk. */
  const unbalanced: { start: number; end: number }[] = [];
  let unbalancedNodes: Map<number, SyntaxNode[]> | undefined;
  const inProgram = (start: number) => (): CodeInTree => ({
    start,
    // A tag reading its nodes in the program has its range in `unbalanced`, which the walk gives nodes to.
    /* v8 ignore next -- @preserve */
    nodes: () => (unbalancedNodes ??= collectNodesInRanges(root(), unbalanced)).get(start) ?? [],
  });

  const tags: EjsTag[] = [];
  let braceDepth = 0;
  let codeIndex = 0;
  for (const tag of written) {
    if (tag.type === 'comment') {
      tags.push({ ...tag, depthBefore: braceDepth, depthAfter: braceDepth });
      continue;
    }
    // A template with a code tag has a program.
    /* v8 ignore next -- @preserve */
    if (!parsed) throw new Error('Unexpectedly did not find the program of a code tag');
    const { start, end, codeStart } = parsed.codes[codeIndex];
    const javascript = readTagCode(tag.parsedCode, parsed.read[codeIndex++], inProgram(codeStart), release);
    const depthBefore = braceDepth;
    braceDepth += javascript.bracesDelta;
    const shape = shapeOf(tag.openDelim, tag.closeDelim, javascript.parsesAlone);
    // The depth of the line of the tag: the lowest one, before or after it, the blocks it closes closed.
    const lowerDepth = Math.max(0, Math.min(depthBefore - javascript.missingOpenBracesCount, braceDepth));
    const lineIndent = tag.isStandalone ? tag.linePrefix : '';
    const codeTag: EjsCodeTag = {
      ...tag,
      shape,
      expectedIndent: tag.isStandalone && shape === 'slurp' ? INDENT_UNIT.repeat(lowerDepth) : lineIndent,
      javascript,
      depthBefore,
      depthAfter: braceDepth,
    };
    tags.push(codeTag);
    ejsProgram.ranges.push({ tag: codeTag, start, end });
    programs.set(codeTag, ejsProgram);
    if (!javascript.parsesAlone) unbalanced.push({ start: codeStart, end: codeStart + tag.parsedCode.length });
  }
  return tags;
}
