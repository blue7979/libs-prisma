/**
 * @file Prisma Generate Output — 결과물 무결성 검증 상수
 *
 * Prisma 7+ 는 index.js / index.d.ts / package.json 없이
 * TypeScript 소스 형태로 client 를 직접 생성한다.
 * 항상 생성되는 핵심 파일은 client.ts 와 models.ts 이다.
 * (enums.ts / commonInputTypes.ts 는 schema 에 enum / input type 이 있을 때만 생성)
 */
const OUTPUT_REQUIRED_FILES = ['client.ts', 'models.ts'] as const;

export { OUTPUT_REQUIRED_FILES };
