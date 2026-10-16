import { existsSync } from 'fs';
import { join, relative } from 'path';

import { workspaceRoot } from '@nx/devkit';
import type { PrismaConfig } from 'prisma/config';

import type { Docker, Runner } from '@infra/definitions';

import { buildPrismaMongodbConnectionUrl, buildPrismaPostgresConnectionUrl } from '../connection';
import type { PrismaOtsName } from '../types';
import { checkPrismaSchema } from './schema-check';

type PrismaDbType = Docker.Config.PrismaDatabaseType;
type ScopedOtsName = PrismaOtsName<'postgres'> | PrismaOtsName<'mongodb'>;
type PrismaServiceEnv = Runner.Envs.PrismaService;

const PRISMA_DB_TYPES: ReadonlySet<PrismaDbType> = new Set<PrismaDbType>(['postgres', 'mongodb']);

type Replace<
  T extends string,
  From extends string,
  To extends string,
> = T extends `${infer Head}${From}${infer Tail}` ? `${Head}${To}${Replace<Tail, From, To>}` : T;

type ScopedDatabaseEnvKey<
  TDb extends PrismaDbType = PrismaDbType,
  TOts extends ScopedOtsName = ScopedOtsName,
> =
  | `DATABASE_${Uppercase<TDb>}_${Uppercase<Replace<TOts, '-', '_'>>}_URL`
  | `DATABASE_${Uppercase<Replace<TOts, '-', '_'>>}_URL`;

const DB_URL_FALLBACK_ENV = 'DATABASE_URL' as const;

function _asPrismaDbType(raw: unknown): PrismaDbType {
  if (typeof raw !== 'string') {
    throw new Error(
      `[PrismaConfig] DATABASE_TYPE is missing or not a string. Please specify a valid database type ('postgres' | 'mongodb'). (Current: ${String(raw)})`,
    );
  }
  const maybe = raw.toLowerCase() as PrismaDbType;
  if (!PRISMA_DB_TYPES.has(maybe)) {
    throw new Error(
      `[PrismaConfig] '${raw}' is not a supported database type for Prisma. Please specify a valid database type in the config file. (Current: '${raw}')`,
    );
  }
  return maybe;
}

function _asScopedOtsName(raw: unknown, dbType: PrismaDbType): ScopedOtsName {
  if (typeof raw === 'string' && raw.length > 0) {
    return raw as ScopedOtsName;
  }
  return (dbType === 'mongodb' ? 'main-mongo' : 'main') as ScopedOtsName;
}

function _resolveDatasourceUrl(
  baseUrl: string,
  dbType: PrismaDbType,
  otsName: ScopedOtsName,
): string {
  const normalized = otsName.toUpperCase().replace(/-/g, '_') as Uppercase<
    Replace<typeof otsName, '-', '_'>
  >;
  const typeUpper = dbType.toUpperCase() as Uppercase<typeof dbType>;

  const k1 = `DATABASE_${typeUpper}_${normalized}_URL` as const;
  const k2 = `DATABASE_${normalized}_URL` as const;

  return (
    (process.env[k1 as ScopedDatabaseEnvKey] as string | undefined) ??
    (process.env[k2 as ScopedDatabaseEnvKey] as string | undefined) ??
    (process.env[DB_URL_FALLBACK_ENV] as string | undefined) ??
    baseUrl
  );
}

/**
 * Prisma 설정을 생성합니다.
 *
 * @example
 * const config = createPrismaConfig(import.meta.dirname, 'src/seeds/index.ts');
 *
 * @param projectPath - 프로젝트 경로 (import.meta.dirname 을 입력)
 * @param seedPathOrCommand - 실행할 DB 시드 파일 경로 또는 명령어 (선택사항)
 * @returns 생성된 Prisma 설정 객체
 */
export function createPrismaConfig(projectPath: string, seedPathOrCommand?: string): PrismaConfig {
  const rawEnv = process.env as PrismaServiceEnv;
  const dbType: PrismaDbType = _asPrismaDbType(rawEnv.DATABASE_TYPE);
  const otsName: ScopedOtsName = _asScopedOtsName(rawEnv.OTS_NAME, dbType);

  const schema = join(projectPath, 'src', 'prisma', String(otsName));
  const relativePath = relative(workspaceRoot, schema);

  if (!existsSync(schema)) {
    throw new Error(`[PrismaConfig] The directory '${relativePath}' does not exist.`);
  }

  checkPrismaSchema(schema);

  let baseUrl = '';
  switch (dbType) {
    case 'postgres': {
      baseUrl = buildPrismaPostgresConnectionUrl(otsName as PrismaOtsName<'postgres'>);
      break;
    }
    case 'mongodb': {
      baseUrl = buildPrismaMongodbConnectionUrl(otsName as PrismaOtsName<'mongodb'>);
      break;
    }
    default: {
      const unreachable: never = dbType;
      void unreachable;
      throw new Error(
        `[PrismaConfig] '${String(rawEnv.DATABASE_TYPE)}' is not a supported database type for Prisma. Please specify a valid database type in the config file. (Current: '${String(rawEnv.DATABASE_TYPE)}')`,
      );
    }
  }

  const url = _resolveDatasourceUrl(baseUrl, dbType, otsName);
  const config: PrismaConfig = {
    schema,
    datasource: { url },
  };

  if (seedPathOrCommand) {
    const hasRunner = /^(npx|node|pnpm|yarn|tsx)\b/.test(seedPathOrCommand);
    const viteConfigPath = join(projectPath, 'vite.config.mts');

    const NODE_PATH = [
      join(workspaceRoot, 'node_modules'),
      join(projectPath, 'node_modules'),
      process.env.NODE_PATH ?? '',
    ]
      .filter(Boolean)
      .join(':');

    const seedEnvPrefix = `NODE_PATH=${NODE_PATH}`;

    // ⚠️ Prisma 5+ Spawn Rules (CRITICAL):
    // - config.migrations.seed 는 Prisma CLI 가 `child_process.spawn(seedCmd, { shell: false })`
    //   로 직접 실행 (기본 shell=false). 즉 첫 토큰은 반드시 실제 실행 파일이어야 하고
    //   "ENV_VAR=foo cmd ..." 와 같은 shell 문법은 직접 실행 시 ENOENT 오류 발생.
    //
    // - 1차 시도: `sh -c "NODE_PATH=... npx vite-node ..."`
    //   문제: Prisma spawn 이 내부적으로 명령어 문자열을 공백 split 해서 인용 부호가 깨짐
    //   → "Unterminated quoted string" npx 오류 발생
    //
    // - 최종 해결: `/usr/bin/env` 를 첫 토큰으로 사용 — env 는 "KEY=VALUE cmd ..." 형식을
    //   POSIX 스펙대로 해석하므로 shell 없이도 환경변수 세팅 + 다음 명령 실행을 정확히 수행.
    //   또한 내부 문자열에 어떤 종류의 따옴표도 필요 없으므로 Prisma의 인용부호 처리와 충돌 0.
    const seedCommand = hasRunner
      ? seedPathOrCommand
      : existsSync(viteConfigPath)
        ? `env ${seedEnvPrefix} npx vite-node --config vite.config.mts ${seedPathOrCommand}`
        : `env ${seedEnvPrefix} npx vite-node ${seedPathOrCommand}`;

    config.migrations = { seed: seedCommand };
  }

  return config;
}
