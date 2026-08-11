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

#[tauri::command]
fn resize_island(app: tauri::AppHandle, width: f64, height: f64) {
    if let Some(island) = app.get_webview_window("island") {
        if let Ok(Some(monitor)) = island.primary_monitor() {
            let scale_factor = monitor.scale_factor();
            let monitor_logical_width = monitor.size().width as f64 / scale_factor;
            let monitor_logical_height = monitor.size().height as f64 / scale_factor;
            let x = (monitor_logical_width - width) / 2.0;
            let y = monitor_logical_height - height - (40.0 / scale_factor); // 40px physical padding from bottom
            
            let _ = island.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
            let _ = island.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }
    }
}

#[tauri::command]
fn toggle_dock(app: tauri::AppHandle, show: bool) {
    if let Some(island) = app.get_webview_window("island") {
        if show {
            let _ = island.show();
        } else {
            let _ = island.hide();
        }
    }
}

use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState, GlobalShortcutExt};

#[tauri::command]
fn set_global_hotkey(app: tauri::AppHandle, old_shortcut: Option<String>, new_shortcut: String) -> Result<(), String> {
    if let Some(old_s) = old_shortcut {
        if let Ok(shortcut) = old_s.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(shortcut);
        }
    }
    
    if let Ok(shortcut) = new_shortcut.parse::<Shortcut>() {
        let _ = app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
            if let Some(island) = app.get_webview_window("island") {
                if event.state() == ShortcutState::Pressed {
                    let _ = island.emit("hotkey_pressed", ());
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.emit("hotkey_pressed", ());
                    }
                } else if event.state() == ShortcutState::Released {
                    let _ = island.emit("hotkey_released", ());
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.emit("hotkey_released", ());
                    }
                }
            }
        });
        Ok(())
    } else {
        Err("Failed to parse shortcut".into())
    }
}

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
                    
                    // Calculate position for bottom center
                    let x = (size.width as f64 - window_size.width as f64) / 2.0;
                    let y = size.height as f64 - window_size.height as f64 - 20.0;
                    
                    island.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: x as i32,
                        y: y as i32,
                    })).unwrap();
                }
            }
            
            // Register Ctrl+Shift+X for text-only polish
            if let Ok(polish_shortcut) = "CommandOrControl+Shift+X".parse::<Shortcut>() {
                let _ = app.global_shortcut().on_shortcut(polish_shortcut, |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(main) = app.get_webview_window("main") {
                            let _ = main.emit("trigger_text_polish", ());
                        }
                    }
                });
            }

            // Spawn backend sidecar
            use tauri_plugin_shell::ShellExt;
            let shell = app.shell();
            if let Ok(sidecar) = shell.sidecar("backend") {
                if let Err(e) = sidecar.spawn() {
                    println!("Failed to spawn backend sidecar: {}", e);
                } else {
                    println!("Successfully spawned backend sidecar!");
                }
            } else {
                println!("Backend sidecar not found. This is normal during development if you haven't built the sidecar yet.");
            }

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
        .invoke_handler(tauri::generate_handler![greet, show_dashboard, hide_dashboard, minimize_dashboard, maximize_dashboard, broadcast_theme, resize_island, set_global_hotkey, toggle_dock])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
