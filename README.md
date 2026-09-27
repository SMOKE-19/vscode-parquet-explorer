# PQ Explorer for VS Code

VS Code 안에서 Parquet 파일 또는 dataset 폴더를 DuckDB로 조회합니다. `smoking-data-visualize`의 Parquet 조회 엔진을 확장에 포함했으며, Python 작업자와 표준 입출력으로 통신합니다. HTTP 서버는 실행하지 않습니다.

## 사용

1. 조회할 workspace의 Python 3.10+ 환경에 `duckdb>=1.4,<2`를 설치합니다.
2. VS Code 확장 개발 호스트에서 이 폴더를 확장으로 실행하거나 VSIX로 설치합니다.
3. 탐색기의 `.parquet` 파일을 열면 해당 **파일 하나**가 PQ Explorer의 기본 편집기로 표시됩니다. 우클릭의 **PQ Explorer: Open Parquet** 명령으로도 열 수 있습니다. 상단 경로에 폴더를 입력하고 **소스 열기**를 누르면 그 폴더 아래의 Parquet을 데이터셋으로 조회합니다.
4. 원본 전체 행 수, 칼럼 수, 파일 수, 파일 크기 합계와 현재 SQL 결과의 전체 행 수를 확인합니다. 결과는 기본 50행씩 페이지로 조회하며, 표는 최대 약 10행 높이로 표시하고 내부에서 스크롤합니다. SQL을 바꾼 뒤 `Ctrl+Enter`로 재실행할 수 있습니다. 리스트 값에는 원소 수가 표시됩니다.

SQL 제목 오른쪽의 **SQL 저장**으로 별칭과 설명을 붙여 즐겨찾기를 만들 수 있습니다. **즐겨찾기**에서 별칭·설명·SQL 미리보기를 확인하고 SQL을 다시 불러옵니다. 항목 왼쪽 별표를 누르면 상단에 고정되고, 다시 누르면 고정이 해제됩니다. 고정 항목 아래는 기본적으로 실행 횟수 순이며, 정렬 메뉴로 최근 사용·최근 수정·별칭 순서를 선택할 수 있습니다. 항목 오른쪽 삭제 버튼으로 삭제합니다. 저장한 SQL을 수정한 뒤 다시 저장하면 기존 항목 수정 또는 새 항목 저장을 고를 수 있습니다. 최대 100개까지 저장하며, 성공적으로 실행한 저장 SQL만 사용 횟수에 반영합니다.

즐겨찾기는 확장의 **전역 저장소** 아래 `pq-explorer-sql-favorites/`에 `index.json`과 개별 `sql/*.sql` 파일로 저장됩니다. 기존 `sql-favorites/` 폴더가 있으면 처음 사용할 때 새 이름으로 옮깁니다. 즐겨찾기 선택 창 상단에 실제 **백업 폴더 경로**가 항상 표시되고, 복사 버튼으로 경로를 복사할 수 있습니다. 백업할 때는 `pq-explorer-sql-favorites/` 폴더 전체를 복사하세요. 로컬 VS Code에서는 로컬 컴퓨터에 저장되고, Remote SSH에서는 확장이 실행되는 SSH 서버에 저장됩니다. 경로는 화면에서 변경하지 않습니다.

확장은 workspace 내부 `smoking-data-visualize/.venv`, 그다음 workspace `.venv`를 탐색합니다. 해당 환경에 DuckDB가 없다면 `pqExplorer.pythonPath`를 DuckDB가 설치된 Python 실행 파일로 설정하세요. 경로는 절대경로 또는 workspace 상대경로를 사용할 수 있습니다.

```json
{
  "pqExplorer.pythonPath": ".venv/bin/python"
}
```

Windows에서는 해당 경로를 `.venv\\Scripts\\python.exe`처럼 지정할 수 있습니다. 설정을 비우면 자동 탐색합니다. 가상환경을 만들려면 `python -m venv .venv`를 실행한 뒤 해당 환경의 Python으로 `python -m pip install "duckdb>=1.4,<2"`를 실행하세요.

