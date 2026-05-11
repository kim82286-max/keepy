import { useState, useRef, useEffect, useCallback } from "react";

// ─── Supabase Config ───
const SUPABASE_URL = "https://lomcltuqhvvwdmvoeiwc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvbWNsdHVxaHZ2d2Rtdm9laXdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMjI5MzQsImV4cCI6MjA5Mjg5ODkzNH0.Jv8bnrL2Irco6wsITpt9CD7N1gk23wcrmyZ0QUAb5UM";
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: opts.prefer || "return=representation", ...opts.headers },
}).then(r => r.ok ? r.json().catch(() => null) : null);

// ─── DB helpers ───
async function dbLoadFolders(email) { return await sb(`folders?user_email=eq.${encodeURIComponent(email)}&order=created_at.asc`) || []; }
async function dbLoadItems(email) {
  return (await sb(`items?user_email=eq.${encodeURIComponent(email)}&order=created_at.desc&select=id,user_email,type,title,summary,tags,course_steps,folder_id,raw_memo,created_at,image_data`) || []).map(i => ({
    ...i, folderId: i.folder_id, imageData: i.image_data, rawMemo: i.raw_memo, courseSteps: i.course_steps || [], createdAt: i.created_at,
  }));
}
async function dbSaveFolder(email, f) { return await sb("folders", { method: "POST", body: JSON.stringify({ id: f.id, user_email: email, name: f.name, icon: f.icon, created_at: f.createdAt || new Date().toISOString() }) }); }
async function dbSaveItem(email, item) {
  return await sb("items", { method: "POST", body: JSON.stringify({ id: item.id, user_email: email, type: item.type, image_data: item.imageData, raw_memo: item.rawMemo, title: item.title, summary: item.summary, tags: item.tags || [], course_steps: item.courseSteps || [], folder_id: item.folderId || null, created_at: item.createdAt || new Date().toISOString() }) });
}
async function dbDeleteItem(email, id) { await sb(`items?id=eq.${id}&user_email=eq.${encodeURIComponent(email)}`, { method: "DELETE" }); }
async function dbDeleteItems(email, ids) { for (const id of ids) await dbDeleteItem(email, id); }
async function dbUpdateItem(email, id, data) {
  const body = {};
  if (data.title !== undefined) body.title = data.title;
  if (data.summary !== undefined) body.summary = data.summary;
  if (data.folderId !== undefined) body.folder_id = data.folderId;
  await sb(`items?id=eq.${id}&user_email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify(body) });
}
async function dbDeleteFolder(email, id) {
  await sb(`items?folder_id=eq.${id}&user_email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ folder_id: null }) });
  await sb(`folders?id=eq.${id}&user_email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
}
async function dbGetUsage(email) {
  const now = new Date(); const key = `${now.getFullYear()}-${now.getMonth() + 1}`;
  const rows = await sb(`usage?user_email=eq.${encodeURIComponent(email)}&month_key=eq.${key}`) || [];
  return { count: rows[0]?.count || 0, key };
}
async function dbAddUsage(email) {
  const { count, key } = await dbGetUsage(email);
  if (count === 0) await sb("usage", { method: "POST", body: JSON.stringify({ user_email: email, month_key: key, count: 1 }), prefer: "return=minimal" });
  else await sb(`usage?user_email=eq.${encodeURIComponent(email)}&month_key=eq.${key}`, { method: "PATCH", body: JSON.stringify({ count: count + 1 }) });
  return count + 1;
}

// ─── Migration ───
async function migrateLocalToSupabase(email) {
  const migrated = localStorage.getItem("keepy-migrated");
  if (migrated === email) return null;
  const oldItems = JSON.parse(localStorage.getItem("keepy-items-v2") || "null");
  const oldFolders = JSON.parse(localStorage.getItem("keepy-folders-v2") || "null");
  if (oldFolders?.length) for (const f of oldFolders) await dbSaveFolder(email, f);
  if (oldItems?.length) for (const item of oldItems) await dbSaveItem(email, item);
  localStorage.setItem("keepy-migrated", email);
  return (oldItems?.length || oldFolders?.length) ? { items: oldItems?.length || 0, folders: oldFolders?.length || 0 } : null;
}

// ─── Constants ───
const MONTHLY_LIMIT = 50;
const SK_U = "keepy-user-v1";
function ld(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function sv(k, d) { try { localStorage.setItem(k, JSON.stringify(d)); } catch {} }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function compress(file, mw = 800) {
  return new Promise(r => {
    const fr = new FileReader();
    fr.onload = e => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); const rt = Math.min(mw / i.width, 1); c.width = i.width * rt; c.height = i.height * rt; c.getContext("2d").drawImage(i, 0, 0, c.width, c.height); r(c.toDataURL("image/jpeg", 0.7)); }; i.src = e.target.result; };
    fr.readAsDataURL(file);
  });
}

async function callAI(msgs) {
  try { const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, messages: msgs }) }); const d = await r.json(); return d.content?.map(i => i.text || "").join("") || ""; } catch { return null; }
}
async function analyzeImg(b64, folders) {
  const fl = folders.map(f => f.name).join(", ");
  const t = await callAI([{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64.split(",")[1] } }, { type: "text", text: `이 캡처를 분석. 폴더: [${fl || "없음"}]\nJSON만: {"title":"15자","summary":"3-5문장 ①②③","tags":["태그"],"suggested_folder":"폴더명 or null","new_folder_suggestion":"8자","is_course":false,"course_steps":null}` }] }]);
  try { return JSON.parse(t.replace(/```json|```/g, "").trim()); } catch { return null; }
}
async function tidyMemo(raw, folders) {
  const fl = folders.map(f => f.name).join(", ");
  const t = await callAI([{ role: "user", content: `메모 정리. 폴더: [${fl || "없음"}]\n메모: """${raw}"""\nJSON만: {"title":"15자","summary":"3-5문장 ①②③","tags":["태그"],"suggested_folder":"폴더명 or null","new_folder_suggestion":"8자","is_course":false,"course_steps":null}` }]);
  try { return JSON.parse(t.replace(/```json|```/g, "").trim()); } catch { return null; }
}

const ICONS = ["📁","📍","💅","🍽️","👗","💪","💡","📸","🎵","🏠","✈️","📚","🛍️","🌿","☕","🎨","🐶","🎮"];
const STEP_C = ["#7B8DAA","#6B8F71","#C07888","#8B7BAA","#B8544F","#4A7B8C","#8A7055","#5C8A8A","#C4956A","#5B6ABF"];
const A = "#7B8DAA", BG = "#EDF0ED", CARD = "#F8FAF8", BDR = "#DFE3DF", SUB = "#DFE3DF", TXT = "#2D2A23", TXT2 = "#6E7A6E", TXT3 = "#9BA49B", POPUP = "#F6F8F6";
const GOOGLE_CLIENT_ID = "149148234188-huoergpo44qmp3avok7fcs1slno9h5u7.apps.googleusercontent.com";

function decodeJwt(token) {
  try { const b = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(b); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

// ─── Components ───
function Toast({ msg, show }) {
  return <div style={{ position: "fixed", bottom: 120, left: "50%", transform: `translateX(-50%) translateY(${show ? 0 : 10}px)`, background: TXT, color: CARD, padding: "11px 24px", borderRadius: 100, fontSize: 13, fontWeight: 500, fontFamily: "var(--f)", opacity: show ? 1 : 0, transition: "all 0.35s", zIndex: 2000, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", pointerEvents: "none" }}>{msg}</div>;
}

function LoginScreen({ onLogin }) {
  const btnRef = useRef(null);
  useEffect(() => {
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => { window.google?.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: r => { const p = decodeJwt(r.credential); if (p) onLogin({ name: p.name || "사용자", email: p.email || "", avatar: p.picture || null, provider: "google" }); } }); window.google?.accounts.id.renderButton(btnRef.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill", width: 320, locale: "ko" }); };
    document.head.appendChild(s); return () => { try { document.head.removeChild(s); } catch {} };
  }, []);
  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "var(--f)", padding: "40px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{ fontSize: 42, fontWeight: 300, color: TXT, letterSpacing: "0.06em", margin: "0 0 8px" }}>kee<span style={{ fontWeight: 800, color: A }}>py</span></h1>
        <p style={{ fontSize: 14, color: TXT2, lineHeight: 1.6 }}>스크린샷, 릴스 캡처, 메모를<br/>AI가 알아서 분류하고 정리해요</p>
      </div>
      <div ref={btnRef} style={{ display: "flex", justifyContent: "center" }} />
      <p style={{ fontSize: 12, color: TXT3, marginTop: 32, textAlign: "center", lineHeight: 1.6 }}>계속하면 서비스 이용약관 및<br/>개인정보 처리방침에 동의하게 됩니다</p>
    </div>
  );
}

function ProfileMenu({ user, usageCount, onLogout, onClose }) {
  const pct = Math.min((usageCount / MONTHLY_LIMIT) * 100, 100);
  const isNear = usageCount >= MONTHLY_LIMIT * 0.8;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(45,42,35,0.18)", backdropFilter: "blur(8px)", zIndex: 1500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: POPUP, borderRadius: 26, width: "100%", maxWidth: 400, padding: "28px 24px 32px", animation: "fadeIn 0.3s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 24px 80px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          {user.avatar ? <img src={user.avatar} style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} referrerPolicy="no-referrer" /> : <div style={{ width: 48, height: 48, borderRadius: "50%", background: `${A}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: A }}>{user.name?.slice(0, 1) || "U"}</div>}
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: TXT }}>{user.name}</div>
            <div style={{ fontSize: 13, color: TXT2, marginTop: 2 }}>{user.email}</div>
          </div>
        </div>
        <div style={{ background: BG, borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: TXT }}>이번 달 AI 사용량</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: isNear ? "#B8544F" : A }}>{usageCount} / {MONTHLY_LIMIT}</span>
          </div>
          <div style={{ width: "100%", height: 6, borderRadius: 3, background: BDR }}><div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: isNear ? "#B8544F" : A }} /></div>
          <p style={{ fontSize: 11, color: TXT3, marginTop: 8 }}>{usageCount >= MONTHLY_LIMIT ? "한도 모두 사용. 다음 달 초기화" : `${MONTHLY_LIMIT - usageCount}회 남음 · 매월 1일 초기화`}</p>
        </div>
        <div style={{ background: BG, borderRadius: 14, padding: "12px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <span>☁️</span><span style={{ fontSize: 12, color: TXT2 }}>Supabase 클라우드에 안전하게 저장됨</span>
        </div>
        <button onClick={onLogout} style={{ width: "100%", padding: "15px", borderRadius: 14, border: "1.5px solid #E8C8C8", background: "#FDF5F5", cursor: "pointer", color: "#B8544F", fontSize: 15, fontWeight: 600, fontFamily: "var(--f)" }}>로그아웃</button>
      </div>
    </div>
  );
}

