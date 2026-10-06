// 실제 Git 저장소를 읽는 명령들.
// 앱에 내장된 git 이 아니라 지금은 PC에 설치된 git CLI 를 실행한다.

use serde::Serialize;
use std::ffi::OsStr;
use std::path::Path;
use std::process::Command;

// #[derive(Serialize)] : 이 구조체를 JSON 으로 바꿔서 React 로 보낼 수 있게 해준다.
// rename_all = "camelCase" : Rust 의 snake_case 필드 이름을 JS 식 camelCase 로 바꿔서 보낸다.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// 화면에 보여줄 한 글자 상태: A(새 파일) M(수정) D(삭제) R(이름 바뀜) U(충돌)
    pub status: String,
    /// git 이 준 원래 두 글자 코드 (예: " M", "??", "A ")
    pub code: String,
    /// 이미 stage(저장 준비)된 변경인지
    pub staged: bool,
    /// 이름이 바뀐(R) 파일의 원래 이름. 커밋할 때 원래 이름의 삭제도 함께 넣어야 한다.
    pub orig_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub root: String,
    pub name: String,
    /// 현재 갈래 이름. 갈래가 아닌 곳(detached HEAD)에 있으면 None
    pub branch: Option<String>,
    /// 연결된 온라인 갈래 (예: origin/main)
    pub upstream: Option<String>,
    /// 온라인보다 앞선(아직 안 올린) 저장 지점 수
    pub ahead: u32,
    /// 온라인보다 뒤처진(아직 안 받은) 저장 지점 수
    pub behind: u32,
    /// 아직 저장 지점이 하나도 없는 새 저장소인지
    pub no_commits: bool,
    /// 연결된 온라인 저장소 이름들 (보통 "origin" 하나)
    pub remotes: Vec<String>,
    pub files: Vec<FileChange>,
}

/// git 명령을 실행하고 표준 출력을 문자열로 돌려준다.
/// 실패하면 Err 에 사람이 읽을 수 있는 메시지를 담는다.
///
/// 제네릭(<I, S>) : args 로 `["status"]` 같은 &str 배열도, Vec<String> 도 받을 수 있게 한다.
/// "OS 에 문자열로 넘길 수 있는 것(AsRef<OsStr>)들의 묶음"이면 무엇이든 된다는 뜻.
fn run_git<I, S>(dir: &Path, args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_git_env(dir, args, &[])
}

/// run_git 과 같지만 환경 변수를 더 지정할 수 있다 (예: 로그인 창을 띄우지 않기)
fn run_git_env<I, S>(dir: &Path, args: I, envs: &[(&str, &str)]) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut cmd = Command::new("git");
    cmd.envs(envs.iter().copied());
    // 영어 메시지로 고정해서, 에러 문구를 안정적으로 알아볼 수 있게 한다
    cmd.env("LC_ALL", "C");
    // 비밀번호를 터미널에서 묻지 않게 한다. 창이 없는 앱이라 물으면 영원히 멈춰 버린다.
    // (GitHub 로그인은 Git Credential Manager 가 별도 창으로 처리한다)
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    // core.quotepath=false : 한글 파일 이름을 "\355\225\234" 처럼 바꾸지 않고 그대로 출력
    cmd.args(["-c", "core.quotepath=false"]).args(args).current_dir(dir);

    // Windows 에서 git 을 실행할 때 검은 콘솔 창이 잠깐 뜨는 것을 막는다.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // `?` : 실패(Err)면 여기서 바로 함수를 빠져나가 그 에러를 돌려준다.
    let out = cmd
        .output()
        .map_err(|e| format!("git 을 실행하지 못했어요. Git 이 설치되어 있는지 확인해 주세요. ({e})"))?;

    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// 두 글자 상태 코드(XY)를 화면용 한 글자로 줄인다.
/// X = stage 된 쪽 상태, Y = 작업 폴더 쪽 상태
fn simplify(code: &str) -> &'static str {
    match code {
        "??" => "A",
        "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU" => "U",
        _ if code.contains('R') => "R",
        _ if code.contains('D') => "D",
        _ if code.starts_with('A') => "A",
        _ => "M",
    }
}

/// "## main...origin/main [ahead 1, behind 2]" 같은 첫 줄에서 갈래 정보를 뽑는다.
fn parse_branch_line(line: &str, st: &mut RepoStatus) {
    let rest = line.trim_start_matches("## ");

    if let Some(b) = rest.strip_prefix("No commits yet on ") {
        st.branch = Some(b.to_string());
        st.no_commits = true;
        return;
    }
    if rest.starts_with("HEAD (no branch)") {
        return; // 갈래가 아닌 곳에 있음
    }

    // "main...origin/main [ahead 1]" → 이름 부분과 [ ] 부분으로 나누기
    let (names, counts) = match rest.split_once(" [") {
        Some((n, c)) => (n, Some(c.trim_end_matches(']'))),
        None => (rest, None),
    };
    match names.split_once("...") {
        Some((local, remote)) => {
            st.branch = Some(local.to_string());
            st.upstream = Some(remote.to_string());
        }
        None => st.branch = Some(names.to_string()),
    }
    if let Some(counts) = counts {
        for part in counts.split(", ") {
            if let Some(n) = part.strip_prefix("ahead ") {
                st.ahead = n.parse().unwrap_or(0);
            } else if let Some(n) = part.strip_prefix("behind ") {
                st.behind = n.parse().unwrap_or(0);
            }
        }
    }
}

