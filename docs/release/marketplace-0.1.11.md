# Marketplace 0.1.11 공개 준비 기록

## 완료한 준비

- 공개 README에서 개발·운영 및 내부 배포 안내 제거.
- 녹색 범고래·흰색 S 문양 PNG 아이콘과 공개 예제 화면 추가. 실제 Webview와 자체 생성한 예제 Parquet 조회로 촬영했으며 사용자 파일·시스템 경로를 사용하지 않았다.
- 변경 이력, 개인정보 안내, 보안 범위 및 실제 편집기 번들 16개 패키지의 라이선스 원문 고지 추가.
- 즐겨찾기 인덱스 ID의 경로 문자·중복·항목 수·파일 및 문자열 크기 검증 강화. 기존 정상 ID와 마이그레이션은 유지.
- 빌드 시 VSIX 파일 허용 목록과 확장 소유 코드·문서·이미지의 인증 정보·내부 네트워크·빌드 머신 경로 검사 추가. 공급업체 네이티브 바이너리의 전체 취약점 분석은 이 검사의 범위가 아니다.

## 검증 결과

- `npm run check` 통과.
- `npm test`: 32개 통과, 건너뛴 테스트 없음.
- `npm audit --omit=dev`: 보고된 알려진 취약점 0개. 네이티브 DuckDB의 모든 취약점 부재를 보장하는 결과는 아니다.
- SQL 읽기 전용·파일 접근 경계, symlink, 취소·타임아웃·정상 종료, 백업 인덱스 조작, HTML 형태의 셀·칼럼·즐겨찾기가 실행되지 않는 동작 확인.
- 두 플랫폼 VSIX의 publisher·버전·target·아이콘·변경 이력·실행 파일과 실제 소스 일치 확인.
- 두 패키지 모두 전체 220개 확장 파일 중 확장 소유 20개 파일과 공급업체 200개 파일을 구분하고, 비허용 운영 파일·테스트·인증 파일이 없음을 확인.
- PNG 아이콘 512×512, 예제 화면 1360×960. 아이콘은 픽셀과 투명도를 보존하면서 부가 메타데이터를 제거했다.
- Linux VSIX를 독립 임시 폴더에 추출해 동봉한 모듈만으로 실제 조회·LIST·푸터 통계·실패한 소스 변경 보존·네이티브 조회 중 종료를 확인.
- Windows VS Code에서의 직접 실행과 macOS·ARM 패키지는 미검증.

## 최종 산출물

- `pq-explorer-0.1.11-linux-x64.vsix`: 24,001,519 bytes, SHA-256 `90c1697321e3145f47a3a712b14fd8956804ff5990510bf83812e0be4a44859f`.
- `pq-explorer-0.1.11-win32-x64.vsix`: 13,774,601 bytes, SHA-256 `eda155917df06b5f14a6582e5cb794911f28e5982295e7d6c6d95749ca2e54dd`.

## 게시 상태

최종 read-only 교차 점검과 게시 인증 검증을 마쳤다. 2026-10-17에 `smoke-19.pq-explorer` 0.1.11의 Windows x64·Linux x64 업로드 명령이 모두 성공했다. 최초 게시 직후 약 5분 동안 검증을 기다렸다. 이후 Windows x64는 검증 완료됐지만 Linux 항목은 등록되지 않아 WSL 설치 오류가 발생했다. Linux 패키지를 단독 재게시했고 현재 Gallery에 두 플랫폼이 모두 등록됐다. Linux의 검증 완료 여부는 아래 후속 기록을 따른다.

스크린샷은 `PQExplorer.Screenshots.Explorer`라는 addressable VSIX 자산으로 등록했다. 패키지의 공개 README는 같은 버전의 Marketplace HTTPS 자산 URL을 사용한다. 게시 직후 아이콘 URL은 HTTP 200이며 로컬 파일과 SHA-256이 일치했다. 최초에는 스크린샷·변경 이력·확장 manifest의 자산 URL과 공개 페이지가 404였다. 후속 확인에서 공개 페이지 HTTP 200과 검증된 Windows CDN 스크린샷 HTTP 200 및 로컬 이미지 해시 일치를 확인했다. Linux 재게시 검증 중에는 버전 공통 이미지 주소가 일시적으로 404를 반환했다. 별도 소스 저장소 push는 수행하지 않았다.

저장소 폴더에서의 사용자 로그인 명령:

```bash
node node_modules/@vscode/vsce/vsce login smoke-19
```

실행한 게시 명령:

```bash
node node_modules/@vscode/vsce/vsce publish --packagePath dist/pq-explorer-0.1.11-win32-x64.vsix dist/pq-explorer-0.1.11-linux-x64.vsix
```

