/**
 * @file prisma seed 실행 모듈
 * ------------------------------------------------------------------
 * prisma.sh L194-L200 `run_prisma_db_seed()` shell 함수를 TypeScript로 재작성.
 *
 * 🚨 2026-10-07 Seed Stage 재설계 (4가지 실패 원인 봉쇄):
 *
 *   1. CWD 이슈 → cwd = projectRoot 로 강제 지정.
 *      WORKSPACE_ROOT에서 실행시 vite-node가 루트의 vite.config.mts를 찾아 resolve 실패.
 *      반드시 개별 프로젝트 폴더(domains/structure 등)에서 cd 후 실행해야 함.
 *
 *   2. TARGET env 미전달 이슈 → process.env 와 병합시 OTS_NAME을 TARGET으로 매핑 주입.
 *      src/seeds/index.ts (L6) 에서 `process.env.TARGET || 'main'` 로 분기하므로,
 *      OTS_NAME='analytics' 인 경우 자동으로 seeds/analytics/index.ts 를 import 함.
 *
 *   3. spawn ENOENT 이슈 (shell=false + NODE_PATH prefix 문자열) →
 *      절대 "NODE_PATH=xxx npx vite-node" 형태로 첫 arg를 합쳐서 전달하지 말 것.
 *      spawn options.env 객체에 명시적으로 process.env 와 병합해서 NODE_PATH 를 넣어주고,
 *      command 는 'npx', args 는 ['vite-node', './src/seeds/index.ts'] 로 깔끔히 분리.
 *
 *   4. 출력 캡처 vs 사용자 로그 가시성 trade-off →
 *      stdio: 'inherit' 기본으로 로그에 색을 입혀서 사용자에게 직접 보여주고,
 *      필요시 'pipe' 로 전환하여 pipeline 오케스트레이터에서 stderr 에러 메시지 세분화 가능.
 * ------------------------------------------------------------------
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { PRISMA } from '../constants';
import type {
  PrismaEnv,
  PrismaOtsName,
  PrismaStdioMode,
  SeedOptions,
  SeedResult,
  SpawnChildProcess,
} from '../types';

/**
 * 개별 seed entry 파일의 존재 여부를 검증 (layout 검증 보조 헬퍼).
 *
 * validatePrismaProjectLayout() 은 schema/client output 경로만 검증하므로,
 * seed 단계에서는 별도로 src/seeds/<ots>/index.ts 존재 여부를 확인해야 한다.
 * 존재하지 않을 경우 pipeline 오케스트레이터(Step ⑥)에서 skip 가능하도록 boolean 반환.
 *
 * @param otsName       - Operational Target Schema 인스턴스 이름
 * @param projectRoot   - 대상 프로젝트 루트 (seeds 폴더를 포함하는 경로)
 * @returns true = 해당 OTS 용 seed 엔트리 파일 존재, false = 파일 없어서 seed skip 가능
 *
 * @example
 * ```ts
 * seedExists('main', '/path/to/domains/structure')
 * // → src/seeds/main/index.ts 가 존재하면 true
 * ```
 */
export function seedExists(otsName: PrismaOtsName, projectRoot: string): boolean {
  return existsSync(join(projectRoot, 'src/seeds', String(otsName), 'index.ts'));
}

/**
 * prisma seed 스크립트를 vite-node subprocess 로 실행하고 결과를 반환한다.
 *
 * ✨ 실행 옵션 핵심 4가지 (위 주석에 설명한 4가지 실패 모드에 대응):
 *   1. cwd  = projectRoot                                  → vite.config.mts resolve
 *   2. env  = { ...process.env, TARGET: OTS_NAME, ... }    → seeds/<ots> 분기 라우팅
 *   3. env 에 NODE_PATH 명시 삽입 (문자열 prefix ❌)        → spawn shell=false ENOENT 방지
 *   4. command='npx' + args=['vite-node', entry]           → 따옴표/경로 이슈 원천 봉쇄
 *
 * @param options  - Seed 실행 옵션 (projectRoot / env / stdio / nodePath)
 * @returns SeedResult — exitCode / stdout / stderr 묶음
 * @see SeedOptions — 옵션 타입 정의 (projectRoot 필수)
 * @see /domains/structure/src/seeds/index.ts — 동적 import 기반 TARGET 라우팅 로직
 */
export function runPrismaSeed(options: SeedOptions): Promise<SeedResult> {
  const stdio: PrismaStdioMode = options.stdio ?? PRISMA.CLI_DEFAULT_STDIO;
  const entryPath = resolve(options.projectRoot, PRISMA.SEED_ENTRY_PATH);
  const nodePathValue = options.nodePath ?? join(options.projectRoot, 'node_modules');
  const seedTarget: PrismaEnv['OTS_NAME'] = options.env.OTS_NAME;

  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env.PROJECT_NAME ? { PROJECT_NAME: options.env.PROJECT_NAME } : {}),
    ...(options.env.PRISMA_CLIENT_OUTPUT
      ? { PRISMA_CLIENT_OUTPUT: options.env.PRISMA_CLIENT_OUTPUT }
      : {}),
    DATABASE_TYPE: options.env.DATABASE_TYPE,
    OTS_NAME: String(seedTarget),
    TARGET: String(seedTarget),
    NODE_PATH: nodePathValue,
  };

  return new Promise<SeedResult>((resolvePromise) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const child = spawn('npx', ['vite-node', entryPath], {
      cwd: options.projectRoot,
      env: mergedEnv,
      shell: false,
      stdio: stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    }) as SpawnChildProcess;

    if (stdio === 'pipe') {
      child.stdout?.on('data', (data) => {
        stdoutBuffer += data.toString();
      });
      child.stderr?.on('data', (data) => {
        stderrBuffer += data.toString();
      });
    }

    child.on('error', (err) => {
      stderrBuffer += `[spawn error] npx vite-node: ${err.message}\n${err.stack ?? ''}`;
      resolvePromise({
        exitCode: -1,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
      });
    });

    child.on('close', (code) => {
      resolvePromise({
        exitCode: code ?? 0,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
      });
    });
  });
}

/**
 * runPrismaSeed() 실행 결과의 exit code 가 성공([0])이 아니면 Error 를 throw 한다.
 *
 * Prisma pipeline 오케스트레이터(Step ⑥)에서 retry 메시지 세분화 분기를 위해
 * seed 결과의 에러 객체를 일관된 포맷으로 래핑시 사용.
 *
 * @param result       - runPrismaSeed() 가 반환한 SeedResult
 * @param actionLabel  - 에러 메시지 prefix (예: 'setup' / 'start')
 * @throws Error — exitCode 가 PRISMA.SEED_SUCCESS_EXIT_CODES 배열에 없을 경우
 *
 * @example
 * ```ts
 * const r = await runPrismaSeed({ projectRoot: ..., env, stdio: 'pipe' });
 * assertSeedResultOk(r, 'start'); // exit != 0 이면 throw
 * ```
 */
export function assertSeedResultOk(result: SeedResult, actionLabel: string): void {
  if (!PRISMA.SEED_SUCCESS_EXIT_CODES.includes(result.exitCode as PRISMA.SEED_SUCCESS_EXIT_CODES)) {
    const msgTail = result.stderr || result.stdout || '(no stdout/stderr)';
    throw new Error(
      `[Prisma ${actionLabel}] Seed failed (exit=${result.exitCode}). ` +
        `Review vite-node output for details:\n${msgTail}`,
    );
  }
}
