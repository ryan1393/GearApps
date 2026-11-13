import * as Handlebars from 'handlebars';
import * as fs from 'node:fs';
import { createTransport, SendMailOptions, Transporter } from 'nodemailer';
import * as path from 'path';

import { mailerConfig } from '@meshforge/manufacturing/server/util-common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { IBaseEmailContext } from '../templates/contexts';

import SMTPTransport = require('nodemailer/lib/smtp-transport');

/**
 * SMTP transport options. The mail conversation is logged only when EMAIL_DEBUG is true, and
 * even then nodemailer logs commands and byte counts, never message bodies (reset links).
 */
export function mailTransportOptions(
  cfg: Pick<ConfigType<typeof mailerConfig>, 'host' | 'port' | 'ignoreTls' | 'secure' | 'requireTls' | 'user' | 'password' | 'debug'>,
): SMTPTransport.Options {
  return {
    host: cfg.host,
    port: cfg.port,
    ignoreTLS: cfg.ignoreTls,
    secure: cfg.secure,
    requireTLS: cfg.requireTls,
    auth: {
      user: cfg.user,
      pass: cfg.password,
    },
    debug: cfg.debug === true,
    logger: cfg.debug === true,
  };
}

@Injectable()
export class ServerUtilMailerService {
  private readonly transporter!: Transporter;
  private logger = new Logger('MailerService');

  constructor(
    @Inject(mailerConfig.KEY)
    private readonly cfgService: ConfigType<typeof mailerConfig>,
  ) {
    if (cfgService.enabled) {
      this.logger.debug(`Configuring nodemailer`);
      this.transporter = createTransport(mailTransportOptions(cfgService));
      this.registerPartials(cfgService.partialsDir);
    } else {
      this.logger.debug(`nodemailer is disabled, skipping configuration`);
    }
  }

  get enabled(): boolean {
    return this.cfgService.enabled;
  }

  async sendAttachment(options: SendMailOptions): Promise<{ accepted?: string[]; rejected?: string[] }> {
    if (!this.enabled) throw new Error('Email is disabled.');
    return this.transporter.sendMail({
      ...options,
      from: options.from ?? `"${this.cfgService.defaultName}" <${this.cfgService.defaultEmail}>`,
    });
  }

  async sendMail({
    templatePath,
    context,
    ...mailOptions
  }: SendMailOptions & {
    templatePath: string;
    context: Record<string, unknown> | IBaseEmailContext;
  }): Promise<void> {
    let html: string | undefined;
    if (templatePath) {
      try {
        const resolvedTemplatePath = path.isAbsolute(templatePath)
          ? templatePath
          : path.join(this.cfgService.templateDir, templatePath);
        const template = fs.readFileSync(resolvedTemplatePath, 'utf-8');
        html = Handlebars.compile(template, {
          strict: true,
        })(context);
      } catch (err) {
        this.logger.error(`Error while registering email template`, err);
      }
    }

    await this.transporter?.sendMail({
      ...mailOptions,
      from: mailOptions.from
        ? mailOptions.from
        : `"${this.cfgService.defaultName}" <${this.cfgService.defaultEmail}>`,
      html: mailOptions.html ? mailOptions.html : html,
    });
  }

  isValidPartial(file: string) {
    const ext = path.extname(file);
    return ext === '.hbs';
  }

  registerPartials(partialsDir: string) {
    const partials = fs
      .readdirSync(partialsDir)
      .filter(this.isValidPartial)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .reduce((res: { [name: string]: any }, curr) => {
        const ext = path.extname(curr);
        const partialPath = path.join(partialsDir, curr);
        const partialFile = fs.readFileSync(partialPath, 'utf-8');
        const partialName = path.basename(curr, ext);
        res[partialName] = partialFile;
        return res;
      }, {});

    this.logger.debug(
      `Registering all found partials: ${Object.keys(partials).join(', ')}`,
    );
    Handlebars.registerPartial(partials);
  }
}
