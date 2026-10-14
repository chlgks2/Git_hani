// 처음 쓰는 사람이 막히지 않게 하는 명령들:
// 이름·이메일 설정, Git 시작하기, GitHub 에서 가져오기, 온라인 저장소 연결, 무시 목록(.gitignore) 도우미

use crate::git::{friendly_push_error, repo_root, run_git};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/* ---------- 이름·이메일 ---------- */

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// 사용자 폴더 (전체 설정을 읽고 쓸 때 기준 위치)
fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 저장 지점에 기록될 이름과 이메일. path 를 주면 그 저장소 기준(저장소 설정 > 전체 설정)으로 읽는다.
pub fn identity(path: Option<&str>) -> Result<Identity, String> {
    let (dir, scope): (PathBuf, &[&str]) = match path {
        Some(p) => (PathBuf::from(repo_root(p)?), &[]),
        None => (home_dir(), &["--global"]),
    };
    // 설정이 없으면 git 이 실패(종료 코드 1)하므로 None 으로 바꾼다
    let get = |key: &str| {
        let mut args = vec!["config"];
        args.extend_from_slice(scope);
        args.push(key);
        run_git(&dir, args).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
    };
    Ok(Identity { name: get("user.name"), email: get("user.email") })
}

fn validate_identity(name: &str, email: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > 100 {
        return Err("이름을 1~100자로 적어 주세요.".into());
    }
    let email = email.trim();
    let valid = email
        .split_once('@')
        .is_some_and(|(user, domain)| !user.is_empty() && domain.contains('.') && !domain.starts_with('.'))
        && !email.contains(char::is_whitespace);
    if !valid {
        return Err("이메일 형식을 확인해 주세요. (예: me@example.com)".into());
    }
    Ok(())
}

/// 이름과 이메일을 설정한다. repo 를 주면 그 저장소에만, 없으면 이 컴퓨터 전체(--global)에 적용한다.
pub fn set_identity(repo: Option<&str>, name: &str, email: &str) -> Result<(), String> {
    validate_identity(name, email)?;
    let (dir, scope) = match repo {
        Some(p) => (PathBuf::from(repo_root(p)?), "--local"),
        None => (home_dir(), "--global"),
    };
    run_git(&dir, ["config", scope, "user.name", name.trim()])?;
    run_git(&dir, ["config", scope, "user.email", email.trim()])?;
    Ok(())
}

/* ---------- Git 시작하기 ---------- */

/// 새로 시작하는 프로젝트에 넣어 주는 기본 무시 목록
pub const DEFAULT_GITIGNORE: &str = "# 저장(커밋)하지 않을 파일 목록 — Git GUI 가 만든 기본값\n\
# 비밀 정보\n.env\n.env.*\n!.env.example\n\n\
# 설치한 라이브러리 (다시 설치할 수 있음)\nnode_modules/\n.venv/\nvenv/\n__pycache__/\n\n\
# 빌드 결과물\ndist/\nbuild/\n.next/\n\n\
# 운영체제·편집기가 만드는 파일\n.DS_Store\nThumbs.db\n.vscode/\n.idea/\n\n\
# 로그\n*.log\n";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitResult {
    pub root: String,
    /// 기본 .gitignore 를 새로 만들었는지 (이미 있으면 건드리지 않음)
    pub gitignore_created: bool,
}

/// 폴더에서 Git 을 시작한다 (git init). 첫 갈래 이름은 main.
pub fn init_repo(path: &str) -> Result<InitResult, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err("폴더를 찾을 수 없어요.".into());
    }
    if let Ok(root) = repo_root(path) {
        return Err(format!("이미 Git 으로 관리 중인 폴더예요. ({root})"));
    }
    // -b main 은 git 2.28 이상. 오래된 git 이면 만든 뒤 갈래 이름만 바꾼다
    if run_git(dir, ["init", "-q", "-b", "main"]).is_err() {
        run_git(dir, ["init", "-q"])?;
        run_git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"])?;
    }
    let ignore = dir.join(".gitignore");
    let gitignore_created = !ignore.exists();
    if gitignore_created {
        std::fs::write(&ignore, DEFAULT_GITIGNORE).map_err(|e| format!(".gitignore 를 만들지 못했어요. ({e})"))?;
    }
    Ok(InitResult { root: repo_root(path)?, gitignore_created })
}

