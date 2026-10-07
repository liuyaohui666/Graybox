#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, time::Duration};

fn allowed_request(path: &str, method: &str) -> bool {
    if !matches!(method, "GET" | "POST") || !path.starts_with("/v1/") { return false; }
    if !path.chars().all(|c| c.is_ascii_alphanumeric() || "/_-?=&".contains(c)) { return false; }
    let root = path.trim_start_matches("/v1/").split(['/', '?']).next().unwrap_or("");
    matches!(root, "health"|"me"|"workspaces"|"projects"|"experiments"|"activity"|"commands"|"batches")
}

#[derive(Deserialize)]
struct CredentialFile { mode: String, humans: Vec<LocalHuman> }
#[derive(Deserialize)]
struct LocalHuman { id: String, name: String, role: String, token: String }
#[derive(Serialize)]
struct Profile { id: String, name: String, role: String }

fn credentials() -> Result<CredentialFile, String> {
    // The path is provided by the trusted local launcher, never by page content.
    let path = std::env::var("GRAYBOX_CREDENTIALS_PATH").map_err(|_| "请使用 Graybox 本地启动脚本启动程序。")?;
    let raw = fs::read_to_string(path).map_err(|_| "无法读取本地开发凭据。")?;
    let file: CredentialFile = serde_json::from_str(&raw).map_err(|_| "本地开发凭据格式不正确。")?;
    if file.mode != "local-demonstration-only" { return Err("当前桌面桥接仅支持本地开发身份。".into()); }
    Ok(file)
}

#[tauri::command]
fn local_profiles() -> Result<Vec<Profile>, String> {
    Ok(credentials()?.humans.into_iter().map(|h| Profile { id:h.id, name:h.name, role:h.role }).collect())
}

#[tauri::command]
async fn api_request(profile_id: String, path: String, method: String, body: Option<Value>) -> Result<Value, String> {
    if !allowed_request(&path, &method) { return Err("请求路径或方法不被允许。".into()); }
    let token = credentials()?.humans.into_iter().find(|h| h.id==profile_id).ok_or("本地身份不存在。")?.token;
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(3)).timeout(Duration::from_secs(15)).build().map_err(|_| "无法创建本地连接。")?;
    let url = format!("http://127.0.0.1:4318{}", path);
    let builder = if method=="POST" { client.post(url).json(&body.unwrap_or(Value::Object(Default::default()))) } else { client.get(url) };
    let response = builder.bearer_auth(token).send().await.map_err(|_| "无法连接本地 API；结果未确认时，请使用原操作重试。")?;
    response.json::<Value>().await.map_err(|_| "API 返回格式错误。".into())
}

fn main() {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![local_profiles,api_request])
        .run(tauri::generate_context!()).expect("Graybox desktop could not start");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires the explicitly configured local development API and credential file"]
    fn native_bridge_reads_real_local_api_without_exposing_tokens() {
        let profiles = local_profiles().expect("local profiles available");
        assert_eq!(profiles.len(), 3);
        let public_profiles = serde_json::to_value(&profiles).unwrap();
        assert!(public_profiles.as_array().unwrap().iter().all(|p| p.get("token").is_none()));
        let me = tauri::async_runtime::block_on(api_request(profiles[0].id.clone(), "/v1/me".into(), "GET".into(), None)).unwrap();
        assert_eq!(me["data"]["kind"], "human");
        let projects = tauri::async_runtime::block_on(api_request(profiles[0].id.clone(), "/v1/projects".into(), "GET".into(), None)).unwrap();
        assert!(projects["data"].is_array());
        assert!(tauri::async_runtime::block_on(api_request(profiles[0].id.clone(), "https://example.com".into(), "GET".into(), None)).is_err());
    }
    #[test]
    fn only_allows_graybox_api_routes_and_safe_methods() {
        assert!(allowed_request("/v1/projects", "GET"));
        assert!(allowed_request("/v1/experiments?project_id=abcd-1234", "GET"));
        assert!(allowed_request("/v1/commands", "POST"));
        assert!(!allowed_request("https://example.com", "GET"));
        assert!(!allowed_request("/v1/../admin", "GET"));
        assert!(!allowed_request("/v1/commands", "DELETE"));
        assert!(!allowed_request("/v1/projects%2f..%2fsecret", "GET"));
    }
}
