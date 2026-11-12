import nx from '@nx/eslint-plugin';
import baseConfig from '../../../../eslint.config.mjs';

export default [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  { files: ['**/*.ts'], rules: { '@nx/enforce-module-boundaries': ['error', { enforceBuildableLibDependency: true, depConstraints: [{ sourceTag: 'type:feature', onlyDependOnLibsWithTags: ["type:data-access", "type:util", "type:domain", "type:ui"], notDependOnLibsWithTags: ['scope:server', 'type:app'] }] }] } },
];
