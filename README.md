# prettier-plugin-templates

A [Prettier](https://prettier.io/) plugin for [EJS](https://ejs.co/) (Embedded JavaScript) templates.

## Features

- **Formats EJS tags** while leaving surrounding content (HTML, text, etc.) untouched
- **Trims tag content** – removes leading/trailing whitespace from the code inside `<% ... %>`
- **Single-space padding** – ensures exactly one space between the delimiter and the content
- **Collapses multiline tags** – multi-line EJS tags are joined into a single line
- **`<%-` preference** – converts `<%=` to `<%-` (raw output) for non-`.html.ejs` files

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
converted to `<%-` (raw output):

```ejs
<%= value %>   →   <%- value %>   (in template.ejs)
<%= value %>   →   <%= value %>   (in template.html.ejs – unchanged)
```

### All delimiters are preserved

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

ISC
