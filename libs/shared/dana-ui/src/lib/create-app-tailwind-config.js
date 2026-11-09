const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');
const sharedTailwindConfig = require('./tailwind.config');

/**
 * One Tailwind configuration factory for every Gear Apps Angular application.
 * Each app's tailwind.config.js should be a one-line call to this function.
 */
module.exports = function createGearAppTailwindConfig(appRoot) {
  return {
    presets: [sharedTailwindConfig],
    content: [
      join(appRoot, 'src/**/!(*.stories|*.spec).{ts,html}'),
      ...createGlobPatternsForDependencies(appRoot),
      join(appRoot, '../../libs/frontend/**/!(*.stories|*.spec).{ts,html}'),
    ],
  };
};
