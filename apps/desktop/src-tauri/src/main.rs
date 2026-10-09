#![cfg_attr(not(test), windows_subsystem = "windows")]
mod session_store;
mod attachment_bridge;
use tauri::Manager;
use serde::{Deserialize, Serialize};
use serde_json::{Value,json};
use std::{fs, time::Duration, sync::{Mutex,OnceLock}};
#[derive(Default)]
struct Session { endpoint: Option<String>, token: Option<String>, profile: Option<Value>, token_origin: Option<String>, generation: u64 }
fn session() -> &'static Mutex<Session> { static STATE: OnceLock<Mutex<Session>>=OnceLock::new(); STATE.get_or_init(||Mutex::new(Session::default())) }
fn allowed_request(path:&str, method:&str)->bool {
 if !matches!(method,"GET"|"POST") || path.len()>4096 {return false;}
 let mut parts=path.split('?'); let pathname=parts.next().unwrap_or(""); let query=parts.next();
 if parts.next().is_some() || !pathname.starts_with("/v1/") || pathname.contains("//") || !pathname.chars().all(|c|c.is_ascii_alphanumeric()||"/_-".contains(c)) {return false;}
 if let Some(q)=query {
  if method!="GET" || q.is_empty(){return false;}
  for pair in q.split('&') {
   let Some((key,value))=pair.split_once('=') else{return false;};
   if key.is_empty() || !key.chars().all(|c|c.is_ascii_lowercase()||c=='_') || !value.chars().all(|c|c.is_ascii_alphanumeric()||"_%+.-".contains(c)) {return false;}
   let bytes=value.as_bytes();let mut decoded=Vec::new();let mut i=0;
   while i<bytes.len() {if bytes[i]==b'%' {if i+2>=bytes.len(){return false;}let Some(hi)=(bytes[i+1] as char).to_digit(16) else{return false;};let Some(lo)=(bytes[i+2] as char).to_digit(16) else{return false;};decoded.push((hi*16+lo) as u8);i+=3;}else{decoded.push(bytes[i]);i+=1;}}
   let Ok(text)=String::from_utf8(decoded) else{return false;};if text.chars().any(|c|c.is_control()){return false;}
  }
 }
 let route=pathname.trim_start_matches("/v1/");
 if route.starts_with("auth/") {return query.is_none() && matches!((route,method),("auth/me","GET")|("auth/logout","POST"));}
 if route.starts_with("members") || route.starts_with("agents") {
  return query.is_none() && (matches!((route,method),("members","GET")|("agents","GET")|("members/invite","POST")|("agents/pair/approve","POST")) || method=="POST" && [ ("members/","/disable"),("agents/","/revoke") ].iter().any(|(pre,suf)| route.strip_prefix(pre).and_then(|v|v.strip_suffix(suf)).is_some_and(|id|!id.is_empty() && !id.contains('/'))));
 }
 let segments:Vec<_>=route.split('/').collect();let id_ok=|id:&str|!id.is_empty()&&id.chars().all(|c|c.is_ascii_alphanumeric()||"_-".contains(c));
 match (method,segments.as_slice()) {
  ("GET",["attachments"|"me"|"health"|"workspaces"|"people"|"notifications"|"tags"|"activity"|"projects"|"experiments"|"ideas"|"collaboration"])=>true,
  ("GET",["projects"|"experiments"|"ideas",id])=>id_ok(id),
  ("GET",["projects",id,"retrospectives"|"comments"|"agreement"])=>id_ok(id),
  ("POST",["projects",id,"agreement"])=>query.is_none()&&id_ok(id),
  ("GET",["collaboration","notifications"])=>true,
  ("POST",["collaboration","notifications","read"])=>query.is_none(),
  ("POST",["notifications","read"])=>query.is_none(),
  ("POST",["commands"])=>true,
  ("POST",["attachments","link"])=>query.is_none(),
  ("POST",["attachments",id,"preview"])=>query.is_none()&&id_ok(id),
  ("GET",["attachments",id,"content"])=>query.is_none()&&id_ok(id),
  ("POST",["profile","avatar"|"name"])=>query.is_none(),
  ("POST",["batches",id,"preview"|"undo"])=>id_ok(id),
  _=>false,
 }
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
#[derive(Clone)]
struct SessionSnapshot { endpoint: Option<String>, token: Option<String>, profile: Option<Value>, generation: u64 }
fn snapshot_locked(state:&Session, trusted:Option<String>)->Result<SessionSnapshot,String> {
 let endpoint=state.endpoint.clone().or(trusted);
 if state.token.is_some() && state.token_origin!=endpoint {return Err("凭据与服务地址不匹配，请重新登录。".into());}
 Ok(SessionSnapshot{endpoint,token:state.token.clone(),profile:state.profile.clone(),generation:state.generation})
}
fn session_snapshot()->Result<SessionSnapshot,String> {
 let state=session().lock().unwrap();
 let trusted=if state.endpoint.is_none() {std::env::var("GRAYBOX_SERVER_URL").or_else(|_|std::env::var("GRAYBOX_ENDPOINT")).ok().map(|raw|trusted_origin(&raw)).transpose()?}else{None};
 snapshot_locked(&state,trusted)
}
fn cloud_endpoint()->Result<Option<String>,String> {Ok(session_snapshot()?.endpoint)}
#[tauri::command] fn connection_info()->Result<Value,String> {
 let snapshot=session_snapshot()?;
 let endpoint=snapshot.endpoint;
 if endpoint.is_none() && std::env::var("GRAYBOX_CREDENTIALS_PATH").is_ok() { credentials()?; return Ok(json!({"mode":"local","endpoint":"http://127.0.0.1:4318"})); }
 Ok(json!({"mode":"cloud","endpoint":endpoint.unwrap_or_default(),"profile":snapshot.profile}))
}
#[tauri::command] fn configure_endpoint(endpoint:String)->Result<Value,String> {let origin=trusted_origin(&endpoint)?; session_store::clear()?; {let mut s=session().lock().unwrap();s.endpoint=Some(origin);s.token=None;s.token_origin=None;s.profile=None;s.generation+=1;} connection_info()}
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
 let snapshot=session_snapshot()?;
 let endpoint=snapshot.endpoint.ok_or("请先指定云端 HTTPS 服务地址。")?;
 let generation=snapshot.generation;
 let result=fetch_api(&endpoint,&format!("/v1/auth/{}",kind),"POST",Some(body),None).await?;
 if let Some(error)=result.get("error") {return Err(error.get("message").and_then(Value::as_str).unwrap_or("登录失败。").into());}
 let data=&result["data"]; let token=data["token"].as_str().ok_or("认证响应缺少凭据。")?.to_owned();
 let profile=data["profile"].clone(); if !profile.is_object(){return Err("认证响应缺少身份。".into());}
 {let mut s=session().lock().unwrap(); if s.generation!=generation || s.endpoint.as_ref().is_some_and(|value|value!=&endpoint) {return Err("服务地址已变更，请重新登录。".into());} session_store::save(&session_store::SavedSession{endpoint:endpoint.clone(),token:token.clone(),profile:profile.clone()})?;s.endpoint=Some(endpoint.clone());s.token_origin=Some(endpoint);s.token=Some(token);s.profile=Some(profile.clone());s.generation+=1;}
 Ok(json!({"profile":profile,"expires_at":data["expires_at"]}))
}
#[tauri::command] async fn api_request(profile_id:String,path:String,method:String,body:Option<Value>)->Result<Value,String> {
 if !allowed_request(&path,&method){return Err("请求路径或方法不被允许。".into());}
 let snapshot=session_snapshot()?;
 if snapshot.endpoint.is_some() && !profile_id.is_empty() && snapshot.profile.as_ref().and_then(|p|p["id"].as_str())!=Some(profile_id.as_str()) {return Err("请求身份与当前会话不匹配。".into());}
 let (endpoint,token)=if let Some(endpoint)=snapshot.endpoint.clone() {(endpoint,snapshot.token.clone())}else{("http://127.0.0.1:4318".into(),Some(credentials()?.humans.into_iter().find(|h|h.id==profile_id).ok_or("本地身份不存在。")?.token))};
 if session().lock().unwrap().generation!=snapshot.generation {return Err("会话已变更，请重新读取数据。".into());}
 let result=fetch_api(&endpoint,&path,&method,body,token.clone()).await?;
 if (path=="/v1/auth/logout" && result.get("error").is_none()) || result["error"]["code"]=="UNAUTHORIZED" {let mut s=session().lock().unwrap();if s.generation==snapshot.generation && s.token==token {session_store::clear()?;s.token=None;s.token_origin=None;s.profile=None;s.generation+=1;}}
 Ok(result)
}
fn show_main(app:&tauri::AppHandle){if let Some(window)=app.get_webview_window("main"){let _=window.unminimize();let _=window.show();let _=window.set_focus();}}
fn main(){tauri::Builder::default()
 .plugin(tauri_plugin_single_instance::init(|app,_,_|show_main(app)))
 .setup(|app|{
  if let Some(saved)=session_store::load(){if trusted_origin(&saved.endpoint).ok().as_deref()==Some(saved.endpoint.as_str()) && std::env::var("GRAYBOX_SERVER_URL").ok().map(|v|trusted_origin(&v).ok().as_deref()==Some(saved.endpoint.as_str())).unwrap_or(true){let mut s=session().lock().unwrap();s.endpoint=Some(saved.endpoint.clone());s.token_origin=Some(saved.endpoint);s.token=Some(saved.token);s.profile=Some(saved.profile);}}
  use tauri::{menu::{Menu,MenuItem},tray::{TrayIconBuilder,TrayIconEvent,MouseButton,MouseButtonState}};
  let open=MenuItem::with_id(app,"open","打开 Graybox",true,None::<&str>)?;
  let quit=MenuItem::with_id(app,"quit","退出",true,None::<&str>)?;
  let menu=Menu::with_items(app,&[&open,&quit])?;
  let pixels:Vec<u8>=(0..32*32).flat_map(|i|{let x=i%32;let y=i/32;if (x>=7&&x<=23&&(y>=7&&y<=10||y>=21&&y<=24)) || (x>=7&&x<=10&&y>=7&&y<=24) || (x>=19&&x<=23&&y>=16&&y<=24) || (x>=16&&x<=23&&y>=16&&y<=19){[220,237,226,255]}else{[47,75,61,255]}}).collect();
  TrayIconBuilder::with_id("graybox").icon(tauri::image::Image::new_owned(pixels,32,32)).tooltip("Graybox").menu(&menu).show_menu_on_left_click(false)
   .on_menu_event(|app,event|match event.id.as_ref(){"open"=>show_main(app),"quit"=>app.exit(0),_=>{}})
   .on_tray_icon_event(|tray,event|{if matches!(event,TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}){show_main(tray.app_handle());}}).build(app)?;
  Ok(())
 })
 .on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{if window.label()=="main"{api.prevent_close();let _=window.hide();}}})
 .invoke_handler(tauri::generate_handler![connection_info,configure_endpoint,authenticate,local_profiles,api_request,attachment_bridge::attachment_transfer]).run(tauri::generate_context!()).expect("Graybox desktop could not start");}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn native_snapshot_keeps_endpoint_token_and_generation_coherent(){let mut state=Session::default(); state.endpoint=Some("https://a.example".into());state.token=Some("token-a".into());state.token_origin=state.endpoint.clone();state.generation=1;let old=snapshot_locked(&state,None).unwrap();state.endpoint=Some("https://b.example".into());state.token=Some("token-b".into());state.token_origin=state.endpoint.clone();state.generation=2;let new=snapshot_locked(&state,None).unwrap();assert_eq!(old.endpoint.as_deref(),Some("https://a.example"));assert_eq!(old.token.as_deref(),Some("token-a"));assert_eq!(old.generation,1);assert_eq!(new.endpoint.as_deref(),Some("https://b.example"));assert_eq!(new.token.as_deref(),Some("token-b"));state.token_origin=Some("https://a.example".into());assert!(snapshot_locked(&state,None).is_err());}
 #[test]
 #[ignore = "requires explicitly configured local development API and credential file"]
 fn native_bridge_reads_real_local_api_without_exposing_tokens(){let profiles=local_profiles().expect("local profiles available"); assert_eq!(profiles.len(),3); let public=serde_json::to_value(&profiles).unwrap();assert!(public.as_array().unwrap().iter().all(|p|p.get("token").is_none()));let me=tauri::async_runtime::block_on(api_request(profiles[0].id.clone(),"/v1/me".into(),"GET".into(),None)).unwrap();assert_eq!(me["data"]["kind"],"human");let workspaces=tauri::async_runtime::block_on(api_request(profiles[0].id.clone(),"/v1/workspaces".into(),"GET".into(),None)).unwrap();let workspace=workspaces["data"][0]["id"].as_str().unwrap();let tags=tauri::async_runtime::block_on(api_request(profiles[0].id.clone(),format!("/v1/tags?workspace_id={}&q=%E6%B8%B8%E6%88%8F",workspace),"GET".into(),None)).unwrap();assert!(tags["data"].is_array());}
 #[test] fn library_queries_allow_encoding_only_in_values(){assert!(allowed_request("/v1/tags?workspace_id=abc-123&q=%E6%B8%B8%E6%88%8F","GET"));assert!(allowed_request("/v1/projects?tag=Game%20Art","GET"));for p in ["/v1/tags?q=%ZZ","/v1/tags?q=%00","/v1/projects%2f..%2fsecret","/v1/projects/a/unknown"] {assert!(!allowed_request(p,"GET"));}assert!(!allowed_request("/v1/tags","POST"));}
 #[test] fn social_routes_are_precise(){for p in ["/v1/notifications","/v1/notifications?before=abc-123","/v1/projects/abc/agreement"]{assert!(allowed_request(p,"GET"));}for p in ["/v1/notifications/read","/v1/projects/abc/agreement"]{assert!(allowed_request(p,"POST"));}for (p,m) in [("/v1/notifications/read","GET"),("/v1/notifications","POST"),("/v1/projects/abc/agreement/extra","POST"),("/v1/projects/abc","POST")]{assert!(!allowed_request(p,m));}}
 #[test] fn nickname_routes_are_precise(){assert!(allowed_request("/v1/profile/name","POST"));assert!(!allowed_request("/v1/profile/name","GET"));assert!(!allowed_request("/v1/profile/name/other","POST"));assert!(!allowed_request("/v1/profile/name?name=other","POST"));}
 #[test] fn avatar_routes_are_precise(){assert!(allowed_request("/v1/people","GET"));assert!(allowed_request("/v1/profile/avatar","POST"));assert!(!allowed_request("/v1/people","POST"));assert!(!allowed_request("/v1/profile/avatar","GET"));assert!(!allowed_request("/v1/profile/avatar/other","POST"));}
 #[test] fn auth_routes_are_precise(){assert!(allowed_request("/v1/auth/me","GET"));assert!(allowed_request("/v1/agents/pair/approve","POST"));assert!(!allowed_request("/v1/auth/login","GET"));assert!(!allowed_request("/v1/members/invite","GET"));assert!(!allowed_request("/v1/agents/a/revoke/extra","POST"));assert!(!allowed_request("/v1/auth/pair/poll","POST"));assert!(!allowed_request("/v1/../admin","GET"));}
 #[test] fn endpoint_rejects_credentials_paths_and_insecure_urls(){assert_eq!(trusted_origin("https://example.com/").unwrap(),"https://example.com");for value in ["http://example.com","https://user:pass@example.com","https://example.com/v1","https://example.com?secret=x","file:///secret"] {assert!(trusted_origin(value).is_err());}}
 #[test] fn only_allows_graybox_api_routes_and_safe_methods(){assert!(allowed_request("/v1/projects","GET"));assert!(allowed_request("/v1/experiments?project_id=abcd-1234","GET"));assert!(allowed_request("/v1/commands","POST"));assert!(!allowed_request("https://example.com","GET"));assert!(!allowed_request("/v1/commands","DELETE"));assert!(!allowed_request("/v1/projects%2f..%2fsecret","GET"));}
}




