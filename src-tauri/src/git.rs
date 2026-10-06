// 실제 Git 저장소를 읽는 명령들.
// 앱에 내장된 git 이 아니라 지금은 PC에 설치된 git CLI 를 실행한다.

use serde::Serialize;
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
fn run_git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
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

/// React 에서 `invoke("git_status", { path })` 로 부르는 명령.
/// path 는 사용자가 고른 폴더(저장소 안의 하위 폴더여도 된다).
#[tauri::command]
pub fn git_status(path: String) -> Result<RepoStatus, String> {
    let dir = Path::new(&path);

    // 저장소의 맨 위 폴더를 찾는다. Git 저장소가 아니면 여기서 실패한다.
    let root = run_git(dir, &["rev-parse", "--show-toplevel"])
        .map_err(|_| "이 폴더는 Git 저장소가 아니에요. Git 으로 관리 중인 프로젝트 폴더를 골라 주세요.".to_string())?
        .trim()
        .to_string();
    let root_path = Path::new(&root);

    // -z : 파일 이름을 NUL 문자로 구분해서, 공백·특수문자가 있어도 안전하게 나눌 수 있다.
    let raw = run_git(
        root_path,
        &["status", "--porcelain=v1", "--branch", "-z", "--untracked-files=all"],
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
        // 이름이 바뀐(R) / 복사된(C) 항목은 바로 다음 칸에 원래 이름이 온다. 건너뛴다.
        if code.starts_with('R') || code.starts_with('C') {
            entries.next();
        }
        let x = code.chars().next().unwrap_or(' ');
        st.files.push(FileChange {
            path: file_path,
            status: simplify(code).to_string(),
            code: code.to_string(),
            staged: x != ' ' && x != '?',
        });
    }

    Ok(st)
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

    #[test]
    fn status_codes() {
        assert_eq!(simplify("??"), "A");
        assert_eq!(simplify(" M"), "M");
        assert_eq!(simplify("D "), "D");
        assert_eq!(simplify("R "), "R");
        assert_eq!(simplify("UU"), "U");
    }
}
