// 처음 쓰는 사람용 화면: 시작 화면, Git 시작하기, 가져오기, 이름·이메일 설정, GitHub 연결
import { useEffect, useState } from "react";
import { Clock, CloudDownload, ExternalLink, FolderGit2, FolderOpen, FolderPlus, MonitorPlay, X } from "lucide-react";
import { gitIdentity, openLink, pickFolder } from "../git";
import { loadRecent, removeRecent, type RecentRepo } from "../recent";
import type { RealRepo } from "./RealRepo";

/* ---------- 공통 틀 ---------- */

function Dialog({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  // Esc 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
      <div className="rise w-[500px] border border-line bg-panel shadow-2xl shadow-black/60" style={{ borderTop: "2px solid var(--color-teal)" }}>
        <div className="flex items-start gap-3 p-5 pb-0">
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-semibold text-fg">{title}</h3>
            {sub && <p className="mt-1 text-[12px] leading-relaxed text-muted">{sub}</p>}
          </div>
          <button onClick={onClose} className="text-dim hover:text-fg" title="닫기 (Esc)">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const input =
  "w-full rounded-[3px] border border-line bg-base px-2.5 py-2 text-[13px] text-fg outline-none placeholder:text-dim focus:border-teal/60";
const primary =
  "rounded-[3px] bg-teal px-4 py-2 text-[13px] font-semibold text-[#0b2626] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30";

/* ---------- 시작 화면 ---------- */

export function StartScreen({ r, onDemo }: { r: RealRepo; onDemo: () => void }) {
  const [recent, setRecent] = useState<RecentRepo[]>(loadRecent);
  const [cloneOpen, setCloneOpen] = useState(false);

  /** 새 프로젝트: 폴더를 고르면 Git 저장소인지 보고, 아니면 Git 시작하기를 묻는다 */
  const startNew = async () => {
    const path = await pickFolder();
    if (path) await r.openPath(path); // 저장소가 아니면 openPath 가 Git 시작하기 창을 띄운다
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-base p-8">
      <div className="w-full max-w-[720px]">
        <div className="mb-8">
          <div className="font-mono text-[12px] text-dim">Git GUI</div>
          <h1 className="mt-2 text-[24px] font-semibold text-fg">무엇을 할까요?</h1>
          <p className="mt-1 text-[13px] text-muted">Git 을 몰라도 저장하고, 올리고, 되돌릴 수 있게 도와드려요.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Action icon={FolderOpen} title="내 프로젝트 열기" desc="이미 Git 으로 관리 중인 폴더를 열어요" onClick={r.open} />
          <Action icon={FolderPlus} title="새로 시작하기" desc="아직 Git 을 쓰지 않는 폴더에서 Git 을 시작해요" onClick={startNew} />
          <Action icon={CloudDownload} title="GitHub 에서 가져오기" desc="온라인에 있는 저장소를 내 컴퓨터로 받아와요" onClick={() => setCloneOpen(true)} />
          <Action icon={MonitorPlay} title="데모 둘러보기" desc="가상의 프로젝트로 기능을 먼저 체험해요" onClick={onDemo} muted />
        </div>

        <div className="mt-8">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted">
            <Clock size={12} /> 최근 저장소
          </div>
          {recent.length === 0 ? (
            <p className="text-[12px] text-dim">아직 연 저장소가 없어요.</p>
          ) : (
            <ul className="border border-line-soft">
              {recent.map((rp) => (
                <li key={rp.path} className="group flex items-center gap-3 border-b border-line-soft px-3 py-2 last:border-0 hover:bg-hover/50">
                  <FolderGit2 size={15} className="shrink-0 text-muted" />
                  <button onClick={() => r.openRecent(rp.path).then(() => setRecent(loadRecent()))} className="min-w-0 flex-1 text-left">
                    <div className="text-[13px] text-fg">{rp.name}</div>
                    <div className="truncate font-mono text-[11px] text-dim">{rp.path}</div>
                  </button>
                  <button
                    onClick={() => {
                      removeRecent(rp.path);
                      setRecent(loadRecent());
                    }}
                    className="text-dim opacity-0 group-hover:opacity-100 hover:text-fg"
                    title="목록에서 지우기 (폴더는 그대로)"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {cloneOpen && <CloneDialog r={r} onClose={() => setCloneOpen(false)} />}
    </div>
  );
}

function Action({
  icon: Icon,
  title,
  desc,
  onClick,
  muted,
}: {
  icon: typeof FolderOpen;
  title: string;
  desc: string;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-start gap-3 border p-4 text-left transition hover:border-teal/50 hover:bg-hover/40 ${muted ? "border-line-soft" : "border-line"}`}
    >
      <Icon size={20} className={muted ? "mt-0.5 text-dim" : "mt-0.5 text-teal"} />
      <span>
        <span className="block text-[14px] font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{desc}</span>
      </span>
    </button>
  );
}

/* ---------- Git 시작하기 ---------- */

export function InitDialog({ r, path }: { r: RealRepo; path: string }) {
  return (
    <Dialog title="이 폴더에서 Git 을 시작할까요?" sub="아직 Git 으로 관리하지 않는 폴더예요." onClose={r.cancelInit}>
      <div className="space-y-3 p-5">
        <div className="truncate border border-line-soft bg-base px-3 py-2 font-mono text-[12px] text-fg">{path}</div>
        <ul className="space-y-1.5 text-[12px] leading-relaxed text-muted">
          <li>· 지금 파일은 그대로 두고, 앞으로 바뀌는 내용을 저장 지점으로 남길 수 있게 돼요.</li>
          <li>
            · <span className="text-fg">.env, node_modules</span> 처럼 저장하면 안 되는 파일을 빼 주는 기본 무시 목록(.gitignore)도 만들어 드려요.
          </li>
          <li>· 첫 갈래 이름은 main 이에요.</li>
        </ul>
      </div>
      <div className="flex justify-end gap-2 border-t border-line-soft p-4">
        <button onClick={r.cancelInit} className="px-4 text-[12px] text-dim hover:text-muted">
          취소
        </button>
        <button onClick={() => r.initRepo(path)} className={primary}>
          Git 시작하기
        </button>
      </div>
    </Dialog>
  );
}

/* ---------- GitHub 에서 가져오기 ---------- */

export function CloneDialog({ r, onClose }: { r: RealRepo; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = r.busyMsg != null;

  const run = async () => {
    if (!parent) return;
    setError(null);
    const err = await r.cloneRepo(url.trim(), parent);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Dialog title="GitHub 에서 가져오기" sub="온라인 저장소를 내 컴퓨터에 받아와서 바로 열어요." onClose={onClose}>
      <div className="space-y-4 p-5">
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-muted">1. 저장소 주소</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/아이디/저장소이름.git"
            className={`${input} font-mono`}
            autoFocus
          />
          <span className="mt-1 block text-[11px] text-dim">GitHub 저장소 페이지의 초록색 [Code] 버튼을 누르면 주소를 복사할 수 있어요.</span>
        </label>
        <div>
          <span className="mb-1.5 block text-[12px] text-muted">2. 받을 위치</span>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate border border-line bg-base px-2.5 py-2 font-mono text-[12px] text-fg">
              {parent ?? <span className="font-sans text-dim">폴더를 골라 주세요</span>}
            </div>
            <button
              onClick={async () => setParent((await pickFolder()) ?? parent)}
              className="shrink-0 rounded-[3px] border border-line px-3 py-2 text-[12px] text-muted hover:border-teal/50 hover:text-fg"
            >
              폴더 고르기
            </button>
          </div>
          <span className="mt-1 block text-[11px] text-dim">이 폴더 안에 저장소 이름으로 새 폴더가 생겨요.</span>
        </div>
        {busy && <p className="text-[12px] text-teal">{r.busyMsg}</p>}
        {error && <p className="text-[12px] whitespace-pre-line text-red">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line-soft p-4">
        <button onClick={onClose} className="px-4 text-[12px] text-dim hover:text-muted">
          취소
        </button>
        <button onClick={run} disabled={!url.trim() || !parent || busy} className={primary}>
          {busy ? "가져오는 중…" : "가져오기"}
        </button>
      </div>
    </Dialog>
  );
}

/* ---------- 이름·이메일 ---------- */

export function IdentityDialog({ r }: { r: RealRepo }) {
  const [name, setName] = useState(r.identity?.name ?? "");
  const [email, setEmail] = useState(r.identity?.email ?? "");
  const [error, setError] = useState<string | null>(null);

  // 이 컴퓨터 전체 설정에 이미 값이 있으면 채워 둔다
  useEffect(() => {
    gitIdentity()
      .then((g) => {
        if (g.name) setName((v) => v || g.name!);
        if (g.email) setEmail((v) => v || g.email!);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setError(null);
    try {
      await r.saveIdentity(name, email);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Dialog
      title="이름과 이메일을 알려 주세요"
      sub="저장 지점마다 누가 저장했는지 함께 기록돼요. 이 컴퓨터에서 한 번만 설정하면 돼요."
      onClose={r.closeIdentity}
    >
      <div className="space-y-3 p-5">
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-muted">이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 홍길동" className={input} autoFocus />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-muted">이메일</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="예: me@example.com"
            className={input}
          />
          <span className="mt-1 block text-[11px] text-dim">
            GitHub 계정 이메일과 같게 하면 GitHub 에서 내 저장 기록으로 표시돼요. 저장소를 공개하면 이메일도 보이니, GitHub 의 비공개
            이메일(…@users.noreply.github.com)을 써도 돼요.
          </span>
        </label>
        {error && <p className="text-[12px] text-red">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line-soft p-4">
        <button onClick={r.closeIdentity} className="px-4 text-[12px] text-dim hover:text-muted">
          나중에
        </button>
        <button onClick={save} disabled={!name.trim() || !email.trim()} className={primary}>
          저장
        </button>
      </div>
    </Dialog>
  );
}

/* ---------- GitHub 에 연결하기 ---------- */

export function RemoteDialog({ r }: { r: RealRepo }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = r.busyMsg != null;
  const repo = r.repo!;

  const connect = async () => {
    setError(null);
    const err = await r.connectRemote(url.trim());
    if (err) setError(err);
  };

  return (
    <Dialog title="GitHub 에 연결하기" sub="이 프로젝트를 올릴 온라인 저장소를 연결해요. 처음 한 번만 하면 돼요." onClose={r.closeRemote}>
      <div className="space-y-4 p-5 text-[12px] leading-relaxed">
        <div>
          <div className="mb-1 text-muted">1. GitHub 에서 빈 저장소를 만들어요</div>
          <button
            onClick={() => openLink("https://github.com/new")}
            className="flex items-center gap-1.5 rounded-[3px] border border-line px-3 py-1.5 text-fg hover:border-teal/50"
          >
            <ExternalLink size={12} /> github.com/new 열기
          </button>
          <p className="mt-1.5 text-[11px] text-dim">
            저장소 이름에 <span className="font-mono text-muted">{repo.name}</span> 처럼 적고, README·.gitignore 추가는{" "}
            <span className="text-muted">체크하지 말고</span> 만들어 주세요. (이미 있는 파일과 겹치지 않게)
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-muted">2. 만든 저장소의 주소를 붙여 넣어요</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url.trim() && !busy && connect()}
            placeholder={`https://github.com/아이디/${repo.name}.git`}
            className={`${input} font-mono`}
          />
        </label>
        <p className="text-[11px] text-dim">
          연결하면 바로 첫 올리기를 해요{repo.noCommits ? " (지금은 저장 지점이 없어서 연결만 해요)" : ""}. 처음이면 GitHub 로그인 창이 뜰 수 있어요.
        </p>
        {busy && <p className="text-teal">{r.busyMsg}</p>}
        {error && <p className="whitespace-pre-line text-red">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line-soft p-4">
        <button onClick={r.closeRemote} className="px-4 text-[12px] text-dim hover:text-muted">
          취소
        </button>
        <button onClick={connect} disabled={!url.trim() || busy} className={primary}>
          {busy ? "올리는 중…" : repo.noCommits ? "연결하기" : "연결하고 올리기"}
        </button>
      </div>
    </Dialog>
  );
}
