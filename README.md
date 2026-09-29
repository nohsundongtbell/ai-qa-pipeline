# 게시판 웹앱 (QA 실습용)

Node.js + Express + SQLite로 만든 간단한 게시판입니다. 프론트는 프레임워크 없이 순수 HTML/CSS/JS를 사용합니다.

## 설치

Node.js LTS(18 이상)가 필요합니다.

```bash
npm install
```

## 실행

```bash
npm start
```

접속 주소: http://localhost:3000

첫 실행 시 프로젝트 루트에 `board.db` 파일이 자동 생성됩니다.

## 환경변수 (선택)

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `DB_PATH` | `./board.db` | SQLite 파일 경로 (테스트용 별도 DB를 쓸 때 사용) |
| `SESSION_SECRET` | 개발용 고정값 | 세션 서명 키. 실서비스에서는 반드시 변경 |

예시 (PowerShell):

```powershell
$env:PORT=3001; $env:DB_PATH="test.db"; npm start
```

## 기능

회원가입 / 로그인 / 로그아웃, 게시글 목록(페이지네이션), 작성, 상세, 수정, 삭제(본인만, 아니면 403)

## 화면

| 경로 | 설명 |
|---|---|
| `/` | 게시글 목록 |
| `/post.html?id=1` | 게시글 상세 |
| `/write.html` | 글쓰기 (`?id=1`이면 수정) |
| `/login.html` | 로그인 |
| `/signup.html` | 회원가입 |

## API

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/api/signup` | - | 회원가입 |
| POST | `/api/login` | - | 로그인 |
| POST | `/api/logout` | 필요 | 로그아웃 |
| GET | `/api/me` | - | 현재 사용자 |
| GET | `/api/posts?page=1&limit=10` | - | 목록 |
| POST | `/api/posts` | 필요 | 작성 |
| GET | `/api/posts/:id` | - | 상세 |
| PUT | `/api/posts/:id` | 필요 | 수정 (본인만) |
| DELETE | `/api/posts/:id` | 필요 | 삭제 (본인만) |

자세한 요구사항과 검증 규칙은 [docs/requirements.md](docs/requirements.md)를 참고하세요.

## 테스트 (Playwright)

```bash
npm install
npx playwright install chromium   # 최초 1회
npm test                          # 전체 실행 (테스트 서버는 자동으로 띄움)
npm run test:api                  # API 테스트만
npm run test:ui                   # UI 테스트만
npm run report                    # HTML 리포트 열기
```

- 테스트 서버는 전용 포트(3100~3102)와 `test-data/`의 임시 DB를 쓰므로 개발용 서버(3000)와 `board.db`에 영향이 없습니다.
- 테스트 이름에 TC ID가 들어 있어 [docs/test-cases.md](docs/test-cases.md)와 대응합니다.
- 실패 시 스크린샷과 trace가 `test-results/`에 저장됩니다 (`npx playwright show-trace <trace.zip>`).

## 폴더 구조

```
docs/requirements.md   요구사항 (REQ-001~014)
src/                   서버 (app.js, server.js, db.js, routes/, middleware/)
public/                프론트엔드 정적 파일
tests/api, tests/ui    Playwright 테스트 (helpers/에 공통 fixture)
playwright.config.ts   테스트 설정
```
