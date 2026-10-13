import {
  type EjsClosingDelimiter,
  type EjsOpeningDelimiter,
  type EjsSyntaxNode,
  type EjsTag,
  type RelativeJavascriptNode,
} from 'ejs-template-parser';

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
  /**
   * The half of an `eslint-disable-next-line` comment tag this directive block is: `disable`
   * covers the comment tag itself, `enable` is synthesized after the next tag and carries that
   * tag's position, so it is no tag of its own to fix.
   */
  nextLineDirective?: 'disable' | 'enable';
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
  nextLineDirective?: 'disable' | 'enable';
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
    nextLineDirective,
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
 * Violation suffixes (appended to the base type):
 * - `-multiline`         – content contains newlines (fixable by `prefer-single-line-tags`)
 * - `-needs-indent`      – wrong brace-depth indentation (fixable by `indent`)
 * - `-not-standalone`    – slurp tag is inline (fixable by `slurp-newline`)
 */
export function extractTagBlocks(tags: EjsTag[]): TagBlock[] {
  const blocks: TagBlock[] = [];

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
          javascriptPartialNode,
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

    const isSlurpTag = baseType === 'slurp';

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
          javascriptPartialNode,
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
