// Copyright 2024 The eslint-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import type { Linter, Rule } from 'eslint';
import createDebug from 'debug';
import {
  buildTemplate,
  cleanupTemplate,
  type EjsBlock,
  type EjsCodeTag,
  type EjsDiagnostic,
  type EjsDiagnosticCode,
  type EjsEdit,
  type EjsTemplate,
  type EjsTemplateNode,
  type EjsText,
  editTemplate,
  type EjsFixOptions,
  fixOf,
  type RelativeJavascriptNode,
  type SyntaxNode,
  validateTemplate,
} from 'ejs-template-parser';
import { type CodeTagBlock, EJS_MARKER_PREFIX, extractTagBlocks, type TagBlock } from './ejs-parser.js';
import { ifOpening, tokensAre, tokensOf, type VirtualMarkerComment } from './utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Indentation unit used by the ejsIndent brace-depth algorithm (2 spaces). */
const debug = createDebug('ejs-templates:processor');

// ---------------------------------------------------------------------------
// Slurping eligibility check
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Function-wrapper helpers
// ---------------------------------------------------------------------------

/**
 * Sentinel text written by the `prefer-slurp-multiline` fix.
 * Using a non-empty distinct value lets `translateFix` tell this sentinel
 * apart from the generic `''` sentinel used by all other plugin rules.
 */
export const SENTINEL_PREFER_SLURP_MULTILINE = 'PREFER_SLURP_MULTILINE';

/** The prefix of the sentinel of a convention ejs-template-parser diagnoses, its code after it. */
const SENTINEL_CONVENTION = 'CONVENTION:';

/**
 * Sentinel text written by the fix of a convention ejs-template-parser diagnoses, which `translateFix()` asks
 * `fixOf()` of the parser for: `no-comment-empty-line`, `slurp-newline`, `prefer-slurping-codeonly`, `indent` and
 * `prefer-single-line-tags`.
 */
export const conventionSentinel = (code: EjsDiagnosticCode): string => `${SENTINEL_CONVENTION}${code}`;

/**
 * Sentinel text written by the `indent-content` fix.
 */
export const SENTINEL_INDENT_CONTENT = 'INDENT_CONTENT';

/**
 * Sentinel text written by the `indent-content` fix when `binaryOperands` is `greaterOrEqual`.
 */
export const SENTINEL_INDENT_CONTENT_GREATER_OR_EQUAL = 'INDENT_CONTENT_GREATER_OR_EQUAL';

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
 * Sentinel text written by the `output-semi` fix when `always` is enabled.
 * Inserts `;` at the end of the output tag content (before `%>`).
 */
export const SENTINEL_OUTPUT_SEMI_ADD = 'OUTPUT_SEMI_ADD';

/**
 * Sentinel text written by the `output-semi` fix when `never` is enabled.
 * Removes the trailing `;` from the output tag content.
 */
export const SENTINEL_OUTPUT_SEMI_REMOVE = 'OUTPUT_SEMI_REMOVE';

/** Sentinel text written by the `no-one-sided-trim` fix, chosen by the tag (`oneSidedTrimFix()`). */
export const SENTINEL_ONE_SIDED_TRIM = 'ONE_SIDED_TRIM';

/**
 * Sentinel text written by the `prefer-output` fix.
 */
export const SENTINEL_PREFER_OUTPUT = 'PREFER_OUTPUT';
export const SENTINEL_PREFER_OUTPUT_ELSE = 'PREFER_OUTPUT_ELSE';
export const SENTINEL_NO_MULTILINE_OUTPUT = 'NO_MULTILINE_OUTPUT';

