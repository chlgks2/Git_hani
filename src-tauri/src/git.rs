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
    let mut cmd = Command::new("git");
    // 영어 메시지로 고정해서, 에러 문구를 안정적으로 알아볼 수 있게 한다
    cmd.env("LC_ALL", "C");
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

/// React 에서 `invoke("git_status", { path })` 로 부르는 명령.
/// path 는 사용자가 고른 폴더(저장소 안의 하위 폴더여도 된다).
#[tauri::command]
pub fn git_status(path: String) -> Result<RepoStatus, String> {
    let root = repo_root(&path)?;
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
#[tauri::command]
pub fn git_log(path: String, limit: Option<u32>) -> Result<Vec<CommitInfo>, String> {
    let root = repo_root(&path)?;
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
#[tauri::command]
pub fn git_commit(
    path: String,
    files: Vec<String>,
    message: String,
    description: Option<String>,
) -> Result<CommitResult, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("저장 메시지를 적어 주세요.".into());
    }
    if files.is_empty() {
        return Err("저장할 파일을 하나 이상 골라 주세요.".into());
    }
    let root = repo_root(&path)?;
    let root_path = Path::new(&root);

    // 1) 고른 파일을 stage 한다. -A : 새 파일 추가, 수정, 삭제를 모두 반영
    //    "--" 뒤는 전부 파일 이름으로 취급 (파일 이름이 "-" 로 시작해도 옵션으로 오해하지 않게)
    let mut add: Vec<&str> = vec!["add", "-A", "--"];
    add.extend(files.iter().map(String::as_str));
    run_git(root_path, add)?;

    // 2) 그 파일들만 커밋한다. 파일 이름을 주면 git 은 그 파일만 담는다(--only 동작).
    let mut commit: Vec<&str> = vec!["commit", "-m", message];
    let desc = description.as_deref().map(str::trim).unwrap_or("");
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
        let st = git_status(env!("CARGO_MANIFEST_DIR").to_string()).expect("git status 실패");
        assert_eq!(st.name, "Git_hani");
        assert!(st.branch.is_some());
    }

    #[test]
    fn rejects_non_repository() {
        let err = git_status(std::env::temp_dir().to_string_lossy().into_owned()).unwrap_err();
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
        let mut v: Vec<String> = git_status(dir.to_string_lossy().into_owned())
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
        git_commit(p.clone(), vec!["a.txt".into(), "한글.txt".into()], "첫 저장".into(), None).unwrap();

        // .env 는 고르지 않았으니 그대로 남아 있어야 한다
        assert_eq!(changed(&dir), vec![".env".to_string()]);
        let log = git_log(p, None).unwrap();
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
        git_commit(p.clone(), vec!["a.txt".into(), "b.txt".into(), "c.txt".into()], "init".into(), None).unwrap();

        write(&dir, "a.txt", "2"); // 수정
        std::fs::remove_file(dir.join("b.txt")).unwrap(); // 삭제
        write(&dir, "c.txt", "2");
        run_git(&dir, ["add", "c.txt"]).unwrap(); // 다른 곳에서 미리 stage 해 둔 파일

        git_commit(p.clone(), vec!["a.txt".into(), "b.txt".into()], "a 수정, b 삭제".into(), Some("설명".into())).unwrap();

        // c.txt 는 stage 돼 있었어도 이번 커밋에 들어가면 안 된다
        assert_eq!(changed(&dir), vec!["c.txt".to_string()]);
        let log = git_log(p, None).unwrap();
        assert_eq!(log[0].subject, "a 수정, b 삭제");
        assert_eq!(log[0].parents, vec![log[1].hash.clone()]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn commit_needs_message_and_files() {
        let dir = temp_repo("empty");
        let p = dir.to_string_lossy().into_owned();
        assert!(git_commit(p.clone(), vec!["a".into()], "  ".into(), None).is_err());
        assert!(git_commit(p, vec![], "msg".into(), None).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn log_of_new_repo_is_empty() {
        let dir = temp_repo("nolog");
        assert!(git_log(dir.to_string_lossy().into_owned(), None).unwrap().is_empty());
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

    #[test]
    fn status_codes() {
        assert_eq!(simplify("??"), "A");
        assert_eq!(simplify(" M"), "M");
        assert_eq!(simplify("D "), "D");
        assert_eq!(simplify("R "), "R");
        assert_eq!(simplify("UU"), "U");
    }
}
