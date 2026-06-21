import { useState, useMemo, useEffect } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";

// ── Supabase config ───────────────────────────────────────────────────────────
const SUPA_URL = "https://dgtpmshfnttcsqjaxvmy.supabase.co";
const SUPA_KEY = "sb_publishable_q6Z1JxhnxrRk5c0p4_VfvA_Q6OWi9hF";
const supabase = createClient(SUPA_URL, SUPA_KEY);

const db = {
  async get(table, query = "") {
    const res = await fetch(`${SUPA_URL}/rest/v1/${table}${query}`, {
      headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` },
    });
    return res.json();
  },
  async post(table, body) {
    const res = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
  async patch(table, id, body) {
    const res = await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
  async delete(table, id) {
    await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE",
      headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` },
    });
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtShort = (n) => n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : "$" + (n / 1000).toFixed(0) + "K";
const fmtDate = (d) => { if (!d) return "—"; const p = d.split("-"); const m = MONTHS[+p[1]-1]||""; return p.length===2?`${m} '${p[0].slice(2)}`:`${m} ${+p[2]}, ${p[0]}`; };
const fmtAxis = (d) => { if (!d) return ""; const p = d.split("-"); return `${MONTHS[+p[1]-1]||""} '${p[0].slice(2)}`; };
const pct = (a, b) => (((b - a) / a) * 100).toFixed(1);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => { const vals = line.split(",").map((v) => v.trim()); const obj = {}; headers.forEach((h, i) => (obj[h] = vals[i] || "")); return obj; });
}

