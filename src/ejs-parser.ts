import { parseJavaScriptPartial, type RelativeJavascriptNode } from './javascript-parser.js';
import { findErrorNode, parseEjs, type SyntaxNode } from './ts-parser.js';

export type EjsSyntaxNode = SyntaxNode & { linePrefix: string };

export const EJS_MARKER_PREFIX = '@ejs-tag:';

export const getTagTypeFromLine = (line: string): EjsTagType | null => {
  line = line.trim();
  if (!line.startsWith(EJS_MARKER_PREFIX)) return null;
  const tagType = line.slice(EJS_MARKER_PREFIX.length);
  // Matched against the known set rather than asserted: the marker is read back out of the
  // virtual file, so anything unrecognised should be reported as "no tag type" rather than
  // travelling on as a tag type the rest of the code will never match.
  return EJS_TAG_TYPES.find((known) => known === tagType) ?? null;
};

const _TAG_TYPES_WITH_MULTILINE = [
  'escaped-output',
  'raw-output',
  'slurp',
  'code',
  'code-slurpable',
  'slurp-needs-indent',
] as const;
const _TAG_TYPES = ['directive-comment', 'comment-empty-line', 'slurp-not-standalone'] as const;
type EjsBaseTagType = (typeof _TAG_TYPES_WITH_MULTILINE)[number];
type EjsTagType = EjsBaseTagType | (typeof _TAG_TYPES)[number] | `${EjsBaseTagType}-multiline`;

/** Every value {@link EjsTagType} admits, for validating a marker read back out of a file. */
const EJS_TAG_TYPES: readonly EjsTagType[] = [
  ..._TAG_TYPES_WITH_MULTILINE,
  ..._TAG_TYPES,
  ..._TAG_TYPES_WITH_MULTILINE.map((base): EjsTagType => `${base}-multiline`),
];

const EJS_OPENING_DELIMS = ['<%=', '<%-', '<%_', '<%#', '<%'] as const;
const EJS_CLOSING_DELIMS = ['-%>', '_%>', '%>'] as const;
type EjsOpeningDelimiter = (typeof EJS_OPENING_DELIMS)[number];
type EjsClosingDelimiter = (typeof EJS_CLOSING_DELIMS)[number];

/**
 * Whether tree-sitter absorbed the `_` of a `_%>` close delimiter into this tag's code node.
 *
 * tree-sitter-embedded-template ends an output tag's code node one character too late when the
 * tag closes with `_%>`, leaving `%>` as the delimiter and a stray `_` at the end of the code
 * (tree-sitter/tree-sitter-embedded-template#46). Left uncorrected the `_` reaches the
 * JavaScript parser and makes the whole file fail to lint.
 */
export const hasAbsorbedSlurpClose = (node: SyntaxNode): boolean =>
  node.type === 'output_directive' &&
  node.text.endsWith('_%>') &&
  node.children[node.childCount - 1]?.text === '%>' &&
  (node.children[1]?.text.endsWith('_') ?? false);

/**
 * Code text of a directive tag, with an absorbed `_` close-delimiter marker removed.
 *
 * Every consumer of a tag's code must go through this: the virtual JavaScript and the tag
 * blocks are built from the same nodes, so correcting only one of them leaves the other
 * carrying the stray `_`.
 */
export const getDirectiveCodeText = (node: SyntaxNode): string => {
  const codeText = node.children[1]?.text ?? '';
  return hasAbsorbedSlurpClose(node) ? codeText.slice(0, -1) : codeText;
};

/** A single extracted EJS tag together with its position in the original file. */
export type TagBlock = {
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
  tagType: EjsTagType;
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
  openDelim: EjsOpeningDelimiter;
  /** Full closing delimiter string (e.g. `%>`, `_%>`, `-%>`). */
  closeDelim: EjsClosingDelimiter;
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
};

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
    throw Object.assign(
      new Error(
        `Failed to parse EJS template at line ${String(errorNode.startPosition.row + 1)}, column ${String(errorNode.startPosition.column + 1)}: unexpected token '${text.slice(errorNode.startIndex, errorNode.endIndex)}'`,
      ),
      { line: errorNode.startPosition.row + 1, column: errorNode.startPosition.column + 1 },
    );
  }

  return tree.rootNode.children.map((node) =>
    Object.assign(node, {
      linePrefix: text.slice(node.startIndex - node.startPosition.column, node.startIndex),
    }),
  );
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
function extractCloseDelimFromEjsComment(commentText: string): EjsClosingDelimiter {
  const delimiters = EJS_CLOSING_DELIMS;
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
  closeDelim?: EjsClosingDelimiter;
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
   * `extractTagBlocks` linear — an ever-growing string made tag N re-parse all
   * preceding tags, giving O(n²) bytes through the parser.
   */
  const openContext: { depth: number; code: string; isContinuation: boolean }[] = [];
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
    closeDelim: EjsClosingDelimiter;
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
    const openDelimText = node.children[0]?.text;
    const closeDelimText = node.children[node.childCount - 1]?.text;
    const openDelim = EJS_OPENING_DELIMS.find((delim) => delim === openDelimText) ?? '<%';
    const parsedCloseDelim = EJS_CLOSING_DELIMS.find((delim) => delim === closeDelimText) ?? '%>';
    const codeNode = node.namedChildren.find((c) => c.type === 'code');
    const parsedCodeContent: string = codeNode?.text ?? '';

    // Correcting the delimiter here, rather than by rewriting the source and re-parsing, keeps
    // the tag's real `_%>` so rules and fixes that rebuild a tag from its delimiters do not
    // quietly drop the newline-slurping the author asked for.
    const absorbedSlurpClose = hasAbsorbedSlurpClose(node);
    const closeDelim: EjsClosingDelimiter = absorbedSlurpClose ? '_%>' : parsedCloseDelim;
    const codeContent: string = absorbedSlurpClose ? parsedCodeContent.slice(0, -1) : parsedCodeContent;
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
      const { missingOpenBracesCount, missingCloseBracesCount, bracesDelta } = javascriptPartialNode;
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
        const superseded = openContext.findIndex((entry) => entry.depth === oldBraceDepth && entry.isContinuation);
        if (superseded !== -1) {
          openContext.splice(superseded, 1);
        }
      }
      openContext.push({ depth: oldBraceDepth, code: lintCodeContent, isContinuation });
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
    let baseType: EjsBaseTagType;
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
    let tagType: EjsTagType = baseType;
    if (isStandalone && isSlurpTag && lineIndent !== expectedIndent) {
      tagType = isMultiline ? 'slurp-needs-indent-multiline' : 'slurp-needs-indent';
    } else if (isMultiline) {
      // Built from `baseType` rather than appended to `tagType`: `+=` widens the result to
      // `string`, which is what previously needed an assertion to narrow back.
      tagType = `${baseType}-multiline`;
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
      `//${EJS_MARKER_PREFIX}${tagType}\n` + `${lintCodeContent}${virtualBodyInlineSuffix}${virtualBodyExtraLine}`;

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
