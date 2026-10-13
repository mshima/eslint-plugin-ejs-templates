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
// Rule: no-complex-statements (default behavior)
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-complex-statements (default)', () => {
  test('flags try statement', () => {
    const msgs = lint('<% try { const x = 1; } catch (e) {} %>', {
      'ejs-templates/no-complex-statements': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
    expect(msgs[0].message).toContain('Try statements');
  });

  test('flags while loop', () => {
    const msgs = lint('<% while (true) { i++; } %>', { 'ejs-templates/no-complex-statements': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
    expect(msgs[0].message).toContain('While loops');
  });

  test('flags do-while loop', () => {
    const msgs = lint('<% do { i++; } while (i < 10); %>', {
      'ejs-templates/no-complex-statements': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
    expect(msgs[0].message).toContain('Do-while');
  });

  test('flags switch statement', () => {
    const msgs = lint('<% switch (x) { case 1: break; } %>', {
      'ejs-templates/no-complex-statements': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
    expect(msgs[0].message).toContain('Switch');
  });

  test('flags function declaration', () => {
    const msgs = lint('<% function foo() { return 1; } %>', {
      'ejs-templates/no-complex-statements': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
    expect(msgs[0].message).toContain('Function');
  });

  test('flags class declaration', () => {
    const msgs = lint('<% class MyClass { } %>', { 'ejs-templates/no-complex-statements': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
    expect(msgs[0].message).toContain('Class');
  });

  test('flags labeled statement', () => {
    const msgs = lint('<% outer: for (let i = 0; i < 10; i++) { break outer; } %>', {
      'ejs-templates/no-complex-statements': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
    expect(msgs[0].message).toContain('Labeled');
  });

  test('flags debugger statement', () => {
    const msgs = lint('<% debugger; %>', { 'ejs-templates/no-complex-statements': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
    expect(msgs[0].message).toContain('Debugger');
  });

  test('allows for loop', () => {
    const msgs = lint('<% for (let i = 0; i < 10; i++) { x++; } %>', {
      'ejs-templates/no-complex-statements': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });

  test('allows for-of loop', () => {
    const msgs = lint('<% for (const item of items) { foo(item); } %>', {
      'ejs-templates/no-complex-statements': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });

  test('allows for-in loop', () => {
    const msgs = lint('<% for (const key in obj) { foo(obj[key]); } %>', {
      'ejs-templates/no-complex-statements': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });

  test('allows if statement', () => {
    const msgs = lint('<% if (x) { y = 1; } %>', { 'ejs-templates/no-complex-statements': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });

  test('allows simple variable declaration', () => {
    const msgs = lint('<% const x = 1; const y = 2; %>', {
      'ejs-templates/no-complex-statements': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });

  test('allows expression statement', () => {
    const msgs = lint('<% foo(); bar(); %>', { 'ejs-templates/no-complex-statements': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });

  test('allows method call', () => {
    const msgs = lint('<% obj.method(); %>', { 'ejs-templates/no-complex-statements': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rule: no-complex-statements (custom disallow)
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-complex-statements (custom disallow)', () => {
  test('allows statements not in disallow list', () => {
    const msgs = lint(
      `<% 
    try { x = 1; } catch (e) {}
    while (true) { i++; }
  %>`,
      {
        'ejs-templates/no-complex-statements': ['error', { disallow: ['ForStatement'] }],
      },
    );
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });

  test('flags only specified disallow list', () => {
    const msgs = lint('<% while (true) { i++; } %>', {
      'ejs-templates/no-complex-statements': ['error', { disallow: ['WhileStatement'] }],
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
  });

  test('can disable single statement type', () => {
    const msgs = lint(
      `<% 
    try { x = 1; } catch (e) {}
    while (true) { i++; }
  %>`,
      {
        'ejs-templates/no-complex-statements': ['error', { disallow: ['TryStatement', 'DoWhileStatement'] }],
      },
    );
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1); // only try
  });

  test('empty disallow list allows everything', () => {
    const msgs = lint(
      `<% 
    try { x = 1; } catch (e) {}
    while (true) { i++; }
    switch (x) {}
    debugger;
  %>`,
      {
        'ejs-templates/no-complex-statements': ['error', { disallow: [] }],
      },
    );
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rule: no-complex-statements (custom messages)
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-complex-statements (custom messages)', () => {
  test('uses custom message when provided', () => {
    const msgs = lint('<% while (x < 10) { x++; } %>', {
      'ejs-templates/no-complex-statements': [
        'error',
        {
          disallow: [
            {
              type: 'WhileStatement',
              message: 'Custom while message',
            },
          ],
        },
      ],
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
    expect(msgs[0].message).toBe('Custom while message');
  });

  test('custom message overrides default', () => {
    const customMsg = 'Use Array.map instead of while loops';
    const msgs = lint('<% while (i < items.length) { process(items[i]); i++; } %>', {
      'ejs-templates/no-complex-statements': [
        'error',
        {
          disallow: [
            {
              type: 'WhileStatement',
              message: customMsg,
            },
          ],
        },
      ],
    });
    expect(msgs[0].message).toBe(customMsg);
  });

  test('mixed custom and default messages', () => {
    const msgs = lint(
      `<% 
    while (true) { i++; }
    switch (x) { }
  %>`,
      {
        'ejs-templates/no-complex-statements': [
          'error',
          {
            disallow: [
              { type: 'WhileStatement', message: 'Custom while' },
              'SwitchStatement', // default message
            ],
          },
        ],
      },
    );
    const results = msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements');
    expect(results).toHaveLength(2);
    expect(results.some((m) => m.message === 'Custom while')).toBe(true);
    expect(results.some((m) => m.message.includes('Switch'))).toBe(true);
  });

  test('message with nodeType placeholder', () => {
    // This tests that if an unknown statement type gets a message from defaultComplex
    const msgs = lint(
      `<% 
    while (true) { i++; }
  %>`,
      {
        'ejs-templates/no-complex-statements': [
          'error',
          {
            disallow: ['WhileStatement'],
          },
        ],
      },
    );
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Multiple violations in single tag
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-complex-statements (multiple violations)', () => {
  test('reports multiple violations in same tag', () => {
    const msgs = lint(
      `<% 
      while (x < 10) { 
        x++; 
      }
      try {
        doWork();
      } catch (e) {}
    %>`,
      { 'ejs-templates/no-complex-statements': 'error' },
    );
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(2);
  });

  test('reports multiple tags with violations', () => {
    const msgs = lint(
      `<% while (x < 10) { x++; } %>
    <% try { const x = 1; } catch (e) {} %>`,
      { 'ejs-templates/no-complex-statements': 'error' },
    );
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Output tags (should not report statements)
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/no-complex-statements (output tags)', () => {
  test('ignores output tags with no statements', () => {
    const msgs = lint('<%= x + 1 %>', { 'ejs-templates/no-complex-statements': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });

  test('ignores raw output tags with no statements', () => {
    const msgs = lint('<%- x + 1 %>', { 'ejs-templates/no-complex-statements': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/no-complex-statements')).toHaveLength(0);
  });
});
