// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { lint } from './helpers.js';

// ---------------------------------------------------------------------------
// Rule: no-function-block
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-function-block', () => {
  test('flags function declaration with statement block', () => {
    const msgs = lint('<% function makeFoo() { return 1; } %>', { 'ejs-templates/no-function-block': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-function-block')).toHaveLength(1);
  });

  test('flags function expression with statement block', () => {
    const msgs = lint('<% const f = function () { return 1; }; %>', { 'ejs-templates/no-function-block': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-function-block')).toHaveLength(1);
  });

  test('flags arrow function with statement block', () => {
    const msgs = lint('<% foos.filter(foo => { return foo.ok; }); %>', { 'ejs-templates/no-function-block': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-function-block')).toHaveLength(1);
  });

  test('allows concise arrow function in filter', () => {
    const msgs = lint('<% foos.filter(foo => foo.ok); %>', { 'ejs-templates/no-function-block': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-function-block')).toHaveLength(0);
  });

  test('allows concise arrow function in map', () => {
    const msgs = lint('<% foos.map(foo => foo.name); %>', { 'ejs-templates/no-function-block': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-function-block')).toHaveLength(0);
  });
});
