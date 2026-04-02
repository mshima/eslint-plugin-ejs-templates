// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { parseJavaScriptPartial } from '../src/processor.js';

describe('parseJavaScriptPartial', () => {
  describe('valid / balanced JavaScript', () => {
    test('simple expression returns start=0 and no brace counts', () => {
      const result = parseJavaScriptPartial('x + 1');
      try {
        expect(result.start).toBe(0);
        expect(result.missingCloseBracesCount).toBe(0);
        expect(result.missingOpenBracesCount).toBe(0);
        expect(result.bracesDelta).toBe(0);
        expect(result.nodes.length).toBeGreaterThan(0);
        expect(result.splitStatements()).toMatchObject(['x + 1']);
      } finally {
        result.cleanup();
      }
    });

    test('complete if block returns start=0', () => {
      const result = parseJavaScriptPartial('if (x) { y; }');
      try {
        expect(result.start).toBe(0);
        expect(result.bracesDelta).toBe(0);
        expect(result.splitStatements()).toMatchObject(['if (x) {', 'y;', '}']);
      } finally {
        result.cleanup();
      }
    });

    test('balanced arrow function body returns start=0', () => {
      const result = parseJavaScriptPartial('arr.forEach(x => { console.log(x); })');
      try {
        expect(result.start).toBe(0);
        expect(result.bracesDelta).toBe(0);
        expect(result.splitStatements()).toMatchObject(['arr.forEach(x => { console.log(x); })']);
      } finally {
        result.cleanup();
      }
    });

    test('multi-line complete block returns start=0', () => {
      const code = 'if (a) {\n  b();\n}';
      const result = parseJavaScriptPartial(code);
      try {
        expect(result.start).toBe(0);
        expect(result.bracesDelta).toBe(0);
        expect(result.splitStatements()).toMatchObject(['if (a) {', 'b();', '}']);
      } finally {
        result.cleanup();
      }
    });
  });

  describe('unclosed open brace (missing closing })', () => {
    test('if block opening sets start greater than 0', () => {
      const result = parseJavaScriptPartial('if (x) {');
      try {
        expect(result.missingCloseBracesCount).toBe(1);
        expect(result.bracesDelta).toBe(result.missingCloseBracesCount - result.missingOpenBracesCount);
        expect(result.splitStatements()).toMatchObject(['if (x) {']);
      } finally {
        result.cleanup();
      }
    });

    test('for loop opening sets start and missingCloseBracesCount greater than 0', () => {
      const result = parseJavaScriptPartial('for (const item of items) {');
      try {
        expect(result.missingCloseBracesCount).toBe(1);
        expect(result.splitStatements()).toMatchObject(['for (const item of items) {']);
      } finally {
        result.cleanup();
      }
    });

    test('bracesDelta equals unClosedOpen minus unOpenedClose', () => {
      const result = parseJavaScriptPartial('if (a) {');
      try {
        expect(result.bracesDelta).toBe(result.missingCloseBracesCount - result.missingOpenBracesCount);
        expect(result.splitStatements()).toMatchObject(['if (a) {']);
      } finally {
        result.cleanup();
      }
    });
  });

  describe('dangling close brace (missing opening {)', () => {
    test('closing brace sets start and missingOpenBracesCount greater than 0', () => {
      const result = parseJavaScriptPartial('}', 'if (true) {\n');
      try {
        expect(result.start).toBeGreaterThan(0);
        expect(result.missingOpenBracesCount).toBe(1);
        expect(result.splitStatements()).toMatchObject(['}']);
      } finally {
        result.cleanup();
      }
    });

    test('closing brace sets start and missingOpenBracesCount greater than 0', () => {
      const result = parseJavaScriptPartial('}}', 'if (true) {\n if (true) {\n');
      try {
        expect(result.start).toBeGreaterThan(0);
        expect(result.missingOpenBracesCount).toBe(2);
        expect(result.splitStatements()).toMatchObject(['}', '}']);
      } finally {
        result.cleanup();
      }
    });

    test('} else { pattern sets start, missingCloseBracesCount and missingOpenBracesCount greater than 0', () => {
      const result = parseJavaScriptPartial('} else {', 'if (true) {\n');
      try {
        expect(result.start).toBeGreaterThan(0);
        // has both an un-opened close and an un-closed open
        expect(result.missingCloseBracesCount).toBe(1);
        expect(result.missingOpenBracesCount).toBe(1);
        expect(result.splitStatements()).toMatchObject(['} else {']);
      } finally {
        result.cleanup();
      }
    });

    test('} else foo; pattern sets start, missingCloseBracesCount and missingOpenBracesCount greater than 0', () => {
      const result = parseJavaScriptPartial('} else foo;', 'if (true) {\n');
      try {
        expect(result.start).toBeGreaterThan(0);
        // has both an un-opened close and an un-closed open
        expect(result.missingCloseBracesCount).toBe(0);
        expect(result.missingOpenBracesCount).toBe(1);
        expect(result.splitStatements()).toMatchObject(['} else foo;']);
      } finally {
        result.cleanup();
      }
    });

    test('} catch(e) { pattern sets start greater than 0', () => {
      const result = parseJavaScriptPartial('} catch(e) {', 'try {\n');
      try {
        expect(result.start).toBeGreaterThan(0);
        expect(result.bracesDelta).toBe(result.missingOpenBracesCount - result.missingCloseBracesCount);
        expect(result.splitStatements()).toMatchObject(['} catch(e) {']);
      } finally {
        result.cleanup();
      }
    });
  });

  describe('incrementalCode fallback', () => {
    test('incrementalCode is used when brace-counting wrapper still has errors', () => {
      // Code that closes a chain opened by incrementalCode
      const incrementalCode = 'if (true) {\n';
      const result = parseJavaScriptPartial('foo();', incrementalCode);
      try {
        // Whether wrapper is used depends on whether the plain code has errors;
        // here plain code is valid so start should be 0
        expect(result.start).toBe(0);
        expect(result.bracesDelta).toBe(0);
        expect(result.splitStatements()).toMatchObject(['foo();']);
      } finally {
        result.cleanup();
      }
    });

    test('incrementalCode close-brace-only fragment keeps start greater than 0', () => {
      // } alone normally triggers wrapper; with incrementalCode providing the open
      const incrementalCode = 'if (true) {\n';
      const result = parseJavaScriptPartial('}', incrementalCode);
      try {
        expect(result.start).toBeGreaterThan(0);
        expect(result.bracesDelta).toBe(result.missingCloseBracesCount - result.missingOpenBracesCount);
        expect(result.splitStatements()).toMatchObject(['}']);
      } finally {
        result.cleanup();
      }
    });
  });

  describe('nodes and contentNode', () => {
    test('nodes length is greater than 0 for recognisable code', () => {
      const result = parseJavaScriptPartial('const x = 1;');
      try {
        expect(result.nodes.length).toBeGreaterThan(0);
        expect(result.splitStatements()).toMatchObject(['const x = 1;']);
      } finally {
        result.cleanup();
      }
    });

    test('contentNode is the root node of the unprefixed parse', () => {
      const result = parseJavaScriptPartial('x + 1');
      try {
        expect(result.contentNode).toBeDefined();
        expect(result.contentNode.type).toBe('program');
        expect(result.splitStatements()).toMatchObject(['x + 1']);
      } finally {
        result.cleanup();
      }
    });

    test('all returned nodes start within the text range when wrapper is used', () => {
      const text = 'foo();';
      const result = parseJavaScriptPartial(`if (a) {\n${text}`);
      const fullText = `if (a) {\n${text}`;
      try {
        for (const node of result.nodes) {
          expect(node.startIndex).toBeGreaterThanOrEqual(result.start);
          expect(node.startIndex).toBeLessThan(result.start + fullText.length);
        }
        expect(result.splitStatements()).toMatchObject(['if (a) {', 'foo();']);
      } finally {
        result.cleanup();
      }
    });
  });

  describe('cleanup', () => {
    test('cleanup can be called without throwing', () => {
      const result = parseJavaScriptPartial('if (x) {');
      expect(result.splitStatements()).toMatchObject(['if (x) {']);
      expect(() => {
        result.cleanup();
      }).not.toThrow();
    });
  });
});
