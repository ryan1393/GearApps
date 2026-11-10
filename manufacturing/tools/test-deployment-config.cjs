const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../../apps/server/tsconfig.app.json');
// The server's path aliases belong to the single repository workspace.
process.env.TS_NODE_BASEURL = path.resolve(__dirname, '../..');
process.env.TS_NODE_TRANSPILE_ONLY = '1';
require('ts-node/register');require('tsconfig-paths/register');
const { validationSchema } = require('../libs/server/util-common/src/lib/config/schema.ts');
const example = Object.fromEntries(fs.readFileSync(path.join(__dirname, '../../.env.example'), 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => { const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1).replace(/^["']|["']$/g,'')]; }));
const validate = values => validationSchema.validate(values, { allowUnknown: true, abortEarly: false });
test('documented example allows optional Sentry to be disabled',()=>{assert.equal(example.SENTRY_DSN,'');assert.equal(validate(example).error,undefined)});
test('Sentry may be omitted or configured',()=>{const omitted={...example};delete omitted.SENTRY_DSN;assert.equal(validate(omitted).error,undefined);assert.equal(validate({...example,SENTRY_DSN:'https://example.test/sentry'}).error,undefined)});
test('empty required JWT secrets still fail validation',()=>assert.ok(validate({...example,JWT_ACCESS_SECRET:''}).error));
test('password recovery origin defaults to Blade Tracking',()=>{const values={...example};delete values.PUBLIC_WEB_BASE_URL;assert.equal(validate(values).value.PUBLIC_WEB_BASE_URL,'http://localhost:4200')});
test('public HTTPS and explicit local ports are supported',()=>{for(const value of ['https://gear.example.test','https://gear.example.test/','http://127.0.0.1:4201'])assert.equal(validate({...example,PUBLIC_WEB_BASE_URL:value}).error,undefined)});
test('recovery configuration rejects non-origin and unsafe URL forms',()=>{for(const value of ['ftp://gear.example.test','https://user:password@gear.example.test','https://gear.example.test/path','https://gear.example.test/?q=1','https://gear.example.test/#fragment','bad'])assert.ok(validate({...example,PUBLIC_WEB_BASE_URL:value}).error,value)});
