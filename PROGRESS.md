# MoaCLI 진행 현황

## Public Windows release (2026-08-19)

- Replaced all Korean text in the runtime UI, tooltips, accessibility labels, loading states, and date formatting with English.
- Added a configurable x64 NSIS installer that uses the MoaCLI application, installer, uninstaller, desktop shortcut, and Start menu icons.
- Verified `MoaCLI-Setup.exe` metadata, SHA-256 generation, embedded icon extraction, and a packaged-app startup smoke test.
- Installer output remains excluded from Git and is published as a GitHub Release asset. The README download button resolves to the latest release.
- Added `docs/WINDOWS_RELEASE.md` with the verified build, installer QA, GitHub publishing, and failure-recovery process.
- Public-repository audit found no tracked credentials, tokens, private keys, or user-specific home-directory paths. Design mockup identities were replaced with neutral example values.

## Product naming (2026-08-14)

- Product name: `MoaCLI` (Korean reading: `모아클리`).
- Meaning: bring multiple CLI agents, accounts, sessions, and conversations together in one workspace.
- npm/package identifier: `moacli`.
- Windows package identity: `app.moacli.desktop`.
- The legacy `%APPDATA%\cli-agent-manager` user-data directory and `cli-agent-manager.*` localStorage keys remain in use so existing accounts, folders, icon choices, and theme settings are preserved.

최종 갱신: 2026-08-14  
현재 단계: Windows 실사용 프로토타입 안정화

## 최근 수정: CLI 입력 영역 높이

- 디자인 조정 중 xterm의 `lineHeight`가 `1.75`로 설정되어 Claude/Codex TUI의 입력 영역도 지나치게 높아졌습니다.
- `fontSize: 12`는 유지하고 `lineHeight`만 `1.3`으로 낮춰 터미널 전체 행 간격과 입력 영역 높이를 정상화했습니다.

## 최근 수정: 폴더 드래그, 순서 및 전환 상태

- Recent 대화를 폴더로 드래그하고, 폴더의 대화를 같은 폴더 안에서 재정렬하거나 다른 폴더의 특정 위치로 이동할 수 있습니다.
- 대화 행의 위·아래 절반을 기준으로 삽입 위치를 계산하며 accent 삽입선을 표시합니다.
- 폴더 목록, `conversationKey → folderId` 배정, 폴더별 대화 순서는 각각 `localStorage`에 저장됩니다. CLI 원문과 자격증명은 저장하지 않습니다.
- Recent 대화를 클릭해 선택 폴더에서 여는 경우도 폴더 배정을 함께 저장합니다.
- 폴더 대화 추가·제거에는 높이/투명도 전환을 적용했고, 같은 폴더 헤더를 다시 누르면 부드럽게 접힙니다.
- Folders와 Recent 사이의 가로 경계를 드래그해 폴더 영역 높이를 조정하며, 높이는 재실행 후에도 유지됩니다.
- 새 CLI는 첫 PTY 출력 또는 안전 타임아웃까지 indeterminate 진행 바를 표시하고, 대화 전문 파싱에도 별도 로딩 바를 표시합니다.
- Claude처럼 첫 출력이 즉시 도착하는 CLI에서도 진행 상태를 인지할 수 있도록 시작 표시를 최소 650ms 유지합니다.
- Recent는 폴더 배정 여부와 무관한 전체 최근 기록으로 유지하며, 배정된 항목에는 폴더명을 표시합니다.
- 계정별 Claude/Codex/Gemini/OpenCode 기록 루트를 `fs.watch`로 감시하고 700ms 디바운스 후 Recent를 갱신합니다.
- 감시 이벤트 누락에 대비해 앱이 보이는 동안 60초 간격으로 보정하며, 파일 `mtime/size` 기반 요약 캐시로 변경되지 않은 원문 재파싱을 피합니다.
- CMD나 공식 CLI에서 기록을 삭제하면 다음 감지 시 Recent와 비활성 폴더 항목에서 사라집니다. 이미 실행 중인 PTY 세션은 강제 종료하지 않습니다.
- 설정 모달의 테마 아래에 `Agent icons` 섹션을 추가했습니다. 서비스별 모노그램, 터미널, 에이전트, 코드, 사용자 이미지 중 하나를 선택할 수 있습니다.
- 사용자 아이콘은 PNG/JPEG/WebP만 허용하고 64x64 캔버스로 축소해 `localStorage`에 저장합니다. 원본 파일 경로나 공식 서비스 로고는 앱에 번들하지 않습니다.
- 아이콘 설정은 폴더, Recent, Agents, 세션 헤더, 런처, 계정 설정의 모든 에이전트 표시에 공통 적용됩니다.
- 서비스별 Lucide 버튼을 누르면 전체 Lucide 컬렉션 선택 모달이 열립니다. 이름 검색, 120개 단위 페이지 이동, 현재 선택 표시를 지원합니다.
- Lucide 아이콘은 `dynamicIconImports`로 현재 화면에 필요한 아이콘만 지연 로드하며, 선택 이름을 서비스별 설정에 저장합니다.
- 서비스별 아이콘 배경색을 조합할 수 있습니다. 문자/Lucide는 배경 대비 전경색을 자동 선택하고 투명 PNG/WebP는 선택 색을 이미지 뒤에 표시합니다.
- 아이콘 종류를 바꿔도 배경색은 유지되며 재설정 버튼으로 에이전트 기본 색상으로 돌아갑니다.

## 1. 목표와 현재 결론

목표는 Claude Code, Codex, Gemini CLI, OpenCode 같은 로컬 코딩 CLI를 한 화면에서 시작하고, 계정별 로컬 히스토리를 찾아 실제 CLI TUI로 재개하는 것입니다.

현재 프로토타입은 다음 핵심 가능성을 검증했습니다.

