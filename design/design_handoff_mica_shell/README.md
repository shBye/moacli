# Handoff: CLI Agent Manager — 마이카 블러 셸 + Start 재설계

## Overview

`cli-agent-manager` (Electron + React + xterm.js, Windows 우선) 의 UI 리디자인입니다. 목표 4가지:

1. 불투명 `#111315` 단색 셸을 **반투명 마이카/아크릴 셸**로 교체 (바탕화면이 은은히 비침)
2. 간격·정렬 정리 — 현재 화면이 꽉 막혀 보이는 문제 해소
3. **Start(새 세션) 흐름 재설계** — 툴바 폼을 중앙 런처로 이동
4. 상태색 / 에이전트색 충돌 해소, 사이드바 섹션 접기, 스크롤바 교체, 제목 길이 제한

## About the Design Files

이 번들의 HTML 파일은 **디자인 레퍼런스**입니다. 의도한 외형과 동작을 보여주는 프로토타입이며, 그대로 복사해 넣는 프로덕션 코드가 아닙니다. 작업은 이 디자인을 **기존 코드베이스(React 19 + Vite + Electron, `src/App.tsx` / `src/styles.css`)의 패턴 안에서 다시 구현**하는 것입니다. 프로토타입은 인라인 스타일로 작성되어 있지만, 실제 구현은 기존처럼 `src/styles.css`의 클래스 기반으로 옮겨야 합니다.

- `CLI-Agent-Manager-final.dc.html` — **확정 화면 2장.** 이것을 기준으로 구현하세요.
- `CLI-Agent-Manager-explorations.dc.html` — 검토 과정의 옵션 보드 (Start 3안, 설정 모달, 사이드바 디테일, 현재 UI 재현본). 참고용.
- `support.js` — 위 HTML 파일 렌더링용 런타임. 구현에 옮기지 마세요.

브라우저에서 `CLI-Agent-Manager-final.dc.html`을 열면 실제로 렌더링됩니다.

## Fidelity

**High-fidelity.** 색상·타이포·간격 모두 최종값입니다. 아래 토큰표의 값을 그대로 사용하세요.

예외 2가지:
- **바탕화면 그라디언트는 플레이스홀더**입니다. 실제로는 OS 마이카가 사용자 바탕화면을 비추므로 구현하지 않습니다.
- 아이콘은 인라인 SVG 대역입니다. 실제 구현은 기존대로 **lucide-react**를 쓰세요 (아래 아이콘 매핑 참고).

---

## Screens / Views

### 1. 빈 상태 — 중앙 런처 (파일 내 `#3a`)

**Purpose** — 앱을 켰을 때, 또는 열린 세션이 하나도 없을 때. 새 세션을 만드는 유일한 진입점.

**Layout**

```
창 (border-radius 11px, border 1px rgba(255,255,255,.13))
├─ 타이틀바           height 38px
└─ 본문 grid: 272px | 1fr
   ├─ 사이드바
   └─ 메인 grid-rows: 1fr | 30px
      ├─ 런처 (place-items:center, padding 32px)
      │  └─ 폭 max-width 520px, flex column, gap 22px
      └─ 상태바         height 30px
```

**런처 내부** (위→아래, `gap: 22px`)

1. **헤더 블록** — flex column, `gap: 7px`, 가운데 정렬
   - 아이콘 타일 34×34, `border-radius: 9px`, bg `color-mix(in oklch, var(--acc) 16%, transparent)`, border `1px solid color-mix(in oklch, var(--acc) 34%, transparent)`. 안에 터미널 프롬프트 아이콘 17px, stroke `var(--acc)`, `stroke-width 1.8`
   - 제목 "새 세션 시작" — Inter 600 / 17px / 1.3, `#eef0f2`
   - 설명 "에이전트와 작업 경로를 고르면 바로 실행됩니다." — Inter 400 / 11.5px / 1.5, `rgba(255,255,255,.42)`
