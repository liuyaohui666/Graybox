#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::{Deserialize, Serialize};
use serde_json::{Value,json};
use std::{fs, time::Duration, sync::{Mutex,OnceLock}};
#[derive(Default)]
struct Session { endpoint: Option<String>, token: Option<String>, profile: Option<Value> }
fn session() -> &'static Mutex<Session> { static STATE: OnceLock<Mutex<Session>>=OnceLock::new(); STATE.get_or_init(||Mutex::new(Session::default())) }
fn allowed_request(path:&str, method:&str)->bool {
 if !matches!(method,"GET"|"POST") || !path.starts_with("/v1/") || !path.chars().all(|c|c.is_ascii_alphanumeric()||"/_-?=&".contains(c)) {return false;}
 let route=path.trim_start_matches("/v1/");
 if route.starts_with("auth/") {return matches!((route,method),("auth/me","GET")|("auth/logout","POST"));}
 if route.starts_with("members") || route.starts_with("agents") {
  return matches!((route,method),("members","GET")|("agents","GET")|("members/invite","POST")|("agents/pair/approve","POST")) || method=="POST" && [ ("members/","/disable"),("agents/","/revoke") ].iter().any(|(pre,suf)| route.strip_prefix(pre).and_then(|v|v.strip_suffix(suf)).is_some_and(|id|!id.is_empty() && !id.contains('/') && !id.contains('?')));
 }
 matches!(route.split(['/', '?']).next().unwrap_or(""),"health"|"me"|"workspaces"|"projects"|"experiments"|"activity"|"commands"|"batches")
}
fn trusted_origin(raw:&str)->Result<String,String> {
 let url=reqwest::Url::parse(raw).map_err(|_|"服务地址格式不正确。")?;
 if url.scheme()!="https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || url.path()!="/" {return Err("云端地址必须是 HTTPS origin，不含路径、账号或查询参数。".into());}
 Ok(url.origin().ascii_serialization())
}
#[derive(Deserialize)] struct CredentialFile {mode:String,humans:Vec<LocalHuman>}
#[derive(Deserialize)] struct LocalHuman {id:String,name:String,role:String,token:String}
#[derive(Serialize)] struct Profile {id:String,name:String,role:String}
fn credentials()->Result<CredentialFile,String> {
 let path=std::env::var("GRAYBOX_CREDENTIALS_PATH").map_err(|_|"请使用 Graybox 本地启动脚本启动程序。")?;
 let raw=fs::read_to_string(path).map_err(|_|"无法读取本地开发凭据。")?;
 let file:CredentialFile=serde_json::from_str(&raw).map_err(|_|"本地开发凭据格式不正确。")?;
 if file.mode!="local-demonstration-only" {return Err("凭据并非本地演示模式。".into());} Ok(file)
}
fn cloud_endpoint()->Result<Option<String>,String> {
 if let Some(endpoint)=session().lock().unwrap().endpoint.clone() {return Ok(Some(endpoint));}
 if let Ok(raw)=std::env::var("GRAYBOX_SERVER_URL").or_else(|_|std::env::var("GRAYBOX_ENDPOINT")) {return trusted_origin(&raw).map(Some);}
 Ok(None)
}
#[tauri::command] fn connection_info()->Result<Value,String> {
 let endpoint=cloud_endpoint()?;
 if endpoint.is_none() && std::env::var("GRAYBOX_CREDENTIALS_PATH").is_ok() { credentials()?; return Ok(json!({"mode":"local","endpoint":"http://127.0.0.1:4318"})); }
 Ok(json!({"mode":"cloud","endpoint":endpoint.unwrap_or_default(),"profile":session().lock().unwrap().profile.clone()}))
}
#[tauri::command] fn configure_endpoint(endpoint:String)->Result<Value,String> {let origin=trusted_origin(&endpoint)?; {let mut s=session().lock().unwrap();s.endpoint=Some(origin);s.token=None;s.profile=None;} connection_info()}
#[tauri::command] fn local_profiles()->Result<Vec<Profile>,String> {if cloud_endpoint()?.is_some(){return Err("云端不支持切换本地身份。".into());} Ok(credentials()?.humans.into_iter().map(|h|Profile{id:h.id,name:h.name,role:h.role}).collect())}
async fn fetch_api(endpoint:&str,path:&str,method:&str,body:Option<Value>,token:Option<String>)->Result<Value,String> {
 let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(30)).build().map_err(|_|"无法创建连接。")?;
 let url=format!("{}{}",endpoint,path);
 let mut builder=if method=="POST" {client.post(url).json(&body.unwrap_or(json!({})))}else{client.get(url)};
 if let Some(t)=token {builder=builder.bearer_auth(t);}
 let response=builder.send().await.map_err(|_|"无法连接 API，请检查服务地址和网络；结果未确认时，请使用原操作重试。")?;
 if response.status().is_redirection(){return Err("服务地址发生重定向，请使用最终 HTTPS 地址。".into());}
 response.json::<Value>().await.map_err(|_|"API 返回格式错误，请检查服务地址。".into())
}
#[tauri::command] async fn authenticate(kind:String,body:Value)->Result<Value,String> {
 if !matches!(kind.as_str(),"login"|"redeem"){return Err("认证操作不被允许。".into());}
 let endpoint=cloud_endpoint()?.ok_or("请先指定云端 HTTPS 服务地址。")?;
 let result=fetch_api(&endpoint,&format!("/v1/auth/{}",kind),"POST",Some(body),None).await?;
 if let Some(error)=result.get("error") {return Err(error.get("message").and_then(Value::as_str).unwrap_or("登录失败。").into());}
 let data=&result["data"]; let token=data["token"].as_str().ok_or("认证响应缺少凭据。")?.to_owned();
 let profile=data["profile"].clone(); if !profile.is_object(){return Err("认证响应缺少身份。".into());}
 {let mut s=session().lock().unwrap(); if s.endpoint.as_ref().is_some_and(|value|value!=&endpoint) {return Err("服务地址已变更，请重新登录。".into());} s.token=Some(token);s.profile=Some(profile.clone());}
 Ok(json!({"profile":profile,"expires_at":data["expires_at"]}))
}
#[tauri::command] async fn api_request(profile_id:String,path:String,method:String,body:Option<Value>)->Result<Value,String> {
 if !allowed_request(&path,&method){return Err("请求路径或方法不被允许。".into());}
 let (endpoint,token)=if let Some(endpoint)=cloud_endpoint()? {(endpoint,session().lock().unwrap().token.clone())}else{("http://127.0.0.1:4318".into(),Some(credentials()?.humans.into_iter().find(|h|h.id==profile_id).ok_or("本地身份不存在。")?.token))};
 let result=fetch_api(&endpoint,&path,&method,body,token).await?;
 if path=="/v1/auth/logout" && result.get("error").is_none(){let mut s=session().lock().unwrap();s.token=None;s.profile=None;}
 Ok(result)
}
fn main(){tauri::Builder::default().invoke_handler(tauri::generate_handler![connection_info,configure_endpoint,authenticate,local_profiles,api_request]).run(tauri::generate_context!()).expect("Graybox desktop could not start");}
#[cfg(test)] mod tests {
 use super::*;
 #[test]
 #[ignore = "requires explicitly configured local development API and credential file"]
 fn native_bridge_reads_real_local_api_without_exposing_tokens(){let profiles=local_profiles().expect("local profiles available"); assert_eq!(profiles.len(),3); let public=serde_json::to_value(&profiles).unwrap();assert!(public.as_array().unwrap().iter().all(|p|p.get("token").is_none()));let me=tauri::async_runtime::block_on(api_request(profiles[0].id.clone(),"/v1/me".into(),"GET".into(),None)).unwrap();assert_eq!(me["data"]["kind"],"human");}
 #[test] fn auth_routes_are_precise(){assert!(allowed_request("/v1/auth/me","GET"));assert!(allowed_request("/v1/agents/pair/approve","POST"));assert!(!allowed_request("/v1/auth/login","GET"));assert!(!allowed_request("/v1/members/invite","GET"));assert!(!allowed_request("/v1/agents/a/revoke/extra","POST"));assert!(!allowed_request("/v1/auth/pair/poll","POST"));assert!(!allowed_request("/v1/../admin","GET"));}
 #[test] fn endpoint_rejects_credentials_paths_and_insecure_urls(){assert_eq!(trusted_origin("https://example.com/").unwrap(),"https://example.com");for value in ["http://example.com","https://user:pass@example.com","https://example.com/v1","https://example.com?secret=x","file:///secret"] {assert!(trusted_origin(value).is_err());}}
 #[test] fn only_allows_graybox_api_routes_and_safe_methods(){assert!(allowed_request("/v1/projects","GET"));assert!(allowed_request("/v1/experiments?project_id=abcd-1234","GET"));assert!(allowed_request("/v1/commands","POST"));assert!(!allowed_request("https://example.com","GET"));assert!(!allowed_request("/v1/commands","DELETE"));assert!(!allowed_request("/v1/projects%2f..%2fsecret","GET"));}
}