/* ---------- GitHub 에서 가져오기 / 온라인 저장소 연결 ---------- */

/// 온라인 저장소 주소인지 확인한다. https://… 또는 git@…(SSH) 만 받는다.
pub fn validate_remote_url(url: &str) -> Result<&str, String> {
    let url = url.trim();
    let ok = (url.starts_with("https://") || url.starts_with("git@") || url.starts_with("ssh://"))
        && !url.contains(char::is_whitespace)
        && url.len() <= 500;
    if !ok {
        return Err("저장소 주소를 확인해 주세요. (예: https://github.com/아이디/저장소이름.git)".into());
    }
    Ok(url)
}

/// 주소에서 폴더 이름을 뽑는다. "https://github.com/me/my-site.git" → "my-site"
fn folder_name(url: &str) -> Option<String> {
    let last = url.trim_end_matches('/').rsplit(['/', ':']).next()?;
    let name = last.strip_suffix(".git").unwrap_or(last);
    let safe: String = name.chars().filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')).collect();
    (!safe.is_empty() && safe != "." && safe != "..").then_some(safe)
}

/// parent 폴더 안에 저장소를 받아온다. 받은 폴더 경로를 돌려준다. (주소 검사는 clone_repo 에서)
fn clone_into(url: &str, parent: &str) -> Result<String, String> {
    let parent = Path::new(parent);
    if !parent.is_dir() {
        return Err("받을 위치(폴더)를 찾을 수 없어요.".into());
    }
    let name = folder_name(url).ok_or("주소에서 저장소 이름을 알 수 없어요.")?;
    let dest = parent.join(&name);
    if dest.exists() && dest.read_dir().map(|mut d| d.next().is_some()).unwrap_or(true) {
        return Err(format!("같은 이름의 폴더가 이미 있어요: {}", dest.display()));
    }
    // "--" 뒤는 주소와 폴더 이름. 주소가 "-" 로 시작해도 옵션으로 오해하지 않는다
    run_git(parent, ["clone", "-q", "--", url, name.as_str()]).map_err(friendly_push_error)?;
    Ok(dest.to_string_lossy().into_owned())
}

/// GitHub 등에서 저장소를 받아온다 (git clone)
pub fn clone_repo(url: &str, parent: &str) -> Result<String, String> {
    clone_into(validate_remote_url(url)?, parent)
}

/// 이 저장소를 온라인 저장소(origin)와 연결한다. 이미 연결돼 있으면 주소를 바꾼다.
pub fn set_remote(path: &str, url: &str) -> Result<(), String> {
    let url = validate_remote_url(url)?;
    let root = repo_root(path)?;
    let root_path = Path::new(&root);
    let has_origin = run_git(root_path, ["remote"])?.lines().any(|r| r == "origin");
    if has_origin {
        run_git(root_path, ["remote", "set-url", "origin", url])?;
    } else {
        run_git(root_path, ["remote", "add", "origin", url])?;
    }
    Ok(())
}

/* ---------- 무시 목록(.gitignore) 도우미 ---------- */

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IgnoreSuggestion {
    /// .gitignore 에 넣을 줄 (예: "node_modules/")
    pub pattern: String,
    /// 왜 저장하지 않는 게 좋은지
    pub reason: String,
    /// 해당하는 새 파일 수
    pub count: usize,
    /// 해당 파일들의 크기 합 (바이트)
    pub size: u64,
}

/// 보통 저장하지 않는 폴더 이름과 이유
const HEAVY_DIRS: &[(&str, &str)] = &[
    ("node_modules", "설치한 라이브러리 폴더예요. npm install 로 다시 만들 수 있어요"),
    (".venv", "파이썬 가상환경이에요. 다시 만들 수 있어요"),
    ("venv", "파이썬 가상환경이에요. 다시 만들 수 있어요"),
    ("__pycache__", "파이썬이 자동으로 만드는 파일이에요"),
    (".next", "Next.js 가 만든 빌드 결과물이에요"),
    ("dist", "빌드 결과물이에요. 빌드하면 다시 만들어져요"),
    ("build", "빌드 결과물이에요. 빌드하면 다시 만들어져요"),
];

/// 보통 저장하지 않는 파일 이름과 이유
const JUNK_FILES: &[(&str, &str)] = &[
    (".DS_Store", "Mac 이 자동으로 만드는 파일이에요"),
    ("Thumbs.db", "Windows 가 자동으로 만드는 파일이에요"),
];

