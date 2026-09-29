// 테스트용 서버 기동 스크립트: 실행 전에 이전 DB 파일을 지워서 항상 빈 DB로 시작한다.
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH;
if (!dbPath) throw new Error('DB_PATH 환경변수가 필요합니다.');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(dbPath + suffix, { force: true });
}

require('../../src/server.js');