2. **폼 카드** — `padding: 16px`, `border-radius: 12px`, border `1px solid rgba(255,255,255,.09)`, bg `rgba(255,255,255,.035)`, flex column `gap: 10px`
   - **에이전트 선택 행** — flex `gap: 7px`, 각 카드 `flex:1; min-width:0`, `padding: 11px 4px`, `border-radius: 9px`, border `1px solid rgba(255,255,255,.08)`, bg `rgba(0,0,0,.2)`. 안에 모노그램 타일 22×22 (`border-radius: 6px`, bg `rgba(255,255,255,.06)`, JetBrains Mono 700 / 9.5px) + 라벨 (Inter 500 / 9.5px, `rgba(255,255,255,.55)`, 말줄임)
   - **제목 필드** — height 38px, `padding: 0 12px`, `border-radius: 9px`, border `1px solid color-mix(in oklch, var(--acc) 36%, transparent)` (포커스 상태), bg `rgba(0,0,0,.28)`. 라벨 "제목" Inter 600 / 9.5px / uppercase / `letter-spacing .08em`. 값은 Inter 400 / 12.5px, `#e7e9ea`. 우측에 `21/40` 카운터 (JetBrains Mono 400 / 9.5px, `rgba(255,255,255,.28)`)
   - **작업 경로 필드** — 동일 규격, border `rgba(255,255,255,.08)`, bg `rgba(0,0,0,.2)`. 폴더 아이콘 14px + 경로 (JetBrains Mono 400 / 11.5px, 말줄임) + "변경" 링크 (Inter 500 / 10px, `var(--acc)`)
   - **계정 필드** — 동일 규격. 에이전트 색 칩 16×16 (`border-radius: 4px`) + 이메일 + 우측 "Prototype 폴더에 저장" (Inter 400 / 10px, `rgba(255,255,255,.3)`)
3. **Start 행** — flex `gap: 12px`
   - 버튼 `flex:1`, height 42px, `border-radius: 10px`, bg `linear-gradient(180deg, color-mix(in oklch, var(--acc) 82%, white), var(--acc))`, 텍스트 `var(--acc-ink)` Inter 700 / 13px, shadow `0 6px 20px color-mix(in oklch, var(--acc) 32%, transparent)`. 재생 삼각형 13px + "Start"
   - 우측 `⌘↵` (JetBrains Mono 400 / 10px, `rgba(255,255,255,.3)`) — Windows에서는 `Ctrl+Enter`로 표기

**상태바 (빈 상태)** — `idle` · `세션 없음` · `0/10 open` · 우측에 감지된 CLI 버전

---

### 2. 활성 세션 (파일 내 `#2a`)

**Purpose** — 세션을 시작했거나 사이드바 Recent를 클릭했을 때.

**Layout** — 창/타이틀바/사이드바는 1번과 동일. 메인만 `grid-rows: auto | 1fr | 30px`.

**세션 헤더** (`padding: 16px 20px 0`, 하단 `1px solid rgba(255,255,255,.07)`)

- 1행 (flex, `gap: 10px`, align center):
  - 에이전트 모노그램 24×24, `border-radius: 6px`, 해당 에이전트 색 16% 틴트 + 34% 보더
  - 제목 `h1` — Inter 600 / 15px / 1.2, `#f2f4f5`, **`max-width: 340px` + 말줄임**
  - 상태 칩 — `padding: 4px 9px`, `border-radius: 99px`, 실행 중이면 bg `rgba(62,213,152,.12)` / border `rgba(62,213,152,.26)` / 텍스트 `#3ED598` Inter 600 / 10px, 앞에 5px 점
  - 계정 이메일 — JetBrains Mono 400 / 10px, `rgba(255,255,255,.34)`
  - (우측) cwd — 동일 서체, `max-width: 280px` 말줄임
  - 닫기 ✕ 24×24
- 2행 탭 (flex, `gap: 22px`): `CLI` / `대화 전문 <카운트>`. 활성 탭은 `border-bottom: 2px solid var(--acc)` + `#f0f2f3` Inter 600 / 11px, 비활성은 Inter 500 / 11px `rgba(255,255,255,.42)`. `padding: 0 1px 9px`
- 2행 우측: **투명도 슬라이더** — 라벨 "투명도" (Inter 500 / 9.5px, uppercase) + 트랙 56×3px `rgba(255,255,255,.12)`, 채움 `var(--acc)`. 사용자가 창 투명도를 직접 조절 (아래 State 참고)

**터미널 페인** — `padding: 16px 20px`, bg `rgba(0,0,0,.24)`, JetBrains Mono 400 / 12px / 1.75, `#c9d0d4`. **완전 투명이 아니라 한 겹 딤을 깔아 가독성을 확보합니다.**

