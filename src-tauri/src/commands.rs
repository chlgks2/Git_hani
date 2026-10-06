// 화면(React)에서 invoke("이름", {...}) 로 부르는 명령들.
//
// 실제 작업은 git.rs 의 일반 함수가 하고, 여기서는 그 함수를 "다른 일꾼 스레드"에서 돌린다.
// Tauri 에서 async 가 아닌 명령은 화면을 그리는 메인 스레드에서 실행되기 때문에,
// push 처럼 몇 초 걸리는 작업을 그대로 부르면 그동안 창이 멈춰 버린다.

use crate::git;

/// 오래 걸릴 수 있는 일을 별도 스레드에서 실행하고 결과를 기다린다.
/// F: 한 번 실행하고 끝나는 함수(FnOnce), Send + 'static: 다른 스레드로 넘길 수 있는 것
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("작업 중 문제가 생겼어요: {e}"))?
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<git::RepoStatus, String> {
    // move : path 의 소유권을 클로저 안으로 옮긴다 (다른 스레드에서 쓰려면 필요)
    blocking(move || git::status(&path)).await
}

#[tauri::command]
pub async fn git_log(path: String, limit: Option<u32>) -> Result<Vec<git::CommitInfo>, String> {
    blocking(move || git::history(&path, limit)).await
}

#[tauri::command]
pub async fn git_commit(
    path: String,
    files: Vec<String>,
    message: String,
    description: Option<String>,
) -> Result<git::CommitResult, String> {
    blocking(move || git::commit(&path, &files, &message, description.as_deref())).await
}

#[tauri::command]
pub async fn git_unpushed(path: String) -> Result<Vec<git::CommitWithFiles>, String> {
    blocking(move || git::unpushed(&path)).await
}

#[tauri::command]
pub async fn git_push(path: String, up_to: Option<String>) -> Result<git::PushResult, String> {
    blocking(move || git::push(&path, up_to.as_deref())).await
}

#[tauri::command]
pub async fn git_commit_stats(path: String, hash: String) -> Result<Vec<git::FileStat>, String> {
    blocking(move || git::commit_stats(&path, &hash)).await
}

/// interactive: 사용자가 직접 누른 확인이면 true (필요하면 로그인 창을 띄움), 자동 확인이면 false
#[tauri::command]
pub async fn git_fetch(path: String, interactive: bool) -> Result<(), String> {
    blocking(move || git::fetch(&path, interactive)).await
}

#[tauri::command]
pub async fn git_incoming(path: String) -> Result<Vec<git::CommitWithFiles>, String> {
    blocking(move || git::incoming(&path)).await
}

#[tauri::command]
pub async fn git_pull(path: String) -> Result<git::PullResult, String> {
    blocking(move || git::pull(&path)).await
}

#[tauri::command]
pub async fn git_start_merge(path: String) -> Result<Vec<String>, String> {
    blocking(move || git::start_merge(&path)).await
}

#[tauri::command]
pub async fn git_conflict_file(path: String, file: String) -> Result<git::ConflictFile, String> {
    blocking(move || git::conflict_file(&path, &file)).await
}

#[tauri::command]
pub async fn git_resolve_file(path: String, file: String, content: String) -> Result<(), String> {
    blocking(move || git::resolve_file(&path, &file, &content)).await
}

#[tauri::command]
pub async fn git_resolve_whole(path: String, file: String, side: String) -> Result<(), String> {
    blocking(move || git::resolve_whole(&path, &file, &side)).await
}

#[tauri::command]
pub async fn git_finish_merge(path: String) -> Result<git::CommitResult, String> {
    blocking(move || git::finish_merge(&path)).await
}

#[tauri::command]
pub async fn git_abort_merge(path: String) -> Result<(), String> {
    blocking(move || git::abort_merge(&path)).await
}

/// 실행할 때 폴더 경로를 함께 주면(예: git-hani.exe D:\내프로젝트) 그 폴더를 바로 연다.
/// 나중에 탐색기 오른쪽 클릭 "Git GUI 로 열기" 같은 기능에도 쓸 수 있다.
#[tauri::command]
pub fn startup_path() -> Option<String> {
    // args().nth(1) : 0번은 실행 파일 자신, 1번이 첫 번째 인자
    std::env::args().nth(1).filter(|p| std::path::Path::new(p).is_dir())
}

#[tauri::command]
pub async fn git_restore_preview(path: String, target: String) -> Result<git::RestorePreview, String> {
    blocking(move || git::restore_preview(&path, &target)).await
}

#[tauri::command]
pub async fn git_restore_to(path: String, target: String) -> Result<git::RestoreResult, String> {
    blocking(move || git::restore_to(&path, &target)).await
}

#[tauri::command]
pub async fn git_file_diff(path: String, file: String) -> Result<git::FileDiff, String> {
    blocking(move || git::file_diff(&path, &file)).await
}
