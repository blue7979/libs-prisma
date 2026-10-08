/**
 * @file Prisma Pipeline 오케스트레이터 (4단계 flow typed 재작성)
 * ------------------------------------------------------------------
 * prisma.sh 전체 쉘스크립트 (278줄) 로직을 TypeScript로 재작성.
 * ✨ 아키텍처 계약 4가지는 그대로 이행:
 *
 * 1️⃣ ACTION=setup / start flow:
 *    n=0 (첫 시도): push --force-reset → generate → seed
 *    n>=1 (재시도): push (no force) → seed (generate 스킵 — n=0에서 이미 수행)
 *
 * 2️⃣ --force-reset 재시도 금지 (아키텍처 중요):
 *    매 재시도마다 --force-reset 하면 기존 insert data가 전부 날라가고
 *    stale FK 위반 발생! 오직 n=0 일 때만 초기화.
 *
 * 3️⃣ 재시도 메시지 세분화 (사용자 디버깅 시간 절약):
 *    prisma.sh L254-L264 의 3가지 실패 케이스 분기를 그대로 유지:
 *      a. exit=2 (push)                → PUSH_INVALID_OPTION
 *      b. exit!=0 (push, code≠2)       → PUSH_DB_OR_SCHEMA_ERROR
 *      c. push=0 이지만 seed 실패      → SEED_SCRIPT_FAILED
 *      d. (추가) generate exit=0이지만 output intact 불량 → GENERATE_OUTPUT_CORRUPT
 *
 * 4️⃣ Studio는 retry 통과 후에만 마지막에 **백그라운드 detached 실행**:
 *    Studio가 먼저 떠있으면 포트 충돌이나 리소스 낭비 발생 우려.
 *    retry 30회 끝나기 전에는 절대 Studio를 시작하지 않음.
 *
 * 5️⃣ generate 단독 모드 (ACTION=generate) 별도 분기 지원:
 *    DB 연결 없이 generate 만 수행. (nx run xxx:generate-main 등에서 사용)
 *
 * @see /libs/infra/kits/src/scripts/prisma.sh — 원본 shell 기준 구현 (2026-10-07)
 */

import { setTimeout as wait } from 'node:timers/promises';

import { workspaceRoot } from '@nx/devkit';

import { generatePrismaClient } from '../cli/generate';
import { pushPrismaSchema } from '../cli/push';
import { isOutputIntact, resolvePrismaBin, validatePrismaProjectLayout } from '../cli/utils';
import { PRISMA } from '../constants';
import { runPrismaSeed, seedExists } from '../seed/seed';
import { startPrismaStudio } from '../studio/studio';
import type {
  PipelineOptions,
  PipelineResult,
  PipelineRetryHookInfo,
  PipelineStageAttempt,
  PipelineStageHookInfo,
  PrismaAction,
  PrismaExitCode,
} from '../types';

// ------------------------------------------------------------------
// 📦 Internal: failure reason 분류 헬퍼 (prisma.sh L254-L264 기준)
// ------------------------------------------------------------------

function _classifyFailure(
  last: PipelineStageAttempt,
  generateOutputInvalid = false,
): PipelineRetryHookInfo['reason'] {
  if (generateOutputInvalid) return 'GENERATE_OUTPUT_CORRUPT';
  if (last.stage === 'seed') return 'SEED_SCRIPT_FAILED';
  if (last.exitCode === 2) return 'PUSH_INVALID_OPTION';
  return 'PUSH_DB_OR_SCHEMA_ERROR';
}

async function _callStageHook(
  fn: PipelineOptions['onStage'],
  info: PipelineStageHookInfo,
): Promise<void> {
  if (!fn) return;
  await fn(info);
}

async function _callRetryHook(
  fn: PipelineOptions['onRetry'],
  info: PipelineRetryHookInfo,
): Promise<void> {
  if (!fn) {
    const prefix = `${info.attempt}/${info.attempt + info.remaining}`;
    switch (info.reason) {
      case 'PUSH_INVALID_OPTION':
        console.error(
          `[ERROR] Prisma CLI invalid option error (exit=${info.exitCode}). ` +
            `Check prisma CLI version vs options used. Retrying (${prefix})...`,
        );
        break;
      case 'PUSH_DB_OR_SCHEMA_ERROR':
        console.warn(
          `[WARN] Database push failed (exit=${info.exitCode}): likely DB connection / DSN mismatch ` +
            `or schema error. Retrying in ${Math.round(info.suggestedDelayMs / 1000)} seconds (${prefix})...`,
        );
        break;
      case 'SEED_SCRIPT_FAILED':
        console.warn(
          `[WARN] Push succeeded but DB seed script failed (exit=${info.exitCode}). ` +
            `Review seed errors above — retries only re-run seed, no force-reset. ` +
            `Retrying in ${Math.round(info.suggestedDelayMs / 1000)} seconds (${prefix})...`,
        );
        break;
      case 'GENERATE_OUTPUT_CORRUPT':
        console.warn(
          `[WARN] Generate exited 0 but output files are missing or empty (output intact check failed). ` +
            `Likely prisma CLI metadata issue. Retrying in ${Math.round(info.suggestedDelayMs / 1000)} seconds (${prefix})...`,
        );
        break;
    }
    return;
  }
  await fn(info);
}

