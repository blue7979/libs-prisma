import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Prisma 스키마 파일들이 PRISMA_CLIENT_OUTPUT 환경 변수를 올바르게 사용하는지 검증합니다.
 */
export function checkPrismaSchema(schemaDir: string): void {
  const files = readdirSync(schemaDir).filter((file) => file.endsWith('.prisma'));
  if (files.length === 0) {
    throw new Error(
      `[PrismaConfig] No .prisma schema files found in the directory '${schemaDir}'.`,
    );
  }

  for (const file of files) {
    const filePath = join(schemaDir, file);
    const content = readFileSync(filePath, 'utf8');
    if (!content.includes('PRISMA_CLIENT_OUTPUT')) {
      throw new Error(
        `[PrismaConfig] The schema file '${file}' is missing the required 'PRISMA_CLIENT_OUTPUT' environment variable setting.`,
      );
    }
  }
}