function CourseView({ steps }) {
  if (!steps?.length) return null;
  return (
    <div style={{ margin: "14px 0 8px", padding: "18px", background: BG, borderRadius: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: A, marginBottom: 14, letterSpacing: "0.06em" }}>코스 순서</div>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "stretch", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 26 }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: STEP_C[i % STEP_C.length], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{i + 1}</div>
            {i < steps.length - 1 && <div style={{ width: 1.5, flex: 1, minHeight: 14, background: BDR, margin: "4px 0" }} />}
          </div>
          <span style={{ fontSize: 14, fontWeight: 500, color: TXT, paddingTop: 3, paddingBottom: i < steps.length - 1 ? 10 : 0, lineHeight: 1.3 }}>{s}</span>
        </div>
      ))}
    </div>
  );
}

function MemoModal({ onSubmit, onClose, busy }) {
  const [t, setT] = useState(""); const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(45,42,35,0.18)", backdropFilter: "blur(8px)", zIndex: 1500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: POPUP, borderRadius: 26, width: "100%", maxWidth: 400, padding: "28px 24px 32px", animation: "fadeIn 0.3s", boxShadow: "0 24px 80px rgba(0,0,0,0.08)" }}>
        <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: A, letterSpacing: "0.06em" }}>빠른 메모</p>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: TXT2 }}>대충 적어도 AI가 깔끔하게 정리해줘요</p>
        <textarea ref={ref} value={t} onChange={e => setT(e.target.value)} placeholder="혜화 오덕새 카페 → 띡에서 밥" rows={4}
          style={{ width: "100%", padding: "16px 18px", borderRadius: 14, background: BG, border: `1.5px solid ${BDR}`, color: TXT, fontSize: 15, fontFamily: "var(--f)", outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.7 }}
          onFocus={e => e.target.style.borderColor = A} onBlur={e => e.target.style.borderColor = BDR} />
        <button onClick={() => t.trim() && onSubmit(t.trim())} disabled={!t.trim() || busy}
          style={{ width: "100%", padding: "16px", borderRadius: 14, border: "none", marginTop: 14, background: t.trim() && !busy ? A : BDR, color: t.trim() && !busy ? "#fff" : TXT3, fontSize: 15, fontWeight: 600, fontFamily: "var(--f)", cursor: t.trim() && !busy ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {busy ? (<><div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />정리 중...</>) : "AI로 정리하기"}
        </button>
      </div>
    </div>
  );
}