- Electron 안에서 실제 대화형 CLI TUI를 실행할 수 있습니다.
- 한글 IME 조합 문자열을 xterm 위에 표시할 수 있습니다.
- Claude, Codex, Gemini의 계정과 최근 로컬 세션을 찾을 수 있습니다.
- 왼쪽 대화를 클릭해 저장된 내용을 별도 UI로 흉내 내는 대신 공식 CLI `resume`을 실행할 수 있습니다.
- 계정별 설정 루트를 분리해 같은 종류의 CLI 계정을 여러 개 구성할 수 있습니다.
- CLI 화면과 파싱한 대화 전문을 같은 세션의 별도 탭으로 제공할 수 있습니다.

아직 제품 단계는 아닙니다. 여러 PTY 동시 유지, 논리 폴더 영속화, 패키징 검증, 설정 편집 UI가 남아 있습니다.

## 2. 구현 상태 요약

| 영역 | 상태 | 현재 구현 |
|---|---|---|
| Electron 앱 셸 | 완료 | Electron 33 + React 18 + electron-vite |
| 실제 CLI 터미널 | 완료 | xterm.js + node-pty |
| Windows PTY 안정화 | 완료 | node-pty 자체 ConPTY DLL 사용 |
| 새 세션 시작 | 완료 | agent/account/cwd/title 선택 후 spawn |
| 기존 세션 재개 | 완료 | CLI별 resume ID 전달 |
| CLI/대화 전문 탭 | 완료 | PTY를 유지한 채 visibility만 전환 |
| 공통 제목 헤더 | 완료 | title, cwd, agent, message count, email |
| Recent conversations | 완료 | CLI별 최대 30개, 최신순 |
| Claude 히스토리 | 완료 | `~/.claude/projects/**/*.jsonl` |
| Codex 히스토리 | 완료 | `~/.codex/sessions/**/*.jsonl` |
| Gemini 히스토리 | 완료 | `~/.gemini/tmp/*/chats/*.json` |
| OpenCode 히스토리 | 부분 완료 | CLI `session list`와 `export` 사용, 자동 계정 감지는 미구현 |
| 기본 계정 감지 | 완료 | Claude/Codex/Gemini 이메일 확인 |
| 수동 다중 계정 | 완료 | Claude/Codex config root 분리 |
| 공식 CLI 로그인 | 부분 완료 | Claude/Codex 로그인 실행, 실제 이메일 일치 검증은 미구현 |
| 한글 IME | 완료 | 조합 문자열 DOM 오버레이 |
| 텍스트 붙여넣기 | 완료 | `Ctrl+V` |
| 이미지 붙여넣기 | 완료 | 임시 PNG 경로 삽입 |
| 논리 폴더 UI | 부분 완료 | 선택/추가 가능, 메모리 상태만 사용 |
| 다중 PTY 탭 | 미구현 | 현재 활성 PTY 한 개 |
| SQLite 영속화 | 미구현 | 초기 설계만 존재 |
| 설치 패키지 | 미검증 | build만 검증, installer QA 필요 |

## 3. 현재 아키텍처

```text
React App
  -> preload의 window.cliAgent API
    -> Electron IPC
      -> Agent profile/health service
      -> SessionHistoryService
      -> PtyManager
        -> node-pty
          -> Claude/Codex/Gemini/OpenCode/PowerShell
```

### 프로세스 경계

- Renderer는 파일 시스템과 자격증명에 직접 접근하지 않습니다.
- Preload는 `contextBridge`로 필요한 IPC만 노출합니다.
- Main process가 계정 감지, 히스토리 파싱, 클립보드 이미지 저장, PTY 실행을 담당합니다.
- 실제 인증과 토큰 갱신은 각 공식 CLI가 담당합니다.

### 세션 클릭 흐름

```text
Recent conversation 클릭
  -> session의 agentId/accountId/cwd/resumeId 선택
  -> 로컬 대화 전문 비동기 로드
  -> 해당 CLI의 args_resume 구성
  -> 계정별 환경 변수 적용
  -> PTY spawn
  -> xterm에 실제 TUI 연결
```

`대화 전문` 탭으로 이동해도 `TerminalPane`을 unmount하지 않습니다. CSS visibility만 변경하므로 실행 중인 CLI와 입력 상태가 유지됩니다.

## 4. 에이전트별 동작

| Agent | 새 세션 | Resume | 계정 격리 | 계정 자동 감지 |
|---|---|---|---|---|
| PowerShell | `powershell.exe -NoLogo` | 없음 | 로컬 셸 | 해당 없음 |
| Claude | `claude` | `claude --resume {id}` | `CLAUDE_CONFIG_DIR` | `claude auth status` |
| Codex | `codex` | `codex resume {id}` | `CODEX_HOME` | `auth.json` ID token의 verified email claim |
| Gemini | `gemini` | `gemini --resume {id}` | 현재 기본 저장소만 | `google_accounts.json` |
| OpenCode | `opencode` | `opencode --session {id}` | 수동 config만 | 미구현 |

감지된 기본 계정에는 config 환경 변수를 억지로 덮어쓰지 않습니다. 일부 CLI는 기본 위치일 때 홈 디렉터리의 다른 메타데이터도 함께 찾기 때문입니다. 수동 계정에만 격리 환경 변수를 적용합니다.

## 5. 계정 및 보안 정책

### 표시 조건

Recent conversations는 다음 조건을 만족하는 계정만 스캔합니다.

- account ID가 존재합니다.
- 이메일이 비어 있지 않습니다.
- config directory가 존재합니다.

따라서 계정 이메일을 확인할 수 없으면 해당 저장소의 일부 세션만 임의로 보여주지 않고 전체를 숨깁니다.

### 자격증명 처리

