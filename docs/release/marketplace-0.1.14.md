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

[Marketplace에서 PQ Explorer 보기](https://marketplace.visualstudio.com/items?itemName=smoke-19.pq-explorer)
