import baseConfig from '../../../../eslint.config.mjs';

export default [
  ...baseConfig,
  { files: ['**/*.ts'], rules: { '@nx/enforce-module-boundaries': ['error', { enforceBuildableLibDependency: true, depConstraints: [{ sourceTag: 'type:data-access', onlyDependOnLibsWithTags: ["type:data-access", "type:domain"], notDependOnLibsWithTags: ['scope:server', 'type:app'] }] }] } },
];
