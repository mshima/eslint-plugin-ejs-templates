# eslint-plugin-ejs-templates

An [ESLint](https://eslint.org/) plugin for [EJS](https://ejs.co/) (Embedded JavaScript) templates.

EJS files are parsed by [tree-sitter-embedded-template](https://github.com/tree-sitter/tree-sitter-embedded-template) via [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web), which provides accurate position information for all lint messages and autofixes.

## Features

- **EJS processor** – extracts each EJS tag into its own virtual JS block so standard ESLint rules can inspect the embedded JavaScript
- **Autofix support** – all plugin rules are fixable; run `eslint --fix` to automatically apply fixes
- **`ejs-templates/prefer-raw`** – flags `<%= … %>` and suggests `<%- … %>`
- **`ejs-templates/prefer-slurping-codeonly`** – flags `<% … %>` code tags that can be safely converted to `<%_ … _%>`
- **`ejs-templates/prefer-slurp-multiline`** – converts multiline `<% … %>` to `<%_ … _%>`
- **`ejs-templates/no-multiline-tags`** – collapses multiline EJS tags to single-line tags
- **`ejs-templates/slurp-newline`** – ensures `<%_ … _%>` tags are on their own line
- **`ejs-templates/indent`** – enforces brace-depth–based indentation on standalone `<%_ … _%>` tags

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
  // Standard JS rules — note: some rules are incompatible with EJS templates
  // and must be disabled for *.ejs files.
  eslint.configs.recommended,

  // Apply the EJS processor to all *.ejs files with no rules (opt-in below):
  ...templates.configs.base,

  {
    files: ['**/*.ejs'],
    rules: {
      // Disable rules that are not compatible with EJS virtual blocks:
      'no-undef': 'off', // cross-block variable references are unresolvable
      'no-constant-condition': 'off', // synthetic brace-balancing introduces `if (true) {`

      // Enable EJS-specific rules (apply in this recommended order):
      'ejs-templates/prefer-slurp-multiline': 'error',
      'ejs-templates/prefer-slurping-codeonly': 'error',
      'ejs-templates/no-multiline-tags': 'error',
      'ejs-templates/slurp-newline': 'error',
      'ejs-templates/indent': 'error',
      'ejs-templates/prefer-raw': 'error',
    },
  },
]);
```

Or use `configs.all` to enable every rule in one step:

```js
import { defineConfig } from 'eslint/config';
import templates from 'eslint-plugin-ejs-templates';

export default defineConfig([
  ...templates.configs.all,
  {
    files: ['**/*.ejs'],
    rules: {
      'no-undef': 'off',
      'no-constant-condition': 'off',
    },
  },
]);
```

Then run ESLint as usual:

```sh
npx eslint "**/*.ejs"
# or auto-fix violations:
npx eslint --fix "**/*.ejs"
```

> **Note on incompatible rules**
>
> The EJS processor lints each tag as a separate virtual JavaScript block.
> Because of this isolation, certain standard ESLint rules produce false
> positives and should be disabled for `*.ejs` files:
>
> | Rule                    | Reason                                                    |
> | ----------------------- | --------------------------------------------------------- |
> | `no-undef`              | Variables defined in one tag cannot be seen by other tags |
> | `no-constant-condition` | Synthetic `if (true) {` prefixes used for brace-balancing |

## Rules

Apply rules in the following order for best results:

1. `prefer-slurp-multiline` — convert multiline `<% %>` to `<%_ %>` first
2. `prefer-slurping-codeonly` — convert single-line `<% %>` to `<%_ %>`
3. `no-multiline-tags` — collapse remaining multiline tags
4. `slurp-newline` — ensure slurp tags are on their own line
5. `indent` — enforce brace-depth indentation
6. `prefer-raw` — prefer `<%-` over `<%=`

### `ejs-templates/prefer-raw`

Prefers `<%-` (raw / unescaped output) over `<%=` (HTML-escaped output).

|             |                                              |
| ----------- | -------------------------------------------- |
| **Fixable** | Yes — `eslint --fix` converts `<%=` to `<%-` |

```ejs
<!-- ✗ violation -->
<%= value %>

<!-- ✓ fixed -->
<%- value %>
```

### `ejs-templates/prefer-slurping-codeonly`

Prefers `<%_ … _%>` (whitespace-slurping) over `<% … %>` for single-line code
tags whose content has balanced braces and does not open or close a brace block.

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

### `ejs-templates/prefer-slurp-multiline`

Converts multiline `<% … %>` tags to `<%_ … _%>`. Apply this rule **before**
`no-multiline-tags` so that multiline `<% %>` tags get their delimiters changed
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

### `ejs-templates/no-multiline-tags`

Flags EJS tags whose content spans multiple lines. The autofix splits the content
into separate single-line tags — one tag per statement boundary (`;`, `}`, `{`).
Lines starting with `.` are joined to the preceding line (chained method calls).

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
<!-- ✗ violation: multiple statements -->
<%_
  const x = 1;
  const y = 2;
_%>

<!-- ✓ fixed: one tag per statement -->
<%_ const x = 1; _%>
<%_ const y = 2; _%>
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

### `ejs-templates/slurp-newline`

Ensures `<%_ … _%>` whitespace-slurping tags are on their own line. An inline
slurp tag will not eat the preceding whitespace as intended. Apply this rule
**after** `prefer-slurping-*` and **before** `indent`.

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

### `ejs-templates/indent`

Enforces brace-depth–based indentation (two spaces per level) on standalone
`<%_ … _%>` tags.

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
