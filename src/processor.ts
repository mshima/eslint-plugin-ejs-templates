// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Linter } from 'eslint';
import createDebug from 'debug';
import { parseEjs, parseJavaScript, type SyntaxNode } from './ts-parser.js';
import type { Tree } from 'web-tree-sitter';

type EjsSyntaxNode = SyntaxNode & { linePrefix: string };
type VitualJavascriptCode = {
  virtualCode: string;
  getPosition: (offset: number) => { node: SyntaxNode; startOffset: number; endOffset: number } | null;
};
type RelativeJavascriptNode = {
  /**
   * Parser content node corresponding to the original tag content (excluding synthetic wrapper).
   */
  contentNode: SyntaxNode;
  /**
   * Guessed nodes in the content subtree that start within the original content range.
   * Should be used with start offset correction (virtualOffset - start) to map back to original source positions.
   */
  nodes: SyntaxNode[];
  /**
   * Character offset of the content start in the virtual code (after synthetic wrapper) relative to the original content.
   * Should be used nodes position correction when mapping virtual code positions back to original source (virtualOffset - start + originalColumn).
   */
  start: number;

  cleanup: () => void;
  missingCloseBracesCount: number;
  missingOpenBracesCount: number;
  bracesDelta: number;
  hasStructuralBraces: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Indentation unit used by the ejsIndent brace-depth algorithm (2 spaces). */
const INDENT_UNIT = '  ';
const debug = createDebug('ejs-templates:processor');

// ---------------------------------------------------------------------------
// Slurping eligibility check
// ---------------------------------------------------------------------------

/**
 * Split raw EJS tag content into individual non-empty trimmed lines.
 */
function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function findErrorNode(node: SyntaxNode): SyntaxNode | null {
  if (node.isError || node.isMissing) return node;
  for (const child of node.children) {
    const errorNode = findErrorNode(child);
    if (errorNode) return errorNode;
  }
  return null;
}

const collectErrorNodes = (node: SyntaxNode | SyntaxNode[]): SyntaxNode[] => {
  const nodes: Array<SyntaxNode> = [];
  if (Array.isArray(node)) {
    for (const n of node) {
      nodes.push(...collectErrorNodes(n));
    }
    return nodes;
  }
  if (node.isError || node.isMissing) {
    // We may have nodes that starts within the content but ends outside of it (e.g. an unclosed `{` at the end of the content).
    // Include those nodes, but log them for visibility since they may indicate parsing issues.
    nodes.push(node);
  }
  for (const child of node.children) {
    nodes.push(...collectErrorNodes(child));
  }
  return nodes;
};

const collectNodesStartingInRange = (node: SyntaxNode, contentStart = 0, contentEnd = Infinity): SyntaxNode[] => {
  const nodes: Array<SyntaxNode> = [];
  if (node.startIndex >= contentStart && node.startIndex < contentEnd) {
    // We may have nodes that starts within the content but ends outside of it (e.g. an unclosed `{` at the end of the content).
    // Include those nodes, but log them for visibility since they may indicate parsing issues.
    nodes.push(node);
  }
  for (const child of node.children) {
    nodes.push(...collectNodesStartingInRange(child, contentStart, contentEnd));
  }
  return nodes;
};

/**
 * Tries to generate a approximate node for a Javascript partial code.
 */
export function parseJavaScriptPartial(text: string, incrementalCode?: string): RelativeJavascriptNode {
  const contentTree = parseJavaScript(text);
  const isMissingCloseBrace = (n: SyntaxNode) =>
    (n.isError && n.text.trimEnd().endsWith('{')) || (n.isMissing && n.type === '}');
  const isMissingOpenBrace = (n: SyntaxNode) => n.isError && (n.text.trimStart().startsWith('}') || n.type === '{');
  const errorNodes = collectErrorNodes(contentTree.rootNode);
  const missingCloseBracesCount = errorNodes.filter(isMissingCloseBrace).length;
  const missingOpenBracesCount = errorNodes.filter(isMissingOpenBrace).length;
  let wrapperPrefix = '';
  let contentTreeBestGuess: Tree | undefined = undefined;
  if (contentTree.rootNode.hasError) {
    const ejsBaseWrapperPrefix = 'function __ejs_brace_probe__() {\n';
    const ejsBaseWrapperSuffix = '\n  foo(); \n}\n';
    const ejsBracesPrefix = '  if (true) {\n';
    const ejsBracesSuffix = '}\n';

    wrapperPrefix = ejsBaseWrapperPrefix + ejsBracesPrefix;
    let wrapperSuffix = ejsBaseWrapperSuffix + ejsBracesSuffix;
    contentTreeBestGuess = parseJavaScript(`${wrapperPrefix}${text}${wrapperSuffix}`);

    // Ignore node warnings
    if (collectErrorNodes(contentTreeBestGuess.rootNode).some((n) => n.isError)) {
      contentTreeBestGuess.delete();
      wrapperPrefix = ejsBaseWrapperPrefix + ejsBracesPrefix.repeat(missingCloseBracesCount);
      wrapperSuffix = ejsBaseWrapperSuffix + ejsBracesSuffix.repeat(missingOpenBracesCount);
      contentTreeBestGuess = parseJavaScript(`${wrapperPrefix}${text}${wrapperSuffix}`);
    }

    // Fallback to incremental
    if (incrementalCode !== undefined && collectErrorNodes(contentTreeBestGuess.rootNode).some((n) => n.isError)) {
      contentTreeBestGuess.delete();
      wrapperPrefix = ejsBaseWrapperPrefix + incrementalCode;
      wrapperSuffix = ejsBaseWrapperSuffix;
      contentTreeBestGuess = parseJavaScript(`${wrapperPrefix}${text}${wrapperSuffix}`);
    }
  }

  const contentStart = wrapperPrefix.length;
  const contentEnd = wrapperPrefix.length + text.length;
  const nodes = collectNodesStartingInRange((contentTreeBestGuess ?? contentTree).rootNode, contentStart, contentEnd);
  return {
    nodes,
    contentNode: contentTree.rootNode,
    start: contentStart,
    missingCloseBracesCount,
    missingOpenBracesCount,
    bracesDelta: missingOpenBracesCount - missingCloseBracesCount,
    hasStructuralBraces: nodes.some(
      (n) => n.type === 'statement_block' || missingCloseBracesCount > 0 || missingOpenBracesCount > 0,
    ),
    cleanup: () => {
      contentTreeBestGuess?.delete();
      contentTree.delete();
    },
  };
}

/**
 * Collect structural opening brace positions from JavaScript statement blocks.
 *
 * Tree-sitter uses `statement_block` for bodies such as `if (...) { ... }`,
 * `else { ... }`, loops, `try/catch/finally`, and arrow/function bodies.
 * It does not use `statement_block` for object literals, destructuring, or
 * template interpolations, so those braces are naturally excluded.
 */
function collectStructuralBracePositions(text: string): Set<number> {
  const collectStatementBlockPositions = (nodes: SyntaxNode[], contentStart: number): Set<number> => {
    const positions = new Set<number>();

    for (const node of nodes) {
      if (node.type === 'statement_block') {
        positions.add(node.startIndex - contentStart);
      }
    }

    return positions;
  };

  const parsed = parseJavaScriptPartial(text);
  return collectStatementBlockPositions(parsed.nodes, parsed.start);
}

// ---------------------------------------------------------------------------
// Function-wrapper helpers
// ---------------------------------------------------------------------------

/**
 * Sentinel text written by the `experimental-prefer-slurp-multiline` fix.
 * Using a non-empty distinct value lets `translateFix` tell this sentinel
 * apart from the generic `''` sentinel used by all other plugin rules.
 */
export const SENTINEL_PREFER_SLURP_MULTILINE = 'PREFER_SLURP_MULTILINE';

/**
 * Sentinel text written by `prefer-single-line-tags` when configured with
 * `{ mode: 'braces' }`.
 */
export const SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES = 'PREFER_SINGLE_LINE_TAGS_BRACES';
/**
 * Sentinel text written by the `slurp-newline` fix.
 */
export const SENTINEL_SLURP_NEWLINE = 'SLURP_NEWLINE';

/**
 * Sentinel text written by the `indent` fix.
 */
export const SENTINEL_INDENT = 'INDENT';

/**
 * Sentinel text written by the `indent` fix when `normalizeContent` is enabled.
 */
export const SENTINEL_INDENT_NORMALIZE = 'INDENT_NORMALIZE';

/**
 * Sentinel text written by the `format` fix.
 */
export const SENTINEL_FORMAT = 'FORMAT';

/**
 * Sentinel text written by the `format` fix when `multilineCloseOnNewLine`
 * is enabled.
 */
export const SENTINEL_FORMAT_MULTILINE_CLOSE = 'FORMAT_MULTILINE_CLOSE';

/** Opening line of the function wrapper injected around the full virtual file. */
const GLOBAL_VIRTUAL_OPEN = '(function() {\n';
/** Closing line of the function wrapper injected around the full virtual file. */
const GLOBAL_VIRTUAL_CLOSE = '\n})();';

// ---------------------------------------------------------------------------
// Tag-block extraction
// ---------------------------------------------------------------------------

/** A single extracted EJS tag together with its position in the original file. */
export interface TagBlock {
  ejsNode: EjsSyntaxNode;
  /**
   * Virtual JS code for this block (original content only — no synthetic braces).
   *
   * Structure:
   * ```
   * Line 1:   //@ejs-tag:<type>               ← type marker comment
   * Line 2:   <codeContent>[virtualBodyInlineSuffix]
   *           ← block.originalLine
   * Line 2+n: <further JS lines>              ← block.originalLine + n
   * Line 2+m: [virtualBodyExtraLine]          ← optional extra line (e.g. `void 0;`)
   * ```
   *
   * Brace balancing is done at the **global** level in `preprocess` (not per-block),
   * so that cross-tag constructs like `forEach(x => { ... })` work correctly.
   */
  virtualCode: string;
  /** 1-based line in the original EJS file where the opening delimiter starts. */
  tagLine: number;
  /** 0-based column in the original EJS file where the opening delimiter starts. */
  tagColumn: number;
  /** 1-based line in the original EJS file where the JS code content starts. */
  originalLine: number;
  /** 0-based column in the original EJS file where the JS code content starts. */
  originalColumn: number;
  /** Character offset of the tag start (`<`) in the original source. */
  tagOffset: number;
  /** Total length of the original tag (opening delimiter + content + closing delimiter). */
  tagLength: number;
  /**
   * Determined tag type (same value as the `//@ejs-tag:<type>` marker).
   *
   * Base types: `escaped-output` | `raw-output` | `slurp` | `code` | `code-slurpable`
   *
   * Suffixes added for violations:
   * - `-multiline`         → content contains `\n` (triggers `prefer-single-line-tags` rule)
   * - `-needs-indent`      → standalone `<%_ _%>` tag whose indentation does not match
   *                          the brace-depth expected indent (triggers `indent` rule)
   * - `-not-standalone`    → slurp tag that is inline (triggers `slurp-newline` rule)
   */
  tagType: string;
  /** Raw JS content captured between the delimiters. */
  codeContent: string;
  javascriptPartialNode?: RelativeJavascriptNode;
  /** Full opening delimiter string (e.g. `<%`, `<%_`, `<%=`, `<%-`). */
  openDelim: string;
  /** Full closing delimiter string (e.g. `%>`, `_%>`, `-%>`). */
  closeDelim: string;
  /**
   * Actual whitespace characters on the current line before the tag.
   * Empty string when the tag is not standalone (has non-whitespace before it
   * on the same line).
   */
  lineIndent: string;
  /**
   * Expected brace-depth indentation for this tag.
   * Only meaningful for standalone `<%_ _%>` tags; empty string otherwise.
   */
  expectedIndent: string;
  /**
   * Text appended to `codeContent` in the virtual body (same line, after the code).
   * For current output-tag handling this is `';'`, turning an expression into
   * a valid statement in virtual JS.
   * Empty string for other tags.
   */
  virtualBodyInlineSuffix: string;
  /**
   * Optional extra line injected into the virtual body AFTER `codeContent` and
   * BEFORE `syntheticSuffix`.  Used for code/slurp tags whose trimmed content
   * ends with `{`: appends `void 0;` to suppress ESLint `no-empty` errors
   * on the opened block.  Empty string when not needed.
   */
  virtualBodyExtraLine: string;
  /** Whether the tag is standalone (only whitespace before it on the same line). */
  isStandalone: boolean;
  /** Whether this block is a virtualized ESLint directive comment from an EJS comment tag. */
  isDirectiveComment: boolean;
}

function extractEslintDirectiveFromEjsComment(commentText: string): string | null {
  const content = commentText
    .replace(/^<%#/u, '')
    .replace(/(?:_%>|-%>|%>)$/u, '')
    .trim();
  if (/^eslint-(?:disable|enable)(?:-next-line)?(?:\s|$)/u.test(content)) {
    return content;
  }
  return null;
}

/**
 * Extract the close delimiter from an EJS comment tag text.
 * Supported delimiters: `%>`, `-%>`, `_%>`
 */
function extractCloseDelimFromEjsComment(commentText: string): string {
  const delimiters = ['_%>', '-%>', '%>'];
  for (const delim of delimiters) {
    if (commentText.endsWith(delim)) {
      return delim;
    }
  }
  return '%>'; // fallback
}

function createDirectiveCommentBlock(params: {
  ejsNode: EjsSyntaxNode;
  javascriptPartialNode?: RelativeJavascriptNode;
  directiveText: string;
  tagOffset: number;
  tagLength: number;
  tagLine: number;
  tagColumn: number;
  lineIndent: string;
  isStandalone: boolean;
  closeDelim?: string;
}): TagBlock {
  const {
    ejsNode,
    javascriptPartialNode,
    directiveText,
    tagOffset,
    tagLength,
    tagLine,
    tagColumn,
    lineIndent,
    isStandalone,
    closeDelim,
  } = params;
  return {
    ejsNode,
    javascriptPartialNode,
    virtualCode: `/* ${directiveText} */`,
    tagLine,
    tagColumn,
    originalLine: tagLine,
    originalColumn: tagColumn,
    tagOffset,
    tagLength,
    tagType: 'directive-comment',
    codeContent: directiveText,
    openDelim: '<%#',
    closeDelim: closeDelim ?? '%>',
    lineIndent,
    expectedIndent: lineIndent,
    virtualBodyInlineSuffix: '',
    virtualBodyExtraLine: '',
    isStandalone,
    isDirectiveComment: true,
  };
}

/**
 * Extract each non-comment EJS tag from `text` as a {@link TagBlock},
 * plus supported ESLint directive comments written as EJS comments.
 * using tree-sitter-embedded-template for accurate parsing.
 *
 * Each per-tag virtual block has the structure:
 * ```
 * //@ejs-tag:<tagType>
 * [synthetic prefix — brace-balancing]
 * <raw JS code from the tag>[virtualBodyInlineSuffix]
 * [virtualBodyExtraLine — e.g. void 0;]
 * [synthetic suffix — brace-balancing]
 * ```
 *
 * Tag types (base):
 * - `escaped-output`  – `<%= … %>`
 * - `raw-output`      – `<%- … %>`
 * - `slurp`           – `<%_ … _%>` / `<% … _%>` / `<%_ … %>`
 * - `code`            – `<% … %>` that cannot be promoted to slurping
 * - `code-slurpable`  – `<% … %>` that can be safely promoted to `<%_ … _%>`
 *
 * Violation suffixes (appended to the base type):
 * - `-multiline`         – content contains newlines (fixable by `prefer-single-line-tags`)
 * - `-needs-indent`      – wrong brace-depth indentation (fixable by `indent`)
 * - `-not-standalone`    – slurp tag is inline (fixable by `slurp-newline`)
 */
export function extractTagBlocks(nodes: EjsSyntaxNode[]): TagBlock[] {
  const blocks: TagBlock[] = [];

  let braceDepth = 0;
  let incrementalCode = '';
  let pendingNextLineDirective: {
    disableText: string;
    enableText: string;
    tagOffset: number;
    tagLength: number;
    tagLine: number;
    tagColumn: number;
    lineIndent: string;
    isStandalone: boolean;
    closeDelim: string;
  } | null = null;

  for (const node of nodes) {
    // Skip content nodes.
    if (!['comment_directive', 'code', 'directive', 'output_directive'].includes(node.type)) continue;

    const tagOffset = node.startIndex;
    const tagLength = node.endIndex - node.startIndex;
    const tagLine = node.startPosition.row + 1;
    const tagColumn = node.startPosition.column;
    const linePrefix = node.linePrefix;
    // ── Standalone detection ──────────────────────────────────────────────
    // A tag is "standalone" when everything before it on the same line is
    // whitespace (i.e. `tagColumn` characters of pure whitespace).
    const isStandalone = /^\s*$/u.test(linePrefix);
    const lineIndent = isStandalone ? linePrefix : '';

    if (node.type === 'comment_directive') {
      const directiveText = extractEslintDirectiveFromEjsComment(node.text);
      if (!directiveText) {
        continue;
      }

      if (/^eslint-disable-next-line(?:\s|$)/u.test(directiveText)) {
        pendingNextLineDirective = {
          disableText: directiveText.replace(/^eslint-disable-next-line\b/u, 'eslint-disable'),
          enableText: directiveText.replace(/^eslint-disable-next-line\b/u, 'eslint-enable'),
          tagOffset,
          tagLength,
          tagLine,
          tagColumn,
          lineIndent,
          isStandalone,
          closeDelim: extractCloseDelimFromEjsComment(node.text),
        };
        continue;
      }

      blocks.push(
        createDirectiveCommentBlock({
          ejsNode: node,
          directiveText,
          tagOffset,
          tagLength,
          tagLine,
          tagColumn,
          lineIndent,
          isStandalone,
          closeDelim: extractCloseDelimFromEjsComment(node.text),
        }),
      );
      continue;
    }

    // Extract opening/closing delimiters and code content from tree-sitter nodes.
    const openDelim: string = node.children[0]?.text ?? '<%';
    const closeDelim: string = node.children[node.childCount - 1]?.text ?? '%>';
    const codeNode = node.namedChildren.find((c) => c.type === 'code');
    const codeContent: string = codeNode?.text ?? '';
    const javascriptPartialNode = parseJavaScriptPartial(codeContent, incrementalCode);
    const { contentNode } = javascriptPartialNode;
    incrementalCode += codeContent;

    // tree-sitter gives us precise position info directly.
    const codeStartRow = codeNode ? codeNode.startPosition.row + 1 : tagLine;
    const codeStartCol = codeNode ? codeNode.startPosition.column : tagColumn + openDelim.length;
    const originalLine = codeStartRow;
    const originalColumn = codeStartCol;

    if (pendingNextLineDirective) {
      blocks.push(
        createDirectiveCommentBlock({
          ejsNode: node,
          javascriptPartialNode,
          directiveText: pendingNextLineDirective.disableText,
          tagOffset: pendingNextLineDirective.tagOffset,
          tagLength: pendingNextLineDirective.tagLength,
          tagLine: pendingNextLineDirective.tagLine,
          tagColumn: pendingNextLineDirective.tagColumn,
          lineIndent: pendingNextLineDirective.lineIndent,
          isStandalone: pendingNextLineDirective.isStandalone,
          closeDelim: pendingNextLineDirective.closeDelim,
        }),
      );
    }

    // ── Brace-depth tracking (for indent) ─────────────────────────────────
    // Updated for EVERY non-comment tag so structural `<% if %>` / `<% } %>`
    // tags are included in the depth count even though we won't indent them.
    const oldBraceDepth = braceDepth;
    // If contentNode doesn't have errors, its a balanced snippet we can just use current depth.
    if (contentNode.hasError) {
      const contentErrorNodes = collectErrorNodes(contentNode);
      if (contentErrorNodes.some((c) => c.type === 'ERROR')) {
        const incrementalTree = parseJavaScript(incrementalCode);
        const incrementalNodes = collectNodesStartingInRange(incrementalTree.rootNode);
        // If the incremental parse doesn't have errors, we can reset the brace depth to 0 since the virtual code will be fully balanced at this point.
        if (incrementalTree.rootNode.hasError) {
          if (incrementalNodes.some((c) => c.type === 'ERROR')) {
            const contentNodes = collectNodesStartingInRange(contentNode);
            // fallback to simple brace counting when the parse fails in ERROR
            const openBracesNodes = contentNodes.filter((n) => n.type === '{');
            const closeBracesNodes = contentNodes.filter((n) => n.type === '}');
            braceDepth += openBracesNodes.length - closeBracesNodes.length;
          } else {
            const missingCloseBraceNode = incrementalNodes.filter((n) => n.isMissing && n.type === '}');
            braceDepth = missingCloseBraceNode.length;
          }
        } else {
          incrementalCode = '';
          braceDepth = 0;
        }
      } else {
        const missingCloseBraceNode = contentErrorNodes.filter((n) => n.type === '}');
        braceDepth += missingCloseBraceNode.length;
      }
    }
    braceDepth = Math.max(0, braceDepth);

    const lowerBraceDepth = Math.max(
      0,
      Math.min(oldBraceDepth - javascriptPartialNode.missingOpenBracesCount, braceDepth),
    );
    // ── Base tag type ─────────────────────────────────────────────────────
    let baseType: string;
    if (openDelim === '<%=') {
      baseType = 'escaped-output';
    } else if (openDelim === '<%-') {
      baseType = 'raw-output';
    } else if (openDelim === '<%_' || closeDelim === '_%>') {
      baseType = 'slurp';
    } else if (closeDelim === '-%>') {
      baseType = 'code';
    } else {
      baseType = contentNode.hasError ? 'code' : 'code-slurpable';
    }

    // ── Expected indent (for standalone <%_ _%> tags only) ────────────────
    const isSlurpTag = baseType === 'slurp';
    const expectedIndent = isStandalone && isSlurpTag ? INDENT_UNIT.repeat(lowerBraceDepth) : lineIndent;

    // ── Multiline detection ────────────────────────────────────────────────
    const isMultiline = codeContent.includes('\n');

    // ── Final tag type (with violation suffixes) ───────────────────────────
    let tagType = baseType;
    if (isStandalone && isSlurpTag && lineIndent !== expectedIndent) {
      tagType = isMultiline ? 'slurp-needs-indent-multiline' : 'slurp-needs-indent';
    } else if (isMultiline) {
      tagType += '-multiline';
    } else if (isSlurpTag && !isStandalone) {
      // Slurp tag that is inline (not at the start of its own line).
      // The `slurp-newline` rule will move it to its own line.
      tagType = 'slurp-not-standalone';
    }

    // ── Virtual body extras (void-expression wrapping) ────────────────────
    // For output tags: append `;` so the expression is a valid statement in
    // virtual JS (without introducing global references like `debug`).
    // For code/slurp tags ending with `{`: append `void 0;` to suppress
    // `no-empty` errors on the opened block.
    const isOutputTag = baseType === 'escaped-output' || baseType === 'raw-output';
    const endsWithOpenBrace = !isMultiline && codeContent.trim().endsWith('{');

    let virtualBodyInlineSuffix = '';
    let virtualBodyExtraLine = '';

    if (!isMultiline && isOutputTag) {
      virtualBodyInlineSuffix = ';';
    } else if (endsWithOpenBrace) {
      virtualBodyExtraLine = '\nvoid 0;';
    }

    // ── Virtual code generation ────────────────────────────────────────────
    // Original content only — no per-block synthetic braces.  The current
    // `buildFunctionWrapper` only balances `{`/`}` and ignores `(`/`)` and
    // `[`/`]`, so it would BREAK cross-tag constructs like
    // `forEach(x => { ... })`.  Global brace balancing is applied in
    // `preprocess` instead.
    const virtualCode = `//@ejs-tag:${tagType}\n` + `${codeContent}${virtualBodyInlineSuffix}${virtualBodyExtraLine}`;

    blocks.push({
      ejsNode: node,
      virtualCode,
      tagLine,
      tagColumn,
      originalLine,
      originalColumn,
      tagOffset,
      tagLength,
      tagType,
      codeContent,
      javascriptPartialNode,
      openDelim,
      closeDelim,
      lineIndent,
      expectedIndent,
      virtualBodyInlineSuffix,
      virtualBodyExtraLine,
      isStandalone,
      isDirectiveComment: false,
    });

    if (pendingNextLineDirective) {
      blocks.push(
        createDirectiveCommentBlock({
          ejsNode: node,
          javascriptPartialNode,
          directiveText: pendingNextLineDirective.enableText,
          tagOffset,
          tagLength,
          tagLine,
          tagColumn,
          lineIndent,
          isStandalone,
          closeDelim: pendingNextLineDirective.closeDelim,
        }),
      );
      pendingNextLineDirective = null;
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Message position mapping
// ---------------------------------------------------------------------------

/**
 * Map an ESLint message from the virtual JS file back to the original EJS file.
 *
 * Virtual file structure per block:
 * ```
 * Line 1:   //@ejs-tag:<type>                ← type marker comment
 * Line 2:   <first JS>[virtualBodyInlineSuffix]
 *           ← block.originalLine
 * Line 2+n: <further JS lines>               ← block.originalLine + n
 * Line 2+m: [virtualBodyExtraLine]            ← filtered out (maps to tag position)
 * ```
 */
function mapMessage(msg: Linter.LintMessage, block: TagBlock): Linter.LintMessage {
  // Line 1 is the marker comment; code starts on line 2.
  const codeStartLine = 2;

  if (msg.line < codeStartLine) {
    return { ...msg, line: block.tagLine, column: block.tagColumn };
  }

  const codeLineIndex = msg.line - codeStartLine;

  // How many lines does codeContent occupy?  A trailing '\n' does not add an
  // extra logical line — it just means the next character (the wrapper close
  // or synthetic suffix) starts on a new line.
  const codeLineCount = block.codeContent.split('\n').length - (block.codeContent.endsWith('\n') ? 1 : 0);

  if (codeLineIndex >= codeLineCount) {
    // Message is on a virtualBodyExtraLine, synthetic suffix, or wrapper-close
    // line; map to tag position.
    return { ...msg, line: block.tagLine, column: block.tagColumn };
  }

  const originalLine = block.originalLine + codeLineIndex;
  const originalColumn = codeLineIndex === 0 ? msg.column + block.originalColumn : msg.column;
  const mapped: Linter.LintMessage = { ...msg, line: originalLine, column: originalColumn };

  if (msg.endLine !== undefined) {
    const endCodeLineIndex = msg.endLine - codeStartLine;
    mapped.endLine = block.originalLine + endCodeLineIndex;
    mapped.endColumn = endCodeLineIndex === 0 ? (msg.endColumn ?? 0) + block.originalColumn : msg.endColumn;
  }

  return mapped;
}

// ---------------------------------------------------------------------------
// Fix translation
// ---------------------------------------------------------------------------

/**
 * Build the collapsed replacement text for a multiline EJS tag.
 *
 * Algorithm:
 * 1. Split content into trimmed non-empty lines.
 * 2. Accumulate lines, joining them with a space (or no space for `.` continuation).
 * 3. Emit a new tag whenever the accumulated content ends with `;`, `}` or `{`.
 *    Lines that do NOT end with one of those characters are folded into the next
 *    line (continuation).  Any remaining accumulated content after the last
 *    statement-terminator is emitted as a final tag.
 *
 * Examples:
 * ```
 * if (x) {\n  doWork();\n}
 * ```
 * → `<%_ if (x) { _%>`, `<%_ doWork(); _%>`, `<%_ } _%>`
 *
 * ```
 * const arr = 'foo'\n  .split();\n const y = 2;
 * ```
 * → `<%_ const arr = 'foo'.split(); _%>`, `<%_ const y = 2; _%>`  (dot-continuation joined)
 */
function buildCollapsedTag(block: TagBlock, options?: { applyIndent?: boolean }): string {
  return buildCollapsedTagWithMode(block, 'always', options);
}

type PreferSingleLineTagsMode = 'always' | 'braces';

function buildCollapsedTagWithMode(
  block: TagBlock,
  mode: PreferSingleLineTagsMode,
  options?: { applyIndent?: boolean },
): string {
  const { javascriptPartialNode } = block;
  if (!javascriptPartialNode) {
    // Should not happen since we only call this on blocks with a successful JS parse, but guard just in case.
    throw new Error(
      `Cannot build collapsed tag for block at line ${String(block.tagLine)} due to missing javascriptPartialNode.`,
    );
  }
  const applyIndent = options?.applyIndent ?? false;
  const rawLines = splitLines(block.codeContent);

  const hasBraces = javascriptPartialNode.hasStructuralBraces;
  if (mode === 'braces' && !hasBraces) {
    // In braces mode, multiline tags without braces are left unchanged.
    return `${block.openDelim}${block.codeContent}${block.closeDelim}`;
  }

  const tags: string[] = [];
  const collapseOnlyAtBraceBoundaries = mode === 'braces' && hasBraces;

  if (collapseOnlyAtBraceBoundaries) {
    const allLines = block.codeContent.split('\n');
    const bodyLines: string[] = [];
    const structuralBracePositionsFromContentNode = block.javascriptPartialNode?.contentNode
      ? new Set(
          collectNodesStartingInRange(block.javascriptPartialNode.contentNode, 0, block.codeContent.length)
            .filter((node) => node.type === 'statement_block')
            .map((node) => node.startIndex),
        )
      : new Set<number>();
    const structuralBracePositions =
      structuralBracePositionsFromContentNode.size > 0
        ? structuralBracePositionsFromContentNode
        : collectStructuralBracePositions(block.codeContent);

    const collapseAccumulatedLines = (lines: string[]): string => {
      let accumulated = '';
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) {
          continue;
        }
        if (accumulated.length === 0) {
          accumulated = trimmedLine;
        } else if (trimmedLine.startsWith('.')) {
          accumulated += trimmedLine;
        } else {
          accumulated += ` ${trimmedLine}`;
        }
      }
      return accumulated;
    };

    const flushBodyLines = () => {
      if (bodyLines.length > 0) {
        tags.push(bodyLines.join('\n'));
        bodyLines.length = 0;
      }
    };

    const findMatchingCloseIndex = (s: string, openIndex: number): number => {
      let templateDepth = 0;
      let nestedBraceDepth = 0;
      for (let i = openIndex + 1; i < s.length; i++) {
        if (templateDepth === 0) {
          if (s[i] === '$' && i + 1 < s.length && s[i + 1] === '{') {
            templateDepth++;
            i++;
          } else if (s[i] === '{') {
            nestedBraceDepth++;
          } else if (s[i] === '}') {
            if (nestedBraceDepth > 0) {
              nestedBraceDepth--;
            } else {
              return i;
            }
          }
        } else if (s[i] === '$' && i + 1 < s.length && s[i + 1] === '{') {
          templateDepth++;
          i++;
        } else if (s[i] === '{') {
          nestedBraceDepth++;
        } else if (s[i] === '}') {
          if (nestedBraceDepth > 0) {
            nestedBraceDepth--;
          } else {
            templateDepth--;
          }
        }
      }
      return -1;
    };

    const findNextBoundary = (s: string, absoluteOffset: number): { kind: 'open' | 'close'; index: number } | null => {
      let templateDepth = 0;
      for (let i = 0; i < s.length; i++) {
        if (templateDepth === 0) {
          if (s[i] === '$' && i + 1 < s.length && s[i + 1] === '{') {
            templateDepth++;
            i++;
            continue;
          }

          if (s[i] === '{' && (i === 0 || s[i - 1] !== '$')) {
            const braceAbsolutePos = absoluteOffset + i;
            if (structuralBracePositions.has(braceAbsolutePos)) {
              return { kind: 'open', index: i };
            }

            const matchingClose = findMatchingCloseIndex(s, i);
            if (matchingClose === -1) {
              return null;
            }
            i = matchingClose;
            continue;
          }

          if (s[i] === '}') {
            return { kind: 'close', index: i };
          }
        } else if (s[i] === '$' && i + 1 < s.length && s[i + 1] === '{') {
          templateDepth++;
          i++;
        } else if (s[i] === '}') {
          templateDepth--;
        }
      }

      return null;
    };

    const processSegment = (segment: string, absoluteOffset: number) => {
      const normalized = segment.replace(/\s+$/u, '');
      if (normalized.trim().length === 0) {
        return;
      }

      const boundary = findNextBoundary(normalized, absoluteOffset);
      if (!boundary) {
        bodyLines.push(normalized);
        return;
      }

      if (boundary.kind === 'open') {
        const openPart = normalized.slice(0, boundary.index + 1).trim();
        const remainder = normalized.slice(boundary.index + 1);
        const trimmedRemainder = remainder.trimStart();
        const consumedWhitespace = remainder.length - trimmedRemainder.length;

        const canMergeAccumulatedWithOpen =
          bodyLines.length > 0 &&
          bodyLines.every((line) => {
            const trimmedLine = line.trim();
            return (
              !trimmedLine.startsWith('//') &&
              !trimmedLine.endsWith(';') &&
              !trimmedLine.endsWith('}') &&
              !trimmedLine.endsWith('{')
            );
          });

        if (canMergeAccumulatedWithOpen) {
          const prefixPart = collapseAccumulatedLines(bodyLines);
          bodyLines.length = 0;
          const combinedOpenPart = prefixPart.length > 0 ? `${prefixPart} ${openPart}` : openPart;
          if (combinedOpenPart.length > 0) {
            tags.push(combinedOpenPart);
          }
        } else {
          flushBodyLines();
          if (openPart.length > 0) {
            tags.push(openPart);
          }
        }
        processSegment(trimmedRemainder, absoluteOffset + boundary.index + 1 + consumedWhitespace);
        return;
      }

      const beforeClose = normalized.slice(0, boundary.index);
      const remainder = normalized.slice(boundary.index + 1);
      const trimmedRemainder = remainder.trimStart();
      const consumedWhitespace = remainder.length - trimmedRemainder.length;

      if (trimmedRemainder.length > 0) {
        let nextIndex = 0;
        while (nextIndex < trimmedRemainder.length && /\s/u.test(trimmedRemainder[nextIndex])) {
          nextIndex += 1;
        }

        const looksLikeTransition =
          trimmedRemainder.startsWith('else', nextIndex) ||
          trimmedRemainder.startsWith('catch', nextIndex) ||
          trimmedRemainder.startsWith('finally', nextIndex);

        if (looksLikeTransition) {
          let openBraceIndex = nextIndex;
          while (openBraceIndex < trimmedRemainder.length && trimmedRemainder[openBraceIndex] !== '{') {
            openBraceIndex += 1;
          }

          if (openBraceIndex < trimmedRemainder.length) {
            const transitionBraceAbsolutePos =
              absoluteOffset + boundary.index + 1 + consumedWhitespace + openBraceIndex;
            if (structuralBracePositions.has(transitionBraceAbsolutePos)) {
              const transitionPart = `} ${trimmedRemainder.slice(0, openBraceIndex + 1)}`.trim();
              const transitionRemainder = trimmedRemainder.slice(openBraceIndex + 1).trimStart();
              flushBodyLines();
              tags.push(transitionPart);
              processSegment(
                transitionRemainder,
                transitionBraceAbsolutePos +
                  1 +
                  (trimmedRemainder.slice(openBraceIndex + 1).length - transitionRemainder.length),
              );
              return;
            }
          }
        }
      }

      if (beforeClose.trim().length > 0) {
        bodyLines.push(beforeClose.replace(/\s+$/u, ''));
      }
      flushBodyLines();

      if (trimmedRemainder.startsWith(';')) {
        tags.push('};');
        const afterSemicolon = trimmedRemainder.slice(1).trimStart();
        const semicolonWhitespace = trimmedRemainder.slice(1).length - afterSemicolon.length;
        processSegment(afterSemicolon, absoluteOffset + boundary.index + 2 + consumedWhitespace + semicolonWhitespace);
      } else {
        tags.push('}');
        processSegment(trimmedRemainder, absoluteOffset + boundary.index + 1 + consumedWhitespace);
      }
    };

    let currentOffset = 0;
    for (const line of allLines) {
      if (line.trim().length > 0) {
        processSegment(line, currentOffset);
      }
      currentOffset += line.length + 1;
    }

    flushBodyLines();
  } else {
    let accumulated = '';
    for (const line of rawLines) {
      if (accumulated.length === 0) {
        accumulated = line;
      } else if (accumulated.trimStart().startsWith('//') || line.trimStart().startsWith('//')) {
        // Never collapse code onto a line-comment line (or vice versa).
        tags.push(accumulated);
        accumulated = line;
      } else if (line.startsWith('.')) {
        // Dot-continuation: join without space (chained method / property access).
        accumulated += line;
      } else {
        accumulated += ` ${line}`;
      }

      // Emit a tag whenever the accumulated content ends with a statement boundary.
      if (accumulated.endsWith(';') || accumulated.endsWith('}') || accumulated.endsWith('{')) {
        tags.push(accumulated);
        accumulated = '';
      }
    }

    // Flush any remaining content (lines that don't end with a boundary char).
    if (accumulated.length > 0) {
      tags.push(accumulated);
    }
  }

  if (tags.length === 0) {
    const baseIndent = applyIndent ? block.expectedIndent : '';
    return `${baseIndent}${block.openDelim} ${block.closeDelim}`;
  }

  if (tags.length === 1) {
    const baseIndent = applyIndent ? block.expectedIndent : '';
    return `${baseIndent}${block.openDelim} ${tags[0].trim()} ${block.closeDelim}`;
  }

  if (!applyIndent) {
    // Legacy prefer-single-line-tags behaviour: preserve existing indentation.
    return tags
      .map((tag, i) => {
        const isFirst = i === 0;
        const isLast = i === tags.length - 1;
        const openDelim = isFirst ? block.openDelim : '<%_';
        const closeDelim = isLast ? block.closeDelim : '_%>';
        const prefix = i === 0 ? '' : block.lineIndent;
        return `${prefix}${openDelim} ${tag.trim()} ${closeDelim}`;
      })
      .join('\n');
  }

  // Indent-aware split: align generated tags with expected indent and structural depth.
  const resultParts: string[] = [];
  let relativeDepth = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const isFirst = i === 0;
    const isLast = i === tags.length - 1;
    const openDelim = isFirst ? block.openDelim : '<%_';
    const closeDelim = isLast ? block.closeDelim : '_%>';
    const trimmedTag = tag.trim();

    if (!isFirst && trimmedTag.startsWith('}')) {
      relativeDepth = Math.max(0, relativeDepth - 1);
    }

    const prefix = block.expectedIndent + '  '.repeat(relativeDepth);
    resultParts.push(`${prefix}${openDelim} ${trimmedTag} ${closeDelim}`);

    if (trimmedTag.endsWith('{')) {
      relativeDepth++;
    }
  }
  return resultParts.join('\n');
}

function buildIndentedTag(block: TagBlock, options?: { normalizeContent?: boolean }): string {
  const normalizeContent = options?.normalizeContent ?? false;
  const tagText = `${block.openDelim}${block.codeContent}${block.closeDelim}`;

  if (!tagText.includes('\n')) {
    return `${block.expectedIndent}${tagText}`;
  }

  // Multiline tag: trim content start, indent content lines to align with
  // the position after the opening delimiter and space:
  // contentIndent = expectedIndent + openDelim.length + 1 (for space)
  const content = block.codeContent.trim();
  const contentLines = content.split('\n');
  const normalizedContentIndent = ' '.repeat(block.expectedIndent.length + block.openDelim.length + 1);

  const lines: string[] = [];

  // First line: opening delimiter + first content line (with space)
  const firstLine = contentLines[0].trimStart();
  lines.push(`${block.expectedIndent}${block.openDelim} ${firstLine}`);

  // Middle lines:
  // - normalizeContent=true  -> normalize each line to content-level indentation
  // - normalizeContent=false -> preserve internal line indentation
  for (let i = 1; i < contentLines.length; i++) {
    if (normalizeContent) {
      const trimmedLine = contentLines[i].trimStart();
      lines.push(`${normalizedContentIndent}${trimmedLine}`);
    } else {
      lines.push(contentLines[i]);
    }
  }

  // Last line: closing delimiter with same indent as opening tag
  lines.push(`${block.expectedIndent}${block.closeDelim}`);

  return lines.join('\n');
}

function buildFormattedTag(block: TagBlock, options?: { multilineCloseOnNewLine?: boolean }): string {
  const multilineCloseOnNewLine = options?.multilineCloseOnNewLine ?? false;
  const trimmedContent = block.codeContent.trim();
  const wasMultiline = block.codeContent.includes('\n');
  const isSlurpOpenTag = block.openDelim === '<%_';

  if (trimmedContent.length === 0) {
    return `${block.openDelim} ${block.closeDelim}`;
  }

  if (!multilineCloseOnNewLine || !wasMultiline || !isSlurpOpenTag) {
    return `${block.openDelim} ${trimmedContent} ${block.closeDelim}`;
  }

  const lines = trimmedContent.split('\n').map((line) => line.trimEnd());
  return `${block.openDelim} ${lines.join('\n')}\n${block.lineIndent}${block.closeDelim}`;
}

/**
 * Translate an ESLint fix object from the virtual JS code space back to the
 * original EJS source space.
 *
 * Three fix kinds are supported:
 *
 * **Sentinel fixes** (from plugin rules): the plugin rules report a fix that
 * replaces the virtual marker comment (`//@ejs-tag:<type>`) with either an
 * empty string or a rule-specific sentinel text.  Those fixes always start at
 * offset 0.  They are translated using the `TagBlock` metadata to produce a
 * meaningful replacement in the original EJS source.
 *
 * - Generic sentinel (`text === ''`): used by `prefer-raw`, `prefer-slurping-codeonly`,
 *   `prefer-single-line-tags`, `indent`.
 * - `SENTINEL_PREFER_SLURP_MULTILINE`: used by `experimental-prefer-slurp-multiline` to avoid
 *   collision with `prefer-single-line-tags` for `code-multiline`/`code-slurpable-multiline`
 *   tag types.
 * - `SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES`: used by
 *   `prefer-single-line-tags` when configured with `{ mode: 'braces' }`.
 * - `SENTINEL_SLURP_NEWLINE`: used by `slurp-newline`.
 *
 * **General JS fixes** (from standard ESLint rules such as `no-var`,
 * `prefer-const`, etc.): the fix offsets are positions within the virtual
 * code's `codeContent` portion.  They are translated by mapping the virtual
 * code offsets back to the corresponding positions in the original EJS source:
 *
 * ```
 * codeContentStart = markerLen
 * originalOffset   = tagOffset + openDelim.length + (virtualOffset - codeContentStart)
 * ```
 */
function translateFix(
  fix: { range: [number, number]; text: string },
  block: TagBlock,
  options?: { applyIndentForSingleLineTags?: boolean },
): { range: [number, number]; text: string } | null {
  const { javascriptPartialNode } = block;
  if (!javascriptPartialNode) {
    // Should not happen since we only call this on blocks with a successful JS parse, but guard just in case.
    throw new Error(
      `Cannot translate fix for block at line ${String(block.tagLine)} due to missing javascriptPartialNode.`,
    );
  }
  const applyIndentForSingleLineTags = options?.applyIndentForSingleLineTags ?? false;
  const trimmedCodeContent = block.codeContent.trim();
  // ── Sentinel fix detection ─────────────────────────────────────────────
  // All plugin-rule sentinels start at offset 0 in the virtual file.
  if (fix.range[0] !== 0) {
    // Fall through to the general JS fix handler below.
  } else if (fix.text === SENTINEL_PREFER_SLURP_MULTILINE) {
    // experimental-prefer-slurp-multiline: change multiline `<% … %>` → `<%_ … _%>` (content unchanged)
    if (block.tagType === 'code-multiline' || block.tagType === 'code-slurpable-multiline') {
      return {
        range: [block.tagOffset, block.tagOffset + block.tagLength],
        text: `<%_ ${trimmedCodeContent} _%>`,
      };
    }
    return null;
  } else if (fix.text === SENTINEL_SLURP_NEWLINE) {
    // slurp-newline: insert a newline before a non-standalone slurp tag
    if (block.tagType === 'slurp-not-standalone') {
      return {
        range: [block.tagOffset, block.tagOffset],
        text: '\n',
      };
    }
    return null;
  } else if (fix.text === SENTINEL_INDENT) {
    // indent: fix standalone <%_ _%> indentation (single-line and multiline)
    if (block.tagType.startsWith('slurp-needs-indent')) {
      // Replace from line start through full tag; in default mode only the
      // start/end boundaries are adjusted for multiline content.
      const indentStart = block.tagOffset - block.tagColumn;
      return {
        range: [indentStart, block.tagOffset + block.tagLength],
        text: buildIndentedTag(block, { normalizeContent: false }),
      };
    }
    return null;
  } else if (fix.text === SENTINEL_INDENT_NORMALIZE) {
    // indent (normalizeContent=true): normalize multiline content indentation too.
    if (block.tagType.startsWith('slurp-needs-indent')) {
      const indentStart = block.tagOffset - block.tagColumn;
      return {
        range: [indentStart, block.tagOffset + block.tagLength],
        text: buildIndentedTag(block, { normalizeContent: true }),
      };
    }
    return null;
  } else if (fix.text === SENTINEL_FORMAT || fix.text === SENTINEL_FORMAT_MULTILINE_CLOSE) {
    const multilineCloseOnNewLine = fix.text === SENTINEL_FORMAT_MULTILINE_CLOSE;
    const originalText = block.openDelim + block.codeContent + block.closeDelim;
    const fixedText = buildFormattedTag(block, { multilineCloseOnNewLine });
    if (fixedText === originalText) {
      return null;
    }
    return {
      range: [block.tagOffset, block.tagOffset + block.tagLength],
      text: fixedText,
    };
  } else if (fix.text === SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES) {
    // prefer-single-line-tags (mode=braces): collapse multiline tag while
    // keeping content between braces in a single tag.
    if (block.tagType.endsWith('-multiline')) {
      if (!javascriptPartialNode.hasStructuralBraces) {
        return null;
      }
      const originalText = block.openDelim + block.codeContent + block.closeDelim;
      const fixedText = buildCollapsedTagWithMode(block, 'braces', {
        applyIndent: applyIndentForSingleLineTags,
      });
      if (fixedText === originalText) {
        return null;
      }
      const bracesModeIndentStart =
        applyIndentForSingleLineTags && block.isStandalone ? block.tagOffset - block.tagColumn : block.tagOffset;
      return {
        range: [bracesModeIndentStart, block.tagOffset + block.tagLength],
        text: fixedText,
      };
    }
    return null;
  } else if (fix.text === '') {
    // ── Generic sentinel (fix.text === '') ────────────────────────────────

    // prefer-raw: change `<%=` → `<%-`
    if (block.tagType === 'escaped-output') {
      return { range: [block.tagOffset + 2, block.tagOffset + 3], text: '-' };
    }

    // prefer-slurping-codeonly: change `<% … %>` → `<%_ … _%>` (content unchanged)
    if (block.tagType === 'code-slurpable') {
      return {
        range: [block.tagOffset, block.tagOffset + block.tagLength],
        text: `<%_ ${trimmedCodeContent} _%>`,
      };
    }

    // prefer-single-line-tags: collapse multiline tag into single-line tag(s).
    if (block.tagType.endsWith('-multiline')) {
      const indentStart =
        applyIndentForSingleLineTags && block.isStandalone ? block.tagOffset - block.tagColumn : block.tagOffset;
      return {
        range: [indentStart, block.tagOffset + block.tagLength],
        text: buildCollapsedTag(
          { ...block, codeContent: trimmedCodeContent },
          { applyIndent: applyIndentForSingleLineTags },
        ),
      };
    }

    return null;
  } else {
    // Not a recognised sentinel; fall through to general JS fix handler.
  }

  if (fix.range[0] === 0 && fix.text !== '') {
    // Non-empty text at range[0]=0 that is not a recognised sentinel – skip.
    return null;
  }

  // ── General JS fix ─────────────────────────────────────────────────────
  // The virtual code body is:
  //   <codeContent><virtualBodyInlineSuffix><virtualBodyExtraLine>
  //
  // codeContent starts at byte offset:
  //   codeContentStart = markerLen
  //
  // where markerLen = '//@ejs-tag:'.length + tagType.length + 1  (+1 for '\n')
  const markerLen = '//@ejs-tag:'.length + block.tagType.length + 1;
  const codeContentStart = markerLen;
  const codeContentEnd = codeContentStart + block.codeContent.length;

  // Guard: only translate fixes that target the actual codeContent region.
  if (fix.range[0] < codeContentStart || fix.range[0] >= codeContentEnd) {
    return null;
  }

  const codeStartOffset = block.tagOffset + block.openDelim.length;
  return {
    range: [codeStartOffset + (fix.range[0] - codeContentStart), codeStartOffset + (fix.range[1] - codeContentStart)],
    text: fix.text,
  };
}

// ---------------------------------------------------------------------------
// Per-file block map
// ---------------------------------------------------------------------------

interface VirtualBlockSegment {
  block: TagBlock;
  /** 1-based start line of this block inside the combined virtual file. */
  startLine: number;
  /** 1-based end line of this block inside the combined virtual file. */
  endLine: number;
  /** 0-based start offset of this block inside the combined virtual file. */
  startOffset: number;
  /** 0-based end offset (exclusive) of this block inside the combined virtual file. */
  endOffset: number;
}

const processedFilesMap = new Map<
  string,
  {
    ejsNodes: EjsSyntaxNode[];
    javascriptVitualCode: VitualJavascriptCode;
  }
>();

const fileBlocksMap = new Map<
  string,
  {
    segments: VirtualBlockSegment[];
    rawSegments: VirtualBlockSegment[];
  }
>();
const structuralControlByVirtualCodeMap = new Map<string, boolean[]>();

interface TagFormatState {
  isFormattedDefault: boolean;
  isFormattedMultilineClose: boolean;
}
const tagFormatByVirtualCodeMap = new Map<string, TagFormatState[]>();

export function getStructuralControlByVirtualCode(virtualCode: string): boolean[] | undefined {
  return structuralControlByVirtualCodeMap.get(virtualCode);
}

export function getTagFormatByVirtualCode(virtualCode: string): TagFormatState[] | undefined {
  return tagFormatByVirtualCodeMap.get(virtualCode);
}

function translateRawParserFatalMessage(message: string): string {
  return message;
}

function logVirtualCodeOnFatal(
  filename: string,
  virtualMessages: Linter.LintMessage[],
  segments: VirtualBlockSegment[],
): void {
  const fatalMessages = virtualMessages.filter((msg) => msg.fatal);
  if (fatalMessages.length === 0) return;

  const renderedErrors = fatalMessages
    .map(
      (msg) =>
        `- line ${String(msg.line)}, col ${String(msg.column)}: ${msg.message}${msg.ruleId ? ` [${msg.ruleId}]` : ''}`,
    )
    .join('\n');
  const virtualCode = `${GLOBAL_VIRTUAL_OPEN}${segments.map((s) => s.block.virtualCode).join('\n')}${GLOBAL_VIRTUAL_CLOSE}`;
  debug(
    `[ejs-templates] ESLint fatal error while processing ${filename}:\n${renderedErrors}\nVirtual code:\n${virtualCode}`,
  );
}

function formatRuleListForUnusedDirective(ruleIds: string[]): string {
  const quoted = ruleIds.map((ruleId) => `'${ruleId}'`);
  if (quoted.length === 1) {
    return quoted[0];
  }
  if (quoted.length === 2) {
    return `${quoted[0]} and ${quoted[1]}`;
  }
  return `${quoted.slice(0, -1).join(', ')}, and ${quoted[quoted.length - 1]}`;
}

function extractUnusedDirectiveRuleIds(message: string): string[] {
  return [...message.matchAll(/'([^']+)'/gu)].map((m) => m[1]);
}

function findMatchingEnableDirective(
  blocks: TagBlock[],
  currentBlockIndex: number,
): { block: TagBlock; index: number } | null {
  const currentBlock = blocks[currentBlockIndex];
  if (!currentBlock.isDirectiveComment) {
    return null;
  }

  const currentDirectiveMatch = currentBlock.codeContent.match(/^eslint-disable(?:-next-line)?(?:\s+(.*))?$/u);
  if (!currentDirectiveMatch) {
    return null;
  }

  const [, currentRuleListRaw = ''] = currentDirectiveMatch;
  const ruleListText = currentRuleListRaw.trim();
  if (ruleListText.length === 0) {
    // eslint-disable with no explicit rule list matches eslint-enable with no rule list
    for (let i = currentBlockIndex + 1; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.isDirectiveComment && /^eslint-enable(?:\s|$)/u.test(block.codeContent)) {
        const enableMatch = block.codeContent.match(/^eslint-enable(?:\s+(.*))?$/u);
        if (enableMatch && (!enableMatch[1] || enableMatch[1].trim().length === 0)) {
          return { block, index: i };
        }
      }
    }
  } else {
    // eslint-disable with explicit rules matches eslint-enable with same rules (in any order)
    const disableRuleIds = new Set(
      ruleListText
        .split(',')
        .map((r) => r.trim())
        .filter((r) => r.length > 0),
    );

    for (let i = currentBlockIndex + 1; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.isDirectiveComment && /^eslint-enable(?:\s|$)/u.test(block.codeContent)) {
        const enableMatch = block.codeContent.match(/^eslint-enable(?:\s+(.*))?$/u);
        if (enableMatch) {
          const [, enableRuleListRaw = ''] = enableMatch;
          const enableRuleListText = enableRuleListRaw.trim();
          if (enableRuleListText.length === 0) {
            // eslint-enable with no rules matches any disable (stops at first enable)
            return { block, index: i };
          }
          const enableRuleIds = new Set(
            enableRuleListText
              .split(',')
              .map((r) => r.trim())
              .filter((r) => r.length > 0),
          );
          if (disableRuleIds.size === enableRuleIds.size && [...disableRuleIds].every((r) => enableRuleIds.has(r))) {
            return { block, index: i };
          }
        }
      }
    }
  }

  return null;
}

