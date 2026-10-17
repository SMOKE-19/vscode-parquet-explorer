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
