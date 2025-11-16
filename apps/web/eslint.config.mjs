import eslintConfigNext from 'eslint-config-next';

/** @type {import('eslint').Linter.FlatConfig[]} */
const config = [
  ...eslintConfigNext(),
];

export default config;
