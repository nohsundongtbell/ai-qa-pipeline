import Database from 'better-sqlite3';

// 서버가 만든 SQLite 파일을 테스트가 직접 열어 확인/초기화한다.

export function getUserRow(dbPath: string, username: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | { id: number; username: string; password_hash: string; nickname: string }
      | undefined;
  } finally {
    db.close();
  }
}

export function resetDb(dbPath: string) {
  const db = new Database(dbPath);
  try {
    db.exec('DELETE FROM posts; DELETE FROM users; DELETE FROM sqlite_sequence;');
  } finally {
    db.close();
  }
}