**상태바** — 상태 점 + `running` (`#3ED598`) · 에이전트 버전 · `2/10 open` · 우측에 유휴 타이머 (`idle 00:12 · 자동 종료까지 29분`)

---

### 3. 사이드바 (두 화면 공통, width 272px)

`border-right: 1px solid rgba(255,255,255,.07)`, bg `rgba(255,255,255,.022)`, `overflow-y: auto`.

- **검색** — `margin: 14px 14px 10px`, height 34px, `border-radius: 8px`, border `1px solid rgba(255,255,255,.09)`, bg `rgba(0,0,0,.22)`. 돋보기 14px + placeholder "세션 검색" + 우측 `⌘K` 배지 (`padding: 3px 5px`, border `1px solid rgba(255,255,255,.1)`, `border-radius: 4px`)
- **섹션 헤더 (Folders / Recent / Agents)** — height 30px, `padding: 0 6px`, Inter 700 / 9.5px / uppercase / `letter-spacing .11em`, `rgba(255,255,255,.42)`. 좌측 캐럿 `▾`/`▸` (9px 고정폭), 우측 카운트 (JetBrains Mono 400 / 9.5px). **클릭하면 접힘/펼침** — 이게 "화면이 꽉 막혀 보인다"는 피드백의 해결책입니다.
- **폴더 행** — height 32px, `border-radius: 7px`, 활성 시 bg `rgba(255,255,255,.07)` + 폴더 아이콘 stroke `var(--acc)`
- **세션 행** — flex `gap: 9px`, `padding: 9px 8px 9px 10px`, `border-radius: 7px`, 좌측 들여쓰기 10px. 활성 시 bg `color-mix(in oklch, var(--acc) 12%, transparent)` + `box-shadow: inset 2px 0 0 var(--acc)`
  - 모노그램 타일 20×20 (`border-radius: 5px`)
  - 제목 Inter 600 / 11.5px / 1.25, **말줄임** (~18자에서 잘림)
  - 상태 점 6px — 실행 중 `#3ED598` + `box-shadow: 0 0 0 3px rgba(62,213,152,.18)`, 그 외 `rgba(255,255,255,.22)`
  - cwd JetBrains Mono 400 / 9.5px / 1.3, `rgba(255,255,255,.36)`, 말줄임
- **Agents 섹션** — `margin-top: auto`로 하단 고정. 행 grid `20px | 1fr | auto`, height 28px

**스크롤바** (전역 교체, `src/styles.css`):

```css
.scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.16) transparent; }
.scroll::-webkit-scrollbar { width: 9px; height: 9px; }
.scroll::-webkit-scrollbar-track { background: transparent; }
.scroll::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,.14);
  border-radius: 99px;
  border: 3px solid transparent;
  background-clip: content-box;
}
.scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.3); background-clip: content-box; }
```

기존 `scrollbar-color: #3c4449 transparent`를 이걸로 대체하세요.

---

### 4. 타이틀바 (커스텀, height 38px)

`border-bottom: 1px solid rgba(255,255,255,.07)`, bg `rgba(255,255,255,.025)`, `-webkit-app-region: drag`.

좌측: 액센트 사각형 14×14 (`border-radius: 4px`, opacity .9) + "CLI Agent Manager" (Inter 600 / 11.5px, `#dfe3e6`) + `prototype` 배지 (JetBrains Mono 500 / 9px, uppercase, `letter-spacing .1em`, `padding: 3px 6px`, border `1px solid rgba(255,255,255,.12)`).

우측: 최소화 / 최대화 / 닫기 각 44×37px, `-webkit-app-region: no-drag`. 호버 시 `rgba(255,255,255,.07)`, 닫기 호버만 `#c42b1c`.

**투명 창은 프레임리스와 함께 써야 리사이즈 깜빡임이 없습니다** — `frame: false`가 전제입니다.

---

## Interactions & Behavior

### 이번 리디자인의 핵심 동작 변경

**세션 클릭이 새 세션 폼을 오염시키지 않습니다.** 현재 `App.tsx`의 `resumeConversation()`은 `setAgentId` / `setAccountId` / `setCwd` / `setTitle`을 호출해 툴바 폼 상태를 덮어씁니다. 그래서 세션을 하나 열고 Start를 누르면 직전 세션과 제목이 똑같아집니다.

