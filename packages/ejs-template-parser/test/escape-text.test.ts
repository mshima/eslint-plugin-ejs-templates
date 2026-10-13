// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import ejs from 'ejs';
import { describe, expect, test } from 'vitest';
import { escapeText } from '../src/index.js';

/** The template with the text escaped inserted at the offset. */
const insert = (template: string, offset: number, text: string) =>
  template.slice(0, offset) + escapeText(template, offset, text) + template.slice(offset);

describe('escapeText', () => {
  test('an empty text', () => {
    expect(escapeText('a<%= b %>', 1, '')).toBe('');
  });

  test('a text EJS renders as written', () => {
    expect(escapeText('a\n', 1, 'b c\n')).toBe('b c\n');
  });

  describe('the delimiters of the text', () => {
    test('<% and %> are written <%% and %%>', () => {
      expect(escapeText('a\n', 1, '<%= x %>')).toBe('<%%= x %%>');
      expect(ejs.render(insert('a\n', 1, '<%= x %>'))).toBe('a<%= x %>\n');
    });

    test('<% and %> sharing their %', () => {
      expect(escapeText('a\n', 1, '<%>')).toBe('<%%>');
      expect(ejs.render(insert('a\n', 1, '<%>'))).toBe('a<%>\n');
    });

    test('<%% and %%>', () => {
      expect(escapeText('a\n', 1, '<%% %%>')).toBe('<%%% %%%>');
      expect(ejs.render(insert('a\n', 1, '<%% %%>'))).toBe('a<%% %%>\n');
    });
  });

  describe('a delimiter formed with the template', () => {
    test('a text starting with % after a < of the template', () => {
      // The consumer's case: `a %= b`, edited to `a <%= b`.
      expect(escapeText('a %= b\n', 2, '<')).toBe('<%');
      expect(ejs.render(insert('a %= b\n', 2, '<'))).toBe('a <%= b\n');
      expect(escapeText('a<\n', 2, '%')).toBe('%%');
      expect(ejs.render(insert('a<\n', 2, '%'))).toBe('a<%\n');
    });

    test('a text starting with > after a % of the template', () => {
      expect(escapeText('a%\n', 2, '>')).toBe('%>');
      expect(ejs.render(insert('a%\n', 2, '>'))).toBe('a%>\n');
    });

    test('a text ending with < before a % of the template', () => {
      expect(escapeText('a%\n', 1, 'b<')).toBe('b<%');
      expect(ejs.render(insert('a%\n', 1, 'b<'))).toBe('ab<%\n');
    });

    test('a text ending with % before a > of the template', () => {
      expect(escapeText('a>\n', 1, '%')).toBe('%%');
      expect(ejs.render(insert('a>\n', 1, '%'))).toBe('a%>\n');
    });

    test('a % of the template already part of an escaped delimiter', () => {
      expect(escapeText('a<%%\n', 4, '>')).toBe('>');
      expect(ejs.render(insert('a<%%\n', 4, '>'))).toBe('a<%>\n');
    });
  });

  describe('the literal mode', () => {
    test('a text of the literal mode entered by a <%% of the template', () => {
      expect(escapeText('<%% a %> b\n', 6, 'c')).toBe('c');
      expect(ejs.render(insert('<%% a %> b\n', 6, 'c'))).toBe('<% a c%> b\n');
    });

    test('a text entering it before a %> EJS drops', () => {
      expect(escapeText('a %> b\n', 2, '<%')).toBe('<%%<%# %>');
      expect(ejs.render('a %> b\n')).toBe('a  b\n');
      expect(ejs.render(insert('a %> b\n', 2, '<%'))).toBe('a <% b\n');
    });

    test('a text ending with - before a %> EJS drops', () => {
      expect(escapeText('a %> b\n', 2, 'x-')).toBe('x-<%# %>');
      expect(ejs.render(insert('a %> b\n', 2, 'x-'))).toBe('a x- b\n');
    });

    test('a text ending with < before the %> closing the literal mode', () => {
      expect(escapeText('<%% a %> b\n', 6, '<')).toBe('<%%><%# ');
      expect(ejs.render(insert('<%% a %> b\n', 6, '<'))).toBe('<% a <%> b\n');
      expect(escapeText('<%% a %> b\n', 6, '<%')).toBe('<%%%%><%# ');
      expect(ejs.render(insert('<%% a %> b\n', 6, '<%'))).toBe('<% a <%%> b\n');
    });
  });

  describe('the blanks a delimiter slurps', () => {
    const block = '<% if (a) { _%>  b\n<% } %>';

    test('blanks the text starts with right after a _%>', () => {
      expect(escapeText(block, 15, ' x')).toBe(`<%- ' ' %>x<%# _%>`);
      expect(ejs.render(insert(block, 15, ' x'), { a: true })).toBe(' xb\n');
    });

    test('a tab', () => {
      expect(escapeText('<%_ _%>a', 7, '\tx')).toBe(String.raw`<%- '\t' %>x`);
      expect(ejs.render(insert('<%_ _%>a', 7, '\tx'))).toBe('\txa');
    });

    test('blanks the text ends with right before a <%_', () => {
      const template = '<% if (a) { %>a  <%_ } _%>\n';
      expect(escapeText(template, 15, 'x  ')).toBe(`x<%- '  ' %>`);
      expect(ejs.render(insert(template, 15, 'x  '), { a: true })).toBe('ax  ');
    });

    test('blanks alone', () => {
      expect(escapeText('a<%_ _%>', 1, '  ')).toBe(`<%- '  ' %>`);
      expect(ejs.render(insert('a<%_ _%>', 1, '  '))).toBe('a  ');
    });

    test('a line break the text starts with right after a -%>', () => {
      const template = '<% if (a) { -%>b\n<% } %>';
      expect(escapeText(template, 15, '\nx')).toBe('\n\nx');
      expect(ejs.render(insert(template, 15, '\nx'), { a: true })).toBe('\nxb\n');
    });

    test('a line break the text starts with right after a _%>', () => {
      expect(escapeText('<%_ _%>a', 7, '\nx')).toBe('\n\nx');
      expect(ejs.render(insert('<%_ _%>a', 7, '\nx'))).toBe('\nxa');
    });

    test('a text inside the blanks a _%> slurps', () => {
      expect(escapeText(block, 16, 'x')).toBe('x<%# _%>');
      expect(ejs.render(insert(block, 16, 'x'), { a: true })).toBe('xb\n');
    });

    test('a text before the line break a -%> drops', () => {
      const template = '<% if (a) { -%>\nb\n<% } %>';
      expect(escapeText(template, 15, 'x')).toBe('x<%# -%>');
      expect(ejs.render(insert(template, 15, 'x'), { a: true })).toBe('xb\n');
    });

    test('a text inside the blanks a <%_ slurps', () => {
      const template = '<% if (a) { %>a  <%_ } _%>\n';
      expect(escapeText(template, 16, 'x')).toBe('<%_ %>x');
      expect(ejs.render(insert(template, 16, 'x'), { a: true })).toBe('ax');
    });
  });

  describe('an offset out of a text', () => {
    test('in a tag', () => {
      expect(() => escapeText('a<%= b %>', 4, 'x')).toThrow(new RangeError('The offset 4 is inside a tag'));
    });

    test('inside a delimiter', () => {
      expect(() => escapeText('a<%= b %>', 2, 'x')).toThrow(new RangeError('The offset 2 is inside the delimiter <%='));
      expect(() => escapeText('a<%%', 2, 'x')).toThrow(new RangeError('The offset 2 is inside the delimiter <%%'));
    });

    test('a tag needed in the literal mode', () => {
      expect(ejs.render('<% -%><%%\n%>')).toBe('<%%>');
      expect(() => escapeText('<% -%><%%\n%>', 9, 'x')).toThrow(
        new RangeError('The text cannot be inserted at 9, before the close delimiter of a literal <%% or %%>'),
      );
    });

    test('out of the template', () => {
      expect(() => escapeText('a', 2, 'x')).toThrow(new RangeError('The offset 2 is out of the template'));
    });
  });

  describe('against EJS', () => {
    // Texts made of what EJS reads: the characters of its delimiters, blanks, line breaks, escaped delimiters.
    const units = ['<', '%', '>', '-', '_', ' ', '\n', 'a', '<%%', '%%>'];
    const textsOf = (count: number): string[] =>
      count === 0
        ? ['']
        : [
            ...new Set([
              ...textsOf(count - 1),
              ...textsOf(count - 1).flatMap((text) => units.map((unit) => text + unit)),
            ]),
          ];
    const tags = ['<%', '<%_', '<%=', '<%-', '<%#'].flatMap((open) =>
      ['%>', '-%>', '_%>'].map((close) => `${open} ${open === '<%=' || open === '<%-' ? "'' " : ''}${close}`),
    );
    const texts = [
      '<',
      '%',
      '>',
      '<%',
      '%>',
      '<%%>',
      '%%',
      '-',
      '_',
      ' ',
      '\t',
      '\n',
      'a',
      ' a ',
      '\na\n',
      '  \n',
      '\n  ',
    ];
    const templates = new Set(textsOf(2));
    for (const before of textsOf(1)) {
      for (const tag of tags) {
        for (const after of textsOf(1)) templates.add(before + tag + after);
      }
    }
    const DELIMITER = /<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>/g;
    /** The offsets of a template in a text, EJS's regular expression telling the delimiters. */
    const textOffsets = (template: string) => {
      const offsets = new Set<number>();
      let inTag = false;
      let start = 0;
      for (const match of [...template.matchAll(DELIMITER), undefined]) {
        const end = match?.index ?? template.length;
        if (!inTag) for (let offset = start; offset <= end; offset++) offsets.add(offset);
        if (!match) break;
        if (['%>', '-%>', '_%>'].includes(match[0])) inTag = false;
        else if (match[0] !== '<%%' && match[0] !== '%%>') inTag = true;
        start = match.index + match[0].length;
      }
      return offsets;
    };
    const refuses = (template: string, offset: number, text: string) => {
      try {
        escapeText(template, offset, text);
        return false;
      } catch (error) {
        return error instanceof RangeError;
      }
    };
    const renderOrFail = (template: string) => {
      try {
        return ejs.render(template);
      } catch {
        return undefined;
      }
    };

    test('renders the text where the offset renders, and the template around as before', { timeout: 60_000 }, () => {
      const failures: string[] = [];
      let checked = 0;
      for (const template of templates) {
        const rendered = renderOrFail(template);
        if (rendered === undefined) continue;
        const offsets = textOffsets(template);
        for (let offset = 0; offset <= template.length; offset++) {
          if (!offsets.has(offset)) {
            if (!refuses(template, offset, 'a'))
              failures.push(`${JSON.stringify(template)} at ${String(offset)}: not refused`);
            continue;
          }
          const before = template.slice(0, offset);
          const after = template.slice(offset);
          // Where the offset renders: after what the template before it renders, without the blanks a <%_ slurps.
          const place = ejs.render(/^[ \t]*<%_/.test(after) ? before.replace(/[ \t]*$/, '') : before).length;
          for (const text of texts) {
            const name = `${JSON.stringify(template)} at ${String(offset)}, ${JSON.stringify(text)}`;
            const escaped = escapeText(template, offset, text);
            const actual = renderOrFail(before + escaped + after);
            const expected = rendered.slice(0, place) + text + rendered.slice(place);
            if (actual !== expected) {
              failures.push(`${name} -> ${JSON.stringify(escaped)}: ${JSON.stringify(actual)}`);
            }
            checked++;
          }
        }
      }
      expect(failures).toEqual([]);
      expect(checked).toBe(123_148);
    });
  });
});
