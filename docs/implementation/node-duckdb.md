# Node.js DuckDB 전환 구현

## 목표와 범위

사용자가 Python, uv, Node.js를 별도로 설치하지 않고 VSIX 설치 후 Parquet를 조회한다. VS Code가 제공하는 Node.js와 VSIX에 포함한 `@duckdb/node-api` 네이티브 라이브러리를 사용한다. `extensionKind: ["workspace"]`를 유지하여 SSH·WSL에서는 파일이 있는 확장 호스트에서 실행한다.

기존 작업 트리의 소스 경로 입력 후 실행, SQL 즐겨찾기, 행·칼럼 페이지, 고정 칼럼, 취소, 타임아웃, 소스 푸터 통계를 보존한다. 이 작업은 커밋·게시·사용자 VS Code 설치·다운로드 페이지 배포를 포함하지 않는다.

## 구현 순서

| 단계 | 구현 내용 | 완료 기준 | 상태 |
| --- | --- | --- | --- |
| 1 | 현재 요청·응답과 실행 경계 기록 | 이 문서 및 기존 동작 확인 | 완료 |
| 2 | Node DuckDB 엔진과 값 변환 | 실제 Parquet 조회, 읽기 전용·경로 제한, 중첩 값 크기 제한 | 완료 |
| 3 | Worker 및 bridge 교체 | Python 호출 제거, 요청 직렬 처리, 취소·타임아웃·종료 처리 | 완료 |
| 4 | 확장·Webview 시작 흐름 변경 | Python 설정·설치 화면 제거, 시작 실패 안내와 재시작 유지 | 완료 |
| 5 | 네이티브 의존성 패키징 | 플랫폼별 VSIX에 실행 파일·네이티브 모듈 포함, 개발 파일 제외 | 완료 |
| 6 | 회귀 검증과 성능 비교 | 계약 테스트, 동일 대용량 파일 측정, 완성 VSIX 내용 검증 | 완료 |

각 단계 구현 후 관련 검증을 수행하고 상태와 확인 결과를 이 문서에 반영한다.

## 데이터 흐름

```text
Webview ↔ extension.js ↔ bridge.js ↔ Node Worker ↔ DuckDB
                                          └ 별도 통계 연결
```

`bridge.js`는 `startBridge({source, root, extensionPath, settings})`, `request(operation, payload)`, `stop()` 인터페이스를 유지한다. Worker의 구조화 복제로 결과를 전달하며 Python JSON-lines 인코딩·파싱을 제거한다. DuckDB 조회와 값 변환은 Worker에서 실행한다. Worker는 프로세스 격리가 아니므로 네이티브 충돌까지 격리하지는 않는다.

조회 요청은 순서대로 실행하되 취소는 대기열을 우회한다. 통계는 별도 연결에서 진행하여 조회 연결을 점유하지 않는다. `source`는 새 엔진을 완전히 열고 검증한 후 교체하며, 이전 통계는 요청 시점의 소스를 유지한다. 재시작 시 마지막으로 성공한 소스를 유지한다.

## 유지할 계약

- `meta`: `source_path`, 파일 크기·수, 스키마, `row_count: null`, 기본 SQL.
- `query`: 기본 50행, 최대 200행, 기본 40칼럼·최대 100칼럼. 한 행을 추가 조회해 `has_more`를 판단한다. 정확한 SQL 결과 행 수는 설정으로 선택한다.
- `query`의 칼럼 index·고정·이전/다음 offset과 `DESCRIBE SELECT` 결과 페이지를 유지한다.
- `stats`: 원본 소스 전체 행 수를 `parquet_file_metadata`로 계산하며 실패 시 `COUNT(*)`로 대체한다. SQL 필터 적용 전 수치임을 유지한다.
- `lint`: parser/binder 결과와 오류 위치를 반환한다.
- `cancel`: 현재 request ID만 취소한다. 타임아웃 후 연결을 재사용할 수 있어야 한다.
- 읽기 전용 단일 SQL, 선택한 파일만 접근 가능한 DuckDB 설정, 실제 경로 기준 workspace 경계·symlink 검사, 임시 경로 경계를 유지한다.