- 앱 자체 로그인 폼으로 비밀번호나 토큰을 받지 않습니다.
- 공식 CLI 로그인 명령만 PTY에서 실행합니다.
- Codex 이메일 감지는 JWT payload의 email과 `email_verified` claim만 읽습니다.
- 토큰 원문은 renderer, localStorage, 로그로 전달하지 않습니다.
- 수동 계정 정보에는 email과 config directory만 저장합니다.

### 다중 계정

- Claude 수동 계정: 서로 다른 `CLAUDE_CONFIG_DIR`
- Codex 수동 계정: 서로 다른 `CODEX_HOME`
- 같은 cwd에서 계정 여러 개를 실행하는 것은 가능합니다.
- 동일 파일을 동시에 수정하는 문제는 자격증명 격리와 별개이므로 Git worktree로 해결해야 합니다.

## 6. 히스토리 설계 변경

초기 설계는 “대화 내용을 파싱하지 않고 resume ID만 저장한다”였습니다. 현재 요구사항에 `대화 전문` 탭이 포함되면서 이 원칙을 수정했습니다.

현재 앱은 원본 대화를 복사해 별도 DB에 저장하지는 않지만, 각 CLI의 로컬 저장 포맷을 읽어 UI 모델로 변환합니다.

- 장점: 별도 대화 DB 없이 최신 로컬 기록을 바로 읽습니다.
- 단점: CLI 버전이 로컬 포맷을 변경하면 어댑터 수정이 필요합니다.
- 대응: 에이전트별 parser를 `SessionHistoryService`에 분리하고 파싱 실패 세션은 건너뜁니다.
- 성능: 에이전트별 최신 30개만 읽고 큰 JSONL은 앞/뒤 샘플을 사용해 목록을 만듭니다.
- 전체 전문은 사용자가 항목을 선택했을 때만 읽습니다.

## 7. 해결한 이슈 상세

### 7.1 대화 클릭 시 실제 CLI가 아니라 커스텀 대화 화면이 열림

**증상**  
왼쪽 대화를 클릭하면 과거 메시지만 보이고 후속 입력을 할 수 없었습니다.

**원인**  
초기 구현이 `getConversation()` 결과를 렌더링하는 history view를 클릭 기본 동작으로 사용했습니다.

**해결**  
클릭한 세션의 `agentId`, `accountId`, `cwd`, `resumeId`를 `StartPtyRequest`에 넣고 CLI별 `args_resume`으로 실제 프로세스를 시작하도록 변경했습니다. 대화 전문은 별도 탭으로 옮겼습니다.

**검증**  
Claude, Codex, Gemini 프로필에 resume placeholder가 들어가며 TypeScript build가 통과했습니다.

### 7.2 Codex가 설치됐는데 not found로 표시됨

**증상**  
Codex 앱과 세션이 존재하지만 `Get-Command codex`와 앱 헬스체크에서 찾지 못했습니다.

**원인**  
Electron PATH에는 Codex가 없었고 실제 실행 파일은 npm 패키지 내부 또는 Codex 관리 디렉터리에 있었습니다.

**해결**  
탐색 우선순위를 다음과 같이 확장했습니다.

1. PATH와 `%APPDATA%\npm`의 cmd/exe/bat/ps1
2. npm `@openai/codex-win32-*` 패키지의 독립형 `codex.exe`
3. `~/.codex/.sandbox-bin/codex.exe`
4. plugin appserver의 fallback binary

Desktop 연동 바이너리보다 독립형 npm CLI를 우선합니다.

**검증**  
`codex-cli 0.147.0`과 정확한 resolved path를 확인했습니다.

### 7.3 Codex Recent conversations가 없는 것처럼 보임

**증상**  
Codex 세션 파일은 있지만 목록 제목이 Codex 대화처럼 보이지 않았습니다.

**원인**  
Codex JSONL의 첫 user message가 실제 질문이 아니라 `<environment_context>` 같은 시스템 주입 메시지였습니다.

**해결**  
`environment_context`, permissions, AGENTS 지침처럼 알려진 합성 메시지를 제목 후보에서 제외하고 첫 실제 사용자 메시지를 제목으로 사용합니다.

**검증**  
로컬 스모크 테스트에서 Claude 30, Codex 30, Gemini 30 세션을 감지했고 Codex 제목이 실제 사용자 질문으로 출력됐습니다.

### 7.4 계정 정보와 세션 소유자 연결

**증상**  
로컬 세션 파일만 읽으면 어떤 계정의 대화인지 보장할 수 없었습니다.

**원인**  
세션 포맷에 이메일이 항상 포함되지 않고 config root 자체가 계정 경계 역할을 합니다.

**해결**  
계정 이메일과 config directory를 하나의 `AgentAccount`로 관리하고, 해당 계정 루트에서 읽은 모든 세션에 `accountId/accountEmail`을 부여합니다. 이메일을 확인할 수 없는 계정은 히스토리 스캔 대상에서 제외합니다.

### 7.5 Gemini가 ps1로만 설치된 경우 실행 불가

**증상**  
`gemini.ps1`은 존재하지만 PowerShell execution policy 때문에 직접 실행이 실패하거나 not found가 됐습니다.

**원인**  
기존 탐색 대상이 exe/cmd/bat뿐이었고 node-pty가 ps1을 직접 실행할 수 없었습니다.

**해결**  
`.ps1`도 탐색하고 다음 래퍼로 실행합니다.

```text
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File <script.ps1> ...args
```

버전 조회가 timeout되더라도 실행 파일이 존재하면 `detected` 상태로 표시합니다.

### 7.6 Codex 진행 중 여러 위치에서 네모 커서가 점멸