/// 저장소의 맨 위 폴더를 찾는다. Git 저장소가 아니면 친절한 메시지로 실패한다.
fn repo_root(path: &str) -> Result<String, String> {
    run_git(Path::new(path), ["rev-parse", "--show-toplevel"])
        .map(|out| out.trim().to_string())
        .map_err(|_| "이 폴더는 Git 저장소가 아니에요. Git 으로 관리 중인 프로젝트 폴더를 골라 주세요.".to_string())
}

/// 저장소 상태를 읽는다. path 는 사용자가 고른 폴더(저장소 안의 하위 폴더여도 된다).
pub fn status(path: &str) -> Result<RepoStatus, String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);

    // -z : 파일 이름을 NUL 문자로 구분해서, 공백·특수문자가 있어도 안전하게 나눌 수 있다.
    let raw = run_git(
        root_path,
        ["status", "--porcelain=v1", "--branch", "-z", "--untracked-files=all"],
    )?;

    let name = root_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.clone());

    let mut st = RepoStatus {
        root: root.clone(),
        name,
        branch: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        no_commits: false,
        remotes: run_git(root_path, ["remote"])?.lines().map(String::from).collect(),
        files: Vec::new(),
    };

    let mut entries = raw.split('\0').filter(|s| !s.is_empty());
    while let Some(entry) = entries.next() {
        if entry.starts_with("## ") {
            parse_branch_line(entry, &mut st);
            continue;
        }
        // 한 항목은 "XY 경로" 형태. 앞 두 글자가 상태 코드, 네 번째 글자부터 경로
        if entry.len() < 4 {
            continue;
        }
        let code = &entry[..2];
        let file_path = entry[3..].to_string();
        // 이름이 바뀐(R) / 복사된(C) 항목은 바로 다음 칸에 원래 이름이 온다.
        let orig_path = if code.starts_with('R') || code.starts_with('C') {
            entries.next().map(|s| s.to_string())
        } else {
            None
        };
        let x = code.chars().next().unwrap_or(' ');
        st.files.push(FileChange {
            path: file_path,
            status: simplify(code).to_string(),
            code: code.to_string(),
            staged: x != ' ' && x != '?',
            orig_path,
        });
    }

    Ok(st)
}

/* ---------- 저장 기록 (git log) ---------- */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub short: String,
    /// 부모 저장 지점들. 보통 1개, 합친(merge) 저장 지점이면 2개 이상, 맨 처음 것은 0개
    pub parents: Vec<String>,
    pub author: String,
    /// 저장한 시각 (1970년부터 흐른 초)
    pub time: i64,
    /// 이 저장 지점을 가리키는 이름들 (예: "HEAD -> refs/heads/main", "refs/remotes/origin/main", "tag: refs/tags/v1")
    pub refs: Vec<String>,
    pub subject: String,
}

/// 저장 기록을 최신 순으로 최대 limit 개 가져온다. 모든 갈래(로컬·온라인)와 태그를 포함한다.
pub fn history(path: &str, limit: Option<u32>) -> Result<Vec<CommitInfo>, String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);

    // 저장 지점이 하나도 없는 새 저장소면 빈 목록
    if run_git(root_path, ["rev-parse", "--verify", "--quiet", "HEAD"]).is_err() {
        return Ok(Vec::new());
    }

    // %x1f(칸 구분) / %x1e(줄 구분) : 커밋 메시지에 거의 나오지 않는 제어 문자로 나눠서 안전하게 해석
    let max = format!("--max-count={}", limit.unwrap_or(300));
    let raw = run_git(
        root_path,
        [
            "log",
            "--branches",
            "--remotes",
            "--tags",
            "HEAD",
            "--date-order",
            // 갈래 이름을 refs/heads/…(내 갈래), refs/remotes/…(온라인), refs/tags/…(태그)로 받아 확실히 구분
            "--decorate=full",
            max.as_str(),
            "--format=%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e",
        ],
    )?;
    Ok(parse_log(&raw))
}

/// git log 출력(위 형식)을 CommitInfo 목록으로 바꾼다. 테스트하기 쉽게 따로 뺐다.
fn parse_log(raw: &str) -> Vec<CommitInfo> {
    raw.split('\x1e')
        .map(str::trim)
        .filter(|rec| !rec.is_empty())
        .filter_map(|rec| {
            // splitn(7, ..) : 메시지(마지막 칸)에 구분 문자가 있어도 최대 7칸으로만 나눈다
            let f: Vec<&str> = rec.splitn(7, '\x1f').collect();
            if f.len() < 7 {
                return None; // 형식이 이상한 줄은 건너뛴다
            }
            Some(CommitInfo {
                hash: f[0].to_string(),
                short: f[1].to_string(),
                parents: f[2].split_whitespace().map(String::from).collect(),
                author: f[3].to_string(),
                time: f[4].parse().unwrap_or(0),
                refs: f[5].split(", ").filter(|r| !r.is_empty()).map(String::from).collect(),
                subject: f[6].to_string(),
            })
        })
        .collect()
}

