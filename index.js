'use strict';

const { parse } = require('./src/parser');
const { print } = require('./src/printer');

/** @type {import('prettier').Plugin} */
const plugin = {
  languages: [
    {
      name: 'EJS',
      parsers: ['ejs'],
      extensions: ['.ejs'],
      vscodeLanguageIds: ['html'],
    },
  ],

  parsers: {
    ejs: {
      parse(text) {
        return parse(text);
      },
      astFormat: 'ejs-ast',
      locStart(node) {
        return node.start ?? 0;
      },
      locEnd(node) {
        return node.end ?? 0;
      },
    },
  },

  printers: {
    'ejs-ast': {
      print,
    },
  },

  options: {
    tabWidth: {
      category: 'Global',
      type: 'int',
      default: 2,
      description: 'Number of spaces per indentation level.',
    },
  },
};

module.exports = plugin;
