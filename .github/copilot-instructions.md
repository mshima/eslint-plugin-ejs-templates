# eslint-plugin-ejs-templates — AI agent instructions

Shared guidance for AI coding agents (GitHub Copilot, Claude, and others). `CLAUDE.md` in the
repository root points here, so this file is the single source of truth — update it here.

## Project overview

An ESLint plugin that lints EJS (Embedded JavaScript) template files, and the parser it is built
on, each a package of its own:

- **ejs-template-parser** parses templates with [tree-sitter-embedded-template] via
  web-tree-sitter, and the code of each tag with tree-sitter-javascript, inside the blocks the
  tags before it left open: the tags with their delimiters and code, the braces each one opens and
  closes, and the tree of the texts, tags and blocks of a template (`buildTemplate`).
- **eslint-plugin-ejs-templates** extracts each EJS tag into a virtual JavaScript block that
  ESLint rules can inspect, from the tags `getEjsTags` gives.

A change to how a template or a tag is read belongs to the parser; the plugin builds the virtual
JavaScript, the rules and the fixes on top of it. What `getEjsNodes` and `getEjsTags` return is
what the plugin lints and fixes: a change there must keep the plugin's tests passing.

**Language / toolchain:** TypeScript, ESLint flat-config API, tsc (builds), Vitest (tests).

---

## Repository layout

An npm workspaces monorepo. Each package lives in `packages/<name>`, with its own
`package.json`, `tsconfig.build.json`, `src/`, `test/`, `README.md`, `CHANGELOG.md` and
`LICENSE`; the tooling (ESLint, Prettier, TypeScript, Vitest, commitlint) and its configuration
are shared at the root, where every command runs.

```
packages/
  ejs-template-parser/           – the parser
  eslint-plugin-ejs-templates/   – the ESLint plugin, which depends on the parser
```

The root `prepare` (run by `npm install`) builds every package once, in the order of the
`workspaces` of the root `package.json`: a package after the ones it depends on. The packages
themselves have no `prepare`, which npm would run on install as well.

release-please releases the packages listed in `release-please-config.json`, each from the
Conventional Commits touching its folder, and the publish job of `release-please.yml` publishes
them in dependency order. For now it lists ejs-template-parser alone: the plugin is in
development, out of the releases, and depends on the parser at `*` so that its workspace stays
linked whatever the parser's version. Releasing the plugin again means listing it there (its last
release, 0.5.0, is in `.release-please-manifest.json`) and giving its dependency a real range.

The version of a release comes from its commits: before 1.0, a `feat` bumps the minor version, and a
breaking change too (`bump-minor-pre-major`). `release-as` in the config of a package forces the
version of its next release instead, as for the 0.1.1 of the parser, which its `feat` commits would
have made 0.2.0. It is removed once that release is published, or the next release would be made at
the same version again.

## Commands

```sh
npm run build      # each package, in order: tsc -p tsconfig.build.json -> dist/
npm test           # vitest run   (pretest: prettier --check && eslint .; posttest: typecheck)
npm run coverage   # vitest run --coverage (v8): text summary, coverage/ (html, lcov), 100% thresholds
npm run typecheck  # tsc --noEmit  (whole repo: every package's src and test, config files)
npm run lint       # eslint .
npm run fix        # prettier --write && eslint --fix
```

### Coverage

`npm run coverage` requires 100% of the statements, branches, functions and lines of the sources
of both packages (`thresholds: { 100: true }` in `vitest.config.ts`). Code a change adds is tested,
or removed when no input reaches it. A guard of a state the code never gets in (tree-sitter giving
no tree, a node missing from code that parses, an invariant of the processor) is left in place and
ignored where it is, with a comment telling why: `/* v8 ignore next -- @preserve */`, or
`start`/`stop` around several statements. The `@preserve` keeps the hint through the TypeScript
transform, which drops other comments. Prefer a form without the branch over an ignore: a
`lastIndexOf` rather than `split().pop() ?? ''`, a lookup table rather than nested conditionals.

### TypeScript projects

