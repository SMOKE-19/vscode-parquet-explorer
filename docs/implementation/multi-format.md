# 파일 형식 확장: 0.1.12

## 확인한 기존 구현

최신 날짜의 로컬 `smoking_data_260908`에서 다음을 확인했다.

- `smoking-data-spi/src/smoking_data_spi/_internal/backends/streaming_sbdf.py`: `smoking_sbdf.convert_with_result`를 호출하는 Parquet→SBDF 내보내기. 기본 batch size 50,000, RLE 선택, NULL·타입 변환·sidecar 옵션을 제공한다. Python 뷰어를 호출하는 구현은 아니다.
- `smoking-data-engine/src/smoking_data_engine/spotfire_rust_ir.py`: Python `csv.DictReader`, `utf-8-sig`를 사용하는 식 CSV 읽기.
- 로컬 `smoking_data_260804/streaming-sbdf/src/rust_sbdf.rs` 및 Spotfire C wire format에서 section·metadata·plain/RLE/bit·IsInvalid 동작을 확인했다. 기존 저장소를 수정하지 않았다.

## 현재 구현

| 파일 | 역할 |
| --- | --- |
| `engine/parquet.js` | 형식 감지와 `data` 등록, 공통 SQL·페이지·통계·경로 제한 |
| `engine/formats.js` | SBDF/XLSX를 DuckDB appender로 가져오기, XLSX ZIP 사전 검사 |
| `engine/sbdf.js` | Python 없는 SBDF 1.0 읽기. 파일 전체 대신 slice 단위 처리 |
| `engine/xlsx-reader.source.mjs` | XLSX XML 주소·시트 목록 검사, 선택한 시트만 파싱 |
| `engine/xlsx-reader.js` | read-excel-file·fflate·saxen을 Node 18 대상 CJS로 번들링한 런타임 |
| `engine/worker.js` | 기존 소스를 보존한 후보 로드, 성공 시 소스·시트 교체 |

Parquet·CSV·TSV는 DuckDB view로 직접 조회한다. SBDF·XLSX는 준비 단계에서 in-memory `data` 테이블을 만든다. CSV는 첫 화면 이후 별도 연결의 count 쿼리, Parquet는 푸터 우선, 가져온 형식은 이미 확인한 원본 행 수를 사용한다. 형식별 처리 이후 SQL·페이지·값 표시·즐겨찾기는 공통 경로를 유지한다.

`meta`에는 기존 필드와 함께 `format`, `sheets`, `selected_sheet`가 추가된다. `source` 요청은 선택적인 `sheet`를 받는다. XLSX 시트 이름을 바꾸고 실행하면 기존 SQL로 새 시트를 조회한다. 실패 시 이전 엔진·SQL·결과를 유지한다. 작업자 재시작에도 마지막으로 성공한 시트를 전달하고 다른 형식으로 전환하면 시트를 비운다.

SBDF Decimal은 IEEE 754 decimal128 BID 값을 손실 없는 문자열로 표시한다. 날짜·시간·TimeSpan은 DuckDB 타입으로, Binary는 BLOB으로 처리한다. Spotfire 표시 서식·분류·설명은 별도 재현하지 않는다. XLSX 수식은 저장된 결과만 사용한다. 헤더·타입·크기 제한은 공개 README에 기록했다.

기존 `pqExplorer.openParquetExplorer` command ID와 custom editor ID는 호환성을 위해 유지하고 표시 이름을 `PQ Explorer: Open Data File`로 변경했다. 다섯 확장자를 기본 custom editor와 탐색기 메뉴에 연결했다. 폴더 열기는 Parquet dataset을 유지한다.

## 검증과 배포 경계

- 실제 CSV/TSV의 BOM·줄바꿈·인용부호·한글·페이지·통계, 읽기 전용·경로 경계를 확인했다.
- [Spotfire 공식 테스트 데이터](https://github.com/spotfiresoftware/spotfire-python/tree/main/spotfire/test/files/sbdf)의 빈 파일·alltypes·10001행·decimal·unicode·datetime2를 Node 엔진으로 읽었다. 테스트 fixture는 로컬 tests 폴더에 보관한다.
- 최소 Open XML workbook을 직접 만들어 시트 전환·헤더 중복·캐시 수식·날짜·큰 정수·오류 시 이전 엔진 보존을 검사했다.
- Chromium Webview에서 시트 선택 후 실행, SQL 보존, 실패 시 viewport 유지, HTML 형태 시트 이름의 비실행을 확인했다.
- XML 엔티티·과도한 셀 주소, 잘린 SBDF, 외부 경로 및 원본 파일 변경 거부를 검증한다.
- 사용자 WSL·Windows VS Code 앱 안의 새 형식 실행은 별도 검증 대상이다. 로컬 구현·패키징 작업은 Marketplace 재게시나 Git commit/push를 포함하지 않는다.

## 근거

- [DuckDB CSV](https://duckdb.org/docs/stable/data/csv/overview.html)
- [Spotfire SBDF C](https://github.com/spotfiresoftware/spotfire-sbdf-c)
- [read-excel-file](https://github.com/catamphetamine/read-excel-file)

## 최종 검증 결과

- `npm run check` 통과, `npm test` 41개 통과·건너뜀 없음.
- 두 플랫폼 VSIX inspector와 패키지 파일 허용 목록·민감 문자열 검사 통과. 각 패키지는 확장 파일 234개(검사 대상 23개·공급업체 211개)이며 Python·개발용 XLSX 원본·테스트를 포함하지 않는다.
- `npm audit --omit=dev`: 보고된 알려진 취약점 0개. 네이티브 코드 전체의 취약점 부재를 뜻하지 않는다.
- Linux VSIX를 저장소 밖 임시 폴더에 추출하고 동봉한 모듈만으로 CSV·TSV·SBDF·XLSX·Parquet 읽기, XLSX 시트 전환, 원본 통계, Worker 종료를 확인했다. Windows는 패키지 구성과 소스 일치만 검사했다.
- `pq-explorer-0.1.12-linux-x64.vsix`: 24,065,496 bytes, SHA-256 `88e2c7572f9e925539bd61d1600109fba5d9d93f289dd02572b0e856a4608f90`.
- `pq-explorer-0.1.12-win32-x64.vsix`: 13,838,579 bytes, SHA-256 `ecf3dae5e00168124cf336d7a376eefe2a7c8197a710e34001c1b972ed9bbd2a`.
