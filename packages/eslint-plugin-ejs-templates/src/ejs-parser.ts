import {
  type EjsClosingDelimiter,
  type EjsDiagnostic,
  type EjsOpeningDelimiter,
  type EjsSyntaxNode,
  type EjsTag,
  type EjsTagShape,
  type RelativeJavascriptNode,
} from 'ejs-template-parser';

export const EJS_MARKER_PREFIX = '@ejs-tag:';

/** The type of the block of a code or output tag: its shape, `-multiline` when its code spans lines. */
export type CodeTagType = EjsTagShape | `${EjsTagShape}-multiline`;

/** What the blocks of a template have in common: their tag, its position in the original file, their virtual code. */
type BlockBase = {
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
};

/** The block of a code or output tag, its virtual code its JavaScript after the `//@ejs-tag:<type>` marker. */
export type CodeTagBlock = BlockBase & {
  /** The type of the tag, the one of its marker. */
  tagType: CodeTagType;
  /** The JavaScript of the tag, read in the program of its template. */
  javascriptPartialNode: RelativeJavascriptNode;
  isDirectiveComment: false;
};

/**
 * The block of a comment tag: an ESLint directive (`directive-comment`), its virtual code the comment, or a comment
 * leaving an empty line (`comment-empty-line`), its virtual code a marker for `no-comment-empty-line` to report on.
 */
export type CommentTagBlock = BlockBase & {
  tagType: 'directive-comment' | 'comment-empty-line';
  isDirectiveComment: true;
  /**
   * The half of an `eslint-disable-next-line` comment tag this directive block is: `disable`
   * covers the comment tag itself, `enable` is synthesized after the next tag and carries that
   * tag's position, so it is no tag of its own to fix.
   */
  nextLineDirective?: 'disable' | 'enable' | undefined;
};

/** A single extracted EJS tag together with its position in the original file. */
export type TagBlock = CodeTagBlock | CommentTagBlock;

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

function createDirectiveCommentBlock(params: {
  ejsNode: EjsSyntaxNode;
  directiveText: string;
  tagOffset: number;
  tagLength: number;
  tagLine: number;
  tagColumn: number;
  lineIndent: string;
  isStandalone: boolean;
  closeDelim: EjsClosingDelimiter;
  nextLineDirective?: 'disable' | 'enable' | undefined;
}): CommentTagBlock {
  const {
    ejsNode,
    directiveText,
    tagOffset,
    tagLength,
    tagLine,
    tagColumn,
    lineIndent,
    isStandalone,
    closeDelim,
    nextLineDirective,
  } = params;
  return {
    ejsNode,
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
    closeDelim,
    lineIndent,
    expectedIndent: lineIndent,
    virtualBodyInlineSuffix: '',
    virtualBodyExtraLine: '',
    isStandalone,
    isDirectiveComment: true,
    nextLineDirective,
  };
}

/**
 * Extract each non-comment EJS tag of a template, the `tags` of `buildTemplate()`, as a
 * {@link TagBlock}, plus supported ESLint directive comments written as EJS comments.
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
 * A base type takes the `-multiline` suffix when the content spans lines. The conventions a tag breaks are the
 * diagnostics of ejs-template-parser (`validateTemplate()`), which the rules report and fix by: of the comment tags,
 * only the ones leaving an empty line (`no-comment-empty-line`) have a block, `comment-empty-line`, for the rule to
 * report on.
 *
 * @param tags the tags of the template
 * @param diagnostics the diagnostics of the template, which tell the comment tags leaving an empty line
 */
export function extractTagBlocks(tags: EjsTag[], diagnostics: readonly EjsDiagnostic[] = []): TagBlock[] {
  const blocks: TagBlock[] = [];
  const emptyLineComments = new Set(
    diagnostics.filter(({ code }) => code === 'no-comment-empty-line').map(({ offset }) => offset),
  );

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

  // Each code tag parsed inside the blocks the tags before it left open, with the brace depths around it.
  for (const tag of tags) {
    const { node, offset: tagOffset, length: tagLength, line: tagLine, column: tagColumn, isStandalone } = tag;
    const lineIndent = isStandalone ? tag.linePrefix : '';

    if (tag.type === 'comment') {
      const directiveText = extractEslintDirectiveFromEjsComment(node.text);
      if (!directiveText) {
        const { closeDelim } = tag;
        if (emptyLineComments.has(tagOffset)) {
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
          closeDelim: tag.closeDelim,
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
          closeDelim: tag.closeDelim,
        }),
      );
      continue;
    }

    // The shape of the tag and its indentation at its depth of blocks, as ejs-template-parser classifies them.
    const {
      openDelim,
      closeDelim,
      code: codeContent,
      parsedCode: lintCodeContent,
      javascript: javascriptPartialNode,
      shape: baseType,
      expectedIndent,
      codeLine: originalLine,
      codeColumn: originalColumn,
    } = tag;

    if (pendingNextLineDirective) {
      blocks.push(
        createDirectiveCommentBlock({
          ejsNode: node,
          directiveText: pendingNextLineDirective.disableText,
          tagOffset: pendingNextLineDirective.tagOffset,
          tagLength: pendingNextLineDirective.tagLength,
          tagLine: pendingNextLineDirective.tagLine,
          tagColumn: pendingNextLineDirective.tagColumn,
          lineIndent: pendingNextLineDirective.lineIndent,
          isStandalone: pendingNextLineDirective.isStandalone,
          closeDelim: pendingNextLineDirective.closeDelim,
          nextLineDirective: 'disable',
        }),
      );
    }

    // ── Multiline detection ────────────────────────────────────────────────
    const isMultiline = codeContent.includes('\n');
    const tagType: CodeTagType = isMultiline ? `${baseType}-multiline` : baseType;

    // ── Virtual body extras (void-expression wrapping) ────────────────────
    // For output tags: append `;` so the expression is a valid statement in
    // virtual JS (without introducing global references like `debug`).
    // For code/slurp tags ending with `{`: append `void 0;` to suppress
    // `no-empty` errors on the opened block.
    const isOutputTag = baseType === 'escaped-output' || baseType === 'raw-output';
    const endsWithOpenBrace = !isMultiline && lintCodeContent.trim().endsWith('{');

    let virtualBodyInlineSuffix = '';
    let virtualBodyExtraLine = '';

    if (isOutputTag) {
      // An output tag holds an expression; the `;` makes it a statement in the virtual JS.
      //
      // Applied to multiline tags too, not just single-line ones. Leaving a multiline tag
      // without a terminator makes the virtual statement look unterminated to semicolon rules:
      // `@stylistic/semi` in `always` mode then demands a `;` that `output-semi` in `never`
      // mode removes, and the two fix each other forever (ESLintCircularFixesWarning).
      //
      // Nothing is added when the content already ends with one, so the virtual statement
      // carries exactly one terminator either way rather than a synthetic `;;` for rules to
      // trip over.
      virtualBodyInlineSuffix = lintCodeContent.trimEnd().endsWith(';') ? '' : ';';
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
          directiveText: pendingNextLineDirective.enableText,
          tagOffset,
          tagLength,
          tagLine,
          tagColumn,
          lineIndent,
          isStandalone,
          closeDelim: pendingNextLineDirective.closeDelim,
          nextLineDirective: 'enable',
        }),
      );
      pendingNextLineDirective = null;
    }
  }

  return blocks;
}
