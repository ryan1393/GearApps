const { join } = require('node:path');
const sharedTailwindConfig = require('../../../libs/shared/dana-ui/src/tailwind/tailwind-preset.cjs');
module.exports = function createGearAppTailwindConfig(appRoot) {
  return { presets: [sharedTailwindConfig], content: [
    join(appRoot, 'src/**/!(*.stories|*.spec).{ts,html}'),
    join(appRoot, '../../libs/manufacturing/frontend/**/!(*.stories|*.spec).{ts,html}'),
    join(appRoot, '../../libs/shared/dana-ui/src/**/*.{ts,html}'),
  ] };
};
