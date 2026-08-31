# Agent Delegation (MoaCLI MCP) — 지원 범위 검증 및 진행 계획

> 조사일: 2026-08-26. 공식 문서(code.claude.com/docs, developers.openai.com/codex, modelcontextprotocol.io) 및 GitHub 이슈/PR을 웹으로 직접 확인한 결과.
>
> 목표: MoaCLI가 MCP 서버를 제공하여 한 CLI 에이전트(예: Codex)가 다른 에이전트(예: Claude)에게 작업을 위임하고 결과를 받는 기능. 계정 선택·승인은 MoaCLI 모달로, 위임 작업 진행 상황은 앱 내 패널로 표시.

---

## 1. 결론 요약

**기술적으로 막히는 부분 없음.** 모든 핵심 경로가 공식 지원으로 확인됨.

| 역할 | Claude Code | Codex CLI | Gemini CLI |
|---|---|---|---|
| Caller (MCP 툴 호출) | ✅ stdio/HTTP 모두 | ✅ stdio/HTTP 모두 | ✅ |
| Worker (headless 실행) | ✅✅ 가장 풍부 | ✅ (승인은 사전 정책만) | △ (승인 사전 정책만) |
| 실행 중 승인 외부 라우팅 | ✅ `--permission-prompt-tool` | ❌ exec에선 불가 → sandbox로 대체 | ❌ |
| 세션 resume (headless) | ✅ `--resume <id>` | ✅ `codex exec resume` | 미확인 |

핵심 아키텍처 결정 (조사 결과가 강제하는 것):

1. **MCP 서버는 localhost streamable-HTTP 단일 서버** (stdio 불가 — 클라이언트마다 별도 프로세스가 떠서 태스크 상태 공유가 안 됨)
2. **긴 작업은 start/poll 패턴 필수** (Codex의 MCP 툴 타임아웃 기본 60초)
3. **Worker는 headless 모드로 spawn** (Claude: `claude -p`, Codex: `codex exec`) — 인터랙티브 PTY 조종 방식은 채택하지 않음

---

## 2. 검증된 지원 범위 상세

### 2.1 Claude Code — Worker로서 (가장 강력)