`tsconfig.json` is the project the editor, ESLint and `npm run typecheck` all use. It covers
**everything** (`**/*.ts` — every package's `src` and `test`, and the root config files) and sets
`noEmit`, so the language server checks test files with the same options CI does. Keeping test files out of it
makes VSCode fall back to an inferred project and report errors the CLI never sees.

Each package's `tsconfig.build.json` extends it and is the only config that emits: it narrows
the inputs back to the package's `src/**/*` (plus the parser's `web-tree-sitter.d.ts`) and
restores `rootDir`/`outDir`. Add compiler options to `tsconfig.json` so every consumer gets them;
put anything emit-specific in the build config.

The `paths` of `tsconfig.json` map `ejs-template-parser` to its sources, and `vitest.config.ts`
aliases it the same way: the plugin typechecks, lints and tests against the parser as it is in
the working tree, without a build in between. The plugin's `tsconfig.build.json` resets `paths`,
so that its build compiles against the parser's declarations in `dist/`, as the published package
resolves it.

`web-tree-sitter.d.ts` is a module version of the types of web-tree-sitter, whose own are an
ambient module needing `@types/emscripten`. The parser's declarations import their types from it,
so it is published with them.
`declaration` deliberately stays on in `tsconfig.json` — declaration-emit errors such as TS2883
only surface with it, and they should fail `typecheck`, not just `build`.

`npm test` runs `pretest` and `posttest` around it, so formatting, lint and typecheck all gate
the suite. Running `npx vitest run` alone skips those.

The WASM grammars must be present in the parser's `wasm/` before anything runs; its build copies
them out of the root `node_modules`. A fresh clone needs `npm install` (which triggers
`prepare`).

---

## Codebase map

The parser, in `packages/ejs-template-parser/`:

```
src/
  index.ts              – the public API
  template.ts           – buildTemplate, cleanupTemplate, validateTemplate: the tree of a template
  diagnostics.ts        – the diagnostics of a template: its errors, its conventions
  tags.ts               – getEjsTags: the tags, each code tag parsed in its brace context, shaped
  ejs-parser.ts         – getEjsNodes, the delimiters, the absorbed `_%>` of an output tag
  javascript-parser.ts  – readTagCode: the code of a tag read in its program, its braces, nodes, statements
  escape-text.ts        – escapeText: a text to insert in a template, rendered literally (EJS 6 and 7)
  edit-template.ts      – editTemplate: edits of a template, the rest rendering as before (EJS 6 and 7)
  fixes.ts              – fixOf: the fix of a convention of a tag, the one of a diagnostic
  ts-parser.ts          – web-tree-sitter setup (parseEjs, parseJavaScript, findErrorNode)
test/
  template.test.ts      – the tree of a template
  tags.test.ts          – getEjsNodes and getEjsTags
  diagnostics.test.ts   – validateTemplate, the nodes of a template
  escape-text.test.ts   – escapeText, checked against ejs itself
  edit-template.test.ts – editTemplate, checked against ejs itself
  fixes.test.ts         – fixOf, checked against ejs itself where a fix keeps the output
  performance.test.ts   – scaling guard (see "Performance invariant")
  esm.test.ts           – the built package loads in Node as a plain ES module
```

The plugin, in `packages/eslint-plugin-ejs-templates/`:

