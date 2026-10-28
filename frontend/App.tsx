import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight, Bell, BriefcaseBusiness, Check, CheckCircle2, CircleDollarSign,
  Clock3, Copy, CreditCard, FileText, Grid2X2, HelpCircle,
  List, LockKeyhole, Menu, Moon, MoreHorizontal, Paperclip,
  Plus, Search, Send, Settings, ShieldCheck, Sparkles, Star, Sun, TrendingUp, UploadCloud,
  Users, Wallet, X, Zap, AlertTriangle, ExternalLink, SlidersHorizontal,
  CircleUserRound, LogOut, Code2, Globe2, RefreshCcw,
} from "lucide-react";
import { freelancers, notifications, projects, requirements, testimonials, transactions } from "./mock-data";
import { authApi, type AppRole, type AuthUser } from "./auth-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { createProject as createProjectRequest, fetchFeaturedProjects, fetchProject, fetchProjectProposals, fetchProjects, hireProposal, submitProposal as submitProposalRequest, updateProposalStatus, type ApiProject, type ProjectSearch } from "./project-api";
import { workflowApi, type ApiWorkspace } from "./workflow-api";
import { io } from "socket.io-client";

type Page = "home" | "browse" | "dashboard" | "project" | "workspace" | "transactions" | "profile" | "settings" | "notifications";
type Role = AppRole;
type ModalType = "auth" | "proposal" | "create" | "fund" | "submit" | "approve" | "revision" | "dispute" | null;

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");
type ProjectCardData = Omit<typeof projects[number], "id" | "budget"> & { id: string | number; budget: string | number; requirements?: string[] };

function fromApiProject(project: ApiProject): ProjectCardData {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    budget: project.budget,
    deadline: `${project.durationDays} days`,
    skills: project.skills,
    proposals: project.proposalCount,
    client: project.client.name,
    verified: project.status !== "OPEN",
    requirements: project.requirements?.map((requirement) => requirement.text),
  };
}

function pageFromPathname(pathname: string): Page {
  if (pathname === "/projects") return "browse";
  if (pathname.startsWith("/projects/")) return "project";
  if (pathname.startsWith("/workspace")) return "workspace";
  if (pathname.startsWith("/u/") || pathname === "/profile") return "profile";
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/transactions") return "transactions";
  if (pathname === "/settings") return "settings";
  if (pathname === "/notifications") return "notifications";
  return "home";
}

function Button({ children, variant = "primary", size = "md", className, onClick, disabled, type = "button" }: {
  children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger" | "success"; size?: "sm" | "md" | "lg";
  className?: string; onClick?: () => void; disabled?: boolean; type?: "button" | "submit";
}) {
  const variants = {
    primary: "bg-brand-600 text-white shadow-sm shadow-indigo-300/40 hover:bg-brand-700 dark:shadow-none",
    secondary: "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
    ghost: "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
    danger: "bg-red-600 text-white hover:bg-red-700",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
  };
  const sizes = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-sm", lg: "h-13 px-6 text-base" };
  return <button type={type} disabled={disabled} onClick={onClick} className={cx("inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-indigo-950", variants[variant], sizes[size], className)}>{children}</button>;
}

function Input({ label, placeholder, value, onChange, type = "text", icon, error }: {
  label?: string; placeholder?: string; value?: string; onChange?: (v: string) => void; type?: string; icon?: ReactNode; error?: string;
}) {
  return <label className="block space-y-2">
    {label && <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</span>}
    <span className="relative block">
      {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span>}
      <input type={type} value={value} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} className={cx("h-11 w-full rounded-xl border bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-indigo-100 dark:bg-slate-950 dark:focus:ring-indigo-950", icon ? "pl-10" : "", error ? "border-red-400" : "border-slate-200 dark:border-slate-700")} />
    </span>
    {error && <span className="text-xs font-medium text-red-500">{error}</span>}
  </label>;
}

function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return <div onClick={onClick} className={cx("rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900", className)}>{children}</div>;
}

function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "indigo" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    green: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15 dark:bg-emerald-950 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/15 dark:bg-amber-950 dark:text-amber-300",
    red: "bg-red-50 text-red-700 ring-1 ring-red-600/15 dark:bg-red-950 dark:text-red-300",
    indigo: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600/15 dark:bg-indigo-950 dark:text-indigo-300",
  };
  return <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", tones[tone])}>{children}</span>;
}

function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return <div><div className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white md:text-3xl">{children}</div>{sub && <div className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{sub}</div>}</div>;
}

