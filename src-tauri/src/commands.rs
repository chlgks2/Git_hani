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
pub async fn git_unpushed(path: String) -> Result<Vec<git::UnpushedCommit>, String> {
    blocking(move || git::unpushed(&path)).await
}

#[tauri::command]
pub async fn git_push(path: String, up_to: Option<String>) -> Result<git::PushResult, String> {
    blocking(move || git::push(&path, up_to.as_deref())).await
}
