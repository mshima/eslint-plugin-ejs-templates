# eslint-plugin-templates

An [ESLint](https://eslint.org/) plugin for [EJS](https://ejs.co/) (Embedded JavaScript) templates.

EJS files are parsed by [tree-sitter-embedded-template](https://github.com/tree-sitter/tree-sitter-embedded-template) via [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web), which provides accurate position information for all lint messages and autofixes.

## Features

- **EJS processor** – extracts each EJS tag into its own virtual JS block so standard ESLint rules (`no-undef`, `eqeqeq`, …) can inspect the embedded JavaScript
- **Autofix support** – all four plugin rules are fixable; run `eslint --fix` (or configure your editor) to automatically apply the fixes
- **`templates/prefer-raw`** – flags `<%= … %>` (HTML-escaped output) and suggests `<%- … %>` (raw output)
- **`templates/prefer-slurping`** – flags `<% … %>` code tags that can be safely converted to `<%_ … _%>` (whitespace-slurping)
- **`templates/no-multiline-tags`** – flags EJS tags whose content spans multiple lines and collapses them to a single line (or splits them into multiple single-line tags)
- **`templates/ejs-indent`** – enforces brace-depth–based indentation on standalone `<%_ … _%>` tags

## Installation

```sh
npm install --save-dev eslint eslint-plugin-templates
```

## Usage

Add the plugin to your ESLint flat config (`eslint.config.js`):

```js
import templates from 'eslint-plugin-templates';

export default [
  // Apply the EJS processor to all *.ejs files and opt in to rules:
  ...templates.configs.recommended,
  {
    files: ['**/*.ejs'],
    rules: {
      'templates/prefer-raw': 'error',
      'templates/prefer-slurping': 'error',
      'templates/no-multiline-tags': 'error',
      'templates/ejs-indent': 'error',
    },
  },
];
```

Then run ESLint as usual:

```sh
npx eslint "**/*.ejs"
# or auto-fix violations:
npx eslint --fix "**/*.ejs"
```

## Rules

### `templates/prefer-raw`

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

### `templates/prefer-slurping`

Prefers `<%_ … _%>` (whitespace-slurping) over `<% … %>` for code tags whose content has balanced braces and does not open or close a brace block by itself.

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

### `templates/no-multiline-tags`

Flags EJS tags whose content spans multiple lines. The autofix collapses the tag to a single line, or splits it into multiple single-line tags (one per non-empty content line).

|             |                                                 |
| ----------- | ----------------------------------------------- |
| **Fixable** | Yes — `eslint --fix` collapses / splits the tag |

```ejs
<!-- ✗ violation: single content line split across newlines -->
<%_
if (generateSpringAuditor) {
_%>

<!-- ✓ fixed -->
<%_ if (generateSpringAuditor) { _%>
```

```ejs
<!-- ✗ violation: multiple content lines -->
<%_
  const x = 1;
  const y = 2;
_%>

<!-- ✓ fixed: split into separate single-line tags -->
<%_ const x = 1; _%>
<%_ const y = 2; _%>
```

### `templates/ejs-indent`

Enforces brace-depth–based indentation on standalone `<%_ … _%>` tags (two spaces per brace-depth level).

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

## All Supported Delimiters

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
