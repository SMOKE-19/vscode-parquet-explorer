# PQ Explorer for VS Code

VS Code 안에서 Parquet 파일 또는 dataset 폴더를 DuckDB로 조회합니다. `smoking-data-visualize`의 Parquet 조회 엔진을 확장에 포함했으며, Python 작업자와 표준 입출력으로 통신합니다. HTTP 서버는 실행하지 않습니다.

## 사용

1. 조회할 workspace의 Python 3.10+ 환경에 `duckdb>=1.4,<2`를 설치합니다.
2. VS Code 확장 개발 호스트에서 이 폴더를 확장으로 실행하거나 VSIX로 설치합니다.
3. 탐색기의 `.parquet` 파일을 열면 해당 **파일 하나**가 PQ Explorer의 기본 편집기로 표시됩니다. 우클릭의 **PQ Explorer: Open Parquet** 명령으로도 열 수 있습니다. 상단 경로에 폴더를 입력하고 **소스 열기**를 누르면 그 폴더 아래의 Parquet을 데이터셋으로 조회합니다.
4. 원본 전체 행 수, 칼럼 수, 파일 수, 파일 크기 합계와 현재 SQL 결과의 전체 행 수를 확인합니다. 결과는 기본 50행씩 페이지로 조회합니다. SQL을 바꾼 뒤 `Ctrl+Enter`로 재실행할 수 있습니다. 리스트 값에는 원소 수가 표시됩니다.

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
- 조회 화면은 기본 표·SQL 입력·검사·페이지 이동을 제공합니다. Python과 DuckDB는 별도 설치가 필요합니다.
- SQL 편집기는 로컬 번들의 CodeMirror로 SQL 구문을 강조하고, DuckDB 검사 오류를 밑줄로 표시합니다. VS Code의 SQL 언어 서버 전체 기능을 복제하지는 않습니다.
- 작업자는 신뢰된 로컬 workspace에서만 실행됩니다.

## 개발 확인

```bash
npm run check
npm run build
```

로컬 작업본에 `tests/`가 있는 경우 `npm test`로 회귀 테스트를 실행할 수 있습니다. GitHub 저장소에는 테스트 파일을 게시하지 않습니다. VS Code에서 이 폴더를 열고 `npm run build`로 로컬 SQL 편집기 번들을 만든 뒤 `F5`로 확장 개발 호스트를 실행할 수 있습니다. 번들은 설치 시 외부 네트워크를 사용하지 않습니다.

다른 확장이 `.parquet`의 기본 편집기로 선택되었다면 파일 탭에서 **Reopen Editor With...** → **PQ Explorer**를 선택하세요.

설치 파일이 필요하면 `npm install` 후 `npm run package`를 실행합니다. 생성되는 `pq-explorer-0.1.3.vsix`를 VS Code의 **Extensions: Install from VSIX**에서 설치할 수 있습니다.

GitHub Release에 첨부된 VSIX도 다운로드한 뒤 VS Code에서 `Ctrl+Shift+P` → **Extensions: Install from VSIX...**로 설치할 수 있습니다. VSIX 설치는 자동 업데이트되지 않으므로 새 버전은 다시 설치해야 합니다.