/* ---------- 커밋 ---------- */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub hash: String,
    pub short: String,
}

/// 고른 파일들만 저장 지점(커밋)으로 만든다.
/// 이미 stage 돼 있던 다른 파일은 이번 커밋에 섞이지 않는다.
pub fn commit(
    path: &str,
    files: &[String],
    message: &str,
    description: Option<&str>,
) -> Result<CommitResult, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("저장 메시지를 적어 주세요.".into());
    }
    if files.is_empty() {
        return Err("저장할 파일을 하나 이상 골라 주세요.".into());
    }
    let root = repo_root(path)?;
    let root_path = Path::new(&root);

    // 1) 고른 파일을 stage 한다. -A : 새 파일 추가, 수정, 삭제를 모두 반영
    //    "--" 뒤는 전부 파일 이름으로 취급 (파일 이름이 "-" 로 시작해도 옵션으로 오해하지 않게)
    let mut add: Vec<&str> = vec!["add", "-A", "--"];
    add.extend(files.iter().map(String::as_str));
    run_git(root_path, add)?;

    // 2) 그 파일들만 커밋한다. 파일 이름을 주면 git 은 그 파일만 담는다(--only 동작).
    let mut commit: Vec<&str> = vec!["commit", "-m", message];
    let desc = description.map(str::trim).unwrap_or("");
    if !desc.is_empty() {
        commit.extend(["-m", desc]);
    }
    commit.push("--");
    commit.extend(files.iter().map(String::as_str));
    run_git(root_path, commit).map_err(friendly_commit_error)?;

    let hash = run_git(root_path, ["rev-parse", "HEAD"])?.trim().to_string();
    let short = hash.chars().take(7).collect();
    Ok(CommitResult { hash, short })
}

/// git 의 영어 에러를 사용자가 이해할 수 있는 말로 바꾼다.
fn friendly_commit_error(e: String) -> String {
    if e.contains("Please tell me who you are") || e.contains("user.email") {
        "Git 에 내 이름과 이메일이 아직 설정되지 않았어요. 아래처럼 설정한 뒤 다시 저장해 주세요.\n\
         git config --global user.name \"이름\"\n\
         git config --global user.email \"이메일\""
            .into()
    } else if e.contains("nothing to commit") || e.contains("no changes added") {
        "저장할 변경이 없어요. 파일이 이미 저장됐는지 확인해 주세요.".into()
    } else {
        format!("저장하지 못했어요.\n{e}")
    }
}


/* ---------- 올리기 (push) ---------- */

/// 저장 지점 정보 + 그 저장 지점에서 바뀐 파일 이름들
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitWithFiles {
    /// flatten : JSON 으로 보낼 때 info 안의 칸들을 한 단계 위로 펼친다 ({hash, subject, ..., files})
    #[serde(flatten)]
    pub info: CommitInfo,
    pub files: Vec<String>,
}

/// git log 범위(예: "@{u}..HEAD")의 저장 지점들을 바뀐 파일 목록과 함께 가져온다 (최신이 앞)
fn commits_with_files(root_path: &Path, range: &[&str]) -> Result<Vec<CommitWithFiles>, String> {
    let mut args = vec!["log", "--decorate=full", "--format=%H%x1f%h%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e"];
    args.extend_from_slice(range);
    let raw = run_git(root_path, args)?;
    parse_log(&raw)
        .into_iter()
        .map(|info| {
            // --root : 맨 첫 저장 지점도 파일 목록이 나오게
            let files = run_git(
                root_path,
                ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", info.hash.as_str()],
            )?
            .lines()
            .map(String::from)
            .collect();
            Ok(CommitWithFiles { info, files })
        })
        .collect() // Vec<Result<..>> 를 Result<Vec<..>> 로 모은다. 하나라도 실패하면 그 에러
}

/// 아직 온라인에 올리지 않은 저장 지점들 (최신이 앞).
/// 연결된 온라인 갈래가 있으면 그것과 비교하고, 없으면 어느 온라인 갈래에도 없는 것들을 모은다.
pub fn unpushed(path: &str) -> Result<Vec<CommitWithFiles>, String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);
    if run_git(root_path, ["rev-parse", "--verify", "--quiet", "HEAD"]).is_err() {
        return Ok(Vec::new());
    }
    if has_upstream(root_path) {
        commits_with_files(root_path, &["@{u}..HEAD"])
    } else {
        commits_with_files(root_path, &["HEAD", "--not", "--remotes"])
    }
}

fn has_upstream(root_path: &Path) -> bool {
    run_git(root_path, ["rev-parse", "--abbrev-ref", "@{u}"]).is_ok()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub remote: String,
    pub branch: String,
    /// 이번에 온라인 갈래를 새로 만들었는지 (처음 올리기)
    pub created: bool,
}

