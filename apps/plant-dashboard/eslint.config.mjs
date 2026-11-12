import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  { files: ['tailwind.config.js'], rules: { '@nx/enforce-module-boundaries': 'off' } },
];
