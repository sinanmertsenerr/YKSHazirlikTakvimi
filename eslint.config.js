const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['assets/pack/**', 'coverage/**', 'dist/**', 'ios/**', 'android/**'],
    rules: {
      'import/order': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
