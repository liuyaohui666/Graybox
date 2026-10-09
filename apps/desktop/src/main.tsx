import React, { useEffect, useRef, useState, useContext, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { profiles, request, ApiError, type Profile } from "./platform.ts";
import { commandRetry } from "./retry.ts";
import { writeSafety } from "./write-safety.ts";
import {
  evidenceLabel,
  statusLabel,
  type Project,
  type Experiment,
  type Activity,
  type UndoPreview,
} from "./model.ts";
import "./styles.css";
import "./workbench.css";
import {NavigationIcon} from "./navigation-icon.tsx";
import {Attribution,PeopleProvider,SidebarAccount} from "./avatars.tsx";
import { LibraryNavigation, LatestProfileRefresh } from "./library-app-state.ts";
import {TeamSpace,MemberPage} from "./team-space.tsx";
import {SocialProvider,NotificationEntry,Inbox} from "./team-social.tsx";
import { ProjectLibrary } from "./project-library.tsx";
import { SessionGate, ConnectionModeContext } from "./cloud-ui.tsx";
import {CollaborationWorkbench} from './collaboration-workbench.tsx';
import './collaboration.css';

type Page = "home" | "projects" | "experiments" | "activity" | "member" | "messages";
type DialogKind = "project" | "experiment" | "summary" | "evidence" | null;
const typeNames: Record<string, string> = {
  git: "Git 记录",
  build: "构建",
  test: "测试",
  launch: "启动",
  metric: "指标",
  change: "变更",
};
const date = (s?: string) =>
  s
    ? new Date(s).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function LegacyApp() {
  const mode = useContext(ConnectionModeContext);
  const pendingWrite = useSyncExternalStore(writeSafety.subscribe, writeSafety.snapshot);
  const [people, setPeople] = useState<Profile[]>([]),
    [profile, setProfile] = useState("");
  const [memberId,setMemberId]=useState(""),[socialProject,setSocialProject]=useState("");
  const [createdProject, setCreatedProject] = useState("");
  const [libraryTag,setLibraryTag]=useState("");
  const refreshState = useRef(new LatestProfileRefresh()), mutationLock = useRef(false);
  const navigation = useRef(new LibraryNavigation());
  const [navigationGeneration, setNavigationGeneration] = useState(0);
  const [refreshError, setRefreshError] = useState("");
  const [page, setPage] = useState<Page>("home"),
    [projects, setProjects] = useState<Project[]>([]),
    [experiments, setExperiments] = useState<Experiment[]>([]),
    [activity, setActivity] = useState<Activity[]>([]);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [detail, setDetail] = useState<Experiment | null>(null),
    [projectFilter, setProjectFilter] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<DialogKind>(null),
    [undo, setUndo] = useState<UndoPreview | null>(null);
  const modal = useRef<HTMLDialogElement>(null),
    undoModal = useRef<HTMLDialogElement>(null),
    identity = useRef(""),
    selection = useRef("");
  const pending = useRef(commandRetry);
  const activeProfile = people.find((p) => p.id === profile);
  const editableProjects = projects.filter(p => p.can_edit);
  const detailCanEdit = !!detail && projects.some(p => p.id === detail.project_id && p.can_edit);
  const canPreviewUndo = (entry: Activity) => {
    const batch = activity.filter(a => a.batch_id === entry.batch_id);
    return batch.length > 0 && batch.every(a => a.human_id === profile && !a.agent_id &&
      !["comment", "retrospective"].includes(a.entity_type) && projects.some(p => p.id === a.project_id && p.can_edit));
  };
  function navigate(next: Page, completedWrite=false) {
    const generation = navigation.current.accept(busy,mutationLock.current,writeSafety.snapshot(),completedWrite);
    if (generation === null) return false;
    setNavigationGeneration(generation);
    setSocialProject("");
    setCreatedProject("");
    selection.current = "";
    setDetail(null);
    setPage(next);
    return true;
  }
  const openLibraryTag=(tag:string)=>{if(navigate("projects"))setLibraryTag(tag);};
  async function refresh(id = profile) {
    if (!id) return;
    await refreshState.current.run(id, () => identity.current, () => Promise.all([
      request<Project[]>(id, "/v1/projects"),
      request<Experiment[]>(id, "/v1/experiments"),
      request<Activity[]>(id, "/v1/activity"),
      request<{ id: string; name: string }[]>(id, "/v1/workspaces"),
    ]), (values) => {
      setProjects(values[0]);
      setExperiments(
        values[1].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      );
      setActivity(
        values[2].sort((a, b) =>
          (b.created_at ?? "").localeCompare(a.created_at ?? ""),
        ),
      );
      setWorkspaces(values[3]);
      setLoaded(true);
      setRefreshError("");
    }, (error) => setRefreshError(error.message));
  }
  useEffect(() => {
    profiles()
      .then((ps) => {
        setPeople(ps);
        if (ps[0]) setProfile(ps[0].id);
      })
      .catch((e) => setError(String(e.message)));
  }, []);
  useEffect(() => {
    identity.current = profile;
    selection.current = "";
    setDetail(null);
    setDialog(null);
    setUndo(null);
    setProjectFilter("");
    setSocialProject("");
    setCreatedProject("");
    setLibraryTag("");
    setWorkspaces([]);
    setProjects([]);
    setExperiments([]);
    setActivity([]);
    setLoaded(false);
    setError("");
    setRefreshError("");
    if (!writeSafety.snapshot()) pending.current.clear();
    if (!profile) return;
    const update = () => { void refresh(profile); };
    update();
    const interval = setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", update);
    };
  }, [profile]);
  useEffect(() => {
    if (dialog) modal.current?.showModal();
    else modal.current?.close();
  }, [dialog]);
  useEffect(() => {
    if (undo) undoModal.current?.showModal();
    else undoModal.current?.close();
  }, [undo]);
  async function showExperiment(id: string) {
    const requestedProfile = profile;
    selection.current = id;
    setError("");
    try {
      const d = await request<Experiment>(profile, "/v1/experiments/" + id);
      if (selection.current === id && identity.current === requestedProfile)
        setDetail(d);
    } catch (e) {
      if (identity.current === requestedProfile) setError((e as Error).message);
    }
  }
  async function send(type: string, payload: object, revision?: number) {
    const body = pending.current.prepare(profile, type, payload, revision);
    try {
      const result = await request<Project | Experiment>(
        profile,
        "/v1/commands",
        "POST",
        body,
      );
      pending.current.clear();
      return result;
    } catch (error) {
      if (error instanceof ApiError) pending.current.rejected(error.code);
      throw error;
    }
  }
  async function mutate(type: string, payload: object, revision?: number) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await send(type, payload, revision);
      if (type === "project_create") { navigate("projects",true); setCreatedProject(result.id); }
      setDialog(null);
      setNotice(
        type === "review_submit"
          ? "已提交验收快照，等待人工判断。"
          : "记录已保存。",
      );
      if ("series_id" in result) setDetail(result);
      try {
        await refresh();
        if ("series_id" in result) await showExperiment(result.id);
      } catch {
        setError(
          "记录已保存，但列表刷新失败。请重新读取最新数据，无需重复保存。",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  function saveForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const value = (k: string) => String(f.get(k) ?? "").trim();
    if ((dialog === "experiment" && !editableProjects.some(p => p.id === value("project"))) ||
        ((dialog === "summary" || dialog === "evidence") && !detailCanEdit)) {
      setError("仅项目 owner 可以编辑此项目的实验。");return;
    }
    if (dialog === "project")
      void mutate("project_create", {
        workspace_id: value("workspace"),
        name: value("name"),
        description: value("description"),
      });
    if (dialog === "experiment")
      void mutate("experiment_create", {
        project_id: value("project"),
        series_name: value("series"),
        name: value("name"),
        goal: value("goal"),
      });
    if (dialog === "summary" && detail)
      void mutate(
        "experiment_update",
        {
          id: detail.id,
          summary: value("summary"),
          change_summary: value("changes"),
        },
        detail.revision,
      );
    if (dialog === "evidence" && detail) {
      const type = value("type");
      const details =
        type === "change"
          ? { summary: value("summary") }
          : {
              command: value("command"),
              summary: value("summary"),
              ...(value("exit_code") !== ""
                ? { exit_code: Number(value("exit_code")) }
                : {}),
            };
      void mutate(
        "evidence_append",
        {
          experiment_id: detail.id,
          type,
          source_kind: "agent_reported",
          result: value("result"),
          details,
        },
        detail.revision,
      );
    }
  }
  async function previewUndo(batchId: string) {
    setBusy(true);
    setError("");
    try {
      setUndo(
        await request(profile, `/v1/batches/${batchId}/preview`, "POST", {}),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function executeUndo() {
    if (!undo) return;
    setBusy(true);
    setError("");
    try {
      await request(profile, `/v1/batches/${undo.batch_id}/undo`, "POST", {
        expected_batch_revision: undo.batch_revision,
        preview_token: undo.preview_token,
        idempotency_key:
          undo.request_id ?? (undo.request_id = crypto.randomUUID()),
      });
      setUndo(null);
      setDetail(null);
      setNotice("批次已撤销。原始记录和补偿日志均已保留。");
      try {
        await refresh();
      } catch {
        setError(
          "批次已撤销，但列表刷新失败。请重新读取最新数据，无需重复撤销。",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const view = experiments.filter(
      (e) =>
        (!projectFilter || e.project_id === projectFilter) &&
        (!filter ||
          `${e.name} ${e.goal} ${e.summary ?? ""}`
            .toLowerCase()
            .includes(filter.toLowerCase())),
    );
  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? "项目";
  return (
    <PeopleProvider profile={profile} mode={mode}><SocialProvider profile={profile} setBusy={setBusy}><div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandmark" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="15" height="15" rx="2"/><path d="M8 21h13V8"/></svg></span>
          <div>
            Graybox
          </div>
        </div>
        <nav inert={busy || !!pendingWrite}>
          {(
            [
              ["home", "◫", "项目"],
              ["projects", "▣", "全部项目"],
              ["experiments", "◇", "实验"],
              ["activity", "≋", "活动记录"],
            ] as const
          ).map(([id, , label]) => (
            <button
              key={id}
              aria-label={label}
              aria-current={page === id ? "page" : undefined}
              className={page === id ? "active" : ""}
              onClick={() => {
                navigate(id);
                setFilter("");
              }}
            >
              <span aria-hidden="true"><NavigationIcon name={id}/></span>
              {label}
            </button>
          ))}
        </nav>

        <SidebarAccount profile={profile} person={activeProfile} locked={busy||!!pendingWrite} setBusy={setBusy}/>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="muted">工作空间</span>
            <span className="crumb">/</span>
            {
              {
                home: "项目",
                projects: "全部项目",
                experiments: "实验",
                activity: "活动记录",
                member: "成员主页",
                messages: "我的消息",
              }[page]
            }
          </div>
          <NotificationEntry locked={busy||!!pendingWrite} open={()=>navigate("messages")}/>
          <span className="local-status">
            {mode === "cloud" ? "云端" : "本地"}
          </span>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <h1>
                {
                  {
                    home: "项目",
                    projects: "全部项目",
                    experiments: "实验记录",
                    activity: "活动记录",
                    member: "成员主页",
                    messages: "我的消息",
                  }[page]
                }
              </h1>

            </div>
            <button
              className="primary"
              disabled={!loaded || busy || !!pendingWrite || (page === "experiments" && projects.length > 0 && editableProjects.length === 0)}
              onClick={() =>
                setDialog(
                  page !== "experiments" || projects.length === 0
                    ? "project"
                    : "experiment",
                )
              }
            >
              ＋{" "}
              {page !== "experiments" || projects.length === 0
                ? "新建想法"
                : "新建实验"}
            </button>
          </div>
          {(error || refreshError) && (
            <div className="error" role="alert">
              <strong>操作未完成</strong>
              <span>{error || refreshError}</span>
              <button
                onClick={() => {
                  void refresh();
                  if (detail && !error) void showExperiment(detail.id);
                }}
              >
                重新读取最新数据
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              ✓ {notice}
              <button aria-label="关闭提示" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
          {!loaded && !error && !refreshError && <div className="empty">正在读取项目…</div>}
          {loaded && (
            <div className={detail ? "with-detail" : "without-detail"}>
              <section className="main-column" inert={busy}>
                {(page === "home" || page === "projects") && <TeamSpace projects={projects} locked={busy||!!pendingWrite} openMember={id=>{if(navigate("member"))setMemberId(id);}}/>}
                {page === "member" && !socialProject && <MemberPage id={memberId} projects={projects} locked={busy||!!pendingWrite} openProject={id=>{if(!busy&&!mutationLock.current&&!writeSafety.snapshot())setSocialProject(id);}} back={()=>navigate("home")}/>}
                {page === "messages" && !socialProject && <Inbox locked={busy||!!pendingWrite} openProject={id=>{if(!busy&&!mutationLock.current&&!writeSafety.snapshot())setSocialProject(id);}}/>}
                {(page === "member" || page === "messages") && !!socialProject && <ProjectLibrary key={`${navigationGeneration}:${socialProject}`} profile={profile} page="projects" projects={projects} experiments={experiments} createdId={socialProject} busy={busy} setBusy={setBusy} send={send} refresh={()=>refresh()} tagFilter={libraryTag} openTag={openLibraryTag} backLabel={page==="member"?"成员主页":"消息箱"} onBack={()=>{if(!busy&&!mutationLock.current&&!writeSafety.snapshot())setSocialProject("");}} openExperiment={id=>{if(navigate("experiments"))void showExperiment(id);}}/>}
                {(page === "home" || page === "projects") && <ProjectLibrary key={navigationGeneration} profile={profile} page={page} projects={projects} experiments={experiments} createdId={createdProject} busy={busy} setBusy={setBusy} send={send} refresh={() => refresh()} tagFilter={libraryTag} openTag={openLibraryTag} openExperiment={(id) => {if(navigate("experiments"))void showExperiment(id);}} />}
                {page === "experiments" && (
                  <div className="filters">
                    <input
                      aria-label="筛选实验"
                      placeholder="筛选名称、目标或摘要…"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                    <select
                      aria-label="按项目筛选"
                      value={projectFilter}
                      onChange={(e) => setProjectFilter(e.target.value)}
                    >
                      <option value="">所有项目</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {page === "experiments" && (
                  <div className="experiment-table">
                    <div className="table-head">
                      <span>实验 / 项目</span>
                      <span>状态</span>
                      <span>最近记录</span>
                    </div>
                    {view.map(
                      (e) => (
                        <button
                          key={e.id}
                          className={
                            "experiment-row " +
                            (detail?.id === e.id ? "selected" : "")
                          }
                          onClick={() => void showExperiment(e.id)}
                        >
                          <span className="row-name">
                            <span className="mini-version">v{e.version}</span>
                            <span>
                              <strong>{e.name}</strong>
                              <small>{projectName(e.project_id)}</small>
                            </span>
                          </span>
                          <span>
                            <span className={"status " + e.status}>
                              {statusLabel(e.status)}
                            </span>
                          </span>
                          <time>{date(e.updated_at)}</time>
                        </button>
                      ),
                    )}
                    {view.length === 0 && (
                      <div className="empty compact">
                        还没有符合条件的实验。
                      </div>
                    )}
                  </div>
                )}
                {page === "activity" && (
                  <div className="activity-list">
                    {activity.map((a) => (
                      <article key={a.id}>
                        <span className="timeline-dot" />
                        <div>
                          <strong>
                            {(
                              {
                                project_create: "新建项目",
                                retrospective_create: "添加经验报告",
                                comment_create: "添加讨论",
                                project_update: "更新项目",
                                experiment_create: "新建实验",
                                experiment_update: "更新实验",
                                evidence_append: "追加技术证据",
                                review_submit: "提交待验收",
                                batch_undo: "撤销批次",
                              } as Record<string, string>
                            )[a.type] ?? a.type}
                          </strong>
                          <p>
                            {a.entity_type} · {a.entity_id.slice(0, 8)}
                          </p>
                          <small>
                            <Attribution id={a.human_id} agentId={a.agent_id}/> ·{" "}
                            {date(a.created_at ?? a.timestamp)}
                          </small>
                          <details>
                            <summary>查看变更</summary>
                            <pre>
                              {JSON.stringify(
                                { before: a.before, after: a.after },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        </div>
                        {a.batch_id && (
                          <button
                            className="secondary small"
                            disabled={busy || !!pendingWrite || !canPreviewUndo(a)}
                            onClick={() => void previewUndo(a.batch_id)}
                          >
                            预览撤销
                          </button>
                        )}
                      </article>
                    ))}
                    {!activity.length && (
                      <div className="empty">还没有活动记录。</div>
                    )}
                  </div>
                )}
              </section>
              {detail && (
                <aside className="detail-panel">
                  <div className="detail-top">
                    <span>实验详情</span>
                    <button
                      aria-label="关闭实验详情"
                      disabled={busy}
                      onClick={() => {
                        setDetail(null);
                        selection.current = "";
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div className="detail-body">
                    <span className="project-path">
                      {projectName(detail.project_id)}
                    </span>
                    <h2>
                      {detail.name}{" "}
                      <span className="version">v{detail.version}</span>
                    </h2>
                    <div className="detail-meta">
                      <span className={"status " + detail.status}>
                        {statusLabel(detail.status)}
                      </span>
                      <span>记录修订 {detail.revision}</span>
                    </div>
                    <h4>实验目标</h4>
                    <p className="prose">{detail.goal}</p>
                    <div className="label-action">
                      <h4>本次总结</h4>
                      <button
                        disabled={busy || !!pendingWrite || !detailCanEdit}
                        onClick={() => setDialog("summary")}
                      >
                        编辑
                      </button>
                    </div>
                    <p className="prose">
                      {detail.summary || "尚未记录总结。"}
                    </p>
                    {detail.change_summary && (
                      <p className="prose muted">{detail.change_summary}</p>
                    )}
                    <div className="label-action">
                      <h4>
                        技术证据 <span>{detail.evidence?.length ?? 0}</span>
                      </h4>
                      <button
                        disabled={busy || !!pendingWrite || !detailCanEdit}
                        onClick={() => setDialog("evidence")}
                      >
                        ＋ 记录
                      </button>
                    </div>
                    <div className="evidence-list">
                      {detail.evidence?.map((e) => (
                        <div key={e.id} className="evidence">
                          <div>
                            <strong>{typeNames[e.type] ?? e.type}</strong>
                            <span className={"result " + e.result}>
                              {evidenceLabel(e.result)}
                            </span>
                          </div>
                          <p>
                            {String(
                              e.details.summary ??
                                e.details.name ??
                                "Git 提交记录",
                            )}
                          </p>
                          {Boolean(e.details.command) && (
                            <code>{String(e.details.command)}</code>
                          )}
                          <small>
                            {e.source_kind === "agent_reported"
                              ? "提交者报告，未独立复核"
                              : e.source_kind}{" "}
                            · {date(e.created_at)}
                          </small>
                        </div>
                      ))}
                      {!detail.evidence?.length && (
                        <p className="muted small-copy">
                          尚无证据。没有执行的验证应明确记为“未执行”。
                        </p>
                      )}
                    </div>
                    <h4>人工验收</h4>
                    <p className="small-copy muted">
                      技术报告与人工判断分别保存。构建或测试通过，不代表玩法已经验收。
                    </p>
                    {detail.submissions?.map((s) => (
                      <details className="submission" key={s.id}>
                        <summary>验收快照 · {date(s.created_at)}</summary>
                        <pre>{JSON.stringify(s.snapshot, null, 2)}</pre>
                      </details>
                    ))}
                    <div className="detail-actions">
                      {(detail.status === "idea" ||
                        detail.status === "waiting_for_review") && (
                        <button
                          className="secondary"
                          disabled={busy || !detailCanEdit}
                          onClick={() =>
                            void mutate(
                              "experiment_update",
                              { id: detail.id, status: "experimenting" },
                              detail.revision,
                            )
                          }
                        >
                          {detail.status === "waiting_for_review"
                            ? "继续实验"
                            : "开始实验"}
                        </button>
                      )}
                      <button
                        className="primary"
                        disabled={
                          busy || !detailCanEdit || detail.status === "waiting_for_review"
                        }
                        onClick={() =>
                          void mutate(
                            "review_submit",
                            { experiment_id: detail.id },
                            detail.revision,
                          )
                        }
                      >
                        {detail.status === "waiting_for_review"
                          ? "已提交 · 等待判断"
                          : "提交待验收 →"}
                      </button>
                    </div>
                  </div>
                </aside>
              )}
            </div>
          )}
          <footer className="footer">
            <span>Graybox</span>
            <span>{mode === "cloud" ? "云端版本" : "本地版本"} 0.3.3</span>
          </footer>
        </div>
      </main>
      <dialog ref={modal} onCancel={() => setDialog(null)}>
        <form onSubmit={saveForm}>
          <div className="modal-heading">
            <h2>
              {
                {
                  project: "新建想法",
                  experiment: "开启一次实验",
                  summary: "记录本次总结",
                  evidence: "添加技术证据",
                }[dialog ?? "project"]
              }
            </h2>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setDialog(null)}
            >
              ×
            </button>
          </div>
          {dialog === "project" && (
            <>
              <label>
                所属空间
                <select name="workspace">
                  {workspaces.map((w) => (
                    <option value={w.id} key={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                项目名称
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder="例如：菲比啾比"
                />
              </label>
              <label>
                项目说明
                <textarea name="description" rows={3} />
              </label>
            </>
          )}
          {dialog === "experiment" && (
            <>
              <label>
                所属项目
                <select name="project" defaultValue={editableProjects.some(p => p.id === projectFilter) ? projectFilter : editableProjects[0]?.id}>
                  {editableProjects.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                实验方向
                <input
                  name="series"
                  required
                  maxLength={120}
                  placeholder="例如：礼帽驯服"
                />
              </label>
              <label>
                本次尝试名称
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder="例如：距离与交互反馈"
                />
              </label>
              <label>
                要验证什么？
                <textarea
                  name="goal"
                  required
                  rows={3}
                  placeholder="写清这一版希望验证的目标。"
                />
              </label>
            </>
          )}
          {dialog === "summary" && (
            <>
              <label>
                本次总结
                <textarea
                  name="summary"
                  rows={5}
                  defaultValue={detail?.summary}
                />
              </label>
              <label>
                修改内容
                <textarea
                  name="changes"
                  rows={3}
                  defaultValue={detail?.change_summary}
                />
              </label>
            </>
          )}
          {dialog === "evidence" && (
            <>
              <div className="form-row">
                <label>
                  证据类型
                  <select name="type">
                    <option value="test">测试</option>
                    <option value="build">构建</option>
                    <option value="launch">启动</option>
                    <option value="change">变更说明</option>
                  </select>
                </label>
                <label>
                  报告结果
                  <select name="result" defaultValue="not_run">
                    <option value="not_run">未执行</option>
                    <option value="passed">报告通过</option>
                    <option value="failed">报告失败</option>
                    <option value="inconclusive">尚无结论</option>
                  </select>
                </label>
              </div>
              <label>
                运行命令
                <input name="command" placeholder="按实际执行情况填写" />
              </label>
              <label>
                退出码（如有）
                <input name="exit_code" type="number" />
              </label>
              <label>
                结果与验证范围
                <textarea
                  name="summary"
                  required
                  rows={3}
                  placeholder="只记录实际观察到的结果。"
                />
              </label>
            </>
          )}
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setDialog(null)}
              disabled={busy}
            >
              取消
            </button>
            <button className="primary" disabled={busy || (dialog === "experiment" ? !editableProjects.length : (dialog === "summary" || dialog === "evidence") && !detailCanEdit)}>
              {busy ? "保存中…" : "保存记录"}
            </button>
          </div>
        </form>
      </dialog>
      <dialog ref={undoModal} onCancel={() => setUndo(null)}>
        <div className="modal-heading">
          <h2>撤销批次预览</h2>
          <button aria-label="关闭" onClick={() => setUndo(null)}>
            ×
          </button>
        </div>
        <p className="prose">
          下面的变更将整体补偿。若有人继续修改，服务器会阻止此次撤销。
        </p>
        <div className="undo-changes">
          {undo?.changes?.map((c) => (
            <div key={c.entity_type + c.entity_id}>
              <strong>{c.entity_type}</strong>
              <code>{c.entity_id.slice(0, 8)}</code>
              <span>{c.before ? "恢复此前内容" : "移入回收状态"}</span>
              <details>
                <summary>查看撤销前后内容</summary>
                <pre>
                  {JSON.stringify({ 当前: c.after, 撤销后: c.before }, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button
            className="secondary"
            onClick={() => setUndo(null)}
            disabled={busy}
          >
            保留变更
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => void executeUndo()}
          >
            {busy ? "撤销中…" : "执行本批撤销"}
          </button>
        </div>
      </dialog>
    </div></SocialProvider></PeopleProvider>
  );
}
function App(){
 const mode=useContext(ConnectionModeContext);
 const pending=useSyncExternalStore(writeSafety.subscribe,writeSafety.snapshot);
 const [profile,setProfile]=useState<Profile>(),[error,setError]=useState(''),[accountBusy,setAccountBusy]=useState(false);
 useEffect(()=>{let alive=true;void profiles().then(value=>{if(alive)setProfile(value[0]);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
 if(error)return <main className="session"><p role="alert">{error}</p><button onClick={()=>window.location.reload()}>重新连接</button></main>;
 if(!profile)return <main className="session" role="status">正在读取账号…</main>;
 return <PeopleProvider profile={profile.id} mode={mode}><CollaborationWorkbench profile={profile.id} account={<SidebarAccount profile={profile.id} person={profile} locked={accountBusy||!!pending} setBusy={setAccountBusy}/>} /></PeopleProvider>;
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionGate><App /></SessionGate>
  </React.StrictMode>,
);





