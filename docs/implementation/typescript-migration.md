# TypeScript 전환 구현 계획

## 목표와 범위

0.1.12의 JavaScript 구현을 TypeScript 원본으로 전환한다. 확장 호스트·Worker·데이터 엔진·Webview·개발 스크립트를 포함하고, 생성된 번들과 공급업체 코드는 직접 수정하지 않는다. 로컬 테스트의 JavaScript는 기존 검증 수단으로 유지한다.

파일 형식, SQL·즐겨찾기·시트 전환, 원격 workspace 실행 위치, 외부 접근 차단, 네이티브 Worker 종료 순서는 유지한다. 이번 작업의 완료 범위는 문서·전환·로컬 검증이며 Marketplace 게시와 Git 반영은 별도 요청 때 수행한다.

## 원본과 실행 파일

| TypeScript 원본 | 생성되는 실행 파일 |
| --- | --- |
| `src/extension.ts`, `src/bridge.ts`, `src/favorites.ts` | 루트의 같은 이름 `.js` |
| `src/engine/*.ts` | `engine/*.js` |
| `src/media/explorer.ts`, `src/media/sql-editor.ts` | `media/explorer.js`, `media/sql-editor.js` |
| `src/scripts/*.ts` | `scripts/*.js` |
| `src/shared/protocol.ts`의 메시지·결과 타입 | 타입 검사에 사용하고 실행 파일 의존성을 만들지 않음 |
| `src/shared/errors.ts` | `shared/errors.js`(브라우저에서는 번들에 포함) |

HTML·CSS·아이콘·Python 배포 보조 스크립트는 현 위치에 둔다. `package.json.main`, Worker 경로, Webview URI와 VSIX 내부 실행 경로를 유지한다. 생성 JavaScript는 Git에서 제외하고 개발·테스트·패키징 전에 빌드한다. 직접 `.js` 파일을 수정하는 이중 원본을 남기지 않는다.

## 타입과 빌드

- TypeScript `strict` 검사를 사용한다. 확장 호스트·개발 스크립트의 Node 타입과 Webview의 DOM 타입을 별도 설정으로 분리한다.
- VS Code 타입은 최소 지원 버전 1.90에 맞춘다. 기존 엔진·런타임 의존성 버전은 유지한다.
- 요청 종류별 payload·응답, 메타데이터·페이지 결과·lint·즐겨찾기와 SQL 편집기 인터페이스를 정의한다. 프로세스 간 값은 JSON 호환 표현으로 유지한다.
- 파일·메시지 등 실행 시 유효성 검사는 기존 코드에 남긴다. TypeScript 타입이 외부 입력을 검증한다고 간주하지 않는다.
- `tsc --noEmit`은 오류 검출, 기존 esbuild는 JavaScript 생성과 번들링을 담당한다. 빌드가 타입 검사 실패를 무시하지 않게 한다.
- 전역 `any`·`@ts-nocheck`·오류 무시 지시로 통과시키지 않는다. 라이브러리 경계의 불확실한 값과 오류는 좁은 타입·`unknown`으로 다룬다.
- Node 18용 CJS와 브라우저 IIFE 산출물을 유지한다. VSIX에는 TS·설정·타입 패키지·원본 맵·테스트·개발 스크립트를 넣지 않는다.

클래스 필드 선언의 emit이 기존 초기화 순서를 바꾸지 않게 하고, Node Worker를 강제 종료하는 변경을 섞지 않는다. [TypeScript 설정](https://www.typescriptlang.org/tsconfig/strict.html)과 [esbuild의 TypeScript 처리 범위](https://esbuild.github.io/content-types/#typescript)를 기준으로 타입 검사와 변환을 구분한다.

## 순서와 완료 조건

구체적인 진행 상태와 명령은 [순차 구현 기록](typescript-migration-steps.md)에서 관리한다.

1. 현 구조와 기존 검증을 확인하고 TypeScript·타입 의존성과 빌드 설정을 추가한다.
2. 공통 타입과 SQL·값 변환·즐겨찾기를 전환하고 관련 테스트를 실행한다.
3. 파일 파서·엔진·Worker·bridge·확장 호스트를 전환하고 실제 DuckDB·메시지·종료 동작을 검증한다.
4. Webview·SQL 편집기와 개발 스크립트를 전환하고 Chromium 테스트를 실행한다.
5. 원본 JS 제거·생성물 정책·문서·VSIX 포함 목록을 맞춘다.
6. 전체 로컬 회귀 테스트와 완성 VSIX 검사를 실행하고, 저장소 밖에 추출한 Linux 패키지로 실제 조회한다.

완료 시 모든 직접 작성한 JavaScript 실행 코드의 원본이 `.ts`여야 한다. 두 타입 검사, 기존 기능 테스트, 패키지 검사와 추출 후 실행이 통과해야 한다. Windows 패키지의 정적 검사와 Windows 앱 안의 실행 검증을 구분해 기록한다.
