const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('node:path');

module.exports = {
  mode: 'none',
  output: {
    path: join(__dirname, '../../dist/apps/truck-log-server'),
    filename: 'src/main.js',
    clean: true,
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      outputHashing: 'none',
      optimization: false,
      sourceMap: true,
      generatePackageJson: false,
      externalDependencies: 'all',
      buildLibsFromSource: true,
    }),
  ],
};