/// 새 파일(아직 git 이 모르는 파일) 중에서 보통 저장하지 않는 것들을 묶어서 알려준다
pub fn ignore_suggestions(path: &str) -> Result<Vec<IgnoreSuggestion>, String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);
    let raw = run_git(root_path, ["ls-files", "--others", "--exclude-standard", "-z"])?;
    let rust_project = root_path.join("Cargo.toml").exists();

    // pattern → (이유, 개수, 크기). BTreeMap 은 이름 순으로 정렬돼 결과가 항상 같은 순서
    let mut found: BTreeMap<String, (String, usize, u64)> = BTreeMap::new();
    for file in raw.split('\0').filter(|f| !f.is_empty()) {
        let parts: Vec<&str> = file.split('/').collect();
        let file_name = parts.last().copied().unwrap_or("");
        let dirs = &parts[..parts.len().saturating_sub(1)];

        let hit = HEAVY_DIRS
            .iter()
            .find(|(d, _)| dirs.contains(d))
            .map(|(d, why)| (format!("{d}/"), *why))
            .or_else(|| (rust_project && dirs.first() == Some(&"target")).then_some(("target/".to_string(), "Rust 빌드 결과물이에요")))
            .or_else(|| JUNK_FILES.iter().find(|(n, _)| *n == file_name).map(|(n, why)| (n.to_string(), *why)))
            .or_else(|| file_name.ends_with(".log").then_some(("*.log".to_string(), "프로그램이 남기는 기록 파일이에요")));

        if let Some((pattern, why)) = hit {
            let size = std::fs::metadata(root_path.join(file)).map(|m| m.len()).unwrap_or(0);
            let entry = found.entry(pattern).or_insert((why.to_string(), 0, 0));
            entry.1 += 1;
            entry.2 += size;
        }
    }
    Ok(found
        .into_iter()
        .map(|(pattern, (reason, count, size))| IgnoreSuggestion { pattern, reason, count, size })
        .collect())
}

