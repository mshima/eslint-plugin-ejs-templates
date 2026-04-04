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
// Rule: no-global-function-call
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-global-function-call', () => {
  test('flags function call in code tag', () => {
    const msgs = lint('<% doWork(); %>', { 'ejs-templates/no-global-function-call': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-global-function-call')).toHaveLength(1);
  });

  test('does not flag method call in code tag', () => {
    const msgs = lint('<% user.save(); %>', { 'ejs-templates/no-global-function-call': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-global-function-call')).toHaveLength(0);
  });

  test('does not flag include call (allowed by default)', () => {
    const msgs = lint("<% include('partial.ejs'); %>", { 'ejs-templates/no-global-function-call': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-global-function-call')).toHaveLength(0);
  });

  test('allows explicitly configured direct calls', () => {
    const msgs = lint('<% exec(cmd); %>', {
      'ejs-templates/no-global-function-call': ['error', { allow: ['exec'] }],
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-global-function-call')).toHaveLength(0);
  });

  test('does not flag tag without function call', () => {
    const msgs = lint('<% const value = user.name; %>', { 'ejs-templates/no-global-function-call': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-global-function-call')).toHaveLength(0);
  });
});
