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
   * Line 1:  //@ejs-tag:<type>               ← type marker comment
   * Line 2:  (function() {                   ← function wrapper open
   * Line 3+: [synthetic prefix lines]        ← brace-balancing prefix (0 or more)
   * Line P+: <raw JS code from the tag>      ← block.originalLine  (col shifted)
   * Line Q+: [synthetic suffix lines]        ← brace-balancing suffix (0 or more)
   * Last:    })()                             ← function wrapper close
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
   * - `-multiline`     → content contains `\n` (triggers `no-multiline-tags` rule)
   * - `-needs-indent`  → standalone `<%_ _%>` tag whose indentation does not match
   *                      the brace-depth expected indent (triggers `ejs-indent` rule)
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
 * <raw JS code from the tag>
 * [synthetic suffix — brace-balancing]
 * })()
 * ```
 *
 * Wrapping every block in `(function() { … })()` ensures that structural
 * content such as `if (x) {` or `}` is parseable by ESLint.  Synthetic
 * opening/closing braces are injected when the content itself is unbalanced.
 *
 * Tag types (base):
 * - `escaped-output`  – `<%= … %>`
 * - `raw-output`      – `<%- … %>`
 * - `slurp`           – `<%_ … _%>` / `<% … _%>` / `<%_ … %>`
 * - `code`            – `<% … %>` that cannot be promoted to slurping
 * - `code-slurpable`  – `<% … %>` that can be safely promoted to `<%_ … _%>`
 *
 * Violation suffixes (appended to the base type):
 * - `-multiline`       – content contains newlines (fixable by `no-multiline-tags`)
 * - `-needs-indent`    – wrong brace-depth indentation (fixable by `ejs-indent`)
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

    // ── Brace-depth tracking (for ejs-indent) ─────────────────────────────
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
    } else if (isStandalone && isSlurpTag && lineIndent !== expectedIndent) {
      // Only add needs-indent for single-line slurp tags (multiline ones get
      // fixed by no-multiline-tags first, then re-checked for indent).
      tagType = 'slurp-needs-indent';
    }

    // ── Function wrapper (brace balancing) ───────────────────────────────
    // Every virtual block is wrapped in `(function() { … })()` so that
    // structural content (e.g. `if (x) {`, `}`, `} else {`) is parseable
    // by ESLint.  Synthetic prefix/suffix braces balance any mismatch.
    const { syntheticPrefix, syntheticPrefixLineCount, syntheticSuffix } = buildFunctionWrapper(codeContent);
    const virtualCode = `//@ejs-tag:${tagType}\n${WRAPPER_OPEN}${syntheticPrefix}${codeContent}${syntheticSuffix}\n})()`;

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
 * Line 1:  //@ejs-tag:<type>                ← type marker comment
 * Line 2:  (function() {                    ← wrapper open
 * Line 3…: [synthetic prefix lines]         ← 0 or more (syntheticPrefixLineCount)
 * Line P:  <first line of JS>               ← block.originalLine  (col shifted)
 * Line P+n:<further JS lines>               ← block.originalLine + n
 * Line Q…: [synthetic suffix lines + `))()`]← filtered out
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
  const codeLineCount = block.codeContent.split('\n').length - (block.codeContent.endsWith('\n') ? 1 : 0);

  if (codeLineIndex >= codeLineCount) {
    // Message is on a synthetic suffix or wrapper-close line; map to tag position.
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
 * 2. Join continuation lines — a line that starts with `.` is appended to
 *    the previous line without a space (handles chained method calls such as
 *    `'foo.bar'\n.split()` → `'foo.bar'.split()`).
 * 3. Each resulting logical phrase becomes its own single-line EJS tag.
 *
 * Examples:
 * - `if (generateSpringAuditor) {\n` → one phrase → `<%_ if (generateSpringAuditor) { _%>`
 * - `const x = 1;\n  const y = 2;` → two phrases → two tags
 * - `'foo.bar'\n.split();` → joined to one phrase → one tag
 */
function buildCollapsedTag(block: TagBlock): string {
  const rawLines = splitLines(block.codeContent);
  if (rawLines.length === 0) {
    return `${block.openDelim} ${block.closeDelim}`;
  }

  // Join continuation lines (dot-prefix) into logical phrases.
  const phrases: string[] = [];
  for (const line of rawLines) {
    if (phrases.length > 0 && line.startsWith('.')) {
      phrases[phrases.length - 1] += line;
    } else {
      phrases.push(line);
    }
  }

  if (phrases.length === 1) {
    return `${block.openDelim} ${phrases[0]} ${block.closeDelim}`;
  }

  // Multiple phrases → one tag per phrase, indented like the original.
  return phrases
    .map((phrase, i) => `${i === 0 ? '' : block.lineIndent}${block.openDelim} ${phrase} ${block.closeDelim}`)
    .join('\n');
}

/**
 * Translate an ESLint fix object from the virtual JS code space back to the
 * original EJS source space.
 *
 * Two fix kinds are supported:
 *
 * **Sentinel fixes** (from plugin rules): the plugin rules report a fix that
 * replaces the virtual marker comment (`//@ejs-tag:<type>`) with an empty
 * string.  Those fixes always start at offset 0 and have `text === ''`.  They
 * are translated using the `TagBlock` metadata to produce a meaningful
 * replacement in the original EJS source.
 *
 * **General JS fixes** (from standard ESLint rules such as `no-var`,
 * `prefer-const`, etc.): the fix offsets are positions within the virtual
 * code's body (the `codeContent` portion, after the marker line, the wrapper
 * open `(function() {\n`, and any synthetic prefix).  They are translated by
 * mapping the virtual code offsets back to the corresponding positions in the
 * original EJS source:
 *
 * ```
 * codeBodyStart = markerLen + wrapperOpenLen + syntheticPrefix.length
 * originalOffset = tagOffset + openDelim.length + (virtualOffset - codeBodyStart)
 * ```
 */
function translateFix(
  fix: { range: [number, number]; text: string },
  block: TagBlock,
): { range: [number, number]; text: string } | null {
  // ── Sentinel fix detection ─────────────────────────────────────────────
  // Plugin rules use fixer.replaceTextRange([comment.range![0], comment.range![1]], '')
  // which always starts at 0 (the marker comment is at the top of the virtual
  // file) and replaces with empty text.
  const isSentinelFix = fix.range[0] === 0 && fix.text === '';

  if (isSentinelFix) {
    // prefer-raw: change `<%=` → `<%-`
    if (block.tagType === 'escaped-output') {
      return { range: [block.tagOffset + 2, block.tagOffset + 3], text: '-' };
    }

    // prefer-slurping: change `<% … %>` → `<%_ … _%>` (content unchanged)
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

    // ejs-indent: fix the whitespace before a standalone <%_ _%> tag
    if (block.tagType === 'slurp-needs-indent') {
      // Replace the line prefix (from line start to tag start) with the expected indent.
      const indentStart = block.tagOffset - block.tagColumn;
      return {
        range: [indentStart, block.tagOffset],
        text: block.expectedIndent,
      };
    }

    return null;
  }

  // ── General JS fix ─────────────────────────────────────────────────────
  // The virtual code is:
  //   '//@ejs-tag:<tagType>\n(function() {\n<syntheticPrefix><codeContent><syntheticSuffix>})()'
  //
  // codeContent starts at offset:
  //   markerLen + wrapperOpenLen + syntheticPrefix.length
  //
  // where:
  //   markerLen    = '//@ejs-tag:'.length + tagType.length + 1  (the +1 is for '\n')
  //   wrapperOpenLen = '(function() {\n'.length = 14
  const markerLen = '//@ejs-tag:'.length + block.tagType.length + 1;
  const wrapperOpenLen = WRAPPER_OPEN.length; // derived from the constant, not a magic number
  const codeBodyStart = markerLen + wrapperOpenLen + block.syntheticPrefix.length;
  const codeBodyEnd = codeBodyStart + block.codeContent.length;

  // Guard: only translate fixes that target the actual codeContent region.
  if (fix.range[0] < codeBodyStart || fix.range[0] >= codeBodyEnd) {
    return null;
  }

  const codeStartOffset = block.tagOffset + block.openDelim.length;
  return {
    range: [codeStartOffset + (fix.range[0] - codeBodyStart), codeStartOffset + (fix.range[1] - codeBodyStart)],
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