**증상**  
Codex가 답변을 생성하는 동안 cwd 오른쪽과 갱신된 셀 주변에 네모 박스가 여러 개 점멸했습니다. Claude와 실제 CMD에서는 정상입니다.

**원인**  
Codex TUI가 애니메이션 프레임과 함께 ANSI `DECSCUSR` 커서 모양 변경 및 DEC cursor blink 모드를 보냅니다. xterm에서 빠르게 이동하는 blinking block cursor가 렌더링 잔상처럼 보였습니다.

**시도했지만 철회한 방법**

- `tui.animations=false`: 점멸은 줄지만 진행 애니메이션 전체가 사라져 UX 요구에 맞지 않았습니다.
- `--no-alt-screen`: 실제 CMD와 실행 모드가 달라지고 근본 해결이 아니어서 제거했습니다.

**최종 해결**  
Codex에서만 xterm parser handler로 다음 시퀀스를 소비합니다.

- `CSI Ps SP q`: 원격 cursor style 변경
- `CSI ? 12 h/l`: 원격 cursor blink mode 변경

Codex의 텍스트/스피너 애니메이션은 기본값 그대로 두고 앱이 지정한 bar cursor와 blink 설정만 유지합니다. Claude에는 필터를 적용하지 않습니다.

**상태**  
구현과 build는 완료했습니다. 긴 Codex 응답에서의 사용자 체감 회귀 검증은 계속 필요합니다.

### 7.7 Electron 종료 시 00000 메모리 참조 오류

**증상**  
앱/PTY를 종료하거나 교체할 때 Windows 메모리 참조 오류처럼 보이는 창이 나타나고 Electron이 꺼졌습니다.

**원인**  
메모리 부족이 아니라 node-pty의 ConPTY 보조 프로세스가 종료 과정에서 `AttachConsole failed`를 발생시켰습니다. 기본 ConPTY 구현은 console process list 조회를 위해 별도 Node helper를 실행합니다.

**해결**  
Windows PTY 옵션에 `useConptyDll: true`를 적용해 node-pty에 포함된 `conpty.dll/OpenConsole.exe` 경로를 사용합니다. 이 모드는 문제가 된 `conpty_console_list_agent` 경로를 사용하지 않습니다.

**검증**  
재시작 후 stderr에서 `AttachConsole failed`가 사라졌습니다.

### 7.8 개발 앱이 다른 Vite 앱에 연결됨

**증상**  
Electron이 예상과 다른 renderer에 연결되거나 시작 직후 종료되는 것처럼 보였습니다.

**원인**  
5173/5174를 다른 프로젝트가 이미 사용 중이었고 자동 포트 이동 로그를 기반으로 수동 실행하면서 잘못된 서버에 연결될 여지가 있었습니다.

**해결**  
renderer 개발 포트를 `5187`, `strictPort: true`로 고정했습니다. 충돌 시 다른 앱에 연결하지 않고 명시적으로 실패합니다.

### 7.9 Codex Desktop 승인 창이 앞으로 나타남

**증상**  
개발 중 Codex Desktop이 화면 앞으로 올라오며 승인을 요구했습니다.

**원인**  
CLI Agent Manager의 인증 팝업이 아니라, 이 프로젝트를 수정하던 Codex Desktop 작업에서 파일 시스템/프로세스 권한 상승 승인을 요청한 것입니다. 동시에 초기에는 Desktop 관리 binary를 fallback으로 감지한 점도 혼동을 키웠습니다.

**해결**  
매니저는 독립형 npm Codex CLI를 우선 실행합니다. 개발 도구의 승인은 보안 경계이므로 자동 우회하지 않습니다. 매니저 안에서 실행된 CLI 자체의 명령 승인은 해당 CLI TUI에서 처리합니다.

### 7.10 클립보드 이미지 붙여넣기

**증상**  
일반 CMD/PTY에서는 클립보드 이미지를 직접 붙여넣을 수 없습니다.

**해결**  
Main process가 Electron clipboard 이미지를 읽어 `%TEMP%\cli-agent-manager\pasted-images`에 PNG로 저장하고, renderer에는 파일 경로만 반환합니다. 현재 입력줄에 따옴표로 감싼 경로를 삽입하며 Enter는 자동 전송하지 않습니다.

**남은 작업**  
임시 이미지 보존 기간과 정리 정책이 필요합니다.

### 7.11 한글 IME 조합 문자가 보이지 않음

**증상**  
xterm의 숨은 textarea에서 조합 중인 한글이 커서 위치에 안정적으로 보이지 않았습니다.

**해결**  
composition event를 표시 전용 DOM overlay에 렌더링하고 xterm buffer cursor 위치를 따라가게 했습니다. 확정 문자열은 xterm 표준 `onData`로 한 번만 PTY에 전달합니다.

## 8. 검증 기록

2026-08-13 기준:

- `npm.cmd run typecheck`: 통과
- `npm.cmd run build`: 통과
- Electron main/preload/renderer production bundle: 통과
- 개발 renderer: `http://localhost:5187`
- Electron renderer 연결: 확인
- 개발 stderr: 최종 재시작 시 비어 있음
- 계정 자동 감지: Claude/Codex/Gemini 확인
- 히스토리 스모크 테스트: Claude 30, Codex 30, Gemini 30
- Codex 실행 파일: 독립형 npm CLI `0.147.0` 우선 감지

실제 계정 이메일과 인증 토큰은 이 문서에 기록하지 않습니다.

## 9. 현재 제한과 기술 부채