새 구조에서는 이 두 가지가 완전히 분리됩니다:

- **런처 폼 상태** (`title` / `agentId` / `accountId` / `cwd`) — 새 세션 전용. 다른 세션을 열어도 건드리지 않음.
- **활성 세션 컨텍스트** (`activeSessionId` → `RuntimeSession`) — 읽기 전용 표시.

따라서 `resumeConversation()`에서 `setAgentId` / `setAccountId` / `setCwd` / `setTitle` 4줄을 **삭제**하고, `activateSession(id)`만 남기세요. Start를 누른 뒤에는 런처 폼을 초기화합니다(제목은 비우고, 에이전트/경로는 유지하는 것이 편리).

### 나머지

- 사이드바 섹션 헤더 클릭 → 접힘/펼침 토글. 상태는 `localStorage`에 저장해 재실행 시 복원.
- 에이전트 카드 클릭 → 선택. 선택 카드는 border `var(--acc)` 36% + bg 8% 틴트.
- `Enter` (경로/제목 입력 중) 또는 `Ctrl+Enter` → Start.
- `Ctrl+K` → 검색 포커스.
- 세션 행 호버 → bg `rgba(255,255,255,.04)`, 닫기 ✕ 노출.
- 탭 전환은 기존 로직 유지 (`대화 전문`은 `historyKey`가 있을 때만 활성).
- 트랜지션: 접힘/펼침과 호버 모두 `160ms ease-out`. 그 이상 길게 잡지 마세요.
- 포커스 링: `outline: 2px solid var(--acc); outline-offset: 2px` — 브라우저 기본 파란 링을 남기지 마세요.

### 제목 길이 제한

- 런처 입력: `maxLength = 40`, 카운터 표시.
- 사이드바 표시: `max-width` + `text-overflow: ellipsis` (약 18자에서 잘림).
- 세션 헤더 `h1`: `max-width: 340px` + 말줄임. 전체 제목은 `title` 속성으로 툴팁.

---

## 투명 / 마이카 구현 노트

가장 중요한 부분이고, 잘못 잡으면 전부 불투명하게 나옵니다.

**1) BrowserWindow (`electron/main.ts`)**

```ts
new BrowserWindow({
  frame: false,
  transparent: true,
  backgroundColor: '#00000000',
  backgroundMaterial: 'mica',   // Windows 11. 'acrylic'이면 뒤 창까지 비침 (성능 부담 ↑)
  // ...
})
```

- **Mica는 바탕화면만 비칩니다.** 뒤에 있는 다른 창까지 비치게 하려면 `'acrylic'`.
- Windows 10 이하 / 미지원 환경에서는 폴백이 필요합니다 — `backgroundMaterial` 미지원 시 셸 배경을 `#141619`로 두고 블러 없이 동작하게 하세요.

**2) 렌더러 배경 (`src/styles.css`)**

`html, body, #root, .app-shell`의 배경을 `transparent`로 바꾸고, 셸 표면만 반투명으로 칠합니다:

```css
.app-shell {
  background: rgba(16, 18, 22, .62);
  backdrop-filter: blur(44px) saturate(1.5);
}
```

`backdrop-filter`는 마이카 위에 한 겹 더 얹는 용도입니다. 마이카만으로 충분하면 빼도 됩니다.

**3) xterm (`src/terminal/TerminalPane.tsx`)**

```ts
new Terminal({
  allowTransparency: true,
  theme: { background: 'rgba(0,0,0,0)' },
})
```

- **WebGL/canvas 렌더러는 투명 배경을 제대로 그리지 못합니다.** `@xterm/addon-webgl`을 쓰고 있다면 제거하고 DOM 렌더러를 쓰세요. 스크롤 성능이 떨어지는 대가가 있습니다.
- CLI가 배경색을 직접 칠하는 셀(선택 영역, TUI 패널)은 불투명하게 남습니다. 정상입니다.
- 가독성 확보를 위해 **터미널 페인 컨테이너에 `background: rgba(0,0,0,.24)`를 깝니다.** 창 전체는 마이카, CLI 영역만 살짝 어둡게 — 이게 디자인의 의도입니다.

**4) 투명도 슬라이더**

