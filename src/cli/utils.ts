/**
 * @infra/prisma — Prisma CLI 유틸 함수 모음
 * ------------------------------------------------------------------
 * @migrated from @infra/runtime/src/generator/prisma/utils.ts (2026-10-07)
 * ------------------------------------------------------------------
 * - Prisma 바이너리 3단계 fallback resolution
 * - spawn 기반 CLI 실행 래퍼 (stdio: pipe/inherit 옵션 지원)
 * - 경로 유틸 (schema dir, config path, client output dir)
 * - 출력 무결성 검사, 환경변수 빌더, exit 코드 assertion
 *
 * ⚠️ Node.js 20 LTS / @types/node 20.19.9 타입 시스템 공식 기준 (2026-10-07 확인)
 * ------------------------------------------------------------------
 * - 공식 d.ts 구조: node_modules/.pnpm/@types+node@20.19.9/.../child_process.d.ts
 *   line 85:   `class ChildProcess extends EventEmitter`
 *   line 550:  `on(event: string, listener: ...): this`  ← on() 메서드 실제 존재
 *
 * - "Property 'on' does not exist" IDE 오류가 뜨는 원인:
 *   TS Language Server 버전에 따라 declare-module class 상속 체인 추적이
 *   끊어지는 알려진 케이스.
 *   → types/index.d.ts 의 `SpawnChildProcess = ChildProcess & EventEmitter` 인터섹션으로 해결.
 */
