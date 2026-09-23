# PQ Explorer for VS Code

VS Code 안에서 Parquet 파일 또는 dataset 폴더를 DuckDB로 조회합니다. `smoking-data-visualize`의 Parquet 조회 엔진을 확장에 포함했으며, Python 작업자와 표준 입출력으로 통신합니다. HTTP 서버는 실행하지 않습니다.

## 사용

1. 조회할 workspace의 Python 3.10+ 환경에 `duckdb>=1.4,<2`를 설치합니다.
2. VS Code 확장 개발 호스트에서 이 폴더를 확장으로 실행하거나 VSIX로 설치합니다.
3. 탐색기의 `.parquet` 파일을 우클릭해 **PQ Explorer: Open Parquet**을 선택합니다. dataset 폴더는 명령 팔레트에서 명령을 실행한 뒤 선택할 수 있습니다.
4. 기본 `SELECT * FROM data` 조회 결과 50행·20칼럼을 확인합니다. SQL을 바꾼 뒤 `Ctrl+Enter`로 재실행할 수 있습니다.

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
- 작업자는 신뢰된 로컬 workspace에서만 실행됩니다.

## 개발 확인

```bash
npm run check
npm test
```

VS Code에서 이 폴더를 열고 `F5`로 확장 개발 호스트를 실행할 수 있습니다. 개발 호스트 실행에는 별도 번들러가 필요하지 않습니다.

설치 파일이 필요하면 `npm install` 후 `npm run package`를 실행합니다. 생성되는 `pq-explorer-0.1.0.vsix`를 VS Code의 **Extensions: Install from VSIX**에서 설치할 수 있습니다.

GitHub Release에 첨부된 VSIX도 다운로드한 뒤 VS Code에서 `Ctrl+Shift+P` → **Extensions: Install from VSIX...**로 설치할 수 있습니다. VSIX 설치는 자동 업데이트되지 않으므로 새 버전은 다시 설치해야 합니다.
