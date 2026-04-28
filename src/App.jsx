import { useState, useRef, useEffect } from "react";

const SK_I = "keepy-items-v2";
const SK_F = "keepy-folders-v2";
const SK_U = "keepy-user-v1";
const SK_USAGE = "keepy-usage-v1";
const MONTHLY_LIMIT = 50;

function getUsage() {
  const now = new Date();
  const key = `${now.getFullYear()}-${now.getMonth() + 1}`;
  const usage = ld(SK_USAGE) || {};
  return { count: usage[key] || 0, key, usage };
}

function addUsage() {
  const { count, key, usage } = getUsage();
  usage[key] = count + 1;
  sv(SK_USAGE, usage);
  return count + 1;
}

function canUseAI() {
  return getUsage().count < MONTHLY_LIMIT;
}
function ld(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
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
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, messages: msgs })
    });
    const d = await r.json(); return d.content?.map(i => i.text || "").join("") || "";
  } catch { return null; }
}

async function analyzeImg(b64, folders) {
  const fl = folders.map(f => f.name).join(", ");
  const t = await callAI([{ role: "user", content: [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64.split(",")[1] } },
    { type: "text", text: `이 캡처 이미지를 분석. 현재 폴더: [${fl || "없음"}]
순수 JSON만 (코드블록 없이):
{"title":"제목 15자이내","summary":"정리 메모 3-5문장. 코스있으면 ①②③","tags":["태그1","태그2","태그3"],"suggested_folder":"기존폴더명 or null","new_folder_suggestion":"새폴더 8자이내","is_course":false,"course_steps":null}
is_course: 여행코스/일정/루트면 true, course_steps에 순서대로.` }
  ]}]);
  try { return JSON.parse(t.replace(/```json|```/g, "").trim()); } catch { return null; }
}

async function tidyMemo(raw, folders) {
  const fl = folders.map(f => f.name).join(", ");
  const t = await callAI([{ role: "user", content: `메모 정리. 폴더: [${fl || "없음"}]
메모: """${raw}"""
순수 JSON만 (코드블록 없이):
{"title":"제목 15자이내","summary":"깔끔 정리 3-5문장. 코스있으면 ①②③","tags":["태그1","태그2","태그3"],"suggested_folder":"기존폴더명 or null","new_folder_suggestion":"새폴더 8자이내","is_course":false,"course_steps":null}` }]);
  try { return JSON.parse(t.replace(/```json|```/g, "").trim()); } catch { return null; }
}

const ICONS = ["📁","📍","💅","🍽️","👗","💪","💡","📸","🎵","🏠","✈️","📚","🛍️","🌿","☕","🎨","🐶","🎮"];
const STEP_C = ["#7B8DAA","#6B8F71","#C07888","#8B7BAA","#B8544F","#4A7B8C","#8A7055","#5C8A8A","#C4956A","#5B6ABF"];
const A = "#7B8DAA";
const BG = "#EDF0ED";
const CARD = "#F8FAF8";
const BDR = "#DFE3DF";
const SUB = "#DFE3DF";
const TXT = "#2D2A23";
const TXT2 = "#6E7A6E";
const TXT3 = "#9BA49B";
const POPUP = "#F6F8F6";

const GOOGLE_CLIENT_ID = "149148234188-huoergpo44qmp3avok7fcs1slno9h5u7.apps.googleusercontent.com";

function decodeJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

function LoginScreen({ onLogin }) {
  const btnRef = useRef(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          const payload = decodeJwt(response.credential);
          if (payload) {
            onLogin({
              name: payload.name || "사용자",
              email: payload.email || "",
              avatar: payload.picture || null,
              provider: "google",
            });
          }
        },
      });
      window.google?.accounts.id.renderButton(btnRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 320,
        locale: "ko",
      });
    };
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch {} };
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "var(--f)", padding: "40px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{ fontSize: 42, fontWeight: 300, color: TXT, letterSpacing: "0.06em", margin: "0 0 8px" }}>
          kee<span style={{ fontWeight: 800, color: A }}>py</span>
        </h1>
        <p style={{ fontSize: 14, color: TXT2, lineHeight: 1.6 }}>
          스크린샷, 릴스 캡처, 메모를<br/>AI가 알아서 분류하고 정리해요
        </p>
      </div>
      <div ref={btnRef} style={{ display: "flex", justifyContent: "center" }} />
      <p style={{ fontSize: 12, color: TXT3, marginTop: 32, textAlign: "center", lineHeight: 1.6 }}>
        계속하면 서비스 이용약관 및<br/>개인정보 처리방침에 동의하게 됩니다
      </p>
    </div>
  );
}

