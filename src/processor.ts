// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Linter } from 'eslint';
import { parseEjs } from './ts-parser.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Indentation unit used by the ejsIndent brace-depth algorithm (2 spaces). */
const INDENT_UNIT = '  ';

// ---------------------------------------------------------------------------
// Slurping eligibility check
// ---------------------------------------------------------------------------

/**
 * Returns `true` when a plain `<% … %>` tag can be safely promoted to
 * `<%_ … _%>`.  Conditions:
 *   - Balanced braces
 *   - Does not start with `}` (would close a preceding block)
 *   - Does not end with `{` (would open a block whose close lives elsewhere)
 */
export function canConvertToSlurping(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.startsWith('}') || trimmed.endsWith('{')) return false;
  return bracesDelta(trimmed) === 0;
}

// ---------------------------------------------------------------------------
// Brace-depth helpers (ported from the original Prettier printer)
// ---------------------------------------------------------------------------

/** Net change in brace depth for a string (`{` count minus `}` count). */
function bracesDelta(s: string): number {
  return (s.match(/{/g) ?? []).length - (s.match(/}/g) ?? []).length;
}

/**
 * Count the number of `}` that appear at the very start of `str`
 * (before any non-whitespace, non-`}` character).  Used to determine the
 * "effective lower brace depth" for indentation.
 */
function countLeadingCloseBraces(str: string): number {
  const m = str.match(/^[\s}]*/);
  return m?.[0] ? m[0].replace(/\s/g, '').length : 0;
}

/**
 * Split raw EJS tag content into individual non-empty trimmed lines.
 */
function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Function-wrapper helpers
// ---------------------------------------------------------------------------

/**
 * Sentinel text written by the `prefer-slurp-multiline` fix.
 * Using a non-empty distinct value lets `translateFix` tell this sentinel
 * apart from the generic `''` sentinel used by all other plugin rules.
 */
export const SENTINEL_PREFER_SLURP_MULTILINE = 'PREFER_SLURP_MULTILINE';

/**
 * Sentinel text written by the `slurp-newline` fix.
 */
export const SENTINEL_SLURP_NEWLINE = 'SLURP_NEWLINE';



/** Opening line of the function wrapper injected into every virtual block. */
const WRAPPER_OPEN = '(function() {\n';

/**
 * Compute the synthetic prefix/suffix strings needed to wrap `codeContent`
 * inside `(function() { … })()` so that the result is parseable JavaScript
 * regardless of brace imbalance in `codeContent`.
 *
 * Algorithm:
 *  1. Walk `codeContent` tracking brace depth and the minimum depth reached.
 *  2. `prefixCount = -minDepth` (number of synthetic opening braces needed to
 *     prevent the content from going below depth 0 inside the function body).
 *  3. `suffixCount = depth + prefixCount` (closing braces needed to re-balance).
 *
 * **Why `if (true) {` for the first prefix brace?**
 * A tag that starts with `}` (e.g. `} else {`) would produce a dangling
 * `else` if we used plain `{` as the prefix: `{ } else { }` is a syntax
 * error because `else` must directly follow an `if` statement's body.
 * Using `if (true) {` makes the pattern `if (true) { } else { }` — valid JS.
 * Subsequent prefix braces (needed for patterns like `} }`) use plain `{`
 * because further `else` branches inside double-closes are not possible.
 *
 * @returns Strings to inject as prefix/suffix and the number of prefix lines.
 */
function buildFunctionWrapper(codeContent: string): {
  syntheticPrefix: string;
  syntheticPrefixLineCount: number;
  syntheticSuffix: string;
} {
  let depth = 0;
  let minDepth = 0;
  for (const ch of codeContent) {
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth < minDepth) minDepth = depth;
    }
  }

  const prefixCount = -minDepth; // synthetic opening braces
  const suffixCount = depth + prefixCount; // synthetic closing braces

  // First prefix uses `if (true) {` so that `} else {` remains valid JS.
  // Additional prefixes (for `} }` etc.) use plain `{`.
  const syntheticPrefix = prefixCount >= 1 ? 'if (true) {\n' + '{\n'.repeat(prefixCount - 1) : '';
  const syntheticSuffix = '}\n'.repeat(suffixCount);

  return { syntheticPrefix, syntheticPrefixLineCount: prefixCount, syntheticSuffix };
}