## 값 변환과 성능

Node API가 반환한 bigint·날짜·LIST·STRUCT·BLOB을 Webview가 처리할 수 있는 값으로 변환한다. 안전 정수는 number, 범위를 벗어난 정수는 문자열로 전달해 정밀도 손실을 막는다. 중첩 값은 원소별 바이트 예산을 누적해 검사하며 누적 배열 전체를 매번 JSON으로 만들지 않는다. `maxCellBytes`와 기존 잘림 메타데이터를 유지한다.

우선 기존 셀 표시·복사 계약을 보존한다. 클릭 시 원본 셀 상세 조회와 Arrow 전송은 이번 전환의 필수 조건에 넣지 않는다. 전달 형식과 실행 환경 변경의 효과를 먼저 측정한다. 화면 표시 시간과 엔진의 `elapsed_ms`는 서로 다르며 측정 결과에 구분한다.

## 배포와 검증

런타임 의존성과 OS·CPU별 DuckDB 네이티브 파일을 빌드 시 포함한다. 사용자 환경에서 npm·pip를 실행하거나 런타임 파일을 내려받지 않는다. 우선 현재 Linux x64에서 실제 실행 및 패키지를 검증한다. Windows x64 등 다른 플랫폼은 해당 타깃 의존성 포함과 실제 실행 검증을 구분하여 기록한다.

기존 JavaScript UI 테스트를 보존하고 Python 엔진·설치 테스트는 Node 계약 테스트로 교체한다. 중첩 값, 정밀도, 소스 전환 실패, 외부 파일 접근, 주석·복수 SQL, 취소 후 재조회, 통계와 조회 동시 진행을 검증한다. 패키지 안에서 모듈을 로드하고 실제 조회하여 단순 파일 목록 이상의 확인을 수행한다.

## 확인 결과

- 기존 Python 기본 SQL·50행 서버 측정: DuckDB 실행+fetch 중앙값 약 47ms, 셀 변환 약 3,591ms. Windows 사용자 화면 시간과 동일한 환경의 측정은 아니다.
- Node.js v26.8.2 / DuckDB v1.5.6 / Linux x64에서 동일 파일·SQL·50행·14칼럼, threads 2·memory limit 2GB로 3회 측정했다. 엔진 중앙값 **86.84ms**, Worker 왕복 중앙값 **91.54ms**, 작업자 시작 **140.68ms**였다. [측정 결과](node-duckdb-benchmark.json)에 회차별 수치를 보관한다.
- 이전 Python 엔진 중앙값 3,691.34ms 대비 엔진 시간이 약 **42.5배** 줄었다. DuckDB 버전이 다르고 파일 캐시를 비우지 않았으며 Webview 전달·DOM 렌더링은 제외했다. Windows 사용자 화면의 전체 지연을 보장하는 수치는 아니다.
- `npm run check`, `npm test`: **27개 통과**, 건너뛴 테스트 없음. Chromium에서 기존 경로·통계·페이지·즐겨찾기와 시작 실패→재시작·SQL 보존을 검증했다.
- 중첩 LIST·STRUCT·BLOB, 안전 정수 경계와 DECIMAL, 날짜 마이크로초, SQL 주석·문자열·복수 문장, symlink·임시 경로 경계, 푸터 실패 대체 경로, 조회 중 통계, 취소·타임아웃 후 재조회, 네이티브 조회 중 종료, 패널을 닫은 뒤 확장 비활성화가 연결 정리를 기다리는 동작을 확인했다.
- 네이티브 조회 중 `Worker.terminate()`를 호출하면 N-API callback의 실행 환경이 사라져 프로세스가 중단되는 문제가 회귀 테스트에서 재현됐다. 강제 종료를 제거하고 중단→진행 중 요청 정리→연결 close→Worker 종료 순서로 수정했다. 응답 시간 초과도 같은 종료 절차를 사용한다. Worker를 `unref`하지 않아 독립 Node 프로세스에서도 정리 완료 전에 이벤트 루프가 끝나지 않도록 했다. 테스트 러너 외부 자식 프로세스로 이 조건을 검증했다.
- Linux x64·Windows x64 VSIX를 빌드하고 각 OS용 네이티브 라이브러리와 Worker 포함을 확인했다. Linux는 추출한 패키지에서 실제 조회까지 검증했으며 Windows VS Code 실제 실행은 별도 확인이 필요하다.
- 단계 5·6의 최종 패키지 확인 결과는 아래와 같다. 버전 0.1.9를 유지한 개발 검증 패키지이며 커밋·배포·사용자 환경 설치는 수행하지 않는다. 운영 다운로드 준비 스크립트는 이전 단일 VSIX 파일명을 사용하므로 플랫폼별 배포 연결은 다음 배포 작업 범위다.


