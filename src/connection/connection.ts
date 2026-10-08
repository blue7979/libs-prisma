/**
 * @infra/prisma — Connection URL 빌더 (Prisma 전용 구현)
 * ------------------------------------------------------------------
 * ✅ Option C 원칙 준수: Prisma 패키지 내부에 완전 독립적 구현 (utils 의존 0)
 *
 * - isRunningInContainer: @infra/utils 와 100% 동일 로직을 prisma 패키지 내부에 중복 구현
 *   → Barrel Import Only 규칙 준수 (utils deep import ❌)
 * - 설정값 읽기: @infra/config/getOtsConfig() 직접 사용 (OTS SSoT 100% 준수)
 * - 프로토콜 강제: Postgres = prisma+postgres (Prisma 공식 스펙), Mongodb = mongodb
 */

import fs from 'node:fs';

import { getOtsConfig } from '@infra/config';
import { DOCKER, PORTS } from '@infra/definitions';

import type { PrismaOtsName } from '../types';
import type {
  PrismaPostgresConnectionBuildOptions,
  PrismaMongodbConnectionBuildOptions,
} from '../types/connection';

const DEFAULT_POSTGRES_PORT = PORTS.INFRA.postgres;
const DEFAULT_MONGODB_PORT = PORTS.INFRA.mongodb;

/**
 * prisma 패키지 독립 실행 환경 감지 헬퍼.
 * ✅ 로직 1:1 대응 — @infra/utils/src/cli-process/process.ts isRunningInContainer
 *    (option C 완전 분리 원칙에 따른 중복 구현 — barrel export 안된 유틸 deep import 방지)
 */
function _isRunningInContainer(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    fs.statSync('/.dockerenv');
    return true;
  } catch {
    /* /.dockerenv 없음 → 다음 체크로 */
  }
  try {
    const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
    return cgroup.includes('docker') || cgroup.includes('lxc') || cgroup.includes('kubepods');
  } catch {
    return false;
  }
}

/**
 * Prisma ORM PostgreSQL 전용 연결 URL 생성 함수.
 *
 * ✅ 프로토콜 고정: prisma+postgres:// (Prisma 드라이버 어댑터에서만 유효)
 * ✅ 환경 분기:
 *   - 컨테이너 내부(도커 네트워크): postgres-{serviceName} hostname + 기본 포트(5432)
 *   - 로컬 개발(호스트 머신): localhost + config.local.json 에 설정된 localPort
 *   - forceContainerFormat=true: 무조건 컨테이너 hostname 형식 강제
 * ✅ SSoT: 인스턴스 존재 여부와 credential 값은 전부 @infra/config/getOtsConfig 로 읽음
 *
 * @param name  - OTS postgres 인스턴스 이름 (자동완성: 'main' | ...)
 * @param opts  - forceContainerFormat 옵션
 * @returns prisma+postgres://user:pass@host:port/dbname 형식의 URL
 * @throws UndefinedConfigError (getOtsConfig 내부에서 던짐 — 해당 인스턴스 설정 없을 때)
 *
 * @see /libs/infra/config/src/ots.ts — OTS 인스턴스 설정 읽기 SSoT
 */
export function buildPrismaPostgresConnectionUrl(
  name: PrismaOtsName<'postgres'>,
  opts: PrismaPostgresConnectionBuildOptions = {},
): string {
  const { forceContainerFormat = false } = opts;
  const cfg = getOtsConfig('postgres', name);

  const {
    POSTGRESQL_USERNAME = '',
    POSTGRESQL_PASSWORD = '',
    POSTGRESQL_DATABASE = '',
  } = cfg as unknown as Record<string, string | undefined>;

  const internalHostName = `postgres-${name}`;
  const inContainer = forceContainerFormat || _isRunningInContainer();
  const host = inContainer ? internalHostName : 'localhost';
  const port = inContainer ? DEFAULT_POSTGRES_PORT : (cfg.localPort ?? DEFAULT_POSTGRES_PORT);

  return `prisma+postgres://${encodeURIComponent(POSTGRESQL_USERNAME)}:${encodeURIComponent(POSTGRESQL_PASSWORD)}@${host}:${port}/${POSTGRESQL_DATABASE}`;
}

/**
 * Prisma ORM MongoDB 전용 연결 URL 생성 함수.
 *
 * ✅ MongoDB Prisma 드라이버는 범용 mongodb:// 프로토콜 그대로 사용
 *    (postgres 와 달리 prisma+ 접두사 없음 — Prisma 공식 스펙)
 * ✅ authSource=admin 강제 주입 (루트 유저 인증시 필수 쿼리 파라미터)
 * ✅ 기타 환경 분기 로직은 Postgres 빌더와 동일
 *
 * @param name  - OTS mongodb 인스턴스 이름 (자동완성: 'main-mongo' | ...)
 * @param opts  - forceContainerFormat 옵션
 * @returns mongodb://user:pass@host:port/dbname?authSource=admin 형식의 URL
 * @throws UndefinedConfigError
 */
export function buildPrismaMongodbConnectionUrl(
  name: PrismaOtsName<'mongodb'>,
  opts: PrismaMongodbConnectionBuildOptions = {},
): string {
  const { forceContainerFormat = false } = opts;
  const cfg = getOtsConfig('mongodb', name);

  const {
    MONGODB_ROOT_USER = '',
    MONGODB_ROOT_PASSWORD = '',
    MONGODB_DATABASE = '',
  } = cfg as unknown as Record<string, string | undefined>;

  const internalHostName = `mongodb-${name}`;
  const inContainer = forceContainerFormat || _isRunningInContainer();
  const host = inContainer ? internalHostName : DOCKER.CONTAINER.LOCAL_HOST;
  const port = inContainer ? DEFAULT_MONGODB_PORT : (cfg.localPort ?? DEFAULT_MONGODB_PORT);

  return `mongodb://${encodeURIComponent(MONGODB_ROOT_USER)}:${encodeURIComponent(MONGODB_ROOT_PASSWORD)}@${host}:${port}/${MONGODB_DATABASE}?authSource=admin`;
}
