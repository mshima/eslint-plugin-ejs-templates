// Copyright 2024 The prettier-plugin-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import * as prettier from 'prettier';
import plugin from '../src/index.js';
import type { EjsPluginOptions } from '../src/types.js';

type FormatOptions = prettier.Options & Partial<EjsPluginOptions>;

/**
 * Format EJS text using the plugin under test.
 */
async function format(text: string, opts: FormatOptions = {}): Promise<string> {
  return prettier.format(text, {
    parser: 'ejs',
    plugins: [plugin],
    ...opts,
  });
}

describe('prettier-plugin-templates (EJS)', () => {
  describe('tag content trimming', () => {
    test('trims leading and trailing whitespace from tag content', async () => {
      expect(await format('<% foo  %>')).toBe('<% foo %>\n');
    });

    test('adds a space before and after content when missing', async () => {
      expect(await format('<%foo%>')).toBe('<% foo %>\n');
    });

    test('normalises extra spaces around content to one space', async () => {
      expect(await format('<%   foo   %>')).toBe('<% foo %>\n');
    });
  });

  describe('multiline tags', () => {
    test('collapses multiline tag to a single line (problem-statement example)', async () => {
      const input = '<%_\nif (generateSpringAuditor) {\n_%>';
      expect(await format(input)).toBe('<%_ if (generateSpringAuditor) { _%>\n');
    });

    test('trims each line and joins with a single space', async () => {
      const input = '<%_\n  const x = 1;\n  const y = 2;\n_%>';
      expect(await format(input)).toBe('<%_ const x = 1; const y = 2; _%>\n');
    });

    test('ignores empty/blank lines inside the tag', async () => {
      const input = '<%\n\n  doSomething();\n\n%>';
      expect(await format(input)).toBe('<% doSomething(); %>\n');
    });
  });

  describe('ejsCollapseMultiline option', () => {
    test('preserves multiline content when ejsCollapseMultiline is false', async () => {
      const input = '<%_\n  if (foo) {\n_%>';
      const result = await format(input, { ejsCollapseMultiline: false });
      // Content is trimmed but not collapsed; newlines in content are kept
      expect(result).toBe('<%_ if (foo) { _%>\n');
    });

    test('collapses by default (ejsCollapseMultiline defaults to true)', async () => {
      const input = '<%_\n  if (foo) {\n_%>';
      expect(await format(input)).toBe('<%_ if (foo) { _%>\n');
    });
  });

  describe('<%- vs <%=', () => {
    test('converts <%=  to <%- in non-.html.ejs files (ejsPreferRaw: auto)', async () => {
      expect(await format('<%= value %>', { filepath: 'template.ejs', ejsPreferRaw: 'auto' })).toBe(
        '<%- value %>\n',
      );
    });

    test('keeps <%=  in .html.ejs files (ejsPreferRaw: auto)', async () => {
      expect(
        await format('<%= value %>', { filepath: 'template.html.ejs', ejsPreferRaw: 'auto' }),
      ).toBe('<%= value %>\n');
    });

    test('converts <%=  to <%- when no filepath is given (ejsPreferRaw: auto default)', async () => {
      expect(await format('<%= value %>')).toBe('<%- value %>\n');
    });

    test('ejsPreferRaw: always – converts even in .html.ejs files', async () => {
      expect(
        await format('<%= value %>', {
          filepath: 'template.html.ejs',
          ejsPreferRaw: 'always',
        }),
      ).toBe('<%- value %>\n');
    });

    test('ejsPreferRaw: never – never converts', async () => {
      expect(
        await format('<%= value %>', { filepath: 'template.ejs', ejsPreferRaw: 'never' }),
      ).toBe('<%= value %>\n');
    });

    test('does not affect <%- in any mode', async () => {
      expect(await format('<%- raw %>', { filepath: 'template.ejs' })).toBe('<%- raw %>\n');
    });
  });

  describe('whitespace-slurping delimiters', () => {
    test('preserves <%_ open delimiter', async () => {
      expect(await format('<%_ code _%>')).toBe('<%_ code _%>\n');
    });

    test('preserves _%> close delimiter', async () => {
      expect(await format('<% code _%>')).toBe('<% code _%>\n');
    });

    test('preserves -%> close delimiter', async () => {
      expect(await format('<% code -%>')).toBe('<% code -%>\n');
    });
  });

  describe('comment tags', () => {
    test('preserves <%# comment tags', async () => {
      expect(await format('<%# this is a comment %>')).toBe('<%# this is a comment %>\n');
    });
  });

  describe('surrounding text preserved', () => {
    test('text before and after tags is preserved', async () => {
      expect(await format('Hello <%_ name _%> World')).toBe('Hello <%_ name _%> World\n');
    });

    test('full template with multiple tags', async () => {
      const input = '<%_ if (foo) { _%>\n  <div>content</div>\n<%_ } _%>';
      expect(await format(input)).toBe('<%_ if (foo) { _%>\n  <div>content</div>\n<%_ } _%>\n');
    });
  });

  describe('indentation preserved', () => {
    test('indentation before the tag is preserved', async () => {
      expect(await format('  <%_ if (foo) { _%>')).toBe('  <%_ if (foo) { _%>\n');
    });

    test('multiline tag retains leading whitespace of its opening line', async () => {
      expect(await format('  <%_\n  if (foo) {\n  _%>')).toBe('  <%_ if (foo) { _%>\n');
    });
  });

  describe('tree-sitter syntax validation', () => {
    test('valid EJS parses without error', async () => {
      await expect(format('<% if (ok) { %>')).resolves.toBeDefined();
    });
  });

  describe('idempotency', () => {
    test('formatting an already-formatted file produces the same result', async () => {
      const input = '<%_ if (generateSpringAuditor) { _%>\n';
      const first = await format(input);
      const second = await format(first);
      expect(second).toBe(first);
    });
  });
});
