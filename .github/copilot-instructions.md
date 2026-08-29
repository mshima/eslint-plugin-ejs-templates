# eslint-plugin-ejs-templates — AI agent instructions

Shared guidance for AI coding agents (GitHub Copilot, Claude, and others). `CLAUDE.md` in the
repository root points here, so this file is the single source of truth — update it here.

## Project overview

An ESLint plugin that lints EJS (Embedded JavaScript) template files. EJS files are parsed
with [tree-sitter-embedded-template] via web-tree-sitter, and each EJS tag is extracted into a
virtual JavaScript block that ESLint rules can inspect.

**Language / toolchain:** TypeScript, ESLint flat-config API, tsc (builds), Vitest (tests).

---

## Commands

```sh
npm run build      # tsc -p tsconfig.build.json -> dist/
npm test           # vitest run   (pretest: prettier --check && eslint .; posttest: typecheck)
npm run typecheck  # tsc --noEmit  (whole repo: src, test, config files)
npm run lint       # eslint .
npm run fix        # prettier --write && eslint --fix
```

### TypeScript projects

`tsconfig.json` is the project the editor, ESLint and `npm run typecheck` all use. It covers
**everything** (`**/*.ts` — `src`, `test`, and the root config files) and sets `noEmit`, so the
language server checks test files with the same options CI does. Keeping test files out of it
makes VSCode fall back to an inferred project and report errors the CLI never sees.

`tsconfig.build.json` extends it and is the only config that emits: it narrows the inputs back
to `src/**/*` plus `web-tree-sitter.d.ts` and restores `rootDir`/`outDir`. Add compiler options
to `tsconfig.json` so every consumer gets them; put anything emit-specific in the build config.
`declaration` deliberately stays on in `tsconfig.json` — declaration-emit errors such as TS2883
only surface with it, and they should fail `typecheck`, not just `build`.

`npm test` runs `pretest` and `posttest` around it, so formatting, lint and typecheck all gate
the suite. Running `npx vitest run` alone skips those.

The WASM grammars must be present in `wasm/` before anything runs; `npm run prepare` builds and
copies them out of `node_modules`. A fresh clone needs `npm install` (which triggers `prepare`).

---

## Codebase map

```
src/
  index.ts              – plugin entry: registers processor, rules, and built-in configs
  processor.ts          – ESLint processor: virtual JS, position mapping, fix translation
  ejs-parser.ts         – EJS parse -> TagBlock[] (getEjsNodes, extractTagBlocks)
  javascript-parser.ts  – parseJavaScriptPartial: best-guess parse of unbalanced JS snippets
  ts-parser.ts          – web-tree-sitter setup (parseEjs, parseJavaScript, findErrorNode)
  types.ts              – shared TypeScript types
  utils.ts              – getTagTypeComments and friends
  rules/
    index.ts            – re-exports all rule modules
    format.ts
    indent.ts
    no-comment-empty-line.ts
    no-complex-statements.ts
    no-function-block.ts
    no-global-function-call.ts
    output-semi.ts
    prefer-encoded.ts
    prefer-output.ts
    prefer-single-line-tags.ts
    prefer-slurp-multiline.ts   (registered as experimental-prefer-slurp-multiline)
    prefer-slurping-codeonly.ts
    slurp-newline.ts
test/
  helpers.ts            – makeLinter(), makeConfig(), lint(), applyFix()
  core.test.ts          – parser, processor, position mapping, plugin shape
  index.test.ts         – multi-rule autofix + fixture tests
  performance.test.ts   – scaling guard (see "Performance invariant")
  *.test.ts             – one file per rule, named after the rule
  fixtures/             – fixture EJS files referenced by tests
```

---

## How the processor works

`preprocess()` turns an EJS file into one virtual JS file: every tag becomes a block that
starts with a marker comment, and all blocks are concatenated inside a function wrapper
(`(function() {` … `})();`) so the file parses as a whole.

```
//@ejs-tag:<tagType>     <- marker comment, line 1 of every block
<the tag's JS content>
```

Rules find their tags by scanning for these markers (`getTagTypeComments()` in `src/utils.ts`)
and then look up the matching `TagBlock` via `getFileBlocks(context.filename)`.

`postprocess()` maps messages from virtual-file positions back to EJS source positions and
translates fixes (below).

### Tag types

Base types: `escaped-output` (`<%=`), `raw-output` (`<%-`), `slurp` (`<%_`/`_%>`), `code`,
`code-slurpable`, `slurp-needs-indent`.

Standalone types: `directive-comment`, `comment-empty-line`, `slurp-not-standalone`.

Base types additionally take a **`-multiline` suffix** when the content spans lines — for
example `code-multiline`, not `multiline-code`. See `EjsTagType` in `src/ejs-parser.ts`.

---

## Sentinel-based fixes

A rule cannot edit EJS source directly: it only sees virtual JavaScript. Instead a rule
replaces its marker comment with a **sentinel string**:

```ts
fixer.replaceTextRange([comment.range[0], comment.range[1]], SENTINEL_XXX);
```

