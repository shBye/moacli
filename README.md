# MoaCLI

Claude Code, Codex, Gemini CLI, OpenCode와 PowerShell을 한 Electron 앱에서 실행하고 로컬 대화를 재개하기 위한 Windows 우선 프로토타입입니다.

## 현재 지원 범위

- `node-pty`와 xterm.js를 사용한 실제 대화형 CLI 화면
- 최대 10개의 CLI 세션 동시 유지 및 왼쪽 실행 목록에서 즉시 전환
- 30분 동안 보지 않은 백그라운드 세션 자동 종료와 수동 닫기
- 새 CLI 세션 시작 및 로컬 히스토리 세션 `resume`
- `CLI` / `대화 전문` 탭과 공통 세션 제목 헤더
- Claude, Codex, Gemini 로컬 계정 자동 감지
- 계정 정보가 확인된 저장소만 Recent conversations에 노출
- Claude `CLAUDE_CONFIG_DIR`, Codex `CODEX_HOME` 기반 수동 다중 계정 격리
- Claude, Codex, Gemini, OpenCode 로컬 히스토리 어댑터
- 한글 IME 조합 문자열 오버레이
- 텍스트 및 클립보드 이미지 `Ctrl+V`
- 논리 폴더와 실제 작업 디렉터리를 분리한 UI 골격
- CLI 실행 파일 탐색, 버전 확인, 상태 표시

상세 구현 현황과 해결한 이슈는 [PROGRESS.md](./PROGRESS.md), 다음 개발 기능의 설계와 우선순위는 [ROADMAP.md](./ROADMAP.md)를 참고합니다.

## 실행

```powershell
npm.cmd install
npm.cmd run dev
```

개발 renderer 포트는 다른 로컬 Vite 서버와 충돌하지 않도록 `5187`로 고정되어 있습니다.

프로덕션 빌드 검증:

```powershell
npm.cmd run build
```

빌드 후 메모리를 줄여 실행하려면 Windows 전용 명령을 사용합니다.

```powershell
# GPU 가속 유지, npm Electron 래퍼 제외
npm.cmd run start:lean

# GPU 가속도 비활성화하는 최소 메모리 모드
npm.cmd run start:low-memory
```

`start:low-memory`는 빈 화면 안정화 기준 전용 메모리를 약 100MB 더 줄였지만, 여러 CLI가 빠르게 출력할 때 CPU 사용량이 증가할 수 있습니다. 일반 사용은 `start:lean`, 메모리가 부족한 환경은 `start:low-memory`를 권장합니다.

`node-pty`의 Electron ABI 오류가 발생한 경우에만 다시 빌드합니다.

```powershell
npx electron-rebuild -f -w node-pty
```

## 기본 사용 흐름

### 새 세션

1. 상단에서 Title, Agent, Account, Working directory를 선택합니다.
2. `Start`를 누릅니다.
3. 오른쪽 `CLI` 탭에서 실제 CLI TUI를 사용합니다.

### 기존 대화 재개

1. 왼쪽 Recent conversations에서 항목을 누릅니다.
2. 해당 계정, 작업 경로, 세션 ID로 공식 CLI의 resume 명령을 실행합니다.
3. `대화 전문` 탭에서는 로컬 저장 기록을 읽을 수 있습니다.

### 이미지 붙여넣기

터미널에서 `Ctrl+V`를 누르면 텍스트는 그대로 입력됩니다. 클립보드가 이미지면 임시 PNG로 저장하고 따옴표로 감싼 파일 경로를 현재 CLI 입력줄에 삽입합니다. Enter는 자동 전송하지 않습니다.

## 계정과 자격증명

- 앱은 비밀번호, OAuth 토큰, API 키를 직접 입력받거나 저장하지 않습니다.
- 로그인 버튼은 격리된 환경에서 공식 CLI 로그인 명령을 실행합니다.
- 기본 계정은 각 CLI의 로컬 인증 메타데이터에서 이메일을 확인할 수 있을 때만 등록합니다.
- 수동 계정은 이메일과 독립 config directory가 모두 있어야 히스토리를 읽습니다.
- 같은 cwd에서 여러 계정을 실행할 수 있지만 동시에 같은 파일을 수정하면 충돌할 수 있습니다. 병렬 수정에는 Git worktree를 권장합니다.

## 주요 디렉터리

```text
electron/
  agent-profiles.ts   CLI 탐색, Windows 실행 래퍼, 헬스체크
  contracts.ts        renderer/preload/main IPC 계약
  main.ts             BrowserWindow와 IPC 등록
  pty-manager.ts      PTY 생성, 계정 환경, resume, 종료
  session-history.ts  계정 감지 및 CLI별 히스토리 어댑터
src/
  App.tsx             화면 상태와 사용자 흐름
  history/            대화 전문 렌더링
  terminal/           xterm 래퍼와 IME 처리
profiles/
  agents.default.json CLI 실행 및 resume 인자
```

## 디자인과 창 효과

- 프레임리스 디자인은 유지하되 창 배경은 안정적인 불투명 다크 셸을 사용합니다.
- Windows DWM `acrylic`은 리사이즈와 최대화 후 검정 배경으로 고착되는 문제가 있어 기본 구현에서 제외했습니다.
- `Inter Variable`은 앱 UI, `JetBrains Mono Variable`은 터미널에 사용하며 폰트와 OFL 라이선스는 `src/assets/fonts/`에 포함합니다.
- BrowserWindow와 앱 셸은 모두 `#121418` 배경을 사용해 크기와 상태 전환 중 색이 달라지지 않습니다.
