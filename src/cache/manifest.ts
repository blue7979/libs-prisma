/**
 * @infra/prisma — Prisma schema generate cache manifest v1
 * ------------------------------------------------------------------
 * @migrated from @infra/runtime/src/generator/prisma/cache.ts (2026-10-07)
 * ------------------------------------------------------------------
 * 캐시 정책 (원래 설계 그대로 유지):
 *   1. 출력 파일 3종 모두 정상 생성 + size > 0 확인 (intact check)
 *   2. `PATH.CACHE.PRISMA/<project>/<ots>/cache-manifest.json` manifest 존재
 *   3. manifest.version === PRISMA.CACHE_MANIFEST_VERSION
 *   4. manifest.schemaFiles 의 모든 파일 size / mtimeMs 이 현재 fs 상태와 100% 일치
 *   → 4가지 모두 만족시 heavy work(prisma generate) 를 스킵하고 cache hit 로 간주.
 *
 * Atomic write: writeManifest → tmp 파일 write + rename 단일 트랜잭션
 *   → 프로세스 중간 크래시 시 half-written manifest 로 인한 false cache hit 방지.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';

import { isOutputIntact, getManifestPath } from '../cli/utils';
import { PRISMA } from '../constants';
import type {
  GenerateResult,
  Maybe,
  PrismaCliResult,
  PrismaOtsName,
  SchemaManifest,
  WithCacheParams,
} from '../types';

/**
 * 주어진 schema 디렉토리 내부의 모든 `.prisma` 파일의 size / mtimeMs 를
 * key-value 형태로 수집한다. manifest 에 저장될 스키마 핑거프린트 생성용.
 *
 * @param schemaDir - `getPrismaSchemaDir` 로 resolve 한 schema 파일 디렉토리
 * @returns `{ [filename]: { size, mtimeMs } }` 형태의 record
 */
export function collectSchemaFiles(
  schemaDir: string,
): Record<string, { size: number; mtimeMs: number }> {
  const result: Record<string, { size: number; mtimeMs: number }> = {};
  const entries = readdirSync(schemaDir).filter((f) => f.endsWith('.prisma'));
  for (const file of entries) {
    const p = join(schemaDir, file);
    const st = statSync(p);
    result[file] = { size: st.size, mtimeMs: st.mtimeMs };
  }
  return result;
}

/**
 * manifest 파일 읽기 래퍼 — 실패나 파싱 오류시 null 반환, throw 하지 않음.
 * @internal (private) — cache 모듈 내부에서만 사용.
 */