1. 활성 PTY는 한 개뿐입니다. 다른 대화를 클릭하면 기존 PTY를 종료하고 새 PTY를 시작합니다.
2. 논리 폴더와 세션 배치는 새로고침/재시작 시 사라집니다.
3. 수동 입력 이메일과 실제 CLI 로그인 계정의 일치 여부를 검증하지 않습니다.
4. Gemini 다중 config root 환경 변수 규약은 아직 확정하지 않았습니다.
5. OpenCode 계정 자동 감지가 없습니다.
6. CLI 로컬 히스토리 포맷 변경에 대한 fixture 기반 회귀 테스트가 없습니다.
7. 대화 전문의 tool call, reasoning, attachment 등 비메시지 이벤트는 현재 생략합니다.
8. 이미지 임시 파일 cleanup이 없습니다.
9. 설치 파일 생성과 clean machine QA를 하지 않았습니다.
10. Codex 커서 필터는 현재 버전에서 검증했으며 다음 TUI 변경 때 재검토가 필요합니다.
11. 제목을 앱 메타데이터로 영속화하지 않습니다. Claude만 새 세션에서 `--name`을 지원하고 다른 CLI는 첫 실제 프롬프트를 제목으로 사용합니다.

## 10. 다음 작업 우선순위

### P0: 현재 프로토타입 안정화

- [ ] Codex 긴 응답에서 애니메이션 유지 + 네모 점멸 제거 사용자 확인
- [ ] Claude/Codex/Gemini 새 세션과 resume 수동 회귀 테스트
- [ ] 이미지 붙여넣기를 각 CLI의 이미지 인자/경로 처리와 함께 검증
- [ ] PTY 시작/종료 20회 반복 안정성 테스트
- [ ] 계정 저장 후 앱 재시작 회귀 테스트

### P1: 세션 제품화

- [ ] 여러 PTY를 동시에 유지하는 세션 탭 모델
- [ ] 세션별 dormant/running/stopped 상태
- [ ] SQLite 기반 논리 폴더, 세션 배치, 사용자 제목 영속화
- [ ] 폴더 드래그앤드롭 및 정렬
- [ ] 종료 전 실행 세션 복구 메타데이터 저장

### P2: 계정 관리 강화

- [ ] 수동 계정 로그인 후 실제 이메일 재검증
- [ ] 설정 디렉터리 선택 버튼과 중복 경로 방지
- [ ] 로그아웃/재인증/상태 진단
- [ ] Gemini/OpenCode 계정 격리 규약 조사 및 구현
- [ ] 인증 저장 방식이 file/keyring일 때의 상태 표시

### P3: 검색과 기록 품질

- [ ] 에이전트/계정/cwd/date 필터
- [ ] history parser fixture와 버전별 테스트
- [ ] tool call과 첨부파일을 대화 전문에 표시
- [ ] lazy pagination과 전체 세션 수 설정
- [ ] 세션 title rename과 CLI 지원 범위 동기화

### P4: 차별화 기능

- [ ] 여러 계정/에이전트 동시 실행
- [ ] Git worktree 생성 및 세션 연결
- [ ] 동일 프롬프트 브로드캐스트와 결과 비교
- [ ] 선택 출력 또는 컨텍스트를 다른 세션으로 전달
- [ ] 키보드 단축키와 세션 전환

## 11. 설계 원칙

- 실제 CLI TUI가 기본 화면이며 커스텀 채팅 UI는 기록 열람용입니다.
- 자격증명은 공식 CLI에 맡기고 앱이 비밀 값을 소유하지 않습니다.
- 계정 정보가 불명확하면 해당 저장소의 히스토리를 일부만 노출하지 않습니다.
- 폴더는 논리 분류이고 cwd는 실행 위치입니다.
- 에이전트별 차이는 JSON 프로필과 작은 어댑터로 격리합니다.
- 쓰기 충돌은 계정 격리가 아니라 worktree로 해결합니다.
- Windows 네이티브 프로세스와 PTY 종료 경로를 UI 기능만큼 중요하게 다룹니다.

## 12. 2026-08-14 다중 CLI 세션 유지

### 완료

- 단일 `runKey`/단일 `TerminalPane` 구조를 `RuntimeSession[]` 구조로 변경했습니다.
- 세션별 xterm과 PTY를 마운트 상태로 유지하여 왼쪽 실행 목록 전환 시 프로세스를 다시 시작하지 않습니다.
- 같은 Recent conversations 항목을 다시 누르면 이미 열린 런타임 세션을 재사용합니다.
- 동시에 유지하는 세션은 렌더러와 메인 PTY 관리자 모두 최대 10개로 제한했습니다.
- 11번째 세션을 열면 현재 화면을 제외한 least-recently-viewed 세션을 종료합니다.
- 현재 보고 있지 않고 30분 동안 다시 선택하지 않은 세션은 1분 주기로 자동 종료합니다.
- 왼쪽 실행 목록과 세션 헤더에 수동 닫기 버튼을 추가했습니다.
- 상태 표시줄과 헤더에서 현재 열린 세션 수를 `n/10`으로 확인할 수 있습니다.

### 수명 주기

세션 배열에서 항목이 제거되면 해당 `TerminalPane`이 언마운트됩니다. cleanup은 xterm listener와 ResizeObserver를 해제하고 `pty:stop`을 보내므로 CLI 자식 프로세스도 함께 종료됩니다. Electron 종료 시에는 기존처럼 메인 프로세스의 `stopAll()`이 남은 PTY를 모두 종료합니다.

### 메모리 주의사항

xterm 인스턴스보다 Claude/Codex/Gemini CLI 프로세스 자체가 더 많은 메모리를 사용할 수 있습니다. 따라서 10개는 지원 상한이지 항상 10개 실행을 권장한다는 의미는 아닙니다. 현재 정책은 요청대로 마지막 조회 시간을 기준으로 정리하므로, 보이지 않는 세션에서 장시간 작업 중이어도 30분이 지나면 종료됩니다.

### 검증