// ── AI comparables ────────────────────────────────────────────────────────────
async function fetchComparables(artist, medium, category) {
  try {
    const res = await fetch("/api/comparables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist, medium, category }),
    });
    if (res.ok) { const d = await res.json(); if (d?.comparables) return d; }
  } catch (_) {}
  const callClaude = async (messages, useSearch = false) => {
    const body = { model: "claude-sonnet-4-6", max_tokens: 2000, messages };
    if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  };
  const extractText = (d) => (d.content||[]).filter((b)=>b.type==="text").map((b)=>b.text).join("\n").trim();
  const tryParse = (s) => { const c=s.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim(); try{return JSON.parse(c);}catch(_){} const a=c.indexOf("{"),b=c.lastIndexOf("}"); if(a!==-1&&b>a){try{return JSON.parse(c.slice(a,b+1));}catch(_){}} return null; };
  const sd = await callClaude([{ role:"user", content:`Search for recent auction results (2020–2025) for works by ${artist}${medium?`, particularly ${medium}`:""}. Find 5–7 real hammer prices from Christie's, Sotheby's, Phillips, or Bonhams. List each result with: work title, year made, medium, sale price in USD, auction house, and sale date (YYYY-MM). Note market trend (rising/stable/declining) and value drivers.` }], true);
  const st = extractText(sd);
  if (!st) throw new Error("No search results");
  const jd = await callClaude([{ role:"user", content:`Convert this auction research to JSON. Return ONLY raw JSON starting with { ending with }.\n\nResearch:\n${st}\n\nShape:\n{"artist":"${artist}","marketSummary":"2-3 sentences","trend":"rising","comparables":[{"title":"Title","year":1955,"medium":"Oil","salePrice":1200000,"auctionHouse":"Christies","saleDate":"2023-06"}],"lowEstimate":500000,"highEstimate":2000000,"notes":"value drivers"}\n\ntrend: rising/stable/declining. salePrice as integer USD.` }], false);
  const parsed = tryParse(extractText(jd));
  if (!parsed) throw new Error("Could not parse — please try again");
  return parsed;
}

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = { bg:"#0F0E0C", card:"#161410", border:"#252019", gold:"#C9A84C", goldFaint:"#C9A84C22", text:"#E4DCCF", muted:"#8A7A68", dim:"#5A5044", green:"#6FA87A", red:"#A8706F", inner:"#121009", active:"#1C1914" };
const mkBtn = (v="primary",x={}) => ({ background:v==="primary"?C.gold:v==="danger"?"#3D1515":"transparent", color:v==="primary"?C.bg:v==="danger"?"#C97070":C.gold, border:`1px solid ${v==="primary"?C.gold:v==="danger"?"#6B2525":C.border}`, padding:"7px 14px", cursor:"pointer", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", borderRadius:2, fontFamily:"Georgia, serif", whiteSpace:"nowrap", ...x });
const mkInput = (x={}) => ({ background:C.inner, border:`1px solid ${C.border}`, color:C.text, padding:"8px 10px", borderRadius:2, fontSize:13, width:"100%", fontFamily:"Georgia, serif", outline:"none", boxSizing:"border-box", ...x });
const LBL  = { fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:C.dim, marginBottom:4, display:"block" };
const CARD = { background:C.card, border:`1px solid ${C.border}`, borderRadius:3, padding:"16px", marginBottom:14 };
const SEC  = { fontSize:9, letterSpacing:"0.22em", textTransform:"uppercase", color:C.dim, marginBottom:10, borderBottom:`1px solid ${C.border}`, paddingBottom:6 };

const ChartTip = ({ active, payload, label:lbl }) => {
  if (!active||!payload?.length) return null;
  return <div style={{ background:"#1A1712", border:`1px solid ${C.goldFaint}`, padding:"9px 13px", borderRadius:3, fontSize:12 }}><div style={{ color:C.gold, marginBottom:3 }}>{lbl}</div>{payload.map((p)=><div key={p.dataKey} style={{ color:p.color }}>{p.name}: {fmt(p.value)}</div>)}</div>;
};

const StatCard = ({ lbl, val, sub, subColor }) => (
  <div style={{ background:C.card, border:`1px solid ${C.border}`, padding:"13px 14px", borderRadius:3, minWidth:0 }}>
    <div style={LBL}>{lbl}</div>
    <div style={{ fontSize:18, color:C.text, lineHeight:1.2, wordBreak:"break-word" }}>{val}</div>
    {sub && <div style={{ fontSize:11, color:subColor||C.muted, marginTop:3 }}>{sub}</div>}
  </div>
);

function calcPortStats(objects) {
  const totals = objects.map((o) => { const s=[...o.valuations].sort((a,b)=>a.date.localeCompare(b.date)); return { first:s[0]?.value||0, last:s[s.length-1]?.value||0 }; });
  const cur=totals.reduce((acc,t)=>acc+t.last,0), acq=totals.reduce((acc,t)=>acc+t.first,0), gain=cur-acq;
  return { cur, acq, gain, gainPct:acq?((gain/acq)*100).toFixed(1):"0.0" };
}

// ── Public Client View (no auth required) ─────────────────────────────────────
function PublicClientView() {
  const { slug } = useParams();
  const [client, setClient] = useState(null);
  const [objects, setObjects] = useState([]);
  const [selectedObj, setSelectedObj] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cls = await db.get("clients", `?slug=eq.${slug}&limit=1`);
        if (!cls?.length) { setNotFound(true); setLoading(false); return; }
        const c = cls[0];
        setClient(c);
        const [objs, vals] = await Promise.all([
          db.get("objects", `?client_id=eq.${c.id}&order=created_at.asc`),
          db.get("valuations", "?order=date.asc"),
        ]);
        const merged = (objs||[]).map(o => ({
          ...o,
          valuations: (vals||[]).filter(v=>v.object_id===o.id).map(v=>({ date:v.date, value:+v.value, note:v.note||"", _id:v.id })),
        }));
        setObjects(merged);
      } catch(e) { console.error(e); }
      setLoading(false);
    })();
  }, [slug]);

  const stats = useMemo(() => calcPortStats(objects), [objects]);

  const portfolioChart = useMemo(() => {
    const dates = [...new Set(objects.flatMap(o=>o.valuations.map(v=>v.date)))].sort();
    return dates.map(date => {
      let total=0;
      objects.forEach(obj => { const s=[...obj.valuations].sort((a,b)=>a.date.localeCompare(b.date)); const before=s.filter(v=>v.date<=date); if(before.length) total+=before[before.length-1].value; });
      return { date:fmtAxis(date), total };
    });
  }, [objects]);

  const objChart = useMemo(() => {
    if (!selectedObj) return [];
    return [...selectedObj.valuations].sort((a,b)=>a.date.localeCompare(b.date)).map(v=>({ date:fmtAxis(v.date), value:v.value }));
  }, [selectedObj]);

  if (loading) return (
    <div style={{ background:C.bg, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Georgia, serif" }}>
      <div style={{ color:C.dim, fontSize:12 }}>Loading collection…</div>
    </div>
  );

  if (notFound) return (
    <div style={{ background:C.bg, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Georgia, serif" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ color:C.gold, fontSize:20, letterSpacing:"0.14em", marginBottom:8 }}>PROVENANCE</div>
        <div style={{ color:C.dim, fontSize:13 }}>Collection not found.</div>
      </div>
    </div>
  );

  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text, fontFamily:"Georgia, serif", overflowX:"hidden" }}>
      {/* Header */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"14px 16px" }}>
        <div style={{ fontSize:14, letterSpacing:"0.16em", color:C.gold, marginBottom:2 }}>PROVENANCE</div>
        <div style={{ fontSize:9, letterSpacing:"0.2em", color:C.dim, textTransform:"uppercase" }}>Collection Value Intelligence</div>
      </div>

      <div style={{ padding:"18px 16px", maxWidth:860, margin:"0 auto" }}>
        {!selectedObj ? (<>
          {/* Client header */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:24, marginBottom:4 }}>{client.name}</div>
            <div style={{ fontSize:11, color:C.dim, letterSpacing:"0.08em" }}>Private Collection · {new Date().getFullYear()}</div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
            <StatCard lbl="Total Value" val={fmt(stats.cur)} />
            <StatCard lbl="Total Gain" val={fmt(stats.gain)} sub={`${stats.gain>=0?"▲":"▼"} ${Math.abs(stats.gainPct)}%`} subColor={stats.gain>=0?C.green:C.red} />
            <StatCard lbl="Objects" val={objects.length} />
            <StatCard lbl="Acquisition Cost" val={fmt(stats.acq)} />
          </div>

          {portfolioChart.length > 0 && (
            <div style={CARD}>
              <div style={SEC}>Portfolio Value Over Time</div>
              <ResponsiveContainer width="100%" height={190}>
                <LineChart data={portfolioChart} margin={{ top:4, right:4, left:0, bottom:0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.active} />
                  <XAxis dataKey="date" tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={{ stroke:C.border }} />
                  <YAxis tickFormatter={fmtShort} tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={<ChartTip />} />
                  <Line type="monotone" dataKey="total" stroke={C.gold} strokeWidth={2} dot={{ fill:C.gold, r:3 }} activeDot={{ r:5 }} name="Total Value" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {objects.length > 0 && <>
            <div style={SEC}>Collection</div>
            {objects.map(obj => {
              const s=[...obj.valuations].sort((a,b)=>a.date.localeCompare(b.date)), cur=s[s.length-1]?.value||0, fst=s[0]?.value||0, g=fst?pct(fst,cur):null;
              return (
                <div key={obj.id}
                  style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px", cursor:"pointer", borderRadius:2, marginBottom:4, background:C.card, border:`1px solid ${C.border}`, boxSizing:"border-box" }}
                  onClick={() => setSelectedObj(obj)}>
                  <div style={{ flex:1, minWidth:0, paddingRight:10 }}>
                    <div style={{ fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{obj.title}</div>
                    <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{obj.artist}{obj.year ? ` · ${obj.year}` : ""}</div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontSize:14, color:C.gold }}>{fmt(cur)}</div>
                    {g!==null&&<div style={{ fontSize:11, color:cur>=fst?C.green:C.red, marginTop:1 }}>{cur>=fst?"▲":"▼"} {Math.abs(g)}%</div>}
                  </div>
                </div>
              );
            })}
          </>}

          <div style={{ marginTop:24, paddingTop:16, borderTop:`1px solid ${C.border}`, fontSize:10, color:C.dim, textAlign:"center", lineHeight:1.6 }}>
            Prepared by Provenance · Collection Value Intelligence<br/>
            Values shown are estimates for reference only.
          </div>
        </>) : (
          // Object detail
          <div>
            <button style={mkBtn("ghost",{ fontSize:10, padding:"5px 12px", marginBottom:14 })} onClick={()=>setSelectedObj(null)}>← Collection</button>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:22, lineHeight:1.2, marginBottom:4 }}>{selectedObj.title}</div>
              <div style={{ fontSize:12, color:C.muted }}>{selectedObj.artist}{selectedObj.year?` · ${selectedObj.year}`:""}{selectedObj.medium?` · ${selectedObj.medium}`:""}</div>
            </div>
            {(() => {
              const s=[...selectedObj.valuations].sort((a,b)=>a.date.localeCompare(b.date));
              if (!s.length) return null;
              const first=s[0], last=s[s.length-1], change=last.value-first.value, changePct=pct(first.value,last.value);
              return (<>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                  <StatCard lbl="Current Value" val={fmt(last.value)} sub={fmtDate(last.date)} />
                  <StatCard lbl="Total Change" val={fmt(change)} sub={`${change>=0?"▲":"▼"} ${Math.abs(changePct)}%`} subColor={change>=0?C.green:C.red} />
                  <StatCard lbl="Acquired" val={fmt(first.value)} sub={fmtDate(first.date)} />
                  <StatCard lbl="Valuations" val={s.length} />
                </div>
                {objChart.length>0&&<div style={CARD}>
                  <div style={SEC}>Value History</div>
                  <ResponsiveContainer width="100%" height={170}>
                    <LineChart data={objChart} margin={{ top:4, right:4, left:0, bottom:0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.active} />
                      <XAxis dataKey="date" tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={{ stroke:C.border }} />
                      <YAxis tickFormatter={fmtShort} tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip content={<ChartTip />} />
                      <Line type="monotone" dataKey="value" stroke={C.gold} strokeWidth={2} dot={{ fill:C.gold, r:4 }} activeDot={{ r:6 }} name={selectedObj.artist} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>}
                <div style={CARD}>
                  <div style={SEC}>Valuation History</div>
                  {[...s].reverse().map((v,i,arr)=>{
                    const prev=arr[i+1], chg=prev?v.value-prev.value:null, chgP=prev?pct(prev.value,v.value):null;
                    return (<div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
                      <div><div style={{ fontSize:14, color:C.gold, marginBottom:2 }}>{fmt(v.value)}</div><div style={{ fontSize:11, color:C.dim }}>{fmtDate(v.date)}</div>{v.note&&<div style={{ fontSize:11, color:C.muted, marginTop:1 }}>{v.note}</div>}</div>
                      <div style={{ textAlign:"right" }}>{chg!==null?(<><div style={{ fontSize:13, color:chg>=0?C.green:C.red }}>{chg>=0?"▲":"▼"} {fmt(Math.abs(chg))}</div><div style={{ fontSize:11, color:chg>=0?C.green:C.red, marginTop:1 }}>{Math.abs(chgP)}%</div></>):(<div style={{ fontSize:11, color:C.dim }}>Acquisition</div>)}</div>
                    </div>);
                  })}
                </div>
              </>);
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function ComparablesPanel({ object }) {
  const [status, setStatus] = useState("idle");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const run = async () => { setStatus("loading"); setErr(""); try { setData(await fetchComparables(object.artist, object.medium, object.category)); setStatus("done"); } catch(e) { setErr(e.message); setStatus("error"); } };
  const cur = [...object.valuations].sort((a,b)=>a.date.localeCompare(b.date)).slice(-1)[0]?.value;
  const tC = !data?C.dim:data.trend==="rising"?C.green:data.trend==="declining"?C.red:C.muted;
  const tA = data?.trend==="rising"?"▲":data?.trend==="declining"?"▼":"◆";
  const tL = data?.trend?data.trend[0].toUpperCase()+data.trend.slice(1):"—";
  let vsM = null;
  if (cur&&data?.lowEstimate&&data?.highEstimate) { if(cur<data.lowEstimate) vsM={label:"Below range",color:C.gold}; else if(cur>data.highEstimate) vsM={label:"Above range",color:C.gold}; else vsM={label:"Within range",color:C.green}; }
  const cc = (data?.comparables||[]).filter((c)=>c.salePrice&&c.saleDate).sort((a,b)=>a.saleDate.localeCompare(b.saleDate)).map((c)=>({ date:fmtAxis(c.saleDate), comp:c.salePrice }));
  return (
    <div style={CARD}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:12 }}>
        <div style={{ fontSize:9, letterSpacing:"0.22em", textTransform:"uppercase", color:C.dim }}>Market Comparables · AI</div>
        <button style={mkBtn(status==="done"?"ghost":"secondary",{ fontSize:10, padding:"5px 11px" })} onClick={run} disabled={status==="loading"}>{status==="loading"?"Searching…":status==="done"?"↻ Refresh":"Search Live Market"}</button>
      </div>
      {status==="idle"&&<div style={{ padding:"12px 0 2px", color:C.dim, fontSize:12, lineHeight:1.7 }}>Search recent auction sales for <span style={{ color:C.gold }}>{object.artist}</span> to see market comparables.</div>}
      {status==="loading"&&<div style={{ padding:"18px 0 4px", color:C.dim, fontSize:12 }}><style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}`}</style><div style={{ color:C.gold, fontSize:18, marginBottom:8, animation:"pulse 1.4s infinite", textAlign:"center" }}>◎</div><div style={{ textAlign:"center" }}>Searching auction records…</div></div>}
      {status==="error"&&<div style={{ padding:"8px 0 2px", fontSize:12, color:C.red }}>{err}. <span style={{ color:C.gold, cursor:"pointer", textDecoration:"underline" }} onClick={run}>Try again</span></div>}
      {status==="done"&&data&&(<>
        <div style={{ background:C.inner, border:`1px solid ${C.border}`, borderRadius:2, padding:"11px 13px", marginBottom:12 }}>
          <div style={{ display:"flex", gap:18, flexWrap:"wrap", marginBottom:8 }}>
            <div><div style={LBL}>Trend</div><div style={{ color:tC, fontSize:13 }}>{tA} {tL}</div></div>
            {data.lowEstimate&&<div><div style={LBL}>Range</div><div style={{ color:C.text, fontSize:12 }}>{fmt(data.lowEstimate)} – {fmt(data.highEstimate)}</div></div>}
            {vsM&&<div><div style={LBL}>Your Valuation</div><div style={{ color:vsM.color, fontSize:13 }}>{vsM.label}</div></div>}
          </div>
          <div style={{ fontSize:12, color:C.muted, lineHeight:1.65 }}>{data.marketSummary}</div>
          {data.notes&&<div style={{ fontSize:11, color:C.dim, marginTop:6, fontStyle:"italic" }}>{data.notes}</div>}
        </div>
        {data.comparables?.length>0&&<div style={{ marginBottom:12 }}>
          <div style={{ fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:C.dim, marginBottom:7 }}>Recent Sales</div>
          {data.comparables.map((c,i)=>(
            <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"9px 0", borderBottom:`1px solid ${C.border}`, gap:10 }}>
              <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:13, color:C.text, marginBottom:1, wordBreak:"break-word" }}>{c.title||"Untitled"}</div><div style={{ fontSize:11, color:C.dim }}>{[c.medium,c.year,c.auctionHouse].filter(Boolean).join(" · ")}</div></div>
              <div style={{ textAlign:"right", flexShrink:0 }}><div style={{ fontSize:13, color:C.gold }}>{c.salePrice?fmt(c.salePrice):"—"}</div><div style={{ fontSize:11, color:C.dim, marginTop:1 }}>{c.saleDate?fmtAxis(c.saleDate):""}</div></div>
            </div>
          ))}
        </div>}
        {cc.length>=2&&(<><div style={{ fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", color:C.dim, marginBottom:7 }}>Sale Prices Over Time</div><ResponsiveContainer width="100%" height={100}><LineChart data={cc} margin={{ top:2, right:4, left:0, bottom:0 }}><CartesianGrid strokeDasharray="3 3" stroke={C.active} /><XAxis dataKey="date" tick={{ fill:C.dim, fontSize:9 }} tickLine={false} axisLine={{ stroke:C.border }} /><YAxis tickFormatter={fmtShort} tick={{ fill:C.dim, fontSize:9 }} tickLine={false} axisLine={false} width={44} /><Tooltip content={<ChartTip />} /><Line type="monotone" dataKey="comp" stroke="#7B9E87" strokeWidth={2} dot={{ fill:"#7B9E87", r:3 }} name="Sale price" /></LineChart></ResponsiveContainer></>)}
        <div style={{ fontSize:10, color:C.dim, marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:9, lineHeight:1.5 }}>Public auction records. For research only — not a formal appraisal.</div>
      </>)}
    </div>
  );
}

function ConfirmModal({ title, onConfirm, onCancel }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"#000000BB", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:4, padding:"24px 20px", maxWidth:320, width:"100%" }}>
        <div style={{ fontSize:15, color:C.text, marginBottom:8 }}>Delete object?</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:20, lineHeight:1.6 }}><span style={{ color:C.gold }}>{title}</span> and all its valuations will be permanently removed.</div>
        <div style={{ display:"flex", gap:10 }}><button style={mkBtn("danger")} onClick={onConfirm}>Delete</button><button style={mkBtn("ghost")} onClick={onCancel}>Cancel</button></div>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const handleLogin = async () => {
    setLoading(true);
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  };
  return (
    <div style={{ background:C.bg, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Georgia, serif", padding:20 }}>
      <div style={{ textAlign:"center", maxWidth:280 }}>
        <div style={{ color:C.gold, fontSize:24, letterSpacing:"0.18em", marginBottom:6 }}>PROVENANCE</div>
        <div style={{ color:C.dim, fontSize:11, letterSpacing:"0.16em", textTransform:"uppercase", marginBottom:40 }}>Collection Value Intelligence</div>
        <button style={mkBtn("primary", { fontSize:12, padding:"12px 28px", letterSpacing:"0.12em", opacity: loading ? 0.6 : 1 })} onClick={handleLogin} disabled={loading}>
          {loading ? "Redirecting…" : "Sign in with Google"}
        </button>
      </div>
    </div>
  );
}

function ClientsView({ clients, objects, onSelectClient, session, onClientAdded }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newClient, setNewClient] = useState({ name:"", email:"" });
  const [saving, setSaving] = useState(false);
  const addClient = async () => {
    if (!newClient.name) return;
    setSaving(true);
    const slug = slugify(newClient.name) + "-" + Math.random().toString(36).slice(2,6);
    const rows = await db.post("clients", { name:newClient.name, email:newClient.email||null, slug, advisor_id:session.user.id });
    if (rows[0]) { onClientAdded(rows[0]); setNewClient({ name:"", email:"" }); setShowAdd(false); }
    setSaving(false);
  };
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:17 }}>Clients</div>
        <button style={mkBtn("secondary", { fontSize:10, padding:"5px 12px" })} onClick={()=>setShowAdd(v=>!v)}>{showAdd?"Cancel":"+ New Client"}</button>
      </div>
      {showAdd && (
        <div style={CARD}>
          <div style={{ display:"grid", gap:11, marginBottom:13 }}>
            <div><label style={LBL}>Client Name</label><input style={mkInput()} value={newClient.name} onChange={e=>setNewClient({...newClient,name:e.target.value})} placeholder="e.g. Sarah Chen" /></div>
            <div><label style={LBL}>Email (optional)</label><input style={mkInput()} value={newClient.email} onChange={e=>setNewClient({...newClient,email:e.target.value})} placeholder="client@example.com" /></div>
          </div>
          <button style={mkBtn("primary", { opacity:saving?0.6:1 })} onClick={addClient} disabled={saving}>{saving?"Saving…":"Add Client"}</button>
        </div>
      )}
      {clients.length === 0 && !showAdd && <div style={{ textAlign:"center", padding:"40px 0", color:C.dim, fontSize:13 }}>No clients yet. Add your first client above.</div>}
      {clients.map(client => {
        const clientObjs = objects.filter(o => o.client_id === client.id);
        const stats = calcPortStats(clientObjs);
        return (
          <div key={client.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px", cursor:"pointer", borderRadius:2, marginBottom:6, background:C.card, border:`1px solid ${C.border}`, boxSizing:"border-box" }} onClick={() => onSelectClient(client)}>
            <div style={{ flex:1, minWidth:0, paddingRight:10 }}>
              <div style={{ fontSize:15 }}>{client.name}</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{clientObjs.length} object{clientObjs.length!==1?"s":""}{client.email ? ` · ${client.email}` : ""}</div>
            </div>
            <div style={{ textAlign:"right", flexShrink:0 }}>
              <div style={{ fontSize:14, color:C.gold }}>{fmt(stats.cur)}</div>
              {stats.cur > 0 && <div style={{ fontSize:11, color:stats.gain>=0?C.green:C.red, marginTop:1 }}>{stats.gain>=0?"▲":"▼"} {Math.abs(stats.gainPct)}%</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClientPortfolioView({ client, objects, onBack, onSelectObject }) {
  const clientObjs = objects.filter(o => o.client_id === client.id);
  const stats = calcPortStats(clientObjs);
  const shareUrl = `${window.location.origin}/client/${client.slug}`;
  const portfolioChart = useMemo(() => {
    const dates = [...new Set(clientObjs.flatMap(o=>o.valuations.map(v=>v.date)))].sort();
    return dates.map(date => { let total=0; clientObjs.forEach(obj=>{ const s=[...obj.valuations].sort((a,b)=>a.date.localeCompare(b.date)); const before=s.filter(v=>v.date<=date); if(before.length) total+=before[before.length-1].value; }); return { date:fmtAxis(date), total }; });
  }, [clientObjs]);
  const [copied, setCopied] = useState(false);
  const copyLink = () => { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(()=>setCopied(false), 2000); };
  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <button style={mkBtn("ghost",{ fontSize:10, padding:"5px 12px", marginBottom:10 })} onClick={onBack}>← Clients</button>
        <div style={{ fontSize:22, marginBottom:4 }}>{client.name}</div>
        {client.email && <div style={{ fontSize:12, color:C.muted, marginBottom:8 }}>{client.email}</div>}
        <div style={{ display:"flex", alignItems:"center", gap:8, background:C.inner, border:`1px solid ${C.border}`, borderRadius:2, padding:"8px 10px" }}>
          <div style={{ fontSize:11, color:C.dim, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{shareUrl}</div>
          <button style={mkBtn("secondary",{ fontSize:9, padding:"4px 10px" })} onClick={copyLink}>{copied?"Copied!":"Copy Link"}</button>
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
        <StatCard lbl="Total Value" val={fmt(stats.cur)} />
        <StatCard lbl="Total Gain" val={fmt(stats.gain)} sub={`${stats.gain>=0?"▲":"▼"} ${Math.abs(stats.gainPct)}%`} subColor={stats.gain>=0?C.green:C.red} />
        <StatCard lbl="Objects" val={clientObjs.length} />
        <StatCard lbl="Acquisition Cost" val={fmt(stats.acq)} />
      </div>
      {portfolioChart.length > 0 && (
        <div style={CARD}>
          <div style={SEC}>Portfolio Value Over Time</div>
          <ResponsiveContainer width="100%" height={190}><LineChart data={portfolioChart} margin={{ top:4, right:4, left:0, bottom:0 }}><CartesianGrid strokeDasharray="3 3" stroke={C.active} /><XAxis dataKey="date" tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={{ stroke:C.border }} /><YAxis tickFormatter={fmtShort} tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={false} width={44} /><Tooltip content={<ChartTip />} /><Line type="monotone" dataKey="total" stroke={C.gold} strokeWidth={2} dot={{ fill:C.gold, r:3 }} activeDot={{ r:5 }} name="Total Value" /></LineChart></ResponsiveContainer>
        </div>
      )}
      {clientObjs.length === 0 && <div style={{ textAlign:"center", padding:"30px 0", color:C.dim, fontSize:13 }}>No objects yet. Add objects and assign them to {client.name}.</div>}
      {clientObjs.length > 0 && <>
        <div style={SEC}>Collection</div>
        {clientObjs.map(obj => {
          const s=[...obj.valuations].sort((a,b)=>a.date.localeCompare(b.date)), cur=s[s.length-1]?.value||0, fst=s[0]?.value||0, g=fst?pct(fst,cur):null;
          return (
            <div key={obj.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px", cursor:"pointer", borderRadius:2, marginBottom:4, background:C.card, border:`1px solid ${C.border}`, boxSizing:"border-box" }} onClick={() => onSelectObject(obj)}>
              <div style={{ flex:1, minWidth:0, paddingRight:10 }}>
                <div style={{ fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{obj.title}</div>
                <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{obj.artist} · {obj.year}</div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontSize:14, color:C.gold }}>{fmt(cur)}</div>
                {g!==null&&<div style={{ fontSize:11, color:cur>=fst?C.green:C.red, marginTop:1 }}>{cur>=fst?"▲":"▼"} {Math.abs(g)}%</div>}
              </div>
            </div>
          );
        })}
      </>}
    </div>
  );
}

// ── Main advisor app ──────────────────────────────────────────────────────────
function AdvisorApp() {
  const [session,       setSession]       = useState(null);
  const [authLoading,   setAuthLoading]   = useState(true);
  const [objects,       setObjects]       = useState([]);
  const [clients,       setClients]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [selectedId,    setSelectedId]    = useState(null);
  const [selectedClient,setSelectedClient]= useState(null);
  const [view,          setView]          = useState("portfolio");
  const [newObj,        setNewObj]        = useState({ title:"", artist:"", medium:"", year:"", category:"Painting", client_id:"" });
  const [newVal,        setNewVal]        = useState({ date:"", value:"", note:"" });
  const [importText,    setImportText]    = useState("");
  const [importError,   setImportError]   = useState("");
  const [importStep,    setImportStep]    = useState(1);
  const [importMapped,  setImportMapped]  = useState(null);
  const [showAddVal,    setShowAddVal]    = useState(false);
  const [toast,         setToast]         = useState(null);
  const [editMode,      setEditMode]      = useState(false);
  const [editObj,       setEditObj]       = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const notify = (msg) => { setToast(msg); setTimeout(()=>setToast(null), 2800); };
  const selected = objects.find((o)=>o.id===selectedId);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(()=>{
    if (!session) return;
    (async () => {
      try {
        const [objs, vals, cls] = await Promise.all([
          db.get("objects", "?order=created_at.asc"),
          db.get("valuations", "?order=date.asc"),
          db.get("clients", "?order=created_at.asc"),
        ]);
        const merged = (objs||[]).map((o) => ({ ...o, valuations: (vals||[]).filter((v)=>v.object_id===o.id).map((v)=>({ date:v.date, value:+v.value, note:v.note||"", _id:v.id })) }));
        setObjects(merged); setClients(cls||[]);
      } catch(e) { console.error(e); }
      setLoading(false);
    })();
  }, [session]);

  const portfolioObjects = objects.filter(o => !o.client_id);
  const portfolioChart = useMemo(()=>{ const dates=[...new Set(portfolioObjects.flatMap((o)=>o.valuations.map((v)=>v.date)))].sort(); return dates.map((date)=>{ let total=0; portfolioObjects.forEach((obj)=>{ const s=[...obj.valuations].sort((a,b)=>a.date.localeCompare(b.date)); const before=s.filter((v)=>v.date<=date); if(before.length) total+=before[before.length-1].value; }); return { date:fmtAxis(date), total }; }); }, [portfolioObjects]);
  const objectChart = useMemo(()=>{ if(!selected) return []; return [...selected.valuations].sort((a,b)=>a.date.localeCompare(b.date)).map((v)=>({ date:fmtAxis(v.date), value:v.value })); }, [selected]);
  const portStats = useMemo(()=> calcPortStats(portfolioObjects), [portfolioObjects]);
  const objStats = useMemo(()=>{ if (!selected?.valuations?.length) return null; const s=[...selected.valuations].sort((a,b)=>a.date.localeCompare(b.date)); const first=s[0], last=s[s.length-1]; return { first, last, change:last.value-first.value, changePct:pct(first.value,last.value) }; }, [selected]);

  const addObject = async () => {
    if (!newObj.title||!newObj.artist) return;
    const body = { title:newObj.title, artist:newObj.artist, medium:newObj.medium, year:+newObj.year||null, category:newObj.category };
    if (newObj.client_id) body.client_id = newObj.client_id;
    const rows = await db.post("objects", body);
    const created = rows[0]; if (!created) return;
    setObjects((p)=>[...p, { ...created, valuations:[] }]);
    setNewObj({ title:"", artist:"", medium:"", year:"", category:"Painting", client_id:"" });
    setSelectedId(created.id); setView("object"); notify("Object added");
  };

  const addValuation = async () => {
    if (!newVal.date||!newVal.value||!selectedId) return;
    const rows = await db.post("valuations", { object_id:selectedId, date:newVal.date, value:+newVal.value, note:newVal.note });
    const created = rows[0]; if (!created) return;
    setObjects((p)=>p.map((o)=>o.id===selectedId?{ ...o, valuations:[...o.valuations, { date:created.date, value:+created.value, note:created.note||"", _id:created.id }] }:o));
    setNewVal({ date:"", value:"", note:"" }); setShowAddVal(false); notify("Valuation saved");
  };

  const saveEdit = async () => {
    const body = { title:editObj.title, artist:editObj.artist, medium:editObj.medium, year:+editObj.year||null, category:editObj.category, client_id:editObj.client_id||null };
    await db.patch("objects", selectedId, body);
    setObjects((p)=>p.map((o)=>o.id===selectedId?{ ...o, ...editObj, year:+editObj.year }:o));
    setEditMode(false); setEditObj(null); notify("Object updated");
  };

  const deleteObject = async () => {
    await db.delete("objects", selectedId);
    setObjects((p)=>p.filter((o)=>o.id!==selectedId));
    setSelectedId(null); setView("portfolio"); setConfirmDelete(false); notify("Object deleted");
  };

  const importParse = () => { try { const rows=parseCSV(importText); if(!rows.length) throw new Error("No rows"); setImportMapped(rows); setImportStep(2); setImportError(""); } catch(e) { setImportError(e.message); } };
  const importConfirm = async () => {
    if (!importMapped) return;
    const grouped = {};
    importMapped.forEach((row)=>{ const key=`${row.title}|${row.artist}`; if(!grouped[key]) grouped[key]={ title:row.title, artist:row.artist, medium:row.medium||"", year:+(row.year||0)||null, category:row.category||"Painting", vals:[] }; if(row.date&&row.value) grouped[key].vals.push({ date:row.date, value:+row.value, note:row.note||"" }); });
    for (const g of Object.values(grouped)) {
      const rows = await db.post("objects", { title:g.title, artist:g.artist, medium:g.medium, year:g.year, category:g.category });
      const obj = rows[0]; if (!obj) continue;
      const valRows = g.vals.length ? await db.post("valuations", g.vals.map((v)=>({ ...v, object_id:obj.id }))) : [];
      setObjects((p)=>[...p, { ...obj, valuations:(valRows||[]).map((v)=>({ date:v.date, value:+v.value, note:v.note||"", _id:v.id })) }]);
    }
    setImportText(""); setImportMapped(null); setImportStep(1); setView("portfolio"); notify("Import complete");
  };

  const NAV = [{ key:"portfolio", label:"Portfolio" }, { key:"clients", label:"Clients" }, { key:"object", label:"Object", disabled:!selected }, { key:"add", label:"+ Add" }, { key:"import", label:"CSV" }];

  if (authLoading) return <div style={{ background:C.bg, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Georgia, serif" }}><div style={{ color:C.dim, fontSize:12 }}>Loading…</div></div>;
  if (!session) return <LoginScreen />;
  if (loading) return <div style={{ background:C.bg, minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Georgia, serif" }}><div style={{ textAlign:"center" }}><div style={{ color:C.gold, fontSize:22, letterSpacing:"0.14em", marginBottom:12 }}>PROVENANCE</div><div style={{ color:C.dim, fontSize:12 }}>Loading collection…</div></div></div>;

  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text, fontFamily:"'Georgia', serif", overflowX:"hidden" }}>
      {confirmDelete&&selected&&<ConfirmModal title={selected.title} onConfirm={deleteObject} onCancel={()=>setConfirmDelete(false)} />}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"14px 16px", boxSizing:"border-box", width:"100%" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:11 }}>
          <div><div style={{ fontSize:17, letterSpacing:"0.14em", color:C.gold }}>PROVENANCE</div><div style={{ fontSize:9, letterSpacing:"0.2em", color:C.dim, textTransform:"uppercase", marginTop:2 }}>Collection Value Intelligence</div></div>
          <button style={mkBtn("ghost", { fontSize:9, padding:"5px 10px", marginTop:2 })} onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
        <div style={{ display:"flex", gap:5, overflowX:"auto", paddingBottom:1, WebkitOverflowScrolling:"touch" }}>
          {NAV.map(({ key, label, disabled })=>(
            <button key={key} style={{ background:view===key?C.gold:"transparent", color:view===key?C.bg:disabled?C.dim:C.muted, border:`1px solid ${view===key?C.gold:C.border}`, padding:"6px 13px", cursor:disabled?"default":"pointer", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", borderRadius:2, fontFamily:"Georgia, serif", whiteSpace:"nowrap", flexShrink:0, opacity:disabled?0.4:1 }}
              onClick={()=>{ if(disabled) return; setView(key); setSelectedClient(null); }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding:"18px 16px", boxSizing:"border-box", width:"100%", maxWidth:860, margin:"0 auto" }}>

        {view==="portfolio"&&(<>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
            <StatCard lbl="Total Value" val={fmt(portStats.cur)} />
            <StatCard lbl="Total Gain" val={fmt(portStats.gain)} sub={`${portStats.gain>=0?"▲":"▼"} ${Math.abs(portStats.gainPct)}%`} subColor={portStats.gain>=0?C.green:C.red} />
            <StatCard lbl="Objects" val={portfolioObjects.length} />
            <StatCard lbl="Acquisition Cost" val={fmt(portStats.acq)} />
          </div>
          {portfolioChart.length>0&&<div style={CARD}><div style={SEC}>Portfolio Value Over Time</div><ResponsiveContainer width="100%" height={190}><LineChart data={portfolioChart} margin={{ top:4, right:4, left:0, bottom:0 }}><CartesianGrid strokeDasharray="3 3" stroke={C.active} /><XAxis dataKey="date" tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={{ stroke:C.border }} /><YAxis tickFormatter={fmtShort} tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={false} width={44} /><Tooltip content={<ChartTip />} /><Line type="monotone" dataKey="total" stroke={C.gold} strokeWidth={2} dot={{ fill:C.gold, r:3 }} activeDot={{ r:5 }} name="Total Value" /></LineChart></ResponsiveContainer></div>}
          {portfolioObjects.length===0&&<div style={{ textAlign:"center", padding:"40px 0", color:C.dim, fontSize:13 }}>No unassigned objects. Add objects or assign them to clients.</div>}
          {portfolioObjects.length>0&&<><div style={SEC}>Unassigned Objects</div>{portfolioObjects.map((obj)=>{ const s=[...obj.valuations].sort((a,b)=>a.date.localeCompare(b.date)), cur=s[s.length-1]?.value||0, fst=s[0]?.value||0, g=fst?pct(fst,cur):null; return (<div key={obj.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px", cursor:"pointer", borderRadius:2, marginBottom:4, background:selectedId===obj.id?C.active:"transparent", border:`1px solid ${selectedId===obj.id?C.gold+"44":"transparent"}`, boxSizing:"border-box" }} onClick={()=>{ setSelectedId(obj.id); setView("object"); }}><div style={{ flex:1, minWidth:0, paddingRight:10 }}><div style={{ fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{obj.title}</div><div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{obj.artist} · {obj.year}</div></div><div style={{ textAlign:"right", flexShrink:0 }}><div style={{ fontSize:14, color:C.gold }}>{fmt(cur)}</div>{g!==null&&<div style={{ fontSize:11, color:cur>=fst?C.green:C.red, marginTop:1 }}>{cur>=fst?"▲":"▼"} {Math.abs(g)}%</div>}</div></div>); })}</>}
        </>)}

        {view==="clients"&&!selectedClient&&<ClientsView clients={clients} objects={objects} session={session} onSelectClient={c=>setSelectedClient(c)} onClientAdded={c=>setClients(p=>[...p,c])} />}
        {view==="clients"&&selectedClient&&<ClientPortfolioView client={selectedClient} objects={objects} onBack={()=>setSelectedClient(null)} onSelectObject={obj=>{ setSelectedId(obj.id); setView("object"); }} />}

        {view==="object"&&selected&&(<>
          {editMode&&editObj ? (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:16, color:C.text, marginBottom:14 }}>Edit Object</div>
              <div style={CARD}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:13 }}>
                  <div style={{ gridColumn:"1/-1" }}><label style={LBL}>Title</label><input style={mkInput()} value={editObj.title} onChange={(e)=>setEditObj({...editObj,title:e.target.value})} /></div>
                  <div><label style={LBL}>Artist</label><input style={mkInput()} value={editObj.artist} onChange={(e)=>setEditObj({...editObj,artist:e.target.value})} /></div>
                  <div><label style={LBL}>Year</label><input style={mkInput()} type="number" value={editObj.year} onChange={(e)=>setEditObj({...editObj,year:e.target.value})} /></div>
                  <div><label style={LBL}>Medium</label><input style={mkInput()} value={editObj.medium} onChange={(e)=>setEditObj({...editObj,medium:e.target.value})} /></div>
                  <div><label style={LBL}>Category</label><select style={mkInput()} value={editObj.category} onChange={(e)=>setEditObj({...editObj,category:e.target.value})}>{["Painting","Sculpture","Works on Paper","Photography","Decorative Arts","Jewellery","Furniture","Other"].map((c)=><option key={c}>{c}</option>)}</select></div>
                  <div style={{ gridColumn:"1/-1" }}><label style={LBL}>Assign to Client</label><select style={mkInput()} value={editObj.client_id||""} onChange={e=>setEditObj({...editObj,client_id:e.target.value||null})}><option value="">— Unassigned —</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                </div>
                <div style={{ display:"flex", gap:10 }}><button style={mkBtn("primary")} onClick={saveEdit}>Save</button><button style={mkBtn("ghost")} onClick={()=>{ setEditMode(false); setEditObj(null); }}>Cancel</button></div>
              </div>
            </div>
          ) : (<>
            <div style={{ marginBottom:16 }}>
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:22, lineHeight:1.2, marginBottom:3 }}>{selected.title}</div>
                <div style={{ fontSize:12, color:C.muted }}>{selected.artist} · {selected.year} · {selected.medium}</div>
                {selected.client_id && <div style={{ fontSize:11, color:C.gold, marginTop:3 }}>{clients.find(c=>c.id===selected.client_id)?.name}</div>}
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button style={mkBtn("ghost",{ fontSize:10, padding:"5px 12px" })} onClick={()=>setView("portfolio")}>← Back</button>
                <button style={mkBtn("secondary",{ fontSize:10, padding:"5px 12px" })} onClick={()=>{ setEditObj({...selected}); setEditMode(true); }}>Edit</button>
                <button style={mkBtn("danger",{ fontSize:10, padding:"5px 12px" })} onClick={()=>setConfirmDelete(true)}>Delete</button>
              </div>
            </div>
            {objStats&&<div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
              <StatCard lbl="Current Value" val={fmt(objStats.last.value)} sub={fmtDate(objStats.last.date)} />
              <StatCard lbl="Total Change" val={fmt(objStats.change)} sub={`${objStats.change>=0?"▲":"▼"} ${Math.abs(objStats.changePct)}%`} subColor={objStats.change>=0?C.green:C.red} />
              <StatCard lbl="Acquired" val={fmt(objStats.first.value)} sub={fmtDate(objStats.first.date)} />
              <StatCard lbl="Valuations" val={selected.valuations.length} />
            </div>}
            {objectChart.length>0&&<div style={CARD}><div style={SEC}>Value History</div><ResponsiveContainer width="100%" height={170}><LineChart data={objectChart} margin={{ top:4, right:4, left:0, bottom:0 }}><CartesianGrid strokeDasharray="3 3" stroke={C.active} /><XAxis dataKey="date" tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={{ stroke:C.border }} /><YAxis tickFormatter={fmtShort} tick={{ fill:C.dim, fontSize:10 }} tickLine={false} axisLine={false} width={44} /><Tooltip content={<ChartTip />} /><Line type="monotone" dataKey="value" stroke={C.gold} strokeWidth={2} dot={{ fill:C.gold, r:4 }} activeDot={{ r:6 }} name={selected.artist} /></LineChart></ResponsiveContainer></div>}
            <ComparablesPanel key={selected.id} object={selected} />
            <div style={CARD}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:12 }}>
                <div style={{ fontSize:9, letterSpacing:"0.22em", textTransform:"uppercase", color:C.dim }}>Valuation Ledger</div>
                <button style={mkBtn("secondary",{ fontSize:10, padding:"5px 11px" })} onClick={()=>setShowAddVal((v)=>!v)}>{showAddVal?"Cancel":"+ Add"}</button>
              </div>
              {showAddVal&&<div style={{ background:C.inner, border:`1px solid ${C.border}`, borderRadius:2, padding:"13px", marginBottom:13 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9, marginBottom:9 }}>
                  <div><label style={LBL}>Date</label><input type="date" style={mkInput()} value={newVal.date} onChange={(e)=>setNewVal({...newVal,date:e.target.value})} /></div>
                  <div><label style={LBL}>Value (USD)</label><input type="number" style={mkInput()} placeholder="0" value={newVal.value} onChange={(e)=>setNewVal({...newVal,value:e.target.value})} /></div>
                  <div style={{ gridColumn:"1/-1" }}><label style={LBL}>Source / Note</label><input type="text" style={mkInput()} placeholder="e.g. Christie's appraisal" value={newVal.note} onChange={(e)=>setNewVal({...newVal,note:e.target.value})} /></div>
                </div>
                <button style={mkBtn("primary")} onClick={addValuation}>Save</button>
              </div>}
              {[...selected.valuations].sort((a,b)=>b.date.localeCompare(a.date)).map((v,i,arr)=>{ const prev=arr[i+1], chg=prev?v.value-prev.value:null, chgP=prev?pct(prev.value,v.value):null; return (<div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10, padding:"10px 0", borderBottom:`1px solid ${C.border}`, background:i%2?C.inner+"88":"transparent" }}><div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:14, color:C.gold, marginBottom:2 }}>{fmt(v.value)}</div><div style={{ fontSize:11, color:C.dim }}>{fmtDate(v.date)}</div>{v.note&&<div style={{ fontSize:11, color:C.muted, marginTop:1 }}>{v.note}</div>}</div><div style={{ textAlign:"right", flexShrink:0 }}>{chg!==null?(<><div style={{ fontSize:13, color:chg>=0?C.green:C.red }}>{chg>=0?"▲":"▼"} {fmt(Math.abs(chg))}</div><div style={{ fontSize:11, color:chg>=0?C.green:C.red, marginTop:1 }}>{Math.abs(chgP)}%</div></>):(<div style={{ fontSize:11, color:C.dim }}>Acquisition</div>)}</div></div>); })}
            </div>
          </>)}
        </>)}

        {view==="add"&&<div>
          <div style={{ fontSize:17, marginBottom:18 }}>Add Object</div>
          <div style={CARD}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:13 }}>
              <div style={{ gridColumn:"1/-1" }}><label style={LBL}>Title</label><input style={mkInput()} value={newObj.title} onChange={(e)=>setNewObj({...newObj,title:e.target.value})} placeholder="Object title" /></div>
              <div><label style={LBL}>Artist / Maker</label><input style={mkInput()} value={newObj.artist} onChange={(e)=>setNewObj({...newObj,artist:e.target.value})} placeholder="Name" /></div>
              <div><label style={LBL}>Year</label><input style={mkInput()} type="number" value={newObj.year} onChange={(e)=>setNewObj({...newObj,year:e.target.value})} placeholder="e.g. 1952" /></div>
              <div><label style={LBL}>Medium</label><input style={mkInput()} value={newObj.medium} onChange={(e)=>setNewObj({...newObj,medium:e.target.value})} placeholder="e.g. Oil on canvas" /></div>
              <div><label style={LBL}>Category</label><select style={mkInput()} value={newObj.category} onChange={(e)=>setNewObj({...newObj,category:e.target.value})}>{["Painting","Sculpture","Works on Paper","Photography","Decorative Arts","Jewellery","Furniture","Other"].map((c)=><option key={c}>{c}</option>)}</select></div>
              {clients.length>0&&<div style={{ gridColumn:"1/-1" }}><label style={LBL}>Assign to Client (optional)</label><select style={mkInput()} value={newObj.client_id} onChange={e=>setNewObj({...newObj,client_id:e.target.value})}><option value="">— Unassigned —</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
            </div>
            <button style={mkBtn("primary")} onClick={addObject}>Add to Collection</button>
          </div>
        </div>}

        {view==="import"&&<div>
          <div style={{ fontSize:17, marginBottom:5 }}>Import CSV</div>
          <div style={{ fontSize:12, color:C.dim, marginBottom:18, lineHeight:1.6 }}>Columns: <span style={{ color:C.gold }}>title, artist, medium, year, category, date, value, note</span></div>
          {importStep===1&&<div style={CARD}><label style={LBL}>Paste CSV</label><textarea style={mkInput({ height:160, resize:"vertical", display:"block", marginBottom:11 })} value={importText} onChange={(e)=>setImportText(e.target.value)} placeholder={"title,artist,medium,year,category,date,value,note\nBlue Study,Picasso,Oil,1903,Painting,2020-01-01,1200000,Christie's"} />{importError&&<div style={{ color:C.red, fontSize:12, marginBottom:9 }}>{importError}</div>}<button style={mkBtn("primary")} onClick={importParse}>Parse</button></div>}
          {importStep===2&&importMapped&&<div style={CARD}><div style={SEC}>Preview — {importMapped.length} rows</div><div style={{ overflowX:"auto", marginBottom:14 }}><table style={{ borderCollapse:"collapse", fontSize:11, minWidth:"100%" }}><thead><tr>{Object.keys(importMapped[0]).map((k)=>(<th key={k} style={{ padding:"4px 7px", textAlign:"left", color:C.dim, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" }}>{k}</th>))}</tr></thead><tbody>{importMapped.slice(0,6).map((row,i)=>(<tr key={i}>{Object.values(row).map((v,j)=>(<td key={j} style={{ padding:"4px 7px", color:C.muted, borderBottom:`1px solid ${C.inner}`, whiteSpace:"nowrap" }}>{v}</td>))}</tr>))}</tbody></table>{importMapped.length>6&&<div style={{ color:C.dim, fontSize:10, marginTop:6 }}>…and {importMapped.length-6} more</div>}</div><div style={{ display:"flex", gap:8 }}><button style={mkBtn("primary")} onClick={importConfirm}>Import All</button><button style={mkBtn("ghost")} onClick={()=>setImportStep(1)}>Back</button></div></div>}
        </div>}

      </div>
      {toast&&<div style={{ position:"fixed", bottom:18, right:18, background:C.gold, color:C.bg, padding:"9px 16px", borderRadius:2, fontSize:12, letterSpacing:"0.05em", fontFamily:"Georgia, serif", boxShadow:"0 4px 14px #00000066", zIndex:999 }}>{toast}</div>}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/client/:slug" element={<PublicClientView />} />
        <Route path="*" element={<AdvisorApp />} />
      </Routes>
    </BrowserRouter>
  );
}
