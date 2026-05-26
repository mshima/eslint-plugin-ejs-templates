// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, expect, test } from 'vitest';
import { getTagTypeComments } from '../src/utils.js';

describe('utils: getTagTypeComments', () => {
  test('extracts marker comments from virtual source text', () => {
    const text = ['//@ejs-tag:code', 'const x = 1;', '//@ejs-tag:escaped-output', ' value;'].join('\n');

    const comments = getTagTypeComments(text);

    expect(comments).toHaveLength(2);
    expect(comments[0].tagType).toBe('code');
    expect(comments[1].tagType).toBe('escaped-output');
  });

  test('extracts markers even when block comments span across marker lines', () => {
    const text = ['/*', '//@ejs-tag:code', '*/', '//@ejs-tag:raw-output', ' value;'].join('\n');

    const comments = getTagTypeComments(text);

    expect(comments).toHaveLength(2);
    expect(comments[0].tagType).toBe('code');
    expect(comments[1].tagType).toBe('raw-output');
  });

  test('returns range and loc aligned with marker line positions', () => {
    const text = ['alpha', '//@ejs-tag:code-slurpable', 'beta'].join('\n');

    const comments = getTagTypeComments(text);

    expect(comments).toHaveLength(1);
    expect(comments[0].comment.range).toEqual([6, 31]);
    expect(comments[0].comment.loc).toEqual({
      start: { line: 2, column: 0 },
      end: { line: 2, column: 25 },
    });
  });
});
