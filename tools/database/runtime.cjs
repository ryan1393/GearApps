const path = require('node:path');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../../apps/lapper-api/tsconfig.app.json');
process.env.TS_NODE_BASEURL = path.resolve(__dirname, '../..');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('reflect-metadata');
require('ts-node/register');
require('tsconfig-paths/register');
const { DataSource } = require('typeorm');
function databaseSource() {
  for (const key of [
    'DATABASE_HOST',
    'DATABASE_PORT',
    'DATABASE_USERNAME',
    'DATABASE_PASSWORD',
    'DATABASE_NAME',
  ])
    if (!process.env[key]) throw new Error('Missing ' + key);
  return new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
    entities: [],
    synchronize: false,
    logging: false,
    applicationName: 'gearapps-database-maintenance',
    connectTimeoutMS: 5000,
  });
}
module.exports = { databaseSource };
