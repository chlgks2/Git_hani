// 스냅샷: 커밋하지 않아도 지금 폴더 상태를 사진처럼 찍어 두는 기능.
//
// - Git 안의 숨은 공간(refs/gitgui/snapshots/…)에 저장한다. 저장 기록(그래프)에도, GitHub 에도 나타나지 않는다.
//   (올리기는 refs/heads 갈래만 올리므로 이 공간은 올라가지 않는다)
// - 찍을 때 임시 index 를 따로 써서 작업 폴더와 stage 상태는 전혀 건드리지 않는다.
// - .gitignore 파일과 아주 큰 파일은 찍지 않는다.

use crate::git::{is_merging, repo_root, run_git, run_git_env};
use serde::Serialize;
use std::path::Path;

/// 스냅샷이 저장되는 숨은 공간
pub const SNAP_PREFIX: &str = "refs/gitgui/snapshots/";
/// 이보다 큰 파일은 스냅샷에 넣지 않는다 (그 파일은 마지막 저장 상태로 남긴다)
pub const MAX_SNAPSHOT_FILE: u64 = 10 * 1024 * 1024;
/// 시간 기록에 보여줄 바뀐 파일 이름 최대 개수
const MAX_FILES_SHOWN: usize = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// 숨은 공간 안의 이름 (지울 때 쓴다)
    pub id: String,
    pub hash: String,
    /// 찍은 시각 (초)
    pub time: i64,
    /// "manual" 직접 찍음 / "auto" 자동으로 찍음
    pub kind: String,
    /// 찍을 때의 마지막 저장 지점
    pub head: String,
    pub head_subject: String,
    /// 바로 앞 스냅샷(또는 그때의 마지막 저장 지점) 이후 바뀐 파일들 (최대 20개)
    pub files: Vec<String>,
    /// 바뀐 파일 전체 수
    pub file_count: usize,
    /// 크기 때문에 빼고 찍은 파일들
    pub skipped_large: Vec<String>,
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// 스냅샷 이름 "0001791322403123-abc1234" 에서 찍은 시각(초)을 읽는다
fn time_of(id: &str) -> i64 {
    id.split('-').next().and_then(|ms| ms.parse::<i64>().ok()).map(|ms| ms / 1000).unwrap_or(0)
}

