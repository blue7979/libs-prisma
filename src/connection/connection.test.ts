import fs from 'node:fs';

import * as cfgMod from '@infra/config';
import { DOCKER } from '@infra/definitions';

import { buildPrismaMongodbConnectionUrl, buildPrismaPostgresConnectionUrl } from './connection';
import type { PrismaOtsName } from '../types';

describe.component('connection URL builders', () => {
  const PG_OTS = 'main' as any as PrismaOtsName<'postgres'>;
  const MONGO_OTS = 'main-mongo' as any as PrismaOtsName<'mongodb'>;

  let getOtsConfigSpy: ReturnType<typeof vi.spyOn>;
  let statSyncSpy: ReturnType<typeof vi.spyOn>;
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    statSyncSpy = vi.spyOn(fs, 'statSync');
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync');
    statSyncSpy.mockImplementation((_p: fs.PathLike) => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    readFileSyncSpy.mockImplementation((_p: fs.PathOrFileDescriptor) => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('buildPrismaPostgresConnectionUrl', () => {
    beforeEach(() => {
      getOtsConfigSpy = vi.spyOn(cfgMod, 'getOtsConfig').mockReturnValue({
        POSTGRESQL_USERNAME: 'pguser',
        POSTGRESQL_PASSWORD: 'pgpass',
        POSTGRESQL_DATABASE: 'platform',
        localPort: 55432,
      } as any);
    });

    test('GIVEN forceContainerFormat=true WHEN called THEN returns prisma+postgres:// URL with container hostname and default port', () => {
      const result = buildPrismaPostgresConnectionUrl(PG_OTS, {
        forceContainerFormat: true,
      });

      expect(result.startsWith('prisma+postgres://')).toBe(true);
      expect(result).toContain(`${DOCKER.OTS.DATABASE.POSTGRES}-${PG_OTS}`);
      expect(result).toContain(':5432/');
      expect(result).not.toContain(':55432');
      vt.debugSnapshot({ url: result });
    });

    test('GIVEN default run (not container, no flag) WHEN called THEN uses LOCAL_HOST constant and localPort from config', () => {
      const result = buildPrismaPostgresConnectionUrl(PG_OTS);

      expect(result).toContain(`@${DOCKER.CONTAINER.LOCAL_HOST}:`);
      expect(result).toContain(':55432/');
      vt.debugSnapshot({ url: result });
    });

    test('GIVEN localPort is missing in config WHEN called THEN falls back to default internal postgres port', () => {
      getOtsConfigSpy.mockReturnValue({
        POSTGRESQL_USERNAME: 'u',
        POSTGRESQL_PASSWORD: 'p',
        POSTGRESQL_DATABASE: 'd',
      } as any);

      const result = buildPrismaPostgresConnectionUrl(PG_OTS);
      expect(result).toContain(':5432/');
      vt.debugSnapshot({ url: result });
    });

    test('GIVEN credentials with special chars WHEN called THEN user/pass are URI-encoded (RFC3986)', () => {
      getOtsConfigSpy.mockReturnValue({
        POSTGRESQL_USERNAME: 'admin@site',
        POSTGRESQL_PASSWORD: 'p@ss:w/ord 123',
        POSTGRESQL_DATABASE: 'db',
        localPort: 55432,
      } as any);

      const result = buildPrismaPostgresConnectionUrl(PG_OTS, {
        forceContainerFormat: true,
      });

      expect(result).toContain('admin%40site');
      expect(result).toContain('p%40ss%3Aw%2Ford%20123');
      vt.debugSnapshot({ url: result });
    });

    test('GIVEN process.platform=linux + /.dockerenv exists WHEN called THEN auto-detects container mode (statSync success)', () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      statSyncSpy.mockImplementation((p: fs.PathLike) => {
        if (String(p) === '/.dockerenv') return { isDirectory: () => false } as fs.Stats;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });

      const result = buildPrismaPostgresConnectionUrl(PG_OTS);

      expect(result).toContain(`${DOCKER.OTS.DATABASE.POSTGRES}-${PG_OTS}`);
      expect(result).toContain(':5432/');
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      vt.debugSnapshot({ url: result, platformDuringCall: 'linux' });
    });

    test('GIVEN darwin platform + /.dockerenv not present WHEN called THEN stays in local mode (platform short-circuit)', () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      statSyncSpy.mockImplementation(
        (_p: fs.PathLike) => ({ isDirectory: () => false }) as fs.Stats,
      );

      const result = buildPrismaPostgresConnectionUrl(PG_OTS);

      expect(result).toContain(`@${DOCKER.CONTAINER.LOCAL_HOST}:`);
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      vt.debugSnapshot({ url: result, platformDuringCall: 'darwin' });
    });
  });

  describe('buildPrismaMongodbConnectionUrl', () => {
    beforeEach(() => {
      getOtsConfigSpy = vi.spyOn(cfgMod, 'getOtsConfig').mockReturnValue({
        MONGODB_ROOT_USER: 'root',
        MONGODB_ROOT_PASSWORD: 'mongopass',
        MONGODB_DATABASE: 'analytics',
        localPort: 57017,
      } as any);
    });

    test('GIVEN forceContainerFormat=true WHEN called THEN returns mongodb:// URL with mongo hostname + default port + authSource=admin', () => {
      const result = buildPrismaMongodbConnectionUrl(MONGO_OTS, {
        forceContainerFormat: true,
      });

      expect(result.startsWith('mongodb://')).toBe(true);
      expect(result).toContain(`${DOCKER.OTS.DATABASE.MONGODB}-${MONGO_OTS}`);
      expect(result).toContain(':27017/');
      expect(result).toContain('?authSource=admin');
      vt.debugSnapshot({ url: result });
    });

    test('GIVEN default local mode WHEN called THEN uses LOCAL_HOST constant and localPort', () => {
      const result = buildPrismaMongodbConnectionUrl(MONGO_OTS);

      expect(result).toContain(`@${DOCKER.CONTAINER.LOCAL_HOST}:`);
      expect(result).toContain(':57017/');
      expect(result).toContain('?authSource=admin');
      vt.debugSnapshot({ url: result });
    });

    test('GIVEN special chars in mongodb credentials WHEN called THEN applies URI encoding (encodeURIComponent: reserved chars encoded, unreserved like ! kept)', () => {
      getOtsConfigSpy.mockReturnValue({
        MONGODB_ROOT_USER: 'root/user',
        MONGODB_ROOT_PASSWORD: 'pass:word!#',
        MONGODB_DATABASE: 'analytics',
        localPort: 57017,
      } as any);

      const result = buildPrismaMongodbConnectionUrl(MONGO_OTS, {
        forceContainerFormat: true,
      });

      expect(result).toContain('root%2Fuser');
      expect(result).toContain('pass%3Aword!%23');
      vt.debugSnapshot({ url: result });
    });
  });
});
