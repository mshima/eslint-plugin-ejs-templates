# eslint-plugin-ejs-templates

Linting and parsing of [EJS](https://ejs.co/) (Embedded JavaScript) templates.

| Package                                                             | Description                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [eslint-plugin-ejs-templates](packages/eslint-plugin-ejs-templates) | An ESLint plugin: a processor and rules for EJS templates                                        |
| [ejs-template-parser](packages/ejs-template-parser)                 | The parser of the plugin: the tags of a template, their code, and the blocks they open and close |

## Development

The packages are npm workspaces. `npm install` at the root installs and builds them;
`npm test` checks the formatting, the lint, the tests and the types of all of them.

## License

[Apache 2.0](./LICENSE)
