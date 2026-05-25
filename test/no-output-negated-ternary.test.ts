// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { applyFix, lint } from './helpers.js';

// ---------------------------------------------------------------------------
// Rule: no-output-negated-ternary
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-output-negated-ternary', () => {
  test('flags negated condition ternary in escaped output tag', () => {
    const msgs = lint('<%= !cond ? a : b %>', {
      'ejs-templates/no-output-negated-ternary': 'error',
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('ejs-templates/no-output-negated-ternary');
  });

  test('flags negated condition ternary in raw output tag', () => {
    const msgs = lint('<%- !cond ? a : b %>', {
      'ejs-templates/no-output-negated-ternary': 'error',
    });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('ejs-templates/no-output-negated-ternary');
  });

  test('does not flag positive condition ternary', () => {
    const msgs = lint('<%= cond ? a : b %>', {
      'ejs-templates/no-output-negated-ternary': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag non-ternary negation in output tag', () => {
    const msgs = lint('<%= !cond %>', {
      'ejs-templates/no-output-negated-ternary': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('does not flag ternary in code tag', () => {
    const msgs = lint('<% !cond ? a : b %>', {
      'ejs-templates/no-output-negated-ternary': 'error',
    });
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: no-output-negated-ternary
// ---------------------------------------------------------------------------

describe('autofix: no-output-negated-ternary', () => {
  test('inverts escaped output ternary', () => {
    const fixed = applyFix('<%= !cond ? a : b %>', {
      'ejs-templates/no-output-negated-ternary': 'error',
    });
    expect(fixed).toBe('<%= cond ? b : a %>');
  });

  test('inverts raw output ternary', () => {
    const fixed = applyFix('<%- !cond ? a : b %>', {
      'ejs-templates/no-output-negated-ternary': 'error',
    });
    expect(fixed).toBe('<%- cond ? b : a %>');
  });

  test('preserves parenthesized condition while inverting branches', () => {
    const fixed = applyFix('<%= !(a && b) ? yes : no %>', {
      'ejs-templates/no-output-negated-ternary': 'error',
    });
    expect(fixed).toBe('<%= (a && b) ? no : yes %>');
  });

  test('preserves trailing semicolon when present', () => {
    const fixed = applyFix('<%= !cond ? a : b; %>', {
      'ejs-templates/no-output-negated-ternary': 'error',
    });
    expect(fixed).toBe('<%= cond ? b : a; %>');
  });

  test('does not modify already-positive ternary', () => {
    const src = '<%= cond ? a : b %>';
    const fixed = applyFix(src, {
      'ejs-templates/no-output-negated-ternary': 'error',
    });
    expect(fixed).toBe(src);
  });
});