- `npm.cmd run typecheck`: 통과
- `npm.cmd run build`: 통과
- Electron 개발 서버 `http://localhost:5187`: 정상 실행
- 개발 stderr: 비어 있음

## 13. 2026-08-14 메모리 최적화

### 측정 기준

Windows `PrivateMemorySize64` 합계를 사용했습니다. Working Set은 Electron 프로세스 사이의 공유 페이지를 중복 계산하므로 앱 전용 메모리 비교에는 사용하지 않았습니다.

- Vite 개발 모드: 약 387MB
- 빌드 실행 모드: 약 256MB
- npm Electron 래퍼를 제외한 Electron 본체: 약 234MB
- GPU 비활성화 빌드 실행: 초기 약 182MB, 안정화 후 약 132MB

### 적용 내용

- `npm start` 빌드 실행 모드를 추가해 Vite 개발 서버 없이 실행할 수 있게 했습니다.
- Windows 직접 실행용 `start:lean`과 GPU 비활성화 `start:low-memory`를 추가했습니다.
- 활성 xterm scrollback 상한을 10,000줄에서 5,000줄로 줄였습니다.
- 숨긴 xterm은 scrollback 1,500줄과 cursor blink 비활성화를 적용합니다.
- 대화 전문은 Recent conversations 클릭 시 즉시 읽지 않고 Conversation 탭을 처음 열 때 lazy load합니다.
- PTY 출력은 8ms 단위, 세션별 최대 64KB 단위로 IPC를 batch하여 이벤트와 임시 문자열 할당을 줄입니다.
- Chromium spellcheck를 비활성화했습니다.

### 판단

GPU 비활성화는 안정화 기준 약 102MB(44%)를 추가 절감했지만 software rendering으로 전환됩니다. 5초 유휴 CPU 측정에서는 증가가 없었으나 터미널 출력량이 많을 때 CPU와 입력 지연에 불리할 수 있으므로 기본값으로 강제하지 않고 별도 low-memory 모드로 제공합니다. 10개 CLI 자체의 메모리는 각 CLI 런타임 소유이므로 Electron에서 직접 줄일 수 없습니다.

## 14. 2026-08-14 디자인 핸드오프 적용

### 적용 범위

- `design/design_handoff_mica_shell`의 최종 HTML, README, amber/periwinkle 4개 기준 화면을 구현 기준으로 사용했습니다.
- 38px 프레임리스 타이틀바와 최소화, 최대화/복원, 닫기 IPC를 추가했습니다.
- 사이드바를 Folders, Recent, Agents 구조로 재구성하고 검색, 섹션 접기, 독립 스크롤을 적용했습니다.
- 새 세션 런처와 활성 세션 화면을 분리하되, 런처를 열어도 기존 `TerminalPane`은 dormant 상태로 마운트를 유지합니다.
- 활성 화면에 공통 세션 제목, 계정, cwd, CLI/대화 전문 탭, 터미널 dim 조절을 배치했습니다.
- amber/periwinkle 테마와 접기 상태, 터미널 dim 값을 localStorage에 저장합니다.
- `Inter Variable`과 `JetBrains Mono Variable`을 Google Fonts 공식 저장소에서 내려받고 각 OFL 라이선스를 함께 포함했습니다.

### 반투명 블러 이슈와 해결

**증상**

`transparent: true`와 `backgroundMaterial: 'mica'` 또는 `'acrylic'`을 함께 사용하면 이 환경에서 시스템 재질이 창 뒤를 합성하지 못하고 균일한 회색 면처럼 보였습니다. CSS `backdrop-filter`는 Electron 창 바깥의 다른 Windows 창을 직접 블러할 수 없어 같은 결과를 대체하지 못했습니다.

**진단**

- 직접 알파 합성(`backgroundMaterial: 'none'`)은 뒤의 테스트 색상이 선명하게 통과해 투명성은 확인됐지만 블러가 없어 시안과 달랐습니다.
- Electron 투명 창을 끄고 DWM `acrylic`만 사용하자 고대비 색상 경계가 넓게 퍼져 시스템 블러가 실제로 적용됐습니다.
- 58% 틴트는 원색이 지나치게 남아 시안보다 산만했습니다.

**실험 구성 - 폐기**

- `transparent: false`
- `backgroundColor: '#00000000'`
- Windows `backgroundMaterial: 'acrylic'`
- 앱 셸 `rgba(12, 14, 17, 0.78)` 중성 틴트
- `prefers-reduced-transparency: reduce`에서는 불투명 `#141619` 대체 배경

이 조합은 정지 상태에서는 시안과 비슷했지만 창 상태 전환에서 안정적이지 않아 최종 구성에서 폐기했습니다.

### 추가 수정

- Recent 항목이 많은 계정에서 Folders와 Agents가 화면 밖으로 밀리던 문제를 영역별 독립 스크롤로 해결했습니다.
- xterm 배경을 투명하게 바꾸고 활성 scrollback 5,000줄, 숨김 scrollback 1,500줄 정책을 유지했습니다.
- `Ctrl+V` 텍스트/이미지 경로 삽입, 한글 IME overlay, Codex cursor blink 필터를 새 UI에서도 유지했습니다.

### 검증

- `npm.cmd run typecheck`: 통과
- `npm.cmd run build`: 통과
- 프레임리스 창 시작 및 `start:lean` 재실행: 통과
- 1320x840 launcher/active session 레이아웃 캡처: 겹침 없음
- 98개 Recent conversations에서 sidebar 독립 스크롤: 정상
- 고대비 3색 배경과 40px 흰색 경계로 DWM Acrylic 블러 및 중성 틴트 합성 확인

### 최대화 후 Acrylic이 검정으로 바뀌는 문제

**증상**

창을 최대화했다가 복원하면 정상적인 Acrylic 대신 완전한 검정 배경이 남는 경우가 있었습니다.

