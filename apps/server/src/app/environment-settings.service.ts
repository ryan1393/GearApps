import {
  encryptEnvironmentValue,
  ENVIRONMENT_SETTING_GROUPS,
  ENVIRONMENT_SETTINGS_TABLE_SQL,
  EnvironmentSettingDefinition,
  environmentProblems,
  environmentSetting,
  environmentStartupState,
  EnvironmentValues,
  environmentWithDefaults,
  readEnvironmentOverlay,
  StoredEnvironmentSetting,
} from '@gearapps/manufacturing/server/util-common';
import { STARTUP_SCHEMA_LOCK_SQL } from '@gearapps/manufacturing/shared/util-constants';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { EnvironmentSettingChangeDto } from './environment-settings.dto';

interface SavedRow extends StoredEnvironmentSetting {
  updated_at: string;
}

const MAX_LENGTH = 2000;
// How long the reply to a restart request has to leave before the API stops.
const RESTART_DELAY_MS = 750;

/**
 * Admin > Server Settings. Values saved here are kept in the database and laid over the server
 * environment when the API starts (see load-saved-settings.ts), so a save never changes the
 * running API: the page reports that a restart is needed until one has happened.
 */
@Injectable()
export class EnvironmentSettingsService implements OnModuleInit {
  private readonly logger = new Logger(EnvironmentSettingsService.name);
  private schemaReady = false;
  private environmentDefaults: EnvironmentValues | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    if (this.dataSource.options?.type !== 'postgres') return;
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.query(STARTUP_SCHEMA_LOCK_SQL);
        await manager.query(ENVIRONMENT_SETTINGS_TABLE_SQL);
      });
      this.schemaReady = true;
    } catch (error) {
      this.logger.error(`Server settings table is not available: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async board() {
    const rows = await this.savedRows();
    const overlay = readEnvironmentOverlay(rows, this.signingSecret());
    const updatedAt = new Map(rows.map((row) => [row.key, row.updated_at]));
    const { applied } = environmentStartupState();
    const environment = this.environmentValues();
    let restartRequired = false;

    const groups = ENVIRONMENT_SETTING_GROUPS.map((group) => ({
      id: group.id,
      title: group.title,
      description: group.description,
      settings: group.settings.map((setting) => {
        const saved = Object.hasOwn(overlay.values, setting.key);
        const environmentValue = environment[setting.key] ?? '';
        const value = saved ? overlay.values[setting.key] : environmentValue;
        // Saved values take effect at startup, so anything saved or removed since then is waiting.
        const pending = overlay.values[setting.key] !== applied[setting.key];
        if (pending) restartRequired = true;
        return {
          key: setting.key,
          label: setting.label,
          help: setting.help ?? null,
          type: setting.type,
          options: setting.options ?? null,
          secret: !!setting.secret,
          editable: !setting.locked,
          locked_reason: setting.locked ?? null,
          // A secret is never sent to the browser; only whether one is set.
          value: setting.secret ? null : value,
          is_set: value !== '',
          source: saved ? 'ADMIN' : 'ENVIRONMENT',
          environment_value: setting.secret ? null : environmentValue,
          environment_is_set: environmentValue !== '',
          pending,
          // Saved, but encrypted with an access-token secret that has since been changed.
          unreadable: !setting.locked && overlay.skipped.includes(setting.key),
          updated_at: saved ? updatedAt.get(setting.key) ?? null : null,
        };
      }),
    }));

    return {
      format: 'GEARENVSETTINGS1',
      available: this.schemaReady,
      can_restart: this.canRestart(),
      restart_required: restartRequired,
      groups,
    };
  }

  async save(changes: readonly EnvironmentSettingChangeDto[], userId: string) {
    if (!this.schemaReady) {
      throw new ServiceUnavailableException('Server settings cannot be saved because their table is not available. Check the API log, then restart the API.');
    }
    const signingSecret = this.signingSecret();
    const wanted = new Map<string, string | null>();
    for (const change of changes) {
      const setting = environmentSetting(change.key);
      if (!setting) throw new BadRequestException(`${change.key} is not a server setting.`);
      if (setting.locked) throw new BadRequestException(`${setting.label} (${setting.key}) cannot be changed here. ${setting.locked}`);
      wanted.set(setting.key, change.value === null ? null : this.clean(setting, change.value));
    }

    await this.dataSource.transaction(async (manager) => {
      // One save at a time, so the check below always sees the settings it is about to join.
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('gear-environment-settings'))`);
      const rows = (await manager.query('SELECT key, value, encrypted FROM public.gear_environment_settings')) as StoredEnvironmentSetting[];
      const result: EnvironmentValues = { ...environmentStartupState().baseline, ...readEnvironmentOverlay(rows, signingSecret).values };
      for (const [key, value] of wanted) {
        if (value === null) delete result[key];
        else result[key] = value;
      }
      // The same check the API runs when it starts, so a saved value can never stop it starting.
      const problems = environmentProblems(result);
      if (problems.length) throw new BadRequestException(`Not saved. ${problems.join('. ')}.`);

      for (const [key, value] of wanted) {
        if (value === null) {
          await manager.query('DELETE FROM public.gear_environment_settings WHERE key = $1', [key]);
          continue;
        }
        const secret = !!environmentSetting(key)?.secret;
        if (secret && !signingSecret) throw new ConflictException('Passwords cannot be saved because the access token secret is not set.');
        await manager.query(
          `INSERT INTO public.gear_environment_settings (key, value, encrypted, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, encrypted = EXCLUDED.encrypted, updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp()`,
          [key, secret ? encryptEnvironmentValue(value, signingSecret as string) : value, secret, userId],
        );
      }
    });

    // Names only: values may be passwords.
    this.logger.log(`Server settings changed by ${userId}: ${[...wanted].map(([key, value]) => (value === null ? `${key} (back to environment)` : key)).join(', ')}`);
    return this.board();
  }

  restart(userId: string) {
    if (!this.canRestart()) {
      throw new ConflictException('This API is not running under Docker, so it cannot start itself again. Restart it where it was started.');
    }
    this.logger.warn(`API restart requested by ${userId} from Admin > Server Settings.`);
    // SIGTERM closes the application cleanly; Docker's restart policy starts it again.
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), RESTART_DELAY_MS).unref();
    return { restarting: true };
  }

  /** Docker starts the API again when it stops; anywhere else it would simply stay down. */
  private canRestart(): boolean {
    return process.env['ENVIRONMENT'] === 'docker';
  }

  private signingSecret(): string | undefined {
    return environmentStartupState().baseline['JWT_ACCESS_SECRET'] || undefined;
  }

  private environmentValues(): EnvironmentValues {
    this.environmentDefaults ??= environmentWithDefaults(environmentStartupState().baseline);
    return this.environmentDefaults;
  }

  private async savedRows(): Promise<SavedRow[]> {
    if (!this.schemaReady) return [];
    return (await this.dataSource.query('SELECT key, value, encrypted, updated_at FROM public.gear_environment_settings')) as SavedRow[];
  }

  private clean(setting: EnvironmentSettingDefinition, raw: string): string {
    const name = `${setting.label} (${setting.key})`;
    if (setting.type === 'multiline') return raw.replace(/\r\n/g, '\n').trim();
    const value = raw.trim();
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value)) throw new BadRequestException(`${name} must be a single line.`);
    if (value.length > MAX_LENGTH) throw new BadRequestException(`${name} is too long.`);
    if (value === '') return value;
    if (setting.type === 'boolean' && value !== 'true' && value !== 'false') throw new BadRequestException(`${name} must be true or false.`);
    if (setting.type === 'number' && !/^\d{1,9}$/.test(value)) throw new BadRequestException(`${name} must be a whole number.`);
    if (setting.type === 'select' && !setting.options?.includes(value)) throw new BadRequestException(`${name} must be one of: ${setting.options?.join(', ')}.`);
    return value;
  }
}
