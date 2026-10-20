# Marketplace 0.1.13 배포 기록

## 변경과 배포 전 확인

- 직접 작성한 실행 코드의 원본을 TypeScript로 전환했다. 공통 요청·응답 타입과 Node/DOM 엄격 타입 검사, 검사 후 JavaScript 생성 빌드를 추가했다.
- 기존 파일 형식·SQL·즐겨찾기·원격 workspace 실행 위치와 VSIX 진입점·Worker·Webview 경로를 유지했다. TypeScript와 타입 패키지는 개발 의존성이며 사용자에게 추가 런타임을 요구하지 않는다.
- `package.json`, lockfile, 두 VSIX manifest 버전이 모두 0.1.13이다. 런타임 의존성 버전은 기존과 같다.
- [전환 구현 검증](../implementation/typescript-migration-steps.md)의 전체 테스트 45개 통과·건너뜀 0개 결과를 재사용했다. 두 새 VSIX의 자체 실행 파일 13개와 공급업체 파일 211개가 모두 해당 검증 패키지와 바이트 단위로 일치했다.
- 두 플랫폼 패키징에서 TypeScript 검사를 통과했다. 완성 VSIX의 identity·target·진입점·네이티브 파일·같은 버전의 스크린샷 자산·원본/개발 입력 제외를 확인했다. 공개 파일 감사는 각 235개(자체 24개·공급업체 211개)를 검사했다.
- 새 Linux VSIX를 추출해 다섯 형식 조회, 외부 접근 등 12개 시도 차단과 정상 조회 복구를 다시 검증했다. 인터넷 소켓 이벤트 0건·루프백 HTTP 수신 0건이었다. 이 검사는 모든 입력·네이티브 취약점의 부재를 보증하지 않는다.
- 배포 전 교차 점검에서 게시 차단 사유를 발견하지 못했다. Windows 패키지는 정적 검사까지이며 Windows VS Code 안의 직접 실행은 미검증이다.
- 게시 인증은 기존 `smoke-19` 인증으로 검증했다. 원격 `main`과 작업 기준 HEAD가 일치함을 확인했다.
- 테스트는 기존 정책대로 로컬 `tests/`에 유지하고 Git·VSIX에 포함하지 않는다.

## 게시할 파일

| target | 파일 | 크기(bytes) | SHA-256 |
| --- | --- | --- | --- |
| Linux x64 | `dist/pq-explorer-0.1.13-linux-x64.vsix` | 24,070,934 | `eb3edfd147cd758eca134864940e8f9b1a29f1d7c00eb49357797db2e56de4c8` |
| Windows x64 | `dist/pq-explorer-0.1.13-win32-x64.vsix` | 13,844,018 | `d94f8f398992791c2d978a146379910cd32f2b2660443fa4e602ae782f71d43d` |

## 게시 진행

사용자 요청에 따라 TypeScript 전환과 0.1.13 메타데이터를 원격 `main`에 반영한 뒤 위 파일을 Marketplace에 게시한다. 업로드 접수와 Gallery 검증 완료, 공개 다운로드의 파일 일치를 구분해 후속 기록으로 남긴다. Git 태그·GitHub Release·Tailnet 페이지 변경은 수행하지 않는다.

## 업로드 접수

- 구현 커밋 `e68fc98`을 원격 `main`에 push했다. 생성 JavaScript는 Git에서 제외하고 TypeScript 원본·설정·개발 문서를 반영했다.
- Linux x64 업로드가 성공했고, 2026-10-20 12:23:00 UTC Gallery 조회에서 0.1.13 등록과 로컬 SHA-256 일치를 확인했다.
- Windows x64도 업로드가 성공했다. 12:23:07 UTC 조회에서는 두 플랫폼이 모두 등록됐으며 각 서버 SHA-256이 위 파일과 일치했다.
- 해당 조회 시 두 플랫폼은 Gallery `flags=0`으로 검증 대기 상태였다. 최종 검증·공개 다운로드 확인 결과는 후속 기록에 남긴다.

## 최종 확인

- 2026-10-20 12:29:32 UTC 조회에서 Linux x64의 Gallery `flags=1`을 확인했다.
- 12:30:22 UTC(한국 시각 21:30:22) 조회에서는 Windows x64·Linux x64가 모두 `flags=1`로 검증 완료됐으며 서버 SHA-256도 위 파일과 일치했다.
- 두 플랫폼의 CDN 원본과 일반 `vspackage?targetPlatform=...` 다운로드가 HTTP 200을 반환했다. HTTP gzip을 해제한 VSIX의 버전·target·크기·SHA-256이 각각 로컬 게시 파일과 일치했다. Linux CDN 다운로드에는 대기 시간이 있었으나 완료 후 정상 파일임을 확인했다.
- 같은 버전의 Marketplace 아이콘·스크린샷이 로컬 이미지와 일치했고, 공개 설명의 파일 형식과 0.1.13 스크린샷 주소를 확인했다. 검증 중 스크린샷 주소는 일시적으로 404를 반환했으나 Linux 검증 완료 후 HTTP 200과 내용 일치를 확인했다.
- Git·Marketplace 반영과 검증을 완료했다. 업로드한 VSIX를 변경하거나 다시 빌드하지 않았다. 최종 후속 변경은 배포 기록이다.

[Marketplace에서 PQ Explorer 보기](https://marketplace.visualstudio.com/items?itemName=smoke-19.pq-explorer)