function FolderPopup({ analysis, folders, onSelect, onCreate, onClose, imageData, batchImages, pendingCount, saving }) {
  const [name, setName] = useState(analysis?.new_folder_suggestion || ""); const [ic, setIc] = useState("📁"); const [mode, setMode] = useState("pick");
  const sug = folders.find(f => f.name === analysis?.suggested_folder); const isBatch = batchImages && batchImages.length > 1;
  return (
    <div onClick={() => !saving && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(45,42,35,0.18)", backdropFilter: "blur(8px)", zIndex: 1500, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: POPUP, borderRadius: "26px 26px 0 0", width: "100%", maxWidth: 520, padding: "24px 24px 36px", maxHeight: "70vh", overflow: "auto", animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 -12px 48px rgba(0,0,0,0.06)" }}>
        <div style={{ width: 32, height: 3, background: BDR, borderRadius: 2, margin: "0 auto 22px" }} />
        {isBatch ? (
          <div style={{ padding: "14px 16px", background: BG, borderRadius: 14, marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><span style={{ fontSize: 14, fontWeight: 700, color: TXT }}>{batchImages.length}장 일괄 저장</span><span style={{ fontSize: 12, color: A, fontWeight: 600 }}>폴더 한 번만 선택</span></div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>{batchImages.slice(0, 8).map((img, i) => <img key={i} src={img} style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: `1px solid ${BDR}` }} />)}{batchImages.length > 8 && <div style={{ width: 48, height: 48, borderRadius: 8, background: BDR, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: TXT2, fontWeight: 600 }}>+{batchImages.length - 8}</div>}</div>
          </div>
        ) : imageData ? (
          <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "14px 16px", background: BG, borderRadius: 14, marginBottom: 18 }}>
            <img src={imageData} style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: TXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{analysis?.title || "제목 없음"}</div><div style={{ fontSize: 12, color: TXT3, marginTop: 3 }}>{analysis?.summary?.slice(0, 40)}</div></div>
            {pendingCount > 0 && <div style={{ background: `${A}18`, borderRadius: 8, padding: "4px 10px" }}><span style={{ fontSize: 11, color: A, fontWeight: 600 }}>+{pendingCount}</span></div>}
          </div>
        ) : null}
        {mode === "pick" ? (<>
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: A, letterSpacing: "0.06em" }}>폴더 선택</p>
          <p style={{ margin: "0 0 18px", fontSize: 14, color: TXT2 }}>AI 추천 → <span style={{ color: A, fontWeight: 600 }}>{analysis?.suggested_folder || analysis?.new_folder_suggestion || "새 폴더"}</span></p>
          {saving ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "30px 0" }}><div style={{ width: 20, height: 20, border: `2.5px solid ${BDR}`, borderTopColor: A, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /><span style={{ fontSize: 14, color: A, fontWeight: 600 }}>저장 중...</span></div> : (<>
          {sug && <button onClick={() => onSelect(sug.id)} style={{ width: "100%", padding: "16px 18px", borderRadius: 14, border: `1.5px solid ${A}33`, background: `${A}0A`, cursor: "pointer", marginBottom: 8, display: "flex", alignItems: "center", gap: 14, textAlign: "left" }}><div style={{ width: 40, height: 40, borderRadius: 12, background: `${A}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{sug.icon}</div><div><div style={{ fontSize: 15, fontWeight: 600, color: TXT }}>{sug.name}</div><div style={{ fontSize: 11, color: A, fontWeight: 500, marginTop: 2 }}>AI 추천</div></div></button>}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>{folders.filter(f => f.id !== sug?.id).map(f => <button key={f.id} onClick={() => onSelect(f.id)} style={{ width: "100%", padding: "14px 18px", borderRadius: 12, border: `1px solid ${BDR}`, background: CARD, cursor: "pointer", display: "flex", alignItems: "center", gap: 14, textAlign: "left" }}><div style={{ width: 36, height: 36, borderRadius: 10, background: BG, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{f.icon}</div><span style={{ fontSize: 14, fontWeight: 500, color: TXT }}>{f.name}</span></button>)}</div>
          <button onClick={() => setMode("new")} style={{ width: "100%", padding: "14px", borderRadius: 12, border: `1.5px dashed ${BDR}`, background: "transparent", cursor: "pointer", color: TXT3, fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>+ 새 폴더</button>
          </>)}
        </>) : (<>
          <p style={{ margin: "0 0 18px", fontSize: 11, fontWeight: 600, color: A, letterSpacing: "0.06em" }}>새 폴더 만들기</p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="폴더 이름" autoFocus style={{ width: "100%", padding: "14px 18px", borderRadius: 12, background: BG, border: `1.5px solid ${BDR}`, color: TXT, fontSize: 16, fontWeight: 600, fontFamily: "var(--f)", outline: "none", boxSizing: "border-box", marginBottom: 16 }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 22 }}>{ICONS.map(i => <button key={i} onClick={() => setIc(i)} style={{ width: 40, height: 40, borderRadius: 10, border: ic === i ? `2px solid ${A}` : `1.5px solid ${BDR}`, background: ic === i ? `${A}12` : CARD, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>{i}</button>)}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => !saving && setMode("pick")} style={{ flex: 1, padding: "14px", borderRadius: 12, border: `1.5px solid ${BDR}`, background: CARD, color: TXT2, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>뒤로</button>
            <button onClick={() => name.trim() && !saving && onCreate(name.trim(), ic)} style={{ flex: 2, padding: "14px", borderRadius: 12, border: "none", background: name.trim() && !saving ? A : BDR, color: name.trim() && !saving ? "#fff" : TXT3, fontSize: 14, fontWeight: 600, cursor: name.trim() && !saving ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {saving ? (<><div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />저장 중...</>) : "만들기"}
            </button>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ─── Fullscreen Image Viewer ───
function ImageViewer({ images, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex || 0);
  const touchStart = useRef(null);
  const handleTouchStart = e => { touchStart.current = e.touches[0].clientX; };
  const handleTouchEnd = e => {
    if (!touchStart.current) return;
    const diff = touchStart.current - e.changedTouches[0].clientX;
    if (diff > 50 && idx < images.length - 1) setIdx(i => i + 1);
    if (diff < -50 && idx > 0) setIdx(i => i - 1);
    touchStart.current = null;
  };
  return (
    <div onClick={onClose} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}
      style={{ position: "fixed", inset: 0, background: "#000", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img src={images[idx]} onClick={e => e.stopPropagation()} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
      <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, cursor: "pointer", color: "#fff", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>✕</button>
      {images.length > 1 && <div style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "4px 14px", backdropFilter: "blur(4px)" }}><span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{idx + 1} / {images.length}</span></div>}
      {images.length > 1 && <div style={{ position: "absolute", bottom: 30, display: "flex", gap: 6 }}>{images.map((_, i) => <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: i === idx ? "#fff" : "rgba(255,255,255,0.3)" }} />)}</div>}
      {idx > 0 && <button onClick={e => { e.stopPropagation(); setIdx(i => i - 1); }} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 40, height: 40, cursor: "pointer", color: "#fff", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>}
      {idx < images.length - 1 && <button onClick={e => { e.stopPropagation(); setIdx(i => i + 1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 40, height: 40, cursor: "pointer", color: "#fff", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>}
    </div>
  );
}

// ─── Detail Modal ───
function DetailModal({ item, folders, onClose, onEdit, onCopy }) {
  const [ed, setEd] = useState(false);
  const [d, setD] = useState({ title: item.title, summary: item.summary, folderId: item.folderId });
  const fo = folders.find(f => f.id === item.folderId);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(45,42,35,0.15)", backdropFilter: "blur(12px)", zIndex: 1600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: POPUP, borderRadius: 26, maxWidth: 460, width: "100%", maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.08)" }}>
        {item.imageData ? (
          <div style={{ position: "relative" }}><img src={item.imageData} style={{ width: "100%", maxHeight: 260, objectFit: "contain", background: BG, borderRadius: "26px 26px 0 0" }} /><button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "rgba(248,250,248,0.9)", border: "none", borderRadius: "50%", width: 36, height: 36, cursor: "pointer", color: TXT2, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button></div>
        ) : <div style={{ display: "flex", justifyContent: "flex-end", padding: "18px 18px 0" }}><button onClick={onClose} style={{ background: BG, border: "none", borderRadius: "50%", width: 36, height: 36, cursor: "pointer", color: TXT2, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button></div>}
        <div style={{ padding: item.imageData ? "20px 24px 26px" : "8px 24px 26px" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {fo && <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", background: BG, borderRadius: 8 }}><span style={{ fontSize: 13 }}>{fo.icon}</span><span style={{ fontSize: 12, color: TXT2, fontWeight: 600 }}>{fo.name}</span></div>}
            {item.type === "memo" && <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", background: `${A}12`, borderRadius: 8 }}><span style={{ fontSize: 12, color: A, fontWeight: 600 }}>메모</span></div>}
          </div>
          {ed ? (<>
            <input value={d.title} onChange={e => setD({ ...d, title: e.target.value })} style={{ width: "100%", background: BG, border: `1.5px solid ${BDR}`, borderRadius: 12, padding: "12px 16px", color: TXT, fontSize: 18, fontWeight: 700, fontFamily: "var(--f)", outline: "none", marginBottom: 10, boxSizing: "border-box" }} />
            <textarea value={d.summary} onChange={e => setD({ ...d, summary: e.target.value })} rows={5} style={{ width: "100%", background: BG, border: `1.5px solid ${BDR}`, borderRadius: 12, padding: "12px 16px", color: TXT2, fontSize: 14, lineHeight: 1.8, fontFamily: "var(--f)", outline: "none", resize: "vertical", marginBottom: 10, boxSizing: "border-box" }} />
            <select value={d.folderId || ""} onChange={e => setD({ ...d, folderId: e.target.value || null })} style={{ width: "100%", background: BG, border: `1.5px solid ${BDR}`, borderRadius: 12, padding: "12px 16px", color: TXT2, fontSize: 14, fontFamily: "var(--f)", outline: "none", marginBottom: 16, boxSizing: "border-box" }}><option value="">폴더 없음</option>{folders.map(f => <option key={f.id} value={f.id}>{f.icon} {f.name}</option>)}</select>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setEd(false)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: `1.5px solid ${BDR}`, background: CARD, color: TXT2, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--f)" }}>취소</button>
              <button onClick={() => { onEdit(item.id, d); setEd(false); onClose(); }} style={{ flex: 2, padding: "13px", borderRadius: 12, border: "none", background: A, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--f)" }}>저장</button>
            </div>
          </>) : (<>
            <h2 style={{ margin: "0 0 10px", fontSize: 21, fontWeight: 700, color: TXT, lineHeight: 1.3 }}>{item.title}</h2>
            {item.summary && <p style={{ margin: "0 0 16px", fontSize: 14.5, color: "#4A5548", lineHeight: 1.85, whiteSpace: "pre-wrap" }}>{item.summary}</p>}
            {item.tags?.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>{item.tags.map((t, i) => <span key={i} style={{ fontSize: 12, color: TXT2, background: BG, fontWeight: 500, borderRadius: 6, padding: "4px 12px" }}>#{t}</span>)}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setEd(true)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: `1.5px solid ${BDR}`, background: CARD, color: TXT2, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--f)" }}>수정</button>
              <button onClick={() => onCopy(item)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: "none", background: BG, color: TXT, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--f)" }}>복사</button>
            </div>
            <div style={{ marginTop: 14, fontSize: 11, color: TXT3 }}>{new Date(item.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ─── Folder Inside View ───
function FolderView({ folder, items, onBack, onDelete, onEdit, onCopy, folders }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [viewer, setViewer] = useState(null);
  const [detail, setDetail] = useState(null);

  const bundles = [];
  const used = new Set();
  items.forEach((item, i) => {
    if (used.has(item.id)) return;
    const time = new Date(item.createdAt).getTime();
    const group = [item];
    used.add(item.id);
    items.forEach((other, j) => {
      if (j <= i || used.has(other.id)) return;
      if (Math.abs(new Date(other.createdAt).getTime() - time) < 60000) { group.push(other); used.add(other.id); }
    });
    bundles.push(group);
  });

  const toggleSelect = id => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };
  const handleDeleteSelected = () => { onDelete([...selected]); setSelected(new Set()); setSelectMode(false); };

  const handleItemClick = (item) => {
    if (selectMode) { toggleSelect(item.id); return; }
    setDetail(item);
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "var(--f)" }}>
      <div style={{ padding: "20px 18px 10px", position: "sticky", top: 0, background: BG, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={TXT2} strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg></button>
          <span style={{ fontSize: 22 }}>{folder.icon}</span>
          <div style={{ flex: 1 }}><div style={{ fontSize: 18, fontWeight: 700, color: TXT }}>{folder.name}</div><div style={{ fontSize: 11, color: TXT3 }}>{items.length}장</div></div>
          <button onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${selectMode ? "#B8544F" : BDR}`, background: selectMode ? "#B8544F10" : CARD, cursor: "pointer", fontSize: 12, fontWeight: 600, color: selectMode ? "#B8544F" : TXT2 }}>{selectMode ? "취소" : "선택"}</button>
        </div>
      </div>

      <div style={{ padding: "4px 14px 120px" }}>
        {bundles.map((bundle, bi) => {
          if (bundle.length === 1) {
            const item = bundle[0];
            return (
              <div key={item.id} style={{ background: CARD, borderRadius: 14, border: `1px solid ${selected.has(item.id) ? A : BDR}`, marginBottom: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer" }} onClick={() => handleItemClick(item)}>
                  {selectMode && <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${selected.has(item.id) ? A : BDR}`, background: selected.has(item.id) ? A : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{selected.has(item.id) && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}</div>}
                  {item.imageData ? <img src={item.imageData} style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} /> : <div style={{ width: 52, height: 52, borderRadius: 10, background: BG, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={TXT3} strokeWidth="1.5"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg></div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                    <div style={{ fontSize: 10, color: TXT3, marginTop: 2 }}>{new Date(item.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}</div>
                  </div>
                  {!selectMode && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TXT3} strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>}
                </div>
              </div>
            );
          }
          const bundleTitle = bundle[0].title || `${new Date(bundle[0].createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}`;
          const allSelected = bundle.every(i => selected.has(i.id));
          return (
            <div key={bi} style={{ background: CARD, borderRadius: 14, border: `1px solid ${allSelected ? A : BDR}`, marginBottom: 10, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center", gap: 10 }}>
                {selectMode && <div onClick={() => { const s = new Set(selected); if (allSelected) bundle.forEach(i => s.delete(i.id)); else bundle.forEach(i => s.add(i.id)); setSelected(s); }} style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${allSelected ? A : BDR}`, background: allSelected ? A : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>{allSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}</div>}
                <div style={{ flex: 1 }} onClick={() => !selectMode && setDetail(bundle[0])} style={{ cursor: selectMode ? "default" : "pointer" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TXT }}>{bundleTitle}</div>
                  <div style={{ fontSize: 10, color: TXT3, marginTop: 2 }}>{new Date(bundle[0].createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} · {bundle.length}장</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, padding: "0 14px 12px", overflowX: "auto" }}>
                {bundle.filter(i => i.imageData).map((item, i) => (
                  <img key={item.id} src={item.imageData}
                    onClick={() => selectMode ? toggleSelect(item.id) : setViewer({ images: bundle.filter(x => x.imageData).map(x => x.imageData), startIndex: i })}
                    style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0, cursor: "pointer", border: selected.has(item.id) ? `2px solid ${A}` : `1px solid ${BDR}` }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selectMode && selected.size > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 20px 32px", background: `linear-gradient(to top, ${BG} 80%, transparent)`, zIndex: 100 }}>
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            <button onClick={handleDeleteSelected} style={{ width: "100%", padding: "14px", borderRadius: 14, border: "none", background: "#B8544F", color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "var(--f)", cursor: "pointer" }}>{selected.size}장 삭제</button>
          </div>
        </div>
      )}

      {viewer && <ImageViewer images={viewer.images} startIndex={viewer.startIndex} onClose={() => setViewer(null)} />}
      {detail && <DetailModal item={detail} folders={folders} onClose={() => setDetail(null)} onEdit={(id, d) => { onEdit(id, d); setDetail(prev => prev ? { ...prev, ...d } : null); }} onCopy={onCopy} />}
    </div>
  );
}

// ─── Main App ───
export default function Keepy() {
  const [user, setUser] = useState(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [openFolder, setOpenFolder] = useState(null); // folder object or "uncategorized"
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [pend, setPend] = useState([]);
  const [cur, setCur] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ msg: "", show: false });
  const [ok, setOk] = useState(false);
  const [memo, setMemo] = useState(false);
  const [aiMode, setAiMode] = useState(false); // Default OFF
  const [usageCount, setUsageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const fRef = useRef(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => { const u = ld(SK_U); if (u) setUser(u); setUserLoaded(true); }, []);
  useEffect(() => {
    if (!user || !userLoaded) return;
    setLoading(true);
    (async () => {
      await migrateLocalToSupabase(user.email);
      const [f, i, u] = await Promise.all([dbLoadFolders(user.email), dbLoadItems(user.email), dbGetUsage(user.email)]);
      setFolders(f || []); setItems(i || []); setUsageCount(u.count); setOk(true); setLoading(false);
    })();
  }, [user, userLoaded]);

  useEffect(() => {
    const h = e => { if (e.data?.type === 'shared-images' && e.data.files?.length && user) handleFiles(e.data.files); };
    navigator.serviceWorker?.addEventListener('message', h);
    return () => navigator.serviceWorker?.removeEventListener('message', h);
  }, [user, folders]);

  const flash = m => { setToast({ msg: m, show: true }); setTimeout(() => setToast(t => ({ ...t, show: false })), 2200); };
  const handleLogin = u => { setUser(u); sv(SK_U, u); flash(`환영합니다, ${u.name}님!`); };
  const handleLogout = () => { setUser(null); sv(SK_U, null); setShowProfile(false); setItems([]); setFolders([]); setOk(false); setOpenFolder(null); };

  const handleFiles = async files => {
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const comp = await Promise.all(imgs.map(f => compress(f)));
    if (!aiMode) {
      const title = `${comp.length}장 · ${new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      setCur({ batchImages: comp, imageData: comp[0], analysis: { title, summary: `${comp.length}장의 캡처`, tags: [], suggested_folder: null, new_folder_suggestion: null, is_course: false, course_steps: null } });
      return;
    }
    if (usageCount >= MONTHLY_LIMIT) { flash(`AI 한도(${MONTHLY_LIMIT}회) 도달`); return; }
    setPend(comp.slice(1)); setBusy(true);
    const nc = await dbAddUsage(user.email); setUsageCount(nc);
    const a = await analyzeImg(comp[0], folders);
    setCur({ imageData: comp[0], analysis: a }); setBusy(false);
  };

  const handleMemo = async t => {
    if (usageCount >= MONTHLY_LIMIT) { flash("AI 한도 도달"); setMemo(false); return; }
    setMemo(false); setBusy(true);
    const nc = await dbAddUsage(user.email); setUsageCount(nc);
    const a = await tidyMemo(t, folders); setCur({ rawMemo: t, analysis: a }); setBusy(false);
  };

  const saveIt = async fid => {
    if (!cur || saving) return; setSaving(true);
    const { imageData, rawMemo, analysis, batchImages } = cur;
    if (batchImages?.length > 0) {
      const now = new Date();
      const newItems = batchImages.map((img, i) => ({ id: uid(), type: "capture", imageData: img, rawMemo: null, title: `${now.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} (${i + 1})`, summary: "", tags: [], courseSteps: [], folderId: fid, createdAt: new Date(now.getTime() + i).toISOString() }));
      for (const item of newItems) await dbSaveItem(user.email, item);
      setItems(p => [...newItems.reverse(), ...p]); setCur(null); setSaving(false); flash(`${batchImages.length}장 저장 ✓`); return;
    }
    const ni = { id: uid(), type: imageData ? "capture" : "memo", imageData: imageData || null, rawMemo: rawMemo || null, title: analysis?.title || "제목 없음", summary: analysis?.summary || "", tags: analysis?.tags || [], courseSteps: analysis?.is_course ? (analysis?.course_steps || []) : [], folderId: fid, createdAt: new Date().toISOString() };
    await dbSaveItem(user.email, ni); setItems(p => [ni, ...p]); setCur(null); setSaving(false); flash("저장 완료 ✓");
    if (pend.length > 0) {
      const [n, ...r] = pend; setPend(r);
      if (!aiMode) { setCur({ imageData: n, analysis: { title: new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric" }), summary: "", tags: [], suggested_folder: null, new_folder_suggestion: null, is_course: false, course_steps: null } }); }
      else { if (usageCount >= MONTHLY_LIMIT) { flash("AI 한도 도달"); setPend([]); return; } setBusy(true); const nc = await dbAddUsage(user.email); setUsageCount(nc); analyzeImg(n, folders).then(a => { setCur({ imageData: n, analysis: a }); setBusy(false); }); }
    }
  };

  const mkSave = async (n, ic) => { if (saving) return; setSaving(true); const nf = { id: uid(), name: n, icon: ic, createdAt: new Date().toISOString() }; await dbSaveFolder(user.email, nf); setFolders(p => [...p, nf]); await saveIt(nf.id); };

  const handleEdit = async (id, data) => {
    await dbUpdateItem(user.email, id, data);
    setItems(p => p.map(i => i.id === id ? { ...i, ...data } : i));
  };

  const handleDeleteItems = async ids => { await dbDeleteItems(user.email, ids); setItems(p => p.filter(i => !ids.includes(i.id))); flash(`${ids.length}장 삭제됨`); };

  const handleDeleteFolder = async fid => { await dbDeleteFolder(user.email, fid); setFolders(p => p.filter(f => f.id !== fid)); setItems(p => p.map(i => i.folderId === fid ? { ...i, folderId: null } : i)); setOpenFolder(null); flash("폴더 삭제됨"); };

  const copy = item => {
    const f = folders.find(f => f.id === item.folderId);
    let t = item.title + "\n\n";
    if (item.courseSteps?.length) t += "코스: " + item.courseSteps.map((s, i) => `${i + 1}. ${s}`).join(" → ") + "\n\n";
    t += item.summary;
    if (item.tags?.length) t += "\n\n" + item.tags.map(x => "#" + x).join(" ");
    if (f) t += "\n\n📁 " + f.name;
    navigator.clipboard.writeText(t).then(() => flash("복사됨 ✓"));
  };

  // Filtered folders for search
  const filteredFolders = q ? folders.filter(f => f.name.toLowerCase().includes(q.toLowerCase())) : folders;
  const uncategorizedCount = items.filter(i => !i.folderId).length;

  if (!userLoaded) return null;

  return (
    <div style={{ minHeight: "100vh", background: BG, maxWidth: 520, margin: "0 auto", position: "relative", fontFamily: "var(--f)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        :root { --f: 'DM Sans', -apple-system, sans-serif; }
        @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; margin: 0; }
        ::-webkit-scrollbar { display: none; }
        input::placeholder, textarea::placeholder { color: ${TXT3}; }
      `}</style>

      {!user ? <LoginScreen onLogin={handleLogin} /> : loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 16 }}>
          <div style={{ width: 28, height: 28, border: `3px solid ${BDR}`, borderTopColor: A, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: 14, color: TXT2 }}>불러오는 중...</span>
        </div>
      ) : openFolder ? (
        <FolderView
          folder={openFolder === "uncategorized" ? { icon: "📌", name: "미분류" } : openFolder}
          items={openFolder === "uncategorized" ? items.filter(i => !i.folderId) : items.filter(i => i.folderId === openFolder.id)}
          onBack={() => setOpenFolder(null)}
          onDelete={handleDeleteItems}
          onEdit={handleEdit}
          onCopy={copy}
          folders={folders}
        />
      ) : (
        <div style={{ paddingBottom: 120 }}>
          {/* Header */}
          <div style={{ padding: "40px 26px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 300, color: TXT, letterSpacing: "0.06em" }}>kee<span style={{ fontWeight: 800, color: A }}>py</span></h1>
                <p style={{ fontSize: 12, color: TXT3, fontWeight: 500, marginTop: 2 }}>AI 캡처 정리</p>
              </div>
              <button onClick={() => setShowProfile(true)} style={{ width: 38, height: 38, borderRadius: "50%", background: `${A}20`, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 0 }}>
                {user.avatar ? <img src={user.avatar} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }} referrerPolicy="no-referrer" /> : <span style={{ fontSize: 14, fontWeight: 700, color: A }}>{user.name?.slice(0, 1) || "U"}</span>}
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, background: CARD, borderRadius: 14, padding: "12px 18px", border: `1.5px solid ${BDR}` }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={TXT3} strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input type="text" placeholder="폴더 검색" value={q} onChange={e => setQ(e.target.value)} style={{ background: "none", border: "none", outline: "none", flex: 1, color: TXT, fontSize: 14, fontFamily: "var(--f)", fontWeight: 500 }} />
              {q && <button onClick={() => setQ("")} style={{ background: BDR, border: "none", borderRadius: "50%", width: 20, height: 20, color: TXT2, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>}
            </div>
          </div>

          {/* Folder Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "8px 20px 16px" }}>
            {filteredFolders.map(f => (
              <button key={f.id} onClick={() => setOpenFolder(f)} style={{ background: CARD, borderRadius: 10, padding: "8px 12px", border: `0.5px solid ${BDR}`, display: "flex", alignItems: "center", gap: 8, height: 46, cursor: "pointer", transition: "all 0.15s" }}>
                <span style={{ fontSize: 20 }}>{f.icon}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: TXT }}>{f.name}</span>
              </button>
            ))}
            {(!q || "미분류".includes(q)) && uncategorizedCount > 0 && (
              <button onClick={() => setOpenFolder("uncategorized")} style={{ background: CARD, borderRadius: 10, padding: "8px 12px", border: `0.5px solid ${BDR}`, display: "flex", alignItems: "center", gap: 8, height: 46, cursor: "pointer" }}>
                <span style={{ fontSize: 20 }}>📌</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: TXT }}>미분류</span>
              </button>
            )}
          </div>

          {filteredFolders.length === 0 && uncategorizedCount === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 40px", textAlign: "center" }}>
              <div style={{ width: 64, height: 64, borderRadius: 18, background: SUB, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, marginBottom: 16 }}>📸</div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: TXT, marginBottom: 6 }}>아직 비어있어요</h3>
              <p style={{ fontSize: 13, color: TXT3, lineHeight: 1.7 }}>캡처 이미지를 올리거나<br/>메모를 남겨보세요</p>
            </div>
          )}

          {/* Bottom Bar */}
          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "10px 20px 32px", zIndex: 100, background: `linear-gradient(to top, ${BG} 80%, transparent)` }}>
            <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", gap: 10 }}>
              <button onClick={() => !busy && setMemo(true)} style={{ width: 52, height: 52, borderRadius: 16, border: `1.5px solid ${BDR}`, background: CARD, cursor: busy ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 12px rgba(0,0,0,0.03)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={TXT2} strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
              </button>
              <div onClick={() => !busy && fRef.current?.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
                style={{ flex: 1, background: drag ? `${A}0A` : CARD, border: `1.5px dashed ${drag ? A : BDR}`, borderRadius: 16, padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: busy ? "wait" : "pointer", transition: "all 0.3s", boxShadow: "0 2px 12px rgba(0,0,0,0.03)" }}>
                {busy ? (<><div style={{ width: 16, height: 16, border: `2px solid ${BDR}`, borderTopColor: A, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /><span style={{ fontSize: 13, color: A, fontWeight: 600 }}>분석 중{pend.length > 0 ? ` · ${pend.length}장` : ""}...</span></>) : (<><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TXT3} strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg><span style={{ fontSize: 13, color: TXT2, fontWeight: 500 }}>캡처 드롭 또는 탭</span></>)}
                <input ref={fRef} type="file" accept="image/*" multiple onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
              </div>
              <button onClick={() => { setAiMode(p => !p); flash(aiMode ? "AI OFF — 바로 저장" : "AI ON — 자동 정리"); }}
                style={{ width: 52, height: 52, borderRadius: 16, border: `1.5px solid ${aiMode ? A : BDR}`, background: aiMode ? `${A}15` : CARD, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 12px rgba(0,0,0,0.03)", gap: 2, transition: "all 0.2s" }}>
                <span style={{ fontSize: 14, color: aiMode ? TXT : TXT3 }}>AI</span>
                <div style={{ width: 24, height: 12, borderRadius: 6, background: aiMode ? A : BDR, position: "relative", transition: "all 0.2s" }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#fff", position: "absolute", top: 1, left: aiMode ? 13 : 1, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} /></div>
              </button>
            </div>
          </div>

          {showProfile && <ProfileMenu user={user} usageCount={usageCount} onLogout={handleLogout} onClose={() => setShowProfile(false)} />}
        </div>
      )}

      {memo && <MemoModal onSubmit={handleMemo} onClose={() => setMemo(false)} busy={busy} />}
      {cur && <FolderPopup analysis={cur.analysis} folders={folders} onSelect={saveIt} onCreate={mkSave} onClose={() => !saving && saveIt(null)} imageData={cur.imageData} batchImages={cur.batchImages} pendingCount={pend.length} saving={saving} />}
      <Toast msg={toast.msg} show={toast.show} />
    </div>
  );
}