## 동작 범위

- 선택한 파일이 속한 VS Code workspace 안의 Parquet만 열 수 있습니다. workspace 밖에서 파일을 고르면 그 파일의 상위 폴더가 허용 범위가 됩니다.
- 각 Explorer 탭은 독립 Python 작업자를 실행하며, 탭을 닫으면 작업자를 종료합니다. 파일 경로와 SQL 결과는 로컬 프로세스 간에만 전달됩니다.
- SQL은 포함된 visualize Parquet 엔진의 읽기 전용 검증을 거칩니다. 전체 행 수를 계산한 뒤 결과를 페이지로 가져옵니다.
- `DESCRIBE SELECT * FROM data`로 조회 결과의 칼럼 이름과 타입을 표에서 확인할 수 있습니다.
- 조회 화면은 기본 표·SQL 입력·검사·페이지 이동을 제공합니다. Python과 DuckDB는 별도 설치가 필요합니다.
- 현재 페이지에서 고유값 수가 표시된 행 수보다 작은 칼럼은 셀 배경을 색칠합니다. 리스트 값도 비교하며, 값별 색은 같은 SQL의 페이지 이동 중 유지합니다. 처음 등장한 값에는 보색에 가까운 색을 우선 배정하고, 값이 많아지면 연속 색상 차이가 큰 팔레트를 사용합니다. 이 판별은 전체 데이터가 아닌 표시된 페이지 기준입니다.
- 결과 표의 행 수는 25·50·100·200, 칼럼 수는 5·10·20·40·100 중에서 선택할 수 있습니다. 기본값은 각각 50행과 20칼럼이며, 칼럼 좌우 이동 폭은 선택한 칼럼 수를 따릅니다.
- SQL 편집기는 로컬 번들의 CodeMirror로 SQL 구문을 강조하고, DuckDB 검사 오류를 밑줄로 표시합니다. VS Code의 SQL 언어 서버 전체 기능을 복제하지는 않습니다.
- 작업자는 신뢰된 로컬 workspace에서만 실행됩니다.

## 개발 확인

```bash
npm run check
npm run build
```

로컬 작업본에 `tests/`가 있는 경우 `npm test`로 회귀 테스트를 실행할 수 있습니다. GitHub 저장소에는 테스트 파일을 게시하지 않습니다. VS Code에서 이 폴더를 열고 `npm run build`로 로컬 SQL 편집기 번들을 만든 뒤 `F5`로 확장 개발 호스트를 실행할 수 있습니다. 번들은 설치 시 외부 네트워크를 사용하지 않습니다.

개발 테스트에 DuckDB가 필요하면 이 폴더에서 `python3 -m venv .venv`와 `.venv/bin/python -m pip install "duckdb>=1.4,<2"`를 실행하세요. 전체 테스트는 `SMOKING_TEST_PYTHON="$PWD/.venv/bin/python" npm test`로 실행할 수 있습니다. `.venv/`는 Git과 VSIX 패키지에서 제외됩니다.

다른 확장이 `.parquet`의 기본 편집기로 선택되었다면 파일 탭에서 **Reopen Editor With...** → **PQ Explorer**를 선택하세요.

설치 파일이 필요하면 `npm install` 후 `npm run package`를 실행합니다. 생성되는 `dist/pq-explorer-0.1.3.vsix`를 VS Code의 **Extensions: Install from VSIX**에서 설치할 수 있습니다. 이전 버전의 VSIX도 `dist/`에 보관합니다.

GitHub Release에 첨부된 VSIX도 다운로드한 뒤 VS Code에서 `Ctrl+Shift+P` → **Extensions: Install from VSIX...**로 설치할 수 있습니다. VSIX 설치는 자동 업데이트되지 않으므로 새 버전은 다시 설치해야 합니다.
