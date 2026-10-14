# Changelog

## [0.6.0](https://github.com/mshima/eslint-plugin-ejs-templates/compare/v0.5.0...v0.6.0) (2026-10-14)

### ⚠ BREAKING CHANGES

- **eslint-plugin-ejs-templates:** ejs-templates/experimental-prefer-slurp-multiline is ejs-templates/prefer-slurp-multiline, on in customize() without experimental.
- **eslint-plugin-ejs-templates:** ejs-templates/indent is ejs-templates/indent-tag and ejs-templates/indent-content, its normalizeContent option turning the second one on or off.

### Features

- diagnostics of a template, its errors and the conventions of the plugin ([#116](https://github.com/mshima/eslint-plugin-ejs-templates/issues/116)) ([5783f5f](https://github.com/mshima/eslint-plugin-ejs-templates/commit/5783f5f46a044de3e54e899cdf01fa8be46dbca3))
- don't report no-global-function-call if the method is declared locally ([#104](https://github.com/mshima/eslint-plugin-ejs-templates/issues/104)) ([6eb09f7](https://github.com/mshima/eslint-plugin-ejs-templates/commit/6eb09f7162ea3e5a4cdd87e77b0d65a5d893a374))
- ejs-template-parser, the parser of the plugin as a package of its own ([d990df9](https://github.com/mshima/eslint-plugin-ejs-templates/commit/d990df95b9836d9523d194588380ed07486d67a5))
- **eslint-plugin-ejs-templates:** @stylistic/indent indents the lines of tags with indent-tag ([#173](https://github.com/mshima/eslint-plugin-ejs-templates/issues/173)) ([3bf8568](https://github.com/mshima/eslint-plugin-ejs-templates/commit/3bf8568b8cf97fe504e3c28113422467fa84edc4))
- **eslint-plugin-ejs-templates:** indent split into indent-tag and indent-content ([#171](https://github.com/mshima/eslint-plugin-ejs-templates/issues/171)) ([dffda1a](https://github.com/mshima/eslint-plugin-ejs-templates/commit/dffda1af6ff71bec52ad7203e2fc62256e9a3557))
- **eslint-plugin-ejs-templates:** no-one-sided-trim, a tag trims on both sides or on none ([#179](https://github.com/mshima/eslint-plugin-ejs-templates/issues/179)) ([73641f8](https://github.com/mshima/eslint-plugin-ejs-templates/commit/73641f8c4fc8f955448e564f9fc00219df2790a8))
- **eslint-plugin-ejs-templates:** prefer-slurp-multiline no longer experimental ([#175](https://github.com/mshima/eslint-plugin-ejs-templates/issues/175)) ([a927ad1](https://github.com/mshima/eslint-plugin-ejs-templates/commit/a927ad1ff99f9de1c2e210bef248a89aab3b6fe8))
- **eslint-plugin-ejs-templates:** the message of indent tells the indentation expected and written ([#136](https://github.com/mshima/eslint-plugin-ejs-templates/issues/136)) ([7e600e3](https://github.com/mshima/eslint-plugin-ejs-templates/commit/7e600e39b39ab17013f2924ec5e957ffd798c832))
- no-stray-close-delimiter and no-comment-across-tags, the errors of the parser in the plugin ([#127](https://github.com/mshima/eslint-plugin-ejs-templates/issues/127)) ([eb32c40](https://github.com/mshima/eslint-plugin-ejs-templates/commit/eb32c404cb8a96e9a6440d581b6ac4f3397763e0))
- type the syntax error of the parser, diagnose a template text in one call ([#121](https://github.com/mshima/eslint-plugin-ejs-templates/issues/121)) ([640c78a](https://github.com/mshima/eslint-plugin-ejs-templates/commit/640c78a891e9931eb848c41fafe17a875b2e56aa))

### Bug Fixes

- **ejs-template-parser:** count the braces of a tag from its tokens ([#133](https://github.com/mshima/eslint-plugin-ejs-templates/issues/133)) ([2b3fc07](https://github.com/mshima/eslint-plugin-ejs-templates/commit/2b3fc07dc9aecd193882a06e7f44bb24d471c202))
- **eslint-plugin-ejs-templates:** an unused directive is removed with what its tag drops ([#134](https://github.com/mshima/eslint-plugin-ejs-templates/issues/134)) ([b35b1c5](https://github.com/mshima/eslint-plugin-ejs-templates/commit/b35b1c5cd39df2e8ba3c949a9716a02967b24e82))
- **eslint-plugin-ejs-templates:** an unused eslint-disable-next-line fixes its comment tag alone ([#119](https://github.com/mshima/eslint-plugin-ejs-templates/issues/119)) ([13c5df9](https://github.com/mshima/eslint-plugin-ejs-templates/commit/13c5df9d977d5c01d8f05af3d8250eb7124dba30))
- **eslint-plugin-ejs-templates:** indent rewrites the line of a tag alone on it only ([#132](https://github.com/mshima/eslint-plugin-ejs-templates/issues/132)) ([651e163](https://github.com/mshima/eslint-plugin-ejs-templates/commit/651e163a6d424361336e8a774b8a2f7905e44397))
- **eslint-plugin-ejs-templates:** no-multiline-output keeps the close delimiter of its tag ([#141](https://github.com/mshima/eslint-plugin-ejs-templates/issues/141)) ([0fba6a7](https://github.com/mshima/eslint-plugin-ejs-templates/commit/0fba6a7a0fb4e38b64fcc149cbb96998bfb1db09))
- **eslint-plugin-ejs-templates:** no-negated-condition swaps delimiters too; fixes use editTemplate ([#138](https://github.com/mshima/eslint-plugin-ejs-templates/issues/138)) ([d2d8aea](https://github.com/mshima/eslint-plugin-ejs-templates/commit/d2d8aea0391a1097b1d24a479270bbe1fb702ad6))
- **eslint-plugin-ejs-templates:** the end of a message mapped to the template, columns 1-based ([#153](https://github.com/mshima/eslint-plugin-ejs-templates/issues/153)) ([6e7e079](https://github.com/mshima/eslint-plugin-ejs-templates/commit/6e7e0793b861f07d13a44e75efc20522971a36d5))
- **eslint-plugin-ejs-templates:** the first line of a tag at its column in the virtual code ([#170](https://github.com/mshima/eslint-plugin-ejs-templates/issues/170)) ([550a6e4](https://github.com/mshima/eslint-plugin-ejs-templates/commit/550a6e46de1a59e4d012a3ff14777bc79ff16eb2))
- **eslint-plugin-ejs-templates:** the prefer-output fix renders as before ([#128](https://github.com/mshima/eslint-plugin-ejs-templates/issues/128)) ([821bdf1](https://github.com/mshima/eslint-plugin-ejs-templates/commit/821bdf10938ec62cd22852b8be8d575414ea1d06))
- indent accepts a right operand indented more than its expression ([#169](https://github.com/mshima/eslint-plugin-ejs-templates/issues/169)) ([d682dda](https://github.com/mshima/eslint-plugin-ejs-templates/commit/d682dda7b438378c66df2ac0b0dcc34f4a440652))

### Performance Improvements

- **ejs-template-parser:** tags read in the program, parsed alone only when their tree is read ([#147](https://github.com/mshima/eslint-plugin-ejs-templates/issues/147)) ([951c1a4](https://github.com/mshima/eslint-plugin-ejs-templates/commit/951c1a4e666264be123e6f23d9ccf79693adb70e))
- **eslint-plugin-ejs-templates:** the virtual JavaScript of a template is linted once ([#142](https://github.com/mshima/eslint-plugin-ejs-templates/issues/142)) ([0246a35](https://github.com/mshima/eslint-plugin-ejs-templates/commit/0246a359b94470f6ec717919e2f574cdb791f2ce))

### Reverts

- prefer-output and no-multiline-output edit by editTemplate ([#165](https://github.com/mshima/eslint-plugin-ejs-templates/issues/165)) ([d8c03fd](https://github.com/mshima/eslint-plugin-ejs-templates/commit/d8c03fd773eaf45eab7480798db43b2a4043c676))

## [0.5.0](https://github.com/mshima/eslint-plugin-ejs-templates/compare/v0.4.7...v0.5.0) (2026-08-29)

### ⚠ BREAKING CHANGES

- `ejs-templates/no-output-negated-ternary` and its earlier name `ejs-templates/no-output-negated-condition` are removed. A config naming either now fails to load with `Could not find "no-output-negated-ternary" in plugin "ejs-templates"`. Replace it with the built-in `no-negated-condition`, which this plugin autofixes. The rule was off by default, so only explicit opt-ins are affected.

### Features

- add no-multiline-output rule ([#95](https://github.com/mshima/eslint-plugin-ejs-templates/issues/95)) ([e0e3d47](https://github.com/mshima/eslint-plugin-ejs-templates/commit/e0e3d47862dd39ebb590e919ac4bd7d3f4cf279f))
- autofix negated conditions on else if links ([#100](https://github.com/mshima/eslint-plugin-ejs-templates/issues/100)) ([38f8a5a](https://github.com/mshima/eslint-plugin-ejs-templates/commit/38f8a5a007e8e688641bc5ae414650a8ea82ea50))
- autofix negated ternaries wherever they appear in a tag ([#102](https://github.com/mshima/eslint-plugin-ejs-templates/issues/102)) ([5f91486](https://github.com/mshima/eslint-plugin-ejs-templates/commit/5f91486fecdea41404678f88e57c14ff2c8d0435))
- implement no-negated-condition rule autofix ([#92](https://github.com/mshima/eslint-plugin-ejs-templates/issues/92)) ([0bc5ad0](https://github.com/mshima/eslint-plugin-ejs-templates/commit/0bc5ad01b9ebced7f11c29266bdcff548383b2db))
- improve runtime speed by storing context ([#89](https://github.com/mshima/eslint-plugin-ejs-templates/issues/89)) ([4d52c62](https://github.com/mshima/eslint-plugin-ejs-templates/commit/4d52c6237bc1b84a491c195cc8e2bd160648f0ab))
- remove no-output-negated-ternary, fix ternaries via the built-… ([#96](https://github.com/mshima/eslint-plugin-ejs-templates/issues/96)) ([2d15b39](https://github.com/mshima/eslint-plugin-ejs-templates/commit/2d15b3902441c20791e6b591ba765cd0e610ab37))
- rename blacklist to blocklist ([#87](https://github.com/mshima/eslint-plugin-ejs-templates/issues/87)) ([2716785](https://github.com/mshima/eslint-plugin-ejs-templates/commit/2716785969a4732e139f3ed1515a9ec6623bca6c))
- split single-line tags that close more than one block ([#103](https://github.com/mshima/eslint-plugin-ejs-templates/issues/103)) ([f66bf60](https://github.com/mshima/eslint-plugin-ejs-templates/commit/f66bf606d8ea8405b3c0b0b0ec37901d8e7c95e6))

### Bug Fixes

- apply output-semi to multiline output tags ([#98](https://github.com/mshima/eslint-plugin-ejs-templates/issues/98)) ([4818307](https://github.com/mshima/eslint-plugin-ejs-templates/commit/4818307cc11943b2d611449ff3d80a3c517562b4))
- keep the \_%&gt; close delimiter on output tags ([f669638](https://github.com/mshima/eslint-plugin-ejs-templates/commit/f6696387bca1fcf1f8cac3ceeeca167df1617f28))
- stop the synthetic semicolon leaking into semicolon rules ([#101](https://github.com/mshima/eslint-plugin-ejs-templates/issues/101)) ([f4512b0](https://github.com/mshima/eslint-plugin-ejs-templates/commit/f4512b03f7f103753cc4437a45e799d65b000525))
- workaround slurp close tag with output directive ([#68](https://github.com/mshima/eslint-plugin-ejs-templates/issues/68)) ([f669638](https://github.com/mshima/eslint-plugin-ejs-templates/commit/f6696387bca1fcf1f8cac3ceeeca167df1617f28))

## [0.4.7](https://github.com/mshima/eslint-plugin-ejs-templates/compare/v0.4.6...v0.4.7) (2026-06-22)

### Bug Fixes

- don't format content inside balanced braces in prefer-single-lin… ([#69](https://github.com/mshima/eslint-plugin-ejs-templates/issues/69)) ([627e022](https://github.com/mshima/eslint-plugin-ejs-templates/commit/627e022d37e7d1f8896af437858f1a1ee7230962))
- don't format content inside balanced braces in prefer-single-line-tags ([627e022](https://github.com/mshima/eslint-plugin-ejs-templates/commit/627e022d37e7d1f8896af437858f1a1ee7230962))
- format every tag with single line content ([8ed5cb6](https://github.com/mshima/eslint-plugin-ejs-templates/commit/8ed5cb6b2680a41a41408d3dfb30b7c78e1baa69))
- format every tag with single line content in a single line ([#77](https://github.com/mshima/eslint-plugin-ejs-templates/issues/77)) ([8ed5cb6](https://github.com/mshima/eslint-plugin-ejs-templates/commit/8ed5cb6b2680a41a41408d3dfb30b7c78e1baa69))

## [0.4.6](https://github.com/mshima/eslint-plugin-ejs-templates/compare/v0.4.5...v0.4.6) (2026-05-27)

### Bug Fixes

- keep basic close delimiter on same line ([#75](https://github.com/mshima/eslint-plugin-ejs-templates/issues/75)) ([eb8dd5d](https://github.com/mshima/eslint-plugin-ejs-templates/commit/eb8dd5d4b516e5eaca1d9e43a2df4856a62c3844))

## [0.4.5](https://github.com/mshima/eslint-plugin-ejs-templates/compare/v0.4.4...v0.4.5) (2026-05-26)

### Bug Fixes

- fix comments extraction ([#73](https://github.com/mshima/eslint-plugin-ejs-templates/issues/73)) ([ccd6bf1](https://github.com/mshima/eslint-plugin-ejs-templates/commit/ccd6bf104bfa8ccb7ab85ceb054d53e36b6c750b))

## [0.4.4](https://github.com/mshima/eslint-plugin-ejs-templates/compare/v0.4.3...v0.4.4) (2026-05-25)

### Bug Fixes

- add no-output-negated-ternary rule ([#71](https://github.com/mshima/eslint-plugin-ejs-templates/issues/71)) ([c174ba7](https://github.com/mshima/eslint-plugin-ejs-templates/commit/c174ba7a244f4eeb65d7218f97d194445de855f0))