/// 지금 폴더 상태를 스냅샷으로 찍는다.
/// 바뀐 게 없거나(마지막 저장 상태 그대로) 직전 스냅샷과 같으면 찍지 않고 None 을 돌려준다.
pub fn create(path: &str, kind: &str) -> Result<Option<Snapshot>, String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);
    if run_git(root_path, ["rev-parse", "--verify", "--quiet", "HEAD"]).is_err() {
        return Err("첫 저장 지점(커밋)을 만든 뒤에 스냅샷을 찍을 수 있어요.".into());
    }
    if is_merging(root_path) {
        return Err("충돌을 해결하는 중에는 스냅샷을 찍지 않아요.".into());
    }
    let kind = if kind == "auto" { "auto" } else { "manual" };
    let head = run_git(root_path, ["rev-parse", "HEAD"])?.trim().to_string();

    // 임시 index 에 "마지막 저장 상태 + 지금 바뀐 것"을 담아 tree 를 만든다
    let tmp = root_path.join(run_git(root_path, ["rev-parse", "--git-path", "index.gitgui-snapshot"])?.trim());
    let tmp_s = tmp.to_string_lossy().into_owned();
    let env: &[(&str, &str)] = &[("GIT_INDEX_FILE", tmp_s.as_str())];
    let made = (|| -> Result<(String, Vec<String>), String> {
        run_git_env(root_path, ["read-tree", "HEAD"], env)?;
        run_git_env(root_path, ["add", "-A"], env)?;
        // 너무 큰 파일은 마지막 저장 상태로 되돌려 둔다 (새 파일이면 빼 버린다)
        let mut skipped = Vec::new();
        let changed = run_git_env(root_path, ["diff", "--cached", "--name-only", "-z", "HEAD"], env)?;
        for file in changed.split('\0').filter(|f| !f.is_empty()) {
            let size = std::fs::metadata(root_path.join(file)).map(|m| m.len()).unwrap_or(0);
            if size > MAX_SNAPSHOT_FILE {
                run_git_env(root_path, ["reset", "-q", "HEAD", "--", file], env)?;
                skipped.push(file.to_string());
            }
        }
        Ok((run_git_env(root_path, ["write-tree"], env)?.trim().to_string(), skipped))
    })();
    std::fs::remove_file(&tmp).ok(); // 임시 index 는 성공하든 실패하든 지운다
    let (tree, skipped_large) = made?;

    // 마지막 저장 상태와 같으면 찍을 게 없다
    let head_tree = run_git(root_path, ["rev-parse", "HEAD^{tree}"])?.trim().to_string();
    if tree == head_tree {
        return Ok(None);
    }
    // 직전 스냅샷 하나만 본다 (목록 전체를 계산하면 스냅샷이 쌓일수록 느려진다)
    let last = run_git(
        root_path,
        [
            "for-each-ref",
            "--sort=-refname",
            "--count=1",
            "--format=%(objectname) %(tree) %(parent)",
            SNAP_PREFIX,
        ],
    )?;
    let mut last = last.split_whitespace();
    let (last_hash, last_tree, last_head) = (last.next(), last.next(), last.next());
    // 직전 스냅샷과 같으면 또 찍지 않는다
    if last_tree == Some(tree.as_str()) {
        return Ok(None);
    }

    let msg = format!("{kind} snapshot");
    let hash = run_git(root_path, ["commit-tree", tree.as_str(), "-p", head.as_str(), "-m", msg.as_str()])?
        .trim()
        .to_string();
    // 이름: 밀리초 시각(자릿수 고정)-해시 앞부분.
    // 이름 순서 = 찍은 순서가 되도록 한다. 초 단위로 정렬하면 같은 1초 안에 찍은 스냅샷의 순서가 뒤섞인다.
    let id = format!("{:016}-{}", now_millis(), &hash[..7]);
    run_git(root_path, ["update-ref", format!("{SNAP_PREFIX}{id}").as_str(), hash.as_str()])?;

    // 바뀐 파일: 직전 스냅샷이 같은 저장 지점 위에서 찍혔으면 그것과, 아니면 마지막 저장 지점과 비교
    let base = match (last_hash, last_head) {
        (Some(h), Some(lh)) if lh == head => h.to_string(),
        _ => head.clone(),
    };
    let files: Vec<String> = run_git(root_path, ["diff", "--name-only", base.as_str(), hash.as_str()])?
        .lines()
        .map(String::from)
        .collect();
    Ok(Some(Snapshot {
        time: time_of(&id),
        id,
        kind: kind.into(),
        head_subject: run_git(root_path, ["log", "-1", "--format=%s", "HEAD"])?.trim().to_string(),
        head,
        file_count: files.len(),
        files: files.into_iter().take(MAX_FILES_SHOWN).collect(),
        skipped_large,
        hash,
    }))
}

