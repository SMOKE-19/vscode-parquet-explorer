# TypeScript 순차 구현 기록

[구현 계획](typescript-migration.md)의 실행 기록이다. 단계별 타입 검사와 관련 테스트를 먼저 수행하고, 마지막에 전체 회귀와 패키지를 검증한다.

| 단계 | 작업 | 상태 |
| --- | --- | --- |
| 1 | 기준 상태·타입 의존성·Node/DOM 설정·빌드 경로 | 완료 |
| 2 | 공통 계약·SQL·값 변환·즐겨찾기 | 완료 |
| 3 | 파일 형식·엔진·Worker·bridge·확장 호스트 | 완료 |
| 4 | Webview·SQL 편집기·개발 스크립트 | 완료 |
| 5 | 원본·생성물·패키징·개발 문서 정리 | 완료 |
| 6 | 회귀·VSIX 검사·추출 실행 | 완료 |

## 기준 상태

- 시작 커밋: `7cdfcde`(0.1.12). 작업 시작 시 추적 파일 변경 없음.
- 런타임: VS Code workspace 호스트, Node DuckDB Worker, 별도 Webview.
- 기존 실행 경로와 로컬 테스트를 유지해 전환 전후 동작을 비교한다.
- 기존 배포 파일은 재게시하지 않는다. 이번 로컬 검증 산출물은 게시된 파일과 구분한다.

## 검증 기록

2026-10-20 로컬 검증을 완료했다. 버전은 0.1.12로 유지했고 변경 이력은 `미배포` 항목에 기록했다. 커밋·push·Marketplace 게시·사용자 VS Code 설치는 수행하지 않았다.

이후 별도의 사용자 배포 요청에 따라 버전을 0.1.13으로 올렸다. 후속 Git push·Marketplace 배포 상태와 실제 게시 파일은 [0.1.13 배포 기록](../release/marketplace-0.1.13.md)에서 관리한다. 아래 표는 전환 당시의 로컬 검증 파일 기록이다.

### 단계별 결과

- TypeScript 5.9.3과 개발용 타입 의존성을 lockfile에 고정했다. VS Code 타입은 최소 지원 버전 1.90.0이다. 런타임 의존성은 변경하지 않았다.
- 직접 작성한 실행 코드와 계약·선언을 `src/`의 TypeScript 파일 20개로 모았다. 기존 JS·MJS 원본을 대체하고 생성 JavaScript는 Git 추적에서 제외했다. 기존 진입점·네이티브 파일·Worker·Webview 실행 경로를 유지했다.
- `npm run check`: Node/VS Code와 DOM 타입 검사 모두 통과했다. 응용 코드에 명시적 `any`, `@ts-ignore`, `@ts-nocheck`를 도입하지 않았다. 외부 선언 파일은 `skipLibCheck`로 검사하지 않는다.
- SQL·값 변환·즐겨찾기 전환 후 즐겨찾기 테스트 6개가 통과했다. 엔진·Worker·확장 호스트 전환 후 관련 테스트 25개가 통과했다. Webview·개발 스크립트 전환 후 관련 테스트 11개가 통과했다. 이 수들은 단계별 부분 실행이며 서로 중복될 수 있다.
- 추가 회귀 2개는 잘못된 요청 payload·요청명·응답 필드가 컴파일 오류가 되는지와, JavaScript 생성물이 없는 폴더에서 전체 빌드 후 CSV 조회·통계·읽기 전용 차단·Worker 종료가 가능한지 검증한다. 의존성은 기존 로컬 `node_modules`를 재사용했다.
- 최종 전체 테스트는 **45개 통과·실패 0개·건너뜀 0개**였다. 실제 DuckDB 다섯 형식, Chromium UI·CSP·HTML 삽입, 즐겨찾기, 취소·시간 제한·재시작·종료, 소스 교체, 타입 계약과 초기 빌드를 포함한다.
- 신규 Linux VSIX를 추출해 다섯 형식을 읽고 외부 접근 등 12개 시도를 차단했다. `strace`에서 인터넷 소켓 이벤트 0건, 루프백 HTTP 수신 0건이며 차단 후 정상 조회도 성공했다. 이 결과는 모든 입력·네이티브 취약점에서 정보 유출이 불가능하다는 증명이 아니다.

### 패키지 결과

생성 JavaScript가 없는 별도 작업 폴더에 TS 원본·manifest·lockfile·정적 자산만 복사해 Linux x64·Windows x64를 패키징했다. 로컬 개발 의존성은 재사용하고, VSIX용 런타임 의존성은 기존 패키징 스크립트의 임시 폴더에서 `npm ci --omit=dev --ignore-scripts`로 설치했다.

두 VSIX는 manifest·target·진입점·네이티브 파일과 완성 아카이브 검사를 통과했다. 패키지의 자체 실행 JS 13개가 현재 빌드 파일과 바이트 단위로 일치했고, TypeScript·MJS·설정·원본 맵·Python·테스트·개발 스크립트는 포함하지 않았다. 공개 파일 감사는 각 235개(자체 24개·공급업체 211개)를 검사했다.

| 로컬 검증용 파일 | 크기(bytes) | SHA-256 |
| --- | --- | --- |
| `dist/typescript-migration/pq-explorer-0.1.12-linux-x64.vsix` | 24,070,933 | `945fb33dde3c6f03b2170a1c030da57c260d3b0d5d0d54d1aa6cb33019b584b1` |
| `dist/typescript-migration/pq-explorer-0.1.12-win32-x64.vsix` | 13,844,016 | `fded42e46e3bfa3db7a8c3cd6beb525058894b5a89342f0502da4c681ec3a331` |

위 파일은 TS 전환의 로컬 검증용이며 기존 Marketplace 0.1.12 파일과 다르다. 기존 `dist/` 루트의 게시 파일 두 개는 원래 SHA-256과 일치함을 확인했다. 실제 새 게시 시 버전을 올리고 별도로 배포 검증해야 한다.

검증 JSON과 완성 VSIX 검사 출력은 `dist/typescript-migration/`에, 네트워크 추적 요약은 `dist/security-0.1.12-network.json`에 있다. 테스트는 기존 정책대로 로컬 `tests/`에 유지한다. Windows 패키지는 정적 검사까지 완료했으며 Windows VS Code 앱에서 직접 실행하지 않았다. 사용자 VS Code 개발 호스트에서의 설치·실행도 이번 작업의 검증 범위에 포함하지 않는다.

### 재검증 명령

```bash
npm run check
npm run build
# 위 검증용 Linux VSIX가 있을 때 패키지 네트워크 경계까지 검사한다.
PQ_TEST_VSIX=dist/typescript-migration/pq-explorer-0.1.12-linux-x64.vsix npm test
```

원본 수정은 `src/`에서 한다. 생성물을 직접 수정해도 다음 빌드에서 대체된다. 일반 개발·패키징 절차는 [BUILD.md](../../BUILD.md)를 따른다.

### 외부 라이브러리 타입 경계

`saxen`의 사용 중인 콜백에 한정한 선언을 `src/engine/saxen.d.ts`에 추가했다. `read-excel-file`의 현재 선언은 날짜 셀을 `DateConstructor`로 표현하고 실제 지원하는 `sheets` 옵션을 누락하므로, 보정은 `src/engine/xlsx-reader.ts` 어댑터에 한정했다. 날짜·시트 선택은 독립 XLSX 표본과 실제 Worker 테스트로 확인했다. Worker·Webview 직렬화 경계에서 응답 타입을 복원하는 단언은 런타임 입력 검증을 대체하지 않는다.