`translateFix()` in `src/processor.ts` recognises the sentinel and produces the real edit
against the EJS source, using the `TagBlock` metadata. All sentinel fixes start at offset 0 of
the virtual block; anything else falls through to the general JS-fix mapping used by ordinary
ESLint rules.

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
| `SENTINEL_OUTPUT_SEMI_ADD` / `_REMOVE`    | `output-semi`                         | add / remove trailing `;`            |
| `SENTINEL_PREFER_OUTPUT`                  | `prefer-output`                       | if-wrapper → output ternary          |
| `SENTINEL_PREFER_OUTPUT_ELSE`             | `prefer-output`                       | if/else wrapper → output ternary     |
| `''` (empty string)                       | most single-delimiter rules           | generic: fix determined by `tagType` |

Rules without autofix (`no-function-block`, `no-global-function-call`) do not use sentinels.

### Fixes spanning several tags

A sentinel fix that rewrites more than the reporting tag (`prefer-output`) needs the following
blocks. `postprocess()` passes them as `options.nextBlocks` to `translateFix()`, which
**re-validates their shape before using them** — the reporting rule and the translator run at
different times, so the translator never assumes the rule's view still holds. The same applies
to fixes attached to core-rule reports, which take the following blocks directly.

Do not locate related tags positionally. A branch body normally contains further tags, so the
matching `} else {` is rarely the next block; walk forward tracking brace depth and match only
tags at depth zero (`findNegatedConditionBranches()` is the reference implementation). An
`else if` link must abort such a match rather than be skipped — skipping it pairs the `if` with
a later `else` and silently produces invalid output.

---

## Relationship to core ESLint rules

Core ESLint rules run against the virtual JS and mostly work unchanged, including position
mapping. Where a core rule **reports correctly but cannot fix** an EJS construct — its fixer
would need to move template markup that lives between tags, which the core rule cannot see —
supply the fix by attaching it to that rule's own report. **Do not add a parallel
`ejs-templates/*` rule that re-detects the same pattern.** Duplicating it forces users to
configure two rules for one concern, lets the two detections drift, and double-reports when both
are enabled.

`no-negated-condition` is the reference example — it covers both the `if`/`else` pair and the
output ternary, and a `no-output-negated-ternary` plugin rule that duplicated the latter was
removed in favour of it. `postprocess()` already maps every message back
to EJS source positions, so the fix is attached there:

```ts
if (mapped.ruleId === CORE_NO_NEGATED_CONDITION) {
  const followingBlocks = segments.slice(segmentIndex + 1).map((s) => s.block);
  const fix = buildNegatedConditionFix(segment.block, followingBlocks, sourceText);
  if (fix) return [{ ...mapped, fix }];
}
```

ESLint applies fixes from the messages `postprocess()` returns, so this needs no rule module and
no sentinel round-trip. The builder returns null unless the construct is exactly the shape it
knows how to rewrite, so unrelated reports from the same rule (the ternary form, for instance)
pass through unfixed.

Before adding any rule, check what core already reports — write a throwaway test that lints a
sample with the core rule enabled. A plugin rule is the right answer only when the pattern is
EJS-specific and core does not report it at all.

## Adding a new rule

1. Create `src/rules/<rule-name>.ts` exporting a `Rule.RuleModule`, with `meta.fixable: 'code'`
   if it has a fix, and `meta.docs.url` pointing at the README anchor.
2. Add `export { myRule } from './my-rule.js';` to `src/rules/index.ts`.
3. In `src/index.ts`: import it, add it to `pluginCore.rules` under its kebab-case name, add a
   default severity in `defaultRules` (inside `customize`), and re-export it at the bottom.
   Opinionated rules default to `'off'`.
4. If it needs a new sentinel, export the constant from `src/processor.ts` and add a branch in
   `translateFix()`. Handlers for tag types without a `javascriptPartialNode` (such as
   `comment-empty-line`) must come before the code that assumes one.
5. If the fix spans multiple tags, extend the `nextBlocks` selection in `postprocess()`. If the
   pattern is one core ESLint already reports, attach a fix to its message instead of adding a
   rule at all (see "Relationship to core ESLint rules").
6. Add `test/<rule-name>.test.ts` with `describe('rule: ejs-templates/<rule-name>')` and
   `describe('autofix: <rule-name>')` blocks.
7. Document it in `README.md`: the feature bullet list, the unordered-rules list, and a
   `### ejs-templates/<rule-name>` section.
8. Changing `defaultRules` breaks inline snapshots in `test/core.test.ts` — re-run with
   `npx vitest run -u` and confirm the diff contains only the intended rule.

---

## Gotchas

### tree-sitter trees must be freed

Parse trees live in WASM memory that the JavaScript garbage collector does not manage. They are
released by `block.javascriptPartialNode?.cleanup()`, which normally runs from `postprocess()`.