function ProfileMenu({ user, onLogout, onClose }) {
  const { count } = getUsage();
  const pct = Math.min((count / MONTHLY_LIMIT) * 100, 100);
  const isNear = count >= MONTHLY_LIMIT * 0.8;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(45,42,35,0.18)", backdropFilter: "blur(8px)", zIndex: 1500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: POPUP, borderRadius: 26, width: "100%", maxWidth: 400, padding: "28px 24px 32px", animation: "fadeIn 0.3s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 24px 80px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          {user.avatar ? <img src={user.avatar} style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} referrerPolicy="no-referrer" /> : <div style={{ width: 48, height: 48, borderRadius: "50%", background: `${A}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: A, fontFamily: "var(--f)" }}>{user.name?.slice(0, 1) || "U"}</div>}
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: TXT, fontFamily: "var(--f)" }}>{user.name}</div>
            <div style={{ fontSize: 13, color: TXT2, fontFamily: "var(--f)", marginTop: 2 }}>{user.email}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, padding: "3px 10px", borderRadius: 6, background: "rgba(66,133,244,0.08)" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4285F4" }}></div>
              <span style={{ fontSize: 11, color: "#4285F4", fontWeight: 600, fontFamily: "var(--f)" }}>Google</span>
            </div>
          </div>
        </div>
        <div style={{ background: BG, borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: TXT, fontFamily: "var(--f)" }}>이번 달 AI 사용량</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: isNear ? "#B8544F" : A, fontFamily: "var(--f)" }}>{count} / {MONTHLY_LIMIT}</span>
          </div>
          <div style={{ width: "100%", height: 6, borderRadius: 3, background: BDR }}>
            <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: isNear ? "#B8544F" : A, transition: "width 0.3s" }} />
          </div>
          <p style={{ fontSize: 11, color: TXT3, fontFamily: "var(--f)", marginTop: 8 }}>
            {count >= MONTHLY_LIMIT ? "한도를 모두 사용했어요. 다음 달에 초기화됩니다" : `${MONTHLY_LIMIT - count}회 남았어요 · 매월 1일 초기화`}
          </p>
        </div>
        <button onClick={onLogout} style={{ width: "100%", padding: "15px", borderRadius: 14, border: "1.5px solid #E8C8C8", background: "#FDF5F5", cursor: "pointer", color: "#B8544F", fontSize: 15, fontWeight: 600, fontFamily: "var(--f)" }}>로그아웃</button>
      </div>
    </div>
  );
}

function Toast({ msg, show }) {
  return <div style={{ position: "fixed", bottom: 120, left: "50%", transform: `translateX(-50%) translateY(${show ? 0 : 10}px)`, background: TXT, color: CARD, padding: "11px 24px", borderRadius: 100, fontSize: 13, fontWeight: 500, fontFamily: "var(--f)", opacity: show ? 1 : 0, transition: "all 0.35s cubic-bezier(0.16,1,0.3,1)", zIndex: 2000, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", pointerEvents: "none" }}>{msg}</div>;
}

function CourseView({ steps }) {
  if (!steps?.length) return null;
  return (
    <div style={{ margin: "14px 0 8px", padding: "18px", background: BG, borderRadius: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: A, marginBottom: 14, fontFamily: "var(--f)", letterSpacing: "0.06em" }}>코스 순서</div>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "stretch", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 26 }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: STEP_C[i % STEP_C.length], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: "var(--f)", flexShrink: 0 }}>{i + 1}</div>
            {i < steps.length - 1 && <div style={{ width: 1.5, flex: 1, minHeight: 14, background: BDR, margin: "4px 0" }} />}
          </div>
          <span style={{ fontSize: 14, fontWeight: 500, color: TXT, fontFamily: "var(--f)", paddingTop: 3, paddingBottom: i < steps.length - 1 ? 10 : 0, lineHeight: 1.3 }}>{s}</span>
        </div>
      ))}
    </div>
  );
}

function MemoModal({ onSubmit, onClose, busy }) {
  const [t, setT] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(45,42,35,0.18)", backdropFilter: "blur(8px)", zIndex: 1500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: POPUP, borderRadius: 26, width: "100%", maxWidth: 400, padding: "28px 24px 32px", animation: "fadeIn 0.3s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 24px 80px rgba(0,0,0,0.08)" }}>
        <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: A, fontFamily: "var(--f)", letterSpacing: "0.06em" }}>빠른 메모</p>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: TXT2, fontFamily: "var(--f)" }}>대충 적어도 AI가 깔끔하게 정리해줘요</p>
        <textarea ref={ref} value={t} onChange={e => setT(e.target.value)} placeholder="혜화 오덕새 카페 → 띡에서 밥 → 마로니에공원 산책" rows={4}
          style={{ width: "100%", padding: "16px 18px", borderRadius: 14, background: BG, border: `1.5px solid ${BDR}`, color: TXT, fontSize: 15, fontFamily: "var(--f)", fontWeight: 400, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.7, transition: "border-color 0.2s" }}
          onFocus={e => e.target.style.borderColor = A} onBlur={e => e.target.style.borderColor = BDR} />
        <button onClick={() => t.trim() && onSubmit(t.trim())} disabled={!t.trim() || busy}
          style={{ width: "100%", padding: "16px", borderRadius: 14, border: "none", marginTop: 14, background: t.trim() && !busy ? A : BDR, color: t.trim() && !busy ? "#fff" : TXT3, fontSize: 15, fontWeight: 600, fontFamily: "var(--f)", cursor: t.trim() && !busy ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.2s" }}>
          {busy ? (<><div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />정리하는 중...</>) : "AI로 정리하기"}
        </button>
      </div>
    </div>
  );
}

function FolderPopup({ analysis, folders, onSelect, onCreate, onClose, imageData, rawMemo, pendingCount }) {
  const [name, setName] = useState(analysis?.new_folder_suggestion || "");
  const [ic, setIc] = useState("📁");
  const [mode, setMode] = useState("pick");
  const sug = folders.find(f => f.name === analysis?.suggested_folder);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(45,42,35,0.18)", backdropFilter: "blur(8px)", zIndex: 1500, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: POPUP, borderRadius: "26px 26px 0 0", width: "100%", maxWidth: 520, padding: "24px 24px 36px", maxHeight: "70vh", overflow: "auto", animation: "slideUp 0.4s cubic-bezier(0.16,1,0.3,1)", boxShadow: "0 -12px 48px rgba(0,0,0,0.06)" }}>
        <div style={{ width: 32, height: 3, background: BDR, borderRadius: 2, margin: "0 auto 22px" }} />

        {/* Preview card */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "14px 16px", background: BG, borderRadius: 14, marginBottom: 18 }}>
          {imageData ? (
            <img src={imageData} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: 10, background: BDR, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={TXT3} strokeWidth="1.5"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: TXT, fontFamily: "var(--f)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{analysis?.title || "제목 없음"}</div>
            <div style={{ fontSize: 12, color: TXT3, fontFamily: "var(--f)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{analysis?.summary?.slice(0, 40) || ""}</div>
          </div>
          {pendingCount > 0 && (
            <div style={{ background: `${A}18`, borderRadius: 8, padding: "4px 10px", flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: A, fontWeight: 600, fontFamily: "var(--f)" }}>+{pendingCount}</span>
            </div>
          )}
        </div>

        {mode === "pick" ? (<>
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: A, fontFamily: "var(--f)", letterSpacing: "0.06em" }}>폴더 선택</p>
          <p style={{ margin: "0 0 18px", fontSize: 14, color: TXT2, fontFamily: "var(--f)" }}>AI 추천 → <span style={{ color: A, fontWeight: 600 }}>{analysis?.suggested_folder || analysis?.new_folder_suggestion || "새 폴더"}</span></p>
          {sug && (
            <button onClick={() => onSelect(sug.id)} style={{ width: "100%", padding: "16px 18px", borderRadius: 14, border: `1.5px solid ${A}33`, background: `${A}0A`, cursor: "pointer", marginBottom: 8, display: "flex", alignItems: "center", gap: 14, textAlign: "left" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: `${A}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{sug.icon}</div>
              <div><div style={{ fontSize: 15, fontWeight: 600, color: TXT, fontFamily: "var(--f)" }}>{sug.name}</div><div style={{ fontSize: 11, color: A, fontFamily: "var(--f)", fontWeight: 500, marginTop: 2 }}>AI 추천</div></div>
            </button>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
            {folders.filter(f => f.id !== sug?.id).map(f => (
              <button key={f.id} onClick={() => onSelect(f.id)} style={{ width: "100%", padding: "14px 18px", borderRadius: 12, border: `1px solid ${BDR}`, background: CARD, cursor: "pointer", display: "flex", alignItems: "center", gap: 14, textAlign: "left" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: BG, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{f.icon}</div>
                <span style={{ fontSize: 14, fontWeight: 500, color: TXT, fontFamily: "var(--f)" }}>{f.name}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setMode("new")} style={{ width: "100%", padding: "14px", borderRadius: 12, border: `1.5px dashed ${BDR}`, background: "transparent", cursor: "pointer", color: TXT3, fontSize: 14, fontWeight: 600, fontFamily: "var(--f)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>+ 새 폴더</button>
        </>) : (<>
          <p style={{ margin: "0 0 18px", fontSize: 11, fontWeight: 600, color: A, fontFamily: "var(--f)", letterSpacing: "0.06em" }}>새 폴더 만들기</p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="폴더 이름" autoFocus
            style={{ width: "100%", padding: "14px 18px", borderRadius: 12, background: BG, border: `1.5px solid ${BDR}`, color: TXT, fontSize: 16, fontWeight: 600, fontFamily: "var(--f)", outline: "none", boxSizing: "border-box", marginBottom: 16 }}
            onFocus={e => e.target.style.borderColor = A} onBlur={e => e.target.style.borderColor = BDR} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 22 }}>
            {ICONS.map(i => (<button key={i} onClick={() => setIc(i)} style={{ width: 40, height: 40, borderRadius: 10, border: ic === i ? `2px solid ${A}` : `1.5px solid ${BDR}`, background: ic === i ? `${A}12` : CARD, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>{i}</button>))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setMode("pick")} style={{ flex: 1, padding: "14px", borderRadius: 12, border: `1.5px solid ${BDR}`, background: CARD, color: TXT2, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--f)" }}>뒤로</button>
            <button onClick={() => name.trim() && onCreate(name.trim(), ic)} style={{ flex: 2, padding: "14px", borderRadius: 12, border: "none", background: name.trim() ? A : BDR, color: name.trim() ? "#fff" : TXT3, fontSize: 14, fontWeight: 600, cursor: name.trim() ? "pointer" : "default", fontFamily: "var(--f)" }}>만들기</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

function Detail({ item, folders, onClose, onEdit, onCopy }) {
  const [ed, setEd] = useState(false);
  const [d, setD] = useState({ title: item.title, summary: item.summary, folderId: item.folderId });
  const fo = folders.find(f => f.id === item.folderId);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(45,42,35,0.15)", backdropFilter: "blur(12px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: POPUP, borderRadius: 26, maxWidth: 460, width: "100%", maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.08)" }}>
        {item.imageData ? (
          <div style={{ position: "relative" }}>
            <img src={item.imageData} alt="" style={{ width: "100%", maxHeight: 260, objectFit: "contain", background: BG, borderRadius: "26px 26px 0 0" }} />
            <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "rgba(248,250,248,0.9)", border: "none", borderRadius: "50%", width: 36, height: 36, cursor: "pointer", color: TXT2, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "18px 18px 0" }}>
            <button onClick={onClose} style={{ background: BG, border: "none", borderRadius: "50%", width: 36, height: 36, cursor: "pointer", color: TXT2, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
        )}
        <div style={{ padding: item.imageData ? "20px 26px 28px" : "8px 26px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {fo && (<div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", background: BG, borderRadius: 8 }}><span style={{ fontSize: 13 }}>{fo.icon}</span><span style={{ fontSize: 12, color: TXT2, fontWeight: 600, fontFamily: "var(--f)" }}>{fo.name}</span></div>)}
            {item.type === "memo" && (<div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 12px", background: `${A}12`, borderRadius: 8 }}><span style={{ fontSize: 12, color: A, fontWeight: 600, fontFamily: "var(--f)" }}>메모</span></div>)}
          </div>
          {ed ? (<>
            <input value={d.title} onChange={e => setD({ ...d, title: e.target.value })} style={{ width: "100%", background: BG, border: `1.5px solid ${BDR}`, borderRadius: 12, padding: "12px 16px", color: TXT, fontSize: 18, fontWeight: 700, fontFamily: "var(--f)", outline: "none", marginBottom: 10, boxSizing: "border-box" }} />
            <textarea value={d.summary} onChange={e => setD({ ...d, summary: e.target.value })} rows={5} style={{ width: "100%", background: BG, border: `1.5px solid ${BDR}`, borderRadius: 12, padding: "12px 16px", color: TXT2, fontSize: 14, lineHeight: 1.8, fontFamily: "var(--f)", outline: "none", resize: "vertical", marginBottom: 10, boxSizing: "border-box" }} />
            <select value={d.folderId || ""} onChange={e => setD({ ...d, folderId: e.target.value || null })} style={{ width: "100%", background: BG, border: `1.5px solid ${BDR}`, borderRadius: 12, padding: "12px 16px", color: TXT2, fontSize: 14, fontFamily: "var(--f)", outline: "none", marginBottom: 16, boxSizing: "border-box" }}>
              <option value="">폴더 없음</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.icon} {f.name}</option>)}
            </select>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setEd(false)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: `1.5px solid ${BDR}`, background: CARD, color: TXT2, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--f)" }}>취소</button>
              <button onClick={() => { onEdit(item.id, d); setEd(false); }} style={{ flex: 2, padding: "13px", borderRadius: 12, border: "none", background: A, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--f)" }}>저장</button>
            </div>
          </>) : (<>
            <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 700, color: TXT, fontFamily: "var(--f)", lineHeight: 1.3 }}>{item.title}</h2>
            {item.courseSteps?.length > 0 && <CourseView steps={item.courseSteps} />}
            <p style={{ margin: "0 0 18px", fontSize: 15, color: "#4A5548", fontFamily: "var(--f)", lineHeight: 1.85, whiteSpace: "pre-wrap" }}>{item.summary}</p>
            {item.rawMemo && (<details style={{ marginBottom: 16 }}><summary style={{ fontSize: 12, color: TXT3, cursor: "pointer", fontFamily: "var(--f)", fontWeight: 500 }}>원본 메모 보기</summary><p style={{ margin: "8px 0 0", fontSize: 13, color: TXT2, fontFamily: "var(--f)", lineHeight: 1.6, background: BG, padding: 14, borderRadius: 12 }}>{item.rawMemo}</p></details>)}
            {item.tags?.length > 0 && (<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>{item.tags.map((t, i) => <span key={i} style={{ fontSize: 12, color: TXT2, background: BG, fontWeight: 500, borderRadius: 6, padding: "4px 12px", fontFamily: "var(--f)" }}>#{t}</span>)}</div>)}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setEd(true)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: `1.5px solid ${BDR}`, background: CARD, color: TXT2, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--f)" }}>수정</button>
              <button onClick={() => onCopy(item)} style={{ flex: 1, padding: "13px", borderRadius: 12, border: "none", background: BG, color: TXT, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--f)" }}>복사</button>
            </div>
            <div style={{ marginTop: 16, fontSize: 11, color: TXT3, fontFamily: "var(--f)" }}>{new Date(item.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          </>)}
        </div>
      </div>
    </div>
  );
}

function Card({ item, folder, onClick, onDel }) {
  const [h, setH] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: CARD, borderRadius: 18, overflow: "hidden", cursor: "pointer", border: `1px solid ${BDR}`, transition: "all 0.3s cubic-bezier(0.16,1,0.3,1)", transform: h ? "translateY(-2px)" : "none", boxShadow: h ? `0 12px 40px ${A}15` : "0 1px 3px rgba(0,0,0,0.02)" }}>
      {item.imageData ? (
        <div style={{ width: "100%", aspectRatio: "4/3", overflow: "hidden", position: "relative", background: BG }}>
          <img src={item.imageData} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 0.4s", transform: h ? "scale(1.03)" : "scale(1)" }} />
          {folder && (<div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 4, background: "rgba(248,250,248,0.92)", backdropFilter: "blur(8px)", borderRadius: 7, padding: "3px 10px" }}><span style={{ fontSize: 10 }}>{folder.icon}</span><span style={{ fontSize: 10, color: "#4A5548", fontWeight: 600, fontFamily: "var(--f)" }}>{folder.name}</span></div>)}
          {item.courseSteps?.length > 0 && (<div style={{ position: "absolute", bottom: 8, left: 8, background: `${A}DD`, borderRadius: 6, padding: "2px 9px" }}><span style={{ fontSize: 9, color: "#fff", fontWeight: 600, fontFamily: "var(--f)" }}>코스 {item.courseSteps.length}곳</span></div>)}
          {h && <button onClick={e => { e.stopPropagation(); onDel(item.id); }} style={{ position: "absolute", top: 8, right: 8, background: "rgba(248,250,248,0.92)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", color: "#B8544F", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>}
        </div>
      ) : (
        <div style={{ width: "100%", aspectRatio: "4/3", background: BG, position: "relative", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={TXT3} strokeWidth="1.5"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
          {folder && (<div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 4, background: CARD, borderRadius: 7, padding: "3px 10px" }}><span style={{ fontSize: 10 }}>{folder.icon}</span><span style={{ fontSize: 10, color: "#4A5548", fontWeight: 600, fontFamily: "var(--f)" }}>{folder.name}</span></div>)}
          {item.courseSteps?.length > 0 && (<div style={{ background: `${A}18`, borderRadius: 6, padding: "3px 10px", marginTop: 8 }}><span style={{ fontSize: 9, color: A, fontWeight: 600, fontFamily: "var(--f)" }}>코스 {item.courseSteps.length}곳</span></div>)}
          {h && <button onClick={e => { e.stopPropagation(); onDel(item.id); }} style={{ position: "absolute", top: 8, right: 8, background: CARD, border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", color: "#B8544F", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>}
        </div>
      )}
      <div style={{ padding: "13px 15px 15px" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: TXT, fontFamily: "var(--f)", lineHeight: 1.4, marginBottom: 5, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.title}</h3>
        <p style={{ margin: 0, fontSize: 12.5, color: TXT2, fontFamily: "var(--f)", lineHeight: 1.55, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.summary}</p>
      </div>
    </div>
  );
}

export default function Keepy() {
  const [user, setUser] = useState(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pend, setPend] = useState([]);
  const [cur, setCur] = useState(null);
  const [toast, setToast] = useState({ msg: "", show: false });
  const [ok, setOk] = useState(false);
  const [memo, setMemo] = useState(false);
  const [aiMode, setAiMode] = useState(true);
  const fRef = useRef(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => { const u = ld(SK_U); if (u) setUser(u); setUserLoaded(true); }, []);
  useEffect(() => { if (!user || !userLoaded) return; const i = ld(SK_I); const f = ld(SK_F); if (i) setItems(i); if (f) setFolders(f); setOk(true); }, [user, userLoaded]);
  useEffect(() => { if (ok) sv(SK_I, items); }, [items, ok]);
  useEffect(() => { if (ok) sv(SK_F, folders); }, [folders, ok]);


  // Listen for shared images from service worker
  useEffect(() => {
    const handleSWMessage = (event) => {
      if (event.data?.type === 'shared-images') {
        const files = event.data.files;
        if (files?.length > 0 && user) {
          handleFiles(files);
        }
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSWMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', handleSWMessage);
  }, [user, folders]);

  const flash = m => { setToast({ msg: m, show: true }); setTimeout(() => setToast(t => ({ ...t, show: false })), 2200); };
  const handleLogin = u => { setUser(u); sv(SK_U, u); flash(`환영합니다, ${u.name}님!`); };
  const handleLogout = () => { setUser(null); sv(SK_U, null); setShowProfile(false); setItems([]); setFolders([]); setOk(false); };

  const handleFiles = async files => {
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const comp = await Promise.all(imgs.map(f => compress(f)));

    if (!aiMode) {
      // AI off: no analysis, but still show folder popup one by one
      setPend(comp.slice(1));
      const title = new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      setCur({ imageData: comp[0], analysis: { title, summary: "", tags: [], suggested_folder: null, new_folder_suggestion: null, is_course: false, course_steps: null } });
      return;
    }

    if (!canUseAI()) { flash(`이번 달 AI 분석 한도(${MONTHLY_LIMIT}회)를 모두 사용했어요`); return; }
    setPend(comp.slice(1)); setBusy(true);
    addUsage();
    const a = await analyzeImg(comp[0], folders);
    setCur({ imageData: comp[0], analysis: a }); setBusy(false);
  };
  const handleMemo = async t => {
    if (!canUseAI()) { flash(`이번 달 AI 분석 한도(${MONTHLY_LIMIT}회)를 모두 사용했어요`); setMemo(false); return; }
    setMemo(false); setBusy(true); addUsage();
    const a = await tidyMemo(t, folders); setCur({ rawMemo: t, analysis: a }); setBusy(false);
  };

  const saveIt = fid => {
    if (!cur) return;
    const { imageData, rawMemo, analysis } = cur;
    setItems(p => [{ id: uid(), type: imageData ? "capture" : "memo", imageData: imageData || null, rawMemo: rawMemo || null, title: analysis?.title || "제목 없음", summary: analysis?.summary || "", tags: analysis?.tags || [], courseSteps: analysis?.is_course ? (analysis?.course_steps || []) : [], folderId: fid, createdAt: new Date().toISOString() }, ...p]);
    setCur(null); flash("저장 완료 ✓");
    if (pend.length > 0) {
      const [n, ...r] = pend; setPend(r);
      if (!aiMode) {
        const title = new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        setCur({ imageData: n, analysis: { title, summary: "", tags: [], suggested_folder: null, new_folder_suggestion: null, is_course: false, course_steps: null } });
      } else {
        if (!canUseAI()) { flash(`이번 달 한도 도달 — 나머지 ${pend.length + 1}장은 건너뛰었어요`); setPend([]); return; }
        setBusy(true); addUsage();
        analyzeImg(n, folders).then(a => { setCur({ imageData: n, analysis: a }); setBusy(false); });
      }
    }
  };
  const mkSave = (n, ic) => { const nf = { id: uid(), name: n, icon: ic, createdAt: new Date().toISOString() }; setFolders(p => [...p, nf]); saveIt(nf.id); };

  const copy = item => {
    const f = folders.find(f => f.id === item.folderId);
    let t = item.title + "\n\n";
    if (item.courseSteps?.length) t += "코스: " + item.courseSteps.map((s, i) => `${i + 1}. ${s}`).join(" → ") + "\n\n";
    t += item.summary;
    if (item.tags?.length) t += "\n\n" + item.tags.map(x => "#" + x).join(" ");
    if (f) t += "\n\n📁 " + f.name;
    navigator.clipboard.writeText(t).then(() => flash("복사됨 ✓"));
  };

  const fil = items.filter(i => {
    if (sel && i.folderId !== sel) return false;
    if (q) { const s = q.toLowerCase(); return i.title?.toLowerCase().includes(s) || i.summary?.toLowerCase().includes(s) || i.tags?.some(t => t.toLowerCase().includes(s)) || i.courseSteps?.some(x => x.toLowerCase().includes(s)); }
    return true;
  });

  if (!userLoaded) return null;

  return (
    <div style={{ minHeight: "100vh", background: BG, maxWidth: 520, margin: "0 auto", position: "relative" }}>
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

      {!user ? <LoginScreen onLogin={handleLogin} /> : (
        <div style={{ paddingBottom: 120 }}>
          <div style={{ padding: "40px 26px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 300, color: TXT, fontFamily: "var(--f)", letterSpacing: "0.06em" }}>kee<span style={{ fontWeight: 800, color: A }}>py</span></h1>
                <p style={{ fontSize: 12, color: TXT3, fontFamily: "var(--f)", fontWeight: 500, marginTop: 2 }}>AI 캡처 정리</p>
              </div>
              <button onClick={() => setShowProfile(true)} style={{ width: 38, height: 38, borderRadius: "50%", background: `${A}20`, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: A, fontFamily: "var(--f)", overflow: "hidden", padding: 0 }}>
                {user.avatar ? <img src={user.avatar} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }} referrerPolicy="no-referrer" /> : (user.name?.slice(0, 1) || "U")}
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, background: CARD, borderRadius: 14, padding: "12px 18px", border: `1.5px solid ${BDR}` }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={TXT3} strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input type="text" placeholder="검색" value={q} onChange={e => setQ(e.target.value)}
                style={{ background: "none", border: "none", outline: "none", flex: 1, color: TXT, fontSize: 14, fontFamily: "var(--f)", fontWeight: 500 }} />
              {q && <button onClick={() => setQ("")} style={{ background: BDR, border: "none", borderRadius: "50%", width: 20, height: 20, color: TXT2, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, padding: "4px 26px 14px", overflowX: "auto", position: "sticky", top: 0, zIndex: 50, background: BG }}>
            <button onClick={() => setSel(null)} style={{ padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", fontFamily: "var(--f)", background: !sel ? A : SUB, color: !sel ? "#fff" : TXT2 }}>전체 {items.length}</button>
            {folders.map(f => {
              const c = items.filter(i => i.folderId === f.id).length;
              const a = sel === f.id;
              return (
                <div key={f.id} style={{ position: "relative" }}>
                  <button onClick={() => setSel(a ? null : f.id)} style={{ padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: a ? 700 : 500, whiteSpace: "nowrap", fontFamily: "var(--f)", background: a ? A : SUB, color: a ? "#fff" : TXT2 }}>{f.icon} {f.name}{c > 0 ? ` ${c}` : ""}</button>
                  {a && <button onClick={e => { e.stopPropagation(); setFolders(p => p.filter(x => x.id !== f.id)); setItems(p => p.map(i => i.folderId === f.id ? { ...i, folderId: null } : i)); setSel(null); flash("삭제됨"); }} style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: "50%", background: "#B8544F", border: `2px solid ${BG}`, cursor: "pointer", color: "#fff", fontSize: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>}
                </div>
              );
            })}
          </div>

          {fil.length === 0 && !busy ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 40px", textAlign: "center", animation: "fadeIn 0.5s ease" }}>
              <div style={{ width: 72, height: 72, borderRadius: 20, background: SUB, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, marginBottom: 20 }}>📸</div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: TXT, fontFamily: "var(--f)", marginBottom: 8 }}>{q ? "검색 결과 없음" : "아직 비어있어요"}</h3>
              <p style={{ fontSize: 14, color: TXT3, fontFamily: "var(--f)", lineHeight: 1.7 }}>{q ? "다른 키워드로 검색해보세요" : "캡처 이미지를 올리거나\n메모를 남겨보세요"}</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, padding: "2px 18px 16px" }}>
              {fil.map((item, idx) => (
                <div key={item.id} style={{ animation: `fadeIn 0.4s ease ${idx * 0.05}s both` }}>
                  <Card item={item} folder={folders.find(f => f.id === item.folderId)} onClick={() => setDetail(item)} onDel={id => setItems(p => p.filter(i => i.id !== id))} />
                </div>
              ))}
            </div>
          )}

          <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "10px 20px 32px", zIndex: 100, background: `linear-gradient(to top, ${BG} 80%, transparent)` }}>
            <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", gap: 10 }}>
              <button onClick={() => !busy && setMemo(true)} style={{ width: 52, height: 52, borderRadius: 16, border: `1.5px solid ${BDR}`, background: CARD, cursor: busy ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 12px rgba(0,0,0,0.03)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={TXT2} strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
              </button>
              <div onClick={() => !busy && fRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
                style={{ flex: 1, background: drag ? `${A}0A` : CARD, border: `1.5px dashed ${drag ? A : BDR}`, borderRadius: 16, padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: busy ? "wait" : "pointer", transition: "all 0.3s", boxShadow: "0 2px 12px rgba(0,0,0,0.03)" }}>
                {busy ? (<><div style={{ width: 16, height: 16, border: `2px solid ${BDR}`, borderTopColor: A, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /><span style={{ fontSize: 13, color: A, fontWeight: 600, fontFamily: "var(--f)" }}>분석 중{pend.length > 0 ? ` · ${pend.length}장 대기` : ""}...</span></>) : (<><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={TXT3} strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg><span style={{ fontSize: 13, color: TXT2, fontWeight: 500, fontFamily: "var(--f)" }}>캡처 드롭 또는 탭</span></>)}
                <input ref={fRef} type="file" accept="image/*" multiple onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
              </div>
              <button onClick={() => { setAiMode(p => !p); flash(aiMode ? "AI 분석 OFF — 바로 저장" : "AI 분석 ON — 자동 정리"); }}
                style={{ width: 52, height: 52, borderRadius: 16, border: `1.5px solid ${aiMode ? A : BDR}`, background: aiMode ? `${A}15` : CARD, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 12px rgba(0,0,0,0.03)", gap: 2, transition: "all 0.2s" }}>
                <span style={{ fontSize: 14 }}>AI</span>
                <div style={{ width: 24, height: 12, borderRadius: 6, background: aiMode ? A : BDR, position: "relative", transition: "all 0.2s" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#fff", position: "absolute", top: 1, left: aiMode ? 13 : 1, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />
                </div>
              </button>
            </div>
          </div>

          {showProfile && <ProfileMenu user={user} onLogout={handleLogout} onClose={() => setShowProfile(false)} />}
        </div>
      )}

      {memo && <MemoModal onSubmit={handleMemo} onClose={() => setMemo(false)} busy={busy} />}
      {cur && <FolderPopup analysis={cur.analysis} folders={folders} onSelect={saveIt} onCreate={mkSave} onClose={() => saveIt(null)} imageData={cur.imageData} rawMemo={cur.rawMemo} pendingCount={pend.length} />}
      {detail && <Detail item={detail} folders={folders} onClose={() => setDetail(null)} onEdit={(id, d) => { setItems(p => p.map(i => i.id === id ? { ...i, ...d } : i)); setDetail(prev => prev ? { ...prev, ...d } : null); }} onCopy={copy} />}
      <Toast msg={toast.msg} show={toast.show} />
    </div>
  );
}