// ---------------------------------------------------------------------------
// Tag-block extraction
// ---------------------------------------------------------------------------

/** A single extracted EJS tag together with its position in the original file. */
export interface TagBlock {
  /**
   * Virtual JS code for this block.
   *
   * Structure:
   * ```
   * Line 1:   //@ejs-tag:<type>               ← type marker comment
   * Line 2:   (function() {                   ← function wrapper open
   * Line 3+:  [synthetic prefix lines]        ← brace-balancing prefix (0 or more)
   * Line P:   [virtualBodyPrefix]<codeContent>[virtualBodyInlineSuffix]
   *           ← block.originalLine  (col shifted by originalColumn + virtualBodyPrefixLen)
   * Line P+n: <further JS lines>              ← block.originalLine + n
   * Line Q:   [virtualBodyExtraLine]           ← optional extra line (e.g. `console.log();`)
   * Line Q+:  [synthetic suffix lines]        ← brace-balancing suffix (0 or more)
   * Last:     })()                             ← function wrapper close
   * ```
   *
   * The function wrapper makes every tag parseable by ESLint regardless of
   * whether the tag content contains unmatched braces.
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
   * - `-multiline`         → content contains `\n` (triggers `no-multiline-tags` rule)
   * - `-needs-indent`      → standalone `<%_ _%>` tag whose indentation does not match
   *                          the brace-depth expected indent (triggers `indent` rule)
   * - `-not-standalone`    → slurp tag that is inline (triggers `slurp-newline` rule)
   */
  tagType: string;
  /** Raw JS content captured between the delimiters. */
  codeContent: string;
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
   * Synthetic code inserted before `codeContent` inside the function wrapper
   * to balance leading `}` characters so the virtual code is parseable.
   * Empty string when no balancing is needed.
   */
  syntheticPrefix: string;
  /** Number of lines in `syntheticPrefix` (used for virtual-to-original line mapping). */
  syntheticPrefixLineCount: number;
  /**
   * Synthetic code inserted after `codeContent` inside the function wrapper
   * to balance trailing `{` characters so the virtual code is parseable.
   * Empty string when no balancing is needed.
   */
  syntheticSuffix: string;
  /**
   * Text prepended to `codeContent` in the virtual body (same line, before the code).
   * Used for output tags: `'console.log('` so that `<%- foo %>` becomes
   * `console.log( foo );` in the virtual file, preventing `no-unused-vars` errors.
   * Empty string for non-output tags.
   */
  virtualBodyPrefix: string;
  /**
   * Number of characters in `virtualBodyPrefix`.
   * Used to correct column offsets when mapping virtual-file positions back to
   * the original EJS source (subtract this from the virtual column before adding
   * `originalColumn`).
   */
  virtualBodyPrefixLen: number;
  /**
   * Text appended to `codeContent` in the virtual body (same line, after the code).
   * Used to close the `console.log(` call for output tags: `');'`.
   * Empty string for other tags.
   */
  virtualBodyInlineSuffix: string;
  /**
   * Optional extra line injected into the virtual body AFTER `codeContent` and
   * BEFORE `syntheticSuffix`.  Used for code/slurp tags whose trimmed content
   * ends with `{`: appends `console.log();` to suppress ESLint `no-empty` errors
   * on the opened block.  Empty string when not needed.
   */
  virtualBodyExtraLine: string;
  /** Whether the tag is standalone (only whitespace before it on the same line). */
  isStandalone: boolean;
}