// ------------------------------------------------------------------
// 🚀 Public Entry Point
// ------------------------------------------------------------------
/**
 * Prisma 4단계 Pipeline (push → generate → seed → studio) 오케스트레이터.
 *
 * ✨ 전체 Flow:
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  1. Option 기본값 세팅 + Prisma CLI resolve + Layout 검증           │
 * │  2. ACTION='generate' 모드 → generate 단독 실행 후 바로 return       │
 * │  3. for (attempt 0..<maxRetry):                                    │
 * │     a. attempt==0 → PIPELINE_INITIAL_STAGES [push --force + gen + seed] │
 * │     b. attempt>=1 → PIPELINE_RETRY_STAGES [push (normal) + seed]   │
 * │     c. 모두 성공 → break (retry 탈출)                               │
 * │     d. 실패 → classifyFailure → onRetry → wait(delayMs) → 재시도    │
 * │  4. maxRetry 초과 → 실패로 PipelineResult 반환                     │
 * │  5. 성공시 → startPrismaStudio() detached 백그라운드 실행            │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * @param options — PipelineOptions (env + action 필수, 나머지 SSoT 기본값 존재)
 * @returns PipelineResult — 성공 여부 / 총 시도 횟수 / 에러 세부정보 / studioStarted flag
 */
export async function runPrismaPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { env } = options;
  const action: PrismaAction = options.action;
  const projectRoot = options.projectRoot ?? workspaceRoot;
  const stdio = options.stdio ?? PRISMA.CLI_DEFAULT_STDIO;
  const maxRetry = options.maxRetry ?? PRISMA.CLI_RETRY_MAX;
  const retryDelayMs = options.retryDelayMs ?? PRISMA.CLI_RETRY_DELAY_MS;
  const studioPort = options.studioPort ?? PRISMA.PIPELINE_DEFAULT_STUDIO_PORT;

  // --- 1. Prisma CLI + layout 검증 ---------------------------------------------------
  const prismaBin = resolvePrismaBin(projectRoot);
  const layout = validatePrismaProjectLayout(
    {
      OTS_NAME: env.OTS_NAME,
      DATABASE_TYPE: env.DATABASE_TYPE,
      PRISMA_CLIENT_OUTPUT: env.PRISMA_CLIENT_OUTPUT,
    },
    action,
    projectRoot,
  );
  // --- 2. Short-circuit: ACTION='generate' 단독 모드 (DB 없음) ------------------------
  // generate short-circuit + retry loop 공통 플래그. 선언을 if 블록 위로 올려
  // "used before its declaration" 오류 방지
  let lastGenerateCorrupt = false;
  if (action === 'generate') {
    const res = await generatePrismaClient({
      projectRoot,
      env,
      prismaBinPath: prismaBin,
      stdio,
      cache: true,
    });
    await _callStageHook(options.onStage, {
      stage: 'generate',
      attempt: 0,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      ok: res.exitCode === 0 && isOutputIntact(layout.clientOutputDir),
    });
    const ok = res.exitCode === 0 && isOutputIntact(layout.clientOutputDir);
    if (ok) {
      return {
        action,
        ok: true,
        totalAttempts: 0,
        studioStarted: false,
      };
    }
    return {
      action,
      ok: false,
      totalAttempts: 0,
      studioStarted: false,
      lastFailure: {
        failedStage: 'generate',
        exitCode: res.exitCode as PrismaExitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        reason: _classifyFailure(
          {
            stage: 'generate',
            exitCode: res.exitCode,
            stdout: res.stdout,
            stderr: res.stderr,
          },
          lastGenerateCorrupt || !isOutputIntact(layout.clientOutputDir),
        ),
      },
    };
  }

  // --- 3~4. Retry Loop (push → seed / push → generate → seed) ------------------------
  let lastAttempt: PipelineStageAttempt | null = null;
  let attempt = 0;
  let success = false;

  for (; attempt < maxRetry; attempt += 1) {
    const stages: readonly ('push' | 'generate' | 'seed')[] =
      attempt === 0 ? PRISMA.PIPELINE_INITIAL_STAGES : PRISMA.PIPELINE_RETRY_STAGES;
    let stageFailed: PipelineStageAttempt | null = null;
    let outputCorrupt = false;

    for (const stage of stages) {
      if (stage === 'push') {
        const forceReset = attempt === 0;

        const pushRes = await pushPrismaSchema({
          projectRoot,
          env,
          prismaBinPath: prismaBin,
          stdio,
          forceReset,
          acceptDataLoss: forceReset,
        });

        await _callStageHook(options.onStage, {
          stage: 'push',
          attempt,
          exitCode: pushRes.exitCode,
          stdout: pushRes.stdout,
          stderr: pushRes.stderr,
          ok: pushRes.exitCode === 0,
        });
        if (pushRes.exitCode !== 0) {
          stageFailed = {
            stage: 'push',
            exitCode: pushRes.exitCode,
            stdout: pushRes.stdout,
            stderr: pushRes.stderr,
          };
          break;
        }
        continue;
      }

      if (stage === 'generate') {
        const genRes = await generatePrismaClient({
          projectRoot,
          env,
          prismaBinPath: prismaBin,
          stdio,
          cache: false,
        });

        await _callStageHook(options.onStage, {
          stage: 'generate',
          attempt,
          exitCode: genRes.exitCode,
          stdout: genRes.stdout,
          stderr: genRes.stderr,
          ok: genRes.exitCode === 0 && isOutputIntact(layout.clientOutputDir),
        });
        if (genRes.exitCode !== 0 || !isOutputIntact(layout.clientOutputDir)) {
          if (!isOutputIntact(layout.clientOutputDir)) {
            outputCorrupt = true;
          }
          stageFailed = {
            stage: 'generate',
            exitCode: genRes.exitCode,
            stdout: genRes.stdout,
            stderr: genRes.stderr,
          };
          break;
        }
        continue;
      }

      if (stage === 'seed') {
        if (!seedExists(env.OTS_NAME, projectRoot)) {
          await _callStageHook(options.onStage, {
            stage: 'seed',
            attempt,
            exitCode: 0,
            stdout: `[Prisma Seed] Skip — no seed entry found for OTS='${env.OTS_NAME}' at ${projectRoot}`,
            stderr: '',
            ok: true,
          });
          continue;
        }

        const seedEnvForPipeline: typeof env = {
          ...env,
          TARGET: env.TARGET ?? env.OTS_NAME,
          ACTION: env.ACTION ?? action,
        };

        const seedRes = await runPrismaSeed({
          projectRoot,
          env: seedEnvForPipeline,
          stdio,
        });

        await _callStageHook(options.onStage, {
          stage: 'seed',
          attempt,
          exitCode: seedRes.exitCode,
          stdout: seedRes.stdout,
          stderr: seedRes.stderr,
          ok: seedRes.exitCode === 0,
        });
        if (seedRes.exitCode !== 0) {
          stageFailed = {
            stage: 'seed',
            exitCode: seedRes.exitCode,
            stdout: seedRes.stdout,
            stderr: seedRes.stderr,
          };
          break;
        }
      }
    }

    if (!stageFailed) {
      success = true;
      break;
    }

    lastAttempt = stageFailed;
    lastGenerateCorrupt = outputCorrupt;

    const info: PipelineRetryHookInfo = {
      attempt: attempt + 1,
      remaining: Math.max(0, maxRetry - attempt - 1),
      failedStage: stageFailed.stage,
      exitCode: stageFailed.exitCode,
      stdout: stageFailed.stdout,
      stderr: stageFailed.stderr,
      reason: _classifyFailure(stageFailed, outputCorrupt),
      suggestedDelayMs: retryDelayMs,
    };

    await _callRetryHook(options.onRetry, info);

    await wait(retryDelayMs);
  }

  if (!success) {
    const failed = lastAttempt ?? {
      stage: 'push' as const,
      exitCode: -1,
      stdout: '',
      stderr: 'Pipeline did not execute any stage — likely maxRetry=0 or unexpected control flow.',
    };
    return {
      action,
      ok: false,
      totalAttempts: attempt,
      studioStarted: false,
      lastFailure: {
        failedStage: failed.stage,
        exitCode: failed.exitCode as PrismaExitCode,
        stdout: failed.stdout,
        stderr: failed.stderr,
        reason: _classifyFailure(failed, lastGenerateCorrupt),
      },
    };
  }

  // --- 5. 성공 → Prisma Studio 백그라운드 실행 --------------------------------------
  const shouldStartStudio = action === 'setup' || action === 'start';
  let studioStarted = false;
  if (shouldStartStudio) {
    try {
      startPrismaStudio({
        otsName: env.OTS_NAME,
        prismaConfigPath: layout.prismaConfigPath,
        prismaBinPath: prismaBin,
        studioPort,
        stdio: 'inherit',
        cwd: projectRoot,
      });
      studioStarted = true;
    } catch (err) {
      console.warn(
        `[WARN] Pipeline succeeded but Prisma Studio failed to start on port ${studioPort}. ` +
          `Reason: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    action,
    ok: true,
    totalAttempts: attempt,
    studioStarted,
  };
}