function Modal({ open, onClose, children, width = "max-w-lg" }: { open: boolean; onClose: () => void; children: ReactNode; width?: string }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={onClose}>
    <Card className={cx("max-h-[90vh] w-full overflow-auto p-6 shadow-2xl", width)} onClick={() => {}}>
      <div onMouseDown={(e) => e.stopPropagation()}>{children}</div>
    </Card>
  </div>;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return <button onClick={onChange} className={cx("relative h-6 w-11 rounded-full transition", checked ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-700")}>
    <span className={cx("absolute top-1 h-4 w-4 rounded-full bg-white shadow transition", checked ? "left-6" : "left-1")} />
  </button>;
}

function ProjectCard({ project, onOpen, compact = false }: { project: ProjectCardData; onOpen: () => void; compact?: boolean }) {
  return <Card className="group flex h-full cursor-pointer flex-col p-5 transition-all hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg dark:hover:border-indigo-800" onClick={onOpen}>
    <div className="flex items-start justify-between gap-3">
      <Badge tone={project.verified ? "green" : "amber"}>{project.verified ? <ShieldCheck size={13} /> : <Clock3 size={13} />}{project.verified ? "Escrow-protected" : "New client"}</Badge>
      <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><MoreHorizontal size={18} /></button>
    </div>
    <div className="mt-4 text-lg font-bold text-slate-900 transition group-hover:text-brand-600 dark:text-white">{project.title}</div>
    {!compact && <div className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{project.description}</div>}
    <div className="mt-4 flex flex-wrap gap-2">{project.skills.map((skill) => <Badge key={skill}>{skill}</Badge>)}</div>
    <div className="mt-auto flex items-end justify-between border-t border-slate-100 pt-5 dark:border-slate-800">
      <div><div className="text-xs text-slate-400">Fixed price</div><div className="mt-1 font-bold text-slate-900 dark:text-white">{project.budget} PYUSD</div></div>
      <div className="text-right text-xs text-slate-500"><div className="flex items-center gap-1"><Clock3 size={13} /> {project.deadline}</div><div className="mt-1">{project.proposals} proposals</div></div>
    </div>
  </Card>;
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const page = pageFromPathname(location.pathname);
  const [role, setRole] = useState<Role>("freelancer");
  const [dark, setDark] = useState(() => window.localStorage.getItem("freelancia-theme") === "dark");
  const [authStatus, setAuthStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState("");
  const [wallet, setWallet] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [modal, setModal] = useState<ModalType>(null);
  const [toast, setToast] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [selectedProject, setSelectedProject] = useState<ProjectCardData>(projects[0]);
  const [processing, setProcessing] = useState(false);
  const projectId = page === "project" ? decodeURIComponent(location.pathname.slice("/projects/".length).split("/")[0] ?? "") : "";
  const workspaceProjectId = page === "workspace" ? decodeURIComponent(location.pathname.slice("/workspace/".length).split("/")[0] ?? "") : "";
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
    enabled: Boolean(projectId && authUser),
  });
  const navbarNotificationsQuery = useQuery({
    queryKey: ["notifications", "navbar", authUser?.id],
    queryFn: () => authApi.notifications(),
    enabled: Boolean(authUser),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    window.localStorage.setItem("freelancia-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    let active = true;
    if (window.localStorage.getItem("freelancia-guest") === "true") {
      setAuthStatus("authenticated");
      return () => { active = false; };
    }
    authApi.restoreSession()
      .then(({ user }) => {
        if (!active) return;
        setAuthUser(user);
        setRole(user.activeRole);
        setWallet(Boolean(user.wallet));
        setAuthStatus("authenticated");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof TypeError) {
          setAuthError("Unable to connect to Freelancia. Make sure the API is running, then try again.");
        }
        setAuthStatus("unauthenticated");
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const go = (next: Page) => {
    const routes: Record<Page, string> = {
      home: "/",
      browse: "/projects",
      dashboard: "/dashboard",
      project: `/projects/${selectedProject.id}`,
      workspace: authUser ? "/workspace" : `/workspace/${selectedProject.id}`,
      transactions: "/transactions",
      profile: "/profile",
      settings: "/settings",
      notifications: "/notifications",
    };
    navigate(routes[next]);
    setMobile(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openProject = (project: ProjectCardData) => {
    setSelectedProject(project);
    navigate(`/projects/${project.id}`);
    setMobile(false);
  };
  const action = (message: string) => setToast(message);
  const markAllNotificationsRead = async () => {
    if (!authUser) {
      action("Sign in to save notification changes.");
      return;
    }
    try {
      await authApi.markAllNotificationsRead();
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      action("All notifications marked as read");
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to update notifications.");
    }
  };
  const openNotification = async (item: { id: string; readAt: string | null; link?: string | null }) => {
    try {
      if (authUser && !item.readAt) {
        await authApi.markNotificationRead(item.id);
        await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }
      setNoticeOpen(false);
      if (item.link?.startsWith("/")) navigate(item.link);
      else go("notifications");
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to update notification.");
    }
  };
  const handleAuthenticated = (user: AuthUser) => {
    window.localStorage.removeItem("freelancia-guest");
    setAuthUser(user);
    setRole(user.activeRole);
    setWallet(Boolean(user.wallet));
    setAuthError("");
    setAuthStatus("authenticated");
    setModal(null);
    action("Welcome to Freelancia");
  };
  const connectWallet = async () => {
    if (!authUser) {
      setModal("auth");
      return;
    }
    try {
      const { user } = await authApi.signInWithWallet();
      setAuthUser(user);
      setWallet(true);
      action("Wallet verified and linked to your account");
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to connect wallet.");
    }
  };
  const continueAsGuest = () => {
    window.localStorage.setItem("freelancia-guest", "true");
    setAuthUser(null);
    setAuthError("");
    setAuthStatus("authenticated");
  };
  const switchRole = async (nextRole: Role) => {
    if (!authUser) {
      setRole(nextRole);
      return;
    }
    if (!authUser.roles.includes(nextRole)) {
      action(`This account does not have the ${nextRole} role`);
      return;
    }
    try {
      const { user } = await authApi.setRole(nextRole);
      setAuthUser(user);
      setRole(user.activeRole);
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to switch roles");
    }
  };
  const signOut = async () => {
    if (!authUser) {
      window.localStorage.removeItem("freelancia-guest");
      setAuthStatus("unauthenticated");
      setProfileMenu(false);
      return;
    }
    try {
      await authApi.logout();
      setAuthUser(null);
      setAuthStatus("unauthenticated");
      setAuthError("");
      setProfileMenu(false);
      setModal(null);
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to sign out");
    }
  };
  const process = (message: string) => {
    setProcessing(false);
    setModal(null);
    action(`Preview only: "${message}" was not saved and no payment was transferred. Sign in to use a project workspace.`);
  };
  const submitProposal = async (input: { price: string; deliveryDays: number; coverMessage: string }) => {
    if (!authUser) {
      setModal(null);
      action("Preview only: sign in to save a proposal.");
      return;
    }
    const result = await submitProposalRequest(selectedProject.id, input);
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    setModal(null);
    action("Proposal sent successfully");
    return result;
  };
  const createProject = async (input: {
    title: string;
    description: string;
    budget: string;
    durationDays: number;
    deadline: string;
    skills: string[];
    requirements: string[];
  }) => {
    if (!authUser) {
      setModal(null);
      action("Preview only: sign in to publish a project.");
      return;
    }
    const result = await createProjectRequest(input);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["my-projects"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
    setModal(null);
    action("Project published successfully");
    go("dashboard");
    return result;
  };

  if (authStatus === "loading") {
    return <div className="grid min-h-screen place-items-center bg-slate-50 font-sans text-slate-500 dark:bg-[#080d18] dark:text-slate-300">Loading Freelancia…</div>;
  }

  if (authStatus === "unauthenticated") {
    return <div className="min-h-screen bg-slate-50 font-sans text-slate-900 dark:bg-[#080d18] dark:text-slate-100">
      <AuthModal open onClose={() => {}} mode={authMode} setMode={setAuthMode} role={role} setRole={setRole}
          onAuthenticated={handleAuthenticated} onGuest={continueAsGuest} onWalletSignIn={async (selectedRole: Role) => handleAuthenticated((await authApi.signInWithWallet(selectedRole)).user)} requireAuth initialError={authError} />
    </div>;
  }

  return <div className="min-h-screen bg-slate-50 font-sans text-slate-900 transition-colors dark:bg-[#080d18] dark:text-slate-100">
    <Navbar page={page} go={go} role={role} setRole={switchRole} user={authUser} onSignOut={signOut} dark={dark} setDark={setDark} wallet={wallet} setWallet={setWallet}
      onWalletConnect={connectWallet}
      mobile={mobile} setMobile={setMobile} profileMenu={profileMenu} setProfileMenu={setProfileMenu} noticeOpen={noticeOpen}
      setNoticeOpen={setNoticeOpen} setModal={setModal} action={action}
      notificationItems={authUser ? navbarNotificationsQuery.data?.items ?? [] : []}
      unreadCount={authUser ? navbarNotificationsQuery.data?.unreadCount ?? 0 : 0}
      notificationsBusy={navbarNotificationsQuery.isPending}
      notificationError={navbarNotificationsQuery.error?.message}
      onMarkAllRead={markAllNotificationsRead} onOpenNotification={openNotification} />
    <main>
      {page === "home" && <Landing go={go} setModal={setModal} openProject={openProject} />}
      {page === "browse" && <Browse openProject={openProject} />}
      {page === "dashboard" && <Dashboard role={role} go={go} setModal={setModal} openProject={openProject} guest={!authUser} />}
      {page === "project" && (!authUser
        ? <Project project={selectedProject} role={role} go={go} setModal={setModal} action={action} />
        : projectQuery.isPending
        ? <div className="mx-auto max-w-7xl px-4 py-20 text-sm text-slate-500">Loading project…</div>
        : projectQuery.isError
          ? <div className="mx-auto max-w-7xl px-4 py-10"><Empty icon={<Search />} title="Unable to load project" desc={projectQuery.error.message} action={<Button variant="secondary" onClick={() => void projectQuery.refetch()}>Retry</Button>} /></div>
          : projectQuery.data
            ? <ProjectLive project={projectQuery.data} role={role} user={authUser} go={go} setModal={setModal} action={action} />
            : <div className="mx-auto max-w-7xl px-4 py-20 text-sm text-slate-500">Project is unavailable.</div>)}
      {page === "workspace" && (authUser
        ? <WorkspaceLive projectId={workspaceProjectId} user={authUser} action={action} />
        : <WorkspacePreview role={role} setModal={setModal} action={action} />)}
      {page === "transactions" && <Transactions guest={!authUser} />}
      {page === "profile" && <Profile action={action} user={authUser} guest={!authUser} onUserChange={setAuthUser} />}
      {page === "settings" && <SettingsPage dark={dark} setDark={setDark} action={action} guest={!authUser} user={authUser} />}
      {page === "notifications" && <NotificationsPage action={action} guest={!authUser} />}
    </main>
    {page !== "home" && <Footer go={go} />}

    <AuthModal open={modal === "auth"} onClose={() => setModal(null)} mode={authMode} setMode={setAuthMode} role={role} setRole={setRole} onAuthenticated={handleAuthenticated} onGuest={continueAsGuest} onWalletSignIn={async (selectedRole: Role) => handleAuthenticated((await authApi.signInWithWallet(selectedRole)).user)} />
    <ProposalModal open={modal === "proposal"} onClose={() => setModal(null)} onSubmit={submitProposal} />
    <CreateModal open={modal === "create"} onClose={() => setModal(null)} onSubmit={createProject} processing={processing} />
    <FundModal open={modal === "fund"} onClose={() => setModal(null)} process={() => process("Funds locked in escrow")} processing={processing} />
    <SubmitModal open={modal === "submit"} onClose={() => setModal(null)} process={() => process("Work submitted for AI verification")} processing={processing} />
    <DecisionModal type={modal} onClose={() => setModal(null)} process={(msg: string) => process(msg)} processing={processing} />
    {toast && <div className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-2xl dark:bg-white dark:text-slate-950"><CheckCircle2 size={18} className="text-emerald-400" />{toast}</div>}
  </div>;
}

function Navbar(props: any) {
  const nav = [{ label: "Browse projects", page: "browse" }, { label: "Dashboard", page: "dashboard" }, { label: "Workspace", page: "workspace" }];
  return <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/85">
    <div className="mx-auto flex h-18 max-w-7xl items-center gap-5 px-4 md:px-6">
      <button onClick={() => props.go("home")} className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-md shadow-indigo-300/40"><Zap size={20} fill="currentColor" /></span>
        <span className="text-lg font-extrabold tracking-tight">Freelancia</span>
      </button>
      <nav className="ml-4 hidden items-center gap-1 lg:flex">{nav.map((item) => <button key={item.page} onClick={() => props.go(item.page)} className={cx("rounded-lg px-3 py-2 text-sm font-medium transition", props.page === item.page ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white" : "text-slate-500 hover:text-slate-950 dark:hover:text-white")}>{item.label}</button>)}</nav>
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden rounded-xl bg-slate-100 p-1 dark:bg-slate-800 sm:flex">
          {(["client", "freelancer"] as Role[]).map((r) => <button key={r} disabled={Boolean(props.user && !props.user.roles.includes(r))} onClick={() => props.setRole(r)} className={cx("rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition disabled:cursor-not-allowed disabled:opacity-50", props.role === r ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500")}>{r}</button>)}
        </div>
        <button onClick={() => props.setDark(!props.dark)} className="grid h-10 w-10 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">{props.dark ? <Sun size={19} /> : <Moon size={19} />}</button>
        <div className="relative">
          <button onClick={() => props.setNoticeOpen(!props.noticeOpen)} className="relative grid h-10 w-10 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Bell size={19} />{props.unreadCount > 0 && <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{props.unreadCount > 99 ? "99+" : props.unreadCount}</span>}</button>
          {props.noticeOpen && <Card className="absolute right-0 top-12 w-80 overflow-hidden p-2 shadow-xl">
            <div className="flex items-center justify-between px-3 py-2"><b>Notifications</b><button disabled={!props.user || props.unreadCount === 0 || props.notificationsBusy} onClick={() => void props.onMarkAllRead()} className="text-xs font-semibold text-brand-600 disabled:cursor-not-allowed disabled:opacity-50">Mark all read</button></div>
            {props.notificationError ? <div role="alert" className="px-3 py-4 text-xs text-red-600">{props.notificationError}</div> : props.user && props.notificationsBusy ? <div className="px-3 py-4 text-xs text-slate-500">Loading notifications…</div> : props.notificationItems.length ? props.notificationItems.slice(0, 3).map((item: { id: string; title: string; detail: string; readAt: string | null; createdAt: string }) => <button key={item.id} onClick={() => props.onOpenNotification(item)} className="flex w-full gap-3 rounded-xl p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"><span className={cx("mt-1 h-2 w-2 shrink-0 rounded-full", item.readAt ? "bg-transparent" : "bg-brand-500")} /><span><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 block text-xs text-slate-500">{item.detail}</span></span><span className="ml-auto text-xs text-slate-400">{new Date(item.createdAt).toLocaleDateString()}</span></button>) : <div className="px-3 py-4 text-xs text-slate-500">{props.user ? "You’re all caught up." : "Sign in to save and manage notifications."}</div>}
          </Card>}
        </div>
        <Button className="hidden md:flex" variant={props.user?.wallet ? "secondary" : "primary"} onClick={props.onWalletConnect}>{props.user?.wallet ? <><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="font-mono">{props.user.wallet.address.slice(0, 6)}…{props.user.wallet.address.slice(-4)}</span><Badge tone="indigo">{props.user.wallet.chainId}</Badge></> : <><Wallet size={17} />Connect wallet</>}</Button>
        <div className="relative hidden md:block">
          <button onClick={() => props.setProfileMenu(!props.profileMenu)} className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-indigo-100 to-violet-200 text-sm font-bold text-indigo-700">{props.user?.name.split(/\s+/).map((part: string) => part[0]).join("").slice(0, 2).toUpperCase() ?? "G"}</button>
          {props.profileMenu && <Card className="absolute right-0 top-12 w-56 p-2 shadow-xl">
            <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800"><div className="text-sm font-semibold">{props.user?.name ?? "Guest preview"}</div><div className="text-xs text-slate-500">{props.user?.email ?? "Exploring sample data"}</div></div>
            {[["Profile", CircleUserRound, "profile"], ["Transactions", CreditCard, "transactions"], ["Settings", Settings, "settings"]].map(([label, Icon, pg]: any) => <button key={label} onClick={() => { props.go(pg); props.setProfileMenu(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"><Icon size={16} />{label}</button>)}
            <button onClick={() => { props.setProfileMenu(false); if (props.user) { props.onSignOut(); } else { props.setModal("auth"); } }} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-red-50", props.user ? "text-red-600" : "text-brand-600")}>{props.user ? <><LogOut size={16} />Sign out</> : <><CircleUserRound size={16} />Sign in</>}</button>
          </Card>}
        </div>
        <button className="grid h-10 w-10 place-items-center rounded-xl lg:hidden" onClick={() => props.setMobile(!props.mobile)}>{props.mobile ? <X /> : <Menu />}</button>
      </div>
    </div>
    {props.mobile && <div className="border-t border-slate-200 p-4 dark:border-slate-800 lg:hidden">
      <div className="mb-3 grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">{(["client", "freelancer"] as Role[]).map((r) => <button key={r} disabled={Boolean(props.user && !props.user.roles.includes(r))} onClick={() => props.setRole(r)} className={cx("rounded-lg py-2 text-sm font-semibold capitalize disabled:opacity-50", props.role === r && "bg-white shadow-sm dark:bg-slate-700")}>{r}</button>)}</div>
      {nav.map((item) => <button key={item.page} onClick={() => props.go(item.page)} className="block w-full rounded-xl px-3 py-3 text-left text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800">{item.label}</button>)}
      <Button className="mt-3 w-full" onClick={() => props.setWallet(!props.wallet)}><Wallet size={17} />{props.wallet ? "0x12…89ab · 250 PYUSD" : "Connect wallet"}</Button>
      <button onClick={() => props.onSignOut()} className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50"><LogOut size={16} />Sign out</button>
    </div>}
  </header>;
}

function Landing({ go, setModal, openProject }: any) {
  const featuredQuery = useQuery({
    queryKey: ["projects", "featured"],
    queryFn: fetchFeaturedProjects,
  });
  const guest = window.localStorage.getItem("freelancia-guest") === "true";
  const featured = featuredQuery.data
    ? featuredQuery.data.slice(0, 3).map(fromApiProject)
    : featuredQuery.isError && guest
      ? projects.slice(0, 3)
      : [];
  return <>
    <section className="grid-bg overflow-hidden border-b border-slate-200/60 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 py-20 md:px-6 lg:grid-cols-[1.05fr_.95fr] lg:py-28">
        <div>
          <Badge tone="indigo"><Sparkles size={13} />The safer way to freelance</Badge>
          <div className="mt-6 max-w-3xl text-5xl font-extrabold leading-[1.05] tracking-[-0.04em] text-slate-950 dark:text-white md:text-7xl">Hire and get paid with <span className="bg-gradient-to-r from-brand-600 to-violet-500 bg-clip-text text-transparent">confidence.</span></div>
          <div className="mt-6 max-w-xl text-lg leading-8 text-slate-500 dark:text-slate-400">Escrow-protected payments and transparent AI work verification help great clients and freelancers do their best work together.</div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Button size="lg" onClick={() => go("browse")}>Browse projects <ArrowRight size={18} /></Button><Button size="lg" variant="secondary" onClick={() => setModal("create")}>Post a project</Button></div>
          <div className="mt-8 flex flex-wrap gap-6 text-sm text-slate-500"><span className="flex items-center gap-2"><CheckCircle2 className="text-emerald-500" size={17} />No hidden fees</span><span className="flex items-center gap-2"><CheckCircle2 className="text-emerald-500" size={17} />Secure escrow</span><span className="flex items-center gap-2"><CheckCircle2 className="text-emerald-500" size={17} />Human final say</span></div>
        </div>
        <div className="relative mx-auto w-full max-w-lg">
          <div className="absolute -inset-10 rounded-full bg-indigo-400/15 blur-3xl" />
          <Card className="relative overflow-hidden p-2 shadow-2xl shadow-indigo-200/40 dark:shadow-none">
            <div className="rounded-xl bg-slate-950 p-5 text-white">
              <div className="flex items-center justify-between"><div><div className="text-xs text-slate-400">Escrow balance</div><div className="mt-2 text-3xl font-bold">1,240.00 <span className="text-base text-slate-400">PYUSD</span></div></div><span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-400/15 text-emerald-400"><LockKeyhole size={22} /></span></div>
              <div className="mt-6 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />All funds secured on Sepolia</div>
            </div>
            <div className="p-5">
              <div className="flex items-start justify-between"><div><div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Active milestone</div><div className="mt-2 font-bold">Responsive portfolio website</div></div><Badge tone="amber">In review</Badge></div>
              <div className="mt-6 rounded-xl border border-emerald-100 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/50">
                <div className="flex items-center justify-between"><div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300"><Sparkles size={17} />AI verification</div><div className="text-2xl font-extrabold text-emerald-600">92</div></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-900"><div className="h-full w-[92%] rounded-full bg-emerald-500" /></div>
                <div className="mt-3 flex justify-between text-xs text-emerald-700 dark:text-emerald-400"><span>5 of 5 requirements met</span><b>PASS</b></div>
              </div>
            </div>
          </Card>
          <Card className="absolute -bottom-8 -left-5 hidden items-center gap-3 p-3 shadow-xl sm:flex"><span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-600"><Check size={19} /></span><span><span className="block text-xs text-slate-500">Payment released</span><b className="text-sm">+100.00 PYUSD</b></span></Card>
        </div>
      </div>
    </section>
    <section className="mx-auto max-w-7xl px-4 py-16 md:px-6"><div className="grid grid-cols-2 gap-5 md:grid-cols-4">{[["$12M+", "Protected volume"], ["18,000+", "Projects completed"], ["97%", "Success rate"], ["4.9/5", "Average rating"]].map(([n, l]) => <div key={l} className="text-center"><div className="text-3xl font-extrabold">{n}</div><div className="mt-1 text-sm text-slate-500">{l}</div></div>)}</div></section>
    <section className="border-y border-slate-200 bg-white py-20 dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 md:px-6"><div className="text-center"><Badge tone="indigo">Simple by design</Badge><Title sub="Clear steps. Protected funds. Better outcomes.">How Freelancia works</Title></div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">{[
          [FileText, "Post or discover", "Create a clear brief or find the right opportunity."],
          [LockKeyhole, "Secure the funds", "Payment is locked in escrow before work begins."],
          [Sparkles, "Verify the work", "AI checks each requirement and creates an advisory report."],
          [CircleDollarSign, "Release payment", "The client approves the work and payment is released."],
        ].map(([Icon, title, desc]: any, i) => <Card key={title} className="relative p-6"><span className="absolute right-5 top-5 text-4xl font-extrabold text-slate-100 dark:text-slate-800">0{i + 1}</span><span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-brand-600 dark:bg-indigo-950"><Icon size={21} /></span><div className="mt-5 font-bold">{title}</div><div className="mt-2 text-sm leading-6 text-slate-500">{desc}</div></Card>)}</div>
      </div>
    </section>
    <section className="mx-auto max-w-7xl px-4 py-20 md:px-6"><div className="flex items-end justify-between gap-4"><Title sub="New opportunities, backed by secure escrow.">Featured projects</Title><Button variant="ghost" onClick={() => go("browse")}>View all <ArrowRight size={16} /></Button></div>{featuredQuery.isError && guest && <div role="status" className="mt-4 text-sm text-amber-700 dark:text-amber-300">Showing sample projects for preview; the API or database is not connected.</div>}<div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{featuredQuery.isPending ? [1, 2, 3].map((item) => <Card key={item} className="h-64 animate-pulse bg-slate-100 dark:bg-slate-800"><span /></Card>) : featured.length ? featured.map((p) => <ProjectCard key={p.id} project={p} onOpen={() => openProject(p)} />) : <div className="md:col-span-2 lg:col-span-3"><Empty icon={<BriefcaseBusiness />} title="No featured projects yet" desc={featuredQuery.error instanceof Error ? featuredQuery.error.message : "Check back soon for new opportunities."} action={featuredQuery.isError ? <Button variant="secondary" onClick={() => void featuredQuery.refetch()}>Retry</Button> : undefined} /></div>}</div></section>
    <section className="bg-slate-900 py-20 text-white dark:bg-slate-950">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 md:px-6 lg:grid-cols-2">
        <div>
          <Badge tone="green"><ShieldCheck size={13} />Protection built in</Badge>
          <div className="mt-5 text-4xl font-bold">Trust the process, not a promise.</div>
          <div className="mt-4 max-w-lg leading-7 text-slate-400">Funds remain locked until work is reviewed. Every payment has a clear trail, and disputes have structured evidence from both sides.</div>
          <div className="mt-8 space-y-4">
            {["Funds locked before work starts", "Transparent status at every step", "Structured dispute resolution"].map((x) => <div className="flex items-center gap-3" key={x}><CheckCircle2 className="text-emerald-400" size={20} />{x}</div>)}
          </div>
        </div>
        <div>
          <Badge tone="indigo"><Sparkles size={13} />AI-assisted review</Badge>
          <div className="mt-5 text-4xl font-bold">Evidence, not guesswork.</div>
          <div className="mt-4 max-w-lg leading-7 text-slate-400">Freelancia analyzes requirements, quality, and evidence to give clients a practical review summary. The final decision always stays human.</div>
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex justify-between"><span>Verification confidence</span><b className="text-emerald-400">94%</b></div>
            <div className="mt-3 h-2 rounded-full bg-white/10"><div className="h-full w-[94%] rounded-full bg-emerald-400" /></div>
          </div>
        </div>
      </div>
    </section>
    <section className="mx-auto max-w-7xl px-4 py-20 md:px-6"><div className="text-center"><Title sub="Real partnerships, with less payment anxiety.">Loved by both sides of the marketplace</Title></div><div className="mt-10 grid gap-5 md:grid-cols-3">{testimonials.map((t) => <Card className="p-6" key={t.name}><div className="flex text-amber-400">{[1,2,3,4,5].map((x) => <Star size={16} fill="currentColor" key={x} />)}</div><div className="mt-5 leading-7 text-slate-600 dark:text-slate-300">“{t.quote}”</div><div className="mt-6 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">{t.name.split(" ").map(x => x[0]).join("")}</span><span><b className="block text-sm">{t.name}</b><span className="text-xs text-slate-500">{t.role}</span></span></div></Card>)}</div></section>
    <section className="mx-auto max-w-7xl px-4 pb-20 md:px-6"><div className="relative overflow-hidden rounded-3xl bg-brand-600 px-6 py-14 text-center text-white shadow-xl shadow-indigo-200 dark:shadow-none"><div className="absolute inset-0 grid-bg opacity-30" /><div className="relative"><div className="text-4xl font-bold">Ready to work with confidence?</div><div className="mx-auto mt-4 max-w-xl text-indigo-100">Join thousands of clients and independent professionals building better work relationships.</div><div className="mt-8 flex justify-center gap-3"><Button size="lg" className="bg-white text-brand-700 hover:bg-indigo-50" onClick={() => { setModal("auth"); }}>Get started free</Button><Button size="lg" className="border border-white/25 bg-white/10 hover:bg-white/20" onClick={() => go("browse")}>Explore projects</Button></div></div></div></section>
    <Footer go={go} />
  </>;
}

function Browse({ openProject }: { openProject: (project: ProjectCardData) => void }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [grid, setGrid] = useState(true);
  const [filter, setFilter] = useState(false);
  const [sort, setSort] = useState<ProjectSearch["sort"]>("relevant");
  const [page, setBrowsePage] = useState(1);
  const [skills, setSkills] = useState<string[]>([]);
  const [maxBudget, setMaxBudget] = useState(1000);
  const [deadlineBefore, setDeadlineBefore] = useState("");
  const browseQuery = useQuery({
    queryKey: ["projects", debouncedQuery, sort, page, skills, maxBudget, deadlineBefore],
    queryFn: () => fetchProjects({
      ...(debouncedQuery ? { q: debouncedQuery } : {}),
      ...(skills.length ? { skills } : {}),
      minBudget: 50,
      maxBudget,
      ...(deadlineBefore ? { deadlineBefore } : {}),
      sort,
      page,
      pageSize: 9,
    }),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setBrowsePage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const guest = window.localStorage.getItem("freelancia-guest") === "true";
  const previewProjects = projects.map((project) => ({ ...project }));
  const items = browseQuery.data
    ? browseQuery.data.items.map(fromApiProject)
    : browseQuery.isError && guest
      ? previewProjects
      : [];
  const total = browseQuery.data?.total ?? items.length;
  const pageCount = browseQuery.data?.pageCount ?? (items.length ? 1 : 0);
  const toggleSkill = (skill: string) => {
    setSkills((current) => current.includes(skill) ? current.filter((item) => item !== skill) : [...current, skill]);
    setBrowsePage(1);
  };
  return <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
    <Title sub="Discover quality opportunities with protected payments.">Browse projects</Title>
    <div className="mt-7 flex flex-col gap-3 lg:flex-row"><div className="flex-1"><Input value={query} onChange={setQuery} placeholder="Search projects, skills, or clients" icon={<Search size={17} />} /></div><Button variant="secondary" onClick={() => setFilter(!filter)}><SlidersHorizontal size={17} />Filters<Badge tone="indigo">{skills.length + (maxBudget < 1000 ? 1 : 0) + (deadlineBefore ? 1 : 0)}</Badge></Button><select value={sort} onChange={(event) => { setSort(event.target.value as ProjectSearch["sort"]); setBrowsePage(1); }} className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none dark:border-slate-700 dark:bg-slate-900"><option value="relevant">Most relevant</option><option value="newest">Newest</option><option value="budget">Highest budget</option></select><div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"><button onClick={() => setGrid(true)} className={cx("grid h-9 w-9 place-items-center rounded-lg", grid && "bg-slate-100 text-brand-600 dark:bg-slate-800")}><Grid2X2 size={17} /></button><button onClick={() => setGrid(false)} className={cx("grid h-9 w-9 place-items-center rounded-lg", !grid && "bg-slate-100 text-brand-600 dark:bg-slate-800")}><List size={18} /></button></div></div>
    {filter && <Card className="mt-4 grid gap-5 p-5 md:grid-cols-3"><div><div className="text-sm font-semibold">Skills</div><div className="mt-3 flex flex-wrap gap-2">{["React", "Design", "Writing", "Tailwind"].map((s) => <button key={s} aria-pressed={skills.includes(s)} onClick={() => toggleSkill(s)} className={cx("rounded-full border px-3 py-1.5 text-xs font-semibold hover:border-brand-500 hover:text-brand-600 dark:border-slate-700", skills.includes(s) ? "border-brand-500 bg-indigo-50 text-brand-600 dark:bg-indigo-950" : "border-slate-200")}>{s}</button>)}</div></div><div><div className="flex justify-between text-sm font-semibold"><span>Budget</span><span>50–{maxBudget.toLocaleString()} PYUSD</span></div><input className="mt-4 w-full accent-indigo-600" type="range" min="50" max="1000" value={maxBudget} onChange={(event) => { setMaxBudget(Number(event.target.value)); setBrowsePage(1); }} /></div><Input type="date" label="Deadline before" value={deadlineBefore} onChange={(value) => { setDeadlineBefore(value); setBrowsePage(1); }} /></Card>}
    {browseQuery.isError && <div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{guest ? "The project API is unavailable. Showing local preview data; it is not saved to the database." : browseQuery.error.message}</div>}
    <div className="mt-6 flex items-center justify-between"><span className="text-sm text-slate-500"><b className="text-slate-900 dark:text-white">{browseQuery.isPending ? "…" : total}</b> projects found</span><span className="text-xs text-slate-400">{browseQuery.isFetching ? "Updating projects…" : "Updated just now"}</span></div>
    {browseQuery.isPending ? <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((item) => <Card key={item} className="h-64 animate-pulse bg-slate-100 dark:bg-slate-800"><span /></Card>)}</div> : items.length ? <div className={cx("mt-5 grid gap-5", grid ? "md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1")}>{items.map((p) => <ProjectCard key={p.id} project={p} onOpen={() => openProject(p)} compact={!grid} />)}</div> : <Empty icon={<Search />} title="No matching projects" desc={browseQuery.isError ? "Check that the API is running, or continue browsing the home page preview." : "Try a broader keyword or clear your filters."} action={browseQuery.isError ? <Button variant="secondary" onClick={() => void browseQuery.refetch()}>Retry</Button> : undefined} />}
    {pageCount > 1 && <div className="mt-10 flex justify-center gap-2">{Array.from({ length: pageCount }, (_item, index) => index + 1).map((number) => <button key={number} aria-current={number === page ? "page" : undefined} onClick={() => { setBrowsePage(number); window.scrollTo({ top: 0, behavior: "smooth" }); }} className={cx("grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold", number === page ? "bg-brand-600 text-white" : "border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900")}>{number}</button>)}</div>}
  </div>;
}

function Dashboard({ role, setModal, openProject, guest, go }: any) {
  const [tab, setTab] = useState(role === "client" ? "Open" : "Applied");
  const dashboardQuery = useQuery({ queryKey: ["dashboard", role], queryFn: () => authApi.dashboard(role), enabled: !guest });
  const myProjectsQuery = useQuery({ queryKey: ["my-projects", role], queryFn: () => authApi.myProjects(role), enabled: !guest });
  const notificationsQuery = useQuery({ queryKey: ["notifications"], queryFn: () => authApi.notifications(), enabled: !guest });
  useEffect(() => setTab(role === "client" ? "Open" : "Applied"), [role]);
  const tabs = role === "client" ? ["Open", "In progress", "Awaiting review", "Completed", "Disputed"] : ["Applied", "Active", "Submitted", "Completed"];
  const sampleStats = role === "client"
    ? [[BriefcaseBusiness, "Active projects", "4", "+1 this month"], [LockKeyhole, "Funds in escrow", "1,230 PYUSD", "3 milestones"], [CheckCircle2, "Completed", "18", "94% success"], [Clock3, "Pending reviews", "2", "Action needed"]]
    : [[CircleDollarSign, "Total earnings", "8,420 PYUSD", "+12.5%"], [BriefcaseBusiness, "Active jobs", "3", "2 due soon"], [TrendingUp, "Success rate", "98%", "Top 5%"], [Star, "Rating", "4.9", "36 reviews"]];
  const actualStats = dashboardQuery.data?.stats;
  const stats = guest ? sampleStats : role === "client"
    ? [
        [BriefcaseBusiness, "Active projects", actualStats?.activeProjects ?? (dashboardQuery.isPending ? "Loading…" : "—"), `${actualStats?.openProjects ?? 0} open`],
        [LockKeyhole, "Funds in escrow", `${actualStats?.fundsInEscrow ?? "—"} PYUSD`, "Protected funds"],
        [CheckCircle2, "Completed", actualStats?.completed ?? (dashboardQuery.isPending ? "Loading…" : "—"), `${actualStats?.successRate ?? "—"}% success`],
        [Clock3, "Pending reviews", actualStats?.pendingReviews ?? (dashboardQuery.isPending ? "Loading…" : "—"), "Action needed"],
      ]
    : [
        [CircleDollarSign, "Total earnings", `${actualStats?.totalEarnings ?? "—"} PYUSD`, `${actualStats?.earningsChange ?? "—"} PYUSD recent`],
        [BriefcaseBusiness, "Active jobs", actualStats?.activeJobs ?? (dashboardQuery.isPending ? "Loading…" : "—"), `${actualStats?.applied ?? "—"} proposals`],
        [TrendingUp, "Success rate", `${actualStats?.successRate ?? "—"}%`, "Completed work"],
        [Star, "Rating", actualStats?.rating ?? (dashboardQuery.isPending ? "Loading…" : "—"), "Client reviews"],
      ];
  const projectStatusByTab: Record<string, string[]> = role === "client"
    ? { Open: ["OPEN"], "In progress": ["IN_PROGRESS"], "Awaiting review": ["AWAITING_REVIEW"], Completed: ["COMPLETED"], Disputed: ["DISPUTED"] }
    : { Applied: ["OPEN"], Active: ["IN_PROGRESS"], Submitted: ["AWAITING_REVIEW"], Completed: ["COMPLETED"] };
  const dashboardProjects = guest
    ? projects.slice(0, 4)
    : (myProjectsQuery.data?.items ?? []).filter((project) => projectStatusByTab[tab]?.includes(project.status)).map(fromApiProject);
  const activityItems = guest
    ? notifications.slice(0, 4).map((item) => ({ title: item.title, detail: item.detail, createdAt: item.time }))
    : (notificationsQuery.data?.items ?? []).slice(0, 4).map((item) => ({
        title: item.title,
        detail: item.detail,
        createdAt: new Date(item.createdAt).toLocaleString(),
      }));
  return <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
    {guest && <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><b>Guest preview · sample dashboard.</b> Figures and activity below are illustrative, are not saved, and do not represent real payments.</div>}
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><Title sub={`Here’s what’s happening with your ${role === "client" ? "projects" : "work"} today.`}>Good morning, Maya</Title><Button onClick={() => setModal(role === "client" ? "create" : "proposal")}><Plus size={17} />{role === "client" ? "Create project" : "Quick apply"}</Button></div>
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{stats.map(([Icon, label, value, meta]: any) => <Card className="p-5" key={label}><div className="flex items-start justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-brand-600 dark:bg-indigo-950"><Icon size={19} /></span><Badge tone={meta.includes("+") || meta.includes("Top") ? "green" : "slate"}>{meta}</Badge></div><div className="mt-5 text-sm text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></Card>)}</div>
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
      <div><div className="scrollbar-none flex gap-1 overflow-auto border-b border-slate-200 dark:border-slate-800">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={cx("whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition", tab === t ? "border-brand-600 text-brand-600" : "border-transparent text-slate-500")}>{t}{t === "Disputed" && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">1</span>}</button>)}</div>
        {!guest && (dashboardQuery.isError || myProjectsQuery.isError) ? <Empty icon={<AlertTriangle />} title="Unable to load your dashboard" desc={dashboardQuery.error?.message ?? myProjectsQuery.error?.message ?? "Check that the API and database are running."} action={<Button variant="secondary" onClick={() => { void dashboardQuery.refetch(); void myProjectsQuery.refetch(); }}>Retry</Button>} /> : !guest && (dashboardQuery.isPending || myProjectsQuery.isPending) ? <div className="mt-5 animate-pulse rounded-xl bg-slate-100 p-8 text-sm text-slate-500 dark:bg-slate-800">Loading your projects…</div> : dashboardProjects.length ? <div className="mt-5 grid gap-5 md:grid-cols-2">{dashboardProjects.map((p) => <ProjectCard key={p.id} project={p} onOpen={() => openProject(p)} compact />)}</div> : <Empty icon={<BriefcaseBusiness />} title="No projects here yet" desc={guest ? "Your preview projects will appear here." : "Projects and proposals associated with your account will appear here."} action={role === "client" ? <Button onClick={() => setModal("create")}>Create a project</Button> : undefined} />}</div>
      <div className="space-y-6">
        {role === "freelancer" && <Card className="p-5"><div className="flex items-center justify-between"><b>Earnings</b><select className="bg-transparent text-xs text-slate-500"><option>Last 6 months</option></select></div><div className="mt-5 flex h-36 items-end gap-3">{[42,56,38,74,62,88].map((h, i) => <div key={i} className="flex flex-1 flex-col items-center gap-2"><div className="w-full rounded-t-md bg-indigo-100 dark:bg-indigo-950"><div className="w-full rounded-t-md bg-brand-500 transition hover:bg-brand-600" style={{ height: `${h}px` }} /></div><span className="text-[10px] text-slate-400">{["Dec","Jan","Feb","Mar","Apr","May"][i]}</span></div>)}</div></Card>}
        <Card className="p-5"><div className="flex items-center justify-between"><b>{guest ? "Sample activity" : "Recent activity"}</b><button onClick={() => go("notifications")} className="text-xs font-semibold text-brand-600">View all</button></div>{!guest && notificationsQuery.isError ? <div role="alert" className="mt-4 text-xs text-red-600">{notificationsQuery.error.message}</div> : !guest && notificationsQuery.isPending ? <div className="mt-4 text-xs text-slate-500">Loading activity…</div> : activityItems.length ? <div className="mt-4 space-y-5">{activityItems.map((item, index) => <div className="flex gap-3" key={`${item.title}-${item.createdAt}`}><span className={cx("mt-1 h-2 w-2 rounded-full", index < 2 ? "bg-brand-500" : "bg-slate-300")} /><div><div className="text-sm font-semibold">{item.title}</div><div className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</div><div className="mt-1 text-[11px] text-slate-400">{guest ? `${item.createdAt} ago` : item.createdAt}</div></div></div>)}</div> : <div className="mt-4 text-xs text-slate-500">No recent activity.</div>}</Card>
        <Card className="overflow-hidden p-5"><div className="text-sm font-bold">Need a hand?</div><div className="mt-1 text-xs leading-5 text-slate-500">Our resolution team is available around the clock.</div><Button className="mt-4 w-full" variant="secondary" size="sm"><HelpCircle size={15} />Visit help center</Button></Card>
      </div>
    </div>
  </div>;
}

function Project({ project, role, go, setModal, action }: any) {
  const [shortlisted, setShortlisted] = useState<string[]>([]);
  return <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
    <button onClick={() => go("browse")} className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-brand-600">← Back to projects</button>
    <div className="grid gap-7 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Card className="p-6 md:p-8"><div className="flex flex-wrap items-center gap-2"><Badge tone="green"><ShieldCheck size={13} />Escrow-protected</Badge><Badge tone="indigo">Featured</Badge></div><div className="mt-5 text-3xl font-bold tracking-tight md:text-4xl">{project.title}</div><div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500"><span>Posted 2 hours ago</span><span>•</span><span>{project.proposals} proposals</span><span>•</span><span>Remote</span></div><div className="mt-8 border-t border-slate-100 pt-7 text-base leading-8 text-slate-600 dark:border-slate-800 dark:text-slate-300">{project.description} The final result should feel intentional, polished, and easy for the client to update. Accessibility and performance are important acceptance criteria.</div>
          <div className="mt-8 text-lg font-bold">Project requirements</div><div className="mt-4 space-y-3">{requirements.map((r) => <div className="flex items-center gap-3 text-sm" key={r}><span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950"><Check size={14} /></span>{r}</div>)}</div>
          <div className="mt-8 text-lg font-bold">Skills and expertise</div><div className="mt-4 flex flex-wrap gap-2">{project.skills.map((s: string) => <Badge key={s}>{s}</Badge>)}</div>
        </Card>
        {role === "client" && <Card className="p-6"><div className="flex items-center justify-between"><Title sub={`${freelancers.length} qualified professionals applied`}>Applicants</Title><Button variant="secondary" size="sm" onClick={() => action("Compare drawer opened with 3 candidates")}><Users size={16} />Compare (3)</Button></div><div className="mt-6 divide-y divide-slate-100 dark:divide-slate-800">{freelancers.slice(0, 4).map((f) => <div className="py-5 first:pt-0" key={f.name}><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">{f.initials}</span><div className="flex-1"><div className="font-bold">{f.name}</div><div className="mt-1 text-sm text-slate-500">{f.role} · <Star size={13} className="inline fill-amber-400 text-amber-400" /> {f.rating} · {f.jobs} jobs</div><div className="mt-2 text-sm text-slate-600 dark:text-slate-300">I can deliver a fast, accessible site with a clean component structure and detailed handoff.</div></div><div className="text-sm"><b>{f.price} PYUSD</b><div className="text-xs text-slate-500">{f.delivery}</div></div><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setShortlisted(shortlisted.includes(f.name) ? shortlisted.filter(x => x !== f.name) : [...shortlisted, f.name])}>{shortlisted.includes(f.name) ? <Check size={15} /> : <Star size={15} />}{shortlisted.includes(f.name) ? "Shortlisted" : "Shortlist"}</Button><Button size="sm" onClick={() => setModal("fund")}>Hire</Button></div></div></div>)}</div></Card>}
      </div>
      <div className="space-y-5"><Card className="sticky top-24 p-6"><div className="text-sm text-slate-500">Fixed-price budget</div><div className="mt-1 text-3xl font-bold">{project.budget} <span className="text-base font-semibold text-slate-400">PYUSD</span></div><div className="mt-6 space-y-4 border-y border-slate-100 py-5 text-sm dark:border-slate-800"><div className="flex justify-between"><span className="flex items-center gap-2 text-slate-500"><Clock3 size={16} />Deadline</span><b>{project.deadline}</b></div><div className="flex justify-between"><span className="flex items-center gap-2 text-slate-500"><BriefcaseBusiness size={16} />Experience</span><b>Intermediate</b></div></div>{role === "freelancer" ? <Button className="mt-6 w-full" size="lg" onClick={() => setModal("proposal")}>Apply for this project</Button> : <Button className="mt-6 w-full" size="lg" onClick={() => setModal("fund")}><LockKeyhole size={18} />Fund escrow</Button>}<div className="mt-3 text-center text-xs text-slate-400">You won't be charged until you confirm.</div></Card>
        <Card className="p-5"><div className="text-xs font-semibold uppercase tracking-wider text-slate-400">About the client</div><div className="mt-4 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-emerald-100 font-bold text-emerald-700">ER</span><div><b>{project.client}</b><div className="flex items-center gap-1 text-xs text-slate-500"><ShieldCheck className="text-emerald-500" size={13} />Payment verified</div></div></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><div className="text-slate-400">Rating</div><b>4.9 / 5</b></div><div><div className="text-slate-400">Projects</div><b>23 posted</b></div><div><div className="text-slate-400">Spent</div><b>8.4k PYUSD</b></div><div><div className="text-slate-400">Location</div><b>Lisbon, PT</b></div></div></Card></div>
    </div>
  </div>;
}

function ProjectLive({ project, role, user, go, setModal, action }: {
  project: ApiProject;
  role: Role;
  user: AuthUser;
  go: (page: Page) => void;
  setModal: (modal: ModalType) => void;
  action: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const proposalsQuery = useQuery({
    queryKey: ["project-proposals", project.id],
    queryFn: () => fetchProjectProposals(project.id),
    enabled: role === "client" && project.clientId === user.id && project.status === "OPEN",
  });
  const manageProposal = async (proposalId: string, status: "SHORTLISTED" | "REJECTED") => {
    try {
      await updateProposalStatus(proposalId, status);
      await queryClient.invalidateQueries({ queryKey: ["project-proposals", project.id] });
      action(status === "SHORTLISTED" ? "Proposal shortlisted." : "Proposal declined.");
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to update proposal.");
    }
  };
  const hire = async (proposalId: string) => {
    try {
      await hireProposal(proposalId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["project-proposals", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["my-projects"] }),
      ]);
      action("Freelancer hired. Fund the escrow in the workspace to begin.");
      navigate(`/workspace/${project.id}`);
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to hire this freelancer.");
    }
  };
  const requirementsList = project.requirements ?? [];
  const isOwner = project.clientId === user.id;
  const proposals = proposalsQuery.data?.items ?? [];
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
      <button onClick={() => go("browse")} className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-brand-600">← Back to projects</button>
      <div className="grid gap-7 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={project.status === "OPEN" ? "amber" : "green"}>{project.status.replace(/_/g, " ")}</Badge>{project.featured && <Badge tone="indigo">Featured</Badge>}</div>
            <div className="mt-5 text-3xl font-bold tracking-tight md:text-4xl">{project.title}</div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500"><span>{project.proposalCount} proposals</span><span>•</span><span>{project.remote ? "Remote" : "On-site"}</span><span>•</span><span>{project.client.name}</span></div>
            <div className="mt-8 border-t border-slate-100 pt-7 text-base leading-8 text-slate-600 dark:border-slate-800 dark:text-slate-300">{project.description}</div>
            <div className="mt-8 text-lg font-bold">Project requirements</div>
            <div className="mt-4 space-y-3">{requirementsList.length ? requirementsList.map((item) => <div className="flex items-center gap-3 text-sm" key={item.id}><span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800">{item.order + 1}</span>{item.text}</div>) : <div className="text-sm text-slate-500">No additional requirements provided.</div>}</div>
            <div className="mt-8 text-lg font-bold">Skills and expertise</div><div className="mt-4 flex flex-wrap gap-2">{project.skills.map((skill) => <Badge key={skill}>{skill}</Badge>)}</div>
          </Card>
          {isOwner && (
            <Card className="p-6">
              <div className="flex items-center justify-between"><Title sub="Review proposals from freelancers.">Applicants</Title><Badge>{project.proposalCount} total</Badge></div>
              {proposalsQuery.isError ? <Empty icon={<AlertTriangle/>} title="Unable to load applicants" desc={proposalsQuery.error.message} action={<Button variant="secondary" onClick={() => void proposalsQuery.refetch()}>Retry</Button>}/> : proposalsQuery.isPending ? <div className="mt-5 animate-pulse rounded-xl bg-slate-100 p-8 text-sm text-slate-500 dark:bg-slate-800">Loading proposals…</div> : proposals.length === 0 ? <Empty icon={<Users/>} title="No proposals yet" desc="New proposals will appear here as freelancers apply."/> : <div className="mt-5 divide-y divide-slate-100 dark:divide-slate-800">{proposals.map((proposal) => <div className="py-5 first:pt-0" key={proposal.id}><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">{proposal.freelancer.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div className="flex-1"><div className="font-bold">{proposal.freelancer.name}</div><div className="mt-1 text-sm text-slate-500">{proposal.freelancer.title ?? "Freelancer"}{proposal.freelancer.freelancerProfile && <> · <Star size={13} className="inline fill-amber-400 text-amber-400"/> {proposal.freelancer.freelancerProfile.ratingAvg} ({proposal.freelancer.freelancerProfile.ratingCount})</>}</div><div className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{proposal.coverMessage}</div><div className="mt-2 flex flex-wrap gap-2">{proposal.freelancer.freelancerProfile?.skills.map((skill) => <Badge key={skill}>{skill}</Badge>)}</div></div><div className="text-sm"><b>{proposal.price} PYUSD</b><div className="text-xs text-slate-500">{proposal.deliveryDays} days</div><Badge tone={proposal.status === "ACCEPTED" ? "green" : proposal.status === "REJECTED" ? "red" : proposal.status === "SHORTLISTED" ? "indigo" : "slate"}>{proposal.status}</Badge></div><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={proposal.status === "ACCEPTED" || proposal.status === "REJECTED"} onClick={() => void manageProposal(proposal.id, proposal.status === "SHORTLISTED" ? "REJECTED" : "SHORTLISTED")}>{proposal.status === "SHORTLISTED" ? "Remove shortlist" : "Shortlist"}</Button><Button size="sm" disabled={project.status !== "OPEN" || proposal.status === "REJECTED"} onClick={() => void hire(proposal.id)}>Hire</Button></div></div></div>)}</div>}
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card className="sticky top-24 p-6">
            <div className="text-sm text-slate-500">Fixed-price budget</div><div className="mt-1 text-3xl font-bold">{project.budget} <span className="text-base font-semibold text-slate-400">PYUSD</span></div>
            <div className="mt-6 space-y-4 border-y border-slate-100 py-5 text-sm dark:border-slate-800"><div className="flex justify-between"><span className="text-slate-500">Deadline</span><b>{new Date(project.deadline).toLocaleDateString()}</b></div><div className="flex justify-between"><span className="text-slate-500">Experience</span><b>{project.experienceLevel}</b></div><div className="flex justify-between"><span className="text-slate-500">Client payment</span><b>{project.client.paymentVerified ? "Verified" : "Not verified"}</b></div></div>
            {role === "freelancer" && project.status === "OPEN" ? <Button className="mt-6 w-full" size="lg" onClick={() => setModal("proposal")}>Apply for this project</Button> : isOwner && project.status === "OPEN" ? <div className="mt-6 text-center text-sm text-slate-500">Review applicants to hire a freelancer.</div> : project.status === "IN_PROGRESS" || project.status === "AWAITING_REVIEW" ? <Button className="mt-6 w-full" onClick={() => navigate(`/workspace/${project.id}`)}>Open workspace</Button> : null}
          </Card>
          <Card className="p-5"><div className="text-xs font-semibold uppercase tracking-wider text-slate-400">About the client</div><div className="mt-4 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-emerald-100 font-bold text-emerald-700">{project.client.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><b>{project.client.name}</b><div className="flex items-center gap-1 text-xs text-slate-500"><ShieldCheck className="text-emerald-500" size={13}/>{project.client.paymentVerified ? "Payment verified" : "New client"}</div></div></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><div className="text-slate-400">Rating</div><b>{project.client.ratingAvg}</b></div><div><div className="text-slate-400">Projects</div><b>{project.client.projectsPosted} posted</b></div><div><div className="text-slate-400">Spent</div><b>{project.client.totalSpent} PYUSD</b></div><div><div className="text-slate-400">Location</div><b>{project.client.location ?? "—"}</b></div></div></Card>
        </div>
      </div>
    </div>
  );
}

function WorkspacePreview({ role, setModal }: any) {
  const [tab, setTab] = useState("Overview");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const stages = ["Setup preview", "Work preview", "Submit preview", "Review preview", "Decision preview", "Payment preview"];
  return <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
    <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><b>Guest preview · sample data.</b> Changes are not saved and no funds are held or transferred. Sign in with the demo account to use the database-backed workspace.</div>
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center"><div><div className="flex items-center gap-2"><Badge tone="amber">Awaiting review</Badge><span className="text-xs text-slate-400">Project #FL-2048</span></div><div className="mt-3 text-2xl font-bold md:text-3xl">Build a responsive portfolio website</div></div><div className="flex gap-2">{role === "freelancer" ? <Button onClick={() => setModal("submit")}><UploadCloud size={17} />Submit work</Button> : <Button variant="success" onClick={() => setModal("approve")}><CheckCircle2 size={17} />Approve & release</Button>}<Button variant="secondary"><MoreHorizontal size={18} /></Button></div></div>
    <Card className="mt-7 overflow-x-auto p-5"><div className="flex min-w-[760px] items-center">{stages.map((s, i) => <div key={s} className="flex flex-1 items-center last:flex-none"><div className="flex flex-col items-center gap-2"><span className={cx("grid h-8 w-8 place-items-center rounded-full text-xs font-bold", i <= 3 ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400 dark:bg-slate-800")}>{i <= 3 ? <Check size={15} /> : i + 1}</span><span className={cx("whitespace-nowrap text-xs font-semibold", i <= 3 ? "text-emerald-600" : "text-slate-400")}>{s}</span></div>{i < stages.length - 1 && <span className={cx("mx-2 h-0.5 flex-1", i < 3 ? "bg-emerald-400" : "bg-slate-200 dark:bg-slate-800")} />}</div>)}</div></Card>
    <div className="mt-6 border-b border-slate-200 dark:border-slate-800">{["Overview", "Deliverables", "AI report", "Messages", "Activity"].map((t) => <button key={t} onClick={() => setTab(t)} className={cx("border-b-2 px-4 py-3 text-sm font-semibold", tab === t ? "border-brand-600 text-brand-600" : "border-transparent text-slate-500")}>{t}</button>)}</div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_330px]">
      <div>
        {tab === "Overview" && <div className="space-y-6"><Card className="p-6"><Title sub="The freelancer has submitted work for your review.">Project overview</Title><div className="mt-6 grid gap-4 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><div className="text-xs text-slate-400">Deadline</div><b className="mt-1 block">12 days, 8 hours left</b></div><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><div className="text-xs text-slate-400">Assigned to</div><b className="mt-1 block">Maya Chen</b></div></div><div className="mt-6 text-sm font-bold">Requirements</div><div className="mt-3 space-y-3">{requirements.map(r => <div key={r} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3 text-sm dark:border-slate-800"><span className="flex items-center gap-2"><CheckCircle2 size={17} className="text-emerald-500" />{r}</span><Badge tone="green">Met</Badge></div>)}</div></Card></div>}
        {tab === "Deliverables" && <Card className="p-6"><Title sub="Submitted May 24 at 10:32 AM">Final submission</Title><div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm leading-6 dark:bg-slate-800">All five requirements are complete. I added a responsive component system, accessible navigation, and validated contact form states.</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><Button variant="secondary"><Code2 size={16} />Open repository <ExternalLink size={14} /></Button><Button variant="secondary"><Globe2 size={16} />View live demo <ExternalLink size={14} /></Button></div><div className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><FileText className="text-brand-600" /><span className="flex-1"><b className="block text-sm">handoff-notes.pdf</b><span className="text-xs text-slate-400">2.4 MB</span></span><Button variant="ghost" size="sm">Download</Button></div></Card>}
        {tab === "AI report" && <AIReport />}
        {tab === "Messages" && <Card className="overflow-hidden"><div className="flex items-center gap-3 border-b border-slate-100 p-4 dark:border-slate-800"><span className="grid h-10 w-10 place-items-center rounded-full bg-indigo-100 font-bold text-indigo-700">MC</span><div><b className="text-sm">Maya Chen</b><div className="text-xs text-emerald-600">Online</div></div></div><div className="h-96 space-y-4 overflow-auto p-5"><div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-slate-100 p-3 text-sm dark:bg-slate-800">Hi Elena, I’ve finished the responsive states and contact form validation.</div><div className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-brand-600 p-3 text-sm text-white">Great, thank you. I’ll review the tablet layout today.</div><div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-slate-100 p-3 text-sm dark:bg-slate-800">Perfect. The latest deployment link is in the submission.</div>{sent.map((m, i) => <div key={i} className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm bg-brand-600 p-3 text-sm text-white">{m}</div>)}</div><div className="flex gap-2 border-t border-slate-100 p-3 dark:border-slate-800"><Button variant="ghost"><Paperclip size={17} /></Button><input value={message} onChange={e => setMessage(e.target.value)} placeholder="Write a message…" className="flex-1 bg-transparent px-2 text-sm outline-none" /><Button onClick={() => { if (message.trim()) { setSent([...sent, message]); setMessage(""); } }}><Send size={17} /></Button></div></Card>}
        {tab === "Activity" && <Card className="p-6"><Title>Sample activity</Title><div className="mt-6 space-y-6">{[["AI report prepared", "Sample advisory report is ready for review", "Today"], ["Work submitted", "Sample deliverables are shown for preview", "Today"], ["Project assigned", "Sample freelancer assigned to the workspace", "Earlier"], ["Project created", "Sample project added to the preview", "Earlier"]].map(([title, detail, time], index) => <div className="flex gap-4" key={title}><span className={cx("mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full", index === 0 ? "bg-indigo-100 text-brand-600 dark:bg-indigo-950" : "bg-slate-100 text-slate-500 dark:bg-slate-800")}><Check size={15} /></span><div><b className="text-sm">{title}</b><div className="mt-1 text-xs text-slate-500">{detail}</div><div className="mt-1 text-[11px] text-slate-400">{time}</div></div></div>)}</div></Card>}
      </div>
      <div className="space-y-5"><Card className="p-5"><div className="flex items-center justify-between"><div><div className="text-xs text-slate-400">Sample project budget</div><div className="mt-1 text-2xl font-bold">100.00 PYUSD</div></div><span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800"><LockKeyhole size={20} /></span></div><div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200"><ShieldCheck size={15} />Preview only · no funds held</div><div className="mt-4 flex justify-between text-xs text-slate-500"><span>Mode</span><b>Guest preview</b></div><div className="mt-2 flex justify-between text-xs text-slate-500"><span>Payment</span><b>Not transferred</b></div></Card>
        <Card className="p-5"><div className="flex items-center justify-between"><b>Deadline</b><Clock3 className="text-amber-500" size={19} /></div><div className="mt-4 grid grid-cols-3 gap-2 text-center">{[["12","Days"],["08","Hours"],["34","Mins"]].map(([v,l]) => <div key={l} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><div className="text-xl font-bold">{v}</div><div className="text-[10px] uppercase text-slate-400">{l}</div></div>)}</div></Card>
        {role === "client" && <Card className="p-5"><b>Decision</b><div className="mt-2 text-xs leading-5 text-slate-500">Review the deliverables and AI report before deciding.</div><Button className="mt-4 w-full" variant="success" onClick={() => setModal("approve")}>Approve & release payment</Button><Button className="mt-2 w-full" variant="secondary" onClick={() => setModal("revision")}>Request revision</Button><Button className="mt-2 w-full text-red-600" variant="ghost" onClick={() => setModal("dispute")}>Raise a dispute</Button></Card>}
      </div>
    </div>
  </div>;
}

function WorkspaceLive({ projectId, user, action }: { projectId: string; user: AuthUser; action: (message: string) => void }) {
  const [tab, setTab] = useState("Overview");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [requirementsDone, setRequirementsDone] = useState<Record<string, boolean>>({});
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [decision, setDecision] = useState<"revision" | "dispute" | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceListQuery = useQuery({
    queryKey: ["workspace-picker", user.id, user.activeRole],
    queryFn: () => authApi.myProjects(user.activeRole),
    enabled: !projectId,
  });
  const workspaceQuery = useQuery({
    queryKey: ["workspace", projectId],
    queryFn: () => workflowApi.workspace(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 10_000,
  });
  const messagesQuery = useQuery({
    queryKey: ["messages", projectId],
    queryFn: () => workflowApi.messages(projectId),
    enabled: Boolean(projectId && tab === "Messages"),
  });
  useEffect(() => {
    const socket = io({ withCredentials: true });
    let authRefreshAttempted = false;
    let disposed = false;
    const joinProject = () => {
      socket.timeout(5000).emit("project:join", projectId, (timeoutError: Error | null, result: { ok: boolean }) => {
        if (timeoutError) {
          setError("Live-update subscription timed out. Refresh the workspace to retry.");
          return;
        }
        if (!result.ok) setError("You do not have access to live updates for this project.");
        else setError((current) => current === "You do not have access to live updates for this project." ? "" : current);
      });
    };
    const refreshMessages = (incoming: { projectId?: string }) => {
      if (incoming.projectId === projectId) {
        void queryClient.invalidateQueries({ queryKey: ["messages", projectId] });
        void queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
      }
    };
    const refreshNotifications = () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };
    socket.on("connect", () => {
      authRefreshAttempted = false;
      setError((current) => current.startsWith("Live updates ") || current.startsWith("Live-update subscription timed out") ? "" : current);
      joinProject();
    });
    socket.on("connect_error", (reason) => {
      if (reason.message !== "Unauthorized") {
        setError("Live updates are reconnecting. The workspace remains available.");
        return;
      }
      if (authRefreshAttempted) {
        setError("Live updates need a fresh sign-in. Reload the page or sign in again.");
        return;
      }
      authRefreshAttempted = true;
      void authApi.restoreSession()
        .then(() => {
          if (!disposed) socket.connect();
        })
        .catch(() => {
          if (!disposed) setError("Live updates need a fresh sign-in. Reload the page or sign in again.");
        });
    });
    socket.on("message:new", refreshMessages);
    socket.on("notification:new", refreshNotifications);
    return () => {
      disposed = true;
      socket.emit("project:leave", projectId);
      socket.disconnect();
    };
  }, [projectId, queryClient]);
  const project: ApiWorkspace | undefined = workspaceQuery.data;
  const isClient = Boolean(project && user.id === project.clientId);
  const latest = project?.submission;
  const report = latest?.aiReports[0];
  const statusLabels: Record<string, string> = {
    OPEN: "Open", IN_PROGRESS: "In progress", AWAITING_REVIEW: "Awaiting review",
    COMPLETED: "Completed", DISPUTED: "Disputed", CANCELLED: "Cancelled",
  };
  const stages = ["FUNDED", "IN_PROGRESS", "AWAITING_REVIEW", "APPROVED", "PAID"];
  const currentStage = project?.escrow?.status ?? "";
  const stageIndex = stages.indexOf(currentStage);
  const refreshWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };
  const sendMessage = async () => {
    const body = message.trim();
    if (!body) return;
    setBusyAction("message");
    setError("");
    try {
      await workflowApi.sendMessage(projectId, body);
      setMessage("");
      await queryClient.invalidateQueries({ queryKey: ["messages", projectId] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to send message.");
    } finally {
      setBusyAction("");
    }
  };
  const submitWork = async () => {
    if (!project?.escrow?.onChainId) {
      setError("A confirmed on-chain escrow is required before work can be submitted. This sample project has no funded escrow.");
      return;
    }
    if (!notes.trim()) { setError("Add a summary of the work before submitting."); return; }
    if (project?.requirements.some((requirement) => !requirementsDone[requirement.id])) {
      setError("Mark every project requirement as complete before submitting.");
      return;
    }
    setBusyAction("submission");
    setError("");
    try {
      const uploadedKeys = await Promise.all(files.map((file) => workflowApi.upload(projectId, file)));
      const result = await workflowApi.submit(projectId, {
        notes,
        ...(repoUrl.trim() ? { repoUrl: repoUrl.trim() } : {}),
        ...(liveUrl.trim() ? { liveUrl: liveUrl.trim() } : {}),
        files: uploadedKeys,
        requirementChecklist: project!.requirements.map(({ id }) => ({
          requirementId: id,
          completed: Boolean(requirementsDone[id]),
        })),
      });
      await refreshWorkspace();
      setTab("Deliverables");
      setNotes("");
      setFiles([]);
      const chainStatus = await submitWorkOnChain();
      action([
        chainStatus === "PENDING" ? "On-chain submission is awaiting confirmations." : "Work submitted.",
        result.verification.status === "unavailable" ? "AI verification could not be queued; retry it from the AI report tab." : "AI review is advisory only.",
      ].join(" "));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to submit the work.");
    } finally {
      setBusyAction("");
    }
  };
  const performDecision = async () => {
    if (!project) return;
    const feedback = revisionFeedback.trim();
    const reason = disputeReason.trim();
    if (decision === "revision" && feedback.length < 10) { setError("Give at least 10 characters of revision feedback."); return; }
    if (decision === "dispute" && reason.length < 20) { setError("Explain the dispute in at least 20 characters."); return; }
    setBusyAction("decision");
    setError("");
    try {
      if (decision === "revision") {
        if (project.escrow?.onChainId && project.escrow.status !== "REVISION_REQUESTED") {
          const revisionStatus = await requestOnChainRevision();
          if (revisionStatus !== "CONFIRMED") {
            await refreshWorkspace();
            throw new Error("On-chain revision request is awaiting confirmations. Retry once it confirms.");
          }
        }
        await workflowApi.revise(project.id, feedback);
      }
      else if (decision === "dispute") {
        if (project.escrow?.onChainId && project.escrow.status !== "DISPUTED") {
          const disputeStatus = await requestOnChainDispute();
          if (disputeStatus !== "CONFIRMED") {
            await refreshWorkspace();
            throw new Error("On-chain dispute is awaiting confirmations. Retry once it confirms.");
          }
        }
        await workflowApi.openDispute(project.id, reason);
      }
      await refreshWorkspace();
      setDecision(null);
      setRevisionFeedback("");
      setDisputeReason("");
      action(decision === "revision" ? "Revision requested." : "Dispute opened.");
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : "Unable to update this project.");
    } finally {
      setBusyAction("");
    }
  };
  const requestWalletTransaction = async (transaction: { to: string; data: string; value: string }, chainId: number) => {
    const provider = window.ethereum;
    if (!provider) throw new Error("Install a browser wallet such as MetaMask to use escrow.");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("No wallet account is available.");
    if (!user.wallet || accounts[0].toLowerCase() !== user.wallet.address.toLowerCase()) {
      throw new Error("Connect the wallet linked to this account before continuing.");
    }
    const currentChain = await provider.request({ method: "eth_chainId" });
    const expectedChain = `0x${chainId.toString(16)}`;
    if (currentChain !== expectedChain) {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: expectedChain }] });
    }
    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: accounts[0],
        to: transaction.to,
        data: transaction.data,
        value: `0x${BigInt(transaction.value).toString(16)}`,
      }],
    });
    if (typeof txHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(txHash)) {
      throw new Error("The wallet returned an invalid transaction hash.");
    }
    return txHash;
  };
  const waitForWalletReceipt = async (txHash: string) => {
    const provider = window.ethereum;
    if (!provider) throw new Error("Wallet connection was lost.");
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
      if (receipt && typeof receipt === "object" && "status" in receipt) {
        if ((receipt as { status: string }).status !== "0x1") throw new Error("The wallet transaction reverted.");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    throw new Error("Transaction is still pending. Refresh the workspace and retry confirmation.");
  };
  const submitWorkOnChain = async () => {
    if (!project?.escrow?.onChainId) {
      throw new Error("A confirmed on-chain escrow is required before submitting work.");
    }
    if (project.escrow.status === "SUBMITTED" || project.escrow.status === "AI_VERIFIED") return "CONFIRMED";
    let result: { status: string };
    if (project.escrow.submittedTx) {
      result = await workflowApi.confirmWorkSubmission(projectId, project.escrow.submittedTx);
    } else {
      const prepared = await workflowApi.prepareWorkSubmission(projectId);
      const txHash = await requestWalletTransaction(prepared.transaction, prepared.chainId);
      await waitForWalletReceipt(txHash);
      result = await workflowApi.confirmWorkSubmission(projectId, txHash);
    }
    await refreshWorkspace();
    return result.status;
  };
  const requestOnChainRevision = async () => {
    if (!project) throw new Error("Project details are unavailable.");
    let result: { status: string };
    if (project.escrow?.revisionTx) {
      result = await workflowApi.confirmRevision(project.id, project.escrow.revisionTx);
    } else {
      const prepared = await workflowApi.prepareRevision(project.id);
      const txHash = await requestWalletTransaction(prepared.transaction, prepared.chainId);
      await waitForWalletReceipt(txHash);
      result = await workflowApi.confirmRevision(project.id, txHash);
    }
    await refreshWorkspace();
    return result.status;
  };
  const requestOnChainDispute = async () => {
    if (!project) throw new Error("Project details are unavailable.");
    let result: { status: string };
    if (project.escrow?.disputeTx) {
      result = await workflowApi.confirmDispute(project.id, project.escrow.disputeTx);
    } else {
      const prepared = await workflowApi.prepareDispute(project.id);
      const txHash = await requestWalletTransaction(prepared.transaction, prepared.chainId);
      await waitForWalletReceipt(txHash);
      result = await workflowApi.confirmDispute(project.id, txHash);
    }
    await refreshWorkspace();
    return result.status;
  };
  const retryOnChainSubmission = async () => {
    setBusyAction("chain-submit");
    setError("");
    try {
      const status = await submitWorkOnChain();
      action(status === "CONFIRMED" ? "On-chain work submission confirmed." : "On-chain submission is awaiting confirmations.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to confirm the on-chain submission.");
    } finally {
      setBusyAction("");
    }
  };
  const retryVerification = async () => {
    if (!latest) return;
    setBusyAction("verification");
    setError("");
    try {
      await workflowApi.verifySubmission(latest.id);
      await refreshWorkspace();
      action("Advisory verification queued.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to queue advisory verification.");
    } finally {
      setBusyAction("");
    }
  };
  const resolveDispute = async (releaseToFreelancer: boolean) => {
    if (!project?.dispute) return;
    setBusyAction("resolve-dispute");
    setError("");
    try {
      const savedDecision = project.dispute.releaseToFreelancer;
      if (savedDecision !== null && savedDecision !== releaseToFreelancer) {
        throw new Error("A different resolution transaction is already pending.");
      }
      let result: { status: string; outcome?: string };
      if (project.dispute.resolutionTx) {
        result = await workflowApi.confirmDisputeResolution(
          project.id,
          project.dispute.resolutionTx,
          releaseToFreelancer,
        );
      } else {
        const prepared = await workflowApi.prepareDisputeResolution(project.id, releaseToFreelancer);
        const txHash = await requestWalletTransaction(prepared.transaction, prepared.chainId);
        result = await workflowApi.confirmDisputeResolution(project.id, txHash, releaseToFreelancer);
      }
      await refreshWorkspace();
      action(result.status === "CONFIRMED"
        ? result.outcome === "RELEASED_TO_FREELANCER" ? "Dispute resolved in favor of the freelancer." : "Dispute resolved in favor of the client."
        : "Resolution transaction is pending confirmations.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to resolve this dispute.");
    } finally {
      setBusyAction("");
    }
  };
  const fundEscrow = async () => {
    setBusyAction("fund");
    setError("");
    try {
      const prepared = await workflowApi.prepareFunding(projectId);
      let fundingHash = "";
      for (const transaction of prepared.transactions) {
        const txHash = await requestWalletTransaction(transaction, prepared.chainId);
        await waitForWalletReceipt(txHash);
        fundingHash = txHash;
      }
      const result = await workflowApi.confirmFunding(projectId, fundingHash);
      await refreshWorkspace();
      action(result.status === "CONFIRMED" ? "Escrow funding confirmed." : "Funding submitted; awaiting network confirmations.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to fund escrow.");
    } finally {
      setBusyAction("");
    }
  };
  const approveAndRelease = async () => {
    if (!project?.escrow?.onChainId) {
      setError("There is no confirmed on-chain escrow for this sample project, so no payment can be released.");
      return;
    }
    setBusyAction("release");
    setError("");
    try {
      await workflowApi.approve(projectId);
      await refreshWorkspace();
      const prepared = await workflowApi.prepareRelease(projectId);
      const txHash = await requestWalletTransaction(prepared.transaction, prepared.chainId);
      await waitForWalletReceipt(txHash);
      const result = await workflowApi.confirmRelease(projectId, txHash);
      await refreshWorkspace();
      action(result.status === "CONFIRMED" ? "Payment released and confirmed." : "Release submitted; awaiting network confirmations.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to approve and release payment.");
      await refreshWorkspace();
    } finally {
      setBusyAction("");
    }
  };
  if (!projectId) {
    const projectsForWorkspaces = (workspaceListQuery.data?.items ?? []).filter((item) =>
      user.activeRole === "client" ||
      ["IN_PROGRESS", "AWAITING_REVIEW", "DISPUTED", "COMPLETED"].includes(item.status),
    );
    return <div className="mx-auto max-w-5xl px-4 py-10 md:px-6">
      <Title sub="Open a project you own or have been assigned to.">Your workspaces</Title>
      {workspaceListQuery.isError
        ? <Empty icon={<AlertTriangle />} title="Unable to load your workspaces" desc={workspaceListQuery.error.message} action={<Button variant="secondary" onClick={() => void workspaceListQuery.refetch()}>Retry</Button>} />
        : workspaceListQuery.isPending
          ? <div className="mt-6 animate-pulse rounded-xl bg-slate-100 p-8 text-sm text-slate-500 dark:bg-slate-800">Loading your workspaces…</div>
          : projectsForWorkspaces.length === 0
            ? <Empty icon={<BriefcaseBusiness />} title="No active workspaces yet" desc="Workspaces appear here after a project is assigned. Clients can open a project from their dashboard after hiring a freelancer." action={<Button variant="secondary" onClick={() => navigate("/dashboard")}>Go to dashboard</Button>} />
            : <div className="mt-6 grid gap-4 md:grid-cols-2">{projectsForWorkspaces.map((item) => <Card key={item.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><Badge tone={item.status === "AWAITING_REVIEW" ? "amber" : "indigo"}>{item.status.replace(/_/g, " ")}</Badge><div className="mt-3 font-bold">{item.title}</div><div className="mt-1 text-sm text-slate-500">{item.publicRef} · {item.budget} PYUSD</div></div><Button size="sm" onClick={() => navigate(`/workspace/${encodeURIComponent(item.id)}`)}>Open workspace</Button></div></Card>)}</div>}
    </div>;
  }
  if (workspaceQuery.isPending) {
    return <div className="mx-auto max-w-5xl px-4 py-20 text-sm text-slate-500">Loading project workspace…</div>;
  }
  if (workspaceQuery.isError || !project) {
    return <div className="mx-auto max-w-5xl px-4 py-20"><Empty icon={<AlertTriangle />} title="Unable to load this workspace" desc={workspaceQuery.error?.message ?? "The project could not be loaded."} action={<Button variant="secondary" onClick={() => void workspaceQuery.refetch()}>Retry</Button>} /></div>;
  }
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2"><Badge tone={project.status === "DISPUTED" ? "red" : project.status === "AWAITING_REVIEW" ? "amber" : "green"}>{statusLabels[project.status] ?? project.status}</Badge><span className="text-xs text-slate-400">{project.publicRef}</span></div>
          <div className="mt-3 text-2xl font-bold md:text-3xl">{project.title}</div>
        </div>
        {isClient && project.status === "IN_PROGRESS" && !project.escrow && <Button onClick={() => void fundEscrow()} disabled={Boolean(busyAction)}><LockKeyhole size={17}/>{busyAction === "fund" ? "Funding…" : "Fund escrow"}</Button>}
        {!isClient && project.status === "IN_PROGRESS" && <Button onClick={() => setTab("Deliverables")} disabled={!project.escrow?.onChainId}><UploadCloud size={17}/>Submit work</Button>}
        {isClient && project.status === "AWAITING_REVIEW" && project.escrow?.onChainId && <Button variant="success" onClick={() => void approveAndRelease()} disabled={Boolean(busyAction)}><CheckCircle2 size={17}/>{busyAction === "release" ? "Confirming…" : "Approve & release"}</Button>}
      </div>
      {isClient && (project.status === "IN_PROGRESS" || project.status === "AWAITING_REVIEW") && (
        <section aria-label="Payment setup checklist" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <h2 className="font-bold">Before funding or releasing payment</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{user.wallet ? `A wallet is linked to this account (${user.wallet.address.slice(0, 6)}…${user.wallet.address.slice(-4)}). Connect that same wallet in your browser to sign.` : "Link a wallet to this client account, then connect the same wallet in your browser to sign."}</li>
            <li>The browser wallet must use the backend-configured network ({user.wallet ? `linked wallet chain ID ${user.wallet.chainId};` : ""} configure `CHAIN_ID` and `CHAIN_RPC_URL` for the same network).</li>
            <li>Configure deployed `ESCROW_CONTRACT_ADDRESS` and `PAYMENT_TOKEN_ADDRESS` for that network; the freelancer must have a linked wallet on it too.</li>
            <li>{project.escrow?.onChainId ? `Confirmed escrow #${project.escrow.onChainId} · ${project.escrow.status.replace(/_/g, " ")}.` : "This project has no confirmed on-chain escrow yet. Funding must confirm on-chain before work submission or release."}</li>
            <li>Review the submitted deliverables before approving release. The client wallet signs the payment transaction.</li>
          </ul>
          {project.status === "AWAITING_REVIEW" && !project.escrow?.onChainId && <p className="mt-3 font-semibold">This seeded sample has review data only; no payment can be released from it.</p>}
        </section>
      )}
      {project.escrow && (
        <Card className="mt-7 overflow-x-auto p-5">
          <div className="flex min-w-[650px] items-center">
            {stages.map((stage, index) => {
              const active = stageIndex >= index;
              return <div key={stage} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-2">
                  <span className={cx("grid h-8 w-8 place-items-center rounded-full text-xs font-bold", active ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400 dark:bg-slate-800")}>{active ? <Check size={15}/> : index + 1}</span>
                  <span className={cx("whitespace-nowrap text-xs font-semibold", active ? "text-emerald-600" : "text-slate-400")}>{statusLabels[stage] ?? stage}</span>
                </div>
                {index < stages.length - 1 && <span className={cx("mx-2 h-0.5 flex-1", stageIndex > index ? "bg-emerald-400" : "bg-slate-200 dark:bg-slate-800")}/>}
              </div>;
            })}
          </div>
        </Card>
      )}
      <div className="mt-6 border-b border-slate-200 dark:border-slate-800">
        {["Overview", "Deliverables", "AI report", "Messages", "Activity"].map((item) => <button key={item} onClick={() => setTab(item)} className={cx("border-b-2 px-4 py-3 text-sm font-semibold", tab === item ? "border-brand-600 text-brand-600" : "border-transparent text-slate-500")}>{item}</button>)}
      </div>
      {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_330px]">
        <div>
          {tab === "Overview" && (
            <div className="space-y-5">
            {project.dispute && <Card className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Title sub={`Opened by ${project.dispute.opener.name} · ${project.dispute.status.replace(/_/g, " ").toLowerCase()}`}>Dispute case</Title>
                <Badge tone={project.dispute.status.startsWith("RESOLVED") ? "green" : "amber"}>{project.dispute.status.replace(/_/g, " ")}</Badge>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{project.dispute.reason}</p>
              {project.dispute.evidence.length > 0 && <div className="mt-5 space-y-2"><div className="text-sm font-semibold">Evidence</div>{project.dispute.evidence.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700"><div className="mb-1 text-xs text-slate-500">{item.user.name} · {new Date(item.createdAt).toLocaleString()}</div>{item.text}{item.fileUrl && <a className="ml-2 text-brand-600 underline" href={item.fileUrl} target="_blank" rel="noreferrer">Open attachment</a>}</div>)}</div>}
              {project.isArbiter && project.dispute.status !== "RESOLVED_TO_CLIENT" && project.dispute.status !== "RESOLVED_TO_FREELANCER" && project.escrow?.status === "DISPUTED" && (
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
                  <div className="text-sm font-semibold">Arbiter action</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Resolution is recorded on-chain. AI verification does not determine this decision.</p>
                  {project.dispute.resolutionTx && <div className="mt-3 break-all text-xs text-slate-500">Pending transaction: {project.dispute.resolutionTx}</div>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(project.dispute.releaseToFreelancer === null || project.dispute.releaseToFreelancer) && <Button disabled={Boolean(busyAction)} onClick={() => void resolveDispute(true)}>{busyAction === "resolve-dispute" ? "Confirming…" : project.dispute.resolutionTx ? "Check release resolution" : "Resolve: pay freelancer"}</Button>}
                    {(project.dispute.releaseToFreelancer === null || !project.dispute.releaseToFreelancer) && <Button variant="secondary" disabled={Boolean(busyAction)} onClick={() => void resolveDispute(false)}>{busyAction === "resolve-dispute" ? "Confirming…" : project.dispute.resolutionTx ? "Check refund resolution" : "Resolve: refund client"}</Button>}
                  </div>
                </div>
              )}
              {project.dispute.resolution && <p className="mt-4 text-sm text-slate-500">{project.dispute.resolution}</p>}
            </Card>}
            <Card className="p-6">
              <Title sub="Current project details and acceptance criteria.">Project overview</Title>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><div className="text-xs text-slate-400">Deadline</div><b className="mt-1 block">{new Date(project.deadline).toLocaleDateString()}</b></div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><div className="text-xs text-slate-400">Assigned freelancer</div><b className="mt-1 block">{project.freelancer?.name ?? "Not hired yet"}</b></div>
              </div>
              <div className="mt-6 text-sm font-bold">Requirements</div>
              <div className="mt-3 space-y-3">{project.requirements.length ? project.requirements.map((item) => {
                const complete = latest?.requirementChecklist.find((entry) => entry.requirementId === item.id)?.completed;
                return <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3 text-sm dark:border-slate-800"><span>{item.text}</span><Badge tone={complete ? "green" : "slate"}>{complete ? "Complete" : "Pending"}</Badge></div>;
              }) : <div className="text-sm text-slate-500">No custom requirements were added.</div>}</div>
              {isClient && project.status === "AWAITING_REVIEW" && project.escrow?.onChainId && (
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button variant="success" disabled={Boolean(busyAction)} onClick={() => void approveAndRelease()}>{busyAction === "release" ? "Processing…" : "Approve & release payment"}</Button>
                  <Button variant="secondary" onClick={() => setDecision(decision === "revision" ? null : "revision")}>Request revision</Button>
                  <Button variant="ghost" onClick={() => setDecision(decision === "dispute" ? null : "dispute")}>Open dispute</Button>
                </div>
              )}
              {decision && (
                <div className="mt-5 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <label className="block text-sm font-semibold">{decision === "revision" ? "Revision feedback" : "Dispute reason"}
                    <textarea value={decision === "revision" ? revisionFeedback : disputeReason} onChange={(event) => decision === "revision" ? setRevisionFeedback(event.target.value) : setDisputeReason(event.target.value)} className="mt-2 h-28 w-full rounded-xl border border-slate-200 bg-transparent p-3 font-normal dark:border-slate-700" />
                  </label>
                  <Button variant={decision === "dispute" ? "danger" : "primary"} disabled={busyAction === "decision"} onClick={() => void performDecision()}>{busyAction === "decision" ? "Saving…" : decision === "revision" ? "Send revision request" : "Open dispute"}</Button>
                </div>
              )}
            </Card>
            </div>
          )}
          {tab === "Deliverables" && (
            <div className="space-y-5">
              {latest && <Card className="p-6">
                <Title sub={`Version ${latest.version} · Submitted ${new Date(latest.submittedAt).toLocaleString()}`}>Latest submission</Title>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{latest.notes}</p>
                <div className="mt-4 flex flex-wrap gap-3 text-sm">{latest.repoUrl && <a className="text-brand-600 underline" href={latest.repoUrl} target="_blank" rel="noreferrer">Repository link <ExternalLink size={12} className="inline"/></a>}{latest.liveUrl && <a className="text-brand-600 underline" href={latest.liveUrl} target="_blank" rel="noreferrer">Live preview <ExternalLink size={12} className="inline"/></a>}</div>
                {latest.files.length > 0 && <div className="mt-4 space-y-2">{latest.files.map((file) => <div key={file} className="rounded-lg bg-slate-50 p-3 font-mono text-xs dark:bg-slate-800">{file}</div>)}</div>}
                {!isClient && project.escrow?.onChainId && project.escrow.status !== "SUBMITTED" && project.escrow.status !== "AI_VERIFIED" && <Button className="mt-5" variant="secondary" disabled={busyAction === "chain-submit"} onClick={() => void retryOnChainSubmission()}>{busyAction === "chain-submit" ? "Confirming…" : project.escrow.submittedTx ? "Confirm on-chain submission" : "Submit work on-chain"}</Button>}
              </Card>}
              {!isClient && (project.status === "IN_PROGRESS" || project.status === "AWAITING_REVIEW") && (
                <Card className="p-6">
                  <Title sub="Include a clear summary, optional links, and any deliverable files.">Submit or update work</Title>
                  <label className="mt-5 block text-sm font-semibold">Work summary<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} className="mt-2 h-32 w-full rounded-xl border border-slate-200 bg-transparent p-3 font-normal dark:border-slate-700" placeholder="Describe the work completed and how it meets each requirement."/></label>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2"><Input label="Repository URL (optional)" value={repoUrl} onChange={setRepoUrl} placeholder="https://github.com/…"/><Input label="Live URL (optional)" value={liveUrl} onChange={setLiveUrl} placeholder="https://…"/></div>
                  <div className="mt-5 space-y-2">{project.requirements.map((item) => <label key={item.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"><input type="checkbox" checked={requirementsDone[item.id] ?? Boolean(latest?.requirementChecklist.find((entry) => entry.requirementId === item.id)?.completed)} onChange={(event) => setRequirementsDone((current) => ({ ...current, [item.id]: event.target.checked }))}/>{item.text}</label>)}</div>
                  <label className="mt-5 block text-sm font-semibold">Attach files (up to 25 MB each)<input className="mt-2 block w-full text-sm" type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))}/></label>
                  {files.length > 0 && <div className="mt-2 text-xs text-slate-500">{files.map((file) => file.name).join(", ")}</div>}
                  <Button className="mt-5" disabled={busyAction === "submission"} onClick={() => void submitWork()}>{busyAction === "submission" ? "Uploading and submitting…" : "Submit work for review"}</Button>
                </Card>
              )}
              {!latest && isClient && <Empty icon={<FileText/>} title="No submission yet" desc="The hired freelancer has not submitted work."/>}
            </div>
          )}
          {tab === "AI report" && (
            report ? <Card className="p-6"><div className="flex items-start justify-between"><Title sub="AI checks are advisory and do not decide payments.">AI verification report</Title><Badge tone={report.verdict === "PASS" ? "green" : report.verdict === "FAIL" ? "red" : "amber"}>{report.verdict}</Badge></div><div className="mt-5 grid gap-4 sm:grid-cols-3">{[["Score",`${report.score}/100`],["Quality",`${report.qualityScore}/100`],["Confidence",`${report.confidence}%`]].map(([label,value]) => <div key={label} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-bold">{value}</div></div>)}</div><p className="mt-5 text-sm leading-6">{report.summary}</p><div className="mt-5 space-y-3">{report.perRequirement.map((item) => <div key={item.requirementId} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex justify-between text-sm font-semibold"><span>{project.requirements.find((requirement) => requirement.id === item.requirementId)?.text ?? item.requirementId}</span><Badge tone={item.status === "MET" ? "green" : item.status === "NOT_MET" ? "red" : "amber"}>{item.status}</Badge></div><p className="mt-2 text-sm text-slate-500">{item.evidence}</p></div>)}</div></Card> : <Empty icon={<Sparkles/>} title="AI report not ready" desc={latest ? "Verification is queued or still running. The result will appear here when available." : "Submit work before an advisory verification report can be generated."} action={latest ? <Button disabled={busyAction === "verification"} onClick={() => void retryVerification()}>{busyAction === "verification" ? "Queueing…" : "Request advisory verification"}</Button> : undefined}/>)}
          {tab === "Messages" && (
            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 p-4 text-sm font-semibold dark:border-slate-800">Project messages · live updates</div>
              {messagesQuery.isError ? <div role="alert" className="p-5 text-sm text-red-600">{messagesQuery.error.message}</div> : <div className="h-96 space-y-3 overflow-auto p-5">{messagesQuery.data?.length ? messagesQuery.data.map((item) => <div key={item.id} className={cx("max-w-[85%] rounded-2xl p-3 text-sm", item.sender.id === user.id ? "ml-auto rounded-tr-sm bg-brand-600 text-white" : "rounded-tl-sm bg-slate-100 dark:bg-slate-800")}><div className="mb-1 text-xs font-semibold opacity-75">{item.sender.name} · {new Date(item.createdAt).toLocaleString()}</div>{item.body}</div>) : <div className="py-20 text-center text-sm text-slate-500">No messages yet. Send the first update.</div>}</div>}
              <form className="flex gap-2 border-t border-slate-100 p-3 dark:border-slate-800" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}><input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} placeholder="Write a message…" className="flex-1 bg-transparent px-2 text-sm outline-none"/><Button type="submit" disabled={!message.trim() || busyAction === "message"}><Send size={17}/></Button></form>
            </Card>
          )}
          {tab === "Activity" && (
            <Card className="p-6"><Title>Activity log</Title><div className="mt-6 space-y-5">{project.activity.length ? project.activity.map((entry) => <div key={entry.id} className="flex gap-3"><span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-50 text-brand-600 dark:bg-indigo-950"><Check size={15}/></span><div><b className="text-sm">{entry.title}</b><div className="mt-1 text-sm text-slate-500">{entry.detail}</div><div className="mt-1 text-xs text-slate-400">{entry.actor ?? "System"} · {new Date(entry.createdAt).toLocaleString()}</div></div></div>) : <div className="py-10 text-sm text-slate-500">No activity recorded yet.</div>}</div></Card>
          )}
        </div>
        <aside className="space-y-5">
          <Card className="p-5"><div className="flex items-center justify-between"><div><div className="text-xs text-slate-400">Project budget</div><div className="mt-1 text-2xl font-bold">{project.budget} PYUSD</div></div><LockKeyhole className="text-emerald-600"/></div><div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800"><ShieldCheck size={15}/>{project.escrow ? `Escrow ${project.escrow.status.toLowerCase()}` : "Not funded"}</div>{project.escrow?.fundedTx && <a className="mt-3 block break-all font-mono text-xs text-brand-600 underline" href={`https://sepolia.etherscan.io/tx/${project.escrow.fundedTx}`} target="_blank" rel="noreferrer">Funding transaction <ExternalLink size={12} className="inline"/></a>}{project.escrow?.releasedTx && <a className="mt-2 block break-all font-mono text-xs text-brand-600 underline" href={`https://sepolia.etherscan.io/tx/${project.escrow.releasedTx}`} target="_blank" rel="noreferrer">Release transaction <ExternalLink size={12} className="inline"/></a>}</Card>
          <Card className="p-5"><div className="flex items-center justify-between"><b>Deadline</b><Clock3 className="text-amber-500" size={19}/></div><div className="mt-3 text-sm">{new Date(project.deadline).toLocaleDateString()}</div><div className="mt-1 text-xs text-slate-500">{project.durationDays} day delivery window</div></Card>
          {isClient && project.status === "AWAITING_REVIEW" && project.escrow?.onChainId && <Card className="p-5"><b>Review submission</b><div className="mt-2 text-xs leading-5 text-slate-500">AI verification is advisory. Review the actual deliverables before approving.</div><Button className="mt-4 w-full" variant="success" disabled={Boolean(busyAction)} onClick={() => void approveAndRelease()}>{busyAction === "release" ? "Confirming…" : "Approve & release"}</Button><Button className="mt-2 w-full" variant="secondary" onClick={() => { setTab("Overview"); setDecision("revision"); }}>Request revision</Button></Card>}
          {project.status === "DISPUTED" && <Card className="p-5"><Badge tone="red">Dispute opened</Badge><div className="mt-2 text-xs text-slate-500">Use the dispute page for evidence and updates.</div></Card>}
        </aside>
      </div>
    </div>
  );
}

function AIReport() {
  const [loading, setLoading] = useState(false);
  const run = () => { setLoading(true); window.setTimeout(() => setLoading(false), 1700); };
  if (loading) return <Card className="p-10 text-center"><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-indigo-50 text-brand-600 dark:bg-indigo-950"><RefreshCcw className="animate-spin" /></span><div className="mt-5 text-xl font-bold">Analyzing submission…</div><div className="mt-2 text-sm text-slate-500">Checking code, links, and requirement evidence.</div><div className="shine mx-auto mt-6 h-2 max-w-sm rounded-full bg-indigo-100" /></Card>;
  return <Card className="overflow-hidden"><div className="border-b border-slate-100 bg-gradient-to-br from-emerald-50 to-white p-6 dark:border-slate-800 dark:from-emerald-950/40 dark:to-slate-900"><div className="flex flex-col items-center gap-6 sm:flex-row"><div className="grid h-32 w-32 shrink-0 place-items-center rounded-full bg-[conic-gradient(#10b981_92%,#d1fae5_0)] p-3"><div className="grid h-full w-full place-items-center rounded-full bg-white text-center dark:bg-slate-900"><span><span className="block text-3xl font-extrabold">92</span><span className="text-xs text-slate-400">out of 100</span></span></div></div><div className="text-center sm:text-left"><Badge tone="green"><CheckCircle2 size={13} />PASS</Badge><div className="mt-3 text-2xl font-bold">Excellent submission</div><div className="mt-2 text-sm leading-6 text-slate-500">All requirements have strong supporting evidence. The implementation is polished, responsive, and ready for client review.</div><div className="mt-4 flex flex-wrap justify-center gap-3 sm:justify-start"><Badge tone="green">5/5 requirements</Badge><Badge tone="indigo">Quality 90</Badge><Badge>Confidence 94%</Badge></div></div></div></div>
    <div className="p-6"><div className="flex items-center justify-between"><b>Requirement analysis</b><Button size="sm" variant="ghost" onClick={run}><RefreshCcw size={14} />Run again</Button></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-slate-100 text-xs uppercase text-slate-400 dark:border-slate-800"><tr><th className="pb-3 font-semibold">Requirement</th><th className="pb-3 font-semibold">Status</th><th className="pb-3 font-semibold">Evidence</th><th className="pb-3 font-semibold">Notes</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{requirements.map((r, i) => <tr key={r}><td className="py-4 font-semibold">{r}</td><td><Badge tone="green">Met</Badge></td><td className="text-slate-500">{["CSS grid + breakpoints","/about route","6 case studies","Validated form","375px tested"][i]}</td><td className="text-slate-500">Clear evidence</td></tr>)}</tbody></table></div><div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"><b>Advisory only:</b> AI results support your review. Only the client can release payment.</div></div>
  </Card>;
}

function Transactions({ guest }: { guest: boolean }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const selectedType = filter === "All" ? undefined : filter.toUpperCase() as "FUND" | "RELEASE" | "REFUND";
  const query = useQuery({
    queryKey: ["transactions", selectedType],
    queryFn: () => workflowApi.transactions(selectedType),
    enabled: !guest,
  });
  const filtered = (query.data?.items ?? []).filter((item) =>
    `${item.project?.title ?? ""} ${item.txHash ?? ""} ${item.type}`.toLowerCase().includes(search.toLowerCase()),
  );
  const summary = query.data?.summary;
  const summaryCards = guest
    ? [["Total funded", "1,550.00"], ["Total received", "4,820.00"], ["Pending", "680.00"]]
    : [["Total funded", summary?.funded ?? "0.00"], ["Total received", summary?.received ?? "0.00"], ["Pending", summary?.pending ?? "0.00"]];
  const sampleItems = transactions
    .filter((item) => filter === "All" || item.type.toLowerCase() === filter.toLowerCase())
    .filter((item) => `${item.project} ${item.hash} ${item.type}`.toLowerCase().includes(search.toLowerCase()));
  const rows = guest
    ? sampleItems.map((item) => ({
        id: item.hash, type: item.type.toUpperCase(), project: item.project, amount: item.amount,
        createdAt: item.date, status: "PREVIEW", txHash: null,
      }))
    : filtered.map((item) => ({
        id: item.id, type: item.type, project: item.project?.title ?? "Project removed",
        amount: `${item.type === "FUND" ? "−" : "+"}${item.amount} PYUSD`,
        createdAt: new Date(item.createdAt).toLocaleString(), status: item.status, txHash: item.txHash,
      }));
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-6">
      <Title sub="Track every escrow movement in one transparent ledger.">Transactions</Title>
      {guest && <div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Guest preview · sample figures only. These entries are not blockchain transactions and no funds were transferred.</div>}
      {!guest && query.isError ? (
        <Empty icon={<AlertTriangle />} title="Unable to load transactions" desc={query.error.message}
          action={<Button variant="secondary" onClick={() => void query.refetch()}>Retry</Button>} />
      ) : !guest && query.isPending ? (
        <div className="mt-8 animate-pulse rounded-xl bg-slate-100 p-8 text-sm text-slate-500 dark:bg-slate-800">Loading transactions…</div>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {summaryCards.map(([label, value]) => (
              <Card key={label} className="p-5">
                <div className="text-sm text-slate-500">{label}</div>
                <div className="mt-2 text-2xl font-bold">{value} PYUSD</div>
              </Card>
            ))}
          </div>
          <Card className="mt-6 overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
              <div className="flex gap-2">
                {["All", "Fund", "Release", "Refund"].map((item) => (
                  <button key={item} onClick={() => setFilter(item)}
                    className={cx("rounded-lg px-3 py-2 text-xs font-semibold", filter === item ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800")}>
                    {item}
                  </button>
                ))}
              </div>
              <Input value={search} onChange={setSearch} placeholder="Search transactions" icon={<Search size={15} />} />
            </div>
            {rows.length === 0 ? <Empty icon={<CreditCard />} title="No transactions found" desc="Confirmed escrow activity will appear here." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-400 dark:bg-slate-800/50">
                    <tr>{["Type", "Project", "Amount", "Date", "Status", "Transaction"].map((item) => <th key={item} className="px-5 py-3 font-semibold">{item}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-5 py-4 font-semibold">{item.type}</td>
                        <td className="px-5 py-4">{item.project}</td>
                        <td className="px-5 py-4 font-semibold">{item.amount}</td>
                        <td className="px-5 py-4 text-slate-500">{item.createdAt}</td>
                        <td className="px-5 py-4"><Badge tone={item.status === "CONFIRMED" ? "green" : item.status === "FAILED" ? "red" : "amber"}>{item.status}</Badge></td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-500">
                          {item.txHash ? <a href={`https://sepolia.etherscan.io/tx/${item.txHash}`} target="_blank" rel="noreferrer" className="hover:text-brand-600">{item.txHash.slice(0, 10)}… <ExternalLink size={12} className="inline" /></a> : "Awaiting wallet"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Profile({ action, user, guest, onUserChange }: { action: (message: string) => void; user: AuthUser | null; guest: boolean; onUserChange: (user: AuthUser) => void }) {
  const [name, setName] = useState(user?.name ?? "Maya Chen");
  const [title, setTitle] = useState(user?.title ?? "Frontend developer");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [location, setLocation] = useState(user?.location ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(user?.name ?? "Maya Chen");
    setTitle(user?.title ?? "Frontend developer");
    setBio(user?.bio ?? "");
    setLocation(user?.location ?? "");
  }, [user]);
  const save = async () => {
    if (guest) {
      action("Preview only: profile edits are not saved.");
      return;
    }
    setSaving(true);
    try {
      const result = await authApi.updateProfile({ name, title, bio, location });
      onUserChange(result.user);
      action("Profile changes saved");
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to save profile.");
    } finally {
      setSaving(false);
    }
  };
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "U";
  const freelancer = user?.freelancerProfile;
  return <div className="mx-auto max-w-6xl px-4 py-10 md:px-6"><Card className="overflow-hidden"><div className="h-40 bg-gradient-to-r from-indigo-600 via-violet-500 to-fuchsia-500 grid-bg" /><div className="px-6 pb-7 md:px-8"><div className="-mt-12 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div className="flex items-end gap-4"><span className="grid h-24 w-24 place-items-center rounded-2xl border-4 border-white bg-indigo-100 text-2xl font-bold text-indigo-700 shadow dark:border-slate-900">{initials}</span><div className="pb-1"><div className="flex items-center gap-2 text-2xl font-bold">{name} {user?.emailVerified && <ShieldCheck size={19} className="text-brand-600" />}</div><div className="mt-1 text-sm text-slate-500">{title || "Freelancia member"}{location ? ` · ${location}` : ""}</div></div></div><Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(window.location.href).then(() => action("Profile link copied")).catch(() => action("Could not copy profile link.")); }}><Copy size={16} />Share profile</Button></div><div className="mt-7 grid gap-4 border-t border-slate-100 pt-6 sm:grid-cols-4 dark:border-slate-800">{[[freelancer?.ratingAvg ?? "—","Rating"],[freelancer?.completedProjects ?? "—","Completed projects"],[freelancer ? `${freelancer.successRate}%` : "—","Success rate"],[freelancer ? `${freelancer.totalEarned} PYUSD` : "—","PYUSD earned"]].map(([value,label]) => <div key={label}><div className="text-xl font-bold">{value}</div><div className="text-xs text-slate-500">{label}</div></div>)}</div></div></Card><div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]"><Card className="p-6"><Title sub="Edit the information other marketplace users see.">Profile details</Title><div className="mt-5 grid gap-4 sm:grid-cols-2"><Input label="Full name" value={name} onChange={setName}/><Input label="Professional title" value={title} onChange={setTitle}/><Input label="Location" value={location} onChange={setLocation}/><div className="sm:col-span-2"><label className="block"><span className="text-sm font-semibold">About</span><textarea value={bio} onChange={(event)=>setBio(event.target.value)} maxLength={2000} className="mt-2 h-32 w-full rounded-xl border border-slate-200 bg-transparent p-3 text-sm dark:border-slate-700" placeholder="Tell clients about your experience and approach."/></label></div></div><Button className="mt-5" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save profile"}</Button></Card><div className="space-y-5"><Card className="p-5"><div className="text-xs uppercase text-slate-400">Verified wallet</div>{user?.wallet ? <><div className="mt-3 break-all rounded-lg bg-slate-50 p-3 font-mono text-xs dark:bg-slate-800">{user.wallet.address}</div><div className="mt-3 flex items-center gap-2 text-xs text-emerald-600"><CheckCircle2 size={14}/>Verified on chain {user.wallet.chainId}</div></> : <div className="mt-3 text-sm text-slate-500">No wallet linked. Use Connect wallet to verify one.</div>}</Card><Card className="p-5"><b>Skills</b><div className="mt-4 flex flex-wrap gap-2">{freelancer?.skills.length ? freelancer.skills.map((skill) => <Badge key={skill}>{skill}</Badge>) : <span className="text-sm text-slate-500">Add skills to your freelancer profile.</span>}</div></Card></div></div></div>;
}

function SettingsPage({ dark, setDark, action, guest, user }: { dark: boolean; setDark: (value: boolean) => void; action: (message: string) => void; guest: boolean; user: AuthUser | null }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["account-settings"],
    queryFn: () => authApi.notificationSettings(),
    enabled: !guest,
    initialData: user?.settings ? { settings: user.settings } : undefined,
  });
  const preferences = settingsQuery.data?.settings ?? { email: true, push: true, productUpdates: false };
  const updatePreference = async (key: "email" | "push" | "productUpdates") => {
    if (guest) {
      action("Preview only: preference changes are not saved.");
      return;
    }
    try {
      await authApi.updateNotificationSettings({ [key]: !preferences[key] });
      await queryClient.invalidateQueries({ queryKey: ["account-settings"] });
      action("Notification preferences saved");
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to save preferences.");
    }
  };
  return <div className="mx-auto max-w-5xl px-4 py-10 md:px-6"><Title sub="Manage your preferences and appearance.">Settings</Title><div className="mt-7 space-y-6"><Card className="p-6"><Title sub="Choose how you want to hear from us.">Notification preferences</Title>{!guest && settingsQuery.isError ? <div role="alert" className="mt-4 text-sm text-red-600">{settingsQuery.error.message}</div> : <div className="mt-6 divide-y divide-slate-100 dark:divide-slate-800">{[["Email notifications","Project and payment updates","email"],["Push notifications","Messages and time-sensitive alerts","push"],["Product updates","New features and occasional tips","productUpdates"]].map(([label,description,key]) => <div key={key} className="flex items-center justify-between py-4 first:pt-0"><div><b className="text-sm">{label}</b><div className="mt-1 text-xs text-slate-500">{description}</div></div><Toggle checked={preferences[key as keyof typeof preferences]} onChange={() => void updatePreference(key as keyof typeof preferences)} /></div>)}</div>}</Card><Card className="p-6"><div className="flex items-center justify-between"><div><div className="font-bold">Dark mode</div><div className="mt-1 text-xs text-slate-500">Use a darker palette across Freelancia.</div></div><Toggle checked={dark} onChange={() => setDark(!dark)} /></div></Card><Card className="p-6"><Title sub={user?.wallet ? `Linked wallet: ${user.wallet.address}` : "Connect and verify a wallet before funding escrow."}>Wallet</Title><div className="mt-4 flex items-center justify-between"><span className="text-sm text-slate-500">{user?.wallet ? `Chain ID ${user.wallet.chainId}` : "No wallet linked"}</span><Badge tone={user?.wallet ? "green" : "amber"}>{user?.wallet ? "Verified" : "Not connected"}</Badge></div></Card></div></div>;
}

function NotificationsPage({ action, guest }: any) {
  const [view, setView] = useState("All");
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery({
    queryKey: ["notifications", view],
    queryFn: () => authApi.notifications(view === "Unread" ? true : undefined),
    enabled: !guest,
  });
  const items = guest
    ? notifications.map((item, index) => ({
        id: item.title,
        title: item.title,
        detail: item.detail,
        readAt: index < 2 ? null : "preview",
        createdAt: item.time,
      }))
    : notificationsQuery.data?.items ?? [];
  const markAllRead = async () => {
    if (guest) {
      action("Preview only: sign in to save notification changes.");
      return;
    }
    try {
      await authApi.markAllNotificationsRead();
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      action("All notifications marked as read");
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to update notifications.");
    }
  };
  const markRead = async (notificationId: string, title: string) => {
    if (guest) {
      action(`Preview only: sign in to save notification changes.`);
      return;
    }
    try {
      await authApi.markNotificationRead(notificationId);
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      action(`Opened: ${title}`);
    } catch (error) {
      action(error instanceof Error ? error.message : "Unable to update notification.");
    }
  };
  return <div className="mx-auto max-w-4xl px-4 py-10 md:px-6"><div className="flex items-end justify-between"><Title sub="Stay up to date with project and payment activity.">Notifications</Title><Button variant="ghost" onClick={() => void markAllRead()}>Mark all read</Button></div><div className="mt-6 flex gap-2">{["All","Unread"].map(x => <button key={x} onClick={() => setView(x)} className={cx("rounded-lg px-4 py-2 text-sm font-semibold",view===x?"bg-slate-900 text-white dark:bg-white dark:text-slate-900":"text-slate-500")}>{x}</button>)}</div>{!guest && notificationsQuery.isError ? <Empty icon={<AlertTriangle />} title="Unable to load notifications" desc={notificationsQuery.error.message} action={<Button variant="secondary" onClick={() => void notificationsQuery.refetch()}>Retry</Button>} /> : !guest && notificationsQuery.isPending ? <div className="mt-4 animate-pulse rounded-xl bg-slate-100 p-8 text-sm text-slate-500 dark:bg-slate-800">Loading notifications…</div> : items.length === 0 ? <Empty icon={<Bell />} title="You’re all caught up" desc="New project and payment activity will appear here." /> : <Card className="mt-4 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">{items.map((item,i) => <button key={item.id} onClick={() => void markRead(item.id, item.title)} className="flex w-full items-start gap-4 p-5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/40"><span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl",i===0?"bg-indigo-50 text-brand-600 dark:bg-indigo-950":"bg-emerald-50 text-emerald-600 dark:bg-emerald-950")}>{i===0?<Users size={18}/>:<CheckCircle2 size={18}/>}</span><span className="flex-1"><span className="font-semibold">{item.title}</span><span className="mt-1 block text-sm text-slate-500">{item.detail}</span></span><span className="text-xs text-slate-400">{guest ? item.createdAt : new Date(item.createdAt).toLocaleString()}</span>{!item.readAt&&<span className="mt-2 h-2 w-2 rounded-full bg-brand-500"/>}</button>)}</Card>}</div>;
}

function Empty({ icon, title, desc, action }: { icon: ReactNode; title: string; desc: string; action?: ReactNode }) {
  return <div className="py-20 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">{icon}</span><div className="mt-4 font-bold">{title}</div><div className="mt-2 text-sm text-slate-500">{desc}</div>{action && <div className="mt-5">{action}</div>}</div>;
}

function AuthModal({ open, onClose, mode, setMode, role, setRole, onAuthenticated, onGuest, onWalletSignIn, requireAuth = false, initialError = "" }: any) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tried, setTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");
  const [walletSubmitting, setWalletSubmitting] = useState(false);

  useEffect(() => {
    setServerError(initialError);
  }, [initialError]);

  const submit = async () => {
    setTried(true);
    setServerError("");
    if (!email.includes("@") || password.length < 6 || (mode === "signup" && !name.trim())) return;
    setSubmitting(true);
    try {
      let user = mode === "login"
        ? (await authApi.login(email, password)).user
        : (await authApi.signup(email, password, name, role)).user;
      if (mode === "login" && user.roles.includes(role) && user.activeRole !== role) {
        user = (await authApi.setRole(role)).user;
      }
      onAuthenticated(user);
      setPassword("");
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const signInWallet = async () => {
    if (!onWalletSignIn) return;
    setWalletSubmitting(true);
    setServerError("");
    try {
      await onWalletSignIn(role);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to verify your wallet.");
    } finally {
      setWalletSubmitting(false);
    }
  };

  return <Modal open={open} onClose={onClose}><div className="flex items-center justify-between"><div className="text-2xl font-bold">{mode === "login" ? "Welcome back" : "Create your account"}</div>{!requireAuth && <button onClick={onClose}><X /></button>}</div><div className="mt-2 text-sm text-slate-500">{mode === "login" ? "Sign in to continue managing your work." : "Join a safer marketplace for independent work."}</div><div className="mt-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">{(["client","freelancer"] as Role[]).map(r => <button key={r} onClick={() => setRole(r)} className={cx("rounded-lg py-2 text-sm font-semibold capitalize",role===r&&"bg-white shadow-sm dark:bg-slate-700")}>{r}</button>)}</div><div className="mt-5 space-y-4">{mode === "signup" && <Input label="Full name" value={name} onChange={setName} placeholder="Your name" error={tried && !name.trim() ? "Enter your name" : undefined}/>}<Input label="Email address" value={email} onChange={setEmail} placeholder="maya@example.com" error={tried&&!email.includes("@")?"Enter a valid email address":undefined}/><Input label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 6 characters" error={tried&&password.length<6?"Password must be at least 6 characters":undefined}/></div>{serverError && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{serverError}</div>}<Button className="mt-6 w-full" size="lg" disabled={submitting} onClick={submit}>{submitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</Button><div className="my-4 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700"/><span>or</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700"/></div><Button className="w-full" variant="secondary" disabled={walletSubmitting} onClick={signInWallet}><Wallet size={17}/>{walletSubmitting ? "Verify in your wallet…" : "Continue with wallet"}</Button>{requireAuth && <><div className="my-4 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700"/><span>or explore</span><span className="h-px flex-1 bg-slate-200 dark:bg-slate-700"/></div><Button className="w-full" variant="secondary" onClick={onGuest}>Continue as guest</Button><div className="mt-2 text-center text-xs text-slate-500">Explore the prototype with sample data. Account needed for saving changes.</div></>}<div className="mt-5 text-center text-sm text-slate-500">{mode === "login" ? "New to Freelancia?" : "Already have an account?"} <button onClick={() => {setMode(mode==="login"?"signup":"login");setTried(false);setServerError("");}} className="font-semibold text-brand-600">{mode === "login" ? "Create account" : "Sign in"}</button></div></Modal>;
}

function ProposalModal({ open, onClose, onSubmit }: any) {
  const [cover, setCover] = useState("");
  const [price, setPrice] = useState("95");
  const [delivery, setDelivery] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({ price, deliveryDays: Number(delivery), coverMessage: cover });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to send the proposal.");
    } finally {
      setSubmitting(false);
    }
  };
  return <Modal open={open} onClose={onClose} width="max-w-xl"><div className="flex justify-between"><Title sub="Build a responsive portfolio website">Submit a proposal</Title><button onClick={onClose}><X /></button></div><div className="mt-6 grid grid-cols-2 gap-4"><Input label="Your price (PYUSD)" value={price} onChange={setPrice}/><Input label="Delivery time (days)" value={delivery} onChange={setDelivery}/></div><label className="mt-4 block"><span className="text-sm font-semibold">Cover message</span><textarea value={cover} onChange={e=>setCover(e.target.value)} placeholder="Explain why you’re a great fit…" className="mt-2 h-32 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"/></label><div className="mt-5 rounded-xl bg-indigo-50 p-4 text-xs leading-5 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"><b>Tip:</b> Mention a similar project and your approach to the five requirements.</div>{error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}<div className="mt-6 flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!cover.trim() || !/^\d+(\.\d{1,6})?$/.test(price) || !/^\d+$/.test(delivery) || Number(delivery) < 1 || submitting} onClick={submit}>{submitting ? "Sending…" : "Send proposal"}</Button></div></Modal>;
}

function CreateModal({ open, onClose, onSubmit, processing }: any) {
  const [step,setStep]=useState(1);
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState("Create a polished, responsive experience with clear documentation.");
  const [budget,setBudget]=useState("100");
  const [deadline,setDeadline]=useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [selectedRequirements,setSelectedRequirements]=useState<string[]>(requirements);
  const [customRequirement,setCustomRequirement]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState("");
  const skills=["React","TypeScript","Tailwind CSS"];
  const labels=["Basics","Requirements","Budget & deadline","Review"];
  const titleError = title.trim().length > 0 && title.trim().length < 5
    ? "Project titles must be at least 5 characters."
    : undefined;
  const budgetError = budget.length > 0 && !/^\d{1,12}(\.\d{1,6})?$/.test(budget)
    ? "Enter a positive PYUSD amount with up to 6 decimal places."
    : undefined;
  const toggleRequirement = (requirement:string) => setSelectedRequirements((current)=>current.includes(requirement)?current.filter((item)=>item!==requirement):[...current,requirement]);
  const addRequirement = () => { const value=customRequirement.trim(); if(value && !selectedRequirements.includes(value)){setSelectedRequirements((current)=>[...current,value]);setCustomRequirement("");} };
  const publish = async () => {
    if (title.trim().length < 5) { setError("Project titles must be at least 5 characters."); return; }
    if (description.trim().length < 20) { setError("Add a description of at least 20 characters."); return; }
    if (budgetError || Number(budget) <= 0) { setError(budgetError ?? "Enter a budget greater than zero."); return; }
    if (selectedRequirements.length === 0) { setError("Add at least one project requirement."); return; }
    const target = new Date(`${deadline}T23:59:59`);
    const durationDays = Math.ceil((target.getTime() - Date.now()) / 86_400_000);
    if (!Number.isFinite(target.getTime()) || durationDays < 1) { setError("Choose a deadline in the future."); return; }
    setSubmitting(true); setError("");
    try { await onSubmit({ title, description, budget, durationDays, deadline: target.toISOString(), skills, requirements: selectedRequirements }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to publish the project."); }
    finally { setSubmitting(false); }
  };
  return <Modal open={open} onClose={onClose} width="max-w-2xl">
    <div className="flex justify-between"><Title>Create a project</Title><button onClick={onClose}><X/></button></div>
    <div className="mt-6 flex items-center">{labels.map((label,index)=><div key={label} className="flex flex-1 items-center last:flex-none"><span className={cx("grid h-8 w-8 place-items-center rounded-full text-xs font-bold",step>=index+1?"bg-brand-600 text-white":"bg-slate-100 text-slate-400 dark:bg-slate-800")}>{step>index+1?<Check size={14}/>:index+1}</span>{index<labels.length-1&&<span className={cx("mx-2 h-0.5 flex-1",step>index+1?"bg-brand-600":"bg-slate-200 dark:bg-slate-800")}/>}</div>)}</div>
    <div className="mt-2 flex justify-between text-[10px] text-slate-400">{labels.map((label)=><span key={label}>{label}</span>)}</div>
    <div className="mt-8 min-h-60">
      {step===1&&<div className="space-y-4">
        <Input label="Project title" value={title} onChange={setTitle} placeholder="At least 5 characters" error={titleError}/>
        <label className="block"><span className="text-sm font-semibold">Description</span><textarea value={description} onChange={(event)=>setDescription(event.target.value)} className="mt-2 h-28 w-full rounded-xl border border-slate-200 bg-transparent p-3 text-sm dark:border-slate-700"/>{description.trim().length<20&&<span className="mt-1 block text-xs text-slate-500">Enter at least 20 characters.</span>}</label>
      </div>}
      {step===2&&<div><div className="font-bold">Define requirements</div><div className="mt-4 space-y-3">{selectedRequirements.concat(requirements.filter((item)=>!selectedRequirements.includes(item))).map((requirement)=><label key={requirement} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700"><input type="checkbox" checked={selectedRequirements.includes(requirement)} onChange={()=>toggleRequirement(requirement)} className="accent-indigo-600"/>{requirement}</label>)}</div><div className="mt-4 flex gap-2"><Input value={customRequirement} onChange={setCustomRequirement} placeholder="Add a requirement"/><Button variant="secondary" onClick={addRequirement}><Plus size={15}/>Add</Button></div></div>}
      {step===3&&<div className="grid gap-4 sm:grid-cols-2"><Input label="Budget (PYUSD)" value={budget} onChange={setBudget} error={budgetError}/><Input label="Deadline" value={deadline} onChange={setDeadline} type="date"/><div className="sm:col-span-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"><ShieldCheck size={17} className="mr-2 inline"/>After hiring, escrow must be funded on-chain before work begins. Preview budgets are not funds; see the workspace payment setup checklist.</div></div>}
      {step===4&&<Card className="p-5 shadow-none"><Badge tone="green">Ready to publish</Badge><div className="mt-4 text-xl font-bold">{title||"Build a responsive portfolio website"}</div><div className="mt-2 text-sm text-slate-500">{selectedRequirements.length} requirements · {budget} PYUSD · {Math.ceil((new Date(`${deadline}T23:59:59`).getTime()-Date.now())/86_400_000)} days</div><div className="mt-5 flex flex-wrap gap-2">{skills.map((skill)=><Badge key={skill}>{skill}</Badge>)}</div></Card>}
    </div>
    {error&&<div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="mt-6 flex justify-between"><Button variant="secondary" disabled={step===1||submitting} onClick={()=>{setError("");setStep(step-1);}}>Back</Button>{step<4?<Button disabled={step===1&&(!title.trim()||title.trim().length<5||description.trim().length<20)} onClick={()=>{setError("");setStep(step+1);}}>Continue <ArrowRight size={16}/></Button>:<Button disabled={submitting||processing||!title.trim()||Boolean(budgetError)||Number(budget)<=0||selectedRequirements.length===0} onClick={publish}>{submitting||processing?<><RefreshCcw className="animate-spin" size={16}/>Publishing…</>:"Publish project"}</Button>}</div>
  </Modal>;
}

function FundModal({ open,onClose,process,processing }: any) {
  return <Modal open={open} onClose={onClose}><div className="flex justify-between"><Title sub="Guest preview only. No wallet transaction will be sent.">Escrow funding preview</Title><button onClick={onClose}><X/></button></div><div className="mt-6 space-y-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800"><div className="flex justify-between"><span>Sample project amount</span><b>100.00 PYUSD</b></div><div className="flex justify-between"><span>Sample platform fee (2%)</span><b>2.00 PYUSD</b></div><div className="flex justify-between border-t border-slate-200 pt-3 text-base dark:border-slate-700"><b>Sample total</b><b>102.00 PYUSD</b></div></div><div role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Preview only. No tokens are approved, no escrow is funded, and no money moves.</div><div className="mt-6 flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={processing} onClick={process}>Preview funding action</Button></div></Modal>;
}

function SubmitModal({ open,onClose,process,processing }: any) {
  return <Modal open={open} onClose={onClose} width="max-w-2xl"><div className="flex justify-between"><Title sub="Guest preview only. These sample details will not be saved.">Submission preview</Title><button onClick={onClose}><X/></button></div><div role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Preview only. Sign in and open an assigned workspace to submit real work. This sample project has no funded on-chain escrow.</div><label className="mt-6 block"><span className="text-sm font-semibold">Sample submission notes</span><textarea readOnly className="mt-2 h-24 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800" value="All requirements are complete. Responsive layouts were tested across mobile, tablet, and desktop."/></label><div className="mt-4 grid gap-4 sm:grid-cols-2">{[["Sample repository URL", "https://github.com/maya/portfolio"], ["Sample live demo URL", "https://portfolio-demo.dev"]].map(([label, value]) => <label key={label} className="block"><span className="text-sm font-semibold">{label}</span><input readOnly value={value} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" /></label>)}</div><div className="mt-5 space-y-2">{requirements.map(r=><label key={r} className="flex items-center gap-3 text-sm"><input type="checkbox" checked readOnly className="accent-indigo-600"/>{r}</label>)}</div><div className="mt-6 flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={processing} onClick={process}>Preview submission action</Button></div></Modal>;
}

function DecisionModal({ type,onClose,process,processing }: any) {
  if (!["approve","revision","dispute"].includes(type)) return null;
  const approve=type==="approve"; const revision=type==="revision";
  return <Modal open onClose={onClose}><div className="flex justify-between"><Title>{approve?"Release preview":revision?"Revision preview":"Dispute preview"}</Title><button onClick={onClose}><X/></button></div><div role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Guest preview only. Nothing is saved and no payment or blockchain transaction will occur.</div>{approve?<div className="mt-4 rounded-xl bg-slate-50 p-5 text-center dark:bg-slate-800"><div className="text-2xl font-bold">100 PYUSD sample amount</div><div className="mt-1 text-sm text-slate-500">No funds will be released.</div></div>:<label className="mt-6 block"><span className="text-sm font-semibold">{revision?"Sample revision feedback":"Sample dispute reason"}</span><textarea readOnly className="mt-2 h-32 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800" placeholder="Sample only; sign in to use a real workspace."/></label>}<div className="mt-6 flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>Close</Button><Button variant="secondary" disabled={processing} onClick={()=>process(approve?"Release payment preview":revision?"Revision request preview":"Dispute preview")}>Preview action</Button></div></Modal>;
}

function Footer({ go }: any) {
  return <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"><div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-[1.5fr_1fr_1fr_1fr] md:px-6"><div><div className="flex items-center gap-2 font-extrabold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white"><Zap size={17} fill="currentColor"/></span>Freelancia</div><div className="mt-4 max-w-xs text-sm leading-6 text-slate-500">A safer marketplace for ambitious clients and independent professionals.</div></div>{[["Marketplace",["Browse projects","Post a project","Talent"]],["Resources",["How it works","Escrow protection","AI verification"]],["Company",["About","Help center","Terms"]]].map(([title,links]:any)=><div key={title}><b className="text-sm">{title}</b><div className="mt-4 space-y-3">{links.map((l:string)=><button key={l} onClick={()=>go(l==="Browse projects"?"browse":"home")} className="block text-sm text-slate-500 hover:text-brand-600">{l}</button>)}</div></div>)}</div><div className="border-t border-slate-100 py-5 text-center text-xs text-slate-400 dark:border-slate-800">© 2025 Freelancia. Visual prototype · Sepolia test network</div></footer>;
}

export default App;