/// 저장 지점을 온라인에 올린다.
/// up_to 가 없으면 지금 갈래 전체를, 있으면 그 저장 지점까지만 올린다.
/// (Git 은 순서대로 쌓이므로 up_to 보다 오래된, 아직 안 올린 저장 지점도 함께 올라간다)
pub fn push(path: &str, up_to: Option<&str>) -> Result<PushResult, String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);

    let branch = run_git(root_path, ["symbolic-ref", "--short", "-q", "HEAD"])
        .map(|b| b.trim().to_string())
        .map_err(|_| "지금은 갈래가 아닌 곳(특정 저장 지점)에 있어서 올릴 수 없어요. 갈래로 돌아간 뒤 올려 주세요.".to_string())?;

    // 연결된 온라인 갈래 (예: "origin/main"). 없으면 처음 올리는 것
    let upstream = run_git(root_path, ["rev-parse", "--abbrev-ref", "@{u}"])
        .ok()
        .map(|u| u.trim().to_string());

    let result = match upstream {
        Some(up) => {
            let (remote, remote_branch) = up
                .split_once('/')
                .ok_or_else(|| format!("온라인 갈래 이름({up})을 이해하지 못했어요."))?;
            // "해시:refs/heads/main" = 이 저장 지점까지를 온라인 main 으로 올린다
            let refspec = format!("{}:refs/heads/{remote_branch}", up_to.unwrap_or("HEAD"));
            run_git(root_path, ["push", remote, refspec.as_str()]).map_err(friendly_push_error)?;
            PushResult { remote: remote.to_string(), branch: remote_branch.to_string(), created: false }
        }
        None => {
            if up_to.is_some() {
                return Err("처음 올리는 갈래는 한꺼번에 올려야 해요. ‘모두 올리기’를 눌러 주세요.".into());
            }
            let remotes: Vec<String> = run_git(root_path, ["remote"])?.lines().map(String::from).collect();
            // origin 이 있으면 origin, 없으면 하나뿐인 원격 저장소
            let remote = if remotes.iter().any(|r| r == "origin") {
                "origin".to_string()
            } else if remotes.len() == 1 {
                remotes[0].clone()
            } else if remotes.is_empty() {
                return Err("온라인 저장소(GitHub 등)와 연결되어 있지 않아요. 먼저 저장소를 연결해 주세요.".into());
            } else {
                return Err("온라인 저장소가 여러 개 연결돼 있어서 어디로 올릴지 정할 수 없어요.".into());
            };
            // -u : 올리면서 "이 갈래 ↔ 온라인 갈래" 연결도 만든다. 다음부터는 그냥 올리면 된다
            run_git(root_path, ["push", "-u", remote.as_str(), branch.as_str()]).map_err(friendly_push_error)?;
            PushResult { remote, branch, created: true }
        }
    };
    Ok(result)
}

/// push 실패 메시지를 쉬운 말로 바꾼다.
fn friendly_push_error(e: String) -> String {
    let has = |k: &str| e.contains(k);
    let msg = if has("fetch first") || has("non-fast-forward") || (has("[rejected]") && has("behind")) {
        "온라인에 내가 아직 받지 않은 새 저장 지점이 있어서 올릴 수 없어요. 먼저 ‘받아오기’로 최신 내용을 받아와야 해요."
    } else if has("GH013") || has("Push cannot contain secrets") {
        "GitHub 이 저장 지점 안에서 비밀 정보(API 키 등)를 찾아서 올리기를 막았어요. 해당 파일을 빼고 다시 저장해야 해요."
    } else if has("GH001") || has("Large files detected") || has("exceeds GitHub's file size limit") {
        "100MB 가 넘는 큰 파일이 있어서 GitHub 에 올릴 수 없어요."
    } else if has("protected branch") || has("pre-receive hook declined") {
        "이 갈래는 보호돼 있어서 바로 올릴 수 없어요. 팀 규칙(Pull Request 등)을 확인해 주세요."
    } else if has("Authentication failed")
        || has("could not read Username")
        || has("terminal prompts disabled")
        || has("Permission denied")
        || has("403")
    {
        "GitHub 로그인이 필요하거나 이 저장소에 올릴 권한이 없어요. 로그인 창이 떴다면 로그인한 뒤 다시 시도해 주세요."
    } else if has("Could not resolve host") || has("unable to access") || has("Connection timed out") {
        "온라인 저장소에 연결하지 못했어요. 인터넷 연결을 확인해 주세요."
    } else if has("does not appear to be a git repository") || has("Repository not found") {
        "온라인 저장소를 찾을 수 없어요. 저장소 주소나 접근 권한을 확인해 주세요."
    } else {
        return format!("올리지 못했어요.\n{e}");
    };
    msg.to_string()
}

/* ---------- 받아오기 (fetch / pull) ---------- */

/// 온라인 저장소의 최신 기록을 내려받기만 한다 (내 파일은 건드리지 않음).
/// interactive 가 false 면 로그인 창을 띄우지 않는다 — 자동 확인용. 로그인이 필요하면 조용히 실패한다.
pub fn fetch(path: &str, interactive: bool) -> Result<(), String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);
    if run_git(root_path, ["remote"])?.trim().is_empty() {
        return Ok(()); // 연결된 온라인 저장소가 없으면 할 일이 없다
    }
    let envs: &[(&str, &str)] = if interactive { &[] } else { &[("GCM_INTERACTIVE", "never")] };
    // --prune : 온라인에서 지워진 갈래는 내 쪽 목록에서도 지운다
    run_git_env(root_path, ["fetch", "--prune", "--quiet"], envs).map_err(friendly_push_error)?;
    Ok(())
}

