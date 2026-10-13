# How EJS reads a template

What EJS 7.0.1 (the devDependency of ejs-template-parser) does with a template, read from its
sources (`lib/esm/ejs.js`: `Template#generateSource`,
`parseTemplateText`, `scanLine`, `_addOutput`, `compile`). What the parser and the plugin assume of
EJS is here; the parser's `escapeText` follows it step by step, and its tests check it against
`ejs.render`.

EJS 6.0.1, the version generator-jhipster renders with, reads a template the same way: the functions
above are the same in both. 7.0.1 only stopped reading options (`delimiter`, `rmWhitespace`, ...)
from the data of `render(template, data)`; they are passed in its third argument.

Everything below uses the default delimiters (`<`, `%`, `>`). EJS builds all of it from its
`openDelimiter`, `delimiter` and `closeDelimiter` options; the parser supports only the defaults.

## The steps

`generateSource` turns the template into the body of a function, in four steps:

1. `rmWhitespace` (off by default): line breaks collapsed and every line trimmed.
2. **Slurping**: two regular expressions on the whole raw text, before anything is split:
   `[ \t]*<%_` → `<%_` and `_%>[ \t]*` → `_%>`. Spaces and tabs only, never line breaks.
3. **Splitting** (`parseTemplateText`): the text is cut at every match of
   `(<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)`, the delimiters kept as pieces of their own.
4. **Reading** (`scanLine`) each piece in order, with a `mode` and a `truncate` flag.

A tag opener must be followed, two pieces later, by a close delimiter (`%>`, `-%>`, `_%>`), or
compiling throws `Could not find matching close tag for "<%"`. An empty tag (`<%#%>`, `<%=%>`) has
no piece between, so it throws: an empty tag needs a blank (`<%# %>`).

## Splitting

The regular expression has no `g` flag: EJS runs it again on what is left after each match, so it
finds the **leftmost** delimiter, and at one position the **first alternative** that matches —
`<%%` before `<%`, `%%>` before `%>`. It does not know about tags: it splits a text, the code of a
tag and a comment alike. So:

- a `<%` in the code of a tag, even in a string or a comment, opens a tag. `<%- '<%' %>` throws.
  Write `'<' + '%'`, or `'<\x25'`;
- a `%>` in the code of a tag, even in a string, closes it;
- `<%>` splits as `<%` then `>`, an opener; `<%%>` as `<%%` then `>`; `%%%>` as `%` then `%%>`.

The slurp expressions run before the splitting and do not know about tags either: any `<%_` or `_%>`
in the raw text slurps, wherever it is — in the code of a tag, or overlapping two delimiters, as the
`_%>` of `<%_%>` (split as `<%_` then `%>`). The blanks they remove are gone before the splitting;
removing them never joins two pieces into a new delimiter, since they sit after a `>` or before a
`<`.

## Reading: the modes

`mode` is what the pieces are read as. Text is read with `mode` null; a tag sets it:

| Piece              | Sets `mode` to | Writes                                                |
| ------------------ | -------------- | ----------------------------------------------------- |
| `<%`, `<%_`        | `EVAL`         | the code following, as statements                     |
| `<%=`              | `ESCAPED`      | `__append(escapeFn(code))`                            |
| `<%-`              | `RAW`          | `__append(code)`                                      |
| `<%#`              | `COMMENT`      | nothing                                               |
| `<%%`              | `LITERAL`      | `<%`                                                  |
| `%%>`              | `LITERAL`      | `%>`                                                  |
| `%>`, `-%>`, `_%>` | null           | in `LITERAL`, the delimiter itself; otherwise nothing |
| any other piece    | (kept)         | in null or `LITERAL`, the text; in a tag, its code    |

The code of a tag is appended as `    ; <code>\n`: each tag is its own statement after a `;`. When
the code of a tag has `//` after its last line break, EJS appends a line break so that the comment
does not swallow what follows. An output tag's code has one trailing `;` removed (`stripSemi`):
`<%= a; %>` writes `a`.

### The literal mode

`<%%` and `%%>` are not just escapes: they write `<%` or `%>` **and enter `LITERAL`**, which lasts
until the next close delimiter, and which the next opener ends like any mode. In `LITERAL`, a close
delimiter is text: EJS writes it (`-%>` and `_%>` whole), then leaves the mode.

- `<%% a %>` renders `<% a %>`: the `%>` closes the literal mode and is written.
- Out of `LITERAL`, a close delimiter in a text (a **stray** close) is dropped: `a %> b` renders
  `a  b`. `%%>` writes one.
- `%%>` enters the mode too: `%%> a %> b` renders `%> a %> b` — the second `%>` is written, not
  dropped. `<%% a %> b %> c` renders `<% a %> b  c`: the first `%>` leaves the mode, the second is
  stray.
- A stray `-%>` or `_%>` is dropped and still truncates (below); `_%>` also slurps the blanks after
  it.

Inserting `<%%` or `%%>` into a text can so change how a `%>` further in the same text renders.

## Reading: the truncation

A close delimiter sets `truncate`: true for `-%>` and `_%>`, false for `%>`. It is used by
`_addOutput`, which writes a text: when `truncate` is set, it removes **one** line break
(`\r\n`, `\r` or `\n`) at the very start of the text, then clears `truncate`, whether a line break
was there or not.

- Only the very start: `-%>  \nx` keeps the blanks and the line break (`"  \nx"`). `_%>  \nx` drops
  both, the blanks by the slurp expression, the line break by the truncation.
- One line break: `<%= 1 -%>\n\nx` renders `1\nx`.
- The flag waits for the next text written: an opener does not clear it, but its close sets it anew
  (`<% -%><%= 1 %>\nx` renders `1\nx`).
- `<%%` and `%%>` write without `_addOutput`: they do not clear it. `<% -%><%%\nx%>` renders
  `<%x%>`, the line break after the `<%%` dropped.
- In `LITERAL`, a close delimiter is written by `_addOutput`, which clears it; then the delimiter
  sets it anew.

There is no slurping of the blanks before a `-%>`, nor of the line break before a `<%_`: `<%_`
slurps spaces and tabs before it on its line, `_%>` spaces and tabs after it, then its line break.

## The compiled function

The pieces become the body of `new Function(localsName, escapeFn, include, rethrow, src)`:

- `let __output = ""; function __append(s) { if (s !== undefined && s !== null) __output += s }`:
  `undefined` and `null` render nothing, anything else as `String` concatenation.
- `with (locals || {}) { ... }` around the body, unless `strict` (or `_with: false`): variables are
  read from the data. The data is copied to a null-prototype object (unless `unsafePrototypeLocals`).
- With `compileDebug` (the default), the body is in a `try`, and `; __line = N` is appended after
  every piece containing a line break, for the line of an error.
- `escapeFn` defaults to `escapeXML`: `&`, `<`, `>`, `"`, `'` encoded.
- `outputFunctionName` names `__append` for the code; `destructuredLocals` declares data fields as
  variables.

A JavaScript syntax error of the whole function throws at compile time, `... while compiling ejs`,
without the line of the template.