import { spawn } from 'node:child_process';
import { existsSync, promises as fsPromises, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { workspaceRoot } from '@nx/devkit';

import { PATH } from '@infra/definitions';

import { PRISMA } from '../constants';
import type {
  CleanupOptions,
  CleanupResult,
  PrismaAction,
  PrismaCliOptions,
  PrismaCliResult,
  PrismaLayoutValidationEnv,
  PrismaOtsName,
  PrismaProjectLayoutContext,
  PrismaStdioMode,
  SpawnChildProcess,
} from '../types';

/**
 * Prisma CLI 바이너리 경로를 3단계 fallback 으로 resolve 한다.
 *
 * Resolution 우선순위:
 *   1. `cwd` 로컬 프로젝트 node_modules/.bin/prisma  (특정 버전 override 우선)
 *   2. Monorepo 워크스페이스 루트 node_modules/.bin/prisma  (대부분의 일반적인 케이스)
 *   3. 프로세스 cwd 의 node_modules/.bin/prisma  (NX executor 등에서 상이할 경우 fallback)
 *   4. 전역 PATH 의 `prisma` 명령 (모두 없을 때 최종 fallback)
 *
 * @param cwd - 탐색 기준 프로젝트 디렉토리 (prisma schema/config 가 존재하는 폴더).
 *              생략시 monorepo workspaceRoot 를 기본값으로 사용.
 * @returns 사용 가능한 Prisma CLI 바이너리 절대 경로, 혹은 fallback 으로 "prisma" 문자열
 */
export function resolvePrismaBin(cwd: string = workspaceRoot): string {
  const local = resolve(cwd, 'node_modules/.bin/prisma');
  if (existsSync(local)) {
    return local;
  }
  const workspace = join(workspaceRoot, 'node_modules/.bin/prisma');
  if (existsSync(workspace)) {
    return workspace;
  }
  const global = resolve(process.cwd(), 'node_modules/.bin/prisma');
  if (existsSync(global)) {
    return global;
  }
  return 'prisma';
}

/**
 * Prisma CLI 를 subprocess 로 실행하고 stdout/stderr/exitCode 를 Promise 로 묶어 반환한다.
 *
 * - `stdio: 'pipe'` (기본값): 출력을 캡처해서 반환 객체에 담는다. 자동화 / 오케스트레이터 / 디버깅 메시지 세밀화에 적합.
 * - `stdio: 'inherit'`: Prisma CLI 출력을 부모 터미널에 그대로 직접 흘려보낸다. 개발자가 Prisma 스타일의 colored output을 직접 보고 싶을 때 사용.
 *
 * @param prismaBin - {@link resolvePrismaBin} 으로 미리 resolve 한 Prisma CLI 경로
 * @param args     - Prisma CLI subcommand + args 배열  (예: `['db', 'push', '--config', './prisma.config.ts']`)
 * @param cwd      - Prisma CLI 를 실행할 작업 디렉토리 (project root). 기본값 workspaceRoot.
 * @param env      - 추가 주입할 환경변수 (process.env 와 병합)
 * @param stdio    - 스트림 모드 선택. 기본값 'pipe' (자동화에 적합)
 * @returns `{ exitCode, stdout, stderr }` 를 resolve 하는 Promise
 * @see PrismaStdioMode — 파라미터 허용값 union 정의
 */
export function runPrismaCli(
  prismaBin: string,
  args: string[],
  cwd: string = workspaceRoot,
  env?: NodeJS.ProcessEnv,
  stdio: PrismaStdioMode = 'pipe',
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child: SpawnChildProcess = spawn(prismaBin, args, {
      cwd,
      env: { ...process.env, ...(env ?? {}) },
      stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    }) as SpawnChildProcess;

    let stdout = '';
    let stderr = '';

    if (stdio === 'pipe') {
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', reject);
    child.on('close', (exitCode: number | null) => {
      resolvePromise({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}

/**
 * Prisma schema 파일(.prisma) 들이 모여있는 디렉토리 경로를 반환한다.
 *
 * SSoT 경로: `${projectRoot}/src/prisma/${otsName}`
 *
 * @param otsName     - Operational Target Schema 인스턴스 이름 (예: 'main', 'analytics')
 *                      🔒 SSoT: 실제 config.local.json 에 정의된 인스턴스 키만 타입으로 허용
 *                      @see PrismaOtsName
 * @param projectRoot - Prisma 설정을 갖는 프로젝트 루트 경로. 기본값 workspaceRoot.
 */
export function getPrismaSchemaDir(
  otsName: PrismaOtsName,
  projectRoot: string = workspaceRoot,
): string {
  return resolve(projectRoot, 'src', 'prisma', otsName as string);
}

/**
 * 프로젝트별 prisma.config.ts 파일 경로를 반환한다.
 *
 * SSoT 경로: `${projectRoot}/prisma.config.ts`
 *
 * @param projectRoot - Prisma 설정을 갖는 프로젝트 루트 경로. 기본값 workspaceRoot.
 */
export function getPrismaConfigPath(projectRoot: string = workspaceRoot): string {
  return resolve(projectRoot, 'prisma.config.ts');
}

/**
 * Prisma Client 코드 생성 결과물이 저장될 디렉토리 경로를 반환한다.
 *
 * 우선순위:
 *   1. `envClientOutput` (env `PRISMA_CLIENT_OUTPUT`) 가 있을 경우 → 해당 경로 override
 *   2. 없을 경우 기본 경로 `${projectRoot}/generated/prisma/${otsName}`
 *
 * @param otsName          - Operational Target Schema 인스턴스 이름 (예: 'main', 'analytics')
 *                           🔒 SSoT: 실제 config 에 정의된 인스턴스 키만 타입으로 허용
 * @param envClientOutput  - 환경변수 PRISMA_CLIENT_OUTPUT 값 (optional)
 * @param projectRoot      - Prisma 설정을 갖는 프로젝트 루트 경로. 기본값 workspaceRoot.
 */
export function getClientOutputDir(
  otsName: PrismaOtsName,
  envClientOutput: string | undefined,
  projectRoot: string = workspaceRoot,
): string {
  if (envClientOutput) {
    return resolve(projectRoot, envClientOutput);
  }
  return resolve(projectRoot, 'generated', 'prisma', otsName as string);
}

/**
 * Prisma schema cache manifest 를 저장하는 디렉토리 경로를 반환한다.
 *
 * SSoT 경로: `PATH.CACHE.PRISMA/<project_normalized>/<otsName>`
 * - projectRoot 를 `[a-zA-Z0-9_-]` 외 문자는 `_` 로 치환 → 파일명으로 안전하게 사용
 *
 * @param otsName     - Operational Target Schema 인스턴스 이름
 * @param projectRoot - Prisma 설정을 갖는 프로젝트 루트 경로. 기본값 workspaceRoot.
 */
export function getManifestDir(
  otsName: PrismaOtsName,
  projectRoot: string = workspaceRoot,
): string {
  const normalized = projectRoot.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(PATH.CACHE.PRISMA, normalized, otsName as string);
}

/**
 * Prisma schema cache manifest JSON 파일의 절대 경로를 반환한다.
 *
 * @param otsName     - Operational Target Schema 인스턴스 이름
 * @param projectRoot - Prisma 설정을 갖는 프로젝트 루트 경로. 기본값 workspaceRoot.
 * @returns `${getManifestDir()}/${PRISMA.CACHE_MANIFEST_FILENAME}`
 */
export function getManifestPath(
  otsName: PrismaOtsName,
  projectRoot: string = workspaceRoot,
): string {
  return join(getManifestDir(otsName, projectRoot), PRISMA.CACHE_MANIFEST_FILENAME);
}

/**
 * Prisma generate 결과물 디렉토리가 "완전하게 생성된 상태"인지 체크한다.
 *
 * 검사 대상 필수 파일 3종:
 *   - `index.js`  (CommonJS / ESM dual build 결과물)
 *   - `index.d.ts`  (타입 정의)
 *   - `package.json`  (Prisma Client 패키지 메타데이터)
 *
 * 3종 모두 존재하고 size > 0 이어야 true 를 반환한다.
 * 캐시 hit 판정 전에 실제 출력물이 깨지지 않았는지 사전 검증할 때 사용한다.
 *
 * @param clientOutputDir - {@link getClientOutputDir} 로 resolve 한 Prisma Client output 경로
 */
export function isOutputIntact(clientOutputDir: string): boolean {
  for (const file of PRISMA.OUTPUT_REQUIRED_FILES) {
    const p = resolve(clientOutputDir, file);
    try {
      const st = statSync(p);
      if (!st.isFile() || st.size === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Prisma CLI 관련 환경변수를 모아서 spawn env 로 주입할 객체를 빌드한다.
 *
 * Prisma CLI 는 DATABASE_TYPE / OTS_NAME 을 통한 dynamic datasource resolution 을
 * 지원하므로, 이 두 값은 반드시 process.env 로 전달되어야 prisma.config.ts 내부의
 * connection builder 가 정확한 DB URL 을 조립할 수 있다.
 *
 * @param options - project root + Prisma env 정보를 담은 옵션
 */
export function buildPrismaEnv(options: PrismaCliOptions): NodeJS.ProcessEnv {
  return {
    DATABASE_TYPE: options.env.DATABASE_TYPE,
    OTS_NAME: options.env.OTS_NAME,
    PRISMA_CLIENT_OUTPUT: options.env.PRISMA_CLIENT_OUTPUT,
    ...(options.env.PROJECT_NAME ? { PROJECT_NAME: options.env.PROJECT_NAME } : {}),
  };
}

/**
 * Prisma CLI 실행 결과의 exitCode 를 검사하고 0 이 아니면 Error 를 throw 한다.
 *
 * - 실패시 에러 메시지에 stderr (없을 경우 stdout) 를 그대로 첨부 → 디버깅시 Prisma 가 내놓은
 *   실제 실패 원인 메시지를 개발자가 그대로 확인 가능.
 * - 에러 객체에 `result` 프로퍼티를 붙여서 호출자가 결과 객체를 다시 구조분해 해서
 *   retry logic / 메시지 세분화 등에 재사용 가능.
 *
 * @param result  - runPrismaCli 가 반환한 실행 결과 ({@link PrismaCliResult})
 * @param command - 에러 메시지에 표시할 subcommand 이름 (예: 'generate', 'db push')
 * @throws `Error & { result: PrismaCliResult }` exitCode != 0 일 경우
 */
export function assertResultOk(
  result: PrismaCliResult,
  command: string,
): asserts result is PrismaCliResult & { exitCode: 0 } {
  if (result.exitCode !== 0) {
    const error = new Error(
      `Prisma ${command} failed (exitCode=${result.exitCode}).\n${result.stderr || result.stdout}`,
    );
    Object.assign(error, { result });
    throw error;
  }
}

/**
 * Prisma 작업 수행 전 프로젝트 레이아웃 공통 유효성 검사.
 *
 * - Schema 디렉토리 (${projectRoot}/src/prisma/<ots>) 존재 여부
 * - prisma.config.ts 설정 파일 존재 여부
 * - client output 디렉토리 경로 resolve + 반환
 *
 * generate / db push / seed 모든 단계에서 공통으로 필요하므로, 매번 6줄
 * if/throw 중복 코드를 쓰지 않고 이 유틸 한 번 호출로 해결.
 *
 * @param env           - PrismaLayoutValidationEnv (OTS_NAME / DATABASE_TYPE / PRISMA_CLIENT_OUTPUT)
 * @param action        - 실행하려는 액션 이름 (에러 메시지 prefix 용도)
 * @param projectRoot   - 프로젝트 루트 경로. 기본 workspaceRoot
 * @returns `PrismaProjectLayoutContext` — 검증이 끝난 3종 디렉토리/파일 경로 묶음
 * @see PrismaLayoutValidationEnv — env 파라미터 타입 정의 (PrismaEnv Pick 3종, definitions SSoT 기반)
 * @see PrismaAction — action 허용값 union 정의 (NX.PRISMA_ACTION 기반 + CLI-level 확장)
 */
export function validatePrismaProjectLayout(
  env: PrismaLayoutValidationEnv,
  action: PrismaAction,
  projectRoot: string = workspaceRoot,
): PrismaProjectLayoutContext {
  const schemaDir = getPrismaSchemaDir(env.OTS_NAME, projectRoot);
  const prismaConfigPath = getPrismaConfigPath(projectRoot);
  const clientOutputDir = getClientOutputDir(env.OTS_NAME, env.PRISMA_CLIENT_OUTPUT, projectRoot);

  if (!existsSync(schemaDir)) {
    throw new Error(`[Prisma ${action}] Schema directory not found: ${schemaDir}`);
  }
  if (!existsSync(prismaConfigPath)) {
    throw new Error(`[Prisma ${action}] prisma.config.ts not found: ${prismaConfigPath}`);
  }

  return { schemaDir, prismaConfigPath, clientOutputDir };
}

// ============================================================
// 🧹 Cleanup — Generated Artifacts 정리 (Client Output + Cache Manifest)
// ============================================================
/**
 * Prisma 가 생성한 아티팩트(generated client output 디렉토리 + 캐시 manifest 파일)를
 * 통째로 삭제하고 깨끗한 상태로 재생성할 준비를 한다.
 *
 * ✨ 주요 사용 시나리오 3가지:
 *   1. Prisma 패키지 버전 업그레이드 — 구버전 generated 코드가 잔존하여 import mismatch
 *   2. Cache manifest corruption — 파일시스템 mtime / size sync 오류로 cache hit 강제되는 케이스
 *   3. Schema 대규모 재구성 — output 이름 / 경로가 바뀌어 구 디렉토리가 고아로 남는 케이스
 *
 * 🔒 Precise Touch 보장 (절대 잘못된 파일 삭제 없음):
 *   - schema 파일 (`.prisma`) 은 **절대 삭제하지 않음**
 *   - 삭제 대상은 **오직** 2가지 뿐
 *       ① `PRISMA_CLIENT_OUTPUT` 디렉토리 (generated client 3종 파일 포함)
 *       ② `PRISMA.CACHE_MANIFEST_FILENAME` manifest 파일
 *   - 존재하지 않는 경로는 skip 하고 removedPaths 목록에도 넣지 않음 (정직한 보고)
 *   - 기본적으로 `dryRun` 모드를 먼저 사용해서 삭제 대상 경로를 사전 확인 가능
 *
 * @param options — CleanupOptions (otsName 필수 / projectRoot, dryRun, keepManifest 선택)
 * @returns CleanupResult (otsName, dryRun, removedPaths, errors)
 *
 * @example
 * ```ts
 * // 1️⃣ 먼저 dryRun 으로 삭제 대상 확인 (파일 시스템 변화 없음!)
 * const plan = await cleanPrismaArtifacts({
 *   otsName: 'main',
 *   projectRoot: '/path/to/domains/structure',
 *   dryRun: true,
 * });
 * console.log('삭제 예정:', plan.removedPaths);
 *
 * // 2️⃣ 괜찮으면 실제 실행
 * const result = await cleanPrismaArtifacts({
 *   otsName: 'main',
 *   projectRoot: '/path/to/domains/structure',
 * });
 * if (result.errors.length) console.warn('일부 파일 삭제 실패:', result.errors);
 * ```
 */
export async function cleanPrismaArtifacts(options: CleanupOptions): Promise<CleanupResult> {
  const { otsName, projectRoot = workspaceRoot, dryRun = false, keepManifest = false } = options;

  const errors: CleanupResult['errors'] = [];
  const removedPaths: string[] = [];

  // --- 삭제 대상 ①: PRISMA_CLIENT_OUTPUT generated client 디렉토리 --------------
  // OTS 환경변수 주입이 없어도 직접 경로 resolve 가능하도록, 기존 output dir 패턴과
  // 완전히 동일한 `generated/prisma/<ots>` 경로를 join 으로 구성.
  const clientOutputDir = join(projectRoot, 'generated', 'prisma', String(otsName));
  if (existsSync(clientOutputDir)) {
    // manifest 파일도 같이 지우는 옵션 (clientOutputDir 내부에 저장된 경우도 있으므로 함께 고려)
    removedPaths.push(clientOutputDir);
    if (!dryRun) {
      try {
        rmSync(clientOutputDir, { recursive: true, force: true });
      } catch (err) {
        errors.push({
          path: clientOutputDir,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // --- 삭제 대상 ②: 캐시 manifest 파일 (별도 cache 디렉토리에 저장된 케이스) --------
  if (!keepManifest) {
    const manifestDir = getManifestDir(otsName, projectRoot);
    const manifestPath = join(manifestDir, PRISMA.CACHE_MANIFEST_FILENAME);
    if (existsSync(manifestPath)) {
      removedPaths.push(manifestPath);
      if (!dryRun) {
        try {
          await fsPromises.rm(manifestPath, { force: true });
        } catch (err) {
          errors.push({
            path: manifestPath,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  return {
    otsName,
    dryRun,
    removedPaths,
    errors,
  };
}