이 명령은 기존 VSIX를 사용하므로 원본 폴더를 다시 패키징하거나 Git 커밋·태그를 생성하지 않는다.


## 게시 진행 기록

최초에는 게시 인증이 없어 업로드하지 않았다. 이후 사용자가 로그인한 뒤 `verify-pat smoke-19`가 성공했다. 첫 업로드는 1254×1254 아이콘이 서버의 1024×1024 상한을 넘어서 거절됐다. 아이콘을 투명도를 유지한 512×512로 축소하고, 패키지 감사에 PNG 크기 검증을 추가했다. 관련 테스트 3개가 통과했으며, 두 VSIX를 다시 생성했다. 재생성 전후 ZIP 항목을 비교해 아이콘 이외의 모든 항목이 바이트 단위로 같음을 확인했다. 위 해시는 축소한 아이콘을 포함한 최종 게시용 파일 기준이다.

비공개 다운로드 서비스의 기존 0.1.11 파일은 1254×1254 아이콘을 포함한 게시 전 빌드이며 덮어쓰지 않았다. 현재 `dist/`의 게시용 VSIX와 아이콘만 다르다. 공개 Marketplace README·이미지에는 이 서비스 주소를 포함하지 않았다.

## 최초 게시 직후 서버 확인

- 확인 시각: `2026-10-17T05:26:53.566Z`.
- 두 플랫폼 모두 `vsce publish --packagePath`의 `DONE Published` 응답을 받았다.
- Gallery 조회에는 Windows x64 0.1.11만 노출됐으며 버전 flags는 `0`으로, `Validated=1` 상태를 확인하지 못했다. Linux x64의 Gallery 조회 반영도 아직 확인하지 못했다.
- 공개 상세 페이지와 스크린샷은 HTTP 404였다. 검증이 끝나기 전에는 공개·설치 가능 및 스크린샷 정상 표시를 완료로 판단하지 않는다.
- [Marketplace 페이지](https://marketplace.visualstudio.com/items?itemName=smoke-19.pq-explorer), [게시자 관리 화면](https://marketplace.visualstudio.com/manage/publishers/smoke-19/extensions/pq-explorer/hub).
- Git 커밋·push·태그는 수행하지 않았다.

## WSL 설치 오류 후 Linux 재게시

- 2026-10-17 07:22 UTC 확인 시 Windows x64만 Gallery에 존재했고 `flags=1`이었다. Linux 패키지를 찾지 못해 WSL에서 플랫폼 미지원 오류가 표시됐다.
- 로컬 Linux VSIX의 `TargetPlatform=linux-x64`, workspace 확장 호스트, Linux DuckDB 네이티브 라이브러리와 기존 검증 해시를 확인했다. 코드 변경 없이 기존 패키지를 단독 재게시했다.
- 재게시 명령: `node node_modules/@vscode/vsce/vsce publish --packagePath dist/pq-explorer-0.1.11-linux-x64.vsix`.
- 07:22:32 UTC 조회부터 Linux x64가 추가됐으며 Windows x64도 유지됐다. 최초 누락의 서버 내부 원인은 확인되지 않았다.
- Marketplace CDN에서 Linux VSIX를 HTTP 200으로 내려받았고 24,001,519 bytes 및 SHA-256 `90c1697321e3145f47a3a712b14fd8956804ff5990510bf83812e0be4a44859f` 일치와 내장 target·라이브러리를 확인했다.
- 이후 게시 시 각 플랫폼의 Gallery 등록·검증과 실제 다운로드를 확인하도록 `BUILD.md` 절차를 보강했다.
- 마지막 Linux 검증 상태 확인: `2026-10-17T07:25:43.180Z`; Linux `flags=0`(검증 대기), Windows `flags=1`(검증 완료). Linux 등록·실제 파일 다운로드는 확인했으나 마켓 설치 가능 상태는 아직 확인되지 않았다.
- 검증 대기 중에는 CDN에서 내려받은 Linux VSIX를 WSL에 연결된 VS Code의 `Extensions: Install from VSIX...`로 설치할 수 있다. 사용자 WSL에 직접 설치하거나 실행하지는 않았다.

- 검증 대기 중 일반 `vspackage?targetPlatform=linux-x64` 다운로드 경로는 HTTP 200이라도 Linux 해시와 일치하지 않았다. 직접 확인한 Linux CDN 자산만 임시 수동 설치용으로 사용한다.
- 검증한 Linux CDN 자산: `https://smoke-19.gallerycdn.vsassets.io/extensions/smoke-19/pq-explorer/0.1.11/1792221748565/Microsoft.VisualStudio.Services.VSIXPackage`. 응답은 ZIP이며 파일명 헤더가 없으므로 `pq-explorer-0.1.11-linux-x64.vsix`로 저장한다.
