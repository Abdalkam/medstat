import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Course, BusinessSettings, User } from "../types";
import { supabase } from "../auth/supabase";
import { getCourses } from "../database/courseDB";

/* ------------------------------------------------------------------ */
/*  TrainerDashboard — Microsoft Teams (Fluent 2) look                 */
/*                                                                     */
/*  Instant-data strategy (offline-first, zero skeleton on re-visits): */
/*   1. First paint reads localStorage synchronously — cached user,    */
/*      settings, avatar, courses, learner counts, pending forms.      */
/*   2. Local Dexie courses paint immediately after mount.             */
/*   3. Supabase refreshes run in the background (stale-while-         */
/*      -revalidate) and swap content in place; every result is        */
/*      written back to localStorage so the next visit is instant.     */
/*   4. The render-blocking Google Fonts @import is gone — Segoe UI    */
/*      is a system font on Windows (and Tauri WebView2).              */
/* ------------------------------------------------------------------ */

function initialsOf(name: string | null | undefined, fallback: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  return (parts[0]?.slice(0, 2) || fallback).toUpperCase();
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/* Only render image sources that cannot 404: data URLs, absolute/protocol-
   relative/blob URLs and app-absolute paths. A bare filename ("loadlogo.png")
   would be resolved against the app origin and 404, so it is dropped and the
   letter-avatar fallback renders instead. */
function normalizeImageSrc(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("<svg") || raw.startsWith("<?xml")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`;
  }
  const compact = raw.replace(/\s+/g, "");
  if (compact.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return `data:image/png;base64,${compact}`;
  }
  if (/^(https?:\/\/|\/\/|blob:)/i.test(raw) || raw.startsWith("/")) return raw;
  return "";
}

/* Local caches that make remounts instant (even fully offline). */
const COURSES_CACHE = "td_courses_cache_v1";
const STATS_CACHE = "td_stats_cache_v1";
const FORMS_CACHE = "td_pending_forms_v1";

/* Microsoft Teams / Fluent 2 palette */
const BRAND = "#5B5FC7";          // Teams purple
const BRAND_HOVER = "#4F52B2";
const BRAND_PRESSED = "#444791";
const BRAND_TINT = "#EBEDF9";     // tinted surfaces / active rail pill
const CANVAS = "#F5F5F5";         // app canvas
const RAIL_BG = "#EBEBEB";        // left app rail
const HOVER_BG = "#F0F0F0";       // neutral control hover
const PRESSED_BG = "#E0E0E0";     // neutral control pressed
const STROKE = "#E0E0E0";         // hairline borders
const STROKE_2 = "#D1D1D1";       // input borders
const TEXT = "#242424";
const TEXT_2 = "#424242";
const TEXT_3 = "#616161";
const PLACEHOLDER = "#707070";
const PRESENCE_GREEN = "#6BB700";
const DANGER = "#C50F1F";
const DANGER_TINT = "#FDF3F4";

const FONT_STACK =
  "'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";

const TD_CSS = `
.td-root { min-height:100vh; min-height:100dvh; width:100%; background:${CANVAS}; color:${TEXT};
  font-family:${FONT_STACK}; -webkit-text-size-adjust:100%; text-size-adjust:100%; }
.td-root *, .td-root *::before, .td-root *::after { box-sizing:border-box; }

/* ---------------- left app rail (Teams navigation) ---------------- */
.td-rail { position:fixed; top:0; left:0; bottom:0; width:68px; background:${RAIL_BG};
  display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 0 12px; z-index:40; }
/* Single brand anchor: the business logo + name live in the top app bar
   only. The left rail used to repeat the logo (double-logo report) — the
   rail is now pure navigation, matching Microsoft Teams. */
.td-railnav { display:flex; flex-direction:column; gap:4px; margin-top:10px; }
.td-railbtn { position:relative; width:48px; height:44px; border:none; border-radius:8px;
  background:transparent; color:${TEXT_2}; display:flex; align-items:center; justify-content:center;
  cursor:pointer; transition:background .12s ease, color .12s ease; }
.td-railbtn:hover { background:${PRESSED_BG}; color:${TEXT}; }
.td-railbtn:active { background:${STROKE}; }
.td-railbtn.active { background:${BRAND_TINT}; color:${BRAND}; }
.td-railbtn.active::before { content:""; position:absolute; left:-10px; top:12px; width:3px; height:20px;
  border-radius:2px; background:${BRAND}; }
.td-railbadge { position:absolute; top:3px; right:3px; min-width:17px; height:17px; border-radius:9px;
  background:${DANGER}; color:#fff; font-size:10.5px; font-weight:600; display:flex; align-items:center;
  justify-content:center; padding:0 4px; border:2px solid ${RAIL_BG}; box-sizing:content-box; }
.td-railspacer { flex:1; }

/* ---------------- top bar ---------------- */
.td-main { margin-left:68px; display:flex; flex-direction:column; min-width:0; min-height:100dvh; }
.td-bar { position:sticky; top:0; z-index:30; background:#fff; border-bottom:1px solid ${STROKE};
  box-shadow:0 1px 3px rgba(0,0,0,.04); }
.td-bar-grid { display:grid; grid-template-columns:1fr auto; align-items:center;
  gap:14px; padding:8px clamp(12px,2.5vw,20px); }
.td-brand { display:flex; align-items:center; gap:10px; min-width:0; }
.td-logo { width:34px; height:34px; border-radius:6px; object-fit:contain; background:#fff;
  flex-shrink:0; }
.td-logo-fallback { display:flex; align-items:center; justify-content:center; background:${BRAND};
  color:#fff; font-weight:600; font-size:15px; border:none; }
.td-name { margin:0; font-size:15px; font-weight:600; color:${TEXT}; line-height:1.25;
  overflow-wrap:break-word; }
.td-phone { font-size:12px; color:${TEXT_3}; text-decoration:none; display:inline-flex;
  align-items:center; gap:5px; margin-top:1px; white-space:nowrap; }
.td-phone:hover { color:${BRAND}; text-decoration:underline; }

/* Search lives in the page body now (below the heading) — Fluent input style:
   white surface, hairline border, brand border on focus. */
.td-search { display:flex; align-items:center; gap:8px; background:#fff;
  border:1px solid ${STROKE_2}; border-radius:6px; padding:6px 12px; color:${TEXT_3};
  transition:border-color .12s; }
.td-search:focus-within { border-color:${BRAND}; }
/* Search shares the heading line: sits right after the count pill while the
   refresh button keeps its auto margin, pinning it to the far right.
   On small screens the search wraps onto its own full-width line. */
.td-heading-search { width:min(320px,100%); min-width:0; }
.td-search svg { flex-shrink:0; }
.td-search input { flex:1; min-width:0; border:none; outline:none; background:transparent;
  font:inherit; font-size:13.5px; color:${TEXT}; }
.td-search input::placeholder { color:${PLACEHOLDER}; }

.td-bar-actions { display:flex; align-items:center; justify-content:flex-end; gap:8px; }
.td-chip { display:flex; align-items:center; gap:9px; background:transparent; border:none;
  border-radius:6px; padding:4px 10px 4px 4px; max-width:230px; min-width:0; cursor:pointer;
  font-family:inherit; transition:background .12s; }
.td-chip:hover { background:${HOVER_BG}; }
.td-avatar { position:relative; width:32px; height:32px; border-radius:5px; background:${BRAND};
  color:#fff; font-size:12.5px; font-weight:600; display:flex; align-items:center; justify-content:center;
  overflow:visible; flex-shrink:0; }
.td-avatar > img, .td-avatar > span:first-child { width:100%; height:100%; border-radius:5px;
  overflow:hidden; display:flex; align-items:center; justify-content:center; }
.td-avatar img { width:100%; height:100%; object-fit:cover; border-radius:5px; }
.td-presence { position:absolute; right:-2px; bottom:-2px; width:11px; height:11px; border-radius:50%;
  background:${PRESENCE_GREEN}; border:2px solid #fff; }
.td-username { font-size:13px; font-weight:600; color:${TEXT}; }

/* ---------------- body ---------------- */
/* Page balance: content is centred and capped so cards never stretch
   edge-to-edge on wide monitors; heading and grid share the same column. */
.td-body { flex:1; width:100%; max-width:1640px; margin:0 auto;
  padding:clamp(16px,3vw,28px) clamp(14px,3vw,28px) 56px; }
.td-heading { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:2px 2px 18px; }
.td-heading h2 { margin:0; font-size:clamp(19px,2.2vw,23px); font-weight:600; color:${TEXT}; }
.td-count { background:#fff; border:1px solid ${STROKE}; border-radius:4px; padding:2px 9px;
  font-size:12px; font-weight:600; color:${TEXT_3}; white-space:nowrap; }
.td-refresh { margin-left:auto; width:32px; height:32px; border-radius:6px; border:none;
  background:transparent; color:${TEXT_3}; display:flex; align-items:center; justify-content:center;
  cursor:pointer; transition:background .12s, color .12s; }
.td-refresh:hover { background:${HOVER_BG}; color:${BRAND}; }
.td-refresh:disabled { opacity:.5; cursor:default; }

.td-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr));
  gap:clamp(14px,1.8vw,20px); }

/* Cards: soft radius, gentle hover lift — Fluent 2 depth, no layout shift. */
.td-card { background:#fff; border:1px solid ${STROKE}; border-radius:10px; overflow:hidden;
  display:flex; flex-direction:column; min-width:0;
  box-shadow:0 1px 2px rgba(0,0,0,.06); transition:box-shadow .18s ease, transform .18s ease; }
.td-card:hover { transform:translateY(-2px);
  box-shadow:0 8px 20px rgba(0,0,0,.10), 0 2px 6px rgba(0,0,0,.07); }

.td-media { position:relative; width:100%; height:clamp(140px,20vw,180px); background:${BRAND_TINT}; }
.td-media img { width:100%; height:100%; object-fit:cover; display:block; }
.td-media-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center;
  font-size:52px; font-weight:600; color:${BRAND};
  background:linear-gradient(135deg, #E8EBFA 0%, ${BRAND_TINT} 55%, #F3F0FB 100%); }

.td-cardbody { padding:14px 16px 12px; flex:1; display:flex; flex-direction:column; min-width:0; }
.td-cardtitle { margin:0 0 5px; font-size:16px; font-weight:600; color:${TEXT}; }
.td-carddesc { margin:0; color:${TEXT_3}; font-size:13px; line-height:1.55;
  overflow-wrap:break-word; }
.td-meta { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
/* Pills wrap as whole units (container flex-wrap) — labels never break mid-word. */
.td-metapill { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600;
  color:${TEXT_2}; background:${CANVAS}; border:1px solid ${STROKE}; border-radius:4px; padding:3px 9px;
  white-space:nowrap; }
/* Fluent accent-tint CTA — the one prominent action inside each card. */
.td-schedbtn { align-self:flex-start; margin-top:14px; display:inline-flex; align-items:center; gap:7px;
  padding:8px 14px; border-radius:5px; border:none; background:${BRAND_TINT}; color:${BRAND};
  font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; transition:background .12s;
  white-space:nowrap; }
.td-schedbtn:hover { background:#DCDCFA; }
.td-schedbtn:active { background:#D1D1F2; }

.td-actions { display:flex; gap:8px; padding:12px 14px 14px; border-top:1px solid ${CANVAS}; }
/* Fluent 2 secondary buttons: white surface, hairline border, grey hover. */
.td-act { flex:1; display:flex; align-items:center; justify-content:center; gap:7px;
  padding:8px 8px; border-radius:5px; border:1px solid ${STROKE_2}; background:#fff; color:${TEXT};
  font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit; min-width:0;
  transition:background .12s, border-color .12s; }
.td-act svg { color:${BRAND}; flex-shrink:0; }
.td-act:hover { background:${CANVAS}; }
.td-act:active { background:${HOVER_BG}; }
.td-act span { white-space:nowrap; }

.td-iconbtn:focus-visible, .td-railbtn:focus-visible, .td-act:focus-visible, .td-schedbtn:focus-visible,
.td-chip:focus-visible, .td-refresh:focus-visible, .td-close:focus-visible, .td-delbtn:focus-visible,
.td-btn-primary:focus-visible { outline:2px solid ${BRAND}; outline-offset:2px; }

/* ---------------- dialogs (Fluent panels) ---------------- */
.td-overlay { position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex;
  align-items:center; justify-content:center; z-index:1000; padding:20px;
  backdrop-filter:blur(2px); }
.td-dialog { background:#fff; border-radius:10px; width:100%; max-width:580px;
  max-height:88vh; max-height:88dvh; display:flex; flex-direction:column; overflow:hidden;
  box-shadow:0 32px 64px rgba(0,0,0,.24), 0 2px 21px rgba(0,0,0,.18); }
.td-sheet-handle { display:none; }
.td-dialog-head { padding:16px 16px 14px 22px; display:flex; align-items:flex-start;
  justify-content:space-between; gap:12px; border-bottom:1px solid ${STROKE}; }
.td-dialog-title { margin:0; font-size:19px; font-weight:600; color:${TEXT}; }
.td-dialog-sub { margin:3px 0 0; font-size:12.5px; color:${TEXT_3}; }
.td-dialog-body { padding:18px 22px 24px; overflow-y:auto; }
/* Fluent overlay scrollbar inside dialogs. */
.td-dialog-body::-webkit-scrollbar { width:10px; }
.td-dialog-body::-webkit-scrollbar-track { background:transparent; }
.td-dialog-body::-webkit-scrollbar-thumb { background:#C8C8C8; border-radius:5px;
  border:2px solid #fff; }
.td-dialog-body::-webkit-scrollbar-thumb:hover { background:#B4B4B4; }
.td-close { width:34px; height:34px; border-radius:5px; border:none; background:transparent;
  color:${TEXT_2}; display:flex; align-items:center; justify-content:center; cursor:pointer;
  flex-shrink:0; transition:background .12s; }
.td-close:hover { background:${PRESSED_BG}; }

.td-field { width:100%; padding:8px 12px; border:1px solid ${STROKE_2}; border-bottom-color:${TEXT_3};
  border-radius:5px; font-size:14px; font-family:inherit; color:${TEXT}; outline:none; background:#fff;
  margin-bottom:12px; transition:border-color .12s; }
.td-field:focus { border-color:${BRAND}; border-bottom-width:2px; padding-bottom:7px; }
.td-field::placeholder { color:${PLACEHOLDER}; }
.td-label { font-size:13px; font-weight:600; color:${TEXT_2}; margin:2px 0 6px; display:block; }
.td-btn-primary { width:100%; padding:10px 18px; border:none; border-radius:5px; background:${BRAND};
  color:#fff; font-size:14px; font-weight:600; font-family:inherit; cursor:pointer;
  margin-top:4px; transition:background .12s; }
.td-btn-primary:hover { background:${BRAND_HOVER}; }
.td-btn-primary:active { background:${BRAND_PRESSED}; }
.td-btn-primary:disabled { background:${HOVER_BG}; color:${STROKE_2}; cursor:default; }
.td-upcoming { margin:20px 0 10px; font-size:13px; font-weight:600; color:${TEXT_2}; }

.td-listitem { display:flex; align-items:center; gap:12px; padding:8px 10px; border-radius:6px;
  transition:background .12s; }
.td-listitem:hover { background:${HOVER_BG}; }
.td-lavatar { width:36px; height:36px; border-radius:5px; background:${BRAND_TINT}; color:${BRAND};
  font-weight:600; font-size:14px; display:flex; align-items:center; justify-content:center;
  overflow:hidden; flex-shrink:0; }
.td-lavatar img { width:100%; height:100%; object-fit:cover; }
.td-listmeta { flex:1; min-width:0; }
.td-listname { font-size:14px; font-weight:600; color:${TEXT};
  overflow-wrap:break-word; }
.td-listsub { font-size:12.5px; color:${TEXT_3}; margin-top:1px;
  overflow-wrap:break-word; }

.td-schedrow { display:flex; align-items:center; gap:12px; background:#fff; border:1px solid ${STROKE};
  border-radius:8px; padding:10px 12px; }
.td-datesq { width:46px; border-radius:6px; background:${BRAND_TINT}; text-align:center;
  padding:6px 0 5px; flex-shrink:0; }
.td-datesq b { display:block; font-size:17px; font-weight:600; color:${BRAND}; line-height:1.1; }
.td-datesq span { font-size:10px; font-weight:600; color:${BRAND}; text-transform:uppercase;
  letter-spacing:.4px; }
.td-delbtn { border:none; background:transparent; color:${DANGER}; font-size:13px; font-weight:600;
  padding:6px 12px; border-radius:5px; cursor:pointer; font-family:inherit; flex-shrink:0;
  transition:background .12s; }
.td-delbtn:hover { background:${DANGER_TINT}; }

.td-empty { background:#fff; border:1px solid ${STROKE}; border-radius:10px; padding:52px 28px;
  text-align:center; }
.td-emptyicon { width:72px; height:72px; border-radius:50%; background:${BRAND_TINT}; color:${BRAND};
  display:flex; align-items:center; justify-content:center; margin:0 auto 16px; }
.td-emptytitle { margin:0 0 8px; font-size:18px; font-weight:600; color:${TEXT}; }
.td-emptysub { margin:0 auto; font-size:13.5px; color:${TEXT_3}; line-height:1.6; max-width:430px; }
.td-emptysmall { text-align:center; color:${TEXT_3}; padding:24px 0; font-size:13.5px; margin:0; }
.td-nomatch { text-align:center; color:${TEXT_3}; font-size:14px; padding:36px 0; margin:0;
  background:#fff; border:1px dashed ${STROKE_2}; border-radius:10px; }
.td-skel { border-radius:8px; background:linear-gradient(100deg,#EEEEEE 40%,#F7F7F7 50%,#EEEEEE 60%);
  background-size:200% 100%; animation:td-shimmer 1.3s infinite linear; }
@keyframes td-shimmer { to { background-position:-200% 0; } }

/* ---------------- responsive ---------------- */
@media (max-width:760px){
  .td-username, .td-phone { display:none; }
  .td-chip { padding-right:4px; }
  .td-bar-grid { grid-template-columns:1fr auto; }
  .td-heading-search { flex:1 1 100%; }
  .td-rail { top:auto; bottom:0; left:0; right:0; width:auto; height:58px; flex-direction:row;
    justify-content:space-around; align-items:center; padding:4px 8px;
    border-top:1px solid ${STROKE}; box-shadow:0 -1px 4px rgba(0,0,0,.06); }
  .td-railspacer { display:none; }
  .td-railnav { flex-direction:row; margin-top:0; }
  .td-railbtn.active::before { left:14px; top:auto; bottom:-4px; width:20px; height:3px; }
  .td-logo { width:30px; height:30px; }
  .td-name { font-size:14px; }
  .td-bar-grid { gap:10px; }
  .td-rail { padding-bottom:max(6px, env(safe-area-inset-bottom)); }
  .td-main { margin-left:0; padding-bottom:calc(70px + env(safe-area-inset-bottom)); }
  .td-body { padding-bottom:24px; }
}
@media (max-width:640px){
  .td-overlay { align-items:flex-end; padding:0; }
  .td-dialog { max-width:100%; border-radius:8px 8px 0 0; max-height:92dvh; }
  .td-sheet-handle { display:block; width:36px; height:4px; border-radius:2px;
    background:${STROKE_2}; margin:10px auto 0; }
  .td-dialog-head { border-bottom:none; padding-bottom:8px; }
}
@media (max-width:560px){
  /* 4 labels in one row overflow below ~560px ("Assignments" needs ~113px
     per button) — reflow into a 2×2 grid with taller touch targets. */
  .td-actions { flex-wrap:wrap; }
  .td-act { flex:1 1 40%; padding:11px 8px; }
}
@media (max-width:380px){
  /* Small Androids / iPhone SE: tighten the brand lockup so the business
     name keeps maximum room without pushing the avatar chip out of the bar. */
  .td-logo { width:26px; height:26px; }
  .td-brand { gap:8px; }
  .td-bar-grid { gap:8px; padding-inline:10px; }
}
/* Short landscape (phone rotated): the sticky bar + bottom rail would eat
   ~30% of a 375px-tall viewport — let the bar scroll away, slim the rail. */
@media (max-width:760px) and (max-height:520px){
  .td-bar { position:static; }
  .td-search { padding:4px 10px; }
  .td-rail { height:48px; }
  .td-main { padding-bottom:56px; }
  .td-body { padding:12px 14px 20px; }
}
/* Wide layout — three balanced bands: media (~1/3) | body (flexible, but
   guaranteed ≥260px) | action rail (fixed 176px). The old 560px grid track
   let the two fixed columns starve the body down to a ~25px sliver (title
   wrapping one word per line), so the track now reserves 760px and the body
   carries a hard min-width. Action buttons keep their natural height
   (flex:0 0 auto) instead of stretching into tall slabs. */
@media (min-width:1150px){
  .td-grid { grid-template-columns:repeat(auto-fill,minmax(min(760px,100%),1fr)); }
  .td-card { flex-direction:row; align-items:stretch; }
  .td-media { width:clamp(200px,18vw,250px); height:auto; min-height:216px; flex-shrink:0; }
  .td-cardbody { flex:1 1 0; min-width:260px; justify-content:center; padding:20px 24px; }
  .td-cardtitle { font-size:17px; }
  .td-actions { flex-direction:column; width:176px; flex-shrink:0;
    justify-content:center; gap:7px; padding:14px 16px; border-top:none;
    border-left:1px solid ${CANVAS}; }
  .td-act { flex:0 0 auto; justify-content:flex-start; padding:9px 12px; }
}
`;

async function cacheAvatarImage(userId: string, url: string) {
  try {
    if (url.startsWith("data:")) {
      localStorage.setItem(`cachedAvatar_${userId}`, url);
      localStorage.setItem(`cachedAvatarUrl_${userId}`, url);
      return;
    }
    if (localStorage.getItem(`cachedAvatarUrl_${userId}`) === url) return;

    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return;
    const blob = await res.blob();
    if (blob.size > 1_000_000) return;

    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });

    if (dataUrl) {
      localStorage.setItem(`cachedAvatar_${userId}`, dataUrl);
      localStorage.setItem(`cachedAvatarUrl_${userId}`, url);
    }
  } catch {}
}

function mapCourseFromSupabase(c: Record<string, unknown>): Course {
  return {
    id: c.id as string, name: (c.name as string) || "", description: (c.description as string) || "",
    logo: normalizeImageSrc(c.logo as string) || "", tenantId: c.tenant_id as string, trainerId: c.trainer_id as string,
    createdAt: c.created_at as string, tuitionType: ((c.tuition_type as string) || "free") as "free" | "paid",
    amount: (c.amount as number) || 0, startDate: (c.start_date as string) || "", period: (c.period as string) || "",
    mediaUrl: (c.media_url as string) || (c.logo as string) || "", mediaType: (c.media_type as string) || "image", mediaName: (c.media_name as string) || "course-logo",
  };
}

export default function TrainerDashboard() {
  const navigate = useNavigate();

  /* ---- synchronous first paint: everything localStorage already has ---- */
  const [currentUser] = useState<User | null>(() => {
    const u = readJSON<Partial<User> | null>("currentUser", null);
    return u && u.id && u.tenantId ? (u as User) : null;
  });
  const [settings, setSettings] = useState<BusinessSettings | null>(() =>
    readJSON<BusinessSettings | null>("localBusinessSettings", null)
  );
  const [profilePic, setProfilePic] = useState<string | null>(() => {
    if (!currentUser) return null;
    const cached = localStorage.getItem(`cachedAvatar_${currentUser.id}`);
    if (cached) return cached;
    const p = readJSON<{ avatar_url?: string } | null>(`cachedProfile_${currentUser.id}`, null);
    return p?.avatar_url || currentUser.profilePic || null;
  });
  const [profilePicError, setProfilePicError] = useState(false);
  const [courses, setCourses] = useState<Course[]>(() => readJSON<Course[]>(COURSES_CACHE, []));
  const [courseStats, setCourseStats] = useState<Record<string, number>>(() =>
    readJSON<Record<string, number>>(STATS_CACHE, {})
  );
  const [pendingForms, setPendingForms] = useState<number>(() => readJSON<number>(FORMS_CACHE, 0));
  const [loading, setLoading] = useState<boolean>(() => courses.length === 0);
  const [query, setQuery] = useState("");

  const [attendanceCourse, setAttendanceCourse] = useState<Course | null>(null);
  const [assignedLearners, setAssignedLearners] = useState<Array<{ id: string; username: string; phone: string; profilePic: string }>>([]);
  const [loadingLearners, setLoadingLearners] = useState(false);
  const [scheduleCourse, setScheduleCourse] = useState<Course | null>(null);
  const [schedules, setSchedules] = useState<Array<{ id: string; title: string; scheduled_at: string; description?: string }>>([]);
  const [newScheduleTitle, setNewScheduleTitle] = useState("");
  const [newScheduleDesc, setNewScheduleDesc] = useState("");
  const [newScheduleDate, setNewScheduleDate] = useState("");

  /* ---- guard: not logged in → login screen ---- */
  useEffect(() => {
    if (!currentUser) navigate("/");
  }, [currentUser, navigate]);

  /* ---- background refresh: business settings (non-blocking) ---- */
  useEffect(() => {
    if (!currentUser?.tenantId) return;
    (async () => {
      try {
        const { data: s } = await supabase.from("business_settings").select("*").eq("tenant_id", currentUser.tenantId).maybeSingle();
        if (s) {
          const mapped = { id: s.id, businessName: s.business_name || "", address: s.address || "", phone: s.phone || "", email: s.email || "", website: s.website || "", logo: s.logo || "", header: s.header || "", adminProfile: s.admin_profile || "", loginBackground: s.login_background || "", themeColor: s.theme_color || "", appBarItems: s.app_bar_items || [], tenantId: s.tenant_id, createdAt: s.created_at };
          setSettings(mapped);
          localStorage.setItem("localBusinessSettings", JSON.stringify(mapped));
        }
      } catch { console.warn("Offline: Settings"); }
    })();
  }, [currentUser]);

  /* ---- background refresh: trainer avatar (cached value already painted) ---- */
  useEffect(() => {
    if (!currentUser?.id) return;
    setProfilePicError(false);

    const cached = localStorage.getItem(`cachedAvatar_${currentUser.id}`);
    const cachedProfile = readJSON<{ avatar_url?: string } | null>(`cachedProfile_${currentUser.id}`, null);
    if (cached || cachedProfile?.avatar_url || currentUser.profilePic) {
      setProfilePic(cached || cachedProfile?.avatar_url || currentUser.profilePic || null);
    }

    (async () => {
      try {
        const { data } = await supabase.from("profile_settings").select("avatar_url").eq("user_id", currentUser.id).maybeSingle();
        if (data?.avatar_url) {
          setProfilePic(data.avatar_url);
          localStorage.setItem(`cachedProfile_${currentUser.id}`, JSON.stringify({ id: currentUser.id, username: currentUser.username, role: currentUser.role, avatar_url: data.avatar_url }));
          cacheAvatarImage(currentUser.id, data.avatar_url);
          return;
        }

        const { data: u } = await supabase.from("users").select("profile_pic").eq("id", currentUser.id).maybeSingle();
        if (u?.profile_pic) {
          setProfilePic(u.profile_pic);
          cacheAvatarImage(currentUser.id, u.profile_pic);
        } else {
          setProfilePic(currentUser.profilePic || null);
        }
      } catch {}
    })();
  }, [currentUser]);

  /* ---- background refresh: pending forms (both queries in parallel) ---- */
  useEffect(() => {
    if (!currentUser?.tenantId || !currentUser?.id) return;
    (async () => {
      try {
        const [{ data: forms }, { data: subs }] = await Promise.all([
          supabase.from("forms").select("id").eq("tenant_id", currentUser.tenantId).eq("status", "published"),
          supabase.from("form_submissions").select("form_id").eq("user_id", currentUser.id),
        ]);
        const filled = new Set((subs || []).map((s: { form_id: string }) => s.form_id));
        const count = (forms || []).filter((f: { id: string }) => !filled.has(f.id)).length;
        setPendingForms(count);
        writeJSON(FORMS_CACHE, count);
      } catch {}
    })();
  }, [currentUser]);

  /* ---- courses: local Dexie paints instantly, Supabase reconciles behind it ---- */
  const fetchCourses = useCallback(async () => {
    if (!currentUser?.id || !currentUser?.tenantId) return;
    const assignedIds = currentUser.assignedCourses || [];

    // 1) Local database — near-instant, works fully offline.
    try {
      const allLocalCourses = await getCourses();
      const localCourses = allLocalCourses.filter((c) => assignedIds.includes(c.id));
      setCourses((prev) => (prev.length > 0 ? prev : localCourses)); // never clobber cached content with a smaller list
    } catch (e) { console.error("Local courses fetch failed", e); }
    setLoading(false); // skeleton gone at this point — network no longer blocks the UI

    // 2) Supabase — authoritative, runs in the background and swaps in place.
    try {
      if (assignedIds.length === 0) {
        setCourses([]);
        writeJSON(COURSES_CACHE, []);
        return;
      }
      const { data: coursesRes } = await supabase.from("courses").select("*").in("id", assignedIds).order("created_at", { ascending: false });
      if (coursesRes) {
        const remoteCourses: Course[] = coursesRes.map(mapCourseFromSupabase);
        setCourses(remoteCourses);
        writeJSON(COURSES_CACHE, remoteCourses);

        const courseIds = remoteCourses.map((c) => c.id);
        const { data: stats } = await supabase.from("enrollments").select("course_id").in("course_id", courseIds).eq("role", "trainee");
        if (stats) {
          const counts: Record<string, number> = {};
          stats.forEach((s: { course_id: string }) => { counts[s.course_id] = (counts[s.course_id] || 0) + 1; });
          setCourseStats(counts);
          writeJSON(STATS_CACHE, counts);
        }
      }
    } catch (err) { console.warn("Offline: Using local courses", err); }
  }, [currentUser]);

  useEffect(() => { fetchCourses(); }, [fetchCourses]);

  /* ---- client-side search: filters the already-loaded list instantly ---- */
  const q = query.trim().toLowerCase();
  const visibleCourses = q
    ? courses.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.description || "").toLowerCase().includes(q))
    : courses;

  async function openAttendance(course: Course) {
    setAttendanceCourse(course);
    setLoadingLearners(true);
    try {
      const { data: enrollments } = await supabase.from("enrollments").select("user_id").eq("course_id", course.id).eq("role", "trainee").eq("tenant_id", currentUser?.tenantId);
      if (enrollments && enrollments.length > 0) {
        const userIds = enrollments.map((e: { user_id: string }) => e.user_id);
        const { data: users } = await supabase.from("users").select("id, username, phone, profile_pic").in("id", userIds);
        setAssignedLearners((users || []).map((u: Record<string, string>) => ({ id: u.id, username: u.username || "Unknown", phone: u.phone || "", profilePic: u.profile_pic || "" })));
      } else { setAssignedLearners([]); }
    } catch (e) { console.error("Failed to load learners", e); setAssignedLearners([]); }
    finally { setLoadingLearners(false); }
  }

  const loadSchedules = useCallback(async () => {
    if (!scheduleCourse) return;
    try {
      const { data } = await supabase.from("schedules").select("*").eq("course_id", scheduleCourse.id).order("scheduled_at", { ascending: true });
      setSchedules((data || []).map((s: { id: string; title: string; scheduled_at: string; description?: string }) => ({ id: s.id, title: s.title, scheduled_at: s.scheduled_at, description: s.description })));
    } catch (e) { console.error("Could not load schedules:", e); setSchedules([]); }
  }, [scheduleCourse]);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  async function handleCreateSchedule() {
    if (!scheduleCourse || !currentUser || !newScheduleTitle || !newScheduleDate) return;
    try {
      const { error } = await supabase.from("schedules").insert({
        id: crypto.randomUUID(), tenant_id: currentUser.tenantId, course_id: scheduleCourse.id, trainer_id: currentUser.id, trainer_name: currentUser.username,
        title: newScheduleTitle, description: newScheduleDesc, scheduled_at: new Date(newScheduleDate).toISOString(),
      });
      if (error) throw error;
      setNewScheduleTitle(""); setNewScheduleDesc(""); setNewScheduleDate("");
      loadSchedules();
    } catch (e) { console.error("Failed to save schedule:", e); alert("Failed to save schedule."); }
  }

  async function handleDeleteSchedule(id: string) {
    try { await supabase.from("schedules").delete().eq("id", id); setSchedules((prev) => prev.filter((s) => s.id !== id)); } catch (e) { console.error("Failed to delete schedule:", e); }
  }

  function handleLogout() {
    localStorage.removeItem("currentUser"); localStorage.removeItem("authToken"); localStorage.removeItem("adminDeviceId");
    window.dispatchEvent(new Event("authStateChanged")); navigate("/");
  }

  const businessName = settings?.businessName || "";
  const businessLogo = normalizeImageSrc(settings?.logo);
  const phone = settings?.phone || "";

  return (
    <div className="td-root">
      <style>{TD_CSS}</style>

      {/* -------- left app rail -------- */}
      <aside className="td-rail">
        <nav className="td-railnav" aria-label="Main navigation">
          <button className="td-railbtn" onClick={() => navigate("/forms")} title="Forms" aria-label="Forms">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
            {pendingForms > 0 && <span className="td-railbadge">{pendingForms > 99 ? "99+" : pendingForms}</span>}
          </button>
          <button className="td-railbtn" onClick={() => navigate("/trainer/settings")} title="Settings" aria-label="Settings">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
        </nav>
        <div className="td-railspacer" />
        <button className="td-railbtn" onClick={handleLogout} title="Log out" aria-label="Log out">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
        </button>
      </aside>

      {/* -------- top bar + content -------- */}
      <div className="td-main">
        <header className="td-bar">
          <div className="td-bar-grid">
            <div className="td-brand">
              {businessLogo ? (
                <img className="td-logo" src={businessLogo} alt="Logo" />
              ) : (
                <span className="td-logo td-logo-fallback">{(businessName || "M").charAt(0).toUpperCase()}</span>
              )}
              <div style={{ minWidth: 0 }}>
                {businessName && <h1 className="td-name">{businessName}</h1>}
                {phone && (
                  <a className="td-phone" href={`tel:${phone.replace(/\s+/g, "")}`}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                    {phone}
                  </a>
                )}
              </div>
            </div>

            <div className="td-bar-actions">
              <button className="td-chip" onClick={() => navigate("/trainer/settings")} title="Profile &amp; settings">
                <span className="td-avatar">
                  {profilePic && !profilePicError ? (
                    <img src={profilePic} alt="" onError={() => setProfilePicError(true)} />
                  ) : (
                    <span>{initialsOf(currentUser?.username, "?")}</span>
                  )}
                  <span className="td-presence" title="Available" />
                </span>
                <span className="td-username">{currentUser?.username}</span>
              </button>
            </div>
          </div>
        </header>

        <main className="td-body">
          <div className="td-heading">
            <h2>My courses</h2>
            {!loading && (
              <span className="td-count">
                {q ? `${visibleCourses.length} of ${courses.length}` : `${courses.length} assigned`}
              </span>
            )}
            {courses.length > 0 && (
              <div className="td-search td-heading-search">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input
                  type="text" placeholder="Search courses…" aria-label="Search courses"
                  value={query} onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
            <button className="td-refresh" onClick={() => fetchCourses()} disabled={loading} title="Refresh from cloud" aria-label="Refresh">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            </button>
          </div>

          {loading && (
            <div className="td-grid">
              <div className="td-skel" style={{ height: 320 }} />
              <div className="td-skel" style={{ height: 320 }} />
            </div>
          )}

          {!loading && courses.length === 0 && (
            <div className="td-empty">
              <div className="td-emptyicon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              </div>
              <h3 className="td-emptytitle">No courses assigned</h3>
              <p className="td-emptysub">Your administrator hasn&apos;t assigned any courses to you yet. Once they do, your classes will appear here.</p>
            </div>
          )}

          {!loading && courses.length > 0 && visibleCourses.length === 0 && (
            <p className="td-nomatch">No courses match &ldquo;{query.trim()}&rdquo;.</p>
          )}

          {!loading && visibleCourses.length > 0 && (
            <div className="td-grid">
              {visibleCourses.map((course) => {
                const learnerCount = courseStats[course.id] || 0;
                const start = course.startDate ? new Date(course.startDate) : null;
                const startValid = start ? !isNaN(start.getTime()) : false;
                return (
                  <div className="td-card" key={course.id}>
                    <div className="td-media">
                      {course.logo ? (
                        <img src={course.logo} alt={course.name} loading="lazy" decoding="async" />
                      ) : (
                        <div className="td-media-fallback">{(course.name || "C").charAt(0).toUpperCase()}</div>
                      )}
                    </div>

                    <div className="td-cardbody">
                      <h3 className="td-cardtitle">{course.name}</h3>
                      <p className="td-carddesc">{course.description || "No description provided."}</p>
                      <div className="td-meta">
                        <span className="td-metapill">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                          {learnerCount} learner{learnerCount === 1 ? "" : "s"}
                        </span>
                        {startValid && (
                          <span className="td-metapill">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                            Starts {start!.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        )}
                      </div>
                      <button className="td-schedbtn" onClick={() => setScheduleCourse(course)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                        Schedule session
                      </button>
                    </div>

                    <div className="td-actions">
                      <button className="td-act" onClick={() => navigate(`/trainer/live/${course.id}`)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                        <span>Live</span>
                      </button>
                      <button className="td-act" onClick={() => navigate(`/trainer/upload/${course.id}`)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                        <span>Upload</span>
                      </button>
                      <button className="td-act" onClick={() => navigate(`/trainer/assignments/${course.id}`)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                        <span>Assignments</span>
                      </button>
                      <button className="td-act" onClick={() => openAttendance(course)}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                        <span>Attendance</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* -------- attendance dialog -------- */}
      {attendanceCourse && (
        <div className="td-overlay" onClick={() => setAttendanceCourse(null)}>
          <div className="td-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="td-sheet-handle" />
            <div className="td-dialog-head">
              <div style={{ minWidth: 0 }}>
                <h2 className="td-dialog-title">{attendanceCourse.name}</h2>
                <p className="td-dialog-sub">
                  {loadingLearners ? "Loading learners…" : `${assignedLearners.length} learner${assignedLearners.length === 1 ? "" : "s"} enrolled`}
                </p>
              </div>
              <button className="td-close" onClick={() => setAttendanceCourse(null)} title="Close" aria-label="Close">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="td-dialog-body">
              {loadingLearners ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="td-skel" style={{ height: 52, borderRadius: 6 }} />
                  <div className="td-skel" style={{ height: 52, borderRadius: 6 }} />
                  <div className="td-skel" style={{ height: 52, borderRadius: 6 }} />
                </div>
              ) : assignedLearners.length === 0 ? (
                <p className="td-emptysmall">No learners enrolled yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "0 -10px" }}>
                  {assignedLearners.map((learner) => (
                    <div className="td-listitem" key={learner.id}>
                      <span className="td-lavatar">
                        {learner.profilePic ? <img src={learner.profilePic} alt="" /> : learner.username?.charAt(0).toUpperCase()}
                      </span>
                      <div className="td-listmeta">
                        <div className="td-listname">{learner.username}</div>
                        <div className="td-listsub">{learner.phone || "No phone"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* -------- schedule dialog -------- */}
      {scheduleCourse && (
        <div className="td-overlay" onClick={() => setScheduleCourse(null)}>
          <div className="td-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="td-sheet-handle" />
            <div className="td-dialog-head">
              <div style={{ minWidth: 0 }}>
                <h2 className="td-dialog-title">Schedule sessions</h2>
                <p className="td-dialog-sub">{scheduleCourse.name}</p>
              </div>
              <button className="td-close" onClick={() => setScheduleCourse(null)} title="Close" aria-label="Close">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="td-dialog-body">
              <div style={{ background: CANVAS, borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <input
                  className="td-field" type="text" placeholder="Session title"
                  value={newScheduleTitle} onChange={(e) => setNewScheduleTitle(e.target.value)}
                />
                <textarea
                  className="td-field" placeholder="Description (optional)" rows={2} style={{ resize: "none" }}
                  value={newScheduleDesc} onChange={(e) => setNewScheduleDesc(e.target.value)}
                />
                <label className="td-label">Date &amp; time</label>
                <input
                  className="td-field" type="datetime-local"
                  value={newScheduleDate} onChange={(e) => setNewScheduleDate(e.target.value)}
                />
                <button
                  className="td-btn-primary" onClick={handleCreateSchedule}
                  disabled={!newScheduleTitle || !newScheduleDate}
                >
                  Add session
                </button>
              </div>

              <h3 className="td-upcoming">Upcoming</h3>
              {schedules.length === 0 ? (
                <p className="td-emptysmall">No sessions scheduled yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {schedules.map((sch) => {
                    const d = new Date(sch.scheduled_at);
                    const valid = !isNaN(d.getTime());
                    return (
                      <div className="td-schedrow" key={sch.id}>
                        <div className="td-datesq">
                          <b>{valid ? d.getDate() : "—"}</b>
                          <span>{valid ? d.toLocaleString(undefined, { month: "short" }) : ""}</span>
                        </div>
                        <div className="td-listmeta">
                          <div className="td-listname">{sch.title}</div>
                          {sch.description && <div className="td-listsub">{sch.description}</div>}
                          <div className="td-listsub">{valid ? d.toLocaleString() : ""}</div>
                        </div>
                        <button className="td-delbtn" onClick={() => handleDeleteSchedule(sch.id)}>Delete</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