function translateUnusedDirectiveFix(
  msg: Linter.LintMessage,
  block: TagBlock,
  blocks?: TagBlock[],
  blockIndex?: number,
): {
  disableFix: { range: [number, number]; text: string };
  enableBlock?: TagBlock;
  enableFix?: { range: [number, number]; text: string };
} | null {
  if (!block.isDirectiveComment || msg.ruleId !== null || !/^Unused eslint-disable directive/u.test(msg.message)) {
    return null;
  }

  const directiveMatch = block.codeContent.match(/^eslint-disable(?:-next-line)?(?:\s+(.*))?$/u);
  if (!directiveMatch) {
    return null;
  }

  const [, ruleListRaw = ''] = directiveMatch;
  const ruleListText = ruleListRaw.trim();
  if (ruleListText.length === 0) {
    // `eslint-disable` with no explicit rule list: drop the whole directive tag.
    return {
      disableFix: {
        range: [block.tagOffset, block.tagOffset + block.tagLength],
        text: '',
      },
    };
  }

  const currentRuleIds = ruleListText
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  const unusedRuleIds = new Set(extractUnusedDirectiveRuleIds(msg.message));
  if (unusedRuleIds.size === 0) {
    return null;
  }

  const remainingRuleIds = currentRuleIds.filter((ruleId) => !unusedRuleIds.has(ruleId));
  if (remainingRuleIds.length === currentRuleIds.length) {
    return null;
  }

  let disableFix: { range: [number, number]; text: string };

  if (remainingRuleIds.length === 0) {
    disableFix = {
      range: [block.tagOffset, block.tagOffset + block.tagLength],
      text: '',
    };
  } else {
    disableFix = {
      range: [block.tagOffset, block.tagOffset + block.tagLength],
      text: `<%# eslint-disable ${remainingRuleIds.join(', ')} ${block.closeDelim}`,
    };
  }

  // Look for matching eslint-enable directive if we have segments info
  const result: {
    disableFix: { range: [number, number]; text: string };
    enableBlock?: TagBlock;
    enableFix?: { range: [number, number]; text: string };
  } = {
    disableFix,
  };

  if (blocks && blockIndex !== undefined) {
    const matchingEnable = findMatchingEnableDirective(blocks, blockIndex);
    if (matchingEnable) {
      const enableRuleListMatch = matchingEnable.block.codeContent.match(/^eslint-enable(?:\s+(.*))?$/u);
      if (enableRuleListMatch) {
        const [, enableRuleListRaw = ''] = enableRuleListMatch;
        const enableRuleListText = enableRuleListRaw.trim();
        if (enableRuleListText.length === 0) {
          // enable has no rule list, no need to update
        } else {
          // Update enable directive to match the remaining rules
          result.enableBlock = matchingEnable.block;
          if (remainingRuleIds.length === 0) {
            result.enableFix = {
              range: [matchingEnable.block.tagOffset, matchingEnable.block.tagOffset + matchingEnable.block.tagLength],
              text: '',
            };
          } else {
            result.enableFix = {
              range: [matchingEnable.block.tagOffset, matchingEnable.block.tagOffset + matchingEnable.block.tagLength],
              text: `<%# eslint-enable ${remainingRuleIds.join(', ')} ${matchingEnable.block.closeDelim}`,
            };
          }
        }
      }
    }
  }

  return result;
}