```
src/
  index.ts              – plugin entry: registers processor, rules, and built-in configs
  processor.ts          – ESLint processor: virtual JS, position mapping, fix translation
  ejs-parser.ts         – the tags of the parser -> TagBlock[] (extractTagBlocks)
  utils.ts              – VirtualMarkerComment, the tokens of a tag (tokensOf, ifOpening)
  rules/
    index.ts            – re-exports all rule modules
    format.ts
    indent.ts
    no-comment-across-tags.ts
    no-comment-empty-line.ts
    no-complex-statements.ts
    no-function-block.ts
    no-global-function-call.ts
    no-stray-close-delimiter.ts
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

Rules take their tags from `getTagBlocks(context)`: the block of each code and output tag, in
order, with the marker comment its virtual code starts with, which they report on; none for a file
the processor did not preprocess. The rules of the conventions the parser diagnoses (see "The
conventions of the tags, shared") take their tags from its diagnostics instead:
`getDiagnosticBlocks(context, code)` gives the block of each tag with a diagnostic of that code,
and the marker comment the rule reports on.

`postprocess()` maps messages from virtual-file positions back to EJS source positions and
translates fixes (below). A position in the code of a tag maps to its character; one on the marker
of a block, to the start of its tag; one past its code (the lines the processor adds, the wrapper),
to its start, or to its end for the end of a message. The end of a message is mapped in the block it
ends in, a later one for a node across tags, and a message on a marker alone, as the rules of the
conventions report, covers its tag. The columns are 1-based, as ESLint's (`mapMessage()`).

ESLint lints the virtual file once: `preprocess()` returns it alone. Parsing it and running every
rule on it is most of the time of a lint, so a second virtual file nearly doubles it, which the
plugin did until it returned three (the same file unwrapped, and the wrapped one again) for the
parsing errors of ESLint's parser. A test counts the passes.

When the virtual file does not parse, `postprocess()` reports as parsing errors, at their tags, the
errors ejs-template-parser tells of the JavaScript of the template (`javascript-error`,
`unclosed-block`, `unopened-close`), from the one parse of its program; when it tells none, the
parsing error of ESLint's parser (an early error, such as a declaration repeated), at its tag, or at
the end of the last tag when it is in the wrapper. The plugin does not parse the JavaScript of the
template itself.

`preprocess()` builds the template once, `buildTemplate()` of the parser: the blocks come from its
`tags`, and its diagnostics, `validateTemplate()`, go in the metadata of the virtual code
(`getVirtualCodeMetadata()`).

### Rules answered by `postprocess()`

Some diagnostics of the parser cannot be reported on the virtual JavaScript: a stray close
delimiter is in a text, which the virtual JavaScript does not have. The rules of
`DIAGNOSTIC_RULES` in `src/processor.ts` (`no-stray-close-delimiter`, `no-comment-across-tags`)
each _request_ them instead (`requestDiagnostics()`): one message at the end of the virtual file,
when the metadata has a diagnostic of the rule's code. `postprocess()` answers each request with
one message per diagnostic, in the coordinates of the template, with the severity and the
`suppressions` of the request.

Being at the end of the virtual file, a request follows every directive comment of the template: a
block `eslint-disable` of the rule suppresses it (ESLint passes suppressed messages to
`postprocess()` with their `suppressions`, and counts the directive as used), while
`eslint-disable-next-line` or a range closed by `eslint-enable` cannot. A template without blocks
has no virtual file, so no rule would run on it: when it has a diagnostic of these rules,
`preprocess()` returns the function wrapper alone.

### Tag types

Base types: `escaped-output` (`<%=`), `raw-output` (`<%-`), `slurp` (`<%_`/`_%>`), `code`,
`code-slurpable`: the `shape` of the parser.

Standalone types: `directive-comment`, `comment-empty-line` (a comment tag with the parser's
`no-comment-empty-line` diagnostic, the one comment tag with a block of its own). A type tells no
other convention a tag breaks: those are the diagnostics of the parser.

Base types additionally take a **`-multiline` suffix** when the content spans lines — for
example `code-multiline`, not `multiline-code`. See `CodeTagType` in `src/ejs-parser.ts`.

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
ESLint rules. The rules of the conventions ejs-template-parser diagnoses (see "The conventions of
the tags, shared") report with `reportConventions()`, whose sentinel names the code of the
diagnostic: `translateFix()` gives the fix `fixOf()` of the parser gives it, for a tag with that
diagnostic.

| Constant                               | Rule                                  | Effect                                |
| -------------------------------------- | ------------------------------------- | ------------------------------------- |
| `conventionSentinel(code)`             | the rules of the conventions          | the fix `fixOf()` of the parser gives |
| `SENTINEL_PREFER_SLURP_MULTILINE`      | `experimental-prefer-slurp-multiline` | `<% → <%_`, `%> → _%>`                |
| `SENTINEL_INDENT_NORMALIZE`            | `indent`                              | normalize + indent                    |
| `SENTINEL_FORMAT`                      | `format`                              | normalize tag spacing                 |
| `SENTINEL_FORMAT_MULTILINE_CLOSE`      | `format`                              | move close delimiter to new line      |
| `SENTINEL_OUTPUT_SEMI_ADD` / `_REMOVE` | `output-semi`                         | add / remove trailing `;`             |
| `SENTINEL_PREFER_OUTPUT`               | `prefer-output`                       | if-wrapper → output ternary           |
| `SENTINEL_PREFER_OUTPUT_ELSE`          | `prefer-output`                       | if/else wrapper → output ternary      |
| `SENTINEL_NO_MULTILINE_OUTPUT`         | `no-multiline-output`                 | output ternary → if wrapper           |
| `''` (empty string)                    | `prefer-encoded`                      | `<%= ↔ <%-`                           |

Rules without autofix (`no-function-block`, `no-global-function-call`) do not use sentinels.

### Fixes spanning several tags

A fix that rewrites more than the reporting tag (`prefer-output`, the fix of `no-negated-condition`)
finds the other tags in the tree of the template, `buildTemplate()` of the parser, which
`postprocess()` passes to `translateFix()` as `options.template`. `findBranch()` gives the block a
tag opens a branch of, with the index of that branch: the `if` is branch 0, each `} else if (…) {`
and `} else {` the next one, and `block.close` the tag closing it. The translator **re-validates
the shape of those tags before using them** (a plain `} else {`, a plain `}`): the reporting rule
and the translator run at different times, so the translator never assumes the rule's view still
holds. The shape of a tag is told by its tokens (`tokensOf()` in `src/utils.ts`: `}`, `else`, `{`
for a plain `} else {`; `ifOpening()` for an `if (…) {` left open), which an unbalanced tag reads in
the program of its template without a parse, rather than by the error tree-sitter recovers its code
alone with.

Do not locate related tags positionally, nor by counting braces from tag to tag: a branch body
normally contains further tags, and the tree already pairs each tag with its block. An `else if`
link is a branch of its own, so the `else` of a link is simply the branch after it
(`findNegatedConditionBranches()`); a fix that needs a plain `} else {` checks that branch, rather
than skipping a link to pair the `if` with an `else` further down the chain.

The texts of a branch are its `children`; what EJS renders of them is their `rendered`, which a fix
writing them into a string must use rather than their source (`renderedOf()`).

---

## Relationship to core ESLint rules

Core ESLint rules run against the virtual JS and mostly work unchanged, including position
mapping. Where a core rule **reports correctly but cannot fix** an EJS construct — its fixer
would need to move template markup that lives between tags, which the core rule cannot see —
supply the fix by attaching it to that rule's own report. **Do not add a parallel
`ejs-templates/*` rule that re-detects the same pattern.** Duplicating it forces users to
configure two rules for one concern, lets the two detections drift, and double-reports when both
are enabled.

`no-negated-condition` is the reference example. Core ships **no fixer and no suggestions** for
it (`meta.fixable` and `meta.hasSuggestions` are both `undefined`), so every fix a user sees for
that rule in an EJS file comes from here. A `no-output-negated-ternary` plugin rule that
duplicated part of it was removed in favour of this arrangement. `postprocess()` already maps
every message back to EJS source positions, so the fix is attached there:

```ts
if (mapped.ruleId === CORE_NO_NEGATED_CONDITION) {
  const fix = buildNegatedConditionFix(segment.block, processedFile.template, sourceText);
  if (fix) return [{ ...mapped, fix }];
}
```

ESLint applies fixes from the messages `postprocess()` returns, so this needs no rule module and
no sentinel round-trip. The builder returns null unless the construct is a shape it knows how to
rewrite, so anything else passes through reported but unfixed.

Three shapes are handled, and the difference between them is worth understanding before
extending this:

- **`if`/`else` spanning tags** — rebuilds the opening tag and swaps the branch bodies. A body
  renders after the close delimiter of the tag before it (the line break a `-%>` drops, the blanks
  a `_%>` slurps) and before the open delimiter of the tag after it (the blanks a `<%_` slurps):
  these delimiters move with it, so that each branch renders what it rendered.
- **An `} else if (…) {` link** — the same swap applied to that link alone. The chain around it,
  including the outer `if` and the closing tag, is untouched. Core only reports a link whose own
  `else` is a plain block (it skips an `if` whose `else` is another `if`): the branch after the
  link in the tree, a plain `} else {`, the last one of the block.
- **A negated ternary in an output tag** — rebuilds the tag with the branches swapped.

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
   `translateFix()`. Handlers for comment tags, which have no `javascriptPartialNode`, must come
   before the code that assumes one, as the one of `conventionSentinel()` does.
5. If the fix spans multiple tags, find them in the tree of the template, `options.template` (see
   "Fixes spanning several tags"). If the pattern is one core ESLint already reports, attach a fix to its message instead of adding a
   rule at all (see "Relationship to core ESLint rules").
6. Add `test/<rule-name>.test.ts` with `describe('rule: ejs-templates/<rule-name>')` and
   `describe('autofix: <rule-name>')` blocks.
7. Document it in `README.md`: the feature bullet list, the unordered-rules list, and a
   `### ejs-templates/<rule-name>` section.
8. Changing `defaultRules` breaks inline snapshots in `test/core.test.ts` — re-run with
   `npx vitest run -u` and confirm the diff contains only the intended rule.

---

## Gotchas

### How EJS reads a template

[`docs/ejs.md`](../docs/ejs.md) tells what EJS 7.0.1 (and 6.0.1, the same) does with a template, from its sources: the
slurping before the splitting, the leftmost split at its delimiters, the modes (the literal mode
`<%%` and `%%>` enter, in which the next close delimiter is written rather than dropped), the line
break `-%>` and `_%>` drop, and the function it compiles. Read it before reasoning about what a
template renders, and add to it what you learn of EJS — checked with `ejs.render`, the
devDependency of ejs-template-parser.

### tree-sitter trees must be freed

Parse trees live in WASM memory that the JavaScript garbage collector does not manage: the tree
of a template (`cleanupTemplate(template)`, or `nodes[0].tree.delete()`) and the trees of the code of each
tag (`tag.javascript.cleanup()`). In the plugin `preprocess()` builds the template, and
`postprocess()` frees it with `cleanupTemplate()` in a `finally`, on every path: its tree and the
trees of the code of its tags, which are the `javascriptPartialNode`s of the blocks.

Anything that calls `preprocess()` **without** `postprocess()` — an ad-hoc script, a benchmark,
an exploratory test — must free the trees itself. Leaking them exhausts the WASM heap after a
few hundred templates and **aborts the process** (`Aborted()` / "null function or function
signature mismatch") rather than failing cleanly, which is easy to misread as a parser bug in
whatever you were investigating. In tests, free them in a `finally` block; see `readCode()` in the
parser's `test/tags.test.ts`.

### Performance invariant: one parse of the program, linear walks

The parser reads the JavaScript of a template once as a whole. `getEjsTags()` builds the program of
the template as EJS compiles it (`EjsProgram`: a function, a statement for each text and code tag),
parses it once, and reads each code tag there: its braces, its `{`, `${` and `}` tokens (not the
ones tree-sitter adds to recover from an error), and whether it parses alone
(`javascript.parsesAlone`: they balance, no error of the program is in it, and no node of the
program crosses an edge of its code, the `;` EJS ends it with aside). An unbalanced tag (a
`<% } %>`, an `if (a) {`) reads its nodes there, inside its blocks; a tag parsing alone is parsed
alone only when its tree is read (`contentNode`, `nodes`, `hasStructuralBraces`,
`splitStatements()`). `validateTemplate()` finds the errors and the comments across tags in the
program too. The program of a partial template, whose tags close blocks they do not open or leave
blocks open, is parsed a second time, those blocks opened before its statements and closed after
them, and its tags are read there. The code a comment across tags comments out is a comment of the
program, as EJS compiles it: its braces open and close no block, and the tags between are at the
depth of the comment. The program is freed with the last tag freed (`javascript.cleanup()`).

A tree read is a parse: a rule of the plugin reading the tree of every tag parses every tag alone
again. Check what the text of a tag tells first (`no-multiline-output` reads the tree of an output
tag only when its code has a `?` and an escaped `\n`; `prefer-output`, of a tag written `if (…) {`).
The parser's `test/performance.test.ts` asserts that a template is parsed once, a partial one twice.

Everything stays linear in the length of the template, which `test/performance.test.ts` guards by
counting characters fed to the parser: doubling a template must not much more than double them (it
deliberately does not assert wall-clock time, which flakes in CI). Two things would break it.
Parsing a tag again with the code of the tags before it, as the parser did until it built the
program: a 32KB template took ~3.9s when that context grew with the template. And walking the
program once for each tag: its nodes are collected in one walk for all the unbalanced tags
(`collectNodesInRanges()`), which goes down only to the nodes across their code. The plugin's
`extractTagBlocks()` reads each tag of `getEjsTags()` once, for the same reason.

### The conventions of the tags, shared

The parser classifies each code tag as eslint-plugin-ejs-templates does (`shape`: `slurp`,
`code-slurpable`, `code`, or an output tag's) and gives the indentation of a slurp tag at its depth
of blocks (`expectedIndent`); the plugin's `extractTagBlocks()` builds its tag types on them.

The parser's warnings `prefer-slurping-codeonly`, `slurp-newline`, `indent`,
`prefer-single-line-tags` and `no-comment-empty-line` are what the plugin's rules of the same
names report: each rule reports the tags of its diagnostic (`reportConventions()`), on the
marker of their block, with the sentinel of its code (`conventionSentinel()`). Their conditions
live in `conventionsOf()` of the parser's `src/diagnostics.ts` alone, so a change to when one of
these rules reports is made there, and it is a change of the parser. Their fixes live there too, `fixOf()` of `src/fixes.ts`, which
`translateFix()` calls for a block with the diagnostic of the sentinel (`options.diagnostics`). What
stays in the plugin is when to ask: the `normalizeContent` part of `indent` (a `<%_ _%>` tag
spanning lines whose content needs re-indenting, which the parser does not diagnose, `fixOf()` of
`indent` with `normalizeContent` telling whether it does) and whether `prefer-single-line-tags`
indents the tags it splits (`indentSplitTags`, when `indent` reports too). Compare the messages and
fixes of the plugin on the templates of generator-jhipster, before and after, for any change there.

### The parsed code of a tag

`getEjsTags()` parses `parsedCode`: the code without the line break (and the indentation after
it), or the one blank, separating it from the closing delimiter. It changes nothing of the
JavaScript, but the texts of the nodes and of `splitStatements()` are the ones of `parsedCode`,
which the plugin sends to its rules (`lintCodeContent`) and builds its fixes from. Changing it
changes the fixes of the plugin.

### The absorbed `_` of `_%>`

tree-sitter-embedded-template ends an output tag's code node one character too late when the tag
closes with `_%>` (tree-sitter/tree-sitter-embedded-template#46). `getEjsTags()` gives the tag its
real `_%>` and the code without the `_`; anything reading the code of a node directly goes through
`getDirectiveCodeText()`, so that the virtual JavaScript and the tag blocks never disagree.

### Splitting a tag keeps the output identical only via slurp delimiters

`buildCollapsedTag()` turns one tag into several — a multiline tag with structural braces, or a
single-line tag closing more than one block (`<%_ } } _%>`).

For a tag on its own line the generated tags are joined with a newline, which would change the
rendered output were it not for the delimiters it picks: every tag but the first opens with
`<%_` and every tag but the last closes with `_%>`, so the inserted line break and indentation
are slurped away. Keep that pairing if you touch this.

An inline tag is split differently: its tags stay adjacent on the same line. Splitting it
across lines would insert a break that only slurp delimiters could take back out, which means
rewriting delimiters the author chose; leaving the tags adjacent introduces nothing to undo.

The author's opening delimiter goes on the first tag only — repeating `<%_` would ask for the
whitespace before the tag to be slurped once per generated tag rather than once. Later tags open
with whatever pairs with the closing delimiter (`<%_` for `_%>`, otherwise `<%`), keeping the
seams inside the delimiter family the tag already uses.

Verify any change here by rendering with `ejs` rather than by reading the output (see "Fixes keep
what EJS renders") — whitespace slurping is easy to reason about wrongly in either direction.

### Generated characters must stay invisible to rules

The virtual JavaScript contains characters the author never wrote: the `//@ejs-tag:` marker, and
a `;` appended to an output tag's expression so it forms a statement. A rule reporting on one of
those is reporting on generated code, and its message must be dropped in `postprocess()`.

The suffix is appended for every output tag, single-line or multiline, and skipped when the
content already ends with a semicolon. Both halves matter. Appending it inconsistently left a
multiline tag's statement unterminated, so `@stylistic/semi` in `always` mode demanded a
semicolon that `output-semi` in `never` mode removed, and the two fixed each other forever
(ESLint reports `ESLintCircularFixesWarning` and gives up). Appending it unconditionally would
produce a synthetic `;;` for rules to trip over.

Any future synthetic text should follow the same two rules: apply it uniformly, and suppress
messages that land on it.

### Plain ES modules

The packages must load when Node imports them, without a transpiling loader: jiti (which loads an
`eslint.config.ts`) and Vitest define the `require` an ES module lacks, so a bare `require` works
under them and fails in Node ("require is not defined in ES module scope") — with an
`eslint.config.js` or `.mjs`, for example. The parser resolves `web-tree-sitter.wasm` with
`createRequire(import.meta.url)`; its `test/esm.test.ts` builds it and imports it in Node.

---

## TagBlock structure (key fields)

`TagBlock` is a `CodeTagBlock`, the block of a code or output tag (`isDirectiveComment: false`),
whose `javascriptPartialNode` is always there, or a `CommentTagBlock` (`isDirectiveComment: true`),
a directive or a `comment-empty-line`, which has none: test `isDirectiveComment` to narrow.

```ts
{
  tagType: CodeTagType; // see "Tag types" above; 'directive-comment' | 'comment-empty-line' for a comment
  virtualCode: string; // virtual JS for this block (starts with //@ejs-tag:<type>)
  tagOffset: number; // offset of the opening delimiter in the EJS source
  tagLength: number; // full tag length (open delim + content + close delim)
  openDelim: string; // '<%' | '<%_' | '<%-' | '<%=' | '<%#'
  closeDelim: string; // '%>' | '-%>' | '_%>'
  originalLine: number; // 1-based line of the JS content in the EJS source
  originalColumn: number; // 0-based column of the JS content
  codeContent: string; // raw JS between the delimiters
  lintCodeContent: string; // content as sent to rules (trailing blank line removed)
  lineIndent: string; // whitespace before the tag, when standalone
  isStandalone: boolean; // only whitespace precedes the tag on its line
  isDirectiveComment: false;
  javascriptPartialNode: RelativeJavascriptNode;
}
```

`RelativeJavascriptNode` (from the parser's `src/javascript-parser.ts`) is not a bare tree-sitter
node. It carries `parsesAlone`, `contentNode` (the code parsed alone, parsed when read), the `nodes`
starting inside the original content, `bracesDelta` / `missingOpenBracesCount` /
`missingCloseBracesCount`, `splitStatements()`, and `cleanup()`.

---

## Coding conventions

- All source files begin with the Apache 2.0 license header.
- Use `.js` extensions on all relative imports (ESM, even in TypeScript source).
- `tsc` builds to `dist/` with ESM output; package entry is `dist/index.js`.
- No default exports from modules — only named exports (the plugin object itself is the one
  default export, from the plugin's `src/index.ts`).
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
- Tests that a fix keeps what EJS renders go in `test/ejs-output.test.ts` (see below).

**For a fixing rule, also assert that the fix converges:** re-applying it is a no-op, the fixed
output no longer reports, and it introduces no fatal parse errors. See the closing test in
`test/no-negated-condition.test.ts`.

### Fixes keep what EJS renders

A fix rewrites a template, not just its JavaScript. Whether it keeps what EJS renders cannot be read
off the fixed text: the delimiters slurp blanks and drop line breaks, and a tag can move code
between branches. `ejsOutput(text, level)` in `test/ejs-output.ts` answers it from EJS itself. It
instruments `Template#generateSource()` of `ejs`, which appends the template function chunk by chunk
(a text, the code of a code tag, an output), and gives whether EJS compiles the template, then one
line by text, by run of code tags (their tokens, whitespace, comments and semicolons aside) and by
output tag. Two templates EJS renders alike at a level give the same lines. The semicolons are left
aside because EJS separates the code of its tags with them; compiling is what tells `});` from `}`
and `);` split into tags of their own, which EJS joins with a `;`.

| Level        | Kept                                            | Rules                                                                                                       |
| ------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `exact`      | texts, code tokens, outputs                     | `format`, `indent`, `prefer-single-line-tags`, `output-semi`                                                |
| `whitespace` | the same, whitespace of the texts aside         | `slurp-newline`, `prefer-slurping-codeonly`, `experimental-prefer-slurp-multiline`, `no-comment-empty-line` |
| `escaping`   | the same, escaped and raw outputs alike         | `prefer-encoded`                                                                                            |
| `texts`      | texts, with code and outputs at the same places | the JavaScript rules (core, `@stylistic`), whose fixes change the code of tags alone                        |
| `compiles`   | EJS still compiles it                           | `prefer-output`, `no-multiline-output`, `no-negated-condition`, which restructure tags and texts            |

`test/ejs-output.test.ts` fixes a list of templates with each rule alone and compares `ejsOutput`
before and after at the rule's level. Two runs apply rules together, since fixes interact on the same
tags across passes: the rules of the layout together at `whitespace`, and a whole configuration like
generator-jhipster's at `compiles`. A snapshot counts the templates each run fixes, so that none stops
being exercised. A new fixing rule gets a run there, at the strictest level it keeps, and a
template of the list it fixes.

`compiles` cannot tell a branch that renders differently once a restructuring fix rewrites it: a
`-%>` left behind when its body moves, a line break a fix stops dropping. So each fix of
`prefer-output`, `no-multiline-output` and `no-negated-condition` is also rendered, on the way, in
every pass of `verifyAndFix()`, which lints each pass with `verify()` (`BranchLinter` overrides it):
the part it rewrites, before and after, with the blanks before it and the blanks and the line break
after it, which its delimiters slurp and drop; a fix in the code of a tag, the ternary of an output
tag, with the whole tag. `conditionalParts()` writes its condition as one variable (negated before a
fix of `no-negated-condition`, which swaps the branches), and `renderBranches()` renders the part
with that variable true, then false, every other variable a `Proxy` standing for anything. The
configuration like generator-jhipster's enables `no-negated-condition` too: some of its fixes only
come after the fixes of other rules. EJS 7 copies the data it renders with into an object of its
own, so that the `Proxy` is only seen with `unsafePrototypeLocals: true` among the options of
`ejs.compile`. A part that does not render alone (an `include`) is left unchecked, as is a ternary
in the code of a tag that outputs nothing; a second snapshot counts the fixes of the list rendered,
so that none is. The restructuring fixes render their templates with `ejs.render` in their own tests
as well (`test/prefer-output.test.ts`, `test/no-negated-condition.test.ts`).

The same runs check any directory of templates, skipped otherwise. Run them on the templates of
generator-jhipster, current and released ones (`git archive v8.11.0 generators`), for any change to a
fix, the processor's fix translation or the conventions of the parser:

```sh
EJS_TEMPLATES=/path/to/generator-jhipster/generators npx vitest run packages/eslint-plugin-ejs-templates/test/ejs-output.test.ts
```

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

[tree-sitter-embedded-template]: https://github.com/tree-sitter/tree-sitter-embedded-template
