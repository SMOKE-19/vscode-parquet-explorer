# Marketplace 0.1.12 배포 기록

## 배포 전 확인

- CSV·TSV·SBDF·XLSX 읽기, XLSX 시트 선택, 기존 Parquet·SQL·즐겨찾기 계약을 포함한다.
- 구현 단계의 `npm run check`, `npm test` 41개 통과·건너뜀 없음, Chromium 시트 전환·오류 복구 검증 결과를 재사용했다.
- 배포 전 교차 점검에서 두 VSIX의 버전·target·체크섬·실행 소스 바이트 일치, manifest/lockfile 버전 일치를 확인했다.
- 두 VSIX의 공개 패키지 검사 통과: 확장 파일 234개, 검사 대상 23개, 공급업체 211개. 검사 범위는 네이티브 바이너리의 전체 취약점 분석이 아니다.
- Linux 패키지는 저장소 밖에 추출해 동봉한 모듈만으로 다섯 형식·시트 전환·통계·Worker 종료를 검증했다. Windows VS Code 앱 안의 직접 실행은 미검증이다.
- `smoke-19` 게시 인증 검증 성공. 0.1.11의 Linux x64·Windows x64는 Gallery `flags=1`로 검증 완료 상태였다.
- 배포 전 확인에서는 게시 차단 사유를 발견하지 않았다. 업로드 접수와 Gallery 검증·설치 가능 상태를 구분한다.
- 테스트 파일은 기존 저장소 정책에 따라 로컬 `tests/`에 유지하고 공개 Git/VSIX에는 포함하지 않는다.

## 게시할 파일

- `pq-explorer-0.1.12-linux-x64.vsix`: 24,065,496 bytes, SHA-256 `88e2c7572f9e925539bd61d1600109fba5d9d93f289dd02572b0e856a4608f90`.
- `pq-explorer-0.1.12-win32-x64.vsix`: 13,838,579 bytes, SHA-256 `ecf3dae5e00168124cf336d7a376eefe2a7c8197a710e34001c1b972ed9bbd2a`.

## 게시 진행

원격 `main`에 구현을 반영한 뒤 Linux x64, Windows x64 순서로 검사한 기존 VSIX를 게시한다. 각 target의 등록·검증과 공개 다운로드 파일 일치를 후속 기록으로 남긴다. 새 Git 태그나 GitHub Release는 이 배포의 범위가 아니다.

## 업로드 접수 결과

- 구현 커밋 `2549402`를 원격 `main`에 push했다.
- 최초 Linux 업로드는 기본 3분 응답 시간 초과로 종료됐다. Gallery에 새 버전이 없음을 확인하고, 같은 vsce 게시 경로의 서버 응답 대기 시간을 10분으로 늘려 다시 시도했다. 패키지는 다시 빌드하지 않았다.
- Linux x64는 2026-10-17 09:07:22 UTC 조회부터 0.1.12로 등록됐으며 해시가 일치했다.
- 최초 Windows 업로드는 Azure DevOps Services Unavailable 오류를 반환했다. 간격을 두고 Windows 파일만 재시도해 접수에 성공했다.
- 09:09:59 UTC 조회에서는 0.1.12 Windows x64·Linux x64가 모두 등록됐고 각각의 서버 해시가 위 파일과 일치했다. 두 target의 Gallery 검증 비트는 아직 `0`이었다.
- 업로드 실패 원인을 인증 실패나 패키지 불일치로 추정하지 않았다. 인증은 유효했고 실제 오류는 응답 시간 초과와 서비스 일시 중단이었다.

## 최종 확인

- 2026-10-17 09:14:51 UTC(한국 시각 18:14:51)에 Windows x64·Linux x64가 모두 Gallery `flags=1`로 검증 완료됐다. 업로드 접수만으로 완료를 판단하지 않았다.
- 두 target 모두 CDN 원본과 일반 `vspackage?targetPlatform=...` 공개 다운로드가 HTTP 200을 반환했다. HTTP gzip을 해제한 각 VSIX의 버전·target·크기·SHA-256이 위 검사 파일과 일치했다.
- Marketplace의 0.1.12 아이콘과 스크린샷 자산은 로컬 파일과 바이트가 일치했다. 공개 설명에도 CSV·SBDF·XLSX와 같은 버전의 스크린샷 주소가 포함됐다.
- 사용자 요청으로 [추가 보안·외부 전송 점검](security-0.1.12.md)을 진행했다. 실제 Linux VSIX에서 다섯 형식을 읽고 12개 차단 시도를 실행하는 동안 인터넷 소켓 이벤트와 루프백 HTTP 요청은 0건이었다. Webview CSP 등 추가 보안 테스트 7개도 통과했다. 이 결과의 한계와 로컬 저장·Remote SSH 전달 범위는 별도 문서에 명시했다.
- 업로드한 VSIX를 변경하거나 다시 빌드하지 않았다. 추가 변경은 배포·검사 기록이다.

[Marketplace에서 PQ Explorer 보기](https://marketplace.visualstudio.com/items?itemName=smoke-19.pq-explorer)