function normalizeUnusedDisableDirectiveMessage(
  msg: Linter.LintMessage,
  options?: { ignoreEjsTemplateRules?: boolean },
): Linter.LintMessage | null {
  const ignoreEjsTemplateRules = options?.ignoreEjsTemplateRules ?? false;
  if (msg.ruleId !== null || !/^Unused eslint-disable directive/u.test(msg.message)) {
    return msg;
  }

  const allRuleIds = [...msg.message.matchAll(/'([^']+)'/gu)].map((m) => m[1]);
  if (allRuleIds.length === 0) {
    return msg;
  }

  if (!ignoreEjsTemplateRules) {
    return msg;
  }

  const remainingRuleIds = allRuleIds.filter((ruleId) => !ruleId.startsWith('ejs-templates/'));
  if (remainingRuleIds.length === allRuleIds.length) {
    return msg;
  }
  if (remainingRuleIds.length === 0) {
    return null;
  }

  return {
    ...msg,
    message: `Unused eslint-disable directive (no problems were reported from ${formatRuleListForUnusedDirective(remainingRuleIds)}).`,
  };
}

export const getEjsNodes = (text: string): EjsSyntaxNode[] => {
  const tree = parseEjs(text);
  if (tree.rootNode.hasError) {
    const errorNode = findErrorNode(tree.rootNode);
    if (!errorNode) {
      throw new Error('Unexpectedly did not find error node in tree with hasError=true');
    }
    const error = new Error(
      `Failed to parse EJS template at line ${String(errorNode.startPosition.row + 1)}, column ${String(errorNode.startPosition.column + 1)}: unexpected token '${text.slice(errorNode.startIndex, errorNode.endIndex)}'`,
    ) as Error & { line: number; column: number };
    error.line = errorNode.startPosition.row + 1;
    error.column = errorNode.startPosition.column + 1;
    throw error;
  }

  return tree.rootNode.children.map((node) => {
    (node as EjsSyntaxNode).linePrefix = text.slice(node.startIndex - node.startPosition.column, node.startIndex);
    return node as EjsSyntaxNode;
  });
};

