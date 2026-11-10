const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('node:path');

module.exports = {
  output: { path: join(__dirname, '../../dist/apps/server-bootstrap'), clean: true },
  plugins: [new NxAppWebpackPlugin({
    target: 'node', compiler: 'tsc', main: './src/fresh-db-bootstrap.ts',
    tsConfig: './tsconfig.app.json', assets: ['./src/assets'],
    optimization: false, outputHashing: 'none', outputFileName: 'main.js',
    generatePackageJson: false, sourceMap: true,
  })],
};
