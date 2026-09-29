import path from 'path';

// 서버 3개를 각각 별도 포트와 DB로 띄운다.
//  - main:    병렬 실행되는 일반 테스트 (각 테스트가 고유한 사용자를 만들어 서로 격리)
//  - isoApi:  전체 글 개수에 의존하는 API 테스트 (파일 1개, 순차 실행, 테스트마다 DB 초기화)
//  - isoUi:   전체 글 개수에 의존하는 UI 테스트 (파일 1개, 순차 실행, 테스트마다 DB 초기화)
const ROOT = path.resolve(__dirname, '..', '..');
const dbFile = (name: string) => path.join(ROOT, 'test-data', `${name}.db`);

export const MAIN = { port: 3100, db: dbFile('main') };
export const ISO_API = { port: 3101, db: dbFile('iso-api') };
export const ISO_UI = { port: 3102, db: dbFile('iso-ui') };
