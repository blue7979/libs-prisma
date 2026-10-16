import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { workspaceRoot } from '@nx/devkit';
import { vi } from 'vitest';

import type { Runner } from '@infra/definitions';
import { afterEach, beforeAll, debugSnapshot, describe, expect, test } from '@infra/testing';

import { buildPrismaMongodbConnectionUrl, buildPrismaPostgresConnectionUrl } from '../connection';
import { createPrismaConfig } from './prisma-config';

vi.mock('../connection', async () => {
  const actual = await vi.importActual<typeof import('../connection')>('../connection');
  return {
    ...actual,
    buildPrismaPostgresConnectionUrl: vi.fn(),
    buildPrismaMongodbConnectionUrl: vi.fn(),
  };
});

describe.component('createPrismaConfig', () => {
  // Use workspaceRoot to cleanly resolve paths as recommended
  const testTempDir = join(workspaceRoot, '.temp/prisma-config-test');
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = { ...process.env };
    // Ensure clean start
    rmSync(testTempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    // Clean up files written during the test
    rmSync(testTempDir, { recursive: true, force: true });
  });

  test('GIVEN a valid postgres env AND existing prisma schema folder WITH prisma file THEN returns config with postgres URL helper output', () => {
    const targetDir = join(testTempDir, 'src', 'prisma', 'main');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, 'schema.prisma'),
      'generator client {\n output = env("PRISMA_CLIENT_OUTPUT") \n}',
    );
    vi.mocked(buildPrismaPostgresConnectionUrl).mockReturnValue(
      'prisma+postgres://postgres:password@localhost:5432/database',
    );

    const env = process.env as Runner.Envs.PrismaService;
    env.DATABASE_TYPE = 'postgres';
    env.OTS_NAME = 'main';

    const config = createPrismaConfig(testTempDir);

    expect(config).toBeDefined();
    expect(config.schema).toBe(targetDir);
    expect(config.datasource!.url).toBe(
      'prisma+postgres://postgres:password@localhost:5432/database',
    );
    expect(buildPrismaPostgresConnectionUrl).toHaveBeenCalledWith('main');

    debugSnapshot(config);
  });

  test('GIVEN a valid postgres env AND existing prisma schema folder WITH prisma file WHEN seed command exists THEN includes migrations.seed', () => {
    const targetDir = join(testTempDir, 'src', 'prisma', 'main');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, 'schema.prisma'),
      'generator client {\n output = env("PRISMA_CLIENT_OUTPUT") \n}',
    );
    vi.mocked(buildPrismaPostgresConnectionUrl).mockReturnValue(
      'prisma+postgres://postgres:password@postgres-main:5432/database',
    );

    const env = process.env as unknown as Runner.Envs.PrismaService;
    env.DATABASE_TYPE = 'postgres';
    env.OTS_NAME = 'main';

    const config = createPrismaConfig(testTempDir, 'src/seeds/main.ts');

    expect(config).toBeDefined();
    expect(config.schema).toBe(targetDir);
    expect(config.datasource!.url).toBe(
      'prisma+postgres://postgres:password@postgres-main:5432/database',
    );
    expect(config.migrations).toBeDefined();
    expect(config.migrations!.seed).toContain('npx vite-node src/seeds/main.ts');
    expect(buildPrismaPostgresConnectionUrl).toHaveBeenCalledWith('main');

    debugSnapshot(config);
  });

  test('GIVEN a valid mongodb env AND existing prisma schema folder WITH prisma file THEN returns config with mongodb URL helper output', () => {
    const targetDir = join(testTempDir, 'src', 'prisma', 'main-mongo');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, 'schema.prisma'),
      'generator client {\n output = env("PRISMA_CLIENT_OUTPUT") \n}',
    );
    vi.mocked(buildPrismaMongodbConnectionUrl).mockReturnValue(
      'mongodb://mongo:password@127.0.0.1:27017/database?authSource=admin',
    );

    const env = process.env as unknown as Runner.Envs.PrismaService;
    env.DATABASE_TYPE = 'mongodb';
    env.OTS_NAME = 'main-mongo';

    const config = createPrismaConfig(testTempDir);

    expect(config).toBeDefined();
    expect(config.schema).toBe(targetDir);
    expect(config.datasource!.url).toBe(
      'mongodb://mongo:password@127.0.0.1:27017/database?authSource=admin',
    );
    expect(buildPrismaMongodbConnectionUrl).toHaveBeenCalledWith('main-mongo');

    debugSnapshot(config);
  });

  test('GIVEN a valid mongodb env AND existing prisma schema folder WITH prisma file WHEN seed runner already exists THEN preserves it', () => {
    const targetDir = join(testTempDir, 'src', 'prisma', 'main-mongo');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, 'schema.prisma'),
      'generator client {\n output = env("PRISMA_CLIENT_OUTPUT") \n}',
    );
    vi.mocked(buildPrismaMongodbConnectionUrl).mockReturnValue(
      'mongodb://mongo:password@mongodb-main-mongo:27017/database?authSource=admin',
    );

    const env = process.env as unknown as Runner.Envs.PrismaService;
    env.DATABASE_TYPE = 'mongodb';
    env.OTS_NAME = 'main-mongo';

    const config = createPrismaConfig(testTempDir, 'pnpm tsx src/seeds/main-mongo.ts');

    expect(config).toBeDefined();
    expect(config.schema).toBe(targetDir);
    expect(config.datasource!.url).toBe(
      'mongodb://mongo:password@mongodb-main-mongo:27017/database?authSource=admin',
    );
    expect(config.migrations).toEqual({
      seed: 'pnpm tsx src/seeds/main-mongo.ts',
    });
    expect(buildPrismaMongodbConnectionUrl).toHaveBeenCalledWith('main-mongo');

    debugSnapshot(config);
  });

  test('GIVEN a missing schema folder WHEN creating config THEN throws error', () => {
    const env = process.env as unknown as Runner.Envs.PrismaService;
    env.DATABASE_TYPE = 'postgres';
    env.OTS_NAME = 'missing';

    expect(() => createPrismaConfig(testTempDir)).toThrowError(
      /\[PrismaConfig\] The directory '.*' does not exist\./,
    );

    debugSnapshot('throws-missing-folder-error');
  });

  test('GIVEN a schema folder without .prisma files WHEN creating config THEN throws error', () => {
    const targetDir = join(testTempDir, 'src', 'prisma', 'no-prisma');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'other.txt'), 'not-prisma');

    const env = process.env as unknown as Runner.Envs.PrismaService;
    env.DATABASE_TYPE = 'postgres';
    env.OTS_NAME = 'no-prisma';

    expect(() => createPrismaConfig(testTempDir)).toThrowError(
      /\[PrismaConfig\] No \.prisma schema files found in the directory '.*'\./,
    );

    debugSnapshot('throws-no-prisma-files-error');
  });

  test('GIVEN a schema file without PRISMA_CLIENT_OUTPUT WHEN creating config THEN throws error', () => {
    const targetDir = join(testTempDir, 'src', 'prisma', 'missing-env-var');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, 'schema.prisma'),
      'generator client {\n provider = "prisma-client-js" \n}',
    );

    const env = process.env as unknown as Runner.Envs.PrismaService;
    env.DATABASE_TYPE = 'postgres';
    env.OTS_NAME = 'missing-env-var';

    expect(() => createPrismaConfig(testTempDir)).toThrowError(
      "[PrismaConfig] The schema file 'schema.prisma' is missing the required 'PRISMA_CLIENT_OUTPUT' environment variable setting.",
    );

    debugSnapshot('throws-missing-env-var-error');
  });

  test('GIVEN an unsupported DATABASE_TYPE WHEN creating config THEN throws error', () => {
    const targetDir = join(testTempDir, 'src', 'prisma', 'sqlite-db');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, 'schema.prisma'),
      'generator client {\n output = env("PRISMA_CLIENT_OUTPUT") \n}',
    );

    const env = process.env as unknown as Runner.Envs.PrismaService;
    env.DATABASE_TYPE = 'sqlite';
    env.OTS_NAME = 'sqlite-db';

    expect(() => createPrismaConfig(testTempDir)).toThrowError(
      "[PrismaConfig] 'sqlite' is not a supported database type for Prisma. Please specify a valid database type in the config file. (Current: 'sqlite')",
    );

    debugSnapshot('throws-unsupported-database-type-error');
  });
});

describe.unit('createPrismaConfig (Unit)', () => {
  test('should export createPrismaConfig function', () => {
    expect(typeof createPrismaConfig).toBe('function');
    debugSnapshot(typeof createPrismaConfig);
  });
});