세션 헤더 우측의 슬라이더는 터미널 딤 값(`rgba(0,0,0,α)`, α = 0 ~ 0.5, 기본 0.24)을 조절합니다. CSS 변수 `--term-dim`으로 두고 `localStorage`에 저장하세요. 창 자체의 `setOpacity()`가 아닙니다 — 그건 텍스트까지 투명해집니다.

---

## State Management

기존 `App.tsx` 상태에서 추가/변경되는 것만:

| 상태 | 타입 | 설명 |
| --- | --- | --- |
| `launcherDraft` | `{ title, agentId, accountId, cwd }` | 새 세션 전용. 세션 클릭과 무관하게 유지 |
| `sectionOpen` | `{ folders: boolean; recent: boolean; agents: boolean }` | 사이드바 접힘. `localStorage` 저장 |
| `termDim` | `number` (0–0.5) | 터미널 딤 정도. `localStorage` 저장 |
| `theme` | `'amber' \| 'periwinkle'` | 액센트 테마. `localStorage` 저장 |

`resumeConversation()`에서 폼 setter 4개 제거 (위 참고).

---

## Design Tokens

### 액센트 테마 (2종, 런타임 전환)

| 토큰 | Amber | Periwinkle |
| --- | --- | --- |
| `--acc` | `#E9B45C` | `#8AA0FF` |
| `--acc-ink` (액센트 위 텍스트) | `#1a1409` | `#0e1226` |

액센트 파생값은 전부 `color-mix(in oklch, var(--acc) N%, transparent)`로 계산합니다 (틴트 12–16%, 보더 34–36%, 그림자 32%). 테마별로 하드코딩하지 마세요.

### 표면 (모두 마이카 위에 얹히는 반투명 값)

| 역할 | 값 |
| --- | --- |
| 창 표면 | `rgba(16,18,22,.62)` + `backdrop-filter: blur(44px) saturate(1.5)` |
| 타이틀바 | `rgba(255,255,255,.025)` |
| 사이드바 | `rgba(255,255,255,.022)` |
| 카드 / 올린 면 | `rgba(255,255,255,.035)` |
| 입력 필드 | `rgba(0,0,0,.2)` / 포커스 시 `rgba(0,0,0,.28)` |
| 터미널 딤 | `rgba(0,0,0,.24)` |
| 창 보더 | `rgba(255,255,255,.13)` |
| 내부 구분선 | `rgba(255,255,255,.07)` |
| 창 그림자 | `0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.4)` |

### 텍스트

| 역할 | 값 |
| --- | --- |
| 최상위 (제목) | `#f2f4f5` |
| 본문 | `#e7e9ea` |
| 보조 | `rgba(255,255,255,.62)` |
| 약함 (라벨/메타) | `rgba(255,255,255,.42)` |
| 가장 약함 (카운터/힌트) | `rgba(255,255,255,.28)` ~ `.34` |

### 상태색 — 에이전트 색과 분리

이게 "gpt가 초록색이라 뭐가 활성화된 건지 애매하다"는 피드백의 해결책입니다. **초록은 실행 상태 전용으로 예약**하고, 에이전트 구분은 색이 아니라 **모노그램 타일**로 합니다.

| 상태 | 점 색 | 텍스트 |
| --- | --- | --- |
| 실행 중 | `#3ED598` + `0 0 0 3px rgba(62,213,152,.18)` | `#3ED598` |
| 시작 중 | `var(--acc)` | `var(--acc)` |
| 대기 / 중지 | `rgba(255,255,255,.22)` | `rgba(255,255,255,.42)` |
| 오류 / 미탐지 | `#EF6464` | `#EF6464` |

에이전트 모노그램 (기존 `profiles/agents.default.json`의 `color` 값 유지, 타일 배경 16% / 보더 34% 틴트로만 사용):

| 에이전트 | 모노그램 | 색 |
| --- | --- | --- |
| PowerShell | `PS` | `#7DD3FC` |
| Claude Code | `C` | `#E58B68` |
| Codex | `X` | `#34D399` |
| Gemini CLI | `G` | `#A78BFA` |
| OpenCode | `O` | `#F4C95D` |

사이드바 Recent 목록과 Agents 목록에서는 타일 배경을 중립(`rgba(255,255,255,.05)` + 보더 `.09`)으로 두고 글자만 흐린 흰색으로 씁니다 — 색점이 줄줄이 늘어서는 걸 피하기 위함입니다.

