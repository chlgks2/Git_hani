mod commands;
mod git;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // 폴더 선택 창을 쓰기 위한 플러그인
    .plugin(tauri_plugin_dialog::init())
    // React 에서 invoke("git_status") 로 부를 수 있게 명령을 등록한다
    .invoke_handler(tauri::generate_handler![
      commands::git_status,
      commands::git_log,
      commands::git_commit,
      commands::git_unpushed,
      commands::git_push,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