/// 스냅샷 목록 (최신이 앞). 각 스냅샷마다 바로 앞 스냅샷 이후 바뀐 파일을 붙인다.
pub fn list(path: &str) -> Result<Vec<Snapshot>, String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);
    // %(subject) 는 "manual snapshot" / "auto snapshot", %(parent) 는 찍을 때의 마지막 저장 지점
    let raw = run_git(
        root_path,
        [
            "for-each-ref",
            "--sort=-refname", // 이름이 곧 찍은 순서 (최신이 앞)
            "--format=%(refname)%1f%(objectname)%1f%(subject)%1f%(parent)",
            SNAP_PREFIX,
        ],
    )?;
    let mut snaps: Vec<Snapshot> = raw
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\x1f').collect();
            if f.len() < 4 {
                return None;
            }
            let id = f[0].trim_start_matches(SNAP_PREFIX).to_string();
            Some(Snapshot {
                time: time_of(&id),
                id,
                hash: f[1].to_string(),
                kind: if f[2].starts_with("auto") { "auto" } else { "manual" }.into(),
                head: f[3].split_whitespace().next().unwrap_or("").to_string(),
                head_subject: String::new(),
                files: Vec::new(),
                file_count: 0,
                skipped_large: Vec::new(),
            })
        })
        .collect();

    for i in 0..snaps.len() {
        // 비교 기준: 바로 앞(더 오래된) 스냅샷이 같은 저장 지점 위에서 찍혔으면 그것, 아니면 그때의 저장 지점
        let base = snaps
            .get(i + 1)
            .filter(|prev| prev.head == snaps[i].head)
            .map(|prev| prev.hash.clone())
            .unwrap_or_else(|| snaps[i].head.clone());
        let changed = run_git(root_path, ["diff", "--name-only", base.as_str(), snaps[i].hash.as_str()]).unwrap_or_default();
        let files: Vec<String> = changed.lines().map(String::from).collect();
        snaps[i].file_count = files.len();
        snaps[i].files = files.into_iter().take(MAX_FILES_SHOWN).collect();
        snaps[i].head_subject = run_git(root_path, ["log", "-1", "--format=%s", snaps[i].head.as_str()])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
    }
    Ok(snaps)
}

