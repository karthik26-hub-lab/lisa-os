// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn show_dashboard(app: tauri::AppHandle) {
    if let Some(dashboard) = app.get_webview_window("main") {
        dashboard.show().unwrap();
        dashboard.unminimize().unwrap();
        dashboard.set_focus().unwrap();
    }
}

#[tauri::command]
fn hide_dashboard(app: tauri::AppHandle) {
    if let Some(dashboard) = app.get_webview_window("main") {
        dashboard.hide().unwrap();
    }
}

#[tauri::command]
fn minimize_dashboard(app: tauri::AppHandle) {
    if let Some(dashboard) = app.get_webview_window("main") {
        dashboard.minimize().unwrap();
    }
}

use tauri::PhysicalPosition;

#[tauri::command]
fn maximize_dashboard(app: tauri::AppHandle) {
    if let Some(dashboard) = app.get_webview_window("main") {
        if dashboard.is_fullscreen().unwrap_or(false) {
            dashboard.set_fullscreen(false).unwrap();
            let _ = dashboard.unmaximize();
        } else {
            if let Ok(Some(monitor)) = dashboard.current_monitor() {
                let size = monitor.size();
                let pos = monitor.position();
                dashboard.set_position(tauri::Position::Physical(*pos)).unwrap();
                dashboard.set_size(tauri::Size::Physical(*size)).unwrap();
            }
            // we will use the maximize state internally in frontend, or just rely on state
        }
    }
}

#[tauri::command]
fn broadcast_theme(app: tauri::AppHandle, theme: String) {
    let _ = app.emit("theme_changed", theme);
}

use tauri::{Manager, Emitter};

use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState, GlobalShortcutExt};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            if let Some(island) = app.get_webview_window("island") {
                if let Ok(Some(monitor)) = island.primary_monitor() {
                    let size = monitor.size();
                    let scale_factor = monitor.scale_factor();
                    let window_size = island.outer_size().unwrap();
                    
                    // Calculate position for top center
                    let x = (size.width as f64 - window_size.width as f64) / 2.0;
                    let y = 0.0; // Flush with the top edge
                    
                    island.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: x as i32,
                        y: y as i32,
                    })).unwrap();
                }
            }
            
            // Register Alt+X securely in Rust backend
            let alt_x = Shortcut::new(Some(Modifiers::ALT), Code::KeyX);
            let _ = app.global_shortcut().on_shortcut(alt_x, |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    if let Some(island) = app.get_webview_window("island") {
                        let _ = island.emit("toggle_mic", ());
                    }
                }
            });
            
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "main" {
                    window.hide().unwrap();
                    api.prevent_close();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![greet, show_dashboard, hide_dashboard, minimize_dashboard, maximize_dashboard, broadcast_theme])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