/** Opening line of the function wrapper injected around the full virtual file. */
const GLOBAL_VIRTUAL_OPEN = '(function() {\n{\n';
/** Closing line of the function wrapper injected around the full virtual file. */
const GLOBAL_VIRTUAL_CLOSE = '\n}\n})();';

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
 * ```
 */
/**
 * Whether a message points at the synthetic `;` appended to an output tag's expression.
 *
 * That character exists only to make the virtual JavaScript a statement; it is not in the
 * template, so a rule reporting on it is reporting on generated code. Messages from this
 * plugin's own rules and ESLint's system messages are left alone.
 */
/** The rule of `@stylistic` indenting every line, which judges the lines of the code of tags alone. */
const STYLISTIC_INDENT = '@stylistic/indent';

function isSyntheticSuffixMessage(msg: Linter.LintMessage, segment: VirtualBlockSegment): boolean {
  const { block } = segment;
  if (block.virtualBodyInlineSuffix.length === 0) {
    return false;
  }
  if (msg.ruleId === null || msg.ruleId.startsWith('ejs-templates/')) {
    return false;
  }

  // The suffix sits at the end of the last line of the tag's content, which is the line after
  // the marker comment plus however many lines that content spans.
  const codeLines = block.lintCodeContent.split('\n');
  const suffixLine = segment.startLine + codeLines.length;
  const suffixColumn =
    block.lintCodeContent.length -
    block.lintCodeContent.lastIndexOf('\n') +
    (codeLines.length === 1 ? block.virtualIndent : 0);

  return msg.line === suffixLine && msg.column >= suffixColumn;
}

/** The range of the tag of a block in the template, in 1-based columns as ESLint's. */
const tagRangeOf = (block: TagBlock, sourceText: string) =>
  rangeOf(
    { offset: block.tagOffset, length: block.tagLength, line: block.tagLine, column: block.tagColumn },
    sourceText,
  );

/**
 * Where a position of the virtual code of a block is in the template, its line counted in the block, the marker comment
 * the first: a position in the code of the tag, where its character is; on the marker, before the code, the start of the
 * tag; past the code (the lines the processor adds, the wrapper), the end of the tag for the end of a range, its start
 * otherwise.
 */
function mapPosition(
  block: TagBlock,
  sourceText: string,
  position: { line: number; column: number },
  edge: 'start' | 'end',
): { line: number; column: number } {
  // Line 1 is the marker comment; code starts on line 2.
  const codeLineIndex = position.line - 2;
  // How many lines does codeContent occupy?  A trailing '\n' does not add an
  // extra logical line — it just means the next character (the wrapper close
  // or synthetic suffix) starts on a new line.
  const codeLineCount = block.codeContent.split('\n').length - (block.codeContent.endsWith('\n') ? 1 : 0);
  if (codeLineIndex >= 0 && codeLineIndex < codeLineCount) {
    // Every line of the code at its column in the template, the first one indented as much in the virtual code: a
    // position in those blanks at the start of the code.
    return {
      line: block.originalLine + codeLineIndex,
      column:
        codeLineIndex === 0
          ? Math.max(position.column - block.virtualIndent, 1) + block.originalColumn
          : position.column,
    };
  }
  const tag = tagRangeOf(block, sourceText);
  return codeLineIndex >= 0 && edge === 'end'
    ? { line: tag.endLine, column: tag.endColumn }
    : { line: tag.line, column: tag.column };
}

/**
 * A message of the virtual code in the template, its lines counted in the block it starts in, and for its end in
 * `endBlock`, the block it ends in: a later one for a node across tags. A message on the marker of a tag alone, as the
 * rules of the conventions report, covers the tag.
 */
function mapMessage(
  msg: Linter.LintMessage,
  block: TagBlock,
  sourceText: string,
  endBlock: TagBlock = block,
): Linter.LintMessage {
  if (msg.line < 2 && endBlock === block && (msg.endLine ?? 1) < 2) {
    const tag = tagRangeOf(block, sourceText);
    return msg.endLine === undefined ? { ...msg, line: tag.line, column: tag.column } : { ...msg, ...tag };
  }
  const mapped: Linter.LintMessage = { ...msg, ...mapPosition(block, sourceText, msg, 'start') };
  if (msg.endLine !== undefined && msg.endColumn !== undefined) {
    const end = mapPosition(endBlock, sourceText, { line: msg.endLine, column: msg.endColumn }, 'end');
    mapped.endLine = end.line;
    mapped.endColumn = end.column;
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// Fix translation
// ---------------------------------------------------------------------------

function buildFormattedTag(block: TagBlock, options: { multilineCloseOnNewLine: boolean }): string {
  const { multilineCloseOnNewLine } = options;
  const trimmedContent = block.codeContent.trim();
  const wasMultiline = block.codeContent.includes('\n');

  if (trimmedContent.length === 0) {
    return `${block.openDelim} ${block.closeDelim}`;
  }

  if (!multilineCloseOnNewLine || !wasMultiline) {
    return `${block.openDelim} ${trimmedContent} ${block.closeDelim}`;
  }

  const split = trimmedContent.split('\n').map((line) => line.trimEnd());
  const lines = split.join('\n');

  if (block.closeDelim === '%>' || split.length === 1) {
    return `${block.openDelim} ${lines} ${block.closeDelim}`;
  }

  return `${block.openDelim} ${lines}\n${block.lineIndent}${block.closeDelim}`;
}

/** Escape sequences a single- or double-quoted literal may contain and still be decodable. */
const STRING_ESCAPES = new Map<string, string>([
  ['\\n', '\n'],
  ['\\r', '\r'],
  ['\\t', '\t'],
  ["\\'", "'"],
  ['\\"', '"'],
  ['\\\\', '\\'],
]);

/**
 * Text a quoted string literal evaluates to, or null when it is not a plain decodable literal.
 *
 * Decoded from the parse tree's own `string_fragment` / `escape_sequence` children rather than
 * by unescaping the raw text, so an escape this code does not understand causes a bail-out
 * instead of a wrong result. Template literals are rejected: they can interpolate.
 */
function decodeStringLiteral(node: SyntaxNode): string | null {
  if (node.type !== 'string') {
    return null;
  }
  let decoded = '';
  for (const child of node.children) {
    if (child.type === "'" || child.type === '"') continue;
    if (child.type === 'string_fragment') {
      decoded += child.text;
      continue;
    }
    // An escape sequence: one it does not know, as any other child, is not decoded.
    const value = STRING_ESCAPES.get(child.text);
    if (value === undefined) return null;
    decoded += value;
  }
  return decoded;
}

/** An output ternary whose branches are literals and whose rendered text spans lines. */
export type MultilineOutputConditionalParts = {
  condition: string;
  consequent: string;
  alternate: string;
};

/**
 * Extract the parts of an output tag of the form `<%- cond ? 'a\nb' : '' %>`.
 *
 * Returns null unless the tag is a single-line output tag holding one ternary whose branches
 * are both plain string literals and whose rendered output actually contains a newline — the
 * case where a conditional block reads better than an escaped one-liner.
 */
export function getMultilineOutputConditionalParts(block: TagBlock): MultilineOutputConditionalParts | null {
  if (block.tagType !== 'escaped-output' && block.tagType !== 'raw-output') {
    return null;
  }

  const partialNode = block.javascriptPartialNode;

  // A ternary whose strings render a line break has a `?` and an escaped `\n`: the tree of any other code is not read,
  // which ejs-template-parser parses only when it is.
  if (!block.codeContent.includes('?') || !block.codeContent.includes('\\n')) {
    return null;
  }

  const conditionalNode = partialNode.nodes.find(
    (node) => node.type === 'ternary_expression' && node.parent?.type === 'expression_statement',
  );
  if (!conditionalNode) {
    return null;
  }

  const conditionNode = conditionalNode.childForFieldName('condition');
  const consequentNode = conditionalNode.childForFieldName('consequence');
  const alternateNode = conditionalNode.childForFieldName('alternative');
  // A ternary of code that parses has its three parts.
  /* v8 ignore next -- @preserve */
  if (!conditionNode || !consequentNode || !alternateNode) return null;

  const consequent = decodeStringLiteral(consequentNode);
  const alternate = decodeStringLiteral(alternateNode);
  const condition = conditionNode.text.trim();
  if (consequent === null || alternate === null || condition.length === 0) {
    return null;
  }

  // Only the multiline case: a single-line ternary is already the more readable form, and is
  // what `prefer-output` deliberately produces.
  if (!consequent.includes('\n') && !alternate.includes('\n')) {
    return null;
  }

  return { condition, consequent, alternate };
}

/** The positive form of the negated operators of a binary test. */
const POSITIVE_OPERATORS = new Map([
  ['!==', '==='],
  ['!=', '=='],
]);

/** Unwrap one layer of parentheses, so `(a && b)` yields `a && b`. */
function unwrapParentheses(node: SyntaxNode): SyntaxNode {
  if (node.type !== 'parenthesized_expression') {
    return node;
  }
  // A parenthesized expression has the one of the field, a sequence expression its first named child.
  /* v8 ignore next -- @preserve */
  return node.childForFieldName('expression') ?? node.namedChildren.at(0) ?? node;
}

/**
 * Positive form of a negated `if` test, or null when the test is not negated.
 *
 * Mirrors what the core `no-negated-condition` rule treats as negated: a `!` unary and the
 * `!==` / `!=` binaries. Inverting the operator (rather than wrapping the whole test in
 * another `!`) is what lets the fix read as if it had been written that way by hand.
 */
function invertNegatedTest(conditionNode: SyntaxNode): string | null {
  const test = unwrapParentheses(conditionNode);

  if (test.type === 'unary_expression' && test.text.trimStart().startsWith('!')) {
    const argument = test.childForFieldName('argument');
    // A unary expression of code that parses has its argument.
    /* v8 ignore next -- @preserve */
    if (!argument) return null;
    // `!(a && b)` becomes `a && b` rather than `(a && b)`: the `if (…)` already
    // supplies the parentheses, so keeping them would double them up.
    return unwrapParentheses(argument).text.trim();
  }

  if (test.type === 'binary_expression') {
    const left = test.child(0);
    const operator = test.child(1);
    const right = test.child(2);
    const positiveOperator = operator && POSITIVE_OPERATORS.get(operator.type);
    // Core reports the binary tests `!==` and `!=` alone, of code that parses.
    /* v8 ignore next -- @preserve */
    if (!left || !right || !positiveOperator) return null;
    return `${left.text.trim()} ${positiveOperator} ${right.text.trim()}`;
  }

  return null;
}

/**
 * Positive condition for a tag holding exactly `if (<negated test>) {`, or null.
 *
 * Only the opening tag is inspected here; whether the statement actually has an `else`
 * branch to swap with is decided by the caller from the surrounding blocks.
 */
export function getNegatedIfCondition(block: CodeTagBlock): string | null {
  const javascript = block.javascriptPartialNode;
  if (javascript.multilineOriginal) {
    return null;
  }
  const conditionNode = ifOpening(tokensOf(javascript), 0)?.childForFieldName('condition');
  return conditionNode ? invertNegatedTest(conditionNode) : null;
}

/** Whether the code of a tag is exactly `} else {`, a comment aside — an `else if` continuation deliberately does not match. */
function isElseOpening(javascript: RelativeJavascriptNode): boolean {
  return tokensAre(tokensOf(javascript, { comments: false }), '}', 'else', '{');
}

/** Positive form of a negated `} else if (…) {` link's test, or null when it is not one. */
export function getNegatedElseIfCondition(block: CodeTagBlock): string | null {
  const javascript = block.javascriptPartialNode;
  if (javascript.multilineOriginal) {
    return null;
  }
  const tokens = tokensOf(javascript);
  if (!tokensAre(tokens.slice(0, 2), '}', 'else')) {
    return null;
  }
  const conditionNode = ifOpening(tokens, 2)?.childForFieldName('condition');
  return conditionNode ? invertNegatedTest(conditionNode) : null;
}

/** Whether the code of a tag is exactly `}`, a comment aside, closing a block without opening another. */
function isBlockClosing(javascript: RelativeJavascriptNode): boolean {
  return tokensAre(tokensOf(javascript, { comments: false }), '}');
}

/**
 * The block of the tree of a template a tag opens a branch of, with the index of that branch: the `if` of a block
 * is its branch 0, each `} else if (…) {` and `} else {` the next one. A tag opening several blocks opens a branch of
 * the outer one.
 */
function findBranch(children: EjsTemplateNode[], offset: number): { block: EjsBlock; index: number } | null {
  for (const node of children) {
    if (node.kind !== 'block') continue;
    const index = node.branches.findIndex((branch) => branch.open.offset === offset);
    if (index !== -1) return { block: node, index };
    for (const branch of node.branches) {
      const found = findBranch(branch.children, offset);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The `} else {` and closing `}` tags of the `if` (or `} else if (…) {` link) a tag opens, from the tree of the
 * template: its branch is followed by a plain `} else {` branch, the last one, and the block closes with a plain `}`.
 *
 * Returns null when the statement has no `else`, when the next branch is an `else if` link (the chain cannot be
 * swapped past it), or when the template ends with the block open.
 */
export function findNegatedConditionBranches(
  template: EjsTemplate,
  block: TagBlock,
): { elseTag: EjsCodeTag; closeTag: EjsCodeTag } | null {
  const found = findBranch(template.children, block.tagOffset);
  // A tag opening a block is in the tree; core reports an `if` whose `else` is no `if`, a branch the last one, in
  // code that parses, which closes its blocks.
  /* v8 ignore next -- @preserve */
  if (!found) return null;
  const { branches, close } = found.block;
  const elseBranch = branches.at(found.index + 1);
  /* v8 ignore next -- @preserve */
  if (!elseBranch || found.index + 2 !== branches.length || !close) return null;
  if (!isElseOpening(elseBranch.open.javascript) || !isBlockClosing(close.javascript)) return null;
  return { elseTag: elseBranch.open, closeTag: close };
}

/** Output tag types, including the multiline variants. */
const OUTPUT_TAG_TYPES = new Set<string>([
  'escaped-output',
  'raw-output',
  'escaped-output-multiline',
  'raw-output-multiline',
]);

/** Whether a tag renders a value, regardless of whether its content spans lines. */
export const isOutputTagType = (tagType: string): boolean => OUTPUT_TAG_TYPES.has(tagType);

/**
 * The fix of a tag trimming one side alone (`no-one-sided-trim`), the output unchanged, or null:
 * - an output tag, its `-%>` or `_%>` written `%>`, what it removed after it removed from the text, the next line
 *   joining the line of the tag (`editTemplate()`); not before a `<%%`, which writes without clearing what the next
 *   text loses (docs/ejs.md, the truncation), and which `editTemplate()` does not follow there;
 * - a code tag opened by `<%` at the start of its line, opened by `<%_`, which slurps nothing there; indented, `<%_`
 *   would slurp its indentation, which the tag renders;
 * - a code tag opened by `<%_` and closed by `%>`, closed by `-%>` before text, which drops nothing then; by `_%>`
 *   before the end of its line, and a line break after it, which `_%>` slurps: what is after the tag renders as it
 *   did, the empty line the tag rendered written out.
 */
function oneSidedTrimFix(block: CodeTagBlock, template: EjsTemplate): Rule.Fix | null {
  const end = block.tagOffset + block.tagLength;
  const closeStart = end - block.closeDelim.length;
  if (isOutputTagType(block.tagType)) {
    if (template.text.startsWith('<%%', end)) return null;
    const source = template.text.slice(block.tagOffset, closeStart);
    return editFix(template, [{ offset: block.tagOffset, length: block.tagLength, text: [{ tag: `${source}%>` }] }]);
  }
  if (block.openDelim === '<%') {
    return block.closeDelim !== '%>' && block.isStandalone && block.lineIndent === ''
      ? { range: [block.tagOffset, block.tagOffset + block.openDelim.length], text: '<%_' }
      : null;
  }
  if (block.closeDelim !== '%>') return null;
  const after = template.text.slice(end);
  const [restOfLine] = after.split(/\r\n|\r|\n/u, 1);
  if (restOfLine.trim() !== '') return { range: [closeStart, end], text: '-%>' };
  const lineBreak = /\r\n|\r|\n/u.exec(after)?.[0] ?? '\n';
  return { range: [closeStart, end], text: after === '' ? '_%>' : `_%>${lineBreak}` };
}

/** The characters `<%=` escapes, as EJS escapes them (`escapeXML`). */
const HTML_ESCAPED = /[&<>'"]/u;

/**
 * What EJS renders of the children of a branch, from the `rendered` of its texts: null when a tag other than a
 * comment, or a block, is among them, which renders no text of its own.
 */
function renderedOf(children: EjsTemplateNode[]): string | null {
  let rendered = '';
  for (const node of children) {
    if (node.kind === 'text') {
      rendered += node.rendered;
    } else if (node.kind === 'block' || node.type !== 'comment') {
      return null;
    }
  }
  return rendered;
}

/** The errors of ejs-template-parser which the JavaScript of a template does not parse by. */
const JAVASCRIPT_ERRORS = new Set<EjsDiagnosticCode>(['javascript-error', 'unclosed-block', 'unopened-close']);

/** Rule id of the built-in ESLint rule this plugin supplies an autofix for. */
const CORE_NO_NEGATED_CONDITION = 'no-negated-condition';

/** Source offset of a 1-based line and 1-based column. */
function offsetOfPosition(sourceText: string, line: number, column: number): number {
  return sourceText.split('\n', line - 1).reduce((offset, text) => offset + text.length + 1, 0) + column - 1;
}

/**
 * Rewrite a negated ternary in place: `!c ? a : b` => `c ? b : a`.
 *
 * The ternary's own source range is replaced rather than the surrounding tag, so this works
 * wherever the expression sits — the whole content of an output tag, a nested
 * `${…}` inside a template literal, or an assignment inside a code tag. Nothing outside the
 * expression is touched, so delimiters, spacing and any trailing semicolon survive untouched.
 *
 * `targetOffset` is the source offset the rule reported at; a tag may hold several ternaries,
 * and only the reported one should be rewritten.
 */
function buildNegatedTernaryFix(
  block: CodeTagBlock,
  targetOffset: number | undefined,
): { range: [number, number]; text: string } | null {
  const partialNode = block.javascriptPartialNode;

  const contentStart = block.tagOffset + block.openDelim.length;
  let best: { range: [number, number]; text: string } | null = null;

  for (const node of partialNode.nodes) {
    if (node.type !== 'ternary_expression') {
      continue;
    }

    const conditionNode = node.childForFieldName('condition');
    const consequentNode = node.childForFieldName('consequence');
    const alternateNode = node.childForFieldName('alternative');
    // A ternary of code that parses has its three parts.
    /* v8 ignore next -- @preserve */
    if (!conditionNode || !consequentNode || !alternateNode) continue;

    const positiveCondition = invertNegatedTest(conditionNode);
    if (!positiveCondition) {
      continue;
    }

    const start = contentStart + (node.startIndex - partialNode.start);
    const end = start + (node.endIndex - node.startIndex);
    if (targetOffset !== undefined && (targetOffset < start || targetOffset >= end)) {
      continue;
    }

    // Ternaries nest, the nodes in pre-order: the last one covering the reported position is the innermost, the
    // expression the rule reported on.
    best = {
      range: [start, end],
      text: `${positiveCondition} ? ${alternateNode.text.trim()} : ${consequentNode.text.trim()}`,
    };
  }

  return best;
}

/**
 * Build the EJS source edit that resolves a core `no-negated-condition` report.
 *
 * ```
 * <% if (!c) { %>A<% } else { %>B<% } %>  =>  <% if (c) { %>B<% } else { %>A<% } %>
 * ```
 *
 * The core rule reports this correctly in EJS templates — the virtual JavaScript keeps the
 * `if`/`else` structure intact — but cannot fix it, because the branch bodies are template
 * markup sitting between tags, outside the JavaScript it sees. Rather than duplicating the
 * rule, the processor attaches this fix to the core rule's own report.
 *
 * Handles both forms the core rule reports in EJS: a negated `if`/`else` pair spanning tags,
 * and a negated ternary inside a single output tag. Returns null for anything else.
 */
function buildNegatedConditionFix(
  block: CodeTagBlock,
  template: EjsTemplate,
  sourceText: string,
  targetOffset?: number,
): { range: [number, number]; text: string } | null {
  // Either an `if` tag or an `} else if (…) {` link. Swapping a link's own two branches keeps
  // the chain around it intact — the outer `if` and the closing tag are never touched — and the
  // core rule only reports a link whose own `else` is a plain block, which is exactly the shape
  // the branch matcher looks for.
  const ifCondition = getNegatedIfCondition(block);
  const elseIfCondition = ifCondition === null ? getNegatedElseIfCondition(block) : null;
  const positiveCondition = ifCondition ?? elseIfCondition;
  const branches = positiveCondition === null ? null : findNegatedConditionBranches(template, block);
  if (positiveCondition === null || !branches) {
    // Not an `if`/`else` pair; the other form the core rule reports is a negated ternary.
    return buildNegatedTernaryFix(block, targetOffset);
  }

  const { elseTag: elseNode, closeTag: closeNode } = branches;
  const ifTagEnd = block.tagOffset + block.tagLength;
  const elseTagStart = elseNode.offset;
  const elseTagEnd = elseNode.offset + elseNode.length;
  const closeTagStart = closeNode.offset;
  const closeTagEnd = closeNode.offset + closeNode.length;

  // Branch bodies are carried over verbatim, so template markup and indentation survive the swap
  // untouched. What a body renders depends on the delimiters around it as well: the close
  // delimiter of the tag before it (the line break a `-%>` drops, the blanks a `_%>` slurps)
  // and the open delimiter of the tag after it (the blanks a `<%_` slurps). They move with it:
  // each body keeps its neighbours, and the delimiters out of the statement stay as they are.
  const consequentBody = sourceText.slice(ifTagEnd, elseTagStart);
  const alternateBody = sourceText.slice(elseTagEnd, closeTagStart);
  const elseTag = `${closeNode.openDelim}${elseNode.code}${block.closeDelim}`;
  const closeTag = `${elseNode.openDelim}${closeNode.code}${closeNode.closeDelim}`;
  const openingTag =
    elseIfCondition === null
      ? `${block.openDelim} if (${positiveCondition}) { ${elseNode.closeDelim}`
      : `${block.openDelim} } else if (${positiveCondition}) { ${elseNode.closeDelim}`;

  return {
    range: [block.tagOffset, closeTagEnd],
    text: `${openingTag}${alternateBody}${elseTag}${consequentBody}${closeTag}`,
  };
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
 * - Generic sentinel (`text === ''`): used by `prefer-encoded`.
 * - `conventionSentinel(code)`: used by the rules of the conventions ejs-template-parser
 *   diagnoses, whose fixes `fixOf()` of the parser gives.
 * - `SENTINEL_PREFER_SLURP_MULTILINE`: used by `prefer-slurp-multiline`.
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
  options: {
    applyIndentForSingleLineTags: boolean;
    /** The template, for the fixes spanning several tags: its blocks, and what EJS renders of its texts. */
    template: EjsTemplate;
    /** The diagnostics of the template, the conventions its tags break, which the rules reporting them fix. */
    diagnostics: EjsDiagnostic[];
  },
): { range: [number, number]; text: string } | null {
  /** The fix ejs-template-parser gives the convention of a code for the tag of the block (`fixOf()`). */
  const conventionFix = (code: EjsDiagnosticCode, fixOptions?: EjsFixOptions) => {
    const conventional = fixOf(options.template, { code, offset: block.tagOffset }, fixOptions);
    return conventional
      ? {
          range: [conventional.offset, conventional.offset + conventional.length] satisfies [number, number],
          text: conventional.text,
        }
      : null;
  };
  // The fix of a convention, the comment tags' one among them: the one of the diagnostic of the tag, if it has one.
  if (fix.range[0] === 0 && fix.text.startsWith(SENTINEL_CONVENTION)) {
    const code = fix.text.slice(SENTINEL_CONVENTION.length);
    const diagnostic = options.diagnostics.find(
      (candidate) => candidate.code === code && candidate.offset === block.tagOffset,
    );
    return diagnostic
      ? conventionFix(diagnostic.code, { indentSplitTags: options.applyIndentForSingleLineTags })
      : null;
  }
  // A comment tag has no fix but the one of its convention: no rule fixes the comment of a directive, the virtual
  // code of its block.
  /* v8 ignore next -- @preserve */
  if (block.isDirectiveComment) return null;

  const trimmedCodeContent = block.codeContent.trim();
  // ── Sentinel fix detection ─────────────────────────────────────────────
  // All plugin-rule sentinels start at offset 0 in the virtual file.
  if (fix.range[0] !== 0) {
    // Fall through to the general JS fix handler below.
  } else if (fix.text === SENTINEL_PREFER_SLURP_MULTILINE) {
    // prefer-slurp-multiline: change multiline `<% … %>` → `<%_ … _%>` (content unchanged)
    if (block.tagType === 'code-multiline' || block.tagType === 'code-slurpable-multiline') {
      return {
        range: [block.tagOffset, block.tagOffset + block.tagLength],
        text: `<%_ ${trimmedCodeContent} _%>`,
      };
    }
    return null;
  } else if (fix.text === SENTINEL_INDENT_CONTENT || fix.text === SENTINEL_INDENT_CONTENT_GREATER_OR_EQUAL) {
    // indent-content: the lines of a tag spanning lines indented with the tag, which stays where it is.
    const binaryOperands = fix.text === SENTINEL_INDENT_CONTENT ? 'greater' : 'greaterOrEqual';
    return block.isStandalone && block.tagType === 'slurp-multiline'
      ? conventionFix('indent', { normalizeContent: true, indentTag: false, binaryOperands })
      : null;
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
  } else if (fix.text === SENTINEL_OUTPUT_SEMI_ADD) {
    // output-semi (always): insert `;` at the end of the trimmed code content
    if (isOutputTagType(block.tagType)) {
      const insertPos = block.tagOffset + block.openDelim.length + block.codeContent.trimEnd().length;
      return { range: [insertPos, insertPos], text: ';' };
    }
    return null;
  } else if (fix.text === SENTINEL_OUTPUT_SEMI_REMOVE) {
    // output-semi (never): remove the trailing `;` from the code content
    if (isOutputTagType(block.tagType)) {
      const trimmedContent = block.codeContent.trimEnd();
      if (trimmedContent.endsWith(';')) {
        const semiPos = block.tagOffset + block.openDelim.length + trimmedContent.length - 1;
        return { range: [semiPos, semiPos + 1], text: '' };
      }
    }
    return null;
  } else if (fix.text === SENTINEL_ONE_SIDED_TRIM) {
    return oneSidedTrimFix(block, options.template);
  } else if (fix.text === SENTINEL_PREFER_OUTPUT || fix.text === SENTINEL_PREFER_OUTPUT_ELSE) {
    // prefer-output: convert wrapper conditionals to output ternary:
    // `<% if (cond) { %>a<% } %>` => `<%= cond ? 'a' : '' %>`
    // `<% if (cond) { %>a<% } else { %>b<% } %>` => `<%= cond ? 'a' : 'b' %>`
    // The strings are what EJS renders of the branches, not their source: `%%>` renders `%>`, and the
    // delimiters of the tags slurp blanks and line breaks around them.
    if (block.tagType !== 'code' || block.openDelim !== '<%') {
      return null;
    }

    // The branches of the `if` the tag opens, from the tree of the template, re-checked against what the rule
    // reported: one, or two when the second is a plain `} else {`, and the block closed by a plain `}`.
    const found = findBranch(options.template.children, block.tagOffset);
    const branches = found?.index === 0 ? found.block.branches : [];
    const close = found?.block.close;
    if (
      !close ||
      branches.length !== (fix.text === SENTINEL_PREFER_OUTPUT_ELSE ? 2 : 1) ||
      (branches.length === 2 && !isElseOpening(branches[1].open.javascript)) ||
      !isBlockClosing(close.javascript)
    ) {
      return null;
    }

    const condition = block.javascriptPartialNode.nodes.find((n) => n.type === 'parenthesized_expression')?.text;
    // The rule reports an `if (…) {`, whose condition is in parentheses.
    /* v8 ignore next -- @preserve */
    if (!condition) return null;

    const [truthyContent, falsyContent = ''] = branches.map((branch) => renderedOf(branch.children));

    // Apply only when the full wrapper (tags + outputs) stays on one line.
    if (
      truthyContent === null ||
      falsyContent === null ||
      truthyContent.includes('\n') ||
      falsyContent.includes('\n')
    ) {
      return null;
    }

    // A `<%` or a `%>` in the string would open or close a tag of its own: their `%` and `>` are written escaped.
    const escapeForSingleQuote = (content: string): string => {
      return content
        .replace(/\\/gu, '\\\\')
        .replace(/'/gu, "\\'")
        .replace(/\r/gu, '\\r')
        .replace(/\n/gu, '\\n')
        .replaceAll('<%', '<\\x25')
        .replaceAll('%>', '%\\x3E');
    };

    const escapedTruthyContent = escapeForSingleQuote(truthyContent);
    const escapedFalsyContent = escapeForSingleQuote(falsyContent);
    // `<%=` escapes the HTML of the value, which the text of a branch is not: raw when that would change it. The close
    // delimiter of the last tag stays, with the line break or the blanks it drops after it.
    const openDelim = HTML_ESCAPED.test(truthyContent + falsyContent) ? '<%-' : '<%=';

    return editFix(options.template, [
      {
        offset: block.tagOffset,
        length: close.offset + close.length - block.tagOffset,
        text: [
          {
            tag: `${openDelim} ${condition} ? '${escapedTruthyContent}' : '${escapedFalsyContent}' ${close.closeDelim}`,
          },
        ],
      },
    ]);
  } else if (fix.text === SENTINEL_NO_MULTILINE_OUTPUT) {
    // no-multiline-output: `<%- cond ? 'a\nb' : '' %>` => a conditional block.
    const parts = getMultilineOutputConditionalParts(block);
    if (!parts) {
      return null;
    }

    // `<%=` escapes its value, whereas the template text the fix produces is emitted raw. The
    // two only agree when the rendered text has nothing to escape, so a `<%=` tag carrying any
    // of EJS's escaped characters is reported without a fix rather than silently changing what
    // the template renders.
    if (block.tagType === 'escaped-output' && /[&<>"']/u.test(parts.consequent + parts.alternate)) {
      return null;
    }

    // Non-slurp tags, with the branch text written flush against them. `<%_`/`_%>` would
    // swallow the surrounding whitespace and newlines, so a slurp block renders differently
    // from the output tag it replaces — it drops the newline the original tag's own line
    // contributes, and drops a leading indent that was literal output. Plain `<% %>` tags emit
    // nothing themselves and consume nothing around them, so writing the text with no added
    // line breaks reproduces the original output exactly, wherever the tag sits. The last tag
    // closes with the delimiter of the output tag, and drops after it what that one dropped:
    // the line break after a `-%>`, the blanks and the line break after a `_%>`.
    const pieces: (string | { tag: string })[] = [{ tag: `<% if (${parts.condition}) { %>` }, parts.consequent];
    if (parts.alternate.length > 0) {
      pieces.push({ tag: '<% } else { %>' }, parts.alternate);
    }
    pieces.push({ tag: `<% } ${block.closeDelim}` });

    return editFix(options.template, [{ offset: block.tagOffset, length: block.tagLength, text: pieces }]);
  } else if (fix.text === '') {
    // ── Generic sentinel (fix.text === '') ────────────────────────────────

    // prefer-encoded (never): change `<%=` → `<%-`
    if (block.tagType === 'escaped-output') {
      return { range: [block.tagOffset + 2, block.tagOffset + 3], text: '-' };
    }

    // prefer-encoded: change `<%-` → `<%=`
    if (block.tagType === 'raw-output') {
      return { range: [block.tagOffset + 2, block.tagOffset + 3], text: '=' };
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
  //   <codeContent><virtualBodyInlineSuffix>
  //
  // codeContent starts at byte offset:
  //   codeContentStart = markerLen + virtualIndent
  //
  // where markerLen = '//@ejs-tag:'.length + tagType.length + 1  (+1 for '\n'), and virtualIndent the blanks the first
  // line of the code is indented with, which a fix starting there does not fix in the template.
  const markerLen = '//'.length + EJS_MARKER_PREFIX.length + block.tagType.length + 1;
  const codeContentStart = markerLen + block.virtualIndent;
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
 * Position mapping for a single EJS tag block within the function-wrapped virtual file
 * (`GLOBAL_VIRTUAL_OPEN + blocks + GLOBAL_VIRTUAL_CLOSE`), used for message and fix translation.
 *
 * Line and offset numbers are absolute positions within the virtual file.
 * They are used during postprocess() to locate ESLint messages and map them back to
 * the corresponding TagBlock for translation to original EJS source positions.
 */
type VirtualBlockSegment<Block extends TagBlock = TagBlock> = {
  block: Block;
  /** 1-based start line of this block inside the combined virtual file. */
  startLine: number;
  /** 1-based end line of this block inside the combined virtual file. */
  endLine: number;
  /** 0-based start offset of this block inside the combined virtual file. */
  startOffset: number;
  /** 0-based end offset (exclusive) of this block inside the combined virtual file. */
  endOffset: number;
};

/**
 * The template of each file, from preprocess() to postprocess(), which frees its trees, the ones of the code of its
 * tags (the `javascriptPartialNode`s of the blocks) included.
 */
const processedFilesMap = new Map<
  string,
  {
    sourceText: string;
    template: EjsTemplate;
    diagnostics: EjsDiagnostic[];
  }
>();

type FileBlocks = {
  segments: VirtualBlockSegment[];
  /** The segments of the code and output tags, in order: the blocks with a marker. */
  codeSegments: VirtualBlockSegment<CodeTagBlock>[];
};

/**
 * File-level mapping from ESLint virtual code to position metadata.
 *
 * Stores two VirtualBlockSegment arrays for each file:
 * - segments: Block positions in the virtual code
 * - codeSegments: The segments of the code and output tags, without the comment ones
 *
 * Lifecycle: set in preprocess(), deleted in postprocess().
 */
const fileBlocksMap = new Map<string, FileBlocks>();

export const getFileBlocks = (filename: string): FileBlocks | undefined => {
  return fileBlocksMap.get(filename);
};

/**
 * Cached formatting state for tags to detect if they already match format rules.
 */
type TagFormatState = {
  isFormattedDefault: boolean;
  isFormattedMultilineClose: boolean;
};

/**
 * Unified metadata for a single virtual code block.
 *
 * Combines all per-tag metadata needed by ESLint rules:
 * - tagFormat: array of TagFormatState objects for format rule detection
 */
type VirtualCodeMetadata = {
  tagFormat: TagFormatState[];
  /**
   * Index i is true when the i-th non-directive slurp-multiline block needs content normalization, by the `binaryOperands`
   * of `indent-content`: a block needing it with `greaterOrEqual` needs it with `greater`, which leaves fewer lines as written.
   */
  needsNormalize: Record<'greater' | 'greaterOrEqual', boolean[]>;
  /**
   * Index i is true when the i-th non-directive block ends the template: nothing after it but blanks and a line break,
   * the final one, which a `-%>` or `_%>` keeps out of the output of a partial.
   */
  endsTemplate: boolean[];
  /** The diagnostics of the template, `validateTemplate()` of ejs-template-parser, in its coordinates. */
  diagnostics: EjsDiagnostic[];
};

/**
 * The rules reporting diagnostics of the template, with the code of their diagnostic. Their diagnostics are in the
 * coordinates of the template, a stray close delimiter in a text the virtual JavaScript does not have: such a rule
 * requests them with one message at the end of the virtual file, and postprocess() answers the request with them, in
 * the template, with the severity and the `suppressions` of the request.
 */
export const DIAGNOSTIC_RULES = {
  'ejs-templates/no-stray-close-delimiter': 'stray-close-delimiter',
  'ejs-templates/no-comment-across-tags': 'comment-across-tags',
} as const satisfies Record<string, EjsDiagnosticCode>;

type DiagnosticRuleId = keyof typeof DIAGNOSTIC_RULES;

const isDiagnosticRuleId = (ruleId: string | null): ruleId is DiagnosticRuleId =>
  ruleId !== null && Object.hasOwn(DIAGNOSTIC_RULES, ruleId);

/**
 * Request the diagnostics of the code of a rule of `DIAGNOSTIC_RULES`, when the template has one: one message at the
 * end of the virtual file, after every directive comment of the template, which postprocess() answers.
 */
export function requestDiagnostics(context: Rule.RuleContext, ruleId: DiagnosticRuleId, messageId: string): void {
  const { sourceCode } = context;
  const code = DIAGNOSTIC_RULES[ruleId];
  if (!getVirtualCodeMetadata(sourceCode.text)?.diagnostics.some((diagnostic) => diagnostic.code === code)) return;
  const { lines } = sourceCode;
  context.report({ loc: { line: lines.length, column: lines[lines.length - 1].length }, messageId });
}

/**
 * Unified per-virtual-code metadata tracking.
 *
 * Consolidates three metadata arrays for each wrapped virtual code:
 *   (if/while/for/try/etc). Used by prefer-single-line-tags rule.
 *   a single line after trim(). Used by prefer-single-line-tags rule.
 * - **tagFormat**: Index i contains TagFormatState for i-th non-directive block,
 *   tracking which format rules the tag already satisfies. Used by format rule.
 *
 * Lifecycle: set in preprocess(), deleted in postprocess().
 */
const virtualCodeMetadataMap = new Map<string, VirtualCodeMetadata>();

/**
 * The blocks of the tags with a diagnostic of a code of ejs-template-parser, each one with the marker comment its
 * virtual code starts with: the conventions the parser shares with the plugin (`conventionsOf()` of its diagnostics),
 * which a rule reports on the marker of the block, with its sentinel fix. None in a pass without the metadata of the
 * template, the raw one. The directive blocks are left out: the `eslint-enable` an `eslint-disable-next-line`
 * synthesizes carries the position of the tag after it.
 */
export function getDiagnosticBlocks(
  context: Rule.RuleContext,
  code: EjsDiagnosticCode,
): { block: TagBlock; comment: VirtualMarkerComment }[] {
  const diagnostics = getVirtualCodeMetadata(context.sourceCode.text)?.diagnostics ?? [];
  const offsets = new Set(diagnostics.filter((diagnostic) => diagnostic.code === code).map(({ offset }) => offset));
  if (offsets.size === 0) return [];
  // A virtual code with the metadata of a template has its blocks.
  /* v8 ignore next -- @preserve */
  return (getFileBlocks(context.filename)?.segments ?? [])
    .filter(({ block }) => block.tagType !== 'directive-comment' && offsets.has(block.tagOffset))
    .map(withMarkerComment);
}

/**
 * Reports each tag ejs-template-parser diagnoses with a code, on the marker comment of its block, with the fix of the
 * convention: the one `fixOf()` of the parser gives (`conventionSentinel()`).
 */
export function reportConventions(
  context: Rule.RuleContext,
  code: EjsDiagnosticCode,
  messageIdOf: (block: TagBlock) => string,
): void {
  for (const { block, comment } of getDiagnosticBlocks(context, code)) {
    context.report({
      loc: comment.loc,
      messageId: messageIdOf(block),
      fix: (fixer) => fixer.replaceTextRange(comment.range, conventionSentinel(code)),
    });
  }
}

/** The block of a segment, with the marker comment its virtual code starts with, which a rule reports on. */
const withMarkerComment = <Block extends TagBlock>({
  block,
  startLine,
  startOffset,
}: VirtualBlockSegment<Block>): { block: Block; comment: VirtualMarkerComment } => {
  const [marker] = block.virtualCode.split('\n', 1);
  return {
    block,
    comment: {
      type: 'Line',
      value: marker.slice(2),
      range: [startOffset, startOffset + marker.length],
      loc: { start: { line: startLine, column: 0 }, end: { line: startLine, column: marker.length } },
    },
  };
};

/**
 * The block of each code and output tag of the template, in order, with the marker comment its virtual code starts
 * with: the tags the rules of the plugin report on. None for a file the processor did not preprocess.
 */
export function getTagBlocks(context: Rule.RuleContext): { block: CodeTagBlock; comment: VirtualMarkerComment }[] {
  return (getFileBlocks(context.filename)?.codeSegments ?? []).map(withMarkerComment);
}

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
    .map((msg) => `- line ${String(msg.line)}, col ${String(msg.column)}: ${msg.message}`)
    .join('\n');
  const virtualCode = `${GLOBAL_VIRTUAL_OPEN}${segments.map((s) => s.block.virtualCode).join('\n')}${GLOBAL_VIRTUAL_CLOSE}`;
  debug(
    `[ejs-templates] ESLint fatal error while processing ${filename}:\n${renderedErrors}\nVirtual code:\n${virtualCode}`,
  );
}

/**
 * Where what EJS drops after an offset of a template ends, in the text there: at the next character it renders
 * (after the blanks a `_%>` slurps and the line break a `-%>` or a `_%>` drops), never past another close delimiter.
 */
function droppedEnd(sourceText: string, texts: EjsText[], offset: number): number {
  const text = texts.find((t) => t.offset <= offset && offset < t.offset + t.length);
  if (!text) return offset;
  const nextRendered = text.renderedOffsets.find((renderedOffset) => renderedOffset >= offset) ?? offset;
  const nextDelimiter = /[-_]?%>/g;
  nextDelimiter.lastIndex = offset;
  return Math.min(nextRendered, nextDelimiter.exec(sourceText)?.index ?? nextRendered, text.offset + text.length);
}

/**
 * The fix of edits of the template, the rest of it rendering as before (`editTemplate()` of the parser, on the template
 * built already): one replacement, of the edits and of what is written again around them, without what is left as it
 * was. The edits delete whole tags, or a part of a text: none is out of the template, overlaps another, or cuts a
 * tag, which `editTemplate()` refuses.
 */
function editFix(template: EjsTemplate, edits: EjsEdit[]): Rule.Fix {
  const { replacements } = editTemplate(template, edits);
  const source = template.text;
  // The ranges written again, as one: what is between them is left as it was.
  const spanStart = Math.min(...replacements.map(({ offset }) => offset));
  const spanEnd = Math.max(...replacements.map(({ offset, length }) => offset + length));
  let replaced = '';
  let at = spanStart;
  for (const { offset, length, text } of replacements) {
    replaced += source.slice(at, offset) + text;
    at = offset + length;
  }
  // Without what is written again as it was. Never short of an edit: a deletion followed by the characters it starts
  // with would otherwise move onto them.
  const first = Math.min(...edits.map(({ offset }) => offset));
  const last = Math.max(...edits.map(({ offset, length }) => offset + length));
  let start = spanStart;
  let end = spanEnd;
  let replacedEnd = replaced.length;
  const sameAt = (offset: number, replacedOffset: number) => source[offset] === replaced[replacedOffset];
  while (start < first && sameAt(start, start - spanStart)) start++;
  while (end > last && replacedEnd > start - spanStart && sameAt(end - 1, replacedEnd - 1)) {
    end--;
    replacedEnd--;
  }
  // Then, inside the edits, what they leave as it was.
  while (start < end && start - spanStart < replacedEnd && sameAt(start, start - spanStart)) start++;
  while (end > start && replacedEnd > start - spanStart && sameAt(end - 1, replacedEnd - 1)) {
    end--;
    replacedEnd--;
  }
  return { range: [start, end], text: replaced.slice(start - spanStart, replacedEnd) };
}

/** The fix removing a tag, with what EJS drops after it, the rest of the template rendering as before. */
function removeTag(block: TagBlock, template: EjsTemplate): Rule.Fix {
  return editFix(template, [{ offset: block.tagOffset, length: block.tagLength }]);
}

/**
 * The suggestions of a stray close delimiter, deleted with what EJS drops along with it, the output unchanged, or
 * written literally, the output then has what is deleted (see `editFix()`).
 */
function strayCloseDelimiterSuggestions(diagnostic: EjsDiagnostic, template: EjsTemplate): Linter.LintSuggestion[] {
  const { offset, length } = diagnostic;
  const texts = template.nodes.filter((node) => node.kind === 'text');
  const deletedEnd = droppedEnd(template.text, texts, offset + length);
  return [
    {
      desc: 'Write it literally, the output then has it',
      fix: editFix(template, [
        { offset, length: deletedEnd - offset, text: [template.text.slice(offset, deletedEnd)] },
      ]),
    },
    { desc: 'Delete it, the output unchanged', fix: editFix(template, [{ offset, length: deletedEnd - offset }]) },
  ];
}

/**
 * Answer the requests of the rules reporting diagnostics of the template (see `DIAGNOSTIC_RULES`): one message by
 * diagnostic of the code of the rule, in the template, with the severity and the `suppressions` of the request, which
 * ESLint passes to postprocess() suppressed by a directive comment.
 */
/** The range of a diagnostic of ejs-template-parser in an ESLint message: 1-based columns, a tag spanning lines. */
function rangeOf(
  diagnostic: Pick<EjsDiagnostic, 'offset' | 'length' | 'line' | 'column'>,
  sourceText: string,
): { line: number; column: number; endLine: number; endColumn: number } {
  const lines = sourceText.slice(diagnostic.offset, diagnostic.offset + diagnostic.length).split('\n');
  const lastLine = lines[lines.length - 1];
  return {
    line: diagnostic.line,
    column: diagnostic.column + 1,
    endLine: diagnostic.line + lines.length - 1,
    endColumn: (lines.length === 1 ? diagnostic.column + 1 : 1) + lastLine.length,
  };
}

function answerDiagnosticRequests(
  messages: (Linter.LintMessage | Linter.SuppressedLintMessage)[],
  diagnostics: EjsDiagnostic[],
  template: EjsTemplate,
): Linter.LintMessage[] {
  const sourceText = template.text;
  return messages.flatMap((request) => {
    const { ruleId, severity } = request;
    if (!isDiagnosticRuleId(ruleId)) return [];
    const code = DIAGNOSTIC_RULES[ruleId];
    return diagnostics
      .filter((diagnostic) => diagnostic.code === code)
      .map((diagnostic) => {
        const message: Linter.LintMessage | Linter.SuppressedLintMessage = {
          ...('suppressions' in request && { suppressions: request.suppressions }),
          ruleId,
          severity,
          message: diagnostic.message,
          ...rangeOf(diagnostic, sourceText),
        };
        if (code === 'stray-close-delimiter') {
          message.suggestions = strayCloseDelimiterSuggestions(diagnostic, template);
        }
        return message;
      });
  });
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
 * Find the matching `eslint-enable` directive for an `eslint-disable` directive listing rules: the next
 * `eslint-enable` without a rule list, which re-enables them all, or with the same rules, in any order. Its rules
 * with it, none for one without a list.
 *
 * Used for translating fixes that remove or update unused `eslint-disable` directives,
 * so the corresponding `eslint-enable` can be updated or removed together.
 */
function findMatchingEnableDirective(
  blocks: TagBlock[],
  currentBlockIndex: number,
  disableRuleIds: string[],
): { block: TagBlock; index: number; ruleIds: string[] } | null {
  const disabled = new Set(disableRuleIds);
  for (let i = currentBlockIndex + 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.isDirectiveComment || block.nextLineDirective) continue;
    const enableMatch = /^eslint-enable(?:\s+(.*))?$/u.exec(block.codeContent);
    if (!enableMatch) continue;
    const [, enableRuleListRaw = ''] = enableMatch;
    const ruleIds = enableRuleListRaw
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    if (ruleIds.length === 0 || (ruleIds.length === disabled.size && ruleIds.every((r) => disabled.has(r)))) {
      return { block, index: i, ruleIds };
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
 * 2. Whether to remove/update a matching enable directive listing the rules, at `enableIndex` among the blocks
 *
 * A directive removed goes with what EJS drops after its tag, the line break after a `-%>`: left behind, it would
 * render.
 */
function translateUnusedDirectiveFix(
  msg: Linter.LintMessage,
  blocks: TagBlock[],
  blockIndex: number,
  template: EjsTemplate,
): { disableFix: Rule.Fix; enableIndex?: number; enableFix?: Rule.Fix } | null {
  const block = blocks[blockIndex];
  const directiveMatch = /^eslint-disable(?:-next-line)?(?:\s+(.*))?$/u.exec(block.codeContent);
  if (
    !block.isDirectiveComment ||
    msg.ruleId !== null ||
    !msg.message.startsWith('Unused eslint-disable directive') ||
    !directiveMatch
  ) {
    return null;
  }

  const [, ruleListRaw = ''] = directiveMatch;
  const currentRuleIds = ruleListRaw
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (currentRuleIds.length === 0) {
    // `eslint-disable` with no explicit rule list: drop the whole directive tag.
    return { disableFix: removeTag(block, template) };
  }

  // ESLint names the unused rules as the directive lists them.
  const unusedRuleIds = new Set(extractUnusedDirectiveRuleIds(msg.message));
  const remainingRuleIds = currentRuleIds.filter((ruleId) => !unusedRuleIds.has(ruleId));
  /* v8 ignore next -- @preserve */
  if (remainingRuleIds.length === currentRuleIds.length) return null;

  const disableFix =
    remainingRuleIds.length === 0
      ? removeTag(block, template)
      : {
          range: [block.tagOffset, block.tagOffset + block.tagLength] satisfies [number, number],
          text: `<%# ${block.nextLineDirective ? 'eslint-disable-next-line' : 'eslint-disable'} ${remainingRuleIds.join(', ')} ${block.closeDelim}`,
        };

  // An `eslint-enable` without a rule list needs no update.
  const enable = findMatchingEnableDirective(blocks, blockIndex, currentRuleIds);
  if (!enable || enable.ruleIds.length === 0) return { disableFix };
  return {
    disableFix,
    enableIndex: enable.index,
    // Both removed: an `eslint-enable` left alone would enable rules nothing disables.
    enableFix:
      remainingRuleIds.length === 0
        ? removeTag(enable.block, template)
        : {
            range: [enable.block.tagOffset, enable.block.tagOffset + enable.block.tagLength],
            text: `<%# eslint-enable ${remainingRuleIds.join(', ')} ${enable.block.closeDelim}`,
          },
  };
}

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
 * detect EJS-specific patterns. No brace is added: a template whose tags do not balance their blocks does
 * not parse, and the parser tells its errors (`javascript-error`, `unclosed-block`, `unopened-close`), which
 * `postprocess()` reports.
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
   * 1. Build the template (`buildTemplate()`), its tags and its diagnostics (`validateTemplate()`)
   * 2. Extract each EJS tag as a TagBlock with JS content and metadata
   * 3. Generate virtual JS code for each block (with type marker and optional wrapping)
   * 4. Initialize per-virtual-code metadata maps for rule detection
   * 5. Store block position mappings for later message translation
   *
   * **Return value:** the virtual code, wrapped in a function as EJS compiles a template into the body of one:
   * `(function() {\n <blocks> \n})();`. ESLint lints it once: parsing it and running every rule is most of the
   * time of a lint, so that a second virtual code would nearly double it.
   *
   * **Metadata initialization:**
   * - tagFormatByVirtualCodeMap: tracks format rule satisfaction
   * - fileBlocksMap: stores segments for position-based message translation
   */
  preprocess(text: string, filename: string): (string | { text: string; filename: string })[] {
    // One parse of the template: its tags, its diagnostics; postprocess() frees it.
    const template = buildTemplate(text);
    let blocks: TagBlock[];
    let diagnostics: EjsDiagnostic[];
    try {
      diagnostics = validateTemplate(template);
      blocks = extractTagBlocks(template.tags, diagnostics);
      processedFilesMap.set(filename, {
        sourceText: text,
        template,
        diagnostics,
      });
    } catch (error) {
      // A template built validates, and gives its blocks: the trees freed all the same, on a bug.
      /* v8 ignore start -- @preserve */
      processedFilesMap.delete(filename);
      cleanupTemplate(template);
      throw error;
      /* v8 ignore stop -- @preserve */
    }

    if (blocks.length === 0) {
      fileBlocksMap.set(filename, { segments: [], codeSegments: [] });
      // No rule runs without a virtual file: the wrapper alone, for the rules to request the diagnostics of the
      // template, a stray close delimiter the only one a template without blocks can have.
      const reported = new Set<EjsDiagnosticCode>(Object.values(DIAGNOSTIC_RULES));
      if (!diagnostics.some((diagnostic) => reported.has(diagnostic.code))) {
        return [];
      }
      const virtualCode = `${GLOBAL_VIRTUAL_OPEN}${GLOBAL_VIRTUAL_CLOSE}`;
      virtualCodeMetadataMap.set(virtualCode, {
        tagFormat: [],
        needsNormalize: { greater: [], greaterOrEqual: [] },
        endsTemplate: [],
        diagnostics,
      });
      return [virtualCode];
    }

    // Track block positions in the virtual code, used during postprocess() to locate ESLint messages and translate
    // them back to source.
    const segments: VirtualBlockSegment[] = [];
    let lineCursor = 3; // Start at line 3 (lines 1 and 2 are GLOBAL_VIRTUAL_OPEN)
    let offsetCursor = GLOBAL_VIRTUAL_OPEN.length; // Account for wrapper in offset

    for (const block of blocks) {
      const lineCount = block.virtualCode.split('\n').length;
      const startLine = lineCursor;
      const endLine = startLine + lineCount - 1;
      const startOffset = offsetCursor;
      const endOffset = startOffset + block.virtualCode.length;

      segments.push({ block, startLine, endLine, startOffset, endOffset });

      // Each block is joined with a single newline in the virtual code.
      lineCursor += lineCount;
      offsetCursor += block.virtualCode.length + 1; // +1 for separator newline
    }

    const codeSegments = segments.filter(
      (segment): segment is VirtualBlockSegment<CodeTagBlock> => !segment.block.isDirectiveComment,
    );
    fileBlocksMap.set(filename, { segments, codeSegments });

    const virtualCode = `${GLOBAL_VIRTUAL_OPEN}${blocks.map((b) => b.virtualCode).join('\n')}${GLOBAL_VIRTUAL_CLOSE}`;
    const codeBlocks = codeSegments.map(({ block }) => block);
    virtualCodeMetadataMap.set(virtualCode, {
      tagFormat: codeBlocks.map((block) => {
        const originalText = block.openDelim + block.codeContent + block.closeDelim;
        return {
          isFormattedDefault: originalText === buildFormattedTag(block, { multilineCloseOnNewLine: false }),
          isFormattedMultilineClose: originalText === buildFormattedTag(block, { multilineCloseOnNewLine: true }),
        };
      }),
      endsTemplate: codeBlocks.map((block) => {
        const after = text.slice(block.tagOffset + block.tagLength);
        return after.trim() === '' && /[\r\n]/u.test(after);
      }),
      needsNormalize: (() => {
        const greater: boolean[] = [];
        const greaterOrEqual: boolean[] = [];
        for (const block of codeBlocks) {
          // A tag alone on its line: the fix rewrites the line from its start, which holds the
          // text before the tag otherwise. Its lines are indented with the tag where it is, wherever `indent-tag` puts
          // it.
          // Only normalize when the close delimiter is already on its own line
          // (last codeContent segment is all whitespace). If the close is on the
          // same line as the last content line, normalizing it would conflict with
          // `format: same-line`, causing a circular fix.
          const lastSegment = block.codeContent.slice(block.codeContent.lastIndexOf('\n') + 1);
          const normalizable = block.tagType === 'slurp-multiline' && block.isStandalone && lastSegment.trim() === '';
          const needs = (binaryOperands: 'greater' | 'greaterOrEqual') =>
            fixOf(
              template,
              { code: 'indent', offset: block.tagOffset },
              { normalizeContent: true, indentTag: false, binaryOperands },
            ) !== undefined;
          const needsGreater = normalizable && needs('greater');
          greater.push(needsGreater);
          greaterOrEqual.push(needsGreater && needs('greaterOrEqual'));
        }
        return { greater, greaterOrEqual };
      })(),
      diagnostics,
    });

    return [virtualCode];
  },

  /**
   * Postprocess: Translate ESLint messages from virtual code back to original EJS source.
   *
   * **Processing steps:**
   * 1. Receive the messages of the virtual code
   * 2. Report a syntax error tree-sitter finds in the JavaScript of the template, alone
   * 3. Report the parsing error ESLint's parser finds (a fatal message), at its tag
   * 4. For each message, locate its TagBlock via segment mapping
   * 5. Translate message line/column from virtual to original EJS positions
   * 6. Translate sentinel-based fixes for plugin rules (prefer-single-line-tags, etc)
   * 7. Translate general JS fixes (from rules like prefer-const) via offset mapping
   * 8. Clean up per-virtual-code metadata maps after processing
   * 9. Answer the requests of the rules of `DIAGNOSTIC_RULES` with the diagnostics of the template
   * 10. Free the template, in a `finally`
   */
  postprocess(messages: Linter.LintMessage[][], filename: string): Linter.LintMessage[] {
    const processedFile = processedFilesMap.get(filename);
    const fileBlocks = fileBlocksMap.get(filename);
    if (!processedFile || !fileBlocks) {
      throw new Error(`Unexpectedly did not find processed file data for ${filename}`);
    }
    try {
      const sourceText = processedFile.sourceText;
      const { segments } = fileBlocks;
      fileBlocksMap.delete(filename);
      const currentVirtualCode = `${GLOBAL_VIRTUAL_OPEN}${segments.map((s) => s.block.virtualCode).join('\n')}${GLOBAL_VIRTUAL_CLOSE}`;
      virtualCodeMetadataMap.delete(currentVirtualCode);

      // The messages of the one virtual code, none without one.
      const virtualMessages = messages[0] ?? [];
      const answeredMessages = answerDiagnosticRequests(
        virtualMessages,
        processedFile.diagnostics,
        processedFile.template,
      );

      if (segments.length === 0) {
        return answeredMessages;
      }

      // Even in a single incremental virtual file, each tag is still wrapped in
      // its own function block for parseability/fix mapping.  This can trigger
      // false positives for rules that require cross-tag flow/scope.
      const suppressedRuleIds = new Set(['no-undef']);

      logVirtualCodeOnFatal(filename, virtualMessages, segments);
      // The rules of indentation on: the tags a tag is split into indented as they expect them. `@stylistic/indent`
      // reports the first line of tags, its messages there dropped below, when it is on.
      const hasIndentMessages = virtualMessages.some(
        (msg) =>
          msg.ruleId === 'ejs-templates/indent-tag' ||
          msg.ruleId === 'ejs-templates/indent-content' ||
          msg.ruleId === STYLISTIC_INDENT,
      );

      // `@stylistic/indent` judges the first line of the code of a tag from where the virtual code puts it, inside its
      // blocks, which `indent-tag` places, or the text around the tag: its messages there are dropped. The other lines of
      // a tag it finds misplaced so are judged from where it expects the first one, not where it is: dropped too.
      const segmentOf = (line: number) => segments.findIndex((s) => line >= s.startLine && line <= s.endLine);
      const misplacedTags = new Set<number>();
      for (const msg of virtualMessages) {
        if (msg.ruleId !== STYLISTIC_INDENT) continue;
        const index = segmentOf(msg.line);
        if (index !== -1 && msg.line === segments[index].startLine + 1) misplacedTags.add(index);
      }

      const mappedMessages = virtualMessages
        .filter((msg) => !msg.fatal && !suppressedRuleIds.has(msg.ruleId ?? '') && !isDiagnosticRuleId(msg.ruleId))
        .flatMap((normalizedMsg) => {
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

          // The `;` appended to an output tag's expression is generated too, and unlike the
          // marker it shares a line with real code. A semicolon rule reporting on it is talking
          // about a character the author never wrote — `@stylistic/semi` in `never` mode would
          // otherwise flag every output tag for a semicolon that is not in the template.
          if (isSyntheticSuffixMessage(normalizedMsg, segment)) {
            return [];
          }

          if (
            normalizedMsg.ruleId === STYLISTIC_INDENT &&
            (normalizedMsg.line === segment.startLine + 1 || misplacedTags.has(segmentIndex))
          ) {
            return [];
          }

          // Convert global (combined-file) positions to per-block positions: the end in the block it is in, a later one
          // for a node across tags, the last one past them (in the wrapper).
          const { endLine } = normalizedMsg;
          const endSegment =
            endLine === undefined
              ? segment
              : (segments.find((s) => endLine >= s.startLine && endLine <= s.endLine) ?? segments[segments.length - 1]);
          const localMsg: Linter.LintMessage = {
            ...normalizedMsg,
            line: normalizedMsg.line - segment.startLine + 1,
            column: normalizedMsg.column,
          };

          if (endLine !== undefined) {
            localMsg.endLine = endLine - endSegment.startLine + 1;
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

          const mapped = mapMessage(localMsg, segment.block, sourceText, endSegment.block);

          if (mapped.fix) {
            const unusedDirective = translateUnusedDirectiveFix(
              mapped,
              segments.map((s) => s.block),
              segmentIndex,
              processedFile.template,
            );
            if (unusedDirective) {
              const result: Linter.LintMessage[] = [{ ...mapped, fix: unusedDirective.disableFix }];
              const { enableIndex, enableFix } = unusedDirective;
              // The enable directive fixed in a message of its own, at its tag.
              if (enableIndex !== undefined && enableFix) {
                const enableMappedMsg = mapMessage(
                  { ruleId: null, message: 'Unused eslint-disable directive', severity: 2, line: 1, column: 1 },
                  segments[enableIndex].block,
                  sourceText,
                );
                result.push({ ...enableMappedMsg, fix: enableFix });
              }
              return result;
            }

            const translated = translateFix(mapped.fix, segment.block, {
              applyIndentForSingleLineTags: hasIndentMessages,
              template: processedFile.template,
              diagnostics: processedFile.diagnostics,
            });
            if (translated) {
              return [{ ...mapped, fix: translated }];
            }

            // No translation available – drop the fix.
            const result = { ...mapped };
            delete result.fix;
            return [result];
          }

          // Supply the fix core ESLint cannot produce itself. The report is already correct;
          // only the edit is missing, so it is attached to the core rule's own message rather
          // than duplicated into a plugin rule.
          if (mapped.ruleId === CORE_NO_NEGATED_CONDITION && !segment.block.isDirectiveComment) {
            const negatedConditionFix = buildNegatedConditionFix(
              segment.block,
              processedFile.template,
              sourceText,
              offsetOfPosition(sourceText, mapped.line, mapped.column),
            );
            if (negatedConditionFix) {
              return [{ ...mapped, fix: negatedConditionFix }];
            }
          }

          return [mapped];
        });

      // The virtual JavaScript does not parse: the errors ejs-template-parser tells of the JavaScript of the template, at
      // their tags (a block no tag closes, a tag closing a block none opens, code not parsing); otherwise the parsing
      // error of ESLint's parser (an early error, such as a declaration repeated), at its tag, or past the code of the
      // last tag (in the wrapper), at its end.
      const javascriptErrors = virtualMessages.some((msg) => msg.fatal)
        ? processedFile.diagnostics.filter((diagnostic) => JAVASCRIPT_ERRORS.has(diagnostic.code))
        : [];
      const fatalMessages: Linter.LintMessage[] = javascriptErrors.length
        ? javascriptErrors.map((diagnostic) => ({
            ruleId: null,
            fatal: true,
            severity: 2,
            message: `Parsing error: ${diagnostic.message}`,
            ...rangeOf(diagnostic, sourceText),
          }))
        : virtualMessages
            .filter((msg) => msg.fatal)
            .map((msg) => {
              const segment = segments.find((s) => msg.line >= s.startLine && msg.line <= s.endLine);
              if (!segment) {
                const { block } = segments[segments.length - 1];
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
                const fatalMsg: Linter.LintMessage = { ...msg, line, column };
                delete fatalMsg.fix;
                return fatalMsg;
              }
              const localMsg: Linter.LintMessage = {
                ...msg,
                line: msg.line - segment.startLine + 1,
                column: msg.column,
              };
              // A parsing error of ESLint has no end.
              /* v8 ignore next -- @preserve */
              if (msg.endLine !== undefined) {
                localMsg.endLine = msg.endLine - segment.startLine + 1;
                localMsg.endColumn = msg.endColumn;
              }
              delete localMsg.fix;
              return mapMessage(localMsg, segment.block, sourceText);
            });

      const formatMessages = mappedMessages.filter((msg) => msg.ruleId === 'ejs-templates/format');
      const nonFormatMessages = mappedMessages.filter((msg) => msg.ruleId !== 'ejs-templates/format');

      // Keep `format` fixes last so all structural/semantic fixes and validations
      // run first, and formatting is applied as a final normalization step.
      return [...nonFormatMessages, ...fatalMessages, ...answeredMessages, ...formatMessages];
    } finally {
      // On every path: the trees of the template, the ones of the code of its tags included.
      processedFilesMap.delete(filename);
      cleanupTemplate(processedFile.template);
    }
  },

  supportsAutofix: true,
};
