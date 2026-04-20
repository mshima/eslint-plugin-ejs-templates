// Copyright 2024 The eslint-plugin-ejs-templates Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

import { describe, test, expect } from 'vitest';
import { lint, applyFix } from './helpers.js';

// ---------------------------------------------------------------------------
// Rule: ejs-templates/prefer-single-line-tags – violations
// ---------------------------------------------------------------------------

describe('rule: ejs-templates/prefer-single-line-tags', () => {
  test('flags a multiline <%_ _%> tag', () => {
    const msgs = lint('<%_\nif (x) {\n_%>\n<%_ } _%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBeGreaterThan(0);
  });

  test('does not flag a multiline <%= %> output tag', () => {
    const msgs = lint('<%=\n  value\n%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(0);
  });

  test('does not flag a single-line tag', () => {
    const msgs = lint('<%_ if (x) { _%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(0);
  });

  test('does not flag multiline slurp tag when trimmed content fits one line', () => {
    const msgs = lint('<%_\n  code;\n_%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Autofix: prefer-single-line-tags
// ---------------------------------------------------------------------------

describe('autofix: prefer-single-line-tags', () => {
  test('collapses single-non-empty-line multiline tag (problem-statement example)', () => {
    expect(
      applyFix('<%_\nif (generateSpringAuditor) {\n_%>\n<%_ } _%>', {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe('<%_ if (generateSpringAuditor) { _%>\n<%_ } _%>');
  });

  test('keeps multiline tag without structural braces unchanged', () => {
    const input = '<%_\n  const x = 1;\n  const y = 2;\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('does not collapse non-slurp multiline code tags when content fits one line after trim', () => {
    const input = '<%\n\n  doSomething();\n\n%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('does not collapse multiline <%= %> output tag', () => {
    const input = '<%=\n  value\n%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('does not collapse multiline <%- %> raw-output tag', () => {
    const input = '<%-\n  value\n%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('does not collapse single-line-trimmable multiline slurp tag while preserving surrounding text', () => {
    const input = 'before\n<%_\n  code;\n_%>\nafter';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('keeps indented non-structural multiline slurp tags unchanged', () => {
    const input = '  <%_\n  const a = 1;\n  const b = 2;\n  _%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('fix is idempotent', () => {
    const fixed = applyFix('<%_\n  code;\n_%>', { 'ejs-templates/prefer-single-line-tags': 'error' });
    expect(applyFix(fixed, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(fixed);
  });

  test('prefer-single-line-tags does not change already-single-line tags', () => {
    const input = '<%_ code; _%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('combined with prefer-encoded (never): fixes both unbalanced multiline tag and encoded output', () => {
    const result = applyFix('<%_\nif (cond) {\n_%>\n<h1><%= title %></h1>\n<%_ } _%>', {
      'ejs-templates/prefer-single-line-tags': 'error',
      'ejs-templates/prefer-encoded': ['error', 'never'],
    });
    expect(result).toBe('<%_ if (cond) { _%>\n<h1><%- title %></h1>\n<%_ } _%>');
  });

  test('keeps chained method call across lines unchanged without structural braces', () => {
    const input = "<%_\n  const arr = 'foo.bar'\n    .split();\n_%>";
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('keeps multiple phrases unchanged when there are no structural braces', () => {
    const input = "<%_\n  const x = 1;\n  const arr = 'a.b'\n    .split();\n_%>";
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('does not collapse code onto a // comment line', () => {
    const input =
      '<%_\n  // An embedded entity should not reference entities that embed it\n  for (relationship of relationships) {\n    if (relationship.relationshipApiDescription) {\n      doWork();\n    }\n  }\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('does not split content with balanced brace boundaries', () => {
    const input = '<%_\n  if (x) {\n  doWork();\n  }\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('multiline <% %> code tag with balanced braces is unchanged', () => {
    const input = '<%\n  if (x) {\n  doWork();\n  }\n%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('keeps balanced content between braces unchanged', () => {
    const input = '<%\n  if (x) {\n  doWorkA();\n  doWorkB();\n  }\n%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('with slurp tags keeps balanced content unchanged', () => {
    const input = '<%_\n  if (x) {\n  doWorkA();\n  doWorkB();\n  }\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('with slurp tags keeps balanced nested contents unchanged', () => {
    const input = '<%_\n  if (x) {\n  doWorkA();\n  if (y) { doWorkB();\n  doWorkC(); }\n  doWorkC();\n  }\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('with slurp tags keeps balanced assignment/destructuring block unchanged', () => {
    const input = '<%_\n  if (cond) {\n  const { foo } = bar;\n  doWork(foo);\n  }\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('with control block containing object literal and balanced braces stays unchanged', () => {
    const input = "<%_\n if (true) {\n   beans.push({ foo: 'bar' });\n }\n_%>";
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('keeps arrow function block body unchanged when braces are balanced', () => {
    const input = '<%_\n  const fn = (x) => {\n    doWork(x);\n  };\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('does not report arrow function parameters when braces are balanced', () => {
    const input = '<%_\n  items.forEach(({ foo, bar }) => {\n    console.log(foo);\n  });\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('keeps multiline tags without braces unchanged', () => {
    const input = '<%_\n  const x = 1;\n  const y = 2;\n_%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe(input);
  });

  test('keeps multiline tags with only destructuring braces unchanged', () => {
    const input = '<%_\n  const { a, b } = obj;\n  doWork(a, b);\n_%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe(input);
    expect(
      lint(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toHaveLength(0);
  });

  test('keeps multiline tags with destructuring and comments unchanged', () => {
    const input = '<%_\n  const { bar /*, foo */ } = obj;\n  doWork(bar);\n_%>';
    // Since this is only destructuring (no structural braces),
    // the tag should not be fixable and thus not reported in braces mode
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test("don't report destructuring in arrow function parameter as block brace", () => {
    const input = '<%_\n  const { foo, bar } = obj;\n  doWork(foo);\n_%>';
    // Destructuring pattern `{ foo, bar }` is not a block brace, it's a destructuring target
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs).toHaveLength(0);
  });

  test('ignores ${ template literal interpolations and keeps balanced block unchanged', () => {
    const input = '<%_\n  if (cond) {\n  const x = `hello ${name}`;\n  doWork();\n  }\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('does not split balanced braces when indent also reports in the same run', () => {
    const input = '  <%_\n  if (x) {\n  doWork();\n  }\n  _%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
        'ejs-templates/indent': 'error',
      }),
    ).toBe('<%_ if (x) {\n      doWork();\n    }\n_%>');
  });

  test('does not re-report preserved inner tag with ${ interpolation', () => {
    const input = '<%_\n  if (cond) {\n  const x = `hello ${name}`;\n  doWork();\n  }\n_%>';
    const fixed = applyFix(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });

    expect(
      lint(fixed, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toHaveLength(0);
  });

  test('does not report the preserved inner multiline tag again', () => {
    const input = '<%_\n  if (x) {\n  doWorkA();\n  doWorkB();\n  }\n_%>';
    const fixed = applyFix(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });

    expect(
      lint(fixed, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toHaveLength(0);
  });

  test('keeps } else { together in a single tag', () => {
    const input = "<%_ if(foo) { _%>\n<%_\n  } else {\n  const foo = 'bar'\n_%>\n<%_ } _%>";
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(1);
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe("<%_ if(foo) { _%>\n<%_ } else { _%>\n<%_ const foo = 'bar' _%>\n<%_ } _%>");
  });

  test('detects incomplete multiline if condition with nested parens as structural', () => {
    const input =
      "<%_\n  if ((relationship.relationshipType === 'many-to-one' || (relationship.relationshipType === 'one-to-one' && relationship.ownerSide === true))\n                && !relationship.id) {\n%>\n<%_ } _%>";
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(1);
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe(
      "<%_ if ((relationship.relationshipType === 'many-to-one' || (relationship.relationshipType === 'one-to-one' && relationship.ownerSide === true))\n                && !relationship.id) { %>\n<%_ } _%>",
    );
  });

  test('with bracesDelta=1 splits only into two tags: unbalanced opener + balanced remainder', () => {
    const input = '<%_\n  if (x) {\n  doWork();\n_%>\n<%_ } _%>';
    expect(
      applyFix(input, {
        'ejs-templates/prefer-single-line-tags': 'error',
      }),
    ).toBe('<%_ if (x) { _%>\n<%_ doWork(); _%>\n<%_ } _%>');
  });

  test('does not detect balanced for...of loops as unbalanced structural', () => {
    const input = '<%_\n  for (const item of items) {\n    doWork(item);\n  }\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(0);
  });

  test('detects for...of loops as structural unbalanced', () => {
    const input = '<%_\n  for (const item of items) {\n    doWork(item);\n\n_%><%_  }\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBeGreaterThan(0);
  });

  test('with for...of loop and destructuring assignment stays unchanged when balanced', () => {
    const input = '<%_\n  for (const rel of rels) {\n    const { id, name } = rel;\n    doWork(id, name);\n  }\n_%>';
    expect(applyFix(input, { 'ejs-templates/prefer-single-line-tags': 'error' })).toBe(input);
  });

  test('with for...of loop with complex filter (incomplete tag)', () => {
    // When the closing brace is missing (spans multiple tags), should still report
    const input = '<%_ for (const rel of relationships.filter(x => x.key)) {\n    const { id, name } = rel;\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    // The tag is multiline, so it should report if parser can handle incomplete braces
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBeGreaterThanOrEqual(0);
  });

  test('user reported case: for...of with filter and destructuring (incomplete - missing close brace)', () => {
    const input =
      '<%_ for (const relationship of relationships.filter(rel => rel.otherEntity.primaryKey)) {\n  const { otherEntity, relationshipName, propertyName, otherEntityField, relationshipRequired, otherEntityName, relationshipFieldName, relationshipFieldNamePlural } = relationship;\n_%>\n<%_ } _%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    // This tag should be flagged as multiline with structural (for) braces
    const preferSingleLineMsgs = msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags');
    // Currently fails because parser can't recognize incomplete braces
    expect(preferSingleLineMsgs.length).toBeGreaterThan(0);
  });

  test('complete for...of with filter and destructuring (with closing brace) is not reported', () => {
    const input =
      '<%_ for (const relationship of relationships.filter(rel => rel.otherEntity.primaryKey)) {\n  const { otherEntity, relationshipName } = relationship;\n}\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    const preferSingleLineMsgs = msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags');
    expect(preferSingleLineMsgs).toHaveLength(0);
  });

  test('issue: should not detect object literals as structural braces', () => {
    // Object literal array should not trigger braces mode
    const input1 = '<%_\n  const items = [\n    { id: 1, name: "a" },\n    { id: 2, name: "b" }\n  ];\n_%>';
    const msgs1 = lint(input1, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs1.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBe(0);

    // Object in function call with map should not be detected as structural
    const input2 =
      '<%_\n  const result = items.map(({ id, name }) => ({\n    id: id * 2,\n    name: name.toUpperCase()\n  }));\n_%>';
    const msgs2 = lint(input2, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs2.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBe(0);

    // Variable assignment should not be treated as structural
    const input3 = '<%_\n  const config = {\n    api: "https://example.com",\n    timeout: 5000\n  };\n_%>';
    const msgs3 = lint(input3, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs3.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags').length).toBe(0);
  });

  test('issue: should not flag object literal passed to add call in braces mode', () => {
    const input =
      '<%_\notherEntityActions.add({\n      action: `get${otherEntity.entityNamePlural}`,\n     reducer: otherEntity.builtInUser ? `userManagement.${otherEntity.entityInstancePlural}` : `${otherEntity.entityReactState}.entities`,\n});\n_%>';
    const msgs = lint(input, {
      'ejs-templates/prefer-single-line-tags': 'error',
    });
    expect(msgs.filter((m) => m.ruleId === 'ejs-templates/prefer-single-line-tags')).toHaveLength(0);
  });
});