/**
 * Extract each non-comment EJS tag from `text` as a {@link TagBlock},
 * using tree-sitter-embedded-template for accurate parsing.
 *
 * Each virtual block has the structure:
 * ```
 * //@ejs-tag:<tagType>
 * (function() {
 * [synthetic prefix — brace-balancing]
 * [virtualBodyPrefix]<raw JS code from the tag>[virtualBodyInlineSuffix]
 * [virtualBodyExtraLine — e.g. console.log();]
 * [synthetic suffix — brace-balancing]
 * })()
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
 * - `-multiline`         – content contains newlines (fixable by `no-multiline-tags`)
 * - `-needs-indent`      – wrong brace-depth indentation (fixable by `indent`)
 * - `-not-standalone`    – slurp tag is inline (fixable by `slurp-newline`)
 */
export function extractTagBlocks(text: string): TagBlock[] {
  const blocks: TagBlock[] = [];

  const root = parseEjs(text);
  let braceDepth = 0;

  for (const node of root.children) {
    // Skip content nodes and comment directives.
    if (node.type === 'content' || node.type === 'comment_directive') continue;

    // Skip nodes with parse errors.
    if (node.hasError) continue;

    const tagOffset = node.startIndex;
    const tagLength = node.endIndex - node.startIndex;

    // Extract opening/closing delimiters and code content from tree-sitter nodes.
    const openDelim: string = node.children[0]?.text ?? '<%';
    const closeDelim: string = node.children[node.childCount - 1]?.text ?? '%>';
    const codeNode = node.namedChildren.find((c) => c.type === 'code');
    const codeContent: string = codeNode?.text ?? '';

    // tree-sitter gives us precise position info directly.
    const tagLine = node.startPosition.row + 1; // 1-based
    const tagColumn = node.startPosition.column; // 0-based
    const codeStartRow = codeNode ? codeNode.startPosition.row + 1 : tagLine;
    const codeStartCol = codeNode ? codeNode.startPosition.column : tagColumn + openDelim.length;
    const originalLine = codeStartRow;
    const originalColumn = codeStartCol;

    // ── Standalone detection ──────────────────────────────────────────────
    // A tag is "standalone" when everything before it on the same line is
    // whitespace (i.e. `tagColumn` characters of pure whitespace).
    const lineStart = tagOffset - tagColumn;
    const linePrefix = text.slice(lineStart, tagOffset);
    const isStandalone = /^\s*$/.test(linePrefix);
    const lineIndent = isStandalone ? linePrefix : '';

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
      baseType = canConvertToSlurping(codeContent) ? 'code-slurpable' : 'code';
    }

    // ── Brace-depth tracking (for indent) ─────────────────────────────────
    // Updated for EVERY non-comment tag so structural `<% if %>` / `<% } %>`
    // tags are included in the depth count even though we won't indent them.
    const oldBraceDepth = braceDepth;
    braceDepth = Math.max(0, braceDepth + bracesDelta(codeContent));
    const lowerBraceDepth = Math.max(0, Math.min(oldBraceDepth - countLeadingCloseBraces(codeContent), braceDepth));

    // ── Expected indent (for standalone <%_ _%> tags only) ────────────────
    const isSlurpTag = baseType === 'slurp';
    const expectedIndent = isStandalone && isSlurpTag ? INDENT_UNIT.repeat(lowerBraceDepth) : lineIndent;

    // ── Multiline detection ────────────────────────────────────────────────
    const isMultiline = codeContent.includes('\n');

    // ── Final tag type (with violation suffixes) ───────────────────────────
    let tagType = baseType;
    if (isMultiline) {
      tagType += '-multiline';
    } else if (isSlurpTag && !isStandalone) {
      // Slurp tag that is inline (not at the start of its own line).
      // The `slurp-newline` rule will move it to its own line.
      tagType = 'slurp-not-standalone';
    } else if (isStandalone && isSlurpTag && lineIndent !== expectedIndent) {
      // Only add needs-indent for single-line slurp tags (multiline ones get
      // fixed by no-multiline-tags first, then re-checked for indent).
      tagType = 'slurp-needs-indent';
    }

    // ── Virtual body extras (void-expression wrapping) ────────────────────
    // For output tags: wrap in `void (…);` so the referenced variable counts
    // as "used" and standard `no-unused-vars` rules don't fire.  We use `void`
    // (not `console.log`) to avoid introducing new `no-undef` errors for the
    // `console` global.
    // For code/slurp tags ending with `{`: append `void 0;` to suppress
    // `no-empty` errors on the opened block.
    const isOutputTag = baseType === 'escaped-output' || baseType === 'raw-output';
    const endsWithOpenBrace = !isMultiline && codeContent.trim().endsWith('{');

    let virtualBodyPrefix = '';
    let virtualBodyPrefixLen = 0;
    let virtualBodyInlineSuffix = '';
    let virtualBodyExtraLine = '';

    if (!isMultiline && isOutputTag) {
      virtualBodyPrefix = 'void (';
      virtualBodyPrefixLen = virtualBodyPrefix.length;
      virtualBodyInlineSuffix = ');';
    } else if (endsWithOpenBrace) {
      virtualBodyExtraLine = '\nvoid 0;';
    }

    // ── Function wrapper (brace balancing) ───────────────────────────────
    // Every virtual block is wrapped in `(function() { … })()` so that
    // structural content (e.g. `if (x) {`, `}`, `} else {`) is parseable
    // by ESLint.  Synthetic prefix/suffix braces balance any mismatch.
    const { syntheticPrefix, syntheticPrefixLineCount, syntheticSuffix } = buildFunctionWrapper(codeContent);
    const virtualCode =
      `//@ejs-tag:${tagType}\n${WRAPPER_OPEN}${syntheticPrefix}` +
      `${virtualBodyPrefix}${codeContent}${virtualBodyInlineSuffix}${virtualBodyExtraLine}${syntheticSuffix}\n})()`;

    blocks.push({
      virtualCode,
      tagLine,
      tagColumn,
      originalLine,
      originalColumn,
      tagOffset,
      tagLength,
      tagType,
      codeContent,
      openDelim,
      closeDelim,
      lineIndent,
      expectedIndent,
      syntheticPrefix,
      syntheticPrefixLineCount,
      syntheticSuffix,
      virtualBodyPrefix,
      virtualBodyPrefixLen,
      virtualBodyInlineSuffix,
      virtualBodyExtraLine,
      isStandalone,
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Message position mapping
// ---------------------------------------------------------------------------

/**
 * Map an ESLint message from the virtual JS file back to the original EJS file.
 *
 * Virtual file structure:
 * ```
 * Line 1:   //@ejs-tag:<type>                ← type marker comment
 * Line 2:   (function() {                    ← wrapper open
 * Line 3…:  [synthetic prefix lines]         ← 0 or more (syntheticPrefixLineCount)
 * Line P:   [virtualBodyPrefix]<first JS>[virtualBodyInlineSuffix]
 *           ← block.originalLine  (col adjusted by virtualBodyPrefixLen)
 * Line P+n: <further JS lines>               ← block.originalLine + n
 * Line Q:   [virtualBodyExtraLine]            ← filtered out (maps to tag position)
 * Line Q+:  [synthetic suffix lines + `))()`]← filtered out
 * ```
 * where P = 3 + syntheticPrefixLineCount.
 */
function mapMessage(msg: Linter.LintMessage, block: TagBlock): Linter.LintMessage {
  // Lines 1 through (2 + syntheticPrefixLineCount) are the marker comment,
  // wrapper-open line, and any synthetic prefix lines.  Map all of them to
  // the tag's opening position.
  const codeStartLine = 3 + block.syntheticPrefixLineCount;

  if (msg.line < codeStartLine) {
    return { ...msg, line: block.tagLine, column: block.tagColumn };
  }

  const codeLineIndex = msg.line - codeStartLine;

  // How many lines does codeContent occupy?  A trailing '\n' does not add an
  // extra logical line — it just means the next character (the wrapper close
  // or synthetic suffix) starts on a new line.
  const codeLineCount =
    block.codeContent.split('\n').length - (block.codeContent.endsWith('\n') ? 1 : 0);

  if (codeLineIndex >= codeLineCount) {
    // Message is on a virtualBodyExtraLine, synthetic suffix, or wrapper-close
    // line; map to tag position.
    return { ...msg, line: block.tagLine, column: block.tagColumn };
  }

  const originalLine = block.originalLine + codeLineIndex;
  // For the first code line, subtract virtualBodyPrefixLen so the column
  // points into codeContent rather than into e.g. `console.log(`.
  const originalColumn =
    codeLineIndex === 0
      ? msg.column - block.virtualBodyPrefixLen + block.originalColumn
      : msg.column;
  const mapped: Linter.LintMessage = { ...msg, line: originalLine, column: originalColumn };

  if (msg.endLine !== undefined) {
    const endCodeLineIndex = msg.endLine - codeStartLine;
    mapped.endLine = block.originalLine + endCodeLineIndex;
    mapped.endColumn =
      endCodeLineIndex === 0
        ? (msg.endColumn ?? 0) - block.virtualBodyPrefixLen + block.originalColumn
        : msg.endColumn;
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
function buildCollapsedTag(block: TagBlock): string {
  const rawLines = splitLines(block.codeContent);
  if (rawLines.length === 0) {
    return `${block.openDelim} ${block.closeDelim}`;
  }

  const tags: string[] = [];
  let accumulated = '';

  for (const line of rawLines) {
    if (accumulated.length === 0) {
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

  if (tags.length === 0) {
    return `${block.openDelim} ${block.closeDelim}`;
  }

  if (tags.length === 1) {
    return `${block.openDelim} ${tags[0]} ${block.closeDelim}`;
  }

  // Multiple tags → one per statement, indented like the original tag.
  return tags
    .map((tag, i) => `${i === 0 ? '' : block.lineIndent}${block.openDelim} ${tag} ${block.closeDelim}`)
    .join('\n');
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
 *   `no-multiline-tags`, `indent`.
 * - `SENTINEL_PREFER_SLURP_MULTILINE`: used by `prefer-slurp-multiline` to avoid
 *   collision with `no-multiline-tags` for `code-multiline`/`code-slurpable-multiline`
 *   tag types.
 * - `SENTINEL_SLURP_NEWLINE`: used by `slurp-newline`.
 *
 * **General JS fixes** (from standard ESLint rules such as `no-var`,
 * `prefer-const`, etc.): the fix offsets are positions within the virtual
 * code's `codeContent` portion.  They are translated by mapping the virtual
 * code offsets back to the corresponding positions in the original EJS source:
 *
 * ```
 * codeContentStart = markerLen + wrapperOpenLen + syntheticPrefix.length + virtualBodyPrefixLen
 * originalOffset   = tagOffset + openDelim.length + (virtualOffset - codeContentStart)
 * ```
 */
function translateFix(
  fix: { range: [number, number]; text: string },
  block: TagBlock,
): { range: [number, number]; text: string } | null {
  // ── Sentinel fix detection ─────────────────────────────────────────────
  // All plugin-rule sentinels start at offset 0 in the virtual file.
  if (fix.range[0] !== 0) {
    // Fall through to the general JS fix handler below.
  } else if (fix.text === SENTINEL_PREFER_SLURP_MULTILINE) {
    // prefer-slurp-multiline: change multiline `<% … %>` → `<%_ … _%>` (content unchanged)
    if (block.tagType === 'code-multiline' || block.tagType === 'code-slurpable-multiline') {
      return {
        range: [block.tagOffset, block.tagOffset + block.tagLength],
        text: `<%_${block.codeContent}_%>`,
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
        text: `<%_${block.codeContent}_%>`,
      };
    }

    // no-multiline-tags: collapse multiline tag into single-line tag(s)
    if (block.tagType.endsWith('-multiline')) {
      return {
        range: [block.tagOffset, block.tagOffset + block.tagLength],
        text: buildCollapsedTag(block),
      };
    }

    // indent: fix the whitespace before a standalone <%_ _%> tag
    if (block.tagType === 'slurp-needs-indent') {
      // Replace the line prefix (from line start to tag start) with the expected indent.
      const indentStart = block.tagOffset - block.tagColumn;
      return {
        range: [indentStart, block.tagOffset],
        text: block.expectedIndent,
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
  //   <syntheticPrefix><virtualBodyPrefix><codeContent><virtualBodyInlineSuffix>
  //                                                    <virtualBodyExtraLine>
  //                                                    <syntheticSuffix>
  //
  // codeContent starts at byte offset:
  //   codeContentStart = markerLen + WRAPPER_OPEN.length + syntheticPrefix.length + virtualBodyPrefixLen
  //
  // where markerLen = '//@ejs-tag:'.length + tagType.length + 1  (+1 for '\n')
  const markerLen = '//@ejs-tag:'.length + block.tagType.length + 1;
  const wrapperOpenLen = WRAPPER_OPEN.length;
  const codeContentStart =
    markerLen + wrapperOpenLen + block.syntheticPrefix.length + block.virtualBodyPrefixLen;
  const codeContentEnd = codeContentStart + block.codeContent.length;

  // Guard: only translate fixes that target the actual codeContent region.
  if (fix.range[0] < codeContentStart || fix.range[0] >= codeContentEnd) {
    return null;
  }

  const codeStartOffset = block.tagOffset + block.openDelim.length;
  return {
    range: [
      codeStartOffset + (fix.range[0] - codeContentStart),
      codeStartOffset + (fix.range[1] - codeContentStart),
    ],
    text: fix.text,
  };
}

// ---------------------------------------------------------------------------
// Per-file block map
// ---------------------------------------------------------------------------

const fileBlocksMap = new Map<string, TagBlock[]>();

// ---------------------------------------------------------------------------
// ESLint processor
// ---------------------------------------------------------------------------

/**
 * ESLint processor for `.ejs` files.
 *
 * Each non-comment EJS tag is extracted into its own virtual JavaScript block.
 * Every block is wrapped in `(function() { … })()` with synthetic brace
 * balancing injected around the content so that even structural tags
 * (`if (x) {`, `}`, `} else {`) are parseable by ESLint.  The first line of
 * every block is a single-line comment (`//@ejs-tag:<type>`) that encodes the
 * tag type so that plugin rules can detect EJS-specific patterns.
 *
 * Parsing is backed by tree-sitter-embedded-template for accurate position
 * information and robust syntax handling.
 */
export const processor: Linter.Processor = {
  meta: { name: 'ejs' },

  preprocess(text: string, filename: string): Array<string | { text: string; filename: string }> {
    const blocks = extractTagBlocks(text);
    fileBlocksMap.set(filename, blocks);
    return blocks.map((b) => b.virtualCode);
  },

  postprocess(messages: Linter.LintMessage[][], filename: string): Linter.LintMessage[] {
    const blocks = fileBlocksMap.get(filename) ?? [];
    fileBlocksMap.delete(filename);

    return messages.flatMap((blockMessages, i) => {
      const block = blocks[i];
      if (!block) return blockMessages;
      return blockMessages
        .filter((msg) => !msg.fatal) // suppress parse errors from synthetic balancing code
        .map((msg) => {
          const mapped = mapMessage(msg, block);

          if (mapped.fix) {
            const translated = translateFix(mapped.fix, block);
            if (translated) {
              return { ...mapped, fix: translated };
            }
            // No translation available – drop the fix.
            const result = { ...mapped };
            delete result.fix;
            return result;
          }

          return mapped;
        });
    });
  },

  supportsAutofix: true,
};