function _readManifestAtomic<T = unknown>(manifestPath: string): Maybe<T> {
  try {
    const raw = readFileSync(manifestPath, { encoding: 'utf-8' });
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * manifest 파일 원자적 쓰기 — `.tmp.<pid>.<timestamp>` → rename 단일 rename
 * - 절반 쓰여진 상태에서 프로세스가 죽어도 다음 읽기에서 누락 감지 → false cache hit 방지
 * @internal (private) — cache 모듈 내부에서만 사용.
 */
function _writeManifestAtomic<T>(manifestPath: string, payload: T): void {
  const dir = join(manifestPath, '..');
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${manifestPath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: 'utf-8' });
  renameSync(tmpPath, manifestPath);
}

/**
 * Schema / output 이 모두 동일하고 변경이 없어 prisma generate 를 스킵해도 되는지
 * 4단계 체크를 모두 수행하여 캐시 히트 여부를 반환한다.
 *
 * 체크 순서:
 *   1. `isOutputIntact(clientOutputDir)` — 출력 파일 3종 intact 확인
 *   2. manifest 파일 존재 + JSON parse 성공
 *   3. manifest.version === 현재 코드의 VERSION
 *   4. 모든 스키마 파일의 size / mtimeMs 가 manifest 기록과 100% 일치
 *
 * @param projectRoot       - 프로젝트 루트. 기본값 workspaceRoot
 * @param otsName           - Operational Target Schema 인스턴스 이름
 * @param schemaDir         - `getPrismaSchemaDir` 로 resolve 한 schema 디렉토리 경로
 * @param clientOutputDir   - `getClientOutputDir` 로 resolve 한 Prisma Client output 디렉토리
 */
export function isSchemaCached(
  otsName: PrismaOtsName,
  schemaDir: string,
  clientOutputDir: string,
  projectRoot: string = workspaceRoot,
): boolean {
  if (!isOutputIntact(clientOutputDir)) return false;

  const manifestPath = getManifestPath(otsName, projectRoot);
  const manifest = _readManifestAtomic<SchemaManifest>(manifestPath);
  if (!manifest) return false;
  if (manifest.version !== PRISMA.CACHE_MANIFEST_VERSION) return false;
  if (manifest.schemaDir !== schemaDir) return false;

  try {
    const current = collectSchemaFiles(schemaDir);
    const keys = new Set([...Object.keys(manifest.schemaFiles), ...Object.keys(current)]);
    for (const k of keys) {
      const a = manifest.schemaFiles[k];
      const b = current[k];
      if (!a || !b) return false;
      if (a.size !== b.size || a.mtimeMs !== b.mtimeMs) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * prisma generate 성공 후 호출하여 현재 schema files 의 핑거프린트를
 * manifest 파일로 원자적 저장한다.
 *
 * @param projectRoot - 프로젝트 루트. 기본값 workspaceRoot
 * @param otsName     - Operational Target Schema 인스턴스 이름
 * @param schemaDir   - Schema 파일이 위치한 디렉토리
 */
export function writeManifest(
  otsName: PrismaOtsName,
  schemaDir: string,
  projectRoot: string = workspaceRoot,
): void {
  const schemaFiles = collectSchemaFiles(schemaDir);
  const manifest: SchemaManifest = {
    version: PRISMA.CACHE_MANIFEST_VERSION,
    schemaDir,
    schemaFiles,
    generatedAt: new Date().toISOString(),
  };
  const manifestPath = getManifestPath(otsName, projectRoot);
  _writeManifestAtomic(manifestPath, manifest);
}

/**
 * prisma generate 호출을 감싸는 고차함수.
 * - 캐시 사용 + 스키마가 변경되지 않았다면 heavyWork 를 건너뛰고 cache hit 결과 반환 (< 1ms)
 * - 캐시 miss 인 경우 heavyWork 실행 → exit 0 일 때 manifest 기록 (실패시 기록 안함, 다음 재시도 위해)
 *
 * @param params     - {@link WithCacheParams} 캐시 파라미터
 * @param heavyWork  - 실제 prisma generate subprocess 를 실행하는 비동기 함수
 * @returns `{ hit: boolean, result: GenerateResult }` — cache hit 여부와 결과 최종 묶음
 */
export async function withSchemaCache<T extends PrismaCliResult>(
  params: WithCacheParams,
  heavyWork: (ctx: { schemaDir: string; clientOutputDir: string }) => Promise<T>,
): Promise<{ hit: boolean; result: GenerateResult }> {
  const projectRoot = params.projectRoot ?? workspaceRoot;
  const { otsName, schemaDir, prismaConfigPath, clientOutputDir, useCache } = params;

  if (useCache && isSchemaCached(otsName, schemaDir, clientOutputDir, projectRoot)) {
    return {
      hit: true,
      result: {
        schemaDir,
        prismaConfigPath,
        clientOutputDir,
        exitCode: 0,
        stdout: '[cache hit] prisma generate skipped.',
        stderr: '',
        cacheHit: true,
      },
    };
  }

  const result = await heavyWork({ schemaDir, clientOutputDir });

  if (result.exitCode === 0) {
    try {
      writeManifest(otsName, schemaDir, projectRoot);
    } catch {
      // manifest write 실패는 generate 자체 결과에는 영향을 주지 않는다.
      // 단순히 다음번에 cache miss 로 한 번 더 실행될 것.
    }
  }

  return {
    hit: false,
    result: { ...result, cacheHit: false },
  };
}
