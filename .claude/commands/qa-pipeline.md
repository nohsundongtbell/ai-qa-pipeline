---
description: QA 파이프라인 1회 실행 (Planner → Writer → Runner → Healer → Reporter). 각 단계 사이에 역할 범위 검사와 사람 확인을 둔다
argument-hint: "[full | plan | write | run | heal | report]  (생략하면 full)"
---

QA 파이프라인을 실행합니다. 단계: $ARGUMENTS (비어 있으면 `full` = 아래 1~5단계 전부, 그 외는 해당 단계만)

당신은 **오케스트레이터**입니다. 직접 테스트나 문서를 만들지 않고, 각 단계를 서브에이전트에게 맡기고 결과를 검증해 다음 단계로 넘깁니다.

## 원칙
1. **순차 실행만 합니다.** 에이전트를 병렬로 부르지 않습니다 (Runner와 Healer가 같은 포트와 파일을 씁니다).
2. **에이전트를 부르기 전에 범위 기준을 기록하고, 부른 뒤에 검사합니다.**
   ```bash
   node scripts/scope-check.js snapshot            # 호출 전
   node scripts/scope-check.js check --role <역할>  # 호출 후 (planner|writer|runner|healer|reporter)
   ```
   검사가 실패(🚫)하면 다음 단계로 **넘어가지 말고** 어떤 파일이 왜 바뀌었는지 사용자에게 보고합니다. 되돌리기(`git checkout`, 삭제)는 사용자 확인 후에 합니다.
3. **단계 사이의 정보는 에이전트의 보고서와 파일로만 전달합니다.** 에이전트는 서로의 대화를 보지 못하므로, 다음 에이전트를 부를 때 필요한 것(TC ID 목록, 파일 경로, 실패 TC)을 프롬프트에 명시합니다.
4. **사람 확인이 필요한 지점에서는 멈추고 묻습니다** (아래 표시). 승인 없이 넘어가지 않습니다.
5. **`git commit`, `git push`, PR 생성, Jira 등록, Slack 실제 전송은 하지 않습니다.** 필요하면 명령만 제안하고 사용자에게 확인받습니다.
6. 실패를 숨기지 않습니다. 에이전트가 실패나 이상을 보고하면 그대로 사용자에게 전달합니다.

## 단계

### 1. Planner (`qa-planner`) — 새 요구사항이 있을 때
- 시작 전: `docs/requirements.md`와 `docs/test-cases.md`를 비교해 새 REQ나 TC 없는 REQ가 있는지 확인합니다. **없으면 이 단계를 건너뛰고** 그 사실을 알립니다.
- 호출: 변경/추가된 REQ를 알려 주고 TC 설계를 요청합니다.
- 검사: `check --role planner`
- ⏸ **사람 확인**: 추가/수정된 TC와 질문 목록을 요약해 보여 주고, 승인받은 뒤에 2단계로 갑니다. (AI가 만든 TC는 사람이 검토합니다)

### 2. Writer (`qa-writer`) — 자동화할 새 TC가 있을 때
- 호출: Planner 보고서의 자동화 대상 TC ID 목록을 그대로 넘깁니다. 없으면 "문서에는 있는데 tests/에 구현이 없는 TC"를 찾아 넘깁니다. 없으면 건너뜁니다.
- 검사: `check --role writer`
- Writer의 새 테스트가 실패하면 앱 결함일 수 있습니다. Writer가 테스트를 약하게 고치지 않았는지 보고서를 확인합니다.

### 3. Runner (`qa-runner`)
- 호출: 전체 테스트 실행과 요약을 요청합니다.
- 검사: `check --role runner` (파일이 바뀌면 안 됩니다)
- 실패가 0건이면 4단계를 건너뛰고 5단계로 갑니다.

### 4. Healer (`qa-healer`) — 실패가 있을 때
- 호출: Runner 보고서의 실패 TC 목록을 넘깁니다.
- 검사: `check --role healer` (작업 트리의 추적 파일이 바뀌면 안 됩니다)
- ⏸ **사람 확인**: 진단 결과(TC별 분류, 근거, 안전 검사 결과)를 보여 줍니다.
  - 테스트 문제로 재검증까지 통과한 건: PR을 만들지 물어봅니다 → 승인 시 `node scripts/heal.js apply --tc TC-xxx --pr`
  - 앱 결함: **코드를 고치지 않습니다.** Jira 등록을 물어봅니다 → 승인 시 `node scripts/heal.js apply --tc TC-xxx --jira`. 앱을 고쳐 달라는 요청은 별도로 받아야 합니다.
  - 안전 검사가 거절한 건은 앱 결함일 수 있다고 알립니다.

### 5. Reporter (`qa-reporter`)
- 호출: 이번 실행의 결과와 분류를 알려 주고 품질 리포트를 요청합니다.
- 검사: `check --role reporter`
- 마지막에 파이프라인 전체 요약을 사용자에게 보고합니다.

## 최종 보고 형식
| 단계 | 담당 | 결과 | 범위 검사 |
|---|---|---|---|
그리고 "사용자가 결정해야 할 것"(TC 승인, PR/Jira 실행, 최종 Go/No-Go)을 맨 아래에 정리합니다. Go/No-Go는 사람이 결정합니다.
