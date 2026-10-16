import { existsSync } from 'fs';
import { join } from 'path';

/**
 * seed 실행 스크립트 명령어 문자열을 환경에 맞게 동적으로 반환합니다.
 */
export function getPrismaSeedCommand(projectPath: string, serviceName: string): string | undefined {
  const stage = process.env.STAGE;

  // STAGE 환경이 local 혹은 staging일 때만 동작
  if (stage !== 'local' && stage !== 'staging') {
    return undefined;
  }

  const seedIndexPath = join(projectPath, 'src', 'seeds', serviceName, 'index.ts');

  // 해당 인스턴스에 대한 seed/index.ts 파일이 존재할 경우 tsx로 실행하는 명령어 반환
  if (existsSync(seedIndexPath)) {
    return `npx tsx src/seeds/${serviceName}/index.ts`;
  }

  return undefined;
}
