# prettier-plugin-templates

A [Prettier](https://prettier.io/) plugin for [EJS](https://ejs.co/) (Embedded JavaScript) templates.

Parsing is backed by [tree-sitter-embedded-template](https://github.com/tree-sitter/tree-sitter-embedded-template), which provides syntax validation in addition to formatting.

## Features

- **Syntax validation** – uses tree-sitter to validate EJS syntax; reports a `SyntaxError` for malformed templates
- **Content normalisation** – tag content is trimmed and collapsed to a single line
- **Single-space padding** – ensures exactly one space between the delimiter and the content
- **`<%-` preference** – optionally converts `<%=` (HTML-escaped) to `<%-` (raw output), configurable per project and per file type
- **All delimiter variants** – `<%_`, `<%-`, `<%=`, `<%#`, `_%>`, `-%>`, `%>` are preserved
- **Indentation preserved** – surrounding whitespace before a tag is kept as-is

## Installation

```sh
npm install --save-dev prettier prettier-plugin-templates
```

## Usage

Add the plugin to your Prettier configuration (`.prettierrc`):

```json
{
  "plugins": ["prettier-plugin-templates"]
}
```

Then run Prettier as usual:

```sh
npx prettier --write "**/*.ejs"
```

## Formatting Rules

### Tag content trimming

Content inside EJS tags is trimmed and normalised to use exactly one space on each side.

```ejs
<%   foo   %>   →   <% foo %>
<%foo%>         →   <% foo %>
```

### Multiline tags collapsed to single line

```ejs
<%_
if (generateSpringAuditor) {
_%>
```

becomes:

```ejs
<%_ if (generateSpringAuditor) { _%>
```

### `<%-` preferred over `<%=` for non-HTML files

In files that do **not** end with `.html.ejs`, `<%=` (HTML-escaped output) is automatically
converted to `<%-` (raw output) by default:

```ejs
<%= value %>   →   <%- value %>   (in template.ejs)
<%= value %>   →   <%= value %>   (in template.html.ejs – unchanged)
```

## Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ejsPreferRaw` | `'always' \| 'never' \| 'auto'` | `'auto'` | Controls `<%=` → `<%-` conversion. `'auto'` converts unless the file ends with `.html.ejs`. |
| `ejsCollapseMultiline` | `boolean` | `true` | Collapse multiline EJS tags onto a single line. |

### Example `.prettierrc`

```json
{
  "plugins": ["prettier-plugin-templates"],
  "ejsPreferRaw": "always",
  "ejsCollapseMultiline": true
}
```

## All Supported Delimiters

| Delimiter | Meaning                                |
|-----------|----------------------------------------|
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
