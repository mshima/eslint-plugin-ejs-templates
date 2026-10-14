// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

/**
 * The delimiters EJS 6 and 7 split a template at, in the order it tries them at a position (its `_REGEX_STRING`): the
 * escaped `<%%` and `%%>` first, the openers, then the closers.
 */
const DELIMITER = /<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>/g;
const CLOSE_DELIMITERS = new Set(['%>', '-%>', '_%>']);

const isBlank = (char: string | undefined) => char === ' ' || char === '\t';
/** Where the blanks ending at an offset start: scanned, as a regular expression would be in quadratic time. */
const blanksStart = (text: string, end: number) => {
  let start = end;
  while (start > 0 && isBlank(text[start - 1])) start--;
  return start;
};
/** Where the blanks starting at an offset end. */
const blanksEnd = (text: string, start: number) => {
  let end = start;
  while (end < text.length && isBlank(text[end])) end++;
  return end;
};
/** The offsets of a string in a text. */
const indexesOf = (text: string, search: string) => {
  const indexes: number[] = [];
  for (let index = text.indexOf(search); index !== -1; index = text.indexOf(search, index + 1)) indexes.push(index);
  return indexes;
};
const LINE_BREAK = /^(?:\r\n|\r|\n)/;

/** What EJS is reading: the code of a tag (`eval`, `escaped`, `raw`, `comment`), the literal `<%%` and `%%>` enter, or text. */
type Mode = 'eval' | 'escaped' | 'raw' | 'comment' | 'literal' | undefined;

type Delimiter = {
  value: string;
  start: number;
  end: number;
};

