# Changelog

## [0.2.0](https://github.com/mshima/eslint-plugin-ejs-templates/compare/ejs-template-parser-v0.1.1...ejs-template-parser-v0.2.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- **eslint-plugin-ejs-templates:** ejs-templates/indent is ejs-templates/indent-tag and ejs-templates/indent-content, its normalizeContent option turning the second one on or off.
- **ejs-template-parser:** parseJavaScriptPartial is no longer exported. The code of a tag, with its braces, nodes and statements, is the javascript of the tags getEjsTags and buildTemplate give.

### Features

- **ejs-template-parser:** fixOf indents the lines of a tag where it is ([#172](https://github.com/mshima/eslint-plugin-ejs-templates/issues/172)) ([191167d](https://github.com/mshima/eslint-plugin-ejs-templates/commit/191167d04cc0f0fa1584baae036200cad668c70c))
- **ejs-template-parser:** fixOf, the fix of a convention of a tag ([#160](https://github.com/mshima/eslint-plugin-ejs-templates/issues/160)) ([7fce484](https://github.com/mshima/eslint-plugin-ejs-templates/commit/7fce484b797c2ca5edc03ee3c25906f3ba23e1f1))
- **eslint-plugin-ejs-templates:** indent split into indent-tag and indent-content ([#171](https://github.com/mshima/eslint-plugin-ejs-templates/issues/171)) ([dffda1a](https://github.com/mshima/eslint-plugin-ejs-templates/commit/dffda1af6ff71bec52ad7203e2fc62256e9a3557))

### Bug Fixes

- **ejs-template-parser:** editTemplate keeps what a tag written in place of one slurps again ([#159](https://github.com/mshima/eslint-plugin-ejs-templates/issues/159)) ([0d9c751](https://github.com/mshima/eslint-plugin-ejs-templates/commit/0d9c751df6f4b6b7a4636d5ed1d00aca964852e9))
- indent accepts a right operand indented more than its expression ([#169](https://github.com/mshima/eslint-plugin-ejs-templates/issues/169)) ([d682dda](https://github.com/mshima/eslint-plugin-ejs-templates/commit/d682dda7b438378c66df2ac0b0dcc34f4a440652))

### Performance Improvements

- **ejs-template-parser:** editTemplate costs what an edit writes again ([#166](https://github.com/mshima/eslint-plugin-ejs-templates/issues/166)) ([c742f50](https://github.com/mshima/eslint-plugin-ejs-templates/commit/c742f50a9e6064c39e7f8984191cf1c193470ff7))
- **ejs-template-parser:** nodes and renderings computed when read, diagnostics walks pruned ([#144](https://github.com/mshima/eslint-plugin-ejs-templates/issues/144)) ([bc5dacd](https://github.com/mshima/eslint-plugin-ejs-templates/commit/bc5dacd0852e377dac55a36d8d088e7f251feaef))
- **ejs-template-parser:** tags read in the program, parsed alone only when their tree is read ([#147](https://github.com/mshima/eslint-plugin-ejs-templates/issues/147)) ([951c1a4](https://github.com/mshima/eslint-plugin-ejs-templates/commit/951c1a4e666264be123e6f23d9ccf79693adb70e))
- **ejs-template-parser:** the program of a template parsed once, no tag parsed again in context ([#146](https://github.com/mshima/eslint-plugin-ejs-templates/issues/146)) ([8d2f92c](https://github.com/mshima/eslint-plugin-ejs-templates/commit/8d2f92c04093202e3f7c978e2bf995e2e5e61af4))

### Code Refactoring

- **ejs-template-parser:** parseJavaScriptPartial removed, which nothing uses ([#151](https://github.com/mshima/eslint-plugin-ejs-templates/issues/151)) ([1f1b3fb](https://github.com/mshima/eslint-plugin-ejs-templates/commit/1f1b3fb49fbc15ea666e7bebee9b81289a9ddc31))

## [0.1.1](https://github.com/mshima/eslint-plugin-ejs-templates/compare/ejs-template-parser-v0.1.0...ejs-template-parser-v0.1.1) (2026-10-13)

### Features

- diagnostics of a template, its errors and the conventions of the plugin ([#116](https://github.com/mshima/eslint-plugin-ejs-templates/issues/116)) ([5783f5f](https://github.com/mshima/eslint-plugin-ejs-templates/commit/5783f5f46a044de3e54e899cdf01fa8be46dbca3))
- **ejs-template-parser:** editTemplate edits a built template, diagnosing its errors when read ([#137](https://github.com/mshima/eslint-plugin-ejs-templates/issues/137)) ([98a796e](https://github.com/mshima/eslint-plugin-ejs-templates/commit/98a796e9da84d24cc0cf197b012743689bf6e66b))
- **ejs-template-parser:** editTemplate, edits of a template the rest of which renders as before ([#135](https://github.com/mshima/eslint-plugin-ejs-templates/issues/135)) ([86c193c](https://github.com/mshima/eslint-plugin-ejs-templates/commit/86c193c1627fd6d2dda1d358d4aba97025132320))
- escapeText, a text to insert in a template that EJS renders literally ([#123](https://github.com/mshima/eslint-plugin-ejs-templates/issues/123)) ([b6a73b4](https://github.com/mshima/eslint-plugin-ejs-templates/commit/b6a73b46e6e5c4bf92d0bb12b73b11699a8c441c))
- type the syntax error of the parser, diagnose a template text in one call ([#121](https://github.com/mshima/eslint-plugin-ejs-templates/issues/121)) ([640c78a](https://github.com/mshima/eslint-plugin-ejs-templates/commit/640c78a891e9931eb848c41fafe17a875b2e56aa))
- what EJS renders of each text of a template, and where it comes from ([#122](https://github.com/mshima/eslint-plugin-ejs-templates/issues/122)) ([74324d2](https://github.com/mshima/eslint-plugin-ejs-templates/commit/74324d27cb95e74fa7943d2a30aeaab6472f8942))

### Bug Fixes

- **ejs-template-parser:** count the braces of a tag from its tokens ([#133](https://github.com/mshima/eslint-plugin-ejs-templates/issues/133)) ([2b3fc07](https://github.com/mshima/eslint-plugin-ejs-templates/commit/2b3fc07dc9aecd193882a06e7f44bb24d471c202))

## 0.1.0 (2026-10-13)

### Features

- ejs-template-parser, the parser of the plugin as a package of its own ([d990df9](https://github.com/mshima/eslint-plugin-ejs-templates/commit/d990df95b9836d9523d194588380ed07486d67a5))
