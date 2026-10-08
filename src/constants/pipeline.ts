/**
 * @file Prisma Pipeline — 4단계 오케스트레이터 상수 (Step ⑥)
 * ------------------------------------------------------------------
 * prisma.sh L224-L278 쉘 flow 와 1:1 매칭.
 */

/**
 * Prisma Pipeline 스테이지 실행 순서 SSoT.
 * retry loop 안에서는 STAGE_ORDER[0..2] (=push, generate, seed) 만 순회하며,
 * 성공 통과 후에 마지막 STAGE_ORDER[3] (=studio) 를 백그라운드 실행.
 */
const PIPELINE_STAGE_ORDER = ['push', 'generate', 'seed', 'studio'] as const;
/**
 * n=0 (첫 실행) 일 때 force-reset 이후 실행하는 스테이지.
 * generate 는 n=0 에서만 명시적으로 수행 (n>=1 부터는 push 후 generate 생략 가능)
 */
const PIPELINE_INITIAL_STAGES = ['push', 'generate', 'seed'] as const;
/**
 * n>=1 (재시도) 일 때 수행하는 스테이지.
 * 이미 n=0 에서 schema & client 가 생성되었으므로 일반 push + seed 만 재실행.
 * (DB 스키마는 이미 존재하므로 push 는 no-op / schema diff 있을 경우만 적용)
 */
const PIPELINE_RETRY_STAGES = ['push', 'seed'] as const;
/**
 * Prisma Studio 기본 포트. 3000 = prisma.sh 원본 default 와 동일.
 */
const PIPELINE_DEFAULT_STUDIO_PORT = 3_000 as const;

export {
  PIPELINE_STAGE_ORDER,
  PIPELINE_INITIAL_STAGES,
  PIPELINE_RETRY_STAGES,
  PIPELINE_DEFAULT_STUDIO_PORT,
};