/// 온라인에는 있지만 아직 받지 않은 저장 지점들 (최신이 앞). 마지막 fetch 기준.
pub fn incoming(path: &str) -> Result<Vec<CommitWithFiles>, String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);
    if !has_upstream(root_path) {
        return Ok(Vec::new());
    }
    commits_with_files(root_path, &["HEAD..@{u}"])
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    /// "upToDate" 이미 최신 / "fastForward" 그대로 받음 / "merged" 합침 / "conflict" 충돌로 취소
    pub kind: String,
    /// 받아온 저장 지점 수
    pub count: u32,
    /// 충돌 난 파일들 (kind 가 "conflict" 일 때)
    pub conflicts: Vec<String>,
}

fn count(root_path: &Path, range: &str) -> Result<u32, String> {
    Ok(run_git(root_path, ["rev-list", "--count", range])?.trim().parse().unwrap_or(0))
}

/// 온라인의 최신 내용을 받아와 내 갈래에 반영한다.
/// 충돌이 나면 받아오기를 취소하고 원래 상태로 되돌린다 — 저장소를 어중간한 상태로 두지 않는다.
pub fn pull(path: &str) -> Result<PullResult, String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);

    run_git(root_path, ["symbolic-ref", "--short", "-q", "HEAD"])
        .map_err(|_| "지금은 갈래가 아닌 곳(특정 저장 지점)에 있어서 받아올 수 없어요.".to_string())?;
    if !has_upstream(root_path) {
        return Err("이 갈래는 온라인 갈래와 연결되어 있지 않아서 받아올 곳이 없어요. 먼저 ‘올리기’로 연결해 주세요.".into());
    }

    fetch(&root, true)?;

    let incoming = count(root_path, "HEAD..@{u}")?;
    if incoming == 0 {
        return Ok(PullResult { kind: "upToDate".into(), count: 0, conflicts: vec![] });
    }
    let local_ahead = count(root_path, "@{u}..HEAD")?;

    if local_ahead == 0 {
        // 내 쪽에 새 저장 지점이 없으면 온라인 것을 그대로 따라간다 (가장 안전한 경우)
        run_git(root_path, ["merge", "--ff-only", "@{u}"]).map_err(friendly_pull_error)?;
        return Ok(PullResult { kind: "fastForward".into(), count: incoming, conflicts: vec![] });
    }

    // 양쪽 모두 새 저장 지점이 있으면 합친다
    match run_git(root_path, ["merge", "--no-edit", "@{u}"]) {
        Ok(_) => Ok(PullResult { kind: "merged".into(), count: incoming, conflicts: vec![] }),
        Err(e) => {
            // 충돌 난 파일 목록 (--diff-filter=U : 합치지 못한 파일)
            let conflicts: Vec<String> = run_git(root_path, ["diff", "--name-only", "--diff-filter=U"])
                .unwrap_or_default()
                .lines()
                .map(String::from)
                .collect();
            if conflicts.is_empty() {
                // 충돌이 아니라 시작 전에 멈춘 경우(저장 안 한 변경과 겹침 등). git 이 아무것도 바꾸지 않았다
                return Err(friendly_pull_error(e));
            }
            // 합치다 만 상태를 취소하고 받아오기 전으로 되돌린다
            run_git(root_path, ["merge", "--abort"])
                .map_err(|e| format!("충돌이 나서 되돌리려 했지만 실패했어요.\n{e}"))?;
            Ok(PullResult { kind: "conflict".into(), count: incoming, conflicts })
        }
    }
}

fn friendly_pull_error(e: String) -> String {
    if e.contains("would be overwritten") {
        // git 이 알려준 겹치는 파일 이름들 (탭으로 시작하는 줄)
        let files: Vec<&str> = e.lines().filter(|l| l.starts_with('\t')).map(str::trim).collect();
        let list = if files.is_empty() { String::new() } else { format!("\n{}", files.join("\n")) };
        format!(
            "저장하지 않은 내 변경이 있는 파일을 온라인에서도 바꿨어요. 먼저 커밋한 뒤 다시 받아와 주세요. (아무것도 바뀌지 않았어요){list}"
        )
    } else if e.contains("Please tell me who you are") {
        friendly_commit_error(e)
    } else {
        format!("받아오지 못했어요.\n{e}")
    }
}

/* ---------- 저장 지점 하나의 변경 요약 ---------- */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    /// 추가된 줄 수. 이미지 같은 바이너리 파일이면 None
    pub added: Option<u32>,
    /// 지워진 줄 수. 바이너리 파일이면 None
    pub deleted: Option<u32>,
}

