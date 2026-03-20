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
      expect(await format(input, { ejsCollapseMultiline: true })).toBe('<%_ if (generateSpringAuditor) { _%>\n');
    });

    test('splits multiline tag into separate single-line tags when ejsCollapseMultiline is true', async () => {
      const input = '<%_\n  const x = 1;\n  const y = 2;\n_%>';
      expect(await format(input, { ejsCollapseMultiline: true })).toBe('<%_ const x = 1; _%>\n<%_ const y = 2; _%>\n');
    });

    test('ignores empty/blank lines inside the tag', async () => {
      const input = '<%\n\n  doSomething();\n\n%>';
      expect(await format(input, { ejsCollapseMultiline: true })).toBe('<% doSomething(); %>\n');
    });
  });

  describe('ejsCollapseMultiline option', () => {
    test('preserves multiline content when ejsCollapseMultiline is false', async () => {
      const input = '<%_\n  if (foo) {\n_%>';
      const result = await format(input, { ejsCollapseMultiline: false });
      // Single logical line after trim – same result as collapsed
      expect(result).toBe('<%_ if (foo) { _%>\n');
    });

    test('puts close delimiter on its own line for multiline content when ejsCollapseMultiline is false', async () => {
      const input = '<%_ if (foo) {\n  doSomething();\n_%>';
      const result = await format(input, { ejsCollapseMultiline: false });
      expect(result).toBe('<%_ if (foo) {\n  doSomething();\n_%>\n');
    });

    test('does not collapse multiline by default (ejsCollapseMultiline defaults to false)', async () => {
      const input = '<%_\n  if (foo) {\n_%>';
      // Single logical line – output is the same with or without collapsing
      expect(await format(input)).toBe('<%_ if (foo) { _%>\n');
    });

    test('collapses when ejsCollapseMultiline is explicitly true', async () => {
      const input = '<%_\n  if (foo) {\n_%>';
      expect(await format(input, { ejsCollapseMultiline: true })).toBe('<%_ if (foo) { _%>\n');
    });
  });

  describe('close delimiter behaviour by tag type', () => {
    test('_%> is always placed on its own new line for multiline content', async () => {
      // Even if the raw content does not end with a newline, _%> must be put
      // on its own line so the slurping delimiter is unambiguous.
      const input = '<%_ if (foo) {\n  doSomething(); _%>';
      expect(await format(input)).toBe('<%_ if (foo) {\n  doSomething();\n_%>\n');
    });

    test('_%> with indent is placed on its own indented new line', async () => {
      // When an indent is in play (from ejsIndent or prevLineIndent), it
      // appears before _%> on its own line.
      const input = '  <%_ if (foo) {\n  doSomething();\n  _%>';
      expect(await format(input)).toBe('  <%_ if (foo) {\n  doSomething();\n  _%>\n');
    });

    test('%> does not trim trailing whitespace from multiline content', async () => {
      // For a non-slurping close, the raw content is preserved as-is —
      // trailing spaces on the last line are not stripped.
      const input = '<% if (foo) {\n  doSomething();  %>';
      expect(await format(input)).toBe('<% if (foo) {\n  doSomething();  %>\n');
    });

    test('%> does not force close delimiter onto a new line', async () => {
      // For a non-slurping close, the %> stays wherever the raw content
      // puts it — no newline is injected before %>.
      const input = '<% if (foo) {\n  doSomething(); %>';
      expect(await format(input)).toBe('<% if (foo) {\n  doSomething(); %>\n');
    });

    test('%> multiline content with trailing newline is preserved as-is', async () => {
      const input = '<% if (foo) {\n  doSomething();\n%>';
      expect(await format(input)).toBe('<% if (foo) {\n  doSomething();\n%>\n');
    });
  });

  describe('<%- vs <%=', () => {
    test('converts <%=  to <%- in non-.html.ejs files (ejsPreferRaw: auto)', async () => {
      expect(await format('<%= value %>', { filepath: 'template.ejs', ejsPreferRaw: 'auto' })).toBe('<%- value %>\n');
    });

    test('keeps <%=  in .html.ejs files (ejsPreferRaw: auto)', async () => {
      expect(await format('<%= value %>', { filepath: 'template.html.ejs', ejsPreferRaw: 'auto' })).toBe(
        '<%= value %>\n',
      );
    });

    test('does not convert <%=  by default (ejsPreferRaw defaults to never)', async () => {
      expect(await format('<%= value %>')).toBe('<%= value %>\n');
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
      expect(await format('<%= value %>', { filepath: 'template.ejs', ejsPreferRaw: 'never' })).toBe('<%= value %>\n');
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
    test('preserves <%# comment tags verbatim', async () => {
      expect(await format('<%# this is a comment %>')).toBe('<%# this is a comment %>\n');
    });

    test('does not trim extra whitespace inside comment tags', async () => {
      expect(await format('<%#   extra spaces   %>')).toBe('<%#   extra spaces   %>\n');
    });

    test('does not collapse multiline comment tags', async () => {
      const input = '<%#\n  line one\n  line two\n%>';
      expect(await format(input)).toBe('<%#\n  line one\n  line two\n%>\n');
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

  describe('indentation (brace-depth tracking)', () => {
    test('strips leading whitespace before a standalone <%_ tag', async () => {
      expect(await format('    <%_ if (foo) { _%>', { ejsIndent: true })).toBe('<%_ if (foo) { _%>\n');
    });

    test('strips leading whitespace before a standalone <%_ tag', async () => {
      expect(
        await format(
          `<%# comment -%>
<%_ if (clientTestFrameworkVitest) { _%>
import { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest';
`,
          { ejsPreferRaw: 'always', ejsIndent: true },
        ),
      ).toBe(
        "<%# comment -%>\n<%_ if (clientTestFrameworkVitest) { _%>\nimport { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest';\n",
      );
    });

    test('strips leading whitespace from multiline <%_ tag opening line', async () => {
      expect(
        await format('    <%_\n  if (foo) {\n  _%>', {
          ejsCollapseMultiline: true,
          ejsIndent: true,
        }),
      ).toBe('<%_ if (foo) { _%>\n');
    });

    test('adds indentation to nested consecutive <%_..._%> tags based on brace depth', async () => {
      const input = '<%_ { _%>\n<%_ { _%>\n<%_ const y = 2; _%>\n<%_ } _%>\n<%_ } _%>';
      const expected = '<%_ { _%>\n' + '  <%_ { _%>\n' + '    <%_ const y = 2; _%>\n' + '  <%_ } _%>\n' + '<%_ } _%>\n';
      expect(await format(input, { ejsIndent: true })).toBe(expected);
    });

    test('} else { keeps the same indent level', async () => {
      const input = '<%_ if (foo) { _%>\n<%_ const x = 1; _%>\n<%_ } else { _%>\n<%_ const x = 2; _%>\n<%_ } _%>';
      const expected =
        '<%_ if (foo) { _%>\n' +
        '  <%_ const x = 1; _%>\n' +
        '<%_ } else { _%>\n' +
        '  <%_ const x = 2; _%>\n' +
        '<%_ } _%>\n';
      expect(await format(input, { ejsIndent: true })).toBe(expected);
    });

    test('close delimiter aligns with open tag indentation for multiline content', async () => {
      // At brace-depth 1 (indented) the close delimiter must align with the
      // <%_ open tag (  _%> aligns with   <%_).
      // The for-loop tag opens a new block ({), increasing depth to 2.
      // The closing } tag decrements depth back to 1 before emitting,
      // so it gets one indent level (  <%_ } _%>).
      const input = '<%_ if (outer) { _%>\n' + '<%_ for (const x of xs) {\n  doSomething(x);\n_%>\n' + '<%_ } _%>\n';
      const result = await format(input, { ejsCollapseMultiline: false, ejsIndent: true });
      expect(result).toBe(
        '<%_ if (outer) { _%>\n' + '  <%_ for (const x of xs) {\n  doSomething(x);\n  _%>\n' + '  <%_ } _%>\n',
      );
    });

    test('multiline tag with destructuring correctly increments brace depth', async () => {
      // The for-loop opens a block on its first content line, but the tag ends
      // with a destructuring statement (;).  Depth must still increment by 1
      // so the next tag is correctly indented.
      const input =
        '<%_ for (const { a } of items) {\n' +
        '    const { b } = a;\n' +
        '_%>\n' +
        '<%_ doSomething(b); _%>\n' +
        '<%_ } _%>\n';
      expect(await format(input, { ejsIndent: true })).toBe(
        '<%_ for (const { a } of items) {\n' +
          '    const { b } = a;\n' +
          '_%>\n' +
          '  <%_ doSomething(b); _%>\n' +
          '<%_ } _%>\n',
      );
    });

    test('multiline tag with multiple open braces increments depth by full count', async () => {
      // Two open braces on two separate lines → depth increases by 2.
      const input =
        '<%_ if (a) {\n' + '    if (b) {\n' + '_%>\n' + '<%_ doWork(); _%>\n' + '<%_ } _%>\n' + '<%_ } _%>\n';
      expect(await format(input, { ejsIndent: true })).toBe(
        '<%_ if (a) {\n' + '    if (b) {\n' + '_%>\n' + '    <%_ doWork(); _%>\n' + '  <%_ } _%>\n' + '<%_ } _%>\n',
      );
    });

    test('does not add indentation by default (ejsIndent defaults to false)', async () => {
      const input = '<%_ if (foo) { _%>\n' + '<%_ const x = 1; _%>\n' + '<%_ } _%>\n';
      // With ejsIndent: false (default), output is identical to input.
      expect(await format(input)).toBe(input);
    });

    test('preserves leading whitespace before standalone <%_ tags when ejsIndent is false', async () => {
      expect(await format('  <%_ if (foo) { _%>\n')).toBe('  <%_ if (foo) { _%>\n');
    });
  });

  describe('ejsPreferSlurping option', () => {
    test('converts <% … %> to <%_ … _%> when ejsPreferSlurping is true', async () => {
      expect(await format('<% code %>', { ejsPreferSlurping: true })).toBe('<%_ code _%>\n');
    });

    test('does not convert <% … %> by default (ejsPreferSlurping defaults to false)', async () => {
      expect(await format('<% code %>')).toBe('<% code %>\n');
    });

    test('does not convert <%= … %> (output tag) when ejsPreferSlurping is true', async () => {
      expect(await format('<%= value %>', { ejsPreferSlurping: true })).toBe('<%= value %>\n');
    });

    test('does not convert <%# … %> (comment tag) when ejsPreferSlurping is true', async () => {
      expect(await format('<%# comment %>', { ejsPreferSlurping: true })).toBe('<%# comment %>\n');
    });

    test('does not double-convert <%_ … _%> when ejsPreferSlurping is true', async () => {
      expect(await format('<%_ code _%>', { ejsPreferSlurping: true })).toBe('<%_ code _%>\n');
    });

    test('preserves non-%> close delimiters when ejsPreferSlurping is true', async () => {
      expect(await format('<% code -%>', { ejsPreferSlurping: true })).toBe('<% code -%>\n');
    });

    test('does not convert <% } %> (leading close brace) when ejsPreferSlurping is true', async () => {
      expect(await format('<% } %>', { ejsPreferSlurping: true })).toBe('<% } %>\n');
    });

    test('does not convert <% if (foo) { %> (trailing open brace) when ejsPreferSlurping is true', async () => {
      expect(await format('<% if (foo) { %>', { ejsPreferSlurping: true })).toBe('<% if (foo) { %>\n');
    });

    test('does not convert <% } else { %> (leading close + trailing open brace) when ejsPreferSlurping is true', async () => {
      expect(await format('<% } else { %>', { ejsPreferSlurping: true })).toBe('<% } else { %>\n');
    });

    test('converts <% const x = { a: 1 }; %> (balanced inline braces) when ejsPreferSlurping is true', async () => {
      expect(await format('<% const x = { a: 1 }; %>', { ejsPreferSlurping: true })).toBe(
        '<%_ const x = { a: 1 }; _%>\n',
      );
    });

    test('ejsIndent correctly indents standalone tags converted by ejsPreferSlurping', async () => {
      // The structural tags already use <%_ _%> delimiters.  The neutral
      // <% doWork(); %> tag (balanced braces, no leading `}` or trailing `{`)
      // IS converted to <%_ _%> by preferSlurping, and ejsIndent then applies
      // the correct brace-depth indentation to the converted tag.
      const input = '<%_ if (foo) { _%>\n<% doWork(); %>\n<%_ } _%>\n';
      expect(await format(input, { ejsPreferSlurping: true, ejsIndent: true })).toBe(
        '<%_ if (foo) { _%>\n  <%_ doWork(); _%>\n<%_ } _%>\n',
      );
    });

    test('ejsPreferSlurping with ejsIndent is idempotent', async () => {
      const input = '<%_ if (foo) { _%>\n<% doWork(); %>\n<%_ } _%>\n';
      const first = await format(input, { ejsPreferSlurping: true, ejsIndent: true });
      const second = await format(first, { ejsPreferSlurping: true, ejsIndent: true });
      expect(second).toBe(first);
    });
  });

  describe('tree-sitter syntax validation', () => {
    test('valid EJS parses without error', async () => {
      await expect(format('<% if (ok) { %>')).resolves.toBeDefined();
    });

    test('throws SyntaxError on missing tag close (unclosed <%)', async () => {
      await expect(format('<% code')).rejects.toThrow(SyntaxError);
    });

    test('throws SyntaxError on missing tag open (bare %>)', async () => {
      await expect(format('code %>')).rejects.toThrow(SyntaxError);
    });

    test('throws SyntaxError on standalone %> with no preceding <%', async () => {
      await expect(format('%>')).rejects.toThrow(SyntaxError);
    });

    test('throws SyntaxError when second tag is missing its close', async () => {
      await expect(format('<% a %> <% b')).rejects.toThrow(SyntaxError);
    });

    test('throws SyntaxError when %> appears after valid tag content', async () => {
      await expect(format('<% a %>\nsome%>text')).rejects.toThrow(SyntaxError);
    });

    test('does not throw for %%> (EJS escaped close delimiter)', async () => {
      await expect(format('%%>')).resolves.toBeDefined();
    });

    test('does not throw for <%%> (EJS escaped open delimiter)', async () => {
      await expect(format('<%%>')).resolves.toBeDefined();
    });

    test('throws with a message mentioning the correct line for bare %>', async () => {
      await expect(format('hello\nworld%>')).rejects.toThrow(/line 2/);
    });
  });

  describe('idempotency', () => {
    test('formatting an already-formatted file produces the same result', async () => {
      const input = '<%_ if (generateSpringAuditor) { _%>\n';
      const first = await format(input);
      const second = await format(first);
      expect(second).toBe(first);
    });

    test('multiline content (ejsCollapseMultiline: false) is idempotent', async () => {
      const input = '<%_ for (const item of items) {\n' + '      const { name } = item;\n' + '_%>\n';
      const first = await format(input, { ejsCollapseMultiline: false });
      const second = await format(first, { ejsCollapseMultiline: false });
      expect(second).toBe(first);
    });

    test('multiline content with ejsIndent is idempotent', async () => {
      const input = '<%_ if (outer) { _%>\n' + '<%_ for (const x of xs) {\n  doSomething(x);\n_%>\n' + '<%_ } _%>\n';
      const first = await format(input, { ejsCollapseMultiline: false, ejsIndent: true });
      const second = await format(first, { ejsCollapseMultiline: false, ejsIndent: true });
      expect(second).toBe(first);
    });
  });

  describe('no-option baseline (formatted content must be identical)', () => {
    test('single-line slurping tag with proper spacing is returned unchanged', async () => {
      const input = '<%_ if (foo) { _%>\n';
      expect(await format(input)).toBe(input);
    });

    test('multiline slurping tag content is preserved as-is', async () => {
      const input = '<%_ for (const x of xs) {\n' + '  doSomething(x);\n' + '_%>\n';
      expect(await format(input)).toBe(input);
    });

    test('template with surrounding text is returned unchanged', async () => {
      const input = '<%_ if (foo) { _%>\n  <div>content</div>\n<%_ } _%>\n';
      expect(await format(input)).toBe(input);
    });

    test('leading whitespace before standalone slurping tags is preserved', async () => {
      const input = '  <%_ if (foo) { _%>\n';
      expect(await format(input)).toBe(input);
    });

    test('multi-tag template without explicit indentation is returned unchanged', async () => {
      const input = '<%_ if (foo) { _%>\n' + '<%_ const x = 1; _%>\n' + '<%_ } _%>\n';
      expect(await format(input)).toBe(input);
    });
  });

  describe('trim-only-if-single-line', () => {
    test('single-line content is still normalized (spaces trimmed)', async () => {
      expect(await format('<%_   foo   _%>')).toBe('<%_ foo _%>\n');
    });

    test('multiline content is not trimmed (raw content preserved)', async () => {
      const input = '<%_ if (foo) {\n  doSomething();\n_%>\n';
      expect(await format(input)).toBe(input);
    });

    test('content that trims to a single line is collapsed to one line', async () => {
      // Leading/trailing newlines around single-line content get collapsed.
      expect(await format('<%_\n  if (foo) {\n_%>')).toBe('<%_ if (foo) { _%>\n');
    });

    test('multiline content with trailing indent spaces is normalized (idempotency)', async () => {
      // Simulate a tag that was previously formatted with ejsIndent:true
      // (trailing spaces on the last line come from the indent prefix).
      // Re-formatting with ejsIndent:false must not keep adding more spaces.
      const input = '<%_ for (x) {\n  body();\n  _%>\n';
      const first = await format(input);
      const second = await format(first);
      expect(second).toBe(first);
    });
  });

  describe('problem-statement examples', () => {
    test('multiline <%_ tag with ejsCollapseMultiline:false – close tag aligns with open tag', async () => {
      // The issue states that when ejsCollapseMultiline is false and the
      // content is multiline, the close tag must be on its own line at the
      // same indentation as the open tag (not indented by brace-depth).
      const input =
        '<%_ for (const relationshipsByType of Object.values(differentRelationships).filter(r => r)) {\n' +
        '      const { otherEntity } = relationshipsByType[0];\n' +
        '_%>\n';
      const result = await format(input, { ejsCollapseMultiline: false });
      expect(result).toBe(
        '<%_ for (const relationshipsByType of Object.values(differentRelationships).filter(r => r)) {\n' +
          '      const { otherEntity } = relationshipsByType[0];\n' +
          '_%>\n',
      );
    });

    test('indented multiline <%_ tag preserves leading whitespace on close delimiter by default', async () => {
      // When a <%_ tag is indented (preceded by whitespace on its line) and its
      // content is multiline, the _%> close delimiter must carry the same
      // leading whitespace as the <%_ open tag.
      const input =
        '    return {\n' +
        '  <%_ for (field of fields) {\n' +
        '        const { fieldName, fieldTypeBoolean, fieldTypeTimed } = field;\n' +
        '  _%>\n';
      expect(await format(input)).toBe(input);
    });

    test('indented multiline <%_ tag is idempotent by default', async () => {
      const input =
        '    return {\n' +
        '  <%_ for (field of fields) {\n' +
        '        const { fieldName, fieldTypeBoolean, fieldTypeTimed } = field;\n' +
        '  _%>\n';
      const first = await format(input);
      const second = await format(first);
      expect(second).toBe(first);
    });

    test('full template from problem statement is returned unchanged by default', async () => {
      const input =
        '<%_ if (containDefaultProperties) { _%>\n' +
        '\n' +
        '  private getFormDefaults(): <%= entityAngularName %>FormDefaults {\n' +
        '  <%_ if (fields.some(field => field.fieldTypeTimed)) { _%>\n' +
        '      const currentTime = dayjs();\n' +
        '  <%_ } _%>\n' +
        '\n' +
        '    return {\n' +
        '  <%_ for (field of fields) {\n' +
        '        const { fieldName, fieldTypeBoolean, fieldTypeTimed } = field;\n' +
        '  _%>\n';
      expect(await format(input)).toBe(input);
    });
  });
});
