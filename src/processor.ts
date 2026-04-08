// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Linter } from 'eslint';
import createDebug from 'debug';
import { findErrorNode, parseJavaScript, type SyntaxNode } from './ts-parser.js';
import { EjsSyntaxNode, extractTagBlocks, getEjsNodes, TagBlock } from './ejs-parser.js';

type VitualJavascriptCode = {
  virtualCode: string;
  getPosition: (offset: number) => { node: SyntaxNode; startOffset: number; endOffset: number } | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Indentation unit used by the ejsIndent brace-depth algorithm (2 spaces). */
const debug = createDebug('ejs-templates:processor');

// ---------------------------------------------------------------------------
// Slurping eligibility check
// ---------------------------------------------------------------------------
function isSingleLineAfterTrim(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length > 0 && !trimmed.includes('\n');
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
 * Sentinel text written by `prefer-single-line-tags`.
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

/**
 * Sentinel text written by the `no-comment-empty-line` fix.
 */
export const SENTINEL_COMMENT_EMPTY_LINE = 'COMMENT_EMPTY_LINE';

/**
 * Sentinel text written by the `output-semi` fix when `always` is enabled.
 * Inserts `;` at the end of the output tag content (before `%>`).
 */
export const SENTINEL_OUTPUT_SEMI_ADD = 'OUTPUT_SEMI_ADD';

/**
 * Sentinel text written by the `output-semi` fix when `never` is enabled.
 * Removes the trailing `;` from the output tag content.
 */
export const SENTINEL_OUTPUT_SEMI_REMOVE = 'OUTPUT_SEMI_REMOVE';

/** Opening line of the function wrapper injected around the full virtual file. */
const GLOBAL_VIRTUAL_OPEN = '(function() {\n';
/** Closing line of the function wrapper injected around the full virtual file. */
const GLOBAL_VIRTUAL_CLOSE = '\n})();';

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
  const { javascriptPartialNode } = block;
  if (!javascriptPartialNode) {
    // Should not happen since we only call this on blocks with a successful JS parse, but guard just in case.
    throw new Error(
      `Cannot build collapsed tag for block at line ${String(block.tagLine)} due to missing javascriptPartialNode.`,
    );
  }
  const applyIndent = options?.applyIndent ?? false;
  // Also collapse multiline tags that become a single line after trim.
  if (isSingleLineAfterTrim(block.codeContent)) {
    const baseIndent = applyIndent ? block.expectedIndent : '';
    return `${baseIndent}${block.openDelim} ${block.codeContent.trim()} ${block.closeDelim}`;
  }

  const hasBraces = javascriptPartialNode.hasStructuralBraces;
  if (!hasBraces) {
    // For non-structural multiline content, keep original formatting.
    return `${block.openDelim}${block.codeContent}${block.closeDelim}`;
  }

  const tags = javascriptPartialNode.splitStatements();

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

function buildIndentedTag(block: TagBlock, options: { normalizeContent: boolean }): string {
  const normalizeContent = options.normalizeContent;
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

  const isOpenBlock = (line: string) =>
    line.endsWith('{') || line.endsWith('(') || line.endsWith('[') || line.endsWith('=>');
  const isCloseBlock = (line: string) => line.startsWith('}') || line.startsWith(')') || line.startsWith(']');
  const isContinueStatement = (line: string) => /^[=?:|&><]/.test(line) || /^\.[^.]/.test(line);
  let relativeBlockIndent = isOpenBlock(firstLine) ? 1 : 0;
  const relativeStatementIndentStack: number[] = [];
  // Middle lines:
  // - normalizeContent=true  -> normalize each line to content-level indentation
  // - normalizeContent=false -> preserve internal line indentation
  for (let i = 1; i < contentLines.length; i++) {
    if (normalizeContent) {
      const trimmedLine = contentLines[i].trimStart();
      const relativeStatementIndent = isContinueStatement(trimmedLine) ? 1 : 0;

      if (isCloseBlock(trimmedLine)) {
        relativeBlockIndent = Math.max(0, relativeBlockIndent - 1);
      }
      lines.push(
        `${normalizedContentIndent}${'  '.repeat(relativeBlockIndent + relativeStatementIndent + (relativeStatementIndentStack.at(-1) ?? 0))}${trimmedLine}`.trimEnd(),
      );
      if (isCloseBlock(trimmedLine)) {
        relativeStatementIndentStack.pop();
      }
      if (isOpenBlock(trimmedLine)) {
        relativeStatementIndentStack.push(relativeStatementIndent);
        relativeBlockIndent++;
      }
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
 *   `prefer-single-line-tags`.
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
  // no-comment-empty-line sentinel: handled before the javascriptPartialNode guard
  // because comment-empty-line blocks have no javascriptPartialNode.
  if (fix.range[0] === 0 && fix.text === SENTINEL_COMMENT_EMPTY_LINE) {
    if (block.tagType === 'comment-empty-line') {
      const closeLen = block.closeDelim.length;
      return {
        range: [block.tagOffset + block.tagLength - closeLen, block.tagOffset + block.tagLength],
        text: '-%>',
      };
    }
    return null;
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
    if (block.tagType.startsWith('slurp-needs-indent') || block.tagType === 'slurp-multiline') {
      const indentStart = block.tagOffset - block.tagColumn;
      const normalizedText = buildIndentedTag(block, { normalizeContent: true });
      const currentText = block.lineIndent + block.openDelim + block.codeContent + block.closeDelim;
      if (normalizedText === currentText) {
        return null;
      }
      return {
        range: [indentStart, block.tagOffset + block.tagLength],
        text: normalizedText,
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
    // prefer-single-line-tags: collapse multiline tag while
    // keeping content between braces in a single tag.
    if (block.tagType.endsWith('-multiline')) {
      const { javascriptPartialNode } = block;
      if (!javascriptPartialNode) {
        // Should not happen since we only call this on blocks with a successful JS parse, but guard just in case.
        throw new Error(
          `Cannot translate fix for block at line ${String(block.tagLine)} due to missing javascriptPartialNode.`,
        );
      }
      if (!javascriptPartialNode.hasStructuralBraces && !isSingleLineAfterTrim(block.codeContent)) {
        return null;
      }
      const originalText = block.openDelim + block.codeContent + block.closeDelim;
      const fixedText = buildCollapsedTag(block, {
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
  } else if (fix.text === SENTINEL_OUTPUT_SEMI_ADD) {
    // output-semi (always): insert `;` at the end of the trimmed code content
    if (block.tagType === 'escaped-output' || block.tagType === 'raw-output') {
      const insertPos = block.tagOffset + block.openDelim.length + block.codeContent.trimEnd().length;
      return { range: [insertPos, insertPos], text: ';' };
    }
    return null;
  } else if (fix.text === SENTINEL_OUTPUT_SEMI_REMOVE) {
    // output-semi (never): remove the trailing `;` from the code content
    if (block.tagType === 'escaped-output' || block.tagType === 'raw-output') {
      const trimmedContent = block.codeContent.trimEnd();
      if (trimmedContent.endsWith(';')) {
        const semiPos = block.tagOffset + block.openDelim.length + trimmedContent.length - 1;
        return { range: [semiPos, semiPos + 1], text: '' };
      }
    }
    return null;
  } else if (fix.text === '') {
    // ── Generic sentinel (fix.text === '') ────────────────────────────────

    // prefer-raw: change `<%=` → `<%-`
    if (block.tagType === 'escaped-output') {
      return { range: [block.tagOffset + 2, block.tagOffset + 3], text: '-' };
    }

    // prefer-encoded: change `<%-` → `<%=`
    if (block.tagType === 'raw-output') {
      return { range: [block.tagOffset + 2, block.tagOffset + 3], text: '=' };
    }

    // prefer-slurping-codeonly: change `<% … %>` → `<%_ … _%>` (content unchanged)
    if (block.tagType === 'code-slurpable') {
      return {
        range: [block.tagOffset, block.tagOffset + block.tagLength],
        text: `<%_ ${trimmedCodeContent} _%>`,
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
  const codeContentEnd = codeContentStart + block.lintCodeContent.length;

  // Guard: only translate fixes that target the actual codeContent region.
  // Allow pure insertions at codeContentEnd so rules like `@stylistic/semi`
  // can insert text immediately before the EJS closing delimiter.
  if (fix.range[0] < codeContentStart || fix.range[0] > codeContentEnd || fix.range[1] > codeContentEnd) {
    return null;
  }

  const codeStartOffset = block.tagOffset + block.openDelim.length;
  return {
    range: [codeStartOffset + (fix.range[0] - codeContentStart), codeStartOffset + (fix.range[1] - codeContentStart)],
    text: fix.text,
  };
}

// ---------------------------------------------------------------------------
// Per-file block map and metadata tracking
// ---------------------------------------------------------------------------

/**
 * Position mapping for a single EJS tag block within the concatenated virtual file.
 *
 * Two variants track the same block in different virtual file contexts:
 * - **segments**: Positions in the function-wrapped virtual file (`GLOBAL_VIRTUAL_OPEN + blocks + GLOBAL_VIRTUAL_CLOSE`)
 *   Used for main ESLint linting and fix translation.
 * - **rawSegments**: Positions in raw concatenated virtual code (no function wrapper).
 *   Used for fallback raw JS validation when main pass reports fatal errors with `return` statements.
 *
 * Line and offset numbers are absolute positions within their respective virtual files.
 * They are used during postprocess() to locate ESLint messages and map them back to
 * the corresponding TagBlock for translation to original EJS source positions.
 */
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
    cleanup: () => void;
  }
>();

/**
 * File-level mapping from ESLint virtual code to position metadata.
 *
 * Stores two VirtualBlockSegment arrays for each file:
 * - segments: Block positions in wrapped virtual code (for main linting)
 * - rawSegments: Block positions in raw virtual code (for fallback validation)
 *
 * Lifecycle: set in preprocess(), deleted in postprocess().
 */
const fileBlocksMap = new Map<
  string,
  {
    segments: VirtualBlockSegment[];
    rawSegments: VirtualBlockSegment[];
  }
>();

/**
 * Cached formatting state for tags to detect if they already match format rules.
 */
interface TagFormatState {
  isFormattedDefault: boolean;
  isFormattedMultilineClose: boolean;
}

/**
 * Unified metadata for a single virtual code block.
 *
 * Combines all per-tag metadata needed by ESLint rules:
 * - structuralControl: boolean array indicating if each block has structural braces
 * - singleLineTrim: boolean array indicating if each block fits one line after trim()
 * - tagFormat: array of TagFormatState objects for format rule detection
 */
interface VirtualCodeMetadata {
  structuralControl: boolean[];
  singleLineTrim: boolean[];
  tagFormat: TagFormatState[];
  /** Index i is true when i-th non-directive slurp-multiline block needs content normalization. */
  needsNormalize: boolean[];
}

/**
 * Unified per-virtual-code metadata tracking.
 *
 * Consolidates three metadata arrays for each wrapped virtual code:
 * - **structuralControl**: Index i indicates if i-th non-directive block has structural braces
 *   (if/while/for/try/etc). Used by prefer-single-line-tags rule.
 * - **singleLineTrim**: Index i indicates if i-th non-directive block's content becomes
 *   a single line after trim(). Used by prefer-single-line-tags rule.
 * - **tagFormat**: Index i contains TagFormatState for i-th non-directive block,
 *   tracking which format rules the tag already satisfies. Used by format rule.
 *
 * Lifecycle: set in preprocess(), deleted in postprocess().
 */
const virtualCodeMetadataMap = new Map<string, VirtualCodeMetadata>();

/**
 * Retrieve unified metadata for a virtual code block.
 *
 * Returns all metadata needed by rules: structural control flow, single-line-trim detection,
 * and cached formatting state. Returns undefined if metadata not found (file not preprocessed).
 */
export function getVirtualCodeMetadata(virtualCode: string): VirtualCodeMetadata | undefined {
  return virtualCodeMetadataMap.get(virtualCode);
}

/**
 * Translate a fatal parser error message from raw JS validation.
 *
 * Currently a pass-through (returns message unchanged), but provides a hook for
 * future message transformations if raw validation needs special error handling.
 */
function translateRawParserFatalMessage(message: string): string {
  return message;
}

/**
 * Log virtual code structure when ESLint reports fatal parsing errors.
 *
 * Useful for debugging why EJS-to-JavaScript transformation produced invalid code.
 * Renders the actual virtual code that was sent to ESLint along with error details.
 * Output is sent to the debug logger (scope: `ejs-templates:processor`).
 */
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

/**
 * Format a list of rule IDs as a human-readable string for error messages.
 *
 * Examples:
 * - `['a']` → `'a'`
 * - `['a', 'b']` → `'a' and 'b'`
 * - `['a', 'b', 'c']` → `'a', 'b', and 'c'`
 */
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

/**
 * Extract rule IDs from an ESLint "unused directive" error message.
 *
 * ESLint reports unused `eslint-disable` directives with a message like:
 * "Unused eslint-disable directive (no problems were reported from 'rule-a' and 'rule-b')."
 *
 * This extracts all rule IDs mentioned in the message via regex matching.
 */
function extractUnusedDirectiveRuleIds(message: string): string[] {
  return [...message.matchAll(/'([^']+)'/gu)].map((m) => m[1]);
}

/**
 * Find the matching `eslint-enable` directive for a given `eslint-disable` directive.
 *
 * Matching rules:
 * - `eslint-disable` with no rules matches the next `eslint-enable` with no rules
 * - `eslint-disable` with explicit rules matches the next `eslint-enable`
 *   - If enable has no rules, it re-enables all rules (matches)
 *   - If enable has explicit rules, they must be the same set (in any order)
 *
 * Used for translating fixes that remove or update unused `eslint-disable` directives,
 * so the corresponding `eslint-enable` can be updated or removed together.
 */
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

/**
 * Translate an ESLint "unused directive" error into fixes for both disable and enable directives.
 *
 * When ESLint reports `Unused eslint-disable directive (no problems from 'rule-a')`,
 * this determines:
 * 1. Whether to remove the disable directive entirely or update it to keep only used rules
 * 2. Whether to remove/update a matching enable directive
 *
 * Returns a fix object with:
 * - **disableFix**: Always returned; removes entire directive or updates rule list
 * - **enableBlock/enableFix**: Optionally returned if a matching enable directive is found
 *
 * If no matching enable is found or blocks/blockIndex not provided, returns only disableFix.
 */
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

/**
 * Normalize or filter ESLint "unused directive" messages based on rule context.
 *
 * Two filtering modes:
 *
 * **ignoreEjsTemplateRules=false** (main linting pass):
 * Returns all unused-directive messages unchanged. These are handled by
 * the standard ESLint mechanism and translateUnusedDirectiveFix().
 *
 * **ignoreEjsTemplateRules=true** (raw validation pass):
 * Filters out unused directives that only mention EJS-specific rules
 * (those starting with 'ejs-templates/'). This prevents redundant errors
 * from the raw JS validator, since those rules don't apply to raw code.
 * If ALL unused rules are EJS-specific, supresses the message (returns null).
 * If SOME are EJS-specific, rewrites message to list only non-EJS rules.
 *
 * Raw validation still reports JS-specific rule violations (like prefer-const),
 * which are valuable; we just suppress the confusing meta-messages about
 * EJS-only directives.
 */
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

/**
 * Build the virtual JavaScript code for the entire EJS template.
 *
 * Extracts the JavaScript portions from EJS directives and concatenates them
 * into a single virtual code block, separated by newlines. Also creates a
 * position mapping to translate virtual code offsets back to original EJS nodes.
 *
 * Used early in preprocess() to detect overall syntax issues before individual
 * tag extraction. The getPosition() function enables error positioning relative
 * to original EJS source.
 */
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

  /**
   * Preprocess: Convert EJS template to virtual JavaScript for ESLint linting.
   *
   * **Processing steps:**
   * 1. Parse EJS template with tree-sitter to identify tag boundaries
   * 2. Extract each EJS tag as a TagBlock with JS content and metadata
   * 3. Generate virtual JS code for each block (with type marker and optional wrapping)
   * 4. Build three virtual code variants (see Return section)
   * 5. Initialize per-virtual-code metadata maps for rule detection
   * 6. Store block position mappings for later message translation
   *
   * **Return values (ESLint receives all three for parallel validation):**
   * - [0] Wrapped virtual code: `function() {\n <blocks> \n}();`
   *       Primary linting pass with function wrapper for structural balance.
   * - [1] Raw virtual code: `<blocks>` (concatenated, no wrapper).
   *       Fallback for raw JS syntax validation when [0] triggers fatal errors.
   * - [2] Wrapped raw virtual code: same as [0], used when [1] has `return` statement errors.
   *       Allows fallback when raw code would be syntactically invalid.
   *
   * **Metadata initialization:**
   * - structuralControlByVirtualCodeMap: tracks if-/for-/while-/try-/etc blocks
   * - singleLineTrimByVirtualCodeMap: tracks tags that fit one line after trim()
   * - tagFormatByVirtualCodeMap: tracks format rule satisfaction
   * - fileBlocksMap: stores segments for position-based message translation
   */
  preprocess(text: string, filename: string): Array<string | { text: string; filename: string }> {
    const ejsNodes = getEjsNodes(text);
    const javascriptVitualCode = buildVirtualCode(ejsNodes);
    const blocks = extractTagBlocks(ejsNodes);

    processedFilesMap.set(filename, {
      ejsNodes,
      javascriptVitualCode,
      cleanup: () => {
        for (const block of blocks) {
          block.javascriptPartialNode?.cleanup();
        }
      },
    });

    if (blocks.length === 0) {
      fileBlocksMap.set(filename, { segments: [], rawSegments: [] });
      return [];
    }

    // Track block positions for both wrapped (segments) and raw (rawSegments) virtual code variants.
    // These are used during postprocess() to locate ESLint messages and translate them back to source.
    const segments: VirtualBlockSegment[] = [];
    const rawSegments: VirtualBlockSegment[] = [];
    let lineCursor = 2; // Start at line 2 (line 1 is GLOBAL_VIRTUAL_OPEN)
    let offsetCursor = GLOBAL_VIRTUAL_OPEN.length; // Account for wrapper in offset
    let rawLineCursor = 1; // Raw code starts at line 1 (no wrapper)
    let rawOffsetCursor = 0; // Raw code starts at offset 0 (no wrapper)

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

      // Each block is joined with a single newline in concatenated virtual files.
      lineCursor += lineCount;
      offsetCursor += block.virtualCode.length + 1; // +1 for separator newline
      rawLineCursor += lineCount;
      rawOffsetCursor += block.virtualCode.length + 1; // +1 for separator newline
    }

    fileBlocksMap.set(filename, { segments, rawSegments });

    const joinedBlocksVirtualCode = blocks.map((b) => b.virtualCode).join('\n');
    const virtualCode = `${GLOBAL_VIRTUAL_OPEN}${joinedBlocksVirtualCode}${GLOBAL_VIRTUAL_CLOSE}`;
    const nonDirectiveBlocks = blocks.filter((block) => !block.isDirectiveComment);
    virtualCodeMetadataMap.set(virtualCode, {
      structuralControl: nonDirectiveBlocks.map((block) => block.javascriptPartialNode?.hasStructuralBraces ?? false),
      singleLineTrim: nonDirectiveBlocks.map((block) => isSingleLineAfterTrim(block.codeContent)),
      tagFormat: nonDirectiveBlocks.map((block) => {
        const originalText = block.openDelim + block.codeContent + block.closeDelim;
        return {
          isFormattedDefault: originalText === buildFormattedTag(block, { multilineCloseOnNewLine: false }),
          isFormattedMultilineClose: originalText === buildFormattedTag(block, { multilineCloseOnNewLine: true }),
        };
      }),
      needsNormalize: nonDirectiveBlocks.map((block) => {
        if (block.tagType !== 'slurp-multiline') return false;
        // Only normalize when the close delimiter is already on its own line
        // (last codeContent segment is all whitespace). If the close is on the
        // same line as the last content line, normalizing it would conflict with
        // `format: same-line`, causing a circular fix.
        const lastSegment = block.codeContent.split('\n').pop() ?? '';
        if (lastSegment.trim() !== '') return false;
        const normalizedText = buildIndentedTag(block, { normalizeContent: true });
        const currentText = block.lineIndent + block.openDelim + block.codeContent + block.closeDelim;
        return normalizedText !== currentText;
      }),
    });

    // Build the three virtual code variants for parallel ESLint validation passes.
    // Pass 1 (index 0): Wrapped code with function wrapper — main linting target
    // Pass 2 (index 1): Raw code without wrapper — fallback for raw JS validation
    // Pass 3 (index 2): Wrapped raw code — alternative when pass 2 has `return` errors
    const rawVirtualCode = joinedBlocksVirtualCode;
    const wrappedRawVirtualCode = `${GLOBAL_VIRTUAL_OPEN}${joinedBlocksVirtualCode}${GLOBAL_VIRTUAL_CLOSE}`;

    return [virtualCode, rawVirtualCode, wrappedRawVirtualCode];
  },

  /**
   * Postprocess: Translate ESLint messages from virtual code back to original EJS source.
   *
   * **Processing steps:**
   * 1. Receive messages from all three parallel validation passes (main, raw, wrapped-raw)
   * 2. Normalize and filter ESLint system messages (unused-disable directives)
   * 3. Route messages to appropriate handler:
   *    - Main pass: full message translation (rules + fixes)
   *    - Raw validation: fallback that only applies when main pass has `return` errors
   * 4. For each message, locate its TagBlock via segment mapping
   * 5. Translate message line/column from virtual to original EJS positions
   * 6. Translate sentinel-based fixes for plugin rules (prefer-single-line-tags, etc)
   * 7. Translate general JS fixes (from rules like prefer-const) via offset mapping
   * 8. Clean up per-virtual-code metadata maps after processing
   *
   * **Validation fallback logic:**
   * If the main (wrapped) pass produces fatal `return` errors, the processor falls back
   * to the raw or wrapped-raw validation messages instead. This handles cases where
   * certain JS patterns require a function wrapper for syntactic validity.
   */
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
    virtualCodeMetadataMap.delete(currentVirtualCode);

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

        // The first line of each virtual block is the `//@ejs-tag:<type>` marker comment.
        // It is generated code, not real JS — suppress lint errors from external rules
        // reported on that line. ejs-templates rules and ESLint system messages (ruleId
        // === null, e.g. unused-disable-directives) are intentional and kept intact.
        if (
          normalizedMsg.line === segment.startLine &&
          normalizedMsg.ruleId !== null &&
          !normalizedMsg.ruleId.startsWith('ejs-templates/')
        ) {
          return [];
        }

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

        return [mapped];
      });

    // ── Raw validation fallback logic ──────────────────────────────────────
    // When EJS tags contain bare `return` statements, raw JS validation (pass 2)
    // fails because `return` is only valid inside a function body. In this case,
    // fall back to wrapped-raw validation (pass 3) which has the function wrapper.
    // Note: rawSegments are used with raw messages, segments with wrapped messages.
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

        // The first line of each virtual block is the `//@ejs-tag:<type>` marker comment.
        // It is generated code, not real JS — suppress lint errors from external rules
        // reported on that line. ejs-templates rules and ESLint system messages (ruleId
        // === null, e.g. unused-disable-directives) are intentional and kept intact.
        if (
          normalizedMsg.line === segment.startLine &&
          normalizedMsg.ruleId !== null &&
          !normalizedMsg.ruleId.startsWith('ejs-templates/')
        ) {
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

    processedFile.cleanup();
    // Keep `format` fixes last so all structural/semantic fixes and validations
    // run first, and formatting is applied as a final normalization step.
    return [...nonFormatMessages, ...uniqueRawMessages, ...formatMessages];
  },

  supportsAutofix: true,
};