**원인**

프레임리스 창의 크기와 DWM 비클라이언트 영역이 동시에 다시 구성되는 동안 시스템 backdrop이 분리될 수 있습니다. 기존 설정은 `transparent: false`인데 `backgroundColor: '#00000000'`도 명시해 두었으므로, backdrop이 유실되는 순간 투명 WebContents의 합성 대체면인 검정이 그대로 노출됐습니다. Electron의 `setBackgroundMaterial('acrylic')` 자체가 WebContents 배경을 투명하게 설정하므로 별도 투명 배경색 지정은 중복이었습니다.

**초기 우회 처리 - 폐기**

- BrowserWindow의 명시적 `backgroundColor: '#00000000'`를 제거했습니다.
- Windows 창 `resize`와 `restore` 이벤트를 140ms 디바운스합니다.
- 크기 변경 애니메이션이 끝난 뒤 `none`에서 `acrylic`로 재질을 다시 등록해 DWM composition surface를 재생성합니다.
- 재등록 후 `webContents.invalidate()`로 Chromium surface도 다시 그립니다.
- 창이 닫히거나 새 refresh 요청이 들어오면 이전 예약 작업은 generation 값으로 무효화합니다.

위 우회 처리는 재질을 `none`으로 내리는 한 프레임 동안 기존 다크 배경이 반짝이고, 최대화 상태에서는 Acrylic이 돌아오지 않는 경우가 있어 제거했습니다.

**최종 해결**

- `backgroundMaterial: 'none'`
- BrowserWindow `backgroundColor: '#121418'`
- 앱 셸 `background: #121418`
- 모든 backdrop refresh 타이머와 `none → acrylic` 재등록 로직 제거

프레임리스 창, 네이티브 최대화, 여러 PTY 장시간 유지의 안정성을 시각 효과보다 우선했습니다. 반투명은 Electron 33과 현재 Windows DWM 조합에서 재현성 있게 유지할 수 없다고 판단해 기본 기능에서 제외했습니다.

**검증**

- `npm.cmd run typecheck`: 통과
- `npm.cmd run build`: 통과
- Win32 `SW_MAXIMIZE`/`SW_RESTORE` 3회 반복 후 동일 창 핸들 유지
- 반복 후 BrowserWindow `Responding=True`, 복원 크기 1320x840 유지
- 밝은 외부 테스트 창을 포함한 자동 캡처는 Windows 화면 캡처 권한 오류로 완료하지 못했으므로 실제 DWM 시각 결과는 실행 창에서 추가 확인 필요

### 사이드바 정렬, 너비 조절, 스크롤 디자인

- 사이드바 오른쪽 경계 6px 영역을 포인터 드래그 separator로 변경했습니다.
- 너비는 200px에서 420px 사이로 조절되며 `cli-agent-manager.sidebar-width`에 저장됩니다.
- 경계를 더블클릭하면 기본 272px로 복원됩니다.
- 키보드 접근을 위해 separator 포커스 상태에서 좌우 방향키는 12px씩 조절하고 Home은 기본값으로 복원합니다.
- 별도 확장/축소 아이콘 버튼은 추가하지 않았습니다.
- 접힌 `AGENTS` 영역의 8px 하단 여백을 제거하고 30px 헤더 상단선을 오른쪽 30px 상태바 상단선과 맞췄습니다.
- Folders, Recent, launcher, 대화 전문 스크롤을 10px 영역과 4px 실폭 thumb로 통일했습니다.
- 스크롤 트랙 배경과 고정 gutter를 제거하고 thumb를 사이드바 오른쪽 끝에 붙였습니다.
- thumb 양 끝은 완전한 pill 형태로 둥글게 처리했습니다.
- Chromium의 기본 모양을 우선시키던 `scrollbar-width`와 `scrollbar-color`를 제거하고 WebKit thumb 스타일을 직접 적용했습니다.
- hover 시 thumb가 6px로 넓어지고 현재 accent가 섞이도록 했습니다.
- 리사이즈 hit area는 사이드바 경계 바깥으로 옮겨 스크롤바와 겹치지 않으며 평소에는 보이지 않습니다.
- 평상시 thumb 대비를 높이고 hover 시 현재 accent 색상이 은은하게 섞이도록 변경했습니다.
- 1320x840 실행 화면에서 AGENTS/상태바 경계 정렬과 Recent scrollbar 렌더링을 확인했습니다.

### 안정적인 불투명 창과 Start 행 정렬

- DWM Acrylic과 모든 backdrop 재등록 우회 처리를 제거했습니다.
- BrowserWindow와 앱 셸을 동일한 `#121418` 불투명 배경으로 통일했습니다.
- 프레임리스 타이틀바와 사용자 창 제어는 그대로 유지합니다.
- Start 버튼을 런처 전체 너비로 확장해 위 입력 카드와 좌우 끝선을 맞췄습니다.
- `Ctrl↵` 단축키 표시는 버튼 아래 중앙으로 이동했습니다.
- 활성 세션 헤더의 투명도 슬라이더와 관련 localStorage 상태를 제거했습니다.
- 터미널과 대화 전문 배경 dim은 기존 슬라이더 최대값인 `.5`로 고정했습니다.
- `SW_MAXIMIZE`/`SW_RESTORE` 3회 반복 후 동일 창 핸들, `Responding=True`, 1320x840 복원 크기를 확인했습니다.
### Agent color picker and monogram alignment (2026-08-14)