- `claude -p "prompt"` headless 모드 확인. `--output-format stream-json`으로 이벤트 단위(NDJSON) 출력 — init(모델/툴/MCP 서버 상태), assistant/user 메시지, 최종 result(응답 텍스트 + 비용 + session_id). `--verbose` 필요.
- `--input-format stream-json`: stdin으로 멀티턴 대화 주입 가능 (인터럽트, 이미지 첨부 포함).
- **`--permission-prompt-tool mcp__<server>__<tool>`**: 비대화형 모드에서 권한이 필요하면 지정한 MCP 툴을 호출 → 응답(`{"behavior":"allow"|"deny", ...}` = PermissionResult 형식)으로 허용/거부. **MoaCLI 모달로 권한 질문을 받는 공식 경로.**
- `--allowedTools` / `--disallowedTools` / `--permission-mode`(신규 `dontAsk` 모드 = 물어보는 대신 거부, CI 권장) / `--max-turns` / `--max-budget-usd`(비용 상한!) / `--json-schema`(구조화 출력).
- resume: `claude -p --resume <session-id>` (v2.1.223+부터 디렉토리 무관), `--session-id`로 id 고정 가능.
- MCP 등록: `--mcp-config <file|json>` + `--strict-mcp-config`로 위임 실행에 필요한 서버만 명시적 주입 가능.
- 타임아웃: `MCP_TOOL_TIMEOUT` 기본값이 사실상 무제한(~28h). 단 2분 넘는 MCP 호출은 자동 백그라운드화(v2.1.212+, `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`), idle 타임아웃 별도(`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, stdio 기본 30분).
- ⚠️ 주의: `--bare` 플래그(훅/스킬/MCP/CLAUDE.md 로드 생략)가 "향후 `-p`의 기본값이 될 예정" — **위임 실행 커맨드에 필요한 설정을 항상 명시적으로 전달**하는 방식으로 작성해야 미래에 안 깨짐.
- Claude Agent SDK(`@anthropic-ai/claude-agent-sdk`)는 `canUseTool` 콜백, 스트리밍 입력, 훅 전부 제공 — 최종 진화형 옵션. 단 서드파티 제품 임베딩 시 claude.ai 로그인 불가·API 키 전용 조건이 있어 **MoaCLI에는 CLI spawn 방식이 맞음** (유저 자신의 구독 계정 사용).

### 2.2 Codex CLI — Caller ✅ / Worker △

- **Caller**: `~/.codex/config.toml`의 `[mcp_servers.<name>]` 또는 `codex mcp add`. stdio + streamable HTTP 모두 지원(HTTP는 `url` + `bearer_token_env_var`). exec 모드에서도 MCP 서버 활성.
  - ⚠️ **툴 타임아웃 기본 60초** (`tool_timeout_sec`로 조정 가능) → 우리 MCP 툴은 반드시 즉시 반환(start/poll)이어야 함.
  - elicitation: 2026-04 PR #17043 머지로 최신 빌드는 지원. 구버전은 자동 거부 → 의존하지 말 것.
  - ⚠️ **실측 (v0.149.1, 2026-08-26)**: `codex exec`는 **모든 MCP 툴 호출에 승인을 요구**하며 기본 정책 `never`에서는 전부 거부됨. `readOnlyHint` annotation, `default_tools_approval_mode`, `tools.<name>.approval_mode`, `trusted=true`, config.toml 정식 등록 — 전부 무효. **유일한 해법은 `--approve-for-me`** (승인 요청을 내장 자동 리뷰로 라우팅; workspace-write sandbox 사용) 또는 인터랙티브 모드(TUI 승인 프롬프트). → 우리 문서/등록 가이드에 `codex exec` 사용 시 `--approve-for-me`를 명시해야 함. 인터랙티브 Codex에서는 TUI 승인으로 정상 동작 예상.
  - ⚠️ 실측: npm 래퍼 `codex.cmd`는 비대화형 spawn에서 간헐적으로 행 걸림 → 자동화에서는 vendor `codex.exe`를 직접 호출할 것 (우리 `detectBinary`가 이미 exe 경로 폴백을 가짐).
- **Worker**: `codex exec` + `--json`(JSONL 이벤트) + `-o/--output-last-message`(최종 응답 파일) + `--output-schema`(구조화 출력) + `-C`(작업 디렉토리).
  - 승인 정책은 **실행 전 확정만 가능**: `--sandbox read-only|workspace-write|danger-full-access`, `-a untrusted|on-request|never` (exec에서 on-request는 사실상 never로 동작). `--full-auto`는 deprecated → `--sandbox workspace-write` 사용.
  - **실행 중 승인을 외부로 라우팅하는 방법 없음** (Claude의 `--permission-prompt-tool` 상당 기능 부재).
  - 대안 경로: `codex mcp-server`(Codex를 MCP 서버로 실행)는 `applyPatchApproval`/`execCommandApproval`을 JSON-RPC로 클라이언트에 물어봄 + `codex-reply`로 멀티턴 가능. 단 **experimental** — Phase 2 이후 검토.
  - resume: `codex exec resume <session-id>` / `--last` 확인됨. 멀티턴은 "프로세스 재실행 per turn" 방식.

### 2.3 MCP 프로토콜 / 아키텍처 제약

- **타임아웃은 클라이언트가 정함** (스펙상 sender-defined). progress notification이 타임아웃을 연장할 수 *있으나* 클라이언트 재량.
- **progress notification 현황**: Claude Code는 표시 기능이 현재 버그로 깨져 있고(#51713), Codex는 아예 표시 안 함. 단 Claude Code의 idle 타임아웃 리셋에는 여전히 유효 → 보내되 UI 의존은 금지.
- **elicitation**: Claude Code ✅(v2.1.76+, Form/URL 모드), Codex 최신 빌드 ✅/구버전 ❌, Claude Desktop ❌. → 우리 서버는 elicitation에 의존하지 않고 **MoaCLI 자체 UI로 질문 처리** (우리가 서버이자 앱이므로 필요 없음).
- **sampling**: Claude Code·Codex 모두 미지원 → 사용 금지.
- **공식 Tasks 확장** (`io.modelcontextprotocol/tasks`, 2026-07-28 스펙에서 Stable): start/poll 패턴의 표준화. 단 Claude Code/Codex는 아직 2025-06-18 스펙 → **수동 start/poll 툴 쌍으로 구현**하고, 클라이언트가 ext-tasks를 지원하면 나중에 갈아탐.
- **stdio vs HTTP**: stdio MCP 서버는 클라이언트가 서브프로세스로 각자 spawn → 인스턴스 간 상태 공유 불가. **Electron(main) + Claude 세션 + Codex 세션이 하나의 태스크 레지스트리를 봐야 하므로 localhost streamable-HTTP 서버가 유일한 정답.**
  - 보안 요건(스펙 명시): `127.0.0.1` 바인딩, `Origin` 헤더 검증(DNS rebinding 방지), 토큰 인증(런타임 생성 bearer token).
  - 클라이언트 등록: Claude `claude mcp add --transport http moacli http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"` / Codex `config.toml`에 `url` + `bearer_token_env_var`.
- Node SDK: `@modelcontextprotocol/sdk` (v1.30.0, `StreamableHTTPServerTransport` 포함).

---

## 3. 아키텍처 설계

```
┌─ MoaCLI (Electron main) ─────────────────────────────────┐
│  MCP Server (streamable-HTTP, 127.0.0.1:<random port>)   │
│  ├─ tool: list_agents        사용 가능한 에이전트/계정    │
│  ├─ tool: delegate_task      짧은 작업, 동기 반환         │
│  ├─ tool: start_task         → task_id 즉시 반환          │
│  ├─ tool: check_task         상태 + 진행 로그 tail        │
│  ├─ tool: get_task_result    완료된 결과 (크면 파일 경로) │
│  ├─ tool: cancel_task                                     │
│  └─ tool: moacli_permission  (Claude worker의             │
│            --permission-prompt-tool 대상 → 승인 모달)     │
│                                                          │
│  Task Runner                                             │
│  ├─ Claude worker: claude -p --output-format stream-json │
│  │    --permission-prompt-tool mcp__moacli__moacli_permission
│  │    --mcp-config <moacli만> --max-budget-usd <상한>     │
│  └─ Codex worker: codex exec --json --sandbox <정책> -C   │
│                                                          │
│  UI (renderer, IPC)                                      │
│  ├─ 위임 요청 승인 + 계정 선택 모달                       │
│  ├─ 위임 패널: stream-json/JSONL 이벤트 렌더 (읽기 전용) │
│  └─ 알림 센터 연동 (완료/실패/승인 대기)                  │
└──────────────────────────────────────────────────────────┘
```

- **승인 흐름**: caller가 `start_task` 호출 → MoaCLI가 모달(에이전트·계정·cwd·sandbox 정책 표시) → 유저 승인 시 spawn. Claude worker의 실행 중 권한 요청은 `moacli_permission` 툴 → 모달. Codex worker는 사전 sandbox 정책으로 갈음.
- **가시성**: 위임 작업은 특수 세션 카드/탭으로 표시. stream-json을 파싱해 Conversation 뷰 스타일로 렌더 (어떤 툴을 썼는지 구조화되어 raw 터미널보다 읽기 좋음).
- **격리**: 위임 작업의 cwd는 caller와 분리 권장(같은 repo면 경고 또는 read-only 기본값).

## 4. 진행 계획

- **Phase 0 — PoC (사이즈: 소)**: HTTP MCP 서버 + `delegate_task` 1개. Claude Code에서 등록 후 `codex exec`/`claude -p` 왕복 확인. UI 없음, 콘솔 로그만.
  - ✅ **완료 (2026-08-26, `feature/agent-delegation-poc` 브랜치)**. 구현: `electron/delegation-server.ts`(HTTP/MCP 경계, `@modelcontextprotocol/sdk` 1.30 stateless streamable-HTTP, 포트 38017+스캔, bearer 토큰 + Origin/Host 검증, 설정은 userData의 `delegation-server.json`에 영속) + `electron/delegation-workers.ts`(headless worker spawn: `claude -p --output-format json --max-turns 30` stdin 프롬프트 / `codex exec --skip-git-repo-check --output-last-message <tmp> -`, 타임아웃 시 taskkill 트리 종료). 툴: `list_agents`, `delegate_task(agent, prompt, cwd?, timeout_seconds?)`.
  - 검증 결과: 무토큰 요청 401 차단 ✓, initialize/tools/list ✓, `delegate_task`→codex ✓, →claude ✓, **실전 체인(Claude Code caller가 HTTP MCP로 접속 → delegate_task → codex exec worker) 왕복 ✓** (질문 17*23 → "CODEX SAID: 391").
  - **역방향 체인도 검증 ✓**: Codex caller(`codex exec --approve-for-me`, config.toml에 moacli 등록) → MoaCLI MCP → Claude worker (질문 13*29 → "CLAUDE SAID: 377"). `--approve-for-me` 없이는 codex exec의 MCP 승인 게이트에 걸림(위 2.2 실측 참고).
  - 등록 커맨드는 앱 시작 시 콘솔에 출력됨 (`[delegation]` 프리픽스).
- **Phase 1 — MVP**: start/poll 툴 셋 + 태스크 레지스트리(기존 better-sqlite3에 저장) + 승인·계정선택 모달 + 알림 연동. Codex `tool_timeout_sec` 안내 문구 포함한 설정 가이드(등록 커맨드 자동 생성/복사 UI). → UI 배치는 §6 참고.
  - ✅ **완료 (2026-08-28)**. 구현:
    - `electron/delegation-tasks.ts`(신규) — 태스크 레지스트리. 상태 `awaiting_approval → running → completed | failed | rejected | cancelled`, userData의 `delegation.sqlite`에 영속(재시작 시 미완료 건은 failed 처리, 최근 50건 로드), 승인 대기 15분 타임아웃, 동시 실행 3개/열린 작업 10개 상한, 진행 로그(64KB 링), 큰 결과는 `delegation-results/<id>.txt`로.
    - `electron/delegation-workers.ts`(재작성) — `startWorker()`가 `{done, cancel}` 핸들 반환. Claude: `-p --output-format stream-json --verbose --strict-mcp-config --mcp-config {"mcpServers":{}}`(worker 내 MCP 비활성 → 재귀 위임 차단), Codex: `exec --json --output-last-message`. stream-json/JSONL 이벤트를 사람이 읽을 진행 로그로 변환. 계정 선택 시 `CLAUDE_CONFIG_DIR`/`CODEX_HOME` 주입.
    - `electron/delegation-server.ts` — 툴 6종: `list_agents`, `delegate_task`(동기, 승인 대기 포함), `start_task`, `check_task`(상태+진행 로그 tail), `get_task_result`, `cancel_task`. caller 라벨은 HTTP `user-agent`. 설정 파일에 `enabled` 추가(on/off 토글), 토큰 재발급.
    - 알림: `NotificationCenter.handleDelegation()` — 승인 대기(needs_attention)/완료/실패, 데스크톱 알림 클릭 시 `{kind:'delegation', taskId}` 활성화.
    - UI: 설정 → **Delegation** 섹션(`src/features/delegation/DelegationSettingsSection.tsx`: 상태/엔드포인트/토큰, Claude 등록 커맨드·Codex config.toml 스니펫 복사, `--approve-for-me`/`tool_timeout_sec` 안내, 토큰 재발급 2단계 확인, 최근 작업 목록+Review/Cancel), 전역 승인 모달(`DelegationApprovalModal.tsx`: caller/worker/프롬프트/cwd/제한시간/권한 정책/계정 SelectBox, Allow·Decline, Esc=나중에).
    - **worker 트랜스크립트는 Recent에서 숨김**: worker가 알려주는 세션 ID(Claude stream-json `system/init`·`result`의 `session_id`, Codex `thread.started`의 `thread_id`)를 `delegation_tasks.worker_session_id`에 저장하고, `SessionHistoryService.setSessionFilter()`로 해당 `resumeId`를 목록·검색 인덱스에서 제외. 이 변경 전에 돌린 worker 세션은 ID가 없어 소급 적용 안 됨(Claude 건만 `detail`에서 백필). Phase 2에서 작업 행에 "트랜스크립트 보기/이어가기" 진입점 예정.
  - 검증(하네스, 실제 worker): 401 차단 ✓, tools/list 6종 ✓, start_task→거절 흐름 ✓, start_task→승인→Codex 완료(12s, `--json` 진행 로그 수신) ✓, delegate_task 동기→Claude 완료(4s) ✓, 실행 중 cancel_task ✓(프로세스 트리 실제 종료 확인 3→0), sqlite 재로드 ✓, Claude/Codex 세션 ID 캡처 ✓, 필터로 Codex worker 트랜스크립트 Recent 제외 ✓. **UI(모달/설정 섹션)는 실기 확인 필요.**
- **Phase 2 — 가시성**: 위임 패널(stream-json 렌더), 실행 중 권한 모달(`--permission-prompt-tool`), 위임 히스토리. → UI 배치는 §6 참고.
- **Phase 3 — 고급 (선택)**: `codex mcp-server` 경유 Codex 승인 라우팅(experimental 안정화 후), MCP Tasks 확장 채택, `--input-format stream-json` 멀티턴 위임.

## 5. 리스크 / 예상 블로커와 대응

| 리스크 | 심각도 | 대응 |
|---|---|---|
| Codex MCP 툴 타임아웃 60초 | 높음(설계로 해소) | start/poll 필수 + 설정 가이드에서 `tool_timeout_sec` 상향 안내 |
| Codex worker 실행 중 승인 불가 | 중간 | 사전 sandbox 정책(기본 `workspace-write`) + 위험 작업은 Claude worker 권장. Phase 3에서 mcp-server 경로 |
| 무한 위임 루프 (A→B→A…) | 중간 | task 메타에 위임 깊이 기록, 깊이 1 제한 + 동시 위임 수 상한 |
| 비용 폭주 | 중간 | Claude는 `--max-budget-usd`/`--max-turns` 강제, Codex는 turn 수 모니터링 + cancel |
| cwd 충돌 (양쪽이 같은 파일 수정) | 중간 | 기본 read-only, 쓰기 위임은 명시적 opt-in + 경고 |
| `-p`가 미래에 `--bare` 기본화 | 낮음 | 모든 플래그·`--mcp-config` 명시 전달로 이미 방어됨 |
| progress 표시 클라이언트 버그 | 낮음 | UI 의존 안 함. `check_task` 응답에 진행 로그 포함 |
| 대용량 결과 | 낮음 | 임계 초과 시 파일로 쓰고 경로 반환 (`MAX_MCP_OUTPUT_TOKENS` 기본 25k 고려) |
| `codex mcp-server` experimental | 낮음 | Phase 3까지 비채택 |
| 클라이언트 등록의 번거로움 | 낮음 | 설정 화면에서 원클릭 등록 커맨드 생성 (포트·토큰 자동 삽입) |

## 6. UI 통합 설계 (Phase 1~2에서 구현)

현재 앱 IA(런처 모달, 알림 센터, 세션 탭, Folders/Recent 유지 결정)에 맞춰 세 지점으로 연결한다.

1. **설정 → "Delegation" 섹션** *(진입점, Phase 1 최우선)*
   - Accounts/Appearance와 같은 급의 새 설정 섹션.
   - 서버 상태 표시(포트, 실행 중 여부) + on/off 토글.
   - **등록 커맨드 원클릭 복사**: Claude용 `claude mcp add --transport http moacli <url> --header "Authorization: Bearer <token>"`, Codex용 `[mcp_servers.moacli]` config.toml 스니펫(토큰·포트 자동 삽입). `codex exec` 사용자를 위한 `--approve-for-me` 안내 문구 포함.
   - 토큰 재발급 버튼(재발급 시 기존 클라이언트 등록 무효화 경고).
   - 현재 콘솔 `[delegation]` 로그로만 나오는 정보를 UI로 승격하는 것.
2. **위임 작업 가시화 → 세션 탭 통합** *(Phase 2)*
   - 별도 화면이 아니라 **특수 세션 카드/탭**으로 표시. 위임 작업은 개념적으로 세션(에이전트·cwd·시작/종료·상태)이므로 기존 런타임 모델(상태 점, needs_attention 펄스, 알림 연동, 탭 UX)을 그대로 재사용.
   - 내용물은 터미널 대신 worker의 stream-json/JSONL 이벤트를 Conversation 뷰 스타일로 렌더한 read-only 패널. 어떤 툴을 썼는지 구조화되어 raw 터미널보다 가독성 좋음.
   - 탭에 위임 표시(화살표/체인 아이콘 뱃지), 완료 후 결과 요약 유지.
   - 사이드바에 별도 "Delegations" 섹션을 두는 안은 기각 — Folders/Recent 구조 유지 결정과의 정합성, IA 단순성 때문.
3. **승인·계정선택 → 전역 모달** *(Phase 1)*
   - 런처 모달과 동일 패턴(백드롭 + 중앙 카드, Esc 닫기).
   - 내용: "〈caller〉가 〈worker〉에 작업을 위임하려 합니다" + 프롬프트 미리보기 + 계정 선택(SelectBox) + cwd/sandbox 정책 표시 + 허용·거부 버튼.
   - 알림 센터에 "승인 대기" 항목 연동(다른 탭/최소화 상태에서 놓치지 않도록). Claude worker 실행 중 권한 요청(`--permission-prompt-tool` → `moacli_permission` 툴)도 같은 모달 패턴 재사용.

## 6.9 사용 가이드 요약 (2026-08-31)

- **등록은 세션이 아니라 설정 단위.** 한 번 등록하면 그 스코프의 모든 대화에서 툴이 보인다.
  - Claude Code: 설정 → Delegation의 커맨드(`claude mcp add --scope user --transport http moacli <url> --header ...`). `--scope user`라 모든 프로젝트 전역. 기본(스코프 생략)은 실행한 폴더 한정이니 주의.
  - Codex: `~/.codex/config.toml`의 `[mcp_servers.moacli]` 블록(전역). **추가 명령어 불필요.**
- **Codex를 caller로 쓸 때**: 대화형 `codex`는 MCP 툴 호출 시 TUI가 인라인으로 승인을 물음 — 플래그 불필요. headless `codex exec`만 매 호출 `--approve-for-me` 필요. Codex는 툴 타임아웃 60초 기본이라 긴 작업은 `start_task`→`check_task` 폴링 필수(`tool_timeout_sec = 630`으로 상향해 둠).
- **worker 계정 변경**: 승인 모달의 Account SelectBox에서 작업별 선택(설정 → Accounts에 등록된 계정, 비감지 계정은 `CLAUDE_CONFIG_DIR`/`CODEX_HOME` 주입). 계정 만료/한도 시 worker가 실패로 남고, 재위임 때 다른 계정을 고르면 됨. 기본 CLI 계정 전환 자체는 `claude login`/`codex login` 영역.
- **자동 승인 모드**: 설정 → Delegation의 "Auto-approve requests" 토글(기본 off, `delegation-server.json`의 `autoApprove`로 영속). 켜면 요청이 모달 없이 기본 계정으로 즉시 실행되고, 동시 실행 상한에 걸리면 승인 모달로 폴백. 완료/실패 알림은 그대로 옴.

## 7. 현재 상태 / 재개 시 체크리스트 (2026-08-28 기준)

- 브랜치 `feature/agent-delegation-poc`에 Phase 0 구현 완료, **커밋 전** 상태. 변경: `electron/delegation-server.ts`(신규), `electron/delegation-workers.ts`(신규), `electron/main.ts`(기동/해제 연결), `package.json`/`package-lock.json`(`@modelcontextprotocol/sdk` 1.30.0, `zod` 4.4.3 추가), 본 문서.
- 양방향 실검증 완료: Claude→Codex ✓, Codex(`--approve-for-me`)→Claude ✓. 무토큰 401 차단 ✓.
- 테스트 과정에서 사용자 `~/.codex/config.toml`에 `[mcp_servers.moacli]` 블록을 추가함(원본 백업: `config.toml.moacli-backup`). 이는 최종 사용 형태와 동일하므로 유지 중 — 제거하려면 해당 블록 삭제.
- 서버 접속 정보는 `%APPDATA%\cli-agent-manager\delegation-server.json`(port 38017 + bearer token)에 영속, 앱 재시작에도 등록 유지됨.
- Phase 0은 v0.1.17에, Phase 1은 그 다음 커밋(2026-08-28)에 포함. Phase 1 구현 내역·검증은 §4 참고.
- **다음 작업 (예약, 2026-08-31 사용자 지시)**:
  1. **승인 모달에 계정별 인증 상태 뱃지** — 계정 SelectBox 옆에 로그인됨/만료 표시. `session-history.ts`의 `claudeEmail()`/`codexEmail()` 검사 로직 재사용(만료·로그아웃이면 이메일 조회 실패). 모달 열릴 때 비동기 검사, 만료 계정은 라벨에 경고.
  2-0. (완료 2026-08-31) 자동 승인 토글 — §6.9 참고.
  2. **실패/취소 작업 "다른 계정으로 재시도"** — 설정 Delegation의 Recent tasks 행에 재시도 버튼: 동일 prompt/cwd/timeout으로 새 태스크 생성 → 승인 모달(계정 선택 포함) 재진입. 레지스트리에 원본 task id 참조 저장.
  2-1. **(설계 메모, 2026-08-31) 세션 이어가기 + 계정 교체** — 토큰 소진/계정 이슈로 막힌 대화를 같은 대화 상태로 다른 계정에서 이어가기. 이론상 완전히 가능함을 조사로 확인: 두 CLI 모두 대화를 로컬 JSONL로 저장하고 resume는 그 파일을 읽어 복원할 뿐, 파일이 계정에 묶여 있지 않다(커뮤니티 도구 claude-swap/codex-auth 등이 auth만 교체하는 방식으로 실증).
     - 저장 위치: Claude `{CLAUDE_CONFIG_DIR}/projects/<경로 인코딩>/<session-id>.jsonl`, Codex `{CODEX_HOME}/sessions/YYYY/MM/DD/rollout-*.jsonl`. Codex는 재로그인해도 세션 보존.
     - **MoaCLI 함정**: 우리는 계정을 디렉터리 전체(`CLAUDE_CONFIG_DIR`/`CODEX_HOME`)로 분리하므로 계정 B 디렉터리에는 계정 A의 세션 파일이 없다. env만 바꿔 `--resume`하면 "세션 없음".
     - 구현안: (a) 세션 JSONL을 대상 계정 디렉터리로 복사(디렉터리 구조 유지) 후 resume — 간단하고 원본 보존. (b) auth 파일만 교체(Codex `auth.json`, Claude `.credentials.json`) — CLI 재시작+resume 필요.
     - 흐름(인터랙티브 탭): CLI 종료 → 세션 파일 복사 → 새 계정 env로 `claude --resume <id>` / `codex resume <id>` 재기동. 세션 ID는 이미 추적 중(Recent의 resumeId, delegation의 worker_session_id). 위임 작업은 재시도 항목 2와 통합 — Claude는 `-p --resume <id>` headless 동작 확인됨, Codex `exec` resume 지원 여부는 구현 시 확인.
  3. **(검토) caller 채팅과의 연계 표시** — MoaCLI 안 터미널 세션이 moacli MCP를 호출했을 때 그 세션 탭에 위임 뱃지/진행 표시. 단 HTTP 요청만으로는 어느 세션이 호출했는지 특정 불가(user-agent는 CLI 종류만 구분) → 정확 매칭은 별도 식별 수단 필요. Phase 2의 "위임 작업 = 특수 세션 탭" 가시화와 통합해서 검토.
- 등록 커맨드는 `--scope user` 기본 포함(2026-08-31): moacli는 머신 단위 기능이라 프로젝트 로컬 스코프로 둘 이유가 없음.
- 재개 순서: ① Phase 1 UI 실기 확인(승인 모달 표시/Esc/계정 선택, 설정 Delegation 섹션 복사 버튼, 알림 클릭 → 모달) → ② 위 예약 작업 1·2 → ③ Phase 2(§4·§6: 위임 작업을 특수 세션 탭으로 가시화 + stream-json 렌더, `moacli_permission` 실행 중 권한 모달, 위임 히스토리).
- Phase 1에서 의도적으로 뺀 것: 자동 승인 옵션(항상 물어봄), Codex worker의 MCP 비활성(`codex exec`는 `--approve-for-me` 없이는 MCP 툴을 못 부르므로 재귀 위험 낮음), 위임 깊이 추적(worker env `MOACLI_DELEGATION_DEPTH=1`만 심어둠).

## 8. 비스코프 / 향후 확장

- **로컬 모델**: 현재 스코프 아님. 단, 자체 에이전트를 만들 필요는 없음 — Codex CLI가 `--oss`(Ollama) 및 `config.toml`의 `model_providers`(OpenAI 호환 엔드포인트: Ollama/LM Studio/vLLM)로 로컬 모델 하네스를 겸하므로, 위임 구조를 "worker = headless 실행 가능한 CLI"로 에이전트 중립적으로 두면 나중에 worker 프로필 추가만으로 지원 가능. OpenCode/Aider/Goose도 후보. 자체 에이전트(Agent SDK)는 마지막 카드.
- **Gemini CLI worker**: headless(`-p`) + MCP 지원 확인됨. 승인은 Codex처럼 사전 정책만. worker 프로필 추가로 대응 가능.
- **Claude Desktop 등 외부 앱을 caller로**: elicitation 미지원 등 편차 있음. CLI 두 종 우선.