/** The delimiters of a text as EJS 6 and 7 find them, and the blanks it slurps. */
const scanDelimiters = (text: string) => {
  const delimiters: Delimiter[] = [...text.matchAll(DELIMITER)].map((match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  // The blanks a `<%_` slurps before it and a `_%>` after it, removed by EJS before it splits the template.
  const slurped = new Set<number>();
  for (const open of indexesOf(text, '<%_')) {
    for (let index = blanksStart(text, open); index < open; index++) slurped.add(index);
  }
  for (const close of indexesOf(text, '_%>')) {
    const end = blanksEnd(text, close + 3);
    for (let index = close + 3; index < end; index++) slurped.add(index);
  }
  return { delimiters, slurped };
};

const modeOpened: Record<string, Mode> = {
  '<%': 'eval',
  '<%_': 'eval',
  '<%=': 'escaped',
  '<%-': 'raw',
  '<%#': 'comment',
  '<%%': 'literal',
  '%%>': 'literal',
};

/** How EJS reads a template at an offset in one of its texts, or between two of its nodes. */
type Place = {
  mode: 'literal' | undefined;
  /** Where the text of the template the offset is in starts. */
  textStart: number;
  /** A `-%>` or `_%>` before the text, whose line break the text would start with EJS drops. */
  truncating: boolean;
  /** The character before the offset, when it is text, not part of a delimiter. */
  previous?: string | undefined;
  /** The character at the offset, when it is text. */
  next?: string | undefined;
  /** The first delimiter at the offset or after it. */
  nextDelimiter?: Delimiter | undefined;
};

/**
 * Follows EJS 6.0.1 and 7.0.1, the same there (`Template#generateSource`, `parseTemplateText` and `scanLine`) through a template up to an
 * offset. Throws a RangeError when the offset is in a tag or inside a delimiter.
 */
const placeAt = (template: string, offset: number): Place => {
  const { delimiters, slurped } = scanDelimiters(template);
  let mode: Mode;
  let truncating = false;
  let start = 0;
  /** Writing a text: `_addOutput`, which drops the line break a `-%>` or `_%>` before leaves at its start. */
  const write = (from: number, to: number) => {
    if (mode !== undefined && mode !== 'literal') return;
    for (let index = from; index < to; index++) {
      if (!slurped.has(index)) {
        truncating = false;
        return;
      }
    }
  };
  const placeIn = (end: number): Place => {
    if (mode !== undefined && mode !== 'literal') {
      throw new RangeError(`The offset ${String(offset)} is inside a tag`);
    }
    return {
      mode,
      textStart: start,
      truncating,
      previous: offset > start ? template[offset - 1] : undefined,
      next: offset < end ? template[offset] : undefined,
      nextDelimiter: delimiters.find((delimiter) => delimiter.start >= offset),
    };
  };
  for (const { value, start: end, end: delimiterEnd } of delimiters) {
    if (offset <= end) return placeIn(end);
    write(start, end);
    if (offset < delimiterEnd) {
      throw new RangeError(`The offset ${String(offset)} is inside the delimiter ${value}`);
    }
    if (CLOSE_DELIMITERS.has(value)) {
      // In the literal mode, `_addOutput` writes it, before it sets the truncation of its own.
      mode = undefined;
      truncating = value !== '%>';
    } else {
      mode = modeOpened[value];
    }
    start = delimiterEnd;
  }
  return placeIn(template.length);
};

/**
 * The line break EJS drops after a `-%>` or a `_%>`, given the template from where the delimiter ends: the first one
 * of the text written next, when it starts with one; none when a delimiter closes first.
 */
const droppedLineBreak = (template: string, from: number, mode: Mode): number | undefined => {
  const { delimiters, slurped } = scanDelimiters(template);
  let index = from;
  for (const delimiter of [...delimiters.filter(({ start }) => start >= from), undefined]) {
    const end = delimiter?.start ?? template.length;
    if (mode === undefined || mode === 'literal') {
      for (; index < end; index++) {
        if (!slurped.has(index)) return LINE_BREAK.test(template.slice(index)) ? index : undefined;
      }
    }
    // The literal mode writes a close delimiter, which is no line break; out of it, a close delimiter truncates anew.
    if (!delimiter || CLOSE_DELIMITERS.has(delimiter.value)) return undefined;
    mode = modeOpened[delimiter.value];
    index = delimiter.end;
  }
  // The last pass of the loop, without a delimiter, returns.
  /* v8 ignore next -- @preserve */
  return undefined;
};

/**
 * The text with the `%` doubled where it would form a delimiter: `<%` written `<%%`, `%>` written `%%>`, with the
 * characters of the template around, `previous` and `next`, when they are text.
 */
const escapeDelimiters = (text: string, previous?: string, next?: string) => {
  let escaped = text.startsWith('>') && previous === '%' ? '%' : '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const before = index > 0 ? text[index - 1] : previous;
    const after = index < text.length - 1 ? text[index + 1] : next;
    escaped += char === '%' && (before === '<' || after === '>') ? '%%' : char;
  }
  if (text.endsWith('<') && next === '%') escaped += '%';
  return escaped;
};

/** An output tag of a string of blanks, which no delimiter slurps. */
const blanksTag = (blanks: string) => (blanks ? `<%- '${blanks.replaceAll('\t', '\\t')}' %>` : '');

/**
 * The text to insert at an offset of an EJS template so that EJS (6.0.1 or 7.0.1, with the default delimiters) renders `text`
 * literally there, and renders what was around it as before.
 *
 * The offset is in a text of the template, or between two of its nodes: never in a tag, nor inside a delimiter of a
 * text (`<%%`, `%%>`, or a `%>` EJS drops). The place it renders at is the one of the text there: inside what a
 * delimiter slurps, the blanks before a `<%_` or after a `_%>`, the line break after a `-%>` or a `_%>`, it is the place
 * of the delimiter.
 *
 * The text is written as text, except for what EJS would not render as written, around which a tag is added:
 * - `<%` and `%>` are written `<%%` and `%%>`, also when they are formed with the template around: the text ending
 *   with `<` before a `%` of the template, or with `%` before a `>`, starting with `%` after a `<`, or with `>` after a
 *   `%` (written `%>`, the `%` of the template and it making a `%%>`);
 * - the blanks the text starts with right after a `_%>`, or ends with right before a `<%_`, which the delimiter would
 *   slurp, are written as an output tag of a string, `<%- '  ' %>`;
 * - a `-%>` or a `_%>` drops the line break the text written after it starts with: when that would be a line break of
 *   the text, or one of the template the text makes a delimiter with the text before (`%` after a `<`), it is preceded
 *   by another line break, which EJS drops;
 * - inserted inside what a delimiter slurps, the text would stop the delimiter slurping what is on the other side:
 *   an empty tag slurps it again, `<%_ %>` before the text, `<%# _%>` or `<%# -%>` after it;
 * - `<%%` and `%%>` enter a literal mode, in which EJS writes the close delimiter it meets next, where it drops one
 *   in a text (a stray `%>`): when the text enters it and the next delimiter of the template is a close one, an
 *   empty comment tag `<%# %>` after the text leaves it;
 * - the text ending with `<`, `-`, `_` or `%` right before a `%>` of the template, which they would make another
 *   delimiter of, is separated from it by an empty comment tag `<%# %>`, or, in the literal mode, written with the
 *   `%>` (`%%>`) before an opened comment tag `<%# `, which the `%>` of the template closes.
 *
 * @param template the template
 * @param offset the offset of the template to insert at
 * @param text the text to render
 * @returns what to insert at the offset: the text, escaped
 * @throws RangeError when the offset is out of the template, in a tag, or inside a delimiter; and when a tag is needed
 * in the literal mode before its close delimiter, which the tag would leave: the line break a `-%>` drops after a
 * `<%%` (`-%><%%` then a line break), the text inserted between the `<%%` and the line break
 */
export const escapeText = (template: string, offset: number, text: string): string => {
  if (!Number.isInteger(offset) || offset < 0 || offset > template.length) {
    throw new RangeError(`The offset ${String(offset)} is out of the template`);
  }
  const place = placeAt(template, offset);
  if (text === '') return '';

  const before = template.slice(0, offset);
  const after = template.slice(offset);
  /** The blanks here are slurped by a `_%>` before. */
  const slurpedBefore = before.endsWith('_%>', blanksStart(before, before.length));
  /** The blanks here are slurped by a `<%_` after. */
  const slurpedAfter = after.startsWith('<%_', blanksEnd(after, 0));

  // The blanks of the template before the offset that a `<%_` after slurps: the text would stand between them.
  const prefix = slurpedAfter && !slurpedBefore && isBlank(before.at(-1)) ? '<%_ %>' : '';
  let leading = '';
  let middle = text;
  let trailing = '';
  if (slurpedBefore || slurpedAfter) {
    const startEnd = blanksEnd(text, 0);
    const endStart = Math.max(blanksStart(text, text.length), startEnd);
    const start = text.slice(0, startEnd);
    const end = text.slice(endStart);
    const rest = text.slice(startEnd, endStart);
    if (rest === '') {
      // Blanks alone: one tag for all of them.
      leading = text;
      middle = '';
    } else {
      if (slurpedBefore) leading = start;
      if (slurpedAfter) trailing = end;
      middle = (slurpedBefore ? '' : start) + rest + (slurpedAfter ? '' : end);
    }
  }
  const separatedBefore = prefix !== '' || leading !== '';
  const escape = (next?: string) => escapeDelimiters(middle, separatedBefore ? undefined : place.previous, next);
  let escaped = escape(trailing === '' ? place.next : undefined);
  let suffix = '';
  const insertion = () => prefix + blanksTag(leading) + escaped + blanksTag(trailing) + suffix;
  /** The delimiters EJS reads the template with the insertion in: the ones the escaped text makes. */
  const escapesOf = () => {
    const inserted = before + insertion() + after;
    const start = offset + prefix.length + blanksTag(leading).length;
    return scanDelimiters(inserted).delimiters.filter(
      (delimiter) => delimiter.end > start && delimiter.start < start + escaped.length,
    );
  };

  // What a `_%>` before slurps after the offset, which the text would stand before.
  if (slurpedBefore && isBlank(after[0]) && !slurpedAfter) suffix = '<%# _%>';

  // The literal mode, and a close delimiter of the template right after the text.
  const next = place.nextDelimiter;
  const closesNext = next !== undefined && CLOSE_DELIMITERS.has(next.value);
  if (trailing === '' && suffix === '') {
    const joinsClose = closesNext && next.start === offset && next.value === '%>' && /[<\-_%]$/.test(escaped);
    if (place.mode === 'literal') {
      if (joinsClose) suffix = '%%><%# ';
    } else if ((closesNext && escapesOf().length > 0) || joinsClose) {
      suffix = '<%# %>';
    }
  }

  // The line break a `-%>` or a `_%>` before drops: the same one, not one of the text or another one of the template.
  if (place.truncating) {
    const dropped = droppedLineBreak(template, place.textStart, place.mode);
    if (dropped !== undefined && dropped >= offset) {
      const shifted = dropped + insertion().length;
      if (droppedLineBreak(before + insertion() + after, place.textStart, place.mode) !== shifted) {
        // A tag after the text drops it again.
        if (suffix === '' || suffix === '<%# %>') suffix = '<%# -%>';
      }
    }
  }
  // A tag after the text, it is escaped without the template after it.
  if (suffix !== '' && trailing === '' && suffix !== '%%><%# ') escaped = escape();

  if (place.truncating && !separatedBefore) {
    const dropped = droppedLineBreak(template, place.textStart, place.mode);
    const expected = dropped === undefined || dropped < offset ? dropped : dropped + insertion().length;
    const actual = droppedLineBreak(before + insertion() + after, place.textStart, place.mode);
    if (actual !== undefined && actual !== expected) {
      // A line break of its own for EJS to drop, after a `%` of the template the text makes a delimiter with.
      const joined = escapesOf().find((delimiter) => delimiter.start < offset);
      const at = joined ? joined.end - offset : 0;
      escaped = `${escaped.slice(0, at)}\n${escaped.slice(at)}`;
    }
  }

  // A tag leaves the literal mode, whose close delimiter the template has next.
  const tags = prefix + leading + trailing + (suffix === '%%><%# ' ? '' : suffix);
  if (place.mode === 'literal' && closesNext && tags !== '') {
    throw new RangeError(
      `The text cannot be inserted at ${String(offset)}, before the close delimiter of a literal <%% or %%>`,
    );
  }

  return insertion();
};
