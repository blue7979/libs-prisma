/**
 * @infra/prisma — Connection URL 빌더 타입 모음
 * ------------------------------------------------------------------
 * Prisma ORM 과 범용 데이터베이스 클라이언트(pg, mongodb 등) 가 각각
 * 사용하는 연결 URL 문자열을 타입 안전하게 생성하기 위한 옵션 / 프로토콜 타입.
 *
 * SSoT 연계:
 *   - OTS 인스턴스 이름 = PrismaOtsName<T>
 *   - 런타임 설정 = @infra/config getOtsConfig() 함수 직접 호출
 *
 * 분류 원칙 (Option C 의 핵심):
 *   - prisma 패키지 쪽은 Prisma 가 공식 지원하는 프로토콜만 강제 (prisma+postgres)
 *   - 범용 클라이언트용은 @infra/utils 에 buildStandardPostgresUrl / Mongodb 로 분리
 */

import type { PrismaDatabaseType, PrismaOtsName } from './core';

/**
 * Prisma / 범용 DB 에서 사용하는 연결 프로토콜 SSoT.
 * ✅ Prisma 공식 문서 기준:
 *   - PostgreSQL Prisma 전용: `prisma+postgres://`
 *   - PostgreSQL 범용 클라이언트(pg 등): `postgresql://`
 *   - MongoDB (Prisma 포함 mongodb 드라이버 공통): `mongodb://`
 */
export type PrismaConnectionProtocol = 'prisma+postgres' | 'postgresql' | 'mongodb';

/**
 * 모든 Connection URL 빌더 함수의 공통 옵션 SSoT.
 */
export interface PrismaConnectionBuildOptions {
  /**
   * true 로 설정시 실행 환경(container 여부) 무시하고 "무조건"
   * Docker 네트워크 내부 호스트명(= container hostname) + 기본 포트로 포맷.
   * "같은 compose network 안에서 A 컨테이너 → B 컨테이너" 접속 시나리오 등에 사용.
   * @default false
   */
  forceContainerFormat?: boolean;
}

/**
 * PostgreSQL 계열 URL 빌더 공통 옵션 타입.
 * @see buildPrismaPostgresConnectionUrl
 * @see buildStandardPostgresConnectionUrl (utils 쪽)
 */
export interface PrismaPostgresConnectionBuildOptions extends PrismaConnectionBuildOptions {
  /** OTS 인스턴스 이름 (PrismaOtsName<'postgres'> 자동 완성) */
  name?: PrismaOtsName<'postgres'>;
}

/**
 * MongoDB 계열 URL 빌더 공통 옵션 타입.
 * (mongodb Prisma 드라이버와 범용 mongodb 드라이버가 프로토콜 동일하게 mongodb:// 사용)
 */
export interface PrismaMongodbConnectionBuildOptions extends PrismaConnectionBuildOptions {
  /** OTS 인스턴스 이름 (PrismaOtsName<'mongodb'> 자동 완성) */
  name?: PrismaOtsName<'mongodb'>;
}

export type { PrismaDatabaseType };