/// 스냅샷 지우기. ids 가 비어 있으면 전부 지운다. 지운 개수를 돌려준다.
pub fn delete(path: &str, ids: &[String]) -> Result<usize, String> {
    let root = repo_root(path)?;
    let root_path = Path::new(&root);
    let targets: Vec<String> = if ids.is_empty() { list(&root)?.into_iter().map(|s| s.id).collect() } else { ids.to_vec() };
    let mut n = 0;
    for id in targets {
        // 이름은 "숫자-16진수" 모양만 받는다 (다른 ref 를 지우지 못하게)
        let valid = id.split_once('-').is_some_and(|(t, h)| {
            !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()) && !h.is_empty() && h.chars().all(|c| c.is_ascii_hexdigit())
        });
        if !valid {
            return Err(format!("잘못된 스냅샷 이름이에요: {id}"));
        }
        run_git(root_path, ["update-ref", "-d", format!("{SNAP_PREFIX}{id}").as_str()])?;
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{commit, history, restore_to, status};

    fn temp_repo(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("git-hani-snap-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        run_git(&dir, ["init", "-q", "-b", "main"]).unwrap();
        run_git(&dir, ["config", "user.name", "tester"]).unwrap();
        run_git(&dir, ["config", "user.email", "tester@example.com"]).unwrap();
        run_git(&dir, ["config", "core.autocrlf", "false"]).unwrap();
        dir
    }

    fn write(dir: &Path, name: &str, body: &str) {
        std::fs::write(dir.join(name), body).unwrap();
    }

    #[test]
    fn snapshot_and_go_back() {
        let dir = temp_repo("basic");
        let p = dir.to_string_lossy().into_owned();
        assert!(create(&p, "manual").is_err()); // 첫 커밋 전에는 안 됨
        write(&dir, "a.txt", "저장한 내용");
        commit(&p, &["a.txt".into()], "처음", None).unwrap();
        assert!(create(&p, "manual").unwrap().is_none()); // 바뀐 게 없음

        write(&dir, "a.txt", "2:00 잘 되던 내용");
        write(&dir, "new.txt", "새 파일");
        let s1 = create(&p, "manual").unwrap().expect("찍혀야 함");
        assert_eq!(s1.file_count, 2);
        assert_eq!(s1.head_subject, "처음");
        assert!(create(&p, "auto").unwrap().is_none()); // 직전과 같으면 또 찍지 않음

        write(&dir, "a.txt", "2:20 망가진 내용");
        let s2 = create(&p, "auto").unwrap().unwrap();
        assert_eq!(s2.kind, "auto");
        assert_eq!(s2.files, vec!["a.txt".to_string()]); // 앞 스냅샷 이후 바뀐 것만

        let snaps = list(&p).unwrap();
        assert_eq!(snaps.len(), 2);
        assert_eq!(snaps[0].hash, s2.hash); // 최신이 앞

        // 스냅샷은 저장 기록(그래프)에 나타나지 않고, 찍어도 작업 폴더는 그대로
        assert_eq!(history(&p, None).unwrap().len(), 1);
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "2:20 망가진 내용");

        // 2:00 스냅샷으로 돌아가기 → 저장 안 한 변경으로 되살아나고, 커밋은 늘지 않는다
        let r = restore_to(&p, &s1.hash).unwrap();
        assert!(r.uncommitted && r.commit.is_none());
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "2:00 잘 되던 내용");
        assert_eq!(std::fs::read_to_string(dir.join("new.txt")).unwrap(), "새 파일");
        assert_eq!(run_git(&dir, ["rev-list", "--count", "HEAD"]).unwrap().trim(), "1");
        assert!(!status(&p).unwrap().files.is_empty());

        assert_eq!(delete(&p, &[s1.id.clone()]).unwrap(), 1);
        assert_eq!(list(&p).unwrap().len(), 1);
        assert!(delete(&p, &["../heads/main".into()]).is_err()); // 다른 ref 는 못 지움
        assert_eq!(delete(&p, &[]).unwrap(), 1); // 전부 지우기
        assert!(list(&p).unwrap().is_empty());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn quick_snapshots_keep_their_order() {
        // 같은 1초 안에 여러 번 찍어도 찍은 순서대로 나와야 한다 (자동 스냅샷에서 생길 수 있는 상황)
        let dir = temp_repo("order");
        let p = dir.to_string_lossy().into_owned();
        write(&dir, "a.txt", "0");
        commit(&p, &["a.txt".into()], "처음", None).unwrap();
        let mut made = Vec::new();
        for i in 1..=5 {
            write(&dir, "a.txt", &i.to_string());
            made.push(create(&p, "auto").unwrap().unwrap().hash);
        }
        let listed: Vec<String> = list(&p).unwrap().into_iter().map(|s| s.hash).collect();
        made.reverse(); // 목록은 최신이 앞
        assert_eq!(listed, made);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn large_files_are_left_out() {
        let dir = temp_repo("large");
        let p = dir.to_string_lossy().into_owned();
        write(&dir, "a.txt", "1");
        commit(&p, &["a.txt".into()], "처음", None).unwrap();
        write(&dir, "a.txt", "2");
        std::fs::write(dir.join("big.bin"), vec![0u8; (MAX_SNAPSHOT_FILE + 1) as usize]).unwrap();
        let s = create(&p, "manual").unwrap().unwrap();
        assert_eq!(s.skipped_large, vec!["big.bin".to_string()]);
        assert_eq!(s.files, vec!["a.txt".to_string()]);
        assert!(dir.join("big.bin").exists()); // 파일 자체는 그대로
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn ignored_files_are_not_in_snapshot() {
        let dir = temp_repo("ignored");
        let p = dir.to_string_lossy().into_owned();
        write(&dir, ".gitignore", ".env\n");
        commit(&p, &[".gitignore".into()], "처음", None).unwrap();
        write(&dir, ".env", "KEY=secret");
        write(&dir, "app.js", "1");
        let s = create(&p, "manual").unwrap().unwrap();
        assert_eq!(s.files, vec!["app.js".to_string()]);
        assert!(run_git(&dir, ["cat-file", "-e", format!("{}:.env", s.hash).as_str()]).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    /// .git 폴더 크기 (바이트)
    fn git_dir_size(dir: &Path) -> u64 {
        fn walk(p: &Path) -> u64 {
            std::fs::read_dir(p)
                .map(|rd| {
                    rd.flatten()
                        .map(|e| {
                            let m = e.metadata().unwrap();
                            if m.is_dir() { walk(&e.path()) } else { m.len() }
                        })
                        .sum()
                })
                .unwrap_or(0)
        }
        walk(&dir.join(".git"))
    }

    /// 측정용 (평소 테스트에서는 건너뜀): cargo test --lib measure -- --ignored --nocapture
    #[test]
    #[ignore]
    fn measure() {
        use std::time::Instant;
        let kb = |b: u64| b as f64 / 1024.0;
        let run = |label: &str, dir: &Path, rounds: usize, mut change: Box<dyn FnMut(usize)>| {
            let p = dir.to_string_lossy().into_owned();
            let before = git_dir_size(dir);
            let mut times = Vec::new();
            for i in 0..rounds {
                change(i);
                let t = Instant::now();
                create(&p, "manual").unwrap().expect("찍혀야 함");
                times.push(t.elapsed().as_millis());
            }
            let after = git_dir_size(dir);
            let avg = times.iter().sum::<u128>() / times.len() as u128;
            println!(
                "[{label}] 스냅샷 {rounds}번 · 평균 {avg}ms (최대 {}ms) · .git 증가 {:.1}KB (1번당 {:.1}KB)",
                times.iter().max().unwrap(),
                kb(after - before),
                kb(after - before) / rounds as f64
            );
        };

        // A. 이 프로젝트 소스 크기의 보통 프로젝트
        let a = temp_repo("measure-a");
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let mut files = Vec::new();
        for sub in ["src", "src/components", "src-tauri/src", "server/src/ai", "docs"] {
            for e in std::fs::read_dir(src.join(sub)).unwrap().flatten() {
                if e.path().is_file() {
                    let rel = format!("{sub}/{}", e.file_name().to_string_lossy());
                    std::fs::create_dir_all(a.join(sub)).unwrap();
                    std::fs::copy(e.path(), a.join(&rel)).unwrap();
                    files.push(rel);
                }
            }
        }
        run_git(&a, ["add", "-A"]).unwrap();
        run_git(&a, ["commit", "-qm", "처음"]).unwrap();
        println!("A: 파일 {}개, 소스 합계 약 {:.0}KB", files.len(), kb(files.iter().map(|f| std::fs::metadata(a.join(f)).unwrap().len()).sum()));
        let af = files.clone();
        let a2 = a.clone();
        run("A 보통 프로젝트, 매번 파일 3개 수정", &a, 20, Box::new(move |i| {
            for k in 0..3 {
                let f = a2.join(&af[(i * 3 + k) % af.len()]);
                let mut body = std::fs::read_to_string(&f).unwrap_or_default();
                body.push_str(&format!("\n// 수정 {i}-{k}\n"));
                std::fs::write(&f, body).unwrap();
            }
        }));

        // B. 파일 2만 개짜리 큰 프로젝트
        let b = temp_repo("measure-b");
        for i in 0..20_000 {
            let d = b.join(format!("pkg{}", i / 500));
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join(format!("f{i}.js")), format!("export const v{i} = {i};\n")).unwrap();
        }
        run_git(&b, ["add", "-A"]).unwrap();
        run_git(&b, ["commit", "-qm", "처음"]).unwrap();
        let b2 = b.clone();
        run("B 파일 2만 개, 매번 5개 수정", &b, 5, Box::new(move |i| {
            for k in 0..5 {
                std::fs::write(b2.join(format!("pkg{}/f{}.js", k, k * 500 + i)), format!("// {i}\n")).unwrap();
            }
        }));

        // C. 압축이 안 되는 5MB 파일이 매번 바뀜 (이미지·DB 파일을 자주 고치는 경우)
        let c = temp_repo("measure-c");
        std::fs::write(c.join("a.txt"), "1").unwrap();
        run_git(&c, ["add", "-A"]).unwrap();
        run_git(&c, ["commit", "-qm", "처음"]).unwrap();
        let c2 = c.clone();
        run("C 5MB 바이너리가 매번 바뀜", &c, 10, Box::new(move |i| {
            // 간단한 의사 난수로 압축 안 되는 내용 만들기
            let mut x: u64 = 0x9E3779B97F4A7C15 ^ (i as u64 + 1);
            let data: Vec<u8> = (0..5 * 1024 * 1024)
                .map(|_| {
                    x ^= x << 13;
                    x ^= x >> 7;
                    x ^= x << 17;
                    (x & 0xff) as u8
                })
                .collect();
            std::fs::write(c2.join("data.db"), data).unwrap();
        }));

        for d in [a, b, c] {
            std::fs::remove_dir_all(d).ok();
        }
    }
}