### 타이포그래피

| 역할 | 값 |
| --- | --- |
| UI 서체 | `Inter, "Segoe UI Variable", "Segoe UI", sans-serif` |
| 모노 서체 | `"JetBrains Mono", Consolas, ui-monospace, monospace` |
| 화면 제목 | 600 / 17px / 1.3 |
| 세션 제목 (헤더) | 600 / 15px / 1.2 |
| 카드 제목 | 600 / 12.5px |
| 본문 | 400 / 11.5–12.5px / 1.5 |
| 목록 제목 | 500–600 / 11.5px / 1.25 |
| 섹션 라벨 | 700 / 9.5px / uppercase / `letter-spacing .11em` |
| 필드 라벨 | 600 / 9–9.5px / uppercase / `letter-spacing .08em` |
| 메타·경로 (모노) | 400 / 9.5–10.5px / 1.3 |
| 터미널 (모노) | 400 / 12px / 1.75 |

### 간격 / 반경

간격 스케일: **3 · 6 · 7 · 9 · 10 · 12 · 14 · 16 · 20 · 22 · 26 · 32px**

| 반경 | 용도 |
| --- | --- |
| 4–5px | 배지, 작은 칩, 모노그램 20px 이하 |
| 6–7px | 아이콘 버튼, 목록 행 |
| 8–9px | 입력 필드, 검색, 에이전트 카드 |
| 10px | Start 버튼 |
| 11–12px | 창, 폼 카드 |
| 99px | 상태 칩, 스크롤바 썸 |

고정 치수: 타이틀바 38px · 사이드바 272px · 상태바 30px · 입력 38px · Start 42px · 섹션 헤더 30px · 목록 행 32px · 아이콘 버튼 24–28px.

---

## Assets

새 에셋 없습니다.

- **아이콘** — 기존대로 `lucide-react`. 프로토타입의 인라인 SVG는 대역입니다.
  | 위치 | lucide 컴포넌트 |
  | --- | --- |
  | 검색 | `Search` |
  | 폴더 (닫힘/열림) | `Folder` / `FolderOpen` |
  | 섹션 캐럿 | `ChevronDown` / `ChevronRight` |
  | Start 버튼 | `Play` (`fill="currentColor"`) |
  | 런처 헤더 타일 | `SquareTerminal` |
  | 세션 닫기 / 모달 닫기 | `X` |
  | 새로고침 | `RefreshCw` |
  | 추가 | `Plus` |
  | 삭제 | `Trash2` |
  | 로그인 | `LogIn` |
  | 설정 | `Settings2` |
  | 상태 표시 | `Activity` |
- **폰트** — Inter와 JetBrains Mono를 로컬 번들로 포함하세요. `src/index.html`의 CSP가 `font-src 'self'`이므로 Google Fonts CDN은 차단됩니다.
- **바탕화면** — 구현하지 않습니다 (OS 마이카).

---

## Files

이 번들:

- `CLI-Agent-Manager-final.dc.html` — 확정 화면 2장 (빈 상태 `#3a`, 활성 세션 `#2a`)
- `CLI-Agent-Manager-explorations.dc.html` — 옵션 보드. Start 3안, 계정 설정 모달(`#2e`), 사이드바 디테일(`#2f`), 현재 UI 재현본(`#1a`, `#1b`)
- `support.js` — 위 두 파일 렌더링용 런타임 (구현 대상 아님)
- `screens/` — 확정 화면 스크린샷 (2x)
  - `01-empty-state-launcher-amber.png`
  - `02-active-session-amber.png`
  - `03-empty-state-launcher-periwinkle.png`
  - `04-active-session-periwinkle.png`

대상 코드베이스에서 손댈 파일:

- `src/styles.css` — 표면·토큰·스크롤바 전면 교체
- `src/App.tsx` — 런처 분리, 사이드바 접힘, `resumeConversation()` 수정, 커스텀 타이틀바
- `src/terminal/TerminalPane.tsx` — `allowTransparency`, 투명 테마, WebGL 애드온 제거
- `electron/main.ts` — `frame: false`, `transparent`, `backgroundMaterial`
- `profiles/agents.default.json` — 변경 없음 (색은 모노그램 타일 틴트로만 사용)
