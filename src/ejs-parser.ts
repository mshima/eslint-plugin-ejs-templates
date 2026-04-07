import { parseJavaScriptPartial, RelativeJavascriptNode } from './javascript-parser.js';
import { findErrorNode, parseEjs, SyntaxNode } from './ts-parser.js';

export type EjsSyntaxNode = SyntaxNode & { linePrefix: string };

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
  /**
   * JS content used in the virtual file sent to ESLint rules.
   *
   * We remove a trailing empty line (or a single trailing blank character) to avoid
   * conflicts with `@stylistic/no-trailing-spaces` against the delimiter
   * boundary, while keeping `codeContent` untouched for source-accurate fixes.
   */
  lintCodeContent: string;
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

const INDENT_UNIT = '  ';

function normalizeLintCodeContent(codeContent: string): string {
  // Remove a single trailing empty line (optionally with indentation).
  if (/(?:\r?\n)[ \t]*$/u.test(codeContent)) {
    return codeContent.replace(/(?:\r?\n)[ \t]*$/u, '');
  }

  // Otherwise remove a single trailing blank character.
  if (/[ \t]$/u.test(codeContent)) {
    return codeContent.slice(0, -1);
  }

  return codeContent;
}

/**
 * Parse an EJS template and extract syntax nodes for tag block extraction.
 *
 * Uses tree-sitter-embedded-template for accurate EJS parsing. If parsing fails,
 * throws a detailed error with line/column position and the offending token.
 *
 * Each returned node is augmented with a `linePrefix` property containing the
 * whitespace/indentation before the node on its line. This is used during
 * tag block extraction to preserve original indentation.
 *
 * @throws Error if the EJS template has syntax errors
 */
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
    lintCodeContent: directiveText,
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
        const closeDelim = extractCloseDelimFromEjsComment(node.text);
        if (isStandalone && closeDelim !== '-%>') {
          blocks.push({
            ejsNode: node,
            virtualCode: '//@ejs-comment-empty-line',
            tagLine,
            tagColumn,
            tagOffset,
            tagLength,
            originalLine: tagLine,
            originalColumn: tagColumn,
            tagType: 'comment-empty-line',
            codeContent: '',
            lintCodeContent: '',
            javascriptPartialNode: undefined,
            openDelim: '<%#',
            closeDelim,
            lineIndent,
            expectedIndent: lineIndent,
            virtualBodyInlineSuffix: '',
            virtualBodyExtraLine: '',
            isStandalone,
            isDirectiveComment: true,
          });
        }
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
    const lintCodeContent = normalizeLintCodeContent(codeContent);
    const javascriptPartialNode = parseJavaScriptPartial(lintCodeContent, incrementalCode);
    const { contentNode } = javascriptPartialNode;

    // ── Brace-depth tracking (for indent) ─────────────────────────────────
    // Updated for EVERY non-comment tag so structural `<% if %>` / `<% } %>`
    // tags are included in the depth count even though we won't indent them.
    const oldBraceDepth = braceDepth;
    // If contentNode doesn't have errors, its a balanced snippet we can just use current depth.
    if (contentNode.hasError) {
      braceDepth += javascriptPartialNode.bracesDelta;
      incrementalCode += lintCodeContent + '\n';
    }

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
    const endsWithOpenBrace = !isMultiline && lintCodeContent.trim().endsWith('{');

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
    const virtualCode =
      `//@ejs-tag:${tagType}\n` + `${lintCodeContent}${virtualBodyInlineSuffix}${virtualBodyExtraLine}`;

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
      lintCodeContent,
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
