# eslint-plugin-ejs-templates — Copilot Instructions

## Project overview

An ESLint plugin that lints EJS (Embedded JavaScript) template files.
EJS files are parsed with [tree-sitter-embedded-template] via web-tree-sitter.
Each EJS tag is extracted into a virtual JavaScript block that ESLint rules can inspect.

**Language / toolchain:** TypeScript, ESLint flat-config API, tsc (builds), Vitest (tests).

---

## Codebase map

```
src/
  index.ts          – plugin entry: registers processors, rules, and built-in configs
  ejs-parser.ts     – tree-sitter parse → TagBlock[] (extractTagBlocks)
  processor.ts      – ESLint processor: builds virtual JS, maps positions, translates fixes
  ts-parser.ts      – tree-sitter JS parser helper (parseJavaScript, findErrorNode)
  types.ts          – shared TypeScript types
  rules/
    index.ts        – re-exports all rule modules
    format.ts
    indent.ts
    no-comment-empty-line.ts
    no-function-block.ts
    no-global-function-call.ts
    prefer-encoded.ts
    prefer-raw.ts
    prefer-single-line-tags.ts
    prefer-slurping-codeonly.ts
    prefer-slurp-multiline.ts   (experimental-prefer-slurp-multiline)
    slurp-newline.ts
test/
  helpers.ts        – makeLinter(), makeConfig(), lint(), applyFix()
  core.test.ts      – no-rule tests: parser, processor, position mapping, plugin shape
  index.test.ts     – multi-rule autofix + fixture tests
  *.test.ts         – one file per rule (named after the rule)
  fixtures/         – fixture EJS files referenced by tests
```

---

## How rules work

### Virtual code markers

The processor injects a single-line comment at the **top of each virtual block**:

```
//@ejs-tag:<tagType>
```

Rules detect violations by scanning `Program` comments for these markers.
The `tagType` values include: `code`, `code-output`, `raw-output`, `code-slurpable`,
`comment-empty-line`, `multiline-code`, `multiline-raw-output`, `multiline-code-output`, etc.

Example (from `prefer-raw`):

```ts
if (comment.type === 'Line' && comment.value.trim() === '@ejs-tag:code-output') { ... }
```

### Sentinel-based fixes

Rules cannot directly edit the EJS source; they write a **sentinel string** into the
virtual JS via `fixer.replaceTextRange([range[0], range[1]], SENTINEL_XXX)`.

The processor's `translateFix()` intercepts each fix, recognises the sentinel, and
translates it into the correct range/text in the original EJS file.

Sentinel constants are exported from `src/processor.ts`:

| Constant                                  | Rule                                  | Effect                               |
| ----------------------------------------- | ------------------------------------- | ------------------------------------ |
| `SENTINEL_PREFER_SLURP_MULTILINE`         | `experimental-prefer-slurp-multiline` | `<% → <%_`, `%> → _%>`               |
| `SENTINEL_PREFER_SINGLE_LINE_TAGS_BRACES` | `prefer-single-line-tags`             | split-brace multiline → single-line  |
| `SENTINEL_SLURP_NEWLINE`                  | `slurp-newline`                       | insert newline before slurp tag      |
| `SENTINEL_INDENT`                         | `indent`                              | adjust leading whitespace            |
| `SENTINEL_INDENT_NORMALIZE`               | `indent`                              | normalize + indent                   |
| `SENTINEL_FORMAT`                         | `format`                              | normalize tag spacing                |
| `SENTINEL_FORMAT_MULTILINE_CLOSE`         | `format`                              | move close delimiter to new line     |
| `SENTINEL_COMMENT_EMPTY_LINE`             | `no-comment-empty-line`               | `%> → -%>` on comment close          |
| `''` (empty string)                       | most single-delimiter rules           | generic: fix determined by `tagType` |

Rules without autofix (`no-function-block`, `no-global-function-call`) do not use sentinels.

### Adding a new rule

1. Create `src/rules/<rule-name>.ts` — export a `Rule.RuleModule` with `meta.fixable` set
   if the rule has a fix.
2. Add `export { myRule } from './my-rule.js';` to `src/rules/index.ts`.
3. In `src/index.ts`:
   - Import the rule.
   - Add it to `pluginCore.rules`.
   - Add it to the `all` config's `rules` map.
   - Export it at the bottom.
4. If the rule needs a new sentinel, export the constant from `src/processor.ts` and add a
   handler in `translateFix()`. If the block has no `javascriptPartialNode`, add the handler
   **before** the `if (!javascriptPartialNode) throw` guard.
5. If the rule needs a new virtual code marker, emit it in `src/ejs-parser.ts` inside the
   appropriate `comment_directive` / `code` branch.
6. Create `test/<rule-name>.test.ts` with `describe('rule: ejs-templates/<rule-name>')` and
   `describe('autofix: <rule-name>')` blocks.

---

## Test patterns

**Test helpers** (`test/helpers.ts`):

- `lint(ejsText, rules)` — returns `Linter.LintMessage[]`
- `applyFix(ejsText, rules)` — returns the fully-fixed EJS string

**Structure conventions:**

- Each rule has its own test file named after the rule.
- Tests that enable only one rule go in `test/<rule-name>.test.ts`.
- Tests that enable no rule go in `test/core.test.ts`.
- Tests that combine multiple rules or use fixture files go in `test/index.test.ts`.

**Running tests:**

```sh
npm test          # run all tests (vitest + typecheck)
npm run typecheck # typecheck only
```

---

## TagBlock structure (key fields)

```ts
{
  tagType: string; // 'code' | 'raw-output' | 'code-output' | 'code-slurpable' |
  // 'comment-empty-line' | 'multiline-*' | …
  virtualCode: string; // the virtual JS code string (starts with //@ejs-tag:<type>)
  tagOffset: number; // byte offset of the opening delimiter in the EJS source
  tagLength: number; // full length of the tag (open delim + content + close delim)
  openDelim: string; // e.g. '<%', '<%_', '<%-', '<%='
  closeDelim: string; // e.g. '%>', '-%>', '_%>'
  originalLine: number; // 1-based line of the tag in the EJS source
  isDirectiveComment: boolean; // true for ESLint directive comments and comment-empty-line blocks
  javascriptPartialNode: SyntaxNode | undefined; // tree-sitter node for the JS content
}
```

---

## Coding conventions

- All source files begin with the Apache 2.0 license header.
- Use `.js` extensions on all relative imports (ESM, even in TypeScript source).
- `tsc` builds to `dist/` with ESM output; package entry is `dist/index.js`.
- No default exports — only named exports.
- Rule modules use `camelCase` for the exported constant name; the rule name in the plugin
  registry uses `kebab-case`.
