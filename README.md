# Git GUI

Git을 잘 모르는 사람도 바뀐 내용을 확인하고, 저장(커밋)하고, 온라인에 올리고(푸시), 예전 상태로 되돌릴 수 있도록 돕는 데스크톱 Git 클라이언트입니다.

## 현재 상태

- **데모 모드**: 가상의 프로젝트로 저장 → 비밀 정보 경고 → 올리기 → 되돌리기 흐름을 체험할 수 있는 클릭형 프로토타입
- **실제 저장소 모드** (데스크톱 앱): 폴더를 열면 실제 `git status` 결과(갈래, 온라인과의 차이, 바뀐 파일)를 보여줌
  - 다른 프로그램에서 파일을 바꾸고 창으로 돌아오면 자동으로 다시 읽음
  - 커밋·푸시·저장 기록 그래프는 다음 단계에서 연결 예정

## 기술 구성

| 영역 | 사용 기술 |
|---|---|
| 화면 | React, TypeScript, Vite, Tailwind CSS |
| 데스크톱 | Tauri 2 (Rust) |
| Git | PC에 설치된 git CLI 실행 |

## 실행 방법

필요한 것: Node.js, Rust(rustup), Git, Windows의 경우 Visual Studio C++ Build Tools

```bash
npm install

# 웹 브라우저에서 데모만 보기
npm run dev

# 데스크톱 앱으로 실행 (실제 저장소 열기 가능)
npm run desktop

# 실행 파일 빌드
npm run tauri build
```

Rust 단위 테스트:

```bash
cd src-tauri
cargo test
```

## 폴더 구조

```
src/                   화면 (React)
  App.tsx              전체 레이아웃, 데모/실제 모드 전환
  store.ts             데모 시나리오 상태와 터미널 명령 해석
  git.ts               Rust 명령 호출
  components/          화면 구성 요소
src-tauri/             데스크톱 앱 (Rust)
  src/git.rs           git status 실행과 결과 해석
  src/lib.rs           Tauri 명령 등록
```