Anything that calls `preprocess()` **without** `postprocess()` — an ad-hoc script, a benchmark,
an exploratory test — must free the trees itself. Leaking them exhausts the WASM heap after a
few hundred templates and **aborts the process** (`Aborted()` / "null function or function
signature mismatch") rather than failing cleanly, which is easy to misread as a parser bug in
whatever you were investigating. In tests, free them in a `finally` block; see
`test/parse-javascript-partial.test.ts`.

### Performance invariant: brace context must stay bounded by nesting depth

`extractTagBlocks()` prepends the enclosing brace context to every tag it parses, so that a
`<% } %>` tag parses as a close rather than an error. That context must grow with **nesting
depth**, never with template length. If a closed block is left in it, tag N re-parses every
preceding tag and extraction becomes O(n²) — a 32KB template took ~3.9s before this was fixed.

Two things keep it bounded, both in `extractTagBlocks()`: entries are dropped once their block
closes, and same-depth continuations (`} else if (c) {`) supersede one another rather than
stacking. `test/performance.test.ts` guards this by counting characters fed to the parser and
asserting that doubling a template does not much more than double them; it deliberately does
not assert wall-clock time, which flakes in CI.

### Generated characters must stay invisible to rules

The virtual JavaScript contains characters the author never wrote: the `//@ejs-tag:` marker, and
a `;` appended to an output tag's expression so it forms a statement. A rule reporting on one of
those is reporting on generated code, and its message must be dropped in `postprocess()` — both
in the wrapped pass and in the raw-validation fallback, since a check added to only one leaves
the messages standing.

The suffix is appended for every output tag, single-line or multiline, and skipped when the
content already ends with a semicolon. Both halves matter. Appending it inconsistently left a
multiline tag's statement unterminated, so `@stylistic/semi` in `always` mode demanded a
semicolon that `output-semi` in `never` mode removed, and the two fixed each other forever
(ESLint reports `ESLintCircularFixesWarning` and gives up). Appending it unconditionally would
produce a synthetic `;;` for rules to trip over.

Any future synthetic text should follow the same two rules: apply it uniformly, and suppress
messages that land on it.

### WASM location fallback

`Parser.init({ locateFile })` in `src/ts-parser.ts` uses `require.resolve`, which is not defined
in a pure-ESM context. It is dormant while the default WASM lookup succeeds, but fails from a
different working directory or a `.mjs` entry point.

---

## TagBlock structure (key fields)

```ts
{
  tagType: EjsTagType;      // see "Tag types" above
  virtualCode: string;      // virtual JS for this block (starts with //@ejs-tag:<type>)
  tagOffset: number;        // offset of the opening delimiter in the EJS source
  tagLength: number;        // full tag length (open delim + content + close delim)
  openDelim: string;        // '<%' | '<%_' | '<%-' | '<%=' | '<%#'
  closeDelim: string;       // '%>' | '-%>' | '_%>'
  originalLine: number;     // 1-based line of the JS content in the EJS source
  originalColumn: number;   // 0-based column of the JS content
  codeContent: string;      // raw JS between the delimiters
  lintCodeContent: string;  // content as sent to rules (trailing blank line removed)
  lineIndent: string;       // whitespace before the tag, when standalone
  isStandalone: boolean;    // only whitespace precedes the tag on its line
  isDirectiveComment: boolean;
  javascriptPartialNode?: RelativeJavascriptNode;
}
```

`RelativeJavascriptNode` (see `src/javascript-parser.ts`) is not a bare tree-sitter node. It
carries `contentNode`, the `nodes` starting inside the original content, `bracesDelta` /
`missingOpenBracesCount` / `missingCloseBracesCount`, `splitStatements()`, and `cleanup()`.

---

## Coding conventions

- All source files begin with the Apache 2.0 license header.
- Use `.js` extensions on all relative imports (ESM, even in TypeScript source).
- `tsc` builds to `dist/` with ESM output; package entry is `dist/index.js`.
- No default exports from modules — only named exports (the plugin object itself is the one
  default export, from `src/index.ts`).
- Rule modules export a `camelCase` constant; the plugin registry uses the `kebab-case` name.
- Commits follow Conventional Commits — commitlint runs on the commit-msg hook, and
  release-please derives releases from them.

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

**For a fixing rule, also assert that the fix converges:** re-applying it is a no-op, the fixed
output no longer reports, and it introduces no fatal parse errors. See the closing test in
`test/no-negated-condition.test.ts`.

---

## Test assertion preferences

When editing or adding tests in this repository:

- Prefer `toBe(...)` with exact expected values whenever practical.
- Avoid `toContain(...)` for cases where the full output is deterministic.
- Avoid normalizing/rewriting strings in assertions (for example `replaceAll(/\s+/g, ' ')`)
  unless the test explicitly targets whitespace-insensitive behavior.
- Avoid `not.toBe(...)` when an explicit exact value can be asserted.
- If a matcher replacement is requested (for example replacing `toBeGreaterThan*`), keep the
  original intent and update expected values so tests remain strict and readable.

## Test with applyFix preferences

When assertions for applyFix result are added to this repository:

- Prefer `toMatchInlineSnapshot()` snapshot style checks.
- After converting to inline snapshots, run Vitest with update mode to materialize snapshots
  in the test file.
