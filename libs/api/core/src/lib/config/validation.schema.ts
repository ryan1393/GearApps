import * as Joi from 'joi';

const requiredUnlessSqlite = (schema: Joi.Schema) =>
  Joi.when('DATABASE_TYPE', {
    is: 'better-sqlite3',
    then: Joi.optional(),
    otherwise: schema.required(),
  });

export const validationSchema = Joi.object({
  HOST: Joi.string().default('0.0.0.0'),
  PORT: Joi.number().default(3333),
  ENVIRONMENT: Joi.string().valid('development', 'test', 'production').default('development'),
  CORS_ORIGINS: Joi.string().allow('').optional(),
  SWAGGER_ENABLED: Joi.boolean().default(true),

  DATABASE_TYPE: Joi.string().valid('mssql', 'better-sqlite3').default('better-sqlite3'),
  DATABASE_HOST: requiredUnlessSqlite(Joi.string()),
  DATABASE_PORT: requiredUnlessSqlite(Joi.number()),
  DATABASE_USERNAME: requiredUnlessSqlite(Joi.string()),
  DATABASE_PASSWORD: requiredUnlessSqlite(Joi.string()),
  DATABASE_NAME: requiredUnlessSqlite(Joi.string()),
  DATABASE_INSTANCE: Joi.string().optional(),
  DATABASE_PATH: Joi.string().default('tmp/gearapps.sqlite'),
  DATABASE_SYNCHRONIZE: Joi.boolean().default(false),
  DATABASE_LOGGING_ENABLED: Joi.boolean().default(false),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TOKEN_EXPIRES_IN: Joi.string().default('10h'),

  SCANNER_DEFAULT_HOST: Joi.string().allow('').optional(),
  SCANNER_ALLOW_INSECURE_TLS: Joi.boolean().default(true),
  SCANNER_TIMEOUT_MS: Joi.number().default(4000),
  SCANNER_FTP_HOST: Joi.string().allow('').optional(),
  SCANNER_FTP_USER: Joi.string().allow('').optional(),
  SCANNER_FTP_PASSWORD: Joi.string().allow('').optional(),
  SCANNER_FTP_ROOT: Joi.string().default('181-lapper-scanners'),
  SCANNER_FTP_IMAGE_FILE: Joi.string().default('scanner-current.jpg'),
}).unknown(true);