/// 저장 지점 하나에서 바뀐 파일과 줄 수.
/// 합친(merge) 저장 지점은 첫 부모와 비교한다 = "이 합치기로 들어온 변경"
pub fn commit_stats(path: &str, hash: &str) -> Result<Vec<FileStat>, String> {
    // 해시는 16진수 글자만 허용 (다른 옵션이 끼어들지 못하게)
    if hash.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("잘못된 저장 지점이에요.".into());
    }
    let root = repo_root(path)?;
    // --numstat : "추가<TAB>삭제<TAB>파일" 형식. -m --first-parent : merge 는 첫 부모와 비교
    let raw = run_git(
        Path::new(&root),
        ["show", "--numstat", "--format=", "-m", "--first-parent", hash],
    )?;
    Ok(parse_numstat(&raw))
}

fn parse_numstat(raw: &str) -> Vec<FileStat> {
    raw.lines()
        .filter_map(|line| {
            let mut cols = line.splitn(3, '\t');
            // ? : 칸이 모자라면 이 줄은 None 으로 건너뛴다
            let added = cols.next()?;
            let deleted = cols.next()?;
            let file = cols.next()?;
            Some(FileStat {
                path: file.to_string(),
                added: added.parse().ok(), // 바이너리는 "-" 라서 parse 실패 → None
                deleted: deleted.parse().ok(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty() -> RepoStatus {
        RepoStatus {
            root: String::new(),
            name: String::new(),
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            no_commits: false,
            remotes: vec![],
            files: vec![],
        }
    }

    #[test]
    fn branch_with_upstream_and_counts() {
        let mut st = empty();
        parse_branch_line("## main...origin/main [ahead 2, behind 1]", &mut st);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!((st.ahead, st.behind), (2, 1));
    }

    #[test]
    fn new_repo_without_commits() {
        let mut st = empty();
        parse_branch_line("## No commits yet on main", &mut st);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert!(st.no_commits);
    }

    #[test]
    fn reads_this_repository() {
        // src-tauri 폴더에서 시작해도 저장소 맨 위(Git_hani)를 찾아야 한다
        let st = status(env!("CARGO_MANIFEST_DIR")).expect("git status 실패");
        assert_eq!(st.name, "Git_hani");
        assert!(st.branch.is_some());
    }

    #[test]
    fn rejects_non_repository() {
        let err = status(&std::env::temp_dir().to_string_lossy()).unwrap_err();
        assert!(err.contains("Git 저장소가 아니에요"));
    }

    /// 테스트용 임시 저장소를 만든다. 이름이 겹치지 않게 시각을 붙인다.
    fn temp_repo(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("git-hani-test-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        run_git(&dir, ["init", "-q", "-b", "main"]).unwrap();
        run_git(&dir, ["config", "user.name", "tester"]).unwrap();
        run_git(&dir, ["config", "user.email", "tester@example.com"]).unwrap();
        dir
    }

    fn write(dir: &Path, name: &str, body: &str) {
        std::fs::write(dir.join(name), body).unwrap();
    }

    fn changed(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = status(&dir.to_string_lossy())
            .unwrap()
            .files
            .into_iter()
            .map(|f| f.path)
            .collect();
        v.sort();
        v
    }

    #[test]
    fn first_commit_with_only_chosen_files() {
        let dir = temp_repo("first");
        write(&dir, "a.txt", "a");
        write(&dir, "한글.txt", "b");
        write(&dir, ".env", "KEY=secret");

        let p = dir.to_string_lossy().into_owned();
        commit(&p, &["a.txt".into(), "한글.txt".into()], "첫 저장", None).unwrap();

        // .env 는 고르지 않았으니 그대로 남아 있어야 한다
        assert_eq!(changed(&dir), vec![".env".to_string()]);
        let log = history(&p, None).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].subject, "첫 저장");
        assert!(log[0].refs.iter().any(|r| r == "HEAD -> refs/heads/main"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn commit_does_not_include_other_staged_files() {
        let dir = temp_repo("partial");
        write(&dir, "a.txt", "1");
        write(&dir, "b.txt", "1");
        write(&dir, "c.txt", "1");
        let p = dir.to_string_lossy().into_owned();
        commit(&p, &["a.txt".into(), "b.txt".into(), "c.txt".into()], "init", None).unwrap();

        write(&dir, "a.txt", "2"); // 수정
        std::fs::remove_file(dir.join("b.txt")).unwrap(); // 삭제
        write(&dir, "c.txt", "2");
        run_git(&dir, ["add", "c.txt"]).unwrap(); // 다른 곳에서 미리 stage 해 둔 파일

        commit(&p, &["a.txt".into(), "b.txt".into()], "a 수정, b 삭제", Some("설명")).unwrap();

        // c.txt 는 stage 돼 있었어도 이번 커밋에 들어가면 안 된다
        assert_eq!(changed(&dir), vec!["c.txt".to_string()]);
        let log = history(&p, None).unwrap();
        assert_eq!(log[0].subject, "a 수정, b 삭제");
        assert_eq!(log[0].parents, vec![log[1].hash.clone()]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn commit_needs_message_and_files() {
        let dir = temp_repo("empty");
        let p = dir.to_string_lossy().into_owned();
        assert!(commit(&p, &["a".into()], "  ", None).is_err());
        assert!(commit(&p, &[], "msg", None).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn log_of_new_repo_is_empty() {
        let dir = temp_repo("nolog");
        assert!(history(&dir.to_string_lossy(), None).unwrap().is_empty());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn parse_log_handles_merge_and_refs() {
        let raw = "h2\x1fs2\x1fp1 p0\x1fme\x1f100\x1fHEAD -> main, origin/main, tag: v1\x1fMerge branch 'x'\x1e\n\
                   h1\x1fs1\x1f\x1fme\x1f50\x1f\x1finit\x1e";
        let v = parse_log(raw);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].parents, vec!["p1", "p0"]);
        assert_eq!(v[0].refs, vec!["HEAD -> main", "origin/main", "tag: v1"]);
        assert!(v[1].parents.is_empty() && v[1].refs.is_empty());
    }

    /// 온라인 저장소 역할을 할 bare 저장소와, 그것에 연결된 작업 저장소를 만든다
    fn repo_with_remote(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let work = temp_repo(tag);
        let bare = work.with_extension("remote.git");
        run_git(&work, ["init", "-q", "--bare", "-b", "main", bare.to_str().unwrap()]).unwrap();
        run_git(&work, ["remote", "add", "origin", bare.to_str().unwrap()]).unwrap();
        (work, bare)
    }

    fn save(dir: &Path, name: &str, msg: &str) {
        write(dir, name, msg);
        commit(&dir.to_string_lossy(), &[name.to_string()], msg, None).unwrap();
    }

    #[test]
    fn first_push_creates_remote_branch() {
        let (work, bare) = repo_with_remote("push-first");
        let p = work.to_string_lossy().into_owned();
        save(&work, "a.txt", "첫 저장");
        assert_eq!(unpushed(&p).unwrap().len(), 1);

        let r = push(&p, None).unwrap();
        assert!(r.created);
        assert_eq!((r.remote.as_str(), r.branch.as_str()), ("origin", "main"));
        let st = status(&p).unwrap();
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!(st.ahead, 0);
        assert!(unpushed(&p).unwrap().is_empty());
        std::fs::remove_dir_all(work).ok();
        std::fs::remove_dir_all(bare).ok();
    }

    #[test]
    fn push_up_to_a_commit() {
        let (work, bare) = repo_with_remote("push-partial");
        let p = work.to_string_lossy().into_owned();
        save(&work, "a.txt", "1");
        push(&p, None).unwrap();
        save(&work, "b.txt", "2");
        save(&work, ".env", "3");

        let list = unpushed(&p).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].files, vec![".env".to_string()]); // 최신이 앞
        let older = list[1].info.hash.clone();

        push(&p, Some(&older)).unwrap(); // 오래된 것 하나만
        let left = unpushed(&p).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].info.subject, "3");
        std::fs::remove_dir_all(work).ok();
        std::fs::remove_dir_all(bare).ok();
    }

    #[test]
    fn push_rejected_when_remote_has_new_commits() {
        let (work, bare) = repo_with_remote("push-reject");
        let p = work.to_string_lossy().into_owned();
        save(&work, "a.txt", "1");
        push(&p, None).unwrap();

        // 다른 사람이 먼저 올린 상황
        let other = work.with_extension("other");
        run_git(&work, ["clone", "-q", bare.to_str().unwrap(), other.to_str().unwrap()]).unwrap();
        run_git(&other, ["config", "user.name", "other"]).unwrap();
        run_git(&other, ["config", "user.email", "other@example.com"]).unwrap();
        save(&other, "b.txt", "다른 사람");
        run_git(&other, ["push", "-q"]).unwrap();

        save(&work, "c.txt", "내 저장");
        let err = push(&p, None).unwrap_err();
        assert!(err.contains("받아와야"), "{err}");
        for d in [work, bare, other] {
            std::fs::remove_dir_all(d).ok();
        }
    }

    #[test]
    fn push_without_remote_explains() {
        let dir = temp_repo("push-noremote");
        let p = dir.to_string_lossy().into_owned();
        save(&dir, "a.txt", "1");
        assert!(push(&p, None).unwrap_err().contains("연결되어 있지 않아요"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn stats_of_a_commit() {
        let dir = temp_repo("stats");
        write(&dir, "a.txt", "1\n2\n3\n");
        let p = dir.to_string_lossy().into_owned();
        commit(&p, &["a.txt".into()], "세 줄", None).unwrap();
        write(&dir, "a.txt", "1\n둘\n3\n4\n");
        let c = commit(&p, &["a.txt".into()], "수정", None).unwrap();

        let stats = commit_stats(&p, &c.hash).unwrap();
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].path, "a.txt");
        assert_eq!((stats[0].added, stats[0].deleted), (Some(2), Some(1)));
        assert!(commit_stats(&p, "--all").is_err()); // 옵션처럼 생긴 값은 거절
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn numstat_binary_file() {
        let v = parse_numstat("-\t-\tlogo.png\n3\t0\tREADME.md\n");
        assert_eq!(v[0].added, None);
        assert_eq!(v[1].added, Some(3));
    }

    /// 같은 온라인 저장소에 연결된 두 번째 작업 저장소 (팀원 역할)
    fn teammate(work: &Path, bare: &Path) -> std::path::PathBuf {
        let other = work.with_extension("mate");
        run_git(work, ["clone", "-q", bare.to_str().unwrap(), other.to_str().unwrap()]).unwrap();
        run_git(&other, ["config", "user.name", "mate"]).unwrap();
        run_git(&other, ["config", "user.email", "mate@example.com"]).unwrap();
        other
    }

    fn cleanup(dirs: &[&Path]) {
        for d in dirs {
            std::fs::remove_dir_all(d).ok();
        }
    }

    fn merging(dir: &Path) -> bool {
        dir.join(".git").join("MERGE_HEAD").exists()
    }

    #[test]
    fn pull_fast_forward_and_up_to_date() {
        let (work, bare) = repo_with_remote("pull-ff");
        let p = work.to_string_lossy().into_owned();
        save(&work, "a.txt", "1");
        push(&p, None).unwrap();
        let mate = teammate(&work, &bare);
        save(&mate, "b.txt", "팀원 작업");
        run_git(&mate, ["push", "-q"]).unwrap();

        fetch(&p, false).unwrap();
        let inc = incoming(&p).unwrap();
        assert_eq!(inc.len(), 1);
        assert_eq!(inc[0].info.author, "mate");

        let r = pull(&p).unwrap();
        assert_eq!((r.kind.as_str(), r.count), ("fastForward", 1));
        assert!(work.join("b.txt").exists());
        assert_eq!(pull(&p).unwrap().kind, "upToDate");
        cleanup(&[&work, &bare, &mate]);
    }

    #[test]
    fn pull_merges_when_both_sides_changed() {
        let (work, bare) = repo_with_remote("pull-merge");
        let p = work.to_string_lossy().into_owned();
        save(&work, "a.txt", "1");
        push(&p, None).unwrap();
        let mate = teammate(&work, &bare);
        save(&mate, "b.txt", "팀원");
        run_git(&mate, ["push", "-q"]).unwrap();
        save(&work, "c.txt", "나");

        let r = pull(&p).unwrap();
        assert_eq!(r.kind, "merged");
        assert!(work.join("b.txt").exists() && work.join("c.txt").exists());
        // 이제 올릴 수 있어야 한다 (내 저장 지점 + 합친 저장 지점)
        assert_eq!(unpushed(&p).unwrap().len(), 2);
        push(&p, None).unwrap();
        cleanup(&[&work, &bare, &mate]);
    }

    #[test]
    fn pull_conflict_is_rolled_back() {
        let (work, bare) = repo_with_remote("pull-conflict");
        let p = work.to_string_lossy().into_owned();
        save(&work, "a.txt", "처음");
        push(&p, None).unwrap();
        let mate = teammate(&work, &bare);
        save(&mate, "a.txt", "팀원이 바꾼 줄");
        run_git(&mate, ["push", "-q"]).unwrap();
        save(&work, "a.txt", "내가 바꾼 줄");
        let before = run_git(&work, ["rev-parse", "HEAD"]).unwrap();

        let r = pull(&p).unwrap();
        assert_eq!(r.kind, "conflict");
        assert_eq!(r.conflicts, vec!["a.txt".to_string()]);
        // 원래 상태 그대로: 합치는 중이 아니고, 저장 지점·파일 내용도 그대로
        assert!(!merging(&work));
        assert_eq!(run_git(&work, ["rev-parse", "HEAD"]).unwrap(), before);
        assert_eq!(std::fs::read_to_string(work.join("a.txt")).unwrap(), "내가 바꾼 줄");
        cleanup(&[&work, &bare, &mate]);
    }

    #[test]
    fn pull_stops_when_uncommitted_changes_overlap() {
        let (work, bare) = repo_with_remote("pull-dirty");
        let p = work.to_string_lossy().into_owned();
        save(&work, "a.txt", "처음");
        push(&p, None).unwrap();
        let mate = teammate(&work, &bare);
        save(&mate, "a.txt", "팀원");
        run_git(&mate, ["push", "-q"]).unwrap();
        write(&work, "a.txt", "저장 안 한 내 변경");

        let err = pull(&p).unwrap_err();
        assert!(err.contains("먼저 커밋"), "{err}");
        assert!(err.contains("a.txt"), "{err}");
        assert_eq!(std::fs::read_to_string(work.join("a.txt")).unwrap(), "저장 안 한 내 변경");
        cleanup(&[&work, &bare, &mate]);
    }

    #[test]
    fn pull_without_upstream_explains() {
        let (work, bare) = repo_with_remote("pull-noup");
        let p = work.to_string_lossy().into_owned();
        save(&work, "a.txt", "1");
        assert!(pull(&p).unwrap_err().contains("연결되어 있지 않아서"));
        cleanup(&[&work, &bare]);
    }

    #[test]
    fn status_codes() {
        assert_eq!(simplify("??"), "A");
        assert_eq!(simplify(" M"), "M");
        assert_eq!(simplify("D "), "D");
        assert_eq!(simplify("R "), "R");
        assert_eq!(simplify("UU"), "U");
    }
}
