// Prevent console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod error;
mod events;
mod p2p;
mod state;
mod terminal_events;

#[cfg(test)]
mod tests;

use commands::*;
use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // Network commands
            initialize_network,
            initialize_network_with_relay,
            connect_to_peer,
            get_node_info,
            // Session commands
            get_active_sessions,
            parse_session_ticket,
            join_session,
            disconnect_session,
            // Terminal commands
            send_terminal_input,
            send_directed_message,
            execute_remote_command,
        ])
        .setup(|app| {
            #[cfg(mobile)]
            app.handle().plugin(tauri_plugin_barcode_scanner::init());

            // Initialize event manager
            let event_manager = events::EventManager::new(app.handle().clone());
            app.manage(event_manager);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // 获取 app_handle，它可以在闭包外部使用
                let app_handle = window.app_handle().clone();
                
                // 在新的线程中执行清理操作
                std::thread::spawn(move || {
                    let rt = tokio::runtime::Runtime::new().unwrap();
                    rt.block_on(async {
                        if let Some(state) = app_handle.try_state::<AppState>() {
                            state.cleanup().await;
                        }
                    });
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
