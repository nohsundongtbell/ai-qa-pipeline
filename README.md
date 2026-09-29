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

## CI와 결과 보고 (Slack, Jira)

`.github/workflows/test.yml`(GitHub Actions)과 `.gitlab-ci.yml`(GitLab CI)이 같은 흐름입니다.
main push 또는 PR/MR에서 테스트를 돌리고, 끝나면 `scripts/report.js`가 결과를 보고합니다.

- **Slack**: 통과/실패/건너뜀/flaky 건수, 실행 시간, 실패 TC 목록, 실행 링크를 전송
- **Jira**: 실패한 TC마다 이슈를 만들고, 같은 TC의 **열린 이슈가 있으면 코멘트만 추가** (TC ID를 라벨로 구분)
  - 이슈는 main push 등에서만 만들고 PR/MR에서는 Slack 보고만 합니다 (`JIRA_EVENTS`로 변경 가능)

### 시크릿 설정 (없으면 해당 기능만 건너뜀)

GitHub: Settings > Secrets and variables > Actions / GitLab: Settings > CI/CD > Variables

| 이름 | 값 |
|---|---|
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL |
| `JIRA_BASE_URL` | 예: `https://내도메인.atlassian.net` |
| `JIRA_EMAIL` | Jira 계정 이메일 |
| `JIRA_API_TOKEN` | Atlassian API 토큰 |
| `JIRA_PROJECT_KEY` | 이슈를 만들 프로젝트 키 (예: `QA`) |

### 로컬에서 확인

```bash
npm run test:report   # 보고 스크립트 검증 (가짜 Slack/Jira 서버 사용, 외부 전송 없음)
npm run notify:dry    # 마지막 테스트 결과(test-report.json)로 전송 내용만 출력 (전송 안 함)
```

## AI 셀프 힐링 (반자동)

테스트가 깨졌을 때 원인을 **앱 결함**과 **테스트 코드 문제**로 나누고, 테스트 코드 문제만 수정안을 PR로 올립니다.
API 키 없이 Claude Code 세션에서 진단하고, 검사와 재검증, 브랜치/PR 생성은 스크립트가 맡습니다.

```
/heal            # Claude Code에서 실행 (.claude/commands/heal.md). 특정 TC만: /heal TC-102
```

| 분류 | 처리 |
|---|---|
| 앱 결함 | **코드를 수정하지 않고** Jira 분석 코멘트만 남김 (앱 코드도 자동으로 고치지 않음) |
| 테스트 코드 문제 | 안전장치 검사 → 적용 → 해당 테스트 재실행 → 통과하면 draft PR (자동 머지 없음) |
| 불안정/판단 불가/신뢰도 낮음 | 코드 변경 없음, 사람이 확인 |

안전장치(`scripts/heal-guard.js`)는 진단이 틀려도 앱 결함을 덮지 못하게 코드로 막습니다.
- `tests/` 아래 `.ts/.js`만 수정 가능 (앱 코드, 문서, 워크플로, 스크립트 불가)
- 검증 조건(matcher, 기대값)과 숫자 값(상태 코드, 개수, 타임아웃) 변경 금지, `expect` 삭제 금지
- `skip`/`fixme`/`only`, `.catch(`, `force: true` 추가 금지, 수정 3곳/30줄 이하
- 수정 후에도 해당 TC가 실제로 통과해야 채택, 통과하지 못하면 원상복구

```bash
node scripts/heal.js context                     # 실패 TC별 분석 자료 생성 (heal-work/)
node scripts/heal.js apply --tc TC-102           # 진단 검사, 적용, 재검증 후 원상복구 (미리보기)
node scripts/heal.js apply --tc TC-102 --pr      # 브랜치 push와 draft PR 생성 (GH_TOKEN이 없으면 PR 링크 출력)
node scripts/heal.js apply --tc TC-072 --jira    # 앱 결함 분석을 Jira에 등록 (JIRA_* 환경변수 필요)
```

CI에서 main이 깨졌다면 최신 main을 받아 로컬에서 `npx playwright test`로 재현한 뒤 `/heal`을 실행하세요.

## 에이전트 오케스트레이션 (역할 분업)

Claude Code 서브에이전트(`.claude/agents/`)로 역할을 나누고, `/qa-pipeline` 명령이 순서대로 엮습니다.

| 에이전트 | 역할 | 수정 가능 범위 (`scripts/scope-check.js`가 사후 검사) |
|---|---|---|
| `qa-planner` | 요구사항 분석, 테스트 계획과 TC 설계 | `docs/test-plan.md`, `docs/test-cases.md` (요구사항은 사람의 것) |
| `qa-writer` | TC를 Playwright 코드로 구현 | `tests/` |
| `qa-runner` | 실행, 결과 수집, Slack 보고 미리보기 | 없음 (수정 도구 자체가 없음) |
| `qa-healer` | 실패 분류, 셀프 힐링, Jira 초안 | 없음 (진단서는 `heal-work/`에만, 수정은 `heal.js`가 검사 후 처리) |
| `qa-reporter` | 지표 집계와 품질 리포트 | `reports/` |

```
/qa-pipeline            # 전체: Planner → Writer → Runner → Healer → Reporter
/qa-pipeline run        # 특정 단계만 (plan | write | run | heal | report)
```

- 순차 실행만 합니다 (Runner와 Healer가 같은 포트와 파일을 씀).
- 에이전트 호출 전후로 `scope-check snapshot` / `check --role <역할>`을 실행해, 역할 밖의 파일이 바뀌면 다음 단계로 넘어가지 않습니다.
- 사람 확인 지점: Planner가 만든 TC, PR 생성, Jira 등록. 최종 Go/No-Go도 사람이 결정합니다.
- 에이전트는 서로의 대화를 볼 수 없어서, 단계 사이 정보(TC ID 목록, 실패 TC)는 오케스트레이터가 프롬프트와 파일로 전달합니다.
- 알려진 한계: `Bash` 도구는 명령 단위로 제한할 수 없어서, `git push` 같은 명령을 막는 것은 지침에 의존합니다 (범위 검사는 파일 변경만 봅니다).

## 폴더 구조

```
docs/requirements.md   요구사항 (REQ-001~014)
src/                   서버 (app.js, server.js, db.js, routes/, middleware/)
public/                프론트엔드 정적 파일
tests/api, tests/ui    Playwright 테스트 (helpers/에 공통 fixture)
playwright.config.ts   테스트 설정
scripts/               Slack/Jira 보고 스크립트와 그 테스트
```
