'use strict';

const prettier = require('prettier');
const plugin = require('../index.js');

/**
 * Helper to format EJS text with the plugin.
 *
 * @param {string} text
 * @param {import('prettier').Options} [opts]
 * @returns {Promise<string>}
 */
async function format(text, opts = {}) {
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
    test('collapses multiline tag to a single line (example 1)', async () => {
      const input = `<%_\nif (generateSpringAuditor) {\n_%>`;
      expect(await format(input)).toBe('<%_ if (generateSpringAuditor) { _%>\n');
    });

    test('trims each line and joins with a single space', async () => {
      const input = `<%_\n  const x = 1;\n  const y = 2;\n_%>`;
      expect(await format(input)).toBe('<%_ const x = 1; const y = 2; _%>\n');
    });

    test('ignores empty/blank lines inside the tag', async () => {
      const input = `<%\n\n  doSomething();\n\n%>`;
      expect(await format(input)).toBe('<% doSomething(); %>\n');
    });
  });

  describe('<%- vs <%=', () => {
    test('converts <%=  to <%- in non-.html.ejs files', async () => {
      expect(await format('<%= value %>', { filepath: 'template.ejs' })).toBe(
        '<%- value %>\n',
      );
    });

    test('keeps <%=  in .html.ejs files', async () => {
      expect(
        await format('<%= value %>', { filepath: 'template.html.ejs' }),
      ).toBe('<%= value %>\n');
    });

    test('does not affect <%- in non-.html.ejs files', async () => {
      expect(await format('<%- raw %>', { filepath: 'template.ejs' })).toBe(
        '<%- raw %>\n',
      );
    });

    test('converts <%=  to <%- when no filepath is specified', async () => {
      expect(await format('<%= value %>')).toBe('<%- value %>\n');
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
      expect(await format('<%# this is a comment %>')).toBe(
        '<%# this is a comment %>\n',
      );
    });
  });

  describe('surrounding text preserved', () => {
    test('text before and after tags is preserved', async () => {
      const input = 'Hello <%_ name _%> World';
      expect(await format(input)).toBe('Hello <%_ name _%> World\n');
    });

    test('full template with multiple tags', async () => {
      const input =
        '<%_ if (foo) { _%>\n  <div>content</div>\n<%_ } _%>';
      expect(await format(input)).toBe(
        '<%_ if (foo) { _%>\n  <div>content</div>\n<%_ } _%>\n',
      );
    });
  });

  describe('indentation preserved', () => {
    test('indentation before the tag is preserved', async () => {
      const input = '  <%_ if (foo) { _%>';
      expect(await format(input)).toBe('  <%_ if (foo) { _%>\n');
    });

    test('multiline tag retains column of its opening delimiter', async () => {
      const input = '  <%_\n  if (foo) {\n  _%>';
      expect(await format(input)).toBe('  <%_ if (foo) { _%>\n');
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