- Replaced the always-exposed native color input with an anchored in-app color popover.
- Added 20 curated swatches, selected-color feedback, direct HEX editing, a `More colors` native fallback, and an icon-only reset action.
- The popover stays within the window bounds and closes on outside click, `Escape`, resize, or settings close.
- Wrapped default agent monograms in a fixed full-size flex box so `C`, `X`, `G`, `O`, and `PS` share the same horizontal and vertical center.
- Measured the latest desktop capture pixel bounds and moved only the account-row monogram ink down by `1.5px`; other 20px, 22px, and 24px monograms retain their original centering.
- Verified with `npm.cmd run typecheck` and `npm.cmd run build`; restarted the Electron app with `npm.cmd run start:lean`.
### Image clipboard paste fix (2026-08-14)

**Issue**

- `Ctrl+V` worked for clipboard text and raw bitmap images, but copying PNG files from Windows Explorer produced no terminal input.
- Explorer exposes copied files as a Windows `FileDropList`; Electron's `clipboard.readImage()` returned an empty image and `clipboard.readText()` returned no text.

**Resolution**

- Added a Windows clipboard file-list fallback after the existing raw bitmap path.
- Clipboard priority is raw bitmap, text, then Windows file list, so normal text paste does not launch a helper process or gain extra latency.
- Only existing PNG, JPEG, WebP, GIF, and BMP files are accepted from the file list.
- One or multiple copied image paths are quoted individually and inserted into the active CLI prompt without submitting it.
- Raw screenshots and browser-copied bitmap images still use a generated PNG in the app temp directory.
- Verified the fallback against four PNG files copied from the project design directory and passed `npm.cmd run typecheck`.
### Terminal resize bottom anchoring (2026-08-14)

**Issue**

- Expanding the MoaCLI window while viewing an active CLI could leave the xterm viewport beyond the last conversation line and expose extra blank space.
- The resize observer recalculated rows and resized ConPTY but did not preserve whether the viewport was at the bottom before reflow.

**Resolution**

- Capture `viewportY` and `baseY` before `fitAddon.fit()`.
- When the user was already at the bottom, re-anchor after xterm fit, on the next animation frame, and after the short ConPTY redraw window.
- Apply the same anchor after asynchronous PTY output is parsed during that redraw window.
- Do not force-scroll when the user has intentionally scrolled upward to inspect older output.
### MoaCLI application icon (2026-08-14)

- Used the supplied MoaCLI brand board as the visual reference for the production application icon.
- Reconstructed the colored M ribbon, center node, rising particles, dark navy tile, and subtle blue edge without the surrounding brand-board text.
- Removed the chroma-key exterior and retained transparent rounded corners.
- Added a 1024px PNG master, a multi-resolution Windows ICO, and a 128px renderer asset.
- Connected the icon to Electron Builder, the development BrowserWindow, the title bar, and the new-session launcher.
- Unified Windows and in-app icon exports on the transparent symbol-only asset; the navy tile is no longer shown in the title bar or launcher.
- Enlarged the Windows symbol from roughly 56% to 84% of the canvas width so it remains prominent in the 16px and 32px taskbar slots.
### CLI version refresh (2026-08-19)

**Detection rule**

- Each agent profile declares a binary name and version command. Codex uses `bin: codex` and `--version`.
- On Windows, MoaCLI checks `%APPDATA%\npm` before the inherited PATH, then checks bundled Codex fallback locations.
- The selected `%APPDATA%\npm\codex.cmd` currently reports `codex-cli 0.148.0`; sandbox and plugin fallbacks remain on older builds but are not selected.

**Refresh behavior**

- Previously agent versions were read only during renderer startup.
- Profiles now refresh when the MoaCLI window regains focus, when it becomes visible, and every 60 seconds while visible.
- Added an explicit refresh action to the AGENTS section for immediate verification after updating a CLI inside MoaCLI.
- Concurrent refresh calls are coalesced so multiple focus/visibility events do not spawn duplicate version checks.
### Title bar cleanup (2026-08-19)

- Removed the static `PROTOTYPE` badge from the MoaCLI title bar.
- The badge was an early design-stage label and was unrelated to the selected logical folder or workspace directory.

### Account identity and settings save behavior (2026-08-19)

**Identity rule**

- Accounts are identified by the combination of agent type and normalized configuration directory, not by email address.
- Claude and Codex may therefore display the same email without colliding: their default roots are `.claude` and `.codex`, and their agent types also differ.
- Configuration paths are compared case-insensitively and without trailing slashes.
- Saving two accounts for the same agent with the same configuration directory is rejected with an inline error.

**Editing and authentication**

- Manually added accounts remain editable and removable in MoaCLI.
- Auto-detected accounts remain read-only because their email and authentication state come from the official CLI configuration.
- The email field is display metadata; changing it does not switch the credentials stored in the configuration directory.
- A configuration directory holds one active credential state for a given CLI. Signing into another identity in that same directory replaces that state rather than creating a second isolated account.

**Modal behavior**

- Saving account settings no longer closes the settings modal.
- Trimmed values are reflected back into the open form and an inline success message confirms persistence.
- Editing, adding, or removing an account clears the previous save message.
- The footer action is now labeled `Close` to match the persistent-modal save flow.

### Login account refresh (2026-08-19)

**Issue**

- A browser-based CLI login could finish successfully while the isolated login terminal remained open.
- Unlike a normal command prompt, the login PTY has no parent shell prompt to return to, so the stopped terminal did not provide an obvious next action.
- Account labels were not re-read from the selected configuration directory after authentication.

**Resolution**

- Added an account refresh action immediately to the left of the login session close button.
- The action inspects the exact account configuration directory used for the login, including custom Claude and Codex account roots.
- On success, the verified email updates the stored account, current login header, draft settings, and conversation history source.
- The refresh icon spins while checking and changes to a check icon after successful verification.
- The login terminal remains open until the user closes it; completing authentication does not force a conversation to start or reopen settings.
- Added an IPC boundary for account inspection that returns only the verified email and existing account metadata, not credentials or token contents.