const buildVirtualCode = (nodes: SyntaxNode[]): VitualJavascriptCode => {
  const codeNodes = nodes.filter((n) => ['output_directive', 'directive'].includes(n.type)).map((n) => n.children[1]);
  let virtualCode: string = '';
  const nodeWithPositions: { node: SyntaxNode; startOffset: number; endOffset: number }[] = [];
  for (const node of codeNodes) {
    virtualCode += node.text + '\n';
    nodeWithPositions.push({
      node,
      startOffset: virtualCode.length - node.text.length - 1,
      endOffset: virtualCode.length - 1,
    });
  }
  return {
    virtualCode,
    getPosition(offset: number) {
      for (const { node, startOffset, endOffset } of nodeWithPositions) {
        if (offset >= startOffset && offset <= endOffset) {
          return {
            node,
            startOffset,
            endOffset,
          };
        }
      }
      return null;
    },
  };
};

// ---------------------------------------------------------------------------
// ESLint processor
// ---------------------------------------------------------------------------

/**
 * ESLint processor for `.ejs` files.
 *
 * Each non-comment EJS tag is transformed into a virtual JavaScript block and
 * all blocks are concatenated, in source order, into a single incremental
 * virtual file for ESLint.
 *
 * Every per-tag block contains the original tag content (no synthetic
 * per-block braces).  The first line of every per-tag block is a single-line
 * comment (`//@ejs-tag:<type>`) that encodes the tag type so plugin rules can
 * detect EJS-specific patterns.  Global brace balancing (synthetic `}`
 * characters) is appended before the IIFE close when the cumulative net brace
 * delta across all tags is positive, keeping isolated unbalanced fragments
 * parseable while still handling cross-tag constructs like `forEach(x => { … })`
 * correctly.
 *
 * Parsing is backed by tree-sitter-embedded-template for accurate position
 * information and robust syntax handling.
 */
