# 0.1.12 보안·외부 전송 점검

검사일: 2026-10-17. 대상은 `2549402` 구현과 Marketplace에 업로드한 0.1.12 Linux x64·Windows x64 VSIX다. 배포 파일의 크기와 SHA-256은 [배포 기록](marketplace-0.1.12.md)에 남겼다.

## 판정

확장 실행 코드와 동봉 JavaScript에서 사용자 파일·SQL·조회 결과를 제3자 서버에 업로드하는 구현이나 분석 텔레메트리를 발견하지 못했다. 실제 Linux VSIX를 추출해 실행한 다섯 형식 조회와 12개 차단 시도에서도 인터넷 소켓 생성·통신이 관찰되지 않았다. 검사 범위에서 외부 전송 때문에 배포를 중단해야 할 사유는 발견하지 못했다.

이는 모든 입력·운영체제·네이티브 취약점에서 정보 유출이 불가능하다는 증명이 아니다. 사용자 VS Code로의 결과 전달과 로컬 저장은 실제로 이루어진다.

## 확인한 경계

| 경로 | 확인 내용 |
| --- | --- |
| 확장 호스트 | `extension.js`, `bridge.js`, `favorites.js`, `engine/`, Webview 실행 코드에 HTTP 클라이언트·소켓·브라우저 전송 API·외부 분석 수집기 호출을 발견하지 못했다. Worker와 Webview 사이 `postMessage`는 VS Code 내부 전달이다. |
| DuckDB SQL | 단일 SELECT 계약을 적용하고, 선택한 파일만 `allowed_paths`로 허용한다. `enable_external_access=false`, `lock_configuration=true`를 설정한다. 사용자 SQL의 INSTALL·LOAD·COPY·SET과 허용 밖 파일 읽기를 차단했다. |
| XLSX | 동봉한 XML·ZIP 파서로 로컬 파일을 읽는다. 매크로·수식을 실행하거나 외부 링크를 새로 조회하는 구현이 없다. XML DOCTYPE을 거부하고 ZIP 해제 크기·항목 수·시트 크기를 제한한다. 번들의 URL 문자열은 XML 네임스페이스 식별자였다. |
| Webview | CSP의 `default-src 'none'`와 nonce 스크립트를 사용한다. 로컬 리소스 루트는 `media/`다. 실제 Chromium에서 fetch·WebSocket·원격 이미지 요청의 CSP 차단을 확인했다. 셀·칼럼명·즐겨찾기·시트명의 HTML 문자열은 텍스트로 표시됐다. |
| 동봉 의존성 | DuckDB 네이티브 모듈·detect-libc·yauzl·pend와 번들 코드를 확인했다. 런타임 Python·npm 설치 흐름은 없다. detect-libc는 Linux 환경 판별 때 고정된 로컬 `getconf`·`ldd` 명령을 실행할 수 있으므로, 하위 프로세스 실행 자체가 전혀 없다고 주장하지 않는다. |
| 공개 VSIX | 개인 경로·사설/Tailnet 주소·키/토큰 패턴·허용하지 않은 파일 포함 검사를 통과했다. 이 검사는 모든 종류의 비밀정보나 네이티브 바이너리 취약점을 탐지하는 도구는 아니다. |

DuckDB의 외부 접근 차단과 허용 경로 설정은 [공식 보안 설정 문서](https://www.duckdb.org/docs/current/operations_manual/securing_duckdb/overview)를 참고한다. 별도의 운영체제 네트워크 격리를 추가한 제품은 아니다.

## 실제 전송 추적

게시한 Linux VSIX를 임시 폴더에 추출하고, 그 안의 모듈만 사용했다. 합성 CSV·TSV·XLSX·Parquet와 로컬 SBDF 표본을 읽었다. 사용자 데이터 파일은 검사 서버에 업로드하지 않았다. 테스트 HTTP 수신기는 루프백 주소에만 열었다.

- `strace -f -e trace=network,execve`로 실행 프로세스와 스레드를 추적했다.
- Parquet·CSV·TSV·SBDF·XLSX의 조회와 통계를 실행했다.
- HTTP CSV/JSON·암시적 URL 읽기·공간 확장 자동 로드·INSTALL·LOAD·외부 접근 재설정·COPY·허용 밖 로컬 파일 읽기 등 12개 시도는 모두 실패했다.
- 추적에서 AF_INET/AF_INET6 소켓 생성·연결·전송 이벤트 **0건**, 루프백 HTTP 수신 **0건**이었다.
- 차단 시도 후에도 정상 로컬 SELECT가 성공했다.
- Webview CSP·HTML 삽입·시트 선택·패키지 검사를 포함한 추가 보안 테스트 **7개 통과, 건너뜀 0개**였다.
- `npm audit --omit=dev`의 알려진 런타임 의존성 취약점 보고는 **0건**이었다. 이는 동봉 네이티브 엔진을 포함한 모든 코드의 취약점 부재를 보증하지 않는다.

로컬 증거는 `dist/security-0.1.12-network.json`과 보안 테스트에 남겼다. 테스트는 기존 저장소 정책에 따라 공개 Git·VSIX에 포함하지 않는다. 개발 도구의 npm 취약점 조회·Git push·Marketplace 업로드 통신은 확장 사용 중의 데이터 처리와 구분한다.

## 사용자가 알아야 할 저장·노출 범위

- **Remote SSH·WSL:** 파일 처리는 workspace 확장 호스트에서 수행하지만, 화면에 표시할 결과·경로·오류는 사용자의 VS Code 클라이언트로 전달한다. 원격 호스트 밖으로 아무 정보도 나오지 않는 구조는 아니다.
- **즐겨찾기:** 저장한 SQL·별칭·설명은 VS Code 확장 전역 저장소의 파일에 남는다. 확장 차원의 암호화를 적용하지 않는다. 경로 복사 버튼은 사용자가 눌렀을 때 운영체제 클립보드에 경로를 쓴다.
- **임시 파일·오류:** DuckDB가 임시 디스크를 사용할 수 있고, 화면과 VS Code 로그에 경로나 오류가 남을 수 있다. 화면 공유·오류 제보·다른 프로그램의 파일 접근까지 막는 제품은 아니다.
- **다른 소프트웨어:** VS Code 자체의 텔레메트리·설치/업데이트, 다른 확장, 운영체제 백업·클라우드 동기화는 이 확장 코드 검사로 보장하지 않는다.

Windows 패키지는 실행 코드·의존성·패키지 내용을 검사했지만 Windows VS Code 안에서 네트워크 추적을 실행하지 않았다. 악성 파일로 인한 네이티브 메모리 취약점, 새로 발견될 공급망 취약점, 모든 SQL 변형은 이번 검사로 배제할 수 없다. [DuckDB의 보안 범위](https://duckdb.org/security)도 함께 참고한다.
