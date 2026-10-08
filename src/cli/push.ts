/**
 * @infra/prisma — Prisma Schema db push 실행기
 * ------------------------------------------------------------------
 * @migrated from @infra/runtime/src/generator/prisma/push.ts (2026-10-07)
 * ------------------------------------------------------------------
 * 마이그레이션:
 * ⚠️ Prisma 6.0 부터 `--skip-generate` 옵션은 **deprecated / 제거** 되었습니다.
 *   이전 버전과 달리 `prisma db push` 는 필요시 자동으로 generate 를 호출하므로
 *   더 이상 skipGenerate 옵션을 PushOptions 에서 지원하지 않습니다.
 *   관련 타입 필드 또한 types/ barrel 에서 이미 제거됨.
 */
import { workspaceRoot } from '@nx/devkit';

import type { PrismaCliResult, PushOptions } from '../types';
import {
  assertResultOk,
  buildPrismaEnv,
  resolvePrismaBin,
  runPrismaCli,
  validatePrismaProjectLayout,
} from './utils';

/**
 * `prisma db push` 명령을 실행하여 로컬 스키마 `.prisma` 파일을
 * 실제 데이터베이스 인스턴스에 직접 동기화한다.
 *
 * @warning schema-only 개발용 push 이므로 프로덕션 DB 에서 직접 실행 금지.
 *          운영 환경에선 반드시 `prisma migrate deploy` 사용.
 *
 * @param options - {@link PushOptions} push 설정
 * @param options.env           - **필수** PrismaEnv (DATABASE_TYPE / OTS_NAME)
 * @param options.forceReset    - 기존 데이터 전체 drop 후 재생성. start 모드 1회차 시 사용. `--force-reset`
 * @param options.acceptDataLoss - `forceReset` 과 함께 넘겨야 CLI 가 프롬프트 없이 진행. `--accept-data-loss`
 * @param options.dbUrl         - env DATABASE_URL 대신 직접 override 할 DB URL. 디버깅 용도 외 사용 금지
 * @param options.stdio         - 출력 모드. 기본 PRISMA.CLI_DEFAULT_STDIO = 'pipe'
 * @param options.projectRoot   - 프로젝트 루트 경로. 기본 workspaceRoot
 *
 * @returns `PrismaCliResult` — schemaDir / clientOutputDir 포함 결과
 *
 * @example
 * // 1회차 force-reset (컨테이너 시작 시 DB 초기화 용도)
 * await pushPrismaSchema({
 *   env: { DATABASE_TYPE: 'postgres', OTS_NAME: 'main' },
 *   forceReset: true,
 *   acceptDataLoss: true,
 * });
 */
export async function pushPrismaSchema(options: PushOptions): Promise<PrismaCliResult> {
  const { env, forceReset, acceptDataLoss, dbUrl, stdio } = options;
  const projectRoot = options.projectRoot ?? workspaceRoot;

  const prismaBin = resolvePrismaBin(projectRoot);
  const { schemaDir, prismaConfigPath, clientOutputDir } = validatePrismaProjectLayout(
    env,
    'db push',
    projectRoot,
  );

  const args: string[] = ['db', 'push', '--config', prismaConfigPath];
  if (forceReset) args.push('--force-reset');
  if (acceptDataLoss) args.push('--accept-data-loss');
  // ⚠️ Prisma 6+ 에서 --skip-generate deprecated / args 에 절대 추가하지 마세요.
  if (dbUrl) args.push('--url', dbUrl);

  const resolvedEnv = buildPrismaEnv(options);
  const { exitCode, stdout, stderr } = await runPrismaCli(
    prismaBin,
    args,
    projectRoot,
    resolvedEnv,
    stdio,
  );

  const result: PrismaCliResult = {
    schemaDir,
    prismaConfigPath,
    clientOutputDir,
    exitCode,
    stdout,
    stderr,
  };

  assertResultOk(result, 'db push');
  return result;
}