/// .gitignore 에 줄을 추가한다 (이미 있는 줄은 건너뜀). 추가한 개수를 돌려준다.
pub fn add_to_gitignore(path: &str, patterns: &[String]) -> Result<usize, String> {
    let root = repo_root(path)?;
    let file = Path::new(&root).join(".gitignore");
    let mut text = std::fs::read_to_string(&file).unwrap_or_default();
    let existing: Vec<String> = text.lines().map(|l| l.trim().to_string()).collect();
    let mut added = 0;
    for p in patterns {
        let p = p.trim();
        if p.is_empty() || p.len() > 200 || p.contains(['\n', '\r']) {
            return Err(format!("무시 목록에 넣을 수 없는 값이에요: {p}"));
        }
        if existing.iter().any(|l| l == p) {
            continue;
        }
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(p);
        text.push('\n');
        added += 1;
    }
    if added > 0 {
        std::fs::write(&file, text).map_err(|e| format!(".gitignore 를 저장하지 못했어요. ({e})"))?;
    }
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::status;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("git-hani-setup-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn identity_in_one_repo() {
        let dir = temp_dir("id");
        let p = dir.to_string_lossy().into_owned();
        init_repo(&p).unwrap();
        // 저장소에만 적용 (테스트가 이 컴퓨터 전체 설정을 바꾸면 안 된다)
        set_identity(Some(&p), "최한", "me@example.com").unwrap();
        let id = identity(Some(&p)).unwrap();
        assert_eq!(id, Identity { name: Some("최한".into()), email: Some("me@example.com".into()) });
        assert!(set_identity(Some(&p), " ", "me@example.com").is_err());
        assert!(set_identity(Some(&p), "최한", "이메일아님").is_err());
        assert!(set_identity(Some(&p), "최한", "a@b").is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn init_creates_main_and_gitignore() {
        let dir = temp_dir("init");
        let p = dir.to_string_lossy().into_owned();
        let r = init_repo(&p).unwrap();
        assert!(r.gitignore_created);
        assert!(std::fs::read_to_string(dir.join(".gitignore")).unwrap().contains("node_modules/"));
        assert_eq!(run_git(&dir, ["symbolic-ref", "--short", "HEAD"]).unwrap().trim(), "main");
        assert!(init_repo(&p).unwrap_err().contains("이미 Git 으로 관리 중"));

        // 이미 .gitignore 가 있으면 건드리지 않는다
        let dir2 = temp_dir("init2");
        std::fs::write(dir2.join(".gitignore"), "my\n").unwrap();
        assert!(!init_repo(&dir2.to_string_lossy()).unwrap().gitignore_created);
        assert_eq!(std::fs::read_to_string(dir2.join(".gitignore")).unwrap(), "my\n");
        std::fs::remove_dir_all(dir).ok();
        std::fs::remove_dir_all(dir2).ok();
    }

    #[test]
    fn remote_url_rules() {
        assert!(validate_remote_url("https://github.com/me/site.git").is_ok());
        assert!(validate_remote_url("git@github.com:me/site.git").is_ok());
        assert!(validate_remote_url("--upload-pack=evil").is_err());
        assert!(validate_remote_url("C:\\some\\folder").is_err());
        assert!(validate_remote_url("https://github.com/me/my site").is_err());
        assert_eq!(folder_name("https://github.com/me/my-site.git").as_deref(), Some("my-site"));
        assert_eq!(folder_name("git@github.com:me/blog").as_deref(), Some("blog"));
        assert_eq!(folder_name("https://github.com/me/repo/").as_deref(), Some("repo"));
    }

    #[test]
    fn clone_and_connect_remote() {
        // 온라인 저장소 역할의 bare 저장소에 저장 지점 하나를 올려 둔다
        let base = temp_dir("clone");
        let bare = base.join("site.git");
        run_git(&base, ["init", "-q", "--bare", "-b", "main", bare.to_str().unwrap()]).unwrap();
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        let sp = src.to_string_lossy().into_owned();
        init_repo(&sp).unwrap();
        set_identity(Some(&sp), "t", "t@example.com").unwrap();
        run_git(&src, ["add", "-A"]).unwrap();
        run_git(&src, ["commit", "-qm", "처음"]).unwrap();
        run_git(&src, ["push", "-q", bare.to_str().unwrap(), "main"]).unwrap();

        // 가져오기 (주소 검사는 따로 테스트했으니 로컬 경로로)
        let parent = base.join("받는곳");
        std::fs::create_dir_all(&parent).unwrap();
        let dest = clone_into(bare.to_str().unwrap(), &parent.to_string_lossy()).unwrap();
        assert!(dest.ends_with("site"));
        assert!(Path::new(&dest).join(".gitignore").exists());
        assert!(clone_into(bare.to_str().unwrap(), &parent.to_string_lossy()).unwrap_err().contains("이미 있어요"));

        // 연결: 없으면 추가, 있으면 주소 변경
        set_remote(&sp, "https://github.com/me/site.git").unwrap();
        set_remote(&sp, "https://github.com/me/site2.git").unwrap();
        assert_eq!(run_git(&src, ["remote", "get-url", "origin"]).unwrap().trim(), "https://github.com/me/site2.git");
        assert!(set_remote(&sp, "not a url").is_err());
        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn suggest_and_add_ignore() {
        let dir = temp_dir("ignore");
        let p = dir.to_string_lossy().into_owned();
        run_git(&dir, ["init", "-q", "-b", "main"]).unwrap(); // 기본 .gitignore 없이
        for f in ["node_modules/a/index.js", "node_modules/b.js", "src/app.js", "debug.log", "src/.DS_Store"] {
            let path = dir.join(f);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "x").unwrap();
        }
        let s = ignore_suggestions(&p).unwrap();
        let pats: Vec<(&str, usize)> = s.iter().map(|x| (x.pattern.as_str(), x.count)).collect();
        assert_eq!(pats, vec![("*.log", 1), (".DS_Store", 1), ("node_modules/", 2)]);

        assert_eq!(add_to_gitignore(&p, &["node_modules/".into(), "*.log".into()]).unwrap(), 2);
        assert_eq!(add_to_gitignore(&p, &["node_modules/".into()]).unwrap(), 0); // 중복은 건너뜀
        assert!(add_to_gitignore(&p, &["a\nb".into()]).is_err());
        let left: Vec<String> = status(&p).unwrap().files.into_iter().map(|f| f.path).collect();
        assert!(!left.iter().any(|f| f.starts_with("node_modules") || f.ends_with(".log")));
        assert!(left.contains(&"src/app.js".to_string()));
        std::fs::remove_dir_all(dir).ok();
    }
}
