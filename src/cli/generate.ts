/**
 * @infra/prisma — Prisma Client generate 실행기
 * ------------------------------------------------------------------
 * @migrated from @infra/runtime/src/generator/prisma/generate.ts (2026-10-07)
 * ------------------------------------------------------------------
 * - withSchemaCache 고차함수로 schema 변경 없을 시 <1ms 캐시 히트 (manifest 기반 v1)
 * - cache hit 아닌 경우에만 assertResultOk 로 exit code 검증
 * - schema dir / prisma.config.ts 존재 여부 사전 검사 → 친절한 에러 메시지
 */
import { mkdirSync } from 'node:fs';

import { workspaceRoot } from '@nx/devkit';

import { withSchemaCache } from '../cache';
import type { GenerateOptions, GenerateResult } from '../types';
import {
  assertResultOk,
  buildPrismaEnv,
  resolvePrismaBin,
  runPrismaCli,
  validatePrismaProjectLayout,
} from './utils';

/**
 * `prisma generate` 명령을 실행하여 Prisma Client 를 output 디렉토리에 생성한다.
 *
 * - 기본적으로 manifest v1 캐시 사용 → schema 파일의 size / mtimeMs 변경 없을 경우
 *   subprocess spawn 전에 skip 하고 cache hit 반환 (<1ms 소요)
 * - 캐시 미스 시에만 실제 prisma generate 실행 → 성공시 manifest 기록
 * - prisma CLI exit code != 0 일 경우 assertResultOk throw
 *
 * @param options - {@link GenerateOptions} generate 설정
 * @param options.env      - **필수** PrismaEnv (DATABASE_TYPE / OTS_NAME 필수 포함)
 * @param options.cache    - 캐시 사용 여부. 기본 `true`
 * @param options.stdio    - stdout/stderr 연결 모드. 기본 `PRISMA.CLI_DEFAULT_STDIO` = 'pipe'
 * @param options.projectRoot  - 프로젝트 루트 경로. 기본값 workspaceRoot
 * @returns `GenerateResult` — cacheHit 필드로 스킵 여부 확인 가능
 *
 * @example
 * const result = await generatePrismaClient({
 *   env: { DATABASE_TYPE: 'postgres', OTS_NAME: 'main' },
 * });
 * if (result.cacheHit) console.log('skip');
 */
export async function generatePrismaClient(options: GenerateOptions): Promise<GenerateResult> {
  const { env, stdio } = options;
  const useCache = options.cache ?? true;
  const projectRoot = options.projectRoot ?? workspaceRoot;

  const prismaBin = resolvePrismaBin(projectRoot);
  const { schemaDir, prismaConfigPath, clientOutputDir } = validatePrismaProjectLayout(
    env,
    'generate',
    projectRoot,
  );

  mkdirSync(clientOutputDir, { recursive: true });
  const resolvedEnv = buildPrismaEnv(options);

  const { result } = await withSchemaCache(
    {
      otsName: env.OTS_NAME,
      schemaDir,
      prismaConfigPath,
      clientOutputDir,
      projectRoot,
      useCache,
    },
    async () => {
      const { exitCode, stdout, stderr } = await runPrismaCli(
        prismaBin,
        ['generate', '--config', prismaConfigPath],
        projectRoot,
        resolvedEnv,
        stdio,
      );
      return {
        schemaDir,
        prismaConfigPath,
        clientOutputDir,
        exitCode,
        stdout,
        stderr,
      };
    },
  );

  if (!result.cacheHit) {
    assertResultOk(result, 'generate');
  }
  return result;
}
