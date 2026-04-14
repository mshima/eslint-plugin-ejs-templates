# eslint-plugin-ejs-templates

An [ESLint](https://eslint.org/) plugin for [EJS](https://ejs.co/) (Embedded JavaScript) templates.

EJS files are parsed by [tree-sitter-embedded-template](https://github.com/tree-sitter/tree-sitter-embedded-template) via [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web), which provides accurate position information for all lint messages and autofixes.

## Features

- **EJS processor** – extracts each EJS tag into its own virtual JS block so standard ESLint rules can inspect the embedded JavaScript
- **Autofix support** – most rules support autofix; run `eslint --fix` to apply fixes (`no-global-function-call` and `no-function-block` have no autofix)
- [`ejs-templates/no-comment-empty-line`](#ejs-templatesno-comment-empty-line) – flags comment tags that leave an empty line (missing `-%>` close)
- [`ejs-templates/no-function-block`](#ejs-templatesno-function-block) – disallows function/arrow statement blocks in templates to keep logic simple
- [`ejs-templates/no-global-function-call`](#ejs-templatesno-global-function-call) – disallows direct function calls in EJS tags (with `include()` allowed by default)
- [`ejs-templates/output-semi`](#ejs-templatesoutput-semi) – enforces semicolon style for output tags (`<%= %>`, `<%- %>`) (default: `never`)
- [`ejs-templates/prefer-encoded`](#ejs-templatespreferencoded) – flags `<%- … %>` and suggests `<%= … %>` (`always`, default), or flags `<%= … %>` and suggests `<%- … %>` (`never`)
- [`ejs-templates/prefer-single-line-tags`](#ejs-templatesprefer-single-line-tags) – collapses multiline EJS tags to single-line tags
- [`ejs-templates/prefer-slurping-codeonly`](#ejs-templatespreferslurpingcodeonly) – flags `<% … %>` code tags that can be safely converted to `<%_ … _%>`
- [`ejs-templates/experimental-prefer-slurp-multiline`](#ejs-templatesexperimental-prefer-slurp-multiline) – converts multiline `<% … %>` to `<%_ … _%>`
- [`ejs-templates/format`](#ejs-templatesformat) – normalizes spacing inside tags and multiline closing delimiter layout
- [`ejs-templates/indent`](#ejs-templatesindent) – enforces brace-depth–based indentation on standalone `<%_ … _%>` tags
- [`ejs-templates/slurp-newline`](#ejs-templatesslurp-newline) – ensures `<%_ … _%>` tags are on their own line

## Installation

```sh
npm install --save-dev eslint eslint-plugin-ejs-templates
```

## Usage

Add the plugin to your ESLint flat config (`eslint.config.js`):

```js
import { defineConfig } from 'eslint/config';
import templates from 'eslint-plugin-ejs-templates';
import eslint from '@eslint/js';

export default defineConfig([
  // Standard JS rules:
  eslint.configs.recommended,

  // Apply the EJS processor to all *.ejs files with no rules (opt-in below):
  ...templates.configs.base,

  {
    files: ['**/*.ejs'],
    rules: {
      // No specific ordering requirement:
      'ejs-templates/no-comment-empty-line': 'error',
      'ejs-templates/no-function-block': 'error',
      'ejs-templates/no-global-function-call': 'error',
      'ejs-templates/output-semi': ['error', 'never'],
      'ejs-templates/prefer-encoded': 'error', // 'always' (default) or 'never'
      // Apply remaining rules in this order:
      'ejs-templates/experimental-prefer-slurp-multiline': 'error',
      'ejs-templates/prefer-slurping-codeonly': 'error',
      'ejs-templates/prefer-single-line-tags': 'error',
      'ejs-templates/slurp-newline': 'error',
      'ejs-templates/indent': 'error',
      'ejs-templates/format': 'error',
    },
  },
]);
```

Or use the `customize` helper to enable all rules with a single call and convenient options:

```js
import { defineConfig } from 'eslint/config';
import ejs from 'eslint-plugin-ejs-templates';

export default defineConfig([
  ...ejs.configs.customize({
    // allowedGlobals: ['include'],   // extra global functions to allow (default: [])
    // experimental: true,            // enable experimental rules (default: false)
    // html: 'extension',             // 'always' | 'never' | 'extension' (default)
    // stylisticBlacklist: false,     // disable conflicting @stylistic rules (default: false)
    // prettierBlacklist: false,      // disable prettier/prettier rule (default: false)
  }),
]);
```

`customize` also accepts additional ESLint `Config` entries (spread after the options object)
that will be scoped to `**/*.ejs` files:

```js
export default defineConfig([
  ...ejs.configs.customize(
    { allowedGlobals: ['include'] },
    { rules: { 'no-var': 'error' } },
    js.configs.recommended,
    stylistic.configs.customize({
      jsx: false,
      semi: true, // This plugin is optimized for 'semi: true' configuration.
    }),
  ),
]);
```

#### Options

| Option               | Type                                 | Default       | Description                                                                                                                                              |
| -------------------- | ------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedGlobals`     | `string[]`                           | `[]`          | Extra global function names that `no-global-function-call` will not flag                                                                                 |
| `experimental`       | `boolean`                            | `false`       | Enables experimental features                                                                                                                            |
| `html`               | `'always' \| 'never' \| 'extension'` | `'extension'` | Controls the `prefer-encoded` option: `always` for all `.ejs` files, `never` for all `.ejs` files, or `always` for `*.html.ejs` and `never` for the rest |
| `stylisticBlacklist` | `boolean`                            | `false`       | Turns off `@stylistic` rules that conflict with EJS formatting (for example `eol-last`, `indent`, `brace-style` and `multiline-ternary`)                 |
| `prettierBlacklist`  | `boolean`                            | `false`       | Turns off the `prettier/prettier` rule when Prettier is also configured                                                                                  |

Then run ESLint as usual:

```sh
npx eslint "**/*.ejs"
# or auto-fix violations:
npx eslint --fix "**/*.ejs"
```

> **Note on incompatible rules**
>
> The EJS processor lints each tag as a separate virtual JavaScript block.
> `no-undef` diagnostics are suppressed internally for `*.ejs` virtual blocks,
> so you do not need to disable `no-undef` in your ESLint config.

> **Note on ESLint directives in EJS comments**
>
> You can use supported ESLint directive comments inside EJS comments:
>
> - `<%# eslint-disable no-var %>`
> - `<%# eslint-enable no-var %>`
> - `<%# eslint-disable-next-line no-var %>`
>
> Example:
>
> ```ejs
> <%# eslint-disable-next-line no-var %>
> <% var value = 1; %>
> ```
>
> Regular EJS comments that are not ESLint directives continue to be ignored.

## Rules

The following rules have no specific ordering requirement (they can appear in any position):

- [`no-comment-empty-line`](#ejs-templatesno-comment-empty-line)
- [`no-function-block`](#ejs-templatesno-function-block)
- [`no-global-function-call`](#ejs-templatesno-global-function-call)
- [`output-semi`](#ejs-templatesoutput-semi)
- [`prefer-encoded`](#ejs-templatespreferencoded)

Apply the remaining rules in the following order for best results:

1. [`experimental-prefer-slurp-multiline`](#ejs-templatesexperimental-prefer-slurp-multiline) — convert multiline `<% %>` to `<%_ %>` first
2. [`prefer-slurping-codeonly`](#ejs-templatespreferslurpingcodeonly) — convert single-line `<% %>` to `<%_ %>`
3. [`prefer-single-line-tags`](#ejs-templatesprefer-single-line-tags) — collapse remaining multiline tags
4. [`slurp-newline`](#ejs-templatesslurp-newline) — ensure slurp tags are on their own line
5. [`indent`](#ejs-templatesindent) — enforce brace-depth indentation
6. [`format`](#ejs-templatesformat) — apply final whitespace/layout normalization

### `ejs-templates/experimental-prefer-slurp-multiline`

Converts multiline `<% … %>` tags to `<%_ … _%>`. Apply this rule **before**
`prefer-single-line-tags` so that multiline `<% %>` tags get their delimiters changed
before being collapsed.

|             |                                                              |
| ----------- | ------------------------------------------------------------ |
| **Fixable** | Yes — `eslint --fix` changes `<%` to `<%_` and `%>` to `_%>` |

```ejs
<!-- ✗ violation -->
<%
  if (condition) {
%>

<!-- ✓ fixed -->
<%_
  if (condition) {
_%>
```

### `ejs-templates/format`

Applies final formatting normalization to EJS tags:

- ensures a single space around trimmed content (`<% foo %>`)
- controls multiline closing delimiter style

|             |                                                       |
| ----------- | ----------------------------------------------------- |
| **Fixable** | Yes — `eslint --fix` normalizes tag whitespace/layout |

Options:

- `{ multilineClose: 'new-line' }` (default) — for originally multiline tags, move close delimiter to a new line aligned with opening tag indentation
- `{ multilineClose: 'same-line' }` — keep close delimiter on the same line as content after formatting

```js
// eslint.config.js
{
  files: ['**/*.ejs'],
  rules: {
    'ejs-templates/format': ['error', { multilineClose: 'new-line' }],
  },
}
```

```ejs
<!-- input -->
  <%_
  doWork(); _%>

<!-- with multilineClose: 'new-line' (default) -->
  <%_ doWork();
  _%>

<!-- with multilineClose: 'same-line' -->
  <%_ doWork(); _%>
```

### `ejs-templates/indent`

Enforces brace-depth–based indentation (two spaces per level) on standalone
`<%_ … _%>` tags.

Consistent indentation improves readability of nested template logic.

|             |                                                     |
| ----------- | --------------------------------------------------- |
| **Fixable** | Yes — `eslint --fix` adjusts the leading whitespace |

```ejs
<!-- ✗ violation: wrong indentation -->
<%_ if (show) { _%>
<%_ doWork(); _%>
<%_ } _%>

<!-- ✓ fixed -->
<%_ if (show) { _%>
  <%_ doWork(); _%>
<%_ } _%>
```

### `ejs-templates/no-comment-empty-line`

Requires standalone EJS comment tags to use `-%>` (trim-newline close) to avoid
leaving an empty line in the rendered output. A `<%# comment %>` tag that is on
its own line emits a blank line; `<%# comment -%>` suppresses it.

|             |                                            |
| ----------- | ------------------------------------------ |
| **Fixable** | Yes — `eslint --fix` changes `%>` to `-%>` |

```ejs
<!-- ✗ violation: leaves an empty line in output -->
<%# This is a comment %>

<!-- ✓ fixed: no empty line in output -->
<%# This is a comment -%>
```

### `ejs-templates/no-function-block`

Disallows function bodies that use `statement_block` (`{ ... }`) in templates,
including:

- function declarations
- function expressions
- arrow functions with block bodies

Reason: `statement_block` inside templates increases logic complexity and
reduces readability/maintainability.

|             |     |
| ----------- | --- |
| **Fixable** | No  |

```ejs
<!-- ✗ violation: arrow function with block body -->
<% foos.filter(foo => { return foo.ok; }); %>

<!-- ✓ allowed: concise arrow expression -->
<% foos.filter(foo => foo.ok); %>

<!-- ✓ allowed: concise arrow expression -->
<% foos.map(foo => foo.name); %>
```

Alternatives when logic grows:

- Prefer concise arrow expressions (`foo => foo.ok`) when possible.
- Pass the function through template data/context and call it as a method.
- Prefer `for...of` loops over `forEach` callback blocks for control flow.
- Split complex template parts into partials and use `include`.

### `ejs-templates/no-global-function-call`

Disallows direct function calls in EJS tags (`foo()`), while allowing
`include()` by default. Method calls (`obj.foo()`) are ignored.

If a function is passed through the template context, call it as a method such
as `locals.method()`. This rule allows that form because it only blocks direct
calls like `method()`.

|             |                                             |
| ----------- | ------------------------------------------- |
| **Fixable** | No                                          |
| **Default** | `include` is allowed (`allow: ['include']`) |

```ejs
<!-- ✗ violation -->
<% doWork(); %>

<!-- ✓ allowed by default -->
<% include('partial.ejs'); %>

<!-- ✓ not checked by this rule (method call) -->
<% locals.save(); %>
```

Options:

- `{ allow: ['name1', 'name2'] }` — adds direct function names to the allowlist

### `ejs-templates/output-semi`

Enforces semicolon style at the end of single-line output tag content in
`<%= ... %>` and `<%- ... %>`.

This rule is independent from the ordered formatting pipeline
(`experimental-prefer-slurp-multiline` → `format`) and does not affect the
behavior of the other plugin rules.

|             |                                                      |
| ----------- | ---------------------------------------------------- |
| **Fixable** | Yes — `eslint --fix` adds/removes trailing semicolon |
| **Default** | `never`                                              |

Options:

- `'never'` (default) — disallow trailing semicolon
- `'always'` — require trailing semicolon

```js
// eslint.config.js
{
  files: ['**/*.ejs'],
  rules: {
    'ejs-templates/output-semi': ['error', 'never'],
  },
}
```

```ejs
<!-- with 'never' (default) -->
<%= value; %>
<!-- fixed -->
<%= value %>

<!-- with 'always' -->
<%= value %>
<!-- fixed -->
<%= value; %>
```

```js
// eslint.config.js
{
  files: ['**/*.ejs'],
  rules: {
    'ejs-templates/no-global-function-call': ['error', { allow: ['include'] }],
  },
}
```

Security implications:

- Allowing dangerous direct calls (for example `exec()`) inside templates can
  lead to command execution risks if arguments are user-controlled.
- Prefer keeping the allowlist minimal and avoid granting process-execution
  primitives to template code.
- If your project must allow such calls, validate/sanitize all inputs and
  isolate execution contexts.

### `ejs-templates/prefer-encoded`

Enforces a consistent output-tag style across the template.

- `'always'` (default): prefer `<%=` (HTML-encoded) over `<%-` (raw).
  Flags every `<%- … %>` tag. Use this when templates render HTML and you want XSS-safe defaults.
- `'never'`: prefer `<%-` (raw / unescaped) over `<%=` (HTML-encoded).
  Flags every `<%= … %>` tag. Use this when output is already trusted or escaped by other means.

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| **Fixable** | Yes — `eslint --fix` converts between `<%-` and `<%=` based on the option |

```js
// eslint.config.js
{
  files: ['**/*.ejs'],
  rules: {
    // 'always' (default) — prefer HTML-encoded output:
    'ejs-templates/prefer-encoded': 'error',
    // 'never' — prefer raw output:
    'ejs-templates/prefer-encoded': ['error', 'never'],
  },
}
```

```ejs
<!-- with 'always' (default) -->
<%- value %>
<!-- fixed -->
<%= value %>

<!-- with 'never' -->
<%= value %>
<!-- fixed -->
<%- value %>
```

### `ejs-templates/prefer-single-line-tags`

Flags multiline tags when either:

- their content has structural braces, or
- their content becomes a single line after trimming.

For structural-brace cases, autofix keeps brace boundaries (`{` and `}`) as
separate tags and keeps the content between them in a single tag.

Keeping tags single-line avoids visual confusion between template output text
and EJS control flow, making template intent easier to scan.

|             |                                        |
| ----------- | -------------------------------------- |
| **Fixable** | Yes — `eslint --fix` collapses the tag |

```ejs
<!-- ✗ violation: single phrase split across lines -->
<%_
if (generateSpringAuditor) {
_%>

<!-- ✓ fixed -->
<%_ if (generateSpringAuditor) { _%>
```

```ejs
<!-- ✗ violation: multiline content that trims to one line -->
<%_
  code;
_%>

<!-- ✓ fixed -->
<%_ code; _%>
```

```ejs
<!-- ✗ violation: block with body and close -->
<%_
  if (x) {
  doWork();
  }
_%>

<!-- ✓ fixed: one tag per boundary -->
<%_ if (x) { _%>
<%_ doWork(); _%>
<%_ } _%>
```

### `ejs-templates/prefer-slurping-codeonly`

Prefers `<%_ … _%>` (whitespace-slurping) over `<% … %>` for single-line code
tags that are logic-only (no direct output), whose content has balanced braces,
and does not open or close a brace block.

Use this for code-only control logic; blocks that generate output should keep
their output-specific delimiters.

|             |                                                        |
| ----------- | ------------------------------------------------------ |
| **Fixable** | Yes — `eslint --fix` converts `<% … %>` to `<%_ … _%>` |

```ejs
<!-- ✗ violation -->
<% const cssClass = active ? 'active' : ''; %>

<!-- ✓ fixed -->
<%_ const cssClass = active ? 'active' : ''; _%>
```

Tags that open or close brace depth are left unchanged:

```ejs
<% if (condition) { %>  ← not flagged (opens a block)
<% } %>                 ← not flagged (closes a block)
```

### `ejs-templates/slurp-newline`

Ensures `<%_ … _%>` whitespace-slurping tags are on their own line. An inline
slurp tag will not eat the preceding whitespace as intended. Apply this rule
**after** `prefer-slurping-*` and **before** `indent`.

Because slurp tags remove the newline/whitespace before them, placing each tag
on its own line (then indenting it) makes the template easier to read and reason
about.

|             |                                                       |
| ----------- | ----------------------------------------------------- |
| **Fixable** | Yes — `eslint --fix` inserts a newline before the tag |

```ejs
<!-- ✗ violation: slurp tag is inline after other content -->
some text<%_ doWork(); _%>

<!-- ✓ fixed -->
some text
<%_ doWork(); _%>
```

## Supported EJS Delimiters

| Delimiter | Meaning                                |
| --------- | -------------------------------------- |
| `<%`      | Code (no output)                       |
| `<%=`     | Output (HTML-escaped)                  |
| `<%-`     | Output (raw / unescaped)               |
| `<%_`     | Code, trims preceding whitespace       |
| `<%#`     | Comment (no output)                    |
| `%>`      | Standard closing delimiter             |
| `-%>`     | Closing delimiter, trims trailing `\n` |
| `_%>`     | Closing delimiter, trims whitespace    |

## License

[Apache 2.0](./LICENSE)
