# 개발과 패키징

## 개발 환경

빌드 도구 `@vscode/vsce` 4의 요구 조건에 맞는 Node.js 22 이상과 npm이 필요합니다. 이것은 **개발용 조건**이며 확장 사용자는 Node.js·npm·Python을 설치하지 않습니다. 실행 시 VS Code가 제공하는 Node.js를 사용합니다.

```bash
npm ci
npm run check
npm run build
```

테스트 스위트는 로컬 `tests/`에 보관하며 공개 저장소에는 포함하지 않습니다. 테스트 파일이 있는 개발 환경에서는 `npm test`로 SQL 편집기 번들 생성 후 실제 Node DuckDB·Worker·즐겨찾기·확장 호스트 계약을 확인합니다. Chromium이 없으면 Webview 브라우저 테스트를 건너뛰며 테스트 출력에 표시합니다. VS Code에서 `F5`로 확장 개발 호스트를 실행할 수 있습니다.

## 플랫폼별 VSIX

```bash
npm run package -- --help
npm run package -- --target linux-x64
npm run package -- --target win32-x64
```

`npm run package`의 기본 target은 빌드 머신입니다. `linux-x64`, `linux-arm64`, `alpine-x64`, `alpine-arm64`, `win32-x64`, `win32-arm64`, `darwin-x64`, `darwin-arm64`를 지원하는 빌드 경로를 제공합니다. 모든 target에서의 실제 실행을 검증했다는 뜻은 아닙니다.

결과는 `dist/pq-explorer-<version>-<target>.vsix`입니다. 임시 디렉터리에 현재 소스와 lockfile을 복사하고 `npm ci --omit=dev --ignore-scripts`로 target 의존성을 설치한 뒤 기존 vsce로 패키징합니다. Node DuckDB의 JavaScript 코드와 `.node`·`.so`·`.dll`·`.dylib` 등 해당 플랫폼 파일을 동봉합니다. target 파일이 빠지면 패키징을 실패시킵니다. 빌드 시 npm registry 접근이 필요할 수 있으며 사용자 실행 시 추가 다운로드는 없습니다.

VSIX manifest에 target을 기록하므로 Windows 로컬용과 Linux WSL·SSH용 패키지를 구분하세요. 같은 Windows PC에서도 WSL workspace에서 실행할 확장은 Linux 패키지입니다. 기존 `dist/downloads/`나 서비스에는 자동 복사하지 않습니다.

패키징 성공 후 완성된 VSIX의 manifest·Worker·네이티브 파일을 검사하고, 추출한 Linux 패키지에서 실제 Parquet 조회를 확인했습니다. Windows는 Windows 환경에서 별도 실행 검증이 필요합니다. 현재 검증 범위는 [구현 문서](docs/implementation/node-duckdb.md)에 기록합니다.

## 성능 측정

```bash
npm run benchmark -- --help
npm run benchmark -- ./sample.parquet
```

기본 SQL `SELECT * FROM data`, 50행·20칼럼 상한, threads 2·memory limit 2GB로 3회 조회합니다. 파일의 실제 칼럼 수가 더 적으면 그 수만 반환합니다. 엔진 내부 시간과 Worker 왕복 시간을 따로 출력합니다. Webview 메시지 전달·DOM 렌더링은 측정하지 않습니다. 운영체제 파일 캐시를 비우지 않으므로 냉간 I/O 측정은 아닙니다.


## Tailnet 다운로드 페이지 갱신

```bash
npm run package -- --target linux-x64
npm run package -- --target win32-x64
python scripts/prepare_downloads.py
```

이 마지막 명령은 `dist/downloads/`에서 제공하는 운영 페이지를 갱신합니다. 두 패키지의 이름·버전·target·네이티브 파일을 확인한 뒤 복사하며 같은 버전의 다른 파일을 덮어쓰지 않습니다. 파일 복사가 끝난 뒤 페이지를 교체합니다. `SHA256SUMS`와 `release.json`에는 두 플랫폼 정보가 들어가고, 이전 배포 파일은 남습니다. 이 서버용 배포 보조 도구에는 Python 3.11 이상이 필요하지만 확장 사용자의 런타임 의존성은 아닙니다.


## Marketplace 공개 패키지

`npm run package`는 공개용 README·변경 이력·개인정보·보안·라이선스 고지와 `assets/` 이미지를 포함합니다. 개발 문서·서버 설정·테스트는 VSIX에 포함하지 않습니다. 최종 아카이브를 내부 주소·빌드 머신 경로·인증 문자열과 파일 허용 목록으로 검사하며 실패하면 종료합니다.

예제 스크린샷은 VSIX의 addressable 자산으로 등록하고 패키지 README에서 해당 버전의 Marketplace HTTPS URL을 참조합니다. 이미지 제공을 위해 별도 Git push를 수행하지 않습니다. 버전을 바꾸면 이미지 URL도 함께 갱신됩니다. 게시 후 실제 이미지 응답을 확인해야 합니다.

완성된 패키지를 게시할 때는 저장소 폴더에서 로컬 도구를 사용합니다.

```bash
node node_modules/@vscode/vsce/vsce login smoke-19
node node_modules/@vscode/vsce/vsce publish --packagePath dist/pq-explorer-<version>-win32-x64.vsix
# 최초 공개에서는 첫 플랫폼의 Marketplace 검증 완료를 확인한 뒤 다음 패키지를 게시합니다.
node node_modules/@vscode/vsce/vsce publish --packagePath dist/pq-explorer-<version>-linux-x64.vsix
node node_modules/@vscode/vsce/vsce show smoke-19.pq-explorer --json
```

`<version>`은 실제 버전으로 바꾸세요. 로그인 토큰은 터미널 입력창에서만 입력합니다. `publish --packagePath`는 지정한 파일을 외부 Marketplace에 게시하는 명령입니다.

`DONE Published`는 업로드 접수 결과입니다. 게시 완료 판단 전 Gallery 조회의 `versions`에서 같은 버전의 `win32-x64`·`linux-x64`가 모두 있고 각 항목의 `flags`에 `Validated` 비트(`1`)가 설정됐는지 확인합니다. 각 플랫폼의 공개 VSIX 다운로드와 SHA-256 일치도 확인합니다. 최초 0.1.11 게시에서는 두 업로드가 성공 응답을 반환했지만 Linux 항목이 없어, Windows 검증 완료 후 Linux 패키지를 따로 재게시했습니다. 최초 누락의 서버 내부 원인은 확인되지 않았습니다.

WSL은 Linux workspace 확장 호스트에서 실행되므로 Linux 패키지가 필요합니다. Windows 패키지가 공개됐어도 Linux 항목이 없으면 WSL 설치 시 플랫폼 미지원 오류가 발생합니다. [공식 플랫폼별 게시 안내](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions)를 참고하세요.
