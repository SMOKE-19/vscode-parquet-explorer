# Marketplace 0.1.14 배포 기록

## 수정 내용

`.pq`가 기본 편집기 연결·우클릭 메뉴·열기 대화상자·확장 호스트와 엔진의 파일 형식 판별에 없던 문제를 수정했다. 실제 내용이 Parquet인 `.pq`를 기존 Parquet 형식으로 처리하며, 재귀 dataset 폴더에서 `.parquet`와 `.pq`를 함께 읽는다. 기존 source root·읽기 전용 SQL 제한은 유지한다.

## 검증

- `npm run build`의 Node/DOM 타입 검사와 관련 테스트 9개가 통과했다.
- 새 Linux VSIX를 대상으로 한 최종 `npm test`는 46개 통과·실패 0개·건너뜀 0개였다. `.pq`·`.PQ` 조회, 푸터 통계, 재귀 혼합 dataset, 잘못된 파일·root 밖 경로·symlink 거부와 기존 결과 유지, 확장 명령·활성 파일·열기 대화상자를 포함한다.
- 저장소 밖에 Linux VSIX를 추출하고 동봉 모듈만으로 `.pq` 조회·푸터 통계·혼합 dataset·Worker 종료를 확인했다.
- 두 VSIX의 manifest·version·target·기본 `*.pq` 연결·네이티브 파일·개발 입력 제외 검사를 통과했다. 자체 실행 JS 13개가 현재 빌드와 일치했다. 0.1.13 대비 변경된 실행 파일은 확장 호스트·형식 판별·dataset 탐색의 3개이며 공급업체 파일은 같다.
- 두 플랫폼의 공개 패키지 감사는 각 235개(자체 24개·공급업체 211개)를 검사했다.
- Windows 패키지는 정적 검사까지 완료했으며 Windows VS Code 앱 안의 직접 실행은 미검증이다. 테스트 파일은 기존 정책대로 로컬에 유지한다.

## 게시 파일

| target | 파일 | 크기(bytes) | SHA-256 |
| --- | --- | --- | --- |
| Linux x64 | `dist/pq-explorer-0.1.14-linux-x64.vsix` | 24,071,150 | `e184cb321601f444d0adf9ed020909bd26e50d91c80dc610ad2adce0c6a8067f` |
| Windows x64 | `dist/pq-explorer-0.1.14-win32-x64.vsix` | 13,844,234 | `c2907cc030fb0cf152dcb9b5d877b47a77f14ba16a2ebe74c8a3da5d918ab523` |

## 배포 진행

기존 `smoke-19` 인증을 확인했다. 수정 소스·버전·사용 안내를 원격 `main`에 반영한 뒤 위 VSIX를 게시한다. 업로드 접수와 Gallery 검증 완료·공개 다운로드 일치를 구분해 결과를 기록한다.

- 구현 커밋 `bffa4f6`을 원격 `main`에 push했다.
- Linux x64·Windows x64 모두 업로드 성공 응답을 받았다. 2026-10-27 12:24:59 UTC Gallery 조회에서 두 플랫폼의 0.1.14 등록과 로컬 SHA-256 일치를 확인했다.
- 해당 시점은 두 플랫폼 모두 `flags=0`으로 Marketplace 검증 대기 상태였다. 완료 확인은 아래 후속 기록에 남긴다.

## 최종 확인

- 2026-10-27 12:32:12 UTC 조회에서 Linux x64의 Gallery `flags=1`을 확인했다.
- 12:32:30 UTC(한국 시각 21:32:30) 조회에서는 Windows x64·Linux x64 모두 `flags=1`로 검증 완료됐고 서버 해시도 위 파일과 일치했다.
- 각 플랫폼의 일반 공개 VSIX 다운로드가 HTTP 200을 반환했다. HTTP gzip을 해제한 파일의 버전·target·SHA-256이 로컬 게시 파일과 일치했다.
- Marketplace 아이콘·스크린샷이 로컬 이미지와 일치했고, 공개 설명에 `.pq` 지원 안내와 0.1.14 스크린샷 주소가 반영됐음을 확인했다.
- 게시 파일은 변경하거나 다시 빌드하지 않았다. 최종 후속 변경은 이 배포 기록이다.

[Marketplace에서 PQ Explorer 보기](https://marketplace.visualstudio.com/items?itemName=smoke-19.pq-explorer)