## 최종 패키지 확인

| target | 파일 | 크기 | 검증 |
| --- | --- | --- | --- |
| Linux x64 | `dist/pq-explorer-0.1.9-linux-x64.vsix` | 23,773,826 bytes | manifest·소스 일치·네이티브 파일 검사, 독립 폴더에서 조회·LIST·푸터 통계·소스 전환 실패 보존·조회 중 정상 종료 통과 |
| Windows x64 | `dist/pq-explorer-0.1.9-win32-x64.vsix` | 13,546,908 bytes | manifest·소스 일치·`duckdb.node`·`duckdb.dll` 포함 검사. Windows 실제 실행 미검증 |

- Linux SHA-256: `844c6f19d8e1b6fbad45d5488e757de85c4c25591226cade56b7ae43c87e6466`
- Windows SHA-256: `3c626fb8041a58c63d9e8b13e1effb049d0d77f914fa5a19238e3577d55fedbf`
- 두 VSIX 모두 Python 런타임·설치 코드, 테스트, 중첩 배포 파일이 없음을 확인했다. Inspector 검사와 실행 파일의 현재 소스 바이트 비교를 수행했다. vsce가 README 상대 링크를 GitHub 링크로 변환하는 동작은 허용한다.
- 추출한 Linux 패키지는 개발 저장소 밖 임시 디렉터리에서, 동봉된 Node 모듈만 사용하여 실행했다. VS Code 실제 앱 안에서의 smoke test는 수행하지 않았다.
- 빌드별 크기·체크섬·검증 결과는 `dist/node-duckdb-verification.json`에도 저장했다. 다른 플랫폼 패키지는 이번에 빌드·실행하지 않았다.


## 후속 배포: 0.1.10

사용자의 다운로드 링크 생성 요청에 따라 버전 0.1.10으로 두 플랫폼을 패키징하고 기존 Tailnet 페이지에 게시했다. manifest·Worker·현재 실행 소스 일치·네이티브 파일 포함을 검사했으며, Linux 패키지를 독립 폴더에 추출해 실제 조회·통계·정상 종료를 재확인했다. Windows 실제 VS Code 실행은 미검증이다.

- `pq-explorer-0.1.10-win32-x64.vsix`: 13,546,910 bytes, SHA-256 `021f579bc4894ea1dc0e36bd9edea75452553ade4dee89cadd4a2470329118f7`
- `pq-explorer-0.1.10-linux-x64.vsix`: 23,773,828 bytes, SHA-256 `838a51f8ed180269fc6e3675e2e4ccbfbe7808f444eccc687a10f3d7c8b0e305`
- 다운로드 준비 스크립트는 두 target을 사전 검증하고 파일 복사 후 페이지를 교체하도록 변경했다. 버전 오류 거부, 양쪽 링크·체크섬 생성, 재실행, 동일 파일명 다른 내용의 덮어쓰기 거부를 임시 fixture로 확인했다.
- 실제 Tailnet 주소에서 페이지와 두 VSIX의 HTTP 200 응답·SHA-256 일치를 확인했다. 이전 0.1.9 배포 파일도 원본 체크섬을 유지한다. 사용자 VS Code 설치나 Git 커밋은 수행하지 않았다.
