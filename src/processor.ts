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
  const open = (trimmed.match(/{/g) ?? []).length;
  const close = (trimmed.match(/}/g) ?? []).length;
  return open === close;
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

/**
 * Join trimmed content lines into a single expression.
 *
 * Lines that start with `.` (chained method/property access) are appended
 * directly to the previous line without an intervening space, so that e.g.
 *
 * ```
 * 'foo.bar'
 * .split()
 * ```
 *
 * becomes `'foo.bar'.split()` rather than `'foo.bar' .split()`.
 *
 * Only `.` is handled specially.  Other continuation patterns (`[`, `(`,
 * operators) are less common in EJS tags, and joining them with a space still
 * produces valid JavaScript.  A space-joined result is always syntactically
 * correct because JavaScript's automatic semicolon insertion (ASI) rules do
 * not insert a semicolon before `.`.
 */
function joinLines(lines: string[]): string {
  return lines.reduce((acc, line, i) => {
    if (i === 0) return line;
    return line.startsWith('.') ? `${acc}${line}` : `${acc} ${line}`;
  }, '');
}

// ---------------------------------------------------------------------------
// Tag-block extraction
// ---------------------------------------------------------------------------

/** A single extracted EJS tag together with its position in the original file. */
export interface TagBlock {
  /**
   * Virtual JS code for this block.
   * Line 1 is a single-line comment encoding the tag type (`//@ejs-tag:<type>`).
   * Lines 2+ are the raw JS code content of the tag (when not omitted).
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
}

/**
 * Extract each non-comment EJS tag from `text` as a {@link TagBlock},
 * using tree-sitter-embedded-template for accurate parsing.
 *
 * The virtual code for each block is structured as:
 * ```
 * //@ejs-tag:<tagType>
 * <raw JS code from the tag>   (omitted for structural / incomplete tags)
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

    // ── Virtual code body ─────────────────────────────────────────────────
    // Omit the body for structural (incomplete) tags to prevent ESLint parse
    // errors.  A tag is structural when its JS content is not a
    // syntactically self-contained statement.
    // Use the BASE type (stripping any violation suffix) so that e.g. a
    // `code-multiline` tag is still treated as structural/incomplete.
    const typeForBodyOmissionCheck = isMultiline ? baseType : tagType;
    const isIncomplete =
      typeForBodyOmissionCheck === 'code' ||
      typeForBodyOmissionCheck === 'code-multiline' ||
      (baseType === 'slurp' && !canConvertToSlurping(codeContent));
    const virtualCodeBody = isIncomplete ? '' : codeContent;

    blocks.push({
      virtualCode: `//@ejs-tag:${tagType}\n${virtualCodeBody}`,
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
 * Line 1:  //@ejs-tag:<type>   ← type marker comment
 * Line 2:  <first line of JS>  ← block.originalLine  (col shifted by block.originalColumn)
 * Line 3:  <second line …>     ← block.originalLine + 1 (col unchanged)
 * …
 * ```
 */
function mapMessage(msg: Linter.LintMessage, block: TagBlock): Linter.LintMessage {
  if (msg.line <= 1) {
    return { ...msg, line: block.tagLine, column: block.tagColumn };
  }

  const codeLineIndex = msg.line - 2;
  const originalLine = block.originalLine + codeLineIndex;
  const originalColumn = codeLineIndex === 0 ? msg.column + block.originalColumn : msg.column;
  const mapped: Linter.LintMessage = { ...msg, line: originalLine, column: originalColumn };

  if (msg.endLine !== undefined) {
    const endCodeLineIndex = msg.endLine - 2;
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
 * All non-empty trimmed content lines are joined into a single line.
 * Lines that start with `.` (chained method / property access) are joined
 * without a leading space so that `'foo.bar'\n.split()` collapses to
 * `'foo.bar'.split()` rather than `'foo.bar' .split()`.
 *
 * - 0 non-empty lines → `<open> <close>` (empty tag)
 * - 1+ non-empty lines → `<open> <joined content> <close>`
 */
function buildCollapsedTag(block: TagBlock): string {
  const lines = splitLines(block.codeContent);
  if (lines.length === 0) {
    return `${block.openDelim} ${block.closeDelim}`;
  }
  return `${block.openDelim} ${joinLines(lines)} ${block.closeDelim}`;
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
 * code's body (after the marker comment line).  They are translated by mapping
 * the virtual code offsets back to the corresponding positions in the original
 * EJS source.  The virtual body begins right after the marker line, so:
 *
 * ```
 * originalOffset = tagOffset + openDelim.length + (virtualOffset - markerLen)
 * ```
 *
 * where `markerLen = '//@ejs-tag:'.length + tagType.length + 1` (the `+1` is
 * for the `\n` that separates the marker from the body).
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

    // no-multiline-tags: collapse multiline tag into a single-line tag
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
  // The virtual code is:  '//@ejs-tag:<tagType>\n<codeContent>'
  // The body (codeContent) starts at offset markerLen in the virtual file.
  // Offsets within the body map directly to the original source at
  // (tagOffset + openDelim.length).
  const markerLen = '//@ejs-tag:'.length + block.tagType.length + 1; // +1 for '\n'

  // Guard: only translate fixes that target the code body (not the marker line).
  // Standard JS rules operate on the JS code, so fix.range[0] should always be
  // >= markerLen, but we guard defensively to avoid producing negative offsets.
  if (fix.range[0] < markerLen) {
    return null;
  }

  const codeStartOffset = block.tagOffset + block.openDelim.length;
  return {
    range: [codeStartOffset + (fix.range[0] - markerLen), codeStartOffset + (fix.range[1] - markerLen)],
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
 * The first line of every block is a single-line comment (`//@ejs-tag:<type>`)
 * that encodes the tag type (and any violation suffixes) so that plugin rules
 * can detect EJS-specific patterns.  The remaining lines are the raw JS
 * content of the tag.
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
      return blockMessages.map((msg) => {
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
