// Copyright 2026 The ejs-template-parser Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { EjsSyntaxError } from '../src/ejs-parser.js';
import { buildTemplate, cleanupTemplate, diagnoseTemplate, validateTemplate } from '../src/template.js';

/** The diagnostics of a template, by code, severity and the text they are about, its trees freed. */
const diagnosticsOf = (text: string) => {
  const template = buildTemplate(text);
  try {
    return validateTemplate(template).map(({ code, severity, offset, length }) => [
      code,
      severity,
      text.slice(offset, offset + length),
    ]);
  } finally {
    cleanupTemplate(template);
  }
};

describe('nodes', () => {
  test('are the texts and the tags of a template in order, each tag once', () => {
    const text = 'a<% if (x) { if (y) { %>b<%= c %><% } } %>d';
    const template = buildTemplate(text);
    try {
      expect(template.nodes.map((node) => text.slice(node.offset, node.offset + node.length))).toEqual([
        'a',
        '<% if (x) { if (y) { %>',
        'b',
        '<%= c %>',
        '<% } } %>',
        'd',
      ]);
    } finally {
      cleanupTemplate(template);
    }
  });
});

describe('validateTemplate', () => {
  test('finds nothing in a template of the conventions', () => {
    expect(
      diagnosticsOf(
        'a\n<%_ if (on) { _%>\n  b <%= c %>\n  <%_ items.forEach(item => { _%>\n<%- item %>\n  <%_ }); _%>\n<%_ } _%>\n<%- {a: 1, b: 2} %>\n<%- // a comment, which renders nothing %>\n',
      ),
    ).toEqual([]);
  });

  test('a template that does not parse throws its syntax error, with its diagnostic', () => {
    const thrown = (() => {
      try {
        buildTemplate('a\n<%= b');
      } catch (error) {
        if (error instanceof EjsSyntaxError) return error;
      }
      throw new Error('buildTemplate throws an EjsSyntaxError');
    })();
    const { message, line, column, lineNumber, diagnostic } = thrown;
    expect({ message, line, column, lineNumber, diagnostic }).toEqual({
      message: "Failed to parse EJS template at line 2, column 6: unexpected token ''",
      line: 2,
      column: 6,
      lineNumber: 2,
      diagnostic: {
        code: 'syntax-error',
        severity: 'error',
        message: "Failed to parse EJS template at line 2, column 6: unexpected token ''",
        offset: 7,
        length: 0,
        line: 2,
        column: 5,
      },
    });
  });

  test('validates a template before it is freed, the JavaScript of its tags read', () => {
    const template = buildTemplate('<%= a %>');
    cleanupTemplate(template);
    expect(() => validateTemplate(template)).toThrow(
      'validateTemplate reads a template before cleanupTemplate frees it',
    );
  });

  test('validates a template buildTemplate built', () => {
    const template = buildTemplate('<%= a %>');
    try {
      expect(() => validateTemplate({ ...template })).toThrow('validateTemplate reads a template buildTemplate built');
    } finally {
      cleanupTemplate(template);
    }
  });

  test('frees a template disposed, as at the end of the block of a using declaration, once', () => {
    const template = buildTemplate('<%= a %>');
    template[Symbol.dispose]();
    expect(() => validateTemplate(template)).toThrow(
      'validateTemplate reads a template before cleanupTemplate frees it',
    );
    // Freed already: nothing to free again.
    cleanupTemplate(template);
  });

  test.each([
    ['a code tag', '<%_ if (x { _%>\na\n<%_ } _%>\n', '<%_ if (x { _%>'],
    ['an output tag', 'a<%= foo( %>b\n', '<%= foo( %>'],
    ['a statement after its else', '<%_ if (x) { _%>\na\n<%_ } _%>\n<%_ else { _%>\nb\n<%_ } _%>\n', '<%_ else { _%>'],
  ])('reports the JavaScript EJS cannot compile, at %s', (_name, text, tag) => {
    expect(diagnosticsOf(text)).toEqual([['javascript-error', 'error', tag]]);
  });

  test('reports the JavaScript EJS cannot compile once a tag, each tag', () => {
    // The last tag has two errors, tree-sitter recovering from `a b` and from `c d`.
    expect(diagnosticsOf('a<%= foo( bar( ) %>b\n<% c(; %>\n<% a b; c d %>\n')).toEqual([
      ['javascript-error', 'error', '<%= foo( bar( ) %>'],
      ['javascript-error', 'error', '<% c(; %>'],
      ['javascript-error', 'error', '<% a b; c d %>'],
    ]);
  });

  test('reports a comment commenting out what is between two tags', () => {
    expect(diagnosticsOf('<%_ /* if (x) { _%>\na\n<%_ } */ _%>\n')).toEqual([
      ['comment-across-tags', 'error', '<%_ /* if (x) { _%>'],
    ]);
  });

  test('reports the close delimiters EJS drops from a text, not the ones of a literal', () => {
    expect(diagnosticsOf('a %> b -%> c <%% d %> e %%> f %>\n')).toEqual([
      ['stray-close-delimiter', 'error', '%>'],
      ['stray-close-delimiter', 'error', '-%>'],
    ]);
  });

  test.each([
    ['prefer-slurping-codeonly', '<% const x = 1; %>\n', '<% const x = 1; %>'],
    ['slurp-newline', 'a <%_ const x = 1; _%>\n', '<%_ const x = 1; _%>'],
    ['indent', '<%_ if (a) { _%>\n<%_ const x = 1; _%>\n<%_ } _%>\n', '<%_ const x = 1; _%>'],
    ['prefer-single-line-tags', '<%_ if (a) { _%>\n  <%_ if (b) { _%>\nx\n<%_ } } _%>\n', '<%_ } } _%>'],
    ['prefer-single-line-tags', '<%_ if (a) {\n  b();\n_%>\nx\n<%_ } _%>\n', '<%_ if (a) {\n  b();\n_%>'],
    ['no-comment-empty-line', '<%# a comment %>\nb\n', '<%# a comment %>'],
    ['unclosed-block', '<%_ if (a) { _%>\nb\n', '<%_ if (a) { _%>'],
    ['unopened-close', 'b\n<%_ } _%>\n', '<%_ } _%>'],
  ])('warns of %s, a convention of eslint-plugin-ejs-templates', (code, text, tag) => {
    expect(diagnosticsOf(text)).toEqual([[code, 'warning', tag]]);
  });

  test('leaves alone an ESLint directive comment, which the plugin reads as a directive', () => {
    expect(diagnosticsOf('<%# eslint-disable ejs-templates/indent %>\nb\n')).toEqual([]);
  });
});

describe('diagnoseTemplate', () => {
  test('gives the diagnostics of a template that parses', () => {
    expect(diagnoseTemplate('a\n<% b() %>\n')).toEqual([
      {
        code: 'prefer-slurping-codeonly',
        severity: 'warning',
        message: 'A code tag opening no block slurps its blanks and its line break as <%_ … _%>',
        offset: 2,
        length: 9,
        line: 2,
        column: 0,
      },
    ]);
  });

  test('gives the syntax-error diagnostic of a template that does not parse, without throwing', () => {
    expect(diagnoseTemplate('a\n<%= b')).toEqual([
      {
        code: 'syntax-error',
        severity: 'error',
        message: "Failed to parse EJS template at line 2, column 6: unexpected token ''",
        offset: 7,
        length: 0,
        line: 2,
        column: 5,
      },
    ]);
  });
});
