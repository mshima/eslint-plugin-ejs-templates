# Changelog

## [0.5.0](https://github.com/mshima/eslint-plugin-ejs-templates/compare/v0.4.7...v0.5.0) (2026-08-29)


### ⚠ BREAKING CHANGES

* `ejs-templates/no-output-negated-ternary` and its earlier name `ejs-templates/no-output-negated-condition` are removed. A config naming either now fails to load with `Could not find "no-output-negated-ternary" in plugin "ejs-templates"`. Replace it with the built-in `no-negated-condition`, which this plugin autofixes. The rule was off by default, so only explicit opt-ins are affected.

### Features

* add no-multiline-output rule ([#95](https://github.com/mshima/eslint-plugin-ejs-templates/issues/95)) ([e0e3d47](https://github.com/mshima/eslint-plugin-ejs-templates/commit/e0e3d47862dd39ebb590e919ac4bd7d3f4cf279f))
* autofix negated conditions on else if links ([#100](https://github.com/mshima/eslint-plugin-ejs-templates/issues/100)) ([38f8a5a](https://github.com/mshima/eslint-plugin-ejs-templates/commit/38f8a5a007e8e688641bc5ae414650a8ea82ea50))
* autofix negated ternaries wherever they appear in a tag ([#102](https://github.com/mshima/eslint-plugin-ejs-templates/issues/102)) ([5f91486](https://github.com/mshima/eslint-plugin-ejs-templates/commit/5f91486fecdea41404678f88e57c14ff2c8d0435))
* implement no-negated-condition rule autofix ([#92](https://github.com/mshima/eslint-plugin-ejs-templates/issues/92)) ([0bc5ad0](https://github.com/mshima/eslint-plugin-ejs-templates/commit/0bc5ad01b9ebced7f11c29266bdcff548383b2db))
* improve runtime speed by storing context ([#89](https://github.com/mshima/eslint-plugin-ejs-templates/issues/89)) ([4d52c62](https://github.com/mshima/eslint-plugin-ejs-templates/commit/4d52c6237bc1b84a491c195cc8e2bd160648f0ab))
* remove no-output-negated-ternary, fix ternaries via the built-… ([#96](https://github.com/mshima/eslint-plugin-ejs-templates/issues/96)) ([2d15b39](https://github.com/mshima/eslint-plugin-ejs-templates/commit/2d15b3902441c20791e6b591ba765cd0e610ab37))
* rename blacklist to blocklist ([#87](https://github.com/mshima/eslint-plugin-ejs-templates/issues/87)) ([2716785](https://github.com/mshima/eslint-plugin-ejs-templates/commit/2716785969a4732e139f3ed1515a9ec6623bca6c))
* split single-line tags that close more than one block ([#103](https://github.com/mshima/eslint-plugin-ejs-templates/issues/103)) ([f66bf60](https://github.com/mshima/eslint-plugin-ejs-templates/commit/f66bf606d8ea8405b3c0b0b0ec37901d8e7c95e6))


### Bug Fixes

* apply output-semi to multiline output tags ([#98](https://github.com/mshima/eslint-plugin-ejs-templates/issues/98)) ([4818307](https://github.com/mshima/eslint-plugin-ejs-templates/commit/4818307cc11943b2d611449ff3d80a3c517562b4))
* keep the _%&gt; close delimiter on output tags ([f669638](https://github.com/mshima/eslint-plugin-ejs-templates/commit/f6696387bca1fcf1f8cac3ceeeca167df1617f28))
* stop the synthetic semicolon leaking into semicolon rules ([#101](https://github.com/mshima/eslint-plugin-ejs-templates/issues/101)) ([f4512b0](https://github.com/mshima/eslint-plugin-ejs-templates/commit/f4512b03f7f103753cc4437a45e799d65b000525))
* workaround slurp close tag with output directive ([#68](https://github.com/mshima/eslint-plugin-ejs-templates/issues/68)) ([f669638](https://github.com/mshima/eslint-plugin-ejs-templates/commit/f6696387bca1fcf1f8cac3ceeeca167df1617f28))

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