export const processor: Linter.Processor = {
  meta: { name: 'ejs' },

  preprocess(text: string, filename: string): Array<string | { text: string; filename: string }> {
    const ejsNodes = getEjsNodes(text);
    const javascriptVitualCode = buildVirtualCode(ejsNodes);
    processedFilesMap.set(filename, {
      ejsNodes,
      javascriptVitualCode,
    });
    const blocks = extractTagBlocks(ejsNodes);
    if (blocks.length === 0) {
      fileBlocksMap.set(filename, { segments: [], rawSegments: [] });
      return [];
    }

    const segments: VirtualBlockSegment[] = [];
    const rawSegments: VirtualBlockSegment[] = [];
    let lineCursor = 2;
    let offsetCursor = GLOBAL_VIRTUAL_OPEN.length;
    let rawLineCursor = 1;
    let rawOffsetCursor = 0;

    for (const block of blocks) {
      const lineCount = block.virtualCode.split('\n').length;
      const startLine = lineCursor;
      const endLine = startLine + lineCount - 1;
      const startOffset = offsetCursor;
      const endOffset = startOffset + block.virtualCode.length;

      segments.push({ block, startLine, endLine, startOffset, endOffset });

      const rawStartLine = rawLineCursor;
      const rawEndLine = rawStartLine + lineCount - 1;
      const rawStartOffset = rawOffsetCursor;
      const rawEndOffset = rawStartOffset + block.virtualCode.length;

      rawSegments.push({
        block,
        startLine: rawStartLine,
        endLine: rawEndLine,
        startOffset: rawStartOffset,
        endOffset: rawEndOffset,
      });

      // Combined virtual file joins each block with a single newline.
      lineCursor += lineCount;
      offsetCursor += block.virtualCode.length + 1;
      rawLineCursor += lineCount;
      rawOffsetCursor += block.virtualCode.length + 1;
    }

    fileBlocksMap.set(filename, { segments, rawSegments });

    const joinedBlocksVirtualCode = blocks.map((b) => b.virtualCode).join('\n');
    const virtualCode = `${GLOBAL_VIRTUAL_OPEN}${joinedBlocksVirtualCode}${GLOBAL_VIRTUAL_CLOSE}`;
    structuralControlByVirtualCodeMap.set(
      virtualCode,
      blocks
        .filter((block) => !block.isDirectiveComment)
        .map((block) => block.javascriptPartialNode?.hasStructuralBraces ?? false),
    );
    tagFormatByVirtualCodeMap.set(
      virtualCode,
      blocks
        .filter((block) => !block.isDirectiveComment)
        .map((block) => {
          const originalText = block.openDelim + block.codeContent + block.closeDelim;
          return {
            isFormattedDefault: originalText === buildFormattedTag(block, { multilineCloseOnNewLine: false }),
            isFormattedMultilineClose: originalText === buildFormattedTag(block, { multilineCloseOnNewLine: true }),
          };
        }),
    );

    // Second pass target: full virtual JS with no wrapper.
    const rawVirtualCode = joinedBlocksVirtualCode;
    // Third pass target: wrapped raw virtual used only when `return` requires a function body.
    const wrappedRawVirtualCode = `${GLOBAL_VIRTUAL_OPEN}${joinedBlocksVirtualCode}${GLOBAL_VIRTUAL_CLOSE}`;

    return [virtualCode, rawVirtualCode, wrappedRawVirtualCode];
  },

  postprocess(messages: Linter.LintMessage[][], filename: string): Linter.LintMessage[] {
    const processedFile = processedFilesMap.get(filename);
    if (!processedFile) {
      throw new Error(`Unexpectedly did not find processed file data for ${filename}`);
    }
    const fullTree = parseJavaScript(processedFile.javascriptVitualCode.virtualCode);
    if (fullTree.rootNode.hasError) {
      const errorNode = findErrorNode(fullTree.rootNode);
      if (!errorNode) {
        throw new Error('Unexpectedly did not find error or missing node in tree with hasError=true');
      }
      const ejsErrorNode = processedFile.javascriptVitualCode.getPosition(errorNode.startIndex);
      let line = 1;
      let column = 1;
      let endLine = 1;
      let endColumn = 1;
      if (ejsErrorNode) {
        const { startPosition } = ejsErrorNode.node;
        const { row: endPositionRow, column: endPositionColumn } = errorNode.endPosition;
        line = startPosition.row + 1;
        column = startPosition.column + errorNode.startPosition.column + 1;
        endLine = startPosition.row + endPositionRow + 1;
        endColumn = startPosition.column + endPositionColumn + 1;
      }
      fullTree.delete();
      return [
        {
          fatal: true,
          ruleId: null,
          severity: 2,
          message: `Failed to parse virtual JavaScript code generated from EJS template, ${errorNode.isError ? 'Unexpected' : 'Missing'} token: ${errorNode.text}`,
          line,
          column,
          endLine,
          endColumn,
        },
      ];
    }
    fullTree.delete();

    const { segments = [], rawSegments = [] } = fileBlocksMap.get(filename) ?? {};
    fileBlocksMap.delete(filename);
    const currentVirtualCode = `${GLOBAL_VIRTUAL_OPEN}${segments.map((s) => s.block.virtualCode).join('\n')}${GLOBAL_VIRTUAL_CLOSE}`;
    structuralControlByVirtualCodeMap.delete(currentVirtualCode);
    tagFormatByVirtualCodeMap.delete(currentVirtualCode);

    if (segments.length === 0) {
      return [];
    }

    // Even in a single incremental virtual file, each tag is still wrapped in
    // its own function block for parseability/fix mapping.  This can trigger
    // false positives for rules that require cross-tag flow/scope.
    const suppressedRuleIds = new Set(['no-undef']);

    const virtualMessages = messages[0] ?? [];
    logVirtualCodeOnFatal(filename, virtualMessages, segments);
    const hasIndentMessages = virtualMessages.some((msg) => msg.ruleId === 'ejs-templates/indent');

    const mappedMessages = virtualMessages
      .filter((msg) => !msg.fatal && !suppressedRuleIds.has(msg.ruleId ?? ''))
      .flatMap((msg) => {
        const normalizedMsg = normalizeUnusedDisableDirectiveMessage(msg, { ignoreEjsTemplateRules: false });
        if (!normalizedMsg) {
          return [];
        }

        const segmentIndex = segments.findIndex(
          (s) => normalizedMsg.line >= s.startLine && normalizedMsg.line <= s.endLine,
        );
        if (segmentIndex === -1) {
          return [];
        }
        const segment = segments[segmentIndex];

        // Convert global (combined-file) positions to per-block positions.
        const localMsg: Linter.LintMessage = {
          ...normalizedMsg,
          line: normalizedMsg.line - segment.startLine + 1,
          column: normalizedMsg.column,
        };

        if (normalizedMsg.endLine !== undefined) {
          localMsg.endLine = normalizedMsg.endLine - segment.startLine + 1;
          localMsg.endColumn = normalizedMsg.endColumn;
        }

        if (normalizedMsg.fix) {
          const [start, end] = normalizedMsg.fix.range;
          if (start >= segment.startOffset && end <= segment.endOffset) {
            localMsg.fix = {
              range: [start - segment.startOffset, end - segment.startOffset],
              text: normalizedMsg.fix.text,
            };
          } else {
            delete localMsg.fix;
          }
        }

        const mapped = mapMessage(localMsg, segment.block);

        if (mapped.fix) {
          const blocks = segments.map((s) => s.block);
          const unusedDirectiveFixResult = translateUnusedDirectiveFix(mapped, segment.block, blocks, segmentIndex);
          if (unusedDirectiveFixResult) {
            const result: Linter.LintMessage[] = [];
            result.push({ ...mapped, fix: unusedDirectiveFixResult.disableFix });
            // Handle enable directive fix in a separate message(s)
            if (unusedDirectiveFixResult.enableBlock && unusedDirectiveFixResult.enableFix) {
              // Find the virtual block range for the enable directive to calculate correct position
              const enableBlockIndex = blocks.indexOf(unusedDirectiveFixResult.enableBlock);
              if (enableBlockIndex !== -1) {
                const enableSegment = segments[enableBlockIndex];
                const enableMappedMsg = mapMessage(
                  {
                    ruleId: null,
                    message: 'Unused eslint-disable directive',
                    severity: 2,
                    line: enableSegment.startLine + 1,
                    column: 1,
                  },
                  unusedDirectiveFixResult.enableBlock,
                );
                result.push({ ...enableMappedMsg, fix: unusedDirectiveFixResult.enableFix });
              }
            }
            return result;
          }

          const translated = translateFix(mapped.fix, segment.block, {
            applyIndentForSingleLineTags: hasIndentMessages,
          });
          if (translated) {
            return [{ ...mapped, fix: translated }];
          }
          // No translation available – drop the fix.
          const result = { ...mapped };
          delete result.fix;
          return [result];
        }

        segment.block.javascriptPartialNode?.cleanup();
        return [mapped];
      });

    const rawValidationMessages = messages[1] ?? [];
    const wrappedRawValidationMessages = messages[2] ?? [];
    const shouldFallbackToWrappedRaw = rawValidationMessages.some(
      (msg) => msg.fatal && /\breturn\b/u.test(msg.message),
    );
    const finalValidationMessages = shouldFallbackToWrappedRaw ? wrappedRawValidationMessages : rawValidationMessages;
    const finalValidationSegments = shouldFallbackToWrappedRaw ? segments : rawSegments;

    const mappedRawValidationMessages = finalValidationMessages
      .filter((msg) => !suppressedRuleIds.has(msg.ruleId ?? ''))
      .flatMap((msg) => {
        const normalizedMsg = normalizeUnusedDisableDirectiveMessage(msg, { ignoreEjsTemplateRules: true });
        if (!normalizedMsg) {
          return [];
        }

        const segment = finalValidationSegments.find(
          (s) => normalizedMsg.line >= s.startLine && normalizedMsg.line <= s.endLine,
        );
        if (!segment) {
          if (normalizedMsg.fatal) {
            const lastSegment = segments[segments.length - 1];
            const block = lastSegment.block;

            let line = block.originalLine;
            let column = block.originalColumn + 1;

            for (const ch of block.codeContent) {
              if (ch === '\n') {
                line += 1;
                column = 1;
              } else {
                column += 1;
              }
            }

            const fatalMsg: Linter.LintMessage = {
              ...normalizedMsg,
              message: translateRawParserFatalMessage(normalizedMsg.message),
              line,
              column,
            };
            delete fatalMsg.fix;
            return [fatalMsg];
          }
          return [];
        }

        const localMsg: Linter.LintMessage = {
          ...normalizedMsg,
          line: normalizedMsg.line - segment.startLine + 1,
          column: normalizedMsg.column,
        };

        if (normalizedMsg.endLine !== undefined) {
          localMsg.endLine = normalizedMsg.endLine - segment.startLine + 1;
          localMsg.endColumn = normalizedMsg.endColumn;
        }

        delete localMsg.fix;
        return [mapMessage(localMsg, segment.block)];
      });

    // Keep primary diagnostics and append only unique entries from raw validation.
    const toKey = (msg: Linter.LintMessage): string =>
      `${msg.ruleId ?? ''}|${String(msg.fatal ?? false)}|${String(msg.line)}|${String(msg.column)}|${msg.message}`;

    const seen = new Set(mappedMessages.map(toKey));
    const uniqueRawMessages = mappedRawValidationMessages.filter((msg) => {
      const key = toKey(msg);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    const formatMessages = mappedMessages.filter((msg) => msg.ruleId === 'ejs-templates/format');
    const nonFormatMessages = mappedMessages.filter((msg) => msg.ruleId !== 'ejs-templates/format');

    // Keep `format` fixes last so all structural/semantic fixes and validations
    // run first, and formatting is applied as a final normalization step.
    return [...nonFormatMessages, ...uniqueRawMessages, ...formatMessages];
  },

  supportsAutofix: true,
};
