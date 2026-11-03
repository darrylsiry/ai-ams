#!/usr/bin/env node
// Demo data for siryous AMS: a credible two-office independent agency (Raleigh and Charlotte, NC)
// with history from 2026-01-01 to today. Every name, carrier, address and number is fictional.
//
//   node scripts/seed.mjs            seed an empty database (no-op when clients exist)
//   node scripts/seed.mjs --reset    drop everything, re-run migrations, seed again
//
// Deterministic: the same date produces the same agency. Money posts through the same double-entry
// rules as src/lib/accounting.ts so the trust account, receivables and payables reconcile.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrations } from "./migrate-core.mjs";

pg.types.setTypeParser(1082, (v) => v);
const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, "..", "migrations");
const url = process.env.DATABASE_URL ?? "postgresql://ams:ams@localhost:5433/ams";
const RESET = process.argv.includes("--reset");
const TZ = process.env.DISPLAY_TZ || "America/New_York";
const db = new pg.Client({ connectionString: url });

// ───────────────────────── deterministic randomness
let seed = 20260101;
function rand() { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (a) => a[Math.floor(rand() * a.length)];
const chance = (p) => rand() < p;
const weighted = (pairs) => { const total = pairs.reduce((s, [, w]) => s + w, 0); let r = rand() * total; for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[pairs.length - 1][0]; };
const round2 = (n) => Math.round(n * 100) / 100;
const roundTo = (n, step) => Math.round(n / step) * step;
const digits = (n) => String(ri(10 ** (n - 1), 10 ** n - 1));

// ───────────────────────── dates
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const START = "2026-01-01";
const addDays = (iso, d) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const addMonths = (iso, m) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const isWeekend = (iso) => dow(iso) === 0 || dow(iso) === 6;
const nextBiz = (iso) => { let d = iso; while (isWeekend(d)) d = addDays(d, 1); return d; };
const bizAdd = (iso, n) => { let d = iso; let k = 0; while (k < n) { d = addDays(d, 1); if (!isWeekend(d)) k++; } return d; };
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const offset = (iso) => (iso >= "2026-03-08" && iso < "2026-11-01") || (iso >= "2025-03-09" && iso < "2025-11-02") ? "-04:00" : "-05:00";
const ts = (iso, h, m = 0) => `${iso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00${offset(iso)}`;
const workTs = (iso) => ts(iso, ri(8, 16), ri(0, 59));
const BIZ_DAYS = []; for (let d = START; d <= TODAY; d = addDays(d, 1)) if (!isWeekend(d)) BIZ_DAYS.push(d);
const randomDate = (a, b) => addDays(a, ri(0, Math.max(0, daysBetween(a, b))));

// ───────────────────────── db helpers
async function insertMany(table, cols, rows, returning = "id") {
  const out = [];
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const params = [];
    const values = chunk.map((r) => `(${cols.map((c) => { params.push(r[c] === undefined ? null : r[c]); return `$${params.length}`; }).join(",")})`);
    const res = await db.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${values.join(",")}${returning ? ` RETURNING ${returning}` : ""}`, params);
    out.push(...res.rows);
  }
  return out;
}
async function insertOne(table, row, returning = "id") { return (await insertMany(table, Object.keys(row), [row], returning))[0]; }

// ───────────────────────── vocabulary
const FIRST = ["James","Mary","Robert","Patricia","Michael","Jennifer","William","Linda","David","Elizabeth","Richard","Barbara","Joseph","Susan","Thomas","Jessica","Charles","Sarah","Christopher","Karen","Daniel","Lisa","Matthew","Nancy","Anthony","Betty","Mark","Sandra","Steven","Ashley","Andrew","Emily","Joshua","Michelle","Kevin","Amanda","Brian","Melissa","George","Stephanie","Timothy","Rebecca","Jason","Laura","Ryan","Megan","Jacob","Rachel","Nathan","Olivia","Tyler","Hannah","Brandon","Lauren","Caleb","Grace","Marcus","Priya","Andre","Mei","Luis","Sofia","Omar","Aaliyah","Diego","Keisha","Hiro","Fatima","Wesley","Camille"];
const LAST = ["Smith","Johnson","Williams","Brown","Jones","Miller","Davis","Wilson","Anderson","Taylor","Thomas","Moore","Martin","Jackson","Thompson","White","Harris","Clark","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Hill","Green","Adams","Baker","Nelson","Carter","Mitchell","Roberts","Turner","Phillips","Campbell","Parker","Evans","Edwards","Collins","Stewart","Morris","Murphy","Cook","Rogers","Morgan","Cooper","Peterson","Reed","Bailey","Bell","Gomez","Kelly","Howard","Ward","Cox","Diaz","Richardson","Wood","Watson","Brooks","Bennett","Gray","James","Hughes","Price","Sanders","Myers","Long","Ross","Foster","Jenkins","Perry","Powell","Sullivan","Russell","Ortiz","Jensen","Barnes","Fisher","Henderson","Coleman","Simmons","Patterson","Jordan","Reynolds","Hamilton","Graham","Kim","Gonzales","Alexander","Ramos","Wallace","Griffin","West","Cole","Hayes","Chavez","Gibson","Bryant","Ellis","Stevens","Murray","Ford","Marshall","Owens","McDonald","Harrison","Ruiz","Kennedy","Wells","Alvarez","Woods","Mendoza","Castillo","Olson","Webb","Washington","Tucker","Freeman","Burns","Henry","Vasquez","Snyder","Simpson","Crawford","Jimenez","Porter","Mason","Shaw","Gordon","Wagner","Hunter","Romero","Hicks","Dixon","Hunt","Palmer","Robertson","Black","Holmes","Stone","Meyer","Boyd","Mills","Warren","Fox","Rose","Rice","Moreno","Schmidt","Patel","Ferguson","Nichols","Herrera","Medina","Ryan","Fernandez","Weaver","Daniels","Stephens","Gardner","Payne","Kelley","Dunn","Pierce","Arnold","Tran","Spencer","Peters","Hawkins","Grant","Hansen","Castro","Hoffman","Hart","Elliott","Cunningham","Knight","Bradley"];
const STREETS = ["Oak","Maple","Pine","Cedar","Elm","Willow","Laurel","Magnolia","Dogwood","Hickory","Birch","Poplar","Chestnut","Sycamore","Juniper","Holly","Ashford","Brookstone","Carrington","Fairview","Glenwood","Hawthorne","Kingsley","Lakeview","Millbrook","Northridge","Oakmont","Parkside","Ridgecrest","Sterling","Stonehaven","Westover","Wynwood","Bellwood","Crescent","Falls Lake","Tryon","Providence","Sardis","Rea"];
const SUFFIX = ["St","Ave","Dr","Ln","Ct","Rd","Way","Pl","Blvd","Trl"];
const CITIES = {
  RAL: [["Raleigh","27609"],["Raleigh","27612"],["Raleigh","27615"],["Cary","27513"],["Cary","27519"],["Apex","27502"],["Wake Forest","27587"],["Durham","27707"],["Durham","27713"],["Chapel Hill","27514"],["Garner","27529"],["Holly Springs","27540"],["Morrisville","27560"],["Fuquay-Varina","27526"],["Knightdale","27545"]],
  CLT: [["Charlotte","28202"],["Charlotte","28210"],["Charlotte","28226"],["Charlotte","28277"],["Matthews","28105"],["Huntersville","28078"],["Cornelius","28031"],["Mooresville","28117"],["Concord","28027"],["Gastonia","28054"],["Pineville","28134"],["Fort Mill","29715"],["Rock Hill","29730"]],
};
const stateFor = (zip) => (zip.startsWith("29") ? "SC" : "NC");
const address = (branch) => { const [city, zip] = pick(CITIES[branch]); return { address1: `${ri(100, 9899)} ${pick(STREETS)} ${pick(SUFFIX)}`, city, zip, state: stateFor(zip) }; };
const phone = (branch) => `(${branch === "RAL" ? pick(["919", "984"]) : pick(["704", "980"])}) 555-${String(ri(100, 9999)).padStart(4, "0")}`;
const VEHICLES = [["Toyota","Camry"],["Toyota","RAV4"],["Toyota","Highlander"],["Honda","Accord"],["Honda","CR-V"],["Honda","Pilot"],["Ford","F-150"],["Ford","Explorer"],["Ford","Escape"],["Chevrolet","Silverado 1500"],["Chevrolet","Equinox"],["Chevrolet","Tahoe"],["Nissan","Rogue"],["Nissan","Altima"],["Hyundai","Tucson"],["Hyundai","Santa Fe"],["Kia","Telluride"],["Subaru","Outback"],["Subaru","Forester"],["Jeep","Grand Cherokee"],["Jeep","Wrangler"],["Tesla","Model Y"],["Tesla","Model 3"],["BMW","X5"],["Lexus","RX 350"],["Mazda","CX-5"],["Ram","1500"],["GMC","Sierra 1500"],["Volkswagen","Atlas"]];
const COMM_VEHICLES = [["Ford","Transit 250"],["Ford","F-250 Super Duty"],["Ford","F-350 Super Duty"],["Ram","2500"],["Ram ProMaster","2500"],["Chevrolet","Express 2500"],["Chevrolet","Silverado 2500HD"],["Isuzu","NPR-HD"],["Freightliner","M2 106"],["Mercedes-Benz","Sprinter 2500"],["GMC","Savana 3500"]];
const vin = () => { const c = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"; let s = pick(["1", "2", "3", "4", "5", "J", "K"]); for (let i = 0; i < 16; i++) s += c[ri(0, c.length - 1)]; return s; };

// ───────────────────────── agency
const USERS = [
  { username: "admin", full_name: "Morgan Ellis", title: "Operations Manager", role: "admin", branch: "RAL", pii: true, color: "#0f766e" },
  { username: "choll", full_name: "Catherine Holloway", title: "Principal", role: "principal", branch: "RAL", pii: true, color: "#7c3aed" },
  { username: "mrivera", full_name: "Marisol Rivera", title: "Commercial Account Manager", role: "account_manager", branch: "RAL", pii: true, color: "#4f46e5" },
  { username: "jbrooks", full_name: "Jordan Brooks", title: "Commercial Account Manager", role: "account_manager", branch: "CLT", pii: true, color: "#0369a1" },
  { username: "apatel", full_name: "Anika Patel", title: "Personal Lines Account Manager", role: "account_manager", branch: "RAL", pii: true, color: "#db2777" },
  { username: "tnguyen", full_name: "Thomas Nguyen", title: "Personal Lines Account Manager", role: "account_manager", branch: "CLT", pii: true, color: "#ea580c" },
  { username: "kowens", full_name: "Kayla Owens", title: "Customer Service Representative", role: "csr", branch: "RAL", pii: false, color: "#16a34a" },
  { username: "dharris", full_name: "Devon Harris", title: "Customer Service Representative", role: "csr", branch: "CLT", pii: false, color: "#ca8a04" },
  { username: "rcallahan", full_name: "Ryan Callahan", title: "Commercial Producer", role: "producer", branch: "RAL", pii: false, color: "#dc2626", split: [40, 25] },
  { username: "bwhitaker", full_name: "Ben Whitaker", title: "Commercial Producer", role: "producer", branch: "CLT", pii: false, color: "#9333ea", split: [40, 25] },
  { username: "sfoster", full_name: "Sarah Foster", title: "Personal & Small Business Producer", role: "producer", branch: "RAL", pii: false, color: "#0891b2", split: [35, 20] },
  { username: "lmorgan", full_name: "Lisa Morgan", title: "Accounting Manager", role: "accounting", branch: "RAL", pii: false, color: "#475569" },
];

const CARRIERS = [
  { code: "GRM", name: "Granite Ridge Mutual", naic: "24418", am_best: "A", bill: "direct", lines: ["HO","PA","UMB","BOP","GL","PROP","CA","WC","CUMB","IM"], cn: 15, cr: 13, pfx: { HO: "GHO", PA: "GPA", UMB: "GUM", BOP: "GBP", PROP: "GCP", GL: "GCP", CA: "GCA", WC: "GWC", CUMB: "GCU", IM: "GIM" } },
  { code: "BHI", name: "Blue Harbor Insurance Company", naic: "31209", am_best: "A+", bill: "direct", lines: ["PA","HO","UMB","WTR","DP"], cn: 12, cr: 10, pfx: {} },
  { code: "PFC", name: "Piedmont Fire & Casualty", naic: "19771", am_best: "A", bill: "both", lines: ["BOP","PROP","GL","CA","WC","CUMB","IM"], cn: 15, cr: 15, pfx: {} },
  { code: "LSI", name: "Lakeshore Indemnity", naic: "40132", am_best: "A-", bill: "direct", lines: ["CA","WC","GL"], cn: 12, cr: 10, pfx: {} },
  { code: "SNI", name: "Summit National Insurance", naic: "28145", am_best: "A", bill: "direct", lines: ["PA","HO","DP","UMB"], cn: 12, cr: 12, pfx: {} },
  { code: "CBM", name: "Carolina Builders Mutual", naic: "11532", am_best: "A-", bill: "direct", lines: ["WC","GL","CA"], cn: 10, cr: 10, pfx: {} },
  { code: "KPI", name: "Keystone Preferred Insurance", naic: "35517", am_best: "A++", bill: "direct", lines: ["HO","PA","UMB","WTR"], cn: 15, cr: 13, pfx: {} },
  { code: "EVA", name: "Evergreen Assurance", naic: "16632", am_best: "A", bill: "direct", lines: ["BOP","CYB","PL","WC"], cn: 15, cr: 15, pfx: {} },
  { code: "TWC", name: "Tidewater Casualty", naic: "41890", am_best: "B++", bill: "direct", lines: ["PA"], cn: 10, cr: 10, pfx: {} },
  { code: "ICI", name: "Ironclad Commercial Insurance", naic: "22963", am_best: "A", bill: "direct", lines: ["GL","CUMB","IM","CA"], cn: 15, cr: 12, pfx: {} },
  { code: "ASI", name: "Atlas Specialty Insurance", naic: "AA-1129", am_best: "A", bill: "agency", lines: ["GL","CUMB","PROP","PL"], cn: 12, cr: 12, admitted: false, pfx: {} },
  { code: "MES", name: "Meridian Excess & Surplus", naic: "AA-1354", am_best: "A-", bill: "agency", lines: ["GL","PROP","CUMB"], cn: 12, cr: 12, admitted: false, pfx: {} },
  { code: "CBP", name: "Coastal Brokerage Partners", kind: "wholesaler", bill: "agency", lines: [], cn: 12, cr: 12, admitted: false, pfx: {} },
  { code: "RUM", name: "Redline Underwriting Managers", kind: "mga", bill: "agency", lines: ["PL","CYB"], cn: 12, cr: 12, admitted: false, pfx: {} },
];
const DOMAINS = { GRM: "graniteridgemutual.example", BHI: "blueharborins.example", PFC: "piedmontfc.example", LSI: "lakeshoreindemnity.example", SNI: "summitnational.example", CBM: "carolinabuildersmutual.example", KPI: "keystonepreferred.example", EVA: "evergreenassurance.example", TWC: "tidewatercasualty.example", ICI: "ironcladcommercial.example", ASI: "atlasspecialty.example", MES: "meridianes.example", CBP: "coastalbrokerage.example", RUM: "redlineum.example" };

const INDUSTRIES = [
  { key: "plumbing", naics: "238220", label: "Plumbing & HVAC contractor", names: ["{L} Plumbing & Heating", "{C} Plumbing Company", "{L} Mechanical Services", "{L} & Sons Plumbing"], core: ["GL","CA","WC"], opt: [["IM",0.6],["CUMB",0.5]], size: [4, 45], gl: [11, "$1,000 per occurrence"], classes: [["5183", "Plumbing — residential"], ["5537", "HVAC systems installation"]] },
  { key: "electrical", naics: "238210", label: "Electrical contractor", names: ["{L} Electric", "{C} Electrical Contractors", "{L} Power & Light", "Bright Line Electric"], core: ["GL","CA","WC"], opt: [["IM",0.6],["CUMB",0.55]], size: [5, 60], classes: [["5190", "Electrical wiring within buildings"]] },
  { key: "roofing", naics: "238160", label: "Roofing contractor", names: ["{L} Roofing", "{C} Roofing & Exteriors", "Summit Peak Roofing", "{L} Roof Systems"], core: ["GL","CA","WC"], opt: [["CUMB",0.5],["IM",0.3]], size: [6, 40], es: true, classes: [["5551", "Roofing — all kinds"]] },
  { key: "landscaping", naics: "561730", label: "Landscaping services", names: ["{L} Landscaping", "{C} Lawn & Garden", "Greenway Outdoor Services", "{L} Landscape Group"], core: ["GL","CA","WC"], opt: [["IM",0.7]], size: [4, 35], classes: [["0042", "Landscape gardening"]] },
  { key: "gc", naics: "236118", label: "Residential remodeling contractor", names: ["{L} Builders", "{C} Renovation Group", "{L} Construction LLC", "Cornerstone Remodeling"], core: ["GL","WC","CA"], opt: [["CUMB",0.65],["IM",0.5]], size: [3, 30], classes: [["5645", "Carpentry — residential"], ["5403", "Carpentry — commercial"]] },
  { key: "restaurant", naics: "722511", label: "Full-service restaurant", names: ["{L}'s Kitchen", "The {C} Tavern", "{L} Family Restaurant", "Copper Kettle Bistro", "{C} Taqueria", "Smoke & Oak BBQ"], core: ["BOP","WC"], opt: [["CUMB",0.4]], size: [8, 60], classes: [["9079", "Restaurant NOC"]] },
  { key: "retail", naics: "452319", label: "Retail store", names: ["{C} Outfitters", "{L} Hardware", "{C} Gift & Home", "Blue Ridge Bike Shop", "{L} Pharmacy"], core: ["BOP"], opt: [["WC",0.8],["CYB",0.3]], size: [3, 25], classes: [["8017", "Store — retail NOC"]] },
  { key: "dental", naics: "621210", label: "Dental practice", names: ["{C} Family Dentistry PLLC", "{L} Dental Group", "Bright Smiles Pediatric Dentistry", "{C} Orthodontics"], core: ["BOP","WC","PL"], opt: [["CYB",0.7]], size: [6, 30], classes: [["8832", "Physician / dental office"]] },
  { key: "cpa", naics: "541211", label: "Accounting firm", names: ["{L} & Associates CPAs", "{L} {L2} CPA Group", "{C} Tax & Advisory"], core: ["BOP","PL","CYB"], opt: [["WC",0.9]], size: [3, 25], classes: [["8810", "Clerical office employees"]] },
  { key: "realty", naics: "531311", label: "Residential property manager", names: ["{C} Property Management", "{L} Realty Group", "Oakline Rentals LLC", "{L} Holdings LLC"], core: ["PROP","GL"], opt: [["CUMB",0.7],["WC",0.5]], size: [2, 15], classes: [["8742", "Salespersons — outside"]] },
  { key: "trucking", naics: "484121", label: "General freight trucking", names: ["{L} Transport", "{C} Freight Lines", "{L} Logistics LLC", "Piedmont Haulers"], core: ["CA","WC","IM"], opt: [["CUMB",0.7],["GL",0.6]], size: [5, 45], classes: [["7219", "Trucking — NOC"]] },
  { key: "manufacturing", naics: "332710", label: "Machine shop", names: ["{L} Precision Machining", "{C} Fabrication", "{L} Manufacturing Co", "Triangle Tool & Die"], core: ["PROP","GL","WC"], opt: [["CA",0.6],["CUMB",0.6]], size: [10, 120], classes: [["3632", "Machine shop NOC"]] },
  { key: "autorepair", naics: "811111", label: "Auto repair shop", names: ["{L} Automotive", "{C} Auto Care", "{L} Tire & Service", "Precision Auto Works"], core: ["GL","PROP","WC"], opt: [["CA",0.4],["CUMB",0.3]], size: [3, 20], classes: [["8380", "Automobile service or repair"]] },
  { key: "nonprofit", naics: "813110", label: "Religious organization", names: ["{C} Community Church", "Grace Fellowship of {C}", "{C} United Methodist Church", "New Hope Baptist Church"], core: ["PROP","GL"], opt: [["WC",0.5],["CUMB",0.5]], size: [2, 25], classes: [["9101", "Church / religious organization"]] },
  { key: "tech", naics: "541511", label: "Software development", names: ["{C} Software Labs", "Bluefin Analytics", "{L} Digital", "Kitebridge Technologies", "Lumen Data Systems"], core: ["BOP","CYB","PL"], opt: [["WC",0.9]], size: [4, 80], classes: [["8810", "Clerical office employees"]] },
];

// Base annual premium per line for a 10-employee account (scaled by size below).
const BASE = { GL: 6500, CA: 9000, WC: 7500, IM: 1800, CUMB: 2600, BOP: 4200, PROP: 7800, CYB: 2200, PL: 3400, PA: 2200, HO: 1900, DP: 1300, UMB: 380, WTR: 650 };
const INDUSTRY_FACTOR = { roofing: { GL: 2.4, WC: 2.8 }, trucking: { CA: 3.2 }, restaurant: { BOP: 1.8, WC: 1.3 }, manufacturing: { PROP: 1.6, WC: 1.6 }, landscaping: { WC: 1.4 }, dental: { PL: 1.2 }, tech: { CYB: 1.5 } };

const HOLDERS = [
  ["Hendrick Brothers General Contractors", "certificate_holder"], ["Triangle Commercial Builders LLC", "certificate_holder"], ["Queen City Construction Group", "certificate_holder"],
  ["City of Raleigh — Risk Management", "certificate_holder"], ["Town of Cary", "certificate_holder"], ["City of Charlotte — Engineering & Property Mgmt", "certificate_holder"],
  ["Wake County Public School System", "certificate_holder"], ["Mecklenburg County", "certificate_holder"], ["Brightwater Property Management", "certificate_holder"],
  ["Crescent Realty Partners LLC", "certificate_holder"], ["Atrium Health — Facilities", "certificate_holder"], ["WakeMed Health & Hospitals", "certificate_holder"],
  ["North Hills Owners Association", "certificate_holder"], ["Ballantyne Commons Retail LLC", "certificate_holder"], ["Duke Energy Progress — Contractor Compliance", "certificate_holder"],
  ["Park West Village HOA", "certificate_holder"], ["Summit Industrial REIT", "certificate_holder"], ["Pinnacle Homes of the Carolinas", "certificate_holder"],
  ["Lennox Ridge Apartments", "certificate_holder"], ["Carolina Panthers Stadium Ops (sample)", "certificate_holder"],
  ["First Carolina Bank ISAOA/ATIMA", "mortgagee"], ["Pinnacle Home Mortgage ISAOA", "mortgagee"], ["Triangle Federal Credit Union", "mortgagee"], ["Queen City Savings Bank ISAOA", "mortgagee"],
  ["Crestline Auto Finance", "lienholder"], ["Carolina Auto Credit Union", "lienholder"], ["Summit Equipment Finance", "loss_payee"],
];

// ───────────────────────── accounting (mirrors src/lib/accounting.ts)
const ledgerRows = [];
let journalN = 0;
function post(date, memo, refType, refId, lines, extra = {}) {
  // Same rule as the app's post(): a negative amount is the other side of the entry.
  const ls = lines.map((l) => { const net = round2((l.debit ?? 0) - (l.credit ?? 0)); return { ...l, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 }; }).filter((l) => l.debit || l.credit);
  const dr = round2(ls.reduce((s, l) => s + l.debit, 0)), cr = round2(ls.reduce((s, l) => s + l.credit, 0));
  if (dr !== cr) throw new Error(`unbalanced ${memo}: ${dr} vs ${cr}`);
  const journal = `J-${refType}-${refId}-s${++journalN}`;
  for (const l of ls) ledgerRows.push({ entry_date: date, journal, account: l.account, debit: l.debit, credit: l.credit, memo, ref_type: refType, ref_id: refId, client_id: extra.client_id ?? null, policy_id: extra.policy_id ?? null, carrier_id: extra.carrier_id ?? null, created_at: ts(date, 17, 30) });
}

let docNo = 1000;
const docNumber = (prefix, date) => `${prefix}-${date.slice(2, 4)}-${String(++docNo).padStart(6, "0")}`;

// ───────────────────────── main
async function main() {
  await db.connect();
  await db.query(`SET TIME ZONE '${TZ}'`);
  if (RESET) {
    // SEC-021: this drops every table, so it never runs on a deployed machine by mistake.
    if (process.env.FLY_APP_NAME || process.env.NODE_ENV === "production") throw new Error("seed --reset refuses to run on a deployment.");
    console.log("reset: dropping schema");
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  }
  await runMigrations(db, MIGRATIONS);
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM clients");
  if (n > 0) { console.log(`already seeded (${n} clients); use --reset to start over`); await db.end(); return; }
  console.log(`seeding siryous AMS demo agency: history ${START} → ${TODAY}`);
  const t0 = Date.now();

  // Branches, users, licenses
  const branches = await insertMany("branches", ["code", "name", "city", "state"], [
    { code: "RAL", name: "Raleigh", city: "Raleigh", state: "NC" }, { code: "CLT", name: "Charlotte", city: "Charlotte", state: "NC" }], "id, code");
  const branchId = Object.fromEntries(branches.map((b) => [b.code, b.id]));
  const userRows = await insertMany("users", ["username", "full_name", "email", "title", "role", "branch_id", "phone", "inbox_alias", "can_view_pii", "commission_new_pct", "commission_renewal_pct", "color", "created_at"],
    USERS.map((u) => ({ ...u, email: `${u.username}@siryousagency.example`, branch_id: branchId[u.branch], phone: phone(u.branch), inbox_alias: u.username, can_view_pii: u.pii,
      commission_new_pct: u.split?.[0] ?? 0, commission_renewal_pct: u.split?.[1] ?? 0, created_at: ts("2025-12-15", 9) })), "id, username");
  const U = Object.fromEntries(userRows.map((r) => [r.username, { ...USERS.find((u) => u.username === r.username), id: r.id }]));
  const licenses = [];
  for (const u of USERS.filter((x) => ["account_manager", "producer", "principal", "csr"].includes(x.role))) {
    for (const st of ["NC", ...(chance(0.6) ? ["SC"] : []), ...(chance(0.25) ? ["VA"] : [])]) {
      licenses.push({ user_id: U[u.username].id, state: st, license_number: digits(8), expires_on: randomDate(addDays(TODAY, 20), "2028-06-30") });
    }
  }
  licenses[2].expires_on = addDays(TODAY, 41);
  await insertMany("licenses", ["user_id", "state", "license_number", "expires_on"], licenses, null);

  // Carriers and parties
  const carrierRows = await insertMany("carriers", ["code", "name", "kind", "naic", "am_best", "admitted", "bill_modes", "lines", "phone", "email", "underwriting_email", "portal_url", "commission_new_pct", "commission_renewal_pct"],
    CARRIERS.map((c) => ({ code: c.code, name: c.name, kind: c.kind ?? "carrier", naic: c.naic ?? null, am_best: c.am_best ?? null, admitted: c.admitted ?? true, bill_modes: c.bill, lines: c.lines,
      phone: `(800) 555-${String(ri(1000, 9999))}`, email: `agents@${DOMAINS[c.code]}`, underwriting_email: `underwriting@${DOMAINS[c.code]}`, portal_url: `https://agents.${DOMAINS[c.code]}`,
      commission_new_pct: c.cn, commission_renewal_pct: c.cr })), "id, code");
  const C = Object.fromEntries(carrierRows.map((r) => [r.code, { ...CARRIERS.find((c) => c.code === r.code), id: r.id }]));
  const finance = await insertMany("finance_companies", ["name", "phone", "email"], [
    { name: "Southeast Premium Finance", phone: "(800) 555-0188", email: "service@sepremiumfinance.example" }, { name: "Keel Premium Funding", phone: "(888) 555-0142", email: "agents@keelfunding.example" }]);
  await insertMany("vendors", ["name", "kind", "email", "phone"], [
    { name: "Benchmark Restoration Services", kind: "restoration", email: "dispatch@benchmarkrestore.example", phone: "(919) 555-0110" },
    { name: "Carolina Loss Control Partners", kind: "loss control", email: "inspections@clcp.example", phone: "(704) 555-0172" },
    { name: "Triangle Print & Mail", kind: "print", email: "orders@triangleprint.example", phone: "(919) 555-0193" }], null);
  const holderRows = await insertMany("other_interests", ["name", "kind", "attention", "address1", "city", "state", "zip", "email", "created_at"],
    HOLDERS.map(([name, kind]) => { const a = address(chance(0.5) ? "RAL" : "CLT"); return { name, kind, attention: kind === "certificate_holder" ? pick(["Risk Management", "Contracts Administrator", "Vendor Compliance", null]) : null, ...a, email: kind === "certificate_holder" ? `coi@${name.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 18)}.example` : null, created_at: ts("2025-12-20", 10) }; }), "id, name, kind");
  const certHolders = holderRows.filter((h) => h.kind === "certificate_holder");
  const mortgagees = holderRows.filter((h) => h.kind === "mortgagee");
  const lienholders = holderRows.filter((h) => h.kind === "lienholder");

  // ───────── Clients
  const clients = [];
  const used = new Set();
  const uniqueName = (fn) => { for (let i = 0; i < 20; i++) { const n = fn(); if (!used.has(n)) { used.add(n); return n; } } const n = `${fn()} ${ri(2, 9)}`; used.add(n); return n; };
  const ams = { personal: { RAL: U.apatel, CLT: U.tnguyen }, commercial: { RAL: U.mrivera, CLT: U.jbrooks } };
  const csrs = { RAL: U.kowens, CLT: U.dharris };
  const sinceDate = (newBiz) => (newBiz ? null : randomDate("2014-03-01", "2025-11-30"));
  const SOURCES = ["Referral — client", "Referral — CPA", "Referral — realtor", "Website quote form", "Cross-sell", "Carrier book roll", "Networking event", "Google search", "Lead vendor", "Walk-in"];

  // Personal households
  for (let i = 0; i < 255; i++) {
    const branch = chance(0.55) ? "RAL" : "CLT";
    const first = pick(FIRST), last = pick(LAST);
    const newBiz = chance(0.13);
    const a = address(branch);
    const spouse = chance(0.55) ? pick(FIRST) : null;
    const name = uniqueName(() => (spouse ? `${first} & ${spouse} ${last}` : `${first} ${last}`));
    clients.push({ kind: "individual", branch, newBiz, first, last, spouse, name, a, lines: ["PA", "HO", ...(chance(0.1) ? ["DP"] : []), ...(chance(0.28) ? ["UMB"] : []), ...(chance(0.08) ? ["WTR"] : [])].filter((l, j) => j > 0 || chance(0.93)),
      am: ams.personal[branch], producer: U.sfoster, csr: csrs[branch], size: 1 });
  }
  // Commercial accounts
  for (let i = 0; i < 125; i++) {
    const branch = chance(0.55) ? "RAL" : "CLT";
    const ind = pick(INDUSTRIES);
    const a = address(branch);
    const name = uniqueName(() => {
      const base = pick(ind.names).replace("{L}", pick(LAST)).replace("{L2}", pick(LAST)).replace("{C}", a.city.split(" ")[0] === "Fort" ? "Fort Mill" : a.city.split("-")[0]);
      return base + (chance(0.45) && !/(LLC|PLLC|Inc\.?|Church|CPAs)$/.test(base) ? pick([" LLC", " Inc.", " Co."]) : "");   // no "Construction LLC LLC"
    });
    const employees = ri(ind.size[0], ind.size[1]);
    const lines = [...ind.core, ...ind.opt.filter(([, p]) => chance(p)).map(([l]) => l)];
    const newBiz = chance(0.14);
    const producer = branch === "CLT" ? (chance(0.8) ? U.bwhitaker : U.sfoster) : employees < 8 && chance(0.4) ? U.sfoster : U.rcallahan;
    clients.push({ kind: "business", branch, newBiz, ind, name, a, employees, lines, am: ams.commercial[branch], producer, csr: csrs[branch], size: Math.max(0.35, employees / 10) ** 0.85 });
  }

  const clientRows = await insertMany("clients", ["code", "name", "kind", "status", "dba", "industry", "naics", "annual_revenue", "employees", "years_in_business", "website", "email", "phone", "address1", "city", "state", "zip",
    "branch_id", "source", "producer_id", "account_manager_id", "csr_id", "household", "tags", "dob", "drivers_license", "fein", "preferred_channel", "do_not_call", "email_opt_out", "sms_consent_at", "client_since", "created_at", "notes"],
    clients.map((c, i) => {
      const domain = c.kind === "business" ? `${c.name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "").slice(0, 22)}.example` : null;
      c.domain = domain;
      c.since = sinceDate(c.newBiz);
      const email = c.kind === "business" ? `office@${domain}` : `${c.first.toLowerCase()}.${c.last.toLowerCase()}${ri(1, 99)}@${pick(["gmail.com", "gmail.com", "yahoo.com", "outlook.com", "icloud.com", "aol.com"])}`;
      c.email = email;
      const code = (c.kind === "business" ? c.name : `${c.last}${c.first}`).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6).padEnd(4, "X") + "-" + String(i + 1).padStart(3, "0");
      return {
        code, name: c.name, kind: c.kind, status: c.newBiz ? "prospect" : "insured", dba: null, industry: c.ind?.label ?? null, naics: c.ind?.naics ?? null,
        annual_revenue: c.kind === "business" ? roundTo(c.employees * ri(85, 220) * 1000, 5000) : null, employees: c.employees ?? null,
        years_in_business: c.kind === "business" ? ri(2, 38) : null, website: domain ? `www.${domain}` : null, email, phone: phone(c.branch), ...c.a,
        branch_id: branchId[c.branch], source: pick(SOURCES), producer_id: c.producer.id, account_manager_id: c.am.id, csr_id: c.csr.id,
        household: c.kind === "individual" ? `${c.last} household` : null,
        tags: c.kind === "business" ? [c.ind.key === "roofing" || c.ind.key === "gc" || c.ind.key === "plumbing" || c.ind.key === "electrical" || c.ind.key === "landscaping" ? "contractor" : c.ind.key, ...(chance(0.15) ? ["key account"] : [])] : [...(chance(0.2) ? ["high value home"] : []), ...(chance(0.15) ? ["teen driver"] : [])],
        dob: c.kind === "individual" ? randomDate("1952-01-01", "1996-12-31") : null, drivers_license: c.kind === "individual" ? `NC${digits(9)}` : null,
        fein: c.kind === "business" ? `${digits(2)}-${digits(7)}` : null, preferred_channel: weighted([["email", 6], ["phone", 3], ["sms", 1]]),
        do_not_call: chance(0.03), email_opt_out: chance(0.05), sms_consent_at: chance(0.35) ? ts(randomDate("2025-01-01", "2026-06-30"), 11) : null,
        client_since: c.since, created_at: c.since ? ts(c.since, 10) : ts(START, 9), notes: c.kind === "business" && chance(0.3) ? pick(["Prefers calls before 10am.", "Owner travels often — copy office manager on everything.", "Very price sensitive at renewal.", "Expanding to a second location next year.", "Long-time client, referred three other contractors."]) : null,
      };
    }), "id, code");
  clients.forEach((c, i) => { c.id = clientRows[i].id; c.code = clientRows[i].code; });

  // Contacts
  const contactRows = [];
  for (const c of clients) {
    if (c.kind === "individual") {
      contactRows.push({ client_id: c.id, first_name: c.first, last_name: c.last, email: c.email, phone: phone(c.branch), mobile: phone(c.branch), is_primary: true, is_billing: true, dob: randomDate("1955-01-01", "1995-12-31"), license_number: `NC${digits(9)}` });
      if (c.spouse) contactRows.push({ client_id: c.id, first_name: c.spouse, last_name: c.last, email: `${c.spouse.toLowerCase()}.${c.last.toLowerCase()}@${pick(["gmail.com", "yahoo.com", "outlook.com"])}`, mobile: phone(c.branch), is_primary: false, is_billing: false, dob: randomDate("1955-01-01", "1997-12-31"), license_number: `NC${digits(9)}` });
    } else {
      const owner = [pick(FIRST), pick(LAST)];
      c.owner = owner;
      contactRows.push({ client_id: c.id, first_name: owner[0], last_name: owner[1], title: pick(["Owner", "President", "Managing Member", "CEO", "Pastor"].slice(0, c.ind.key === "nonprofit" ? 5 : 4)), email: `${owner[0][0].toLowerCase()}${owner[1].toLowerCase()}@${c.domain}`, phone: phone(c.branch), mobile: phone(c.branch), is_primary: true, is_billing: false });
      const om = [pick(FIRST), pick(LAST)];
      c.officeContact = om;
      contactRows.push({ client_id: c.id, first_name: om[0], last_name: om[1], title: pick(["Office Manager", "Controller", "Operations Manager", "Bookkeeper"]), email: `${om[0].toLowerCase()}@${c.domain}`, phone: phone(c.branch), is_primary: false, is_billing: true });
    }
  }
  const contactIds = await insertMany("contacts", ["client_id", "first_name", "last_name", "title", "email", "phone", "mobile", "is_primary", "is_billing", "dob", "license_number"], contactRows, "id, client_id, email, first_name, last_name, is_primary");
  for (const c of clients) c.contacts = contactIds.filter((x) => x.client_id === c.id);

  // Insured items
  const items = [];
  for (const c of clients) {
    c.itemIdx = { vehicle: [], driver: [], dwelling: [], location: [], class_code: [], watercraft: [] };
    const push = (kind, label, data) => { c.itemIdx[kind].push(items.length); items.push({ client_id: c.id, kind, label, data: JSON.stringify(data) }); };
    if (c.kind === "individual") {
      const nv = ri(1, 3);
      for (let v = 0; v < nv; v++) { const [mk, md] = pick(VEHICLES); const yr = ri(2012, 2026); push("vehicle", `${yr} ${mk} ${md}`, { year: yr, make: mk, model: md, vin: vin(), use: pick(["Commute", "Pleasure", "Commute"]), garaged_zip: c.a.zip }); }
      push("driver", `${c.first} ${c.last}`, { dob: randomDate("1955-01-01", "1995-12-31"), license_state: c.a.state, years_licensed: ri(8, 45), violations: chance(0.12) ? 1 : 0 });
      if (c.spouse) push("driver", `${c.spouse} ${c.last}`, { dob: randomDate("1955-01-01", "1997-12-31"), license_state: c.a.state, years_licensed: ri(6, 40), violations: 0 });
      if (chance(0.15)) push("driver", `${pick(FIRST)} ${c.last}`, { dob: randomDate("2007-01-01", "2010-06-30"), license_state: c.a.state, years_licensed: ri(0, 2), violations: 0, note: "Youthful operator" });
      push("dwelling", `${c.a.address1}, ${c.a.city}`, { year_built: ri(1965, 2023), construction: pick(["Frame", "Masonry veneer", "Brick"]), roof_year: ri(2008, 2025), sq_ft: ri(1400, 5200), protection_class: ri(2, 5) });
      if (c.lines.includes("WTR")) push("watercraft", `${ri(2010, 2024)} ${pick(["Sea Ray", "Boston Whaler", "Bennington", "Yamaha"])} ${pick(["SPX 210", "Montauk 170", "22 SX", "AR195"])}`, { hull_value: roundTo(ri(18000, 85000), 500), motor_hp: pick([115, 150, 200, 250]) });
    } else {
      const nl = c.employees > 40 ? ri(1, 3) : 1;
      for (let l = 0; l < nl; l++) { const a = l === 0 ? c.a : address(c.branch); push("location", `${a.address1}, ${a.city}`, { occupancy: c.ind.label, building_value: c.lines.includes("PROP") || c.lines.includes("BOP") ? roundTo(ri(250, 2800) * 1000 * Math.min(c.size, 4), 10000) : null, bpp_value: roundTo(ri(40, 600) * 1000 * Math.min(c.size, 3), 5000), sq_ft: ri(1200, 28000), year_built: ri(1972, 2021) }); }
      for (const [code, desc] of c.ind.classes) push("class_code", `${code} — ${desc}`, { code, description: desc, payroll: roundTo(c.employees * ri(38, 62) * 1000, 1000), state: c.a.state });
      if (c.lines.includes("CA")) { const nv = Math.max(1, Math.round(c.employees * (c.ind.key === "trucking" ? 0.9 : 0.4))); for (let v = 0; v < Math.min(nv, 30); v++) { const [mk, md] = pick(COMM_VEHICLES); const yr = ri(2014, 2026); push("vehicle", `${yr} ${mk} ${md}`, { year: yr, make: mk, model: md, vin: vin(), cost_new: roundTo(ri(38, 140) * 1000, 500), radius: c.ind.key === "trucking" ? pick(["Intermediate 51–200 mi", "Long haul 200+ mi"]) : "Local up to 50 mi" }); } }
    }
  }
  const itemIds = await insertMany("insured_items", ["client_id", "kind", "label", "data"], items, "id");
  items.forEach((it, i) => { it.id = itemIds[i].id; });

  // ───────── Policies (term chains)
  const carriersFor = (lob, kind, es) => {
    if (es) return ["ASI", "MES"];
    const map = {
      PA: ["BHI", "SNI", "GRM", "KPI", "TWC"], HO: ["BHI", "SNI", "GRM", "KPI"], DP: ["SNI", "BHI"], UMB: ["BHI", "GRM", "KPI", "SNI"], WTR: ["BHI", "KPI"],
      BOP: ["PFC", "GRM", "EVA"], GL: ["PFC", "ICI", "GRM", "LSI", "CBM"], PROP: ["PFC", "GRM"], CA: ["LSI", "PFC", "GRM", "ICI"], WC: ["CBM", "PFC", "LSI", "GRM", "EVA"],
      CUMB: ["PFC", "ICI", "GRM"], IM: ["ICI", "GRM", "PFC"], CYB: ["EVA", "RUM"], PL: ["EVA", "ASI", "RUM"],
    };
    return map[lob];
  };
  const terms = [];          // every policy row to insert, in chain order
  const groupsFor = (c) => {
    // Commercial package: PROP + GL go on one package policy when both present.
    if (c.kind === "individual") return c.lines.map((l) => [l]);
    const g = [];
    const ls = [...c.lines];
    if (ls.includes("PROP") && ls.includes("GL") && chance(0.7)) { g.push(["PROP", "GL"]); ls.splice(ls.indexOf("PROP"), 1); ls.splice(ls.indexOf("GL"), 1); }
    for (const l of ls) g.push([l]);
    return g;
  };
  const premiumFor = (c, lob) => {
    const f = (INDUSTRY_FACTOR[c.ind?.key] ?? {})[lob] ?? 1;
    const base = BASE[lob] * (c.kind === "business" ? c.size : 1) * f;
    return roundTo(base * (0.7 + rand() * 0.75), 1);
  };
  const policyNumber = (carrier, lob) => `${carrier.code}${pick(["-", ""])}${lob}${pick(["-", ""])}${digits(7)}`;

  for (const c of clients) {
    for (const group of groupsFor(c)) {
      const lob = group[0];
      const es = c.kind === "business" && ((c.ind.es && lob === "GL") || (lob === "CUMB" && c.ind.es)) && chance(0.85);
      let carrier = C[pick(carriersFor(lob, c.kind, es))];
      if (lob === "PL" && carrier.code === "RUM") carrier = C.EVA;
      const base = policyNumber(carrier, lob);
      let premium = group.reduce((s, l) => s + premiumFor(c, l), 0);
      let eff = c.newBiz ? randomDate("2026-01-05", addDays(TODAY, -2)) : randomDate("2025-01-02", "2026-01-01");
      if (c.newBiz && chance(0.5)) eff = randomDate(addDays(TODAY, -95), addDays(TODAY, -3));
      let termNo = c.newBiz ? 1 : ri(2, 9);
      let prior = null;
      let curCarrier = carrier, curBase = base;
      for (let guard = 0; guard < 4; guard++) {
        const exp = addMonths(eff, 12);
        const t = { client: c, group, lob, carrier: curCarrier, wholesaler: curCarrier.admitted === false ? C.CBP : null, es: curCarrier.admitted === false,
          number: `${curBase}-${String(termNo).padStart(2, "0")}`, eff, exp, premium: round2(premium), prior, newRenewal: prior ? (prior.carrier === curCarrier ? "renewal" : "rewrite") : c.newBiz ? "new" : "renewal",
          billMode: curCarrier.bill === "agency" ? "agency" : curCarrier.bill === "both" && chance(0.35) ? "agency" : "direct", status: "active", renewal_stage: "not_started", endorsements: [] };
        t.commission = t.newRenewal === "new" ? curCarrier.cn : curCarrier.cr;
        terms.push(t);
        if (prior) prior.renewal = t;
        if (exp > TODAY) {
          // Current term: in-flight renewal stage if inside 120 days.
          const left = daysBetween(TODAY, exp);
          const leadDays = c.kind === "individual" ? 45 : premium >= 25000 ? 120 : 90;
          if (left <= leadDays) t.renewal_stage = weighted([["not_started", left > leadDays - 10 ? 5 : 1], ["in_review", 6], ["remarketing", 2], ["quoted", 2], ["presented", left < 30 ? 3 : 1]]);
          if (c.newBiz && daysBetween(eff, TODAY) <= 18 && chance(0.45)) { t.status = "bound"; t.binder = `BND-${digits(6)}`; t.binderExpires = addDays(eff, 30); }
          break;
        }
        // Term expired during the history window: renew, rewrite, lose or get non-renewed.
        if (eff < START && exp < START) break;
        const outcome = weighted([["renew", 82], ["rewrite", 8], ["lost", 7], ["nonrenew", 3]]);
        if (outcome === "lost" || outcome === "nonrenew") {
          t.status = outcome === "lost" ? "lost" : "non_renewed";
          t.renewal_stage = outcome === "lost" ? "lost" : "non_renewed";
          t.lostReason = outcome === "lost" ? pick(["Moved to direct writer for price", "Client sold the business", "Went with competing agency", "Sold the home and moved out of state", "Rate increase — shopped elsewhere"]) : pick(["Carrier exited the class", "Loss history", "Roof age outside carrier guidelines"]);
          break;
        }
        t.status = "expired";
        t.renewal_stage = "renewed";
        const change = outcome === "rewrite" ? -0.05 - rand() * 0.12 : Math.max(-0.08, Math.min(0.26, 0.05 + (rand() + rand() + rand() - 1.5) * 0.12));
        if (outcome === "rewrite") {
          const others = carriersFor(lob, c.kind, t.es).filter((x) => x !== curCarrier.code);
          curCarrier = C[pick(others)];
          curBase = policyNumber(curCarrier, lob);
          termNo = 1;
          t.remarket = "Renewal premium increase over threshold — remarketed";
        } else termNo++;
        premium = premium * (1 + change);
        prior = t;
        eff = exp;
      }
    }
  }
  // Mid-term cancellations and pending non-pay
  for (const t of terms) {
    if (t.status === "active" && t.eff < TODAY && chance(0.025)) {
      t.status = "cancelled"; t.cancelDate = randomDate(addDays(t.eff, 20) < TODAY ? addDays(t.eff, 20) : t.eff, addDays(TODAY, -2) > t.eff ? addDays(TODAY, -2) : TODAY);
      t.cancelReason = pick(["Insured request", "Sold property / vehicle", "Rewritten elsewhere", "Out of business"]); t.cancelMethod = "Pro rata";
      t.returnPremium = round2(t.premium * Math.max(0, daysBetween(t.cancelDate, t.exp)) / 365);
    }
  }
  const pendingPool = terms.filter((t) => t.status === "active" && t.eff < addDays(TODAY, -40) && t.exp > addDays(TODAY, 30));
  for (let i = 0; i < 7 && pendingPool.length; i++) {
    const t = pendingPool.splice(ri(0, pendingPool.length - 1), 1)[0];
    t.status = "pending_cancel"; t.cancelDate = addDays(TODAY, ri(2, 13)); t.cancelReason = "Non-payment"; t.cancelMethod = "Pro rata";
  }

  // Insert policies
  const fin = finance.map((f) => f.id);
  const policyRows = await insertMany("policies", ["client_id", "policy_number", "carrier_id", "wholesaler_id", "lob", "business_type", "description", "status", "effective_date", "expiration_date", "term_months", "bill_mode", "premium",
    "commission_pct", "is_admitted", "payment_plan", "finance_company_id", "new_renewal", "producer_id", "account_manager_id", "renewal_stage", "remarket_reason", "cancel_date", "cancel_reason", "cancel_method", "return_premium",
    "binder_number", "binder_expires", "issued_at", "policy_checked_at", "created_at"],
    terms.map((t) => ({
      client_id: t.client.id, policy_number: t.number, carrier_id: t.carrier.id, wholesaler_id: t.wholesaler?.id ?? null, lob: t.lob, business_type: t.client.kind === "individual" ? "personal" : "commercial",
      description: t.group.length > 1 ? "Commercial package — property and general liability" : null, status: t.status, effective_date: t.eff, expiration_date: t.exp, term_months: 12,
      bill_mode: t.billMode, premium: t.premium, commission_pct: t.commission, is_admitted: !t.es, payment_plan: t.client.kind === "business" && t.premium > 15000 && chance(0.4) ? "financed" : pick(["annual", "annual", "monthly EFT", "quarterly"]),
      finance_company_id: null, new_renewal: t.newRenewal, producer_id: t.client.producer.id, account_manager_id: t.client.am.id, renewal_stage: t.renewal_stage, remarket_reason: t.remarket ?? (t.lostReason ?? null),
      cancel_date: t.cancelDate ?? null, cancel_reason: t.cancelReason ?? null, cancel_method: t.cancelMethod ?? null, return_premium: t.returnPremium ?? null,
      binder_number: t.binder ?? null, binder_expires: t.binderExpires ?? null, issued_at: t.status === "bound" ? null : ts(t.eff < START ? t.eff : addDays(t.eff, ri(3, 15)) > TODAY ? TODAY : addDays(t.eff, ri(3, 15)), 11),
      policy_checked_at: t.status === "bound" || (t.eff > addDays(TODAY, -20)) ? null : ts(t.eff < START ? t.eff : addDays(t.eff, ri(5, 25)) > TODAY ? TODAY : addDays(t.eff, ri(5, 25)), 14),
      created_at: ts(t.eff < START ? t.eff : addDays(t.eff, -ri(5, 20)) < START ? START : addDays(t.eff, -ri(5, 20)), 10),
    })), "id");
  terms.forEach((t, i) => { t.id = policyRows[i].id; });
  // Financed policies
  for (const t of terms) if (t.client.kind === "business" && t.premium > 15000 && chance(0.35)) { t.finance = pick(fin); }
  await db.query(`UPDATE policies p SET finance_company_id = v.f FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS f) v WHERE p.id = v.id`,
    [terms.filter((t) => t.finance).map((t) => t.id), terms.filter((t) => t.finance).map((t) => t.finance)]);
  // Link renewal chain
  const chain = terms.filter((t) => t.renewal);
  await db.query(`UPDATE policies p SET renewal_policy_id = v.r FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS r) v WHERE p.id = v.id`, [chain.map((t) => t.id), chain.map((t) => t.renewal.id)]);
  const priors = terms.filter((t) => t.prior);
  await db.query(`UPDATE policies p SET prior_policy_id = v.r FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS r) v WHERE p.id = v.id`, [priors.map((t) => t.id), priors.map((t) => t.prior.id)]);
  // Clients whose only policies are new business are insured now; prospects stay for open opportunities.
  const insuredIds = [...new Set(terms.filter((t) => t.client.newBiz).map((t) => t.client.id))];
  await db.query("UPDATE clients SET status = 'insured', client_since = (SELECT min(effective_date) FROM policies WHERE client_id = clients.id) WHERE id = ANY($1)", [insuredIds]);
  for (const c of clients) if (c.newBiz) c.since = terms.filter((t) => t.client === c).map((t) => t.eff).sort()[0];
  // Clients with every policy lost or cancelled become inactive.
  await db.query(`UPDATE clients SET status = 'inactive', inactive_reason = 'All policies lost or cancelled'
                   WHERE status = 'insured' AND NOT EXISTS (SELECT 1 FROM policies p WHERE p.client_id = clients.id AND p.status IN ('active','bound','pending_cancel'))`);

  // Lines, coverages, items, interests, forms
  const lineRows = [], covRows = [], piRows = [], aiRows = [], formRows = [];
  const cov = (pid, lob, code, description, limit, ded, prem) => covRows.push({ policy_id: pid, lob, code, description, limit_text: limit, deductible_text: ded, premium: prem });
  for (const t of terms) {
    const c = t.client;
    const each = round2(t.premium / t.group.length);
    for (const lob of t.group) {
      lineRows.push({ policy_id: t.id, lob, premium: each });
      const hi = t.premium > 8000 || c.size > 2;
      switch (lob) {
        case "PA": { const bi = pick(["100/300", "250/500", "250/500", "500/500"]); cov(t.id, lob, "BI", "Bodily injury liability", `$${bi}K`, null, round2(each * 0.34)); cov(t.id, lob, "PD", "Property damage liability", pick(["$100,000", "$250,000"]), null, round2(each * 0.18)); cov(t.id, lob, "UM", "Uninsured/underinsured motorist", `$${bi}K`, null, round2(each * 0.08)); cov(t.id, lob, "MED", "Medical payments", "$5,000", null, round2(each * 0.03)); cov(t.id, lob, "COMP", "Comprehensive", "ACV", pick(["$250", "$500", "$1,000"]), round2(each * 0.14)); cov(t.id, lob, "COLL", "Collision", "ACV", pick(["$500", "$1,000"]), round2(each * 0.2)); if (chance(0.6)) cov(t.id, lob, "RENT", "Rental reimbursement", "$40/day, 30 days", null, round2(each * 0.03)); break; }
        case "HO": { const a = roundTo(ri(320, 1250) * 1000, 5000); cov(t.id, lob, "A", "Coverage A — Dwelling", `$${a.toLocaleString()}`, pick(["$1,000", "$2,500", "1% wind/hail"]), null); cov(t.id, lob, "B", "Coverage B — Other structures", `$${Math.round(a * 0.1).toLocaleString()}`, null, null); cov(t.id, lob, "C", "Coverage C — Personal property", `$${Math.round(a * pick([0.5, 0.7])).toLocaleString()}`, null, null); cov(t.id, lob, "D", "Coverage D — Loss of use", `$${Math.round(a * 0.2).toLocaleString()}`, null, null); cov(t.id, lob, "E", "Coverage E — Personal liability", pick(["$300,000", "$500,000"]), null, null); cov(t.id, lob, "F", "Coverage F — Medical payments", "$5,000", null, null); if (chance(0.5)) cov(t.id, lob, "WBU", "Water backup", "$10,000", "$1,000", null); break; }
        case "DP": cov(t.id, lob, "A", "Dwelling", `$${(roundTo(ri(180, 420) * 1000, 5000)).toLocaleString()}`, "$1,000", null); cov(t.id, lob, "L", "Premises liability", "$300,000", null, null); cov(t.id, lob, "FRV", "Fair rental value", "$24,000", null, null); break;
        case "UMB": cov(t.id, lob, "UMB", "Personal umbrella", pick(["$1,000,000", "$1,000,000", "$2,000,000"]), "$0 SIR", null); break;
        case "WTR": cov(t.id, lob, "HULL", "Hull and motor", "Agreed value", "$500", null); cov(t.id, lob, "LIAB", "Watercraft liability", "$300,000", null, null); break;
        case "BOP": cov(t.id, lob, "BLDG", "Building", c.itemIdx.location.length && JSON.parse(items[c.itemIdx.location[0]].data).building_value ? `$${JSON.parse(items[c.itemIdx.location[0]].data).building_value.toLocaleString()}` : "Not covered", "$2,500", null); cov(t.id, lob, "BPP", "Business personal property", `$${roundTo(ri(60, 450) * 1000 * Math.min(c.size, 3), 5000).toLocaleString()}`, "$1,000", null); cov(t.id, lob, "GL", "Liability each occurrence / aggregate", "$1,000,000 / $2,000,000", null, null); cov(t.id, lob, "BI", "Business income", "Actual loss sustained, 12 months", "72 hours", null); if (chance(0.5)) cov(t.id, lob, "EB", "Equipment breakdown", "Included", null, null); break;
        case "GL": cov(t.id, lob, "OCC", "Each occurrence", "$1,000,000", t.es ? "$2,500 BI/PD" : null, round2(each * 0.55)); cov(t.id, lob, "AGG", "General aggregate", "$2,000,000", null, null); cov(t.id, lob, "PCO", "Products-completed operations aggregate", "$2,000,000", null, round2(each * 0.3)); cov(t.id, lob, "PI", "Personal & advertising injury", "$1,000,000", null, null); cov(t.id, lob, "DTP", "Damage to rented premises", "$100,000", null, null); cov(t.id, lob, "MED", "Medical expense", "$5,000", null, null); break;
        case "PROP": cov(t.id, lob, "BLDG", "Building — special form, replacement cost", `$${roundTo(ri(400, 3200) * 1000 * Math.min(c.size, 3), 10000).toLocaleString()}`, pick(["$2,500", "$5,000", "$10,000"]), round2(each * 0.6)); cov(t.id, lob, "BPP", "Business personal property", `$${roundTo(ri(80, 900) * 1000 * Math.min(c.size, 3), 5000).toLocaleString()}`, "$2,500", round2(each * 0.25)); cov(t.id, lob, "BI", "Business income with extra expense", `$${roundTo(ri(100, 900) * 1000, 10000).toLocaleString()}`, "72 hours", round2(each * 0.15)); break;
        case "CA": cov(t.id, lob, "CSL", "Combined single limit (symbol 1)", hi ? "$1,000,000" : pick(["$1,000,000", "$500,000"]), null, round2(each * 0.62)); cov(t.id, lob, "UM", "Uninsured motorist", "$1,000,000", null, round2(each * 0.05)); cov(t.id, lob, "MED", "Medical payments", "$5,000", null, null); cov(t.id, lob, "COMP", "Comprehensive", "ACV", "$1,000", round2(each * 0.12)); cov(t.id, lob, "COLL", "Collision", "ACV", "$1,000", round2(each * 0.18)); cov(t.id, lob, "HNO", "Hired and non-owned auto", "$1,000,000", null, round2(each * 0.03)); break;
        case "WC": cov(t.id, lob, "A", "Part One — Workers compensation", `Statutory — ${c.a.state}`, null, null); cov(t.id, lob, "B", "Part Two — Employers liability", pick(["$500K / $500K / $500K", "$1M / $1M / $1M"]), null, null); break;
        case "CUMB": cov(t.id, lob, "OCC", "Umbrella each occurrence / aggregate", pick(["$1,000,000 / $1,000,000", "$2,000,000 / $2,000,000", "$5,000,000 / $5,000,000"]), "$10,000 SIR", null); break;
        case "IM": cov(t.id, lob, "CEQ", c.ind?.key === "trucking" ? "Motor truck cargo" : "Contractors equipment — scheduled", `$${roundTo(ri(25, 400) * 1000, 5000).toLocaleString()}`, "$1,000", null); break;
        case "CYB": cov(t.id, lob, "AGG", "Cyber liability aggregate", pick(["$1,000,000", "$2,000,000"]), pick(["$2,500", "$5,000", "$10,000"]), null); cov(t.id, lob, "BI", "Business interruption", "$250,000", "12 hours", null); cov(t.id, lob, "SOC", "Social engineering", "$100,000", "$5,000", null); break;
        case "PL": cov(t.id, lob, "PL", "Professional liability each claim / aggregate", "$1,000,000 / $2,000,000", pick(["$5,000", "$10,000"]), null); break;
      }
    }
    // schedules
    const link = (kind) => c.itemIdx[kind].forEach((ix) => piRows.push({ policy_id: t.id, item_id: items[ix].id }));
    if (t.lob === "PA") { link("vehicle"); link("driver"); }
    if (["HO", "DP"].includes(t.lob)) link("dwelling");
    if (t.lob === "WTR") link("watercraft");
    if (t.lob === "CA") link("vehicle");
    if (["WC", "GL"].includes(t.lob)) link("class_code");
    if (["PROP", "BOP", "GL"].includes(t.lob)) link("location");
    if (t.lob === "HO" && chance(0.82)) aiRows.push({ policy_id: t.id, interest_id: pick(mortgagees).id, role: "Mortgagee", loan_number: digits(10) });
    if (t.lob === "PA" && chance(0.3)) aiRows.push({ policy_id: t.id, interest_id: pick(lienholders).id, role: "Lienholder", loan_number: digits(9) });
    if (t.lob === "IM" && chance(0.4)) aiRows.push({ policy_id: t.id, interest_id: holderRows.find((h) => h.kind === "loss_payee").id, role: "Loss payee", loan_number: null });
    const FORMS = { GL: [["CG 00 01", "04 13", "Commercial general liability coverage form"], ["CG 20 10", "12 19", "Additional insured — owners, lessees or contractors"], ["CG 24 04", "12 19", "Waiver of transfer of rights of recovery"]], BOP: [["BP 00 03", "07 13", "Businessowners coverage form"]], HO: [["HO 00 03", "05 11", "Homeowners 3 — special form"]], PA: [["PP 00 01", "09 18", "Personal auto policy"]], CA: [["CA 00 01", "11 20", "Business auto coverage form"], ["CA 20 48", "11 16", "Designated insured"]], WC: [["WC 00 00 00", "C", "Workers compensation and employers liability policy"], ["WC 00 03 13", "", "Waiver of our right to recover from others"]], PROP: [["CP 00 10", "10 12", "Building and personal property coverage form"], ["CP 10 30", "09 17", "Causes of loss — special form"]] };
    for (const [num, ed, desc] of FORMS[t.lob] ?? []) formRows.push({ policy_id: t.id, form_number: num, edition: ed, description: desc });
    if (t.lob === "GL" && chance(0.5)) formRows.push({ policy_id: t.id, form_number: "CG 20 01", edition: "12 19", description: "Primary and noncontributory — other insurance condition" });
  }
  await insertMany("policy_lines", ["policy_id", "lob", "premium"], lineRows, null);
  await insertMany("coverages", ["policy_id", "lob", "code", "description", "limit_text", "deductible_text", "premium"], covRows, null);
  await insertMany("policy_items", ["policy_id", "item_id"], piRows, null);
  await insertMany("additional_interests", ["policy_id", "interest_id", "role", "loan_number"], aiRows, null);
  await insertMany("policy_forms", ["policy_id", "form_number", "edition", "description"], formRows, null);

  // ───────── Activities, emails, notes, audit (history)
  const codes = Object.fromEntries((await db.query("SELECT * FROM activity_codes")).rows.map((r) => [r.code, r]));
  const acts = [], emails = [], notes = [], audits = [], docs = [], txRows = [], certs = [], certPolicies = [], claims = [];
  const actor = (u) => u?.username ?? "automation";
  const contactOf = (c) => c.contacts.find((x) => x.is_primary) ?? c.contacts[0];
  const termsByClient = new Map();
  for (const t of terms) { if (!termsByClient.has(t.client.id)) termsByClient.set(t.client.id, []); termsByClient.get(t.client.id).push(t); }
  const activeTerm = (c, date, lobs) => (termsByClient.get(c.id) ?? []).filter((t) => t.eff <= date && t.exp > date && (!t.cancelDate || t.cancelDate > date) && t.status !== "bound" && (!lobs || lobs.includes(t.lob)));

  function addActivity(a) {
    const code = codes[a.code];
    const done = a.status === "done";
    const checklist = (code.checklist ?? []).map((label) => ({ label, done: done || (a.status !== "open" ? chance(0.5) : chance(0.2)) }));
    const row = { code: a.code, subject: a.subject.slice(0, 160), description: a.description ?? null, status: a.status, priority: a.priority ?? code.default_priority, owner_id: a.owner?.id ?? null,
      created_by_id: a.createdBy?.id ?? (a.source === "manual" ? a.owner?.id : null) ?? null, client_id: a.client?.id ?? null, policy_id: a.term?.id ?? null, claim_id: a.claimIdx != null ? { ref: a.claimIdx } : null,
      certificate_id: null, opportunity_id: a.oppIdx != null ? { ref: a.oppIdx } : null, email_id: null, due_date: a.due, snoozed_until: a.snoozed ?? null, waiting_on: a.waitingOn ?? null, follow_up_date: a.followUp ?? null,
      source: a.source, checklist: JSON.stringify(checklist), outcome: a.outcome ?? null, completed_at: a.completedAt ?? null, completed_by_id: done ? a.owner?.id : null, auto_key: a.autoKey ?? null,
      created_at: a.createdAt, updated_at: a.completedAt ?? a.createdAt, _email: a.email ?? null };
    acts.push(row);
    audits.push({ occurred_at: a.createdAt, actor: a.source === "email" ? "email-intake" : a.source === "automation" ? "automation" : a.source === "system" ? actor(a.createdBy ?? a.owner) : actor(a.owner), action: "activity.created", entity_type: "activity", entity_id: { act: acts.length - 1 }, summary: `${code.label}: ${row.subject}` });
    if (done) audits.push({ occurred_at: a.completedAt, actor: actor(a.owner), action: "activity.completed", entity_type: "activity", entity_id: { act: acts.length - 1 }, summary: `Completed "${row.subject}"` });
    if (a.note) notes.push({ act: acts.length - 1, client_id: a.client?.id ?? null, author_id: a.owner?.id, kind: a.noteKind ?? "note", body: a.note, created_at: a.completedAt ?? a.createdAt });
    if (a.outcome && done) notes.push({ act: acts.length - 1, client_id: a.client?.id ?? null, author_id: a.owner?.id, kind: "note", body: `Completed: ${a.outcome}`, created_at: a.completedAt });
    return acts.length - 1;
  }

  // Email templates (client side) and outcome text per code.
  const greet = (c) => (c.kind === "individual" ? `Hi ${c.am.full_name.split(" ")[0]},` : pick([`Hi ${c.am.full_name.split(" ")[0]},`, "Good morning,", "Hello,"]));
  const sign = (c, ct) => `\n\nThanks,\n${ct.first_name} ${ct.last_name}${c.kind === "business" ? `\n${c.name}` : ""}`;
  const holderName = () => pick(certHolders).name;
  function emailFor(code, c, t, date) {
    const ct = contactOf(c);
    const num = t?.number ?? "";
    const veh = c.itemIdx.vehicle.length ? items[c.itemIdx.vehicle[0]].label : "the truck";
    const T = {
      "CERT-REQ": () => { const h = holderName(); const job = pick(["the renovation at their Glenwood Ave building", "a new subdivision job in Holly Springs", "the tenant upfit on Tryon St", "ongoing service work", "the parking deck project"]); return [`COI request — ${h}`, `${greet(c)}\n\nCan you send a certificate of insurance to ${h} for ${job}? They need to be listed as additional insured with waiver of subrogation${chance(0.5) ? ", primary and non-contributory" : ""}.${chance(0.4) ? " We can't start on site until they have it — today if at all possible." : ""}${sign(c, ct)}`]; },
      "END-REQ": () => c.kind === "individual" ? pick([[`Adding a car`, `${greet(c)}\n\nWe just bought a ${pick(VEHICLES).join(" ")} and need it added to our auto policy ${num}. VIN is ${vin()}. Can you let me know the new premium?${sign(c, ct)}`], [`Address change`, `${greet(c)}\n\nWe moved! New address is ${address(c.branch).address1}. Please update our policies.${sign(c, ct)}`], [`Remove vehicle`, `${greet(c)}\n\nWe sold the ${veh} last weekend — please remove it from the policy.${sign(c, ct)}`], [`Add my son as a driver`, `${greet(c)}\n\nOur son just got his license. What do we need to do to add him to the auto policy?${sign(c, ct)}`]])
        : pick([[`Add vehicle to fleet`, `${greet(c)}\n\nWe picked up a new ${pick(COMM_VEHICLES).join(" ")} — please add it to policy ${num}. VIN ${vin()}, cost new about $${ri(45, 95)},000.${sign(c, ct)}`], [`New location`, `${greet(c)}\n\nWe signed a lease for a second shop at ${address(c.branch).address1}. Effective next month. What do you need from us?${sign(c, ct)}`], [`Increase umbrella limit`, `${greet(c)}\n\nA new GC contract requires $5M umbrella. Can you quote increasing our umbrella?${sign(c, ct)}`], [`Remove driver`, `${greet(c)}\n\n${pick(FIRST)} ${pick(LAST)} is no longer with us as of Friday; please remove him from the driver list.${sign(c, ct)}`]]),
      "ID-CARD": () => [`Need new insurance cards`, `${greet(c)}\n\nCan you email me updated ID cards for our cars? The ones in the glovebox are expired.${sign(c, ct)}`],
      "BILL-INQ": () => pick([[`Question about my bill`, `${greet(c)}\n\nI got a bill from ${t?.carrier.name ?? "the insurance company"} that's higher than last time. Can you tell me why?${sign(c, ct)}`], [`Payment`, `${greet(c)}\n\nHow do I set up autopay for policy ${num}?${sign(c, ct)}`], [`Invoice ${digits(6)}`, `${greet(c)}\n\nWe received an invoice we think we already paid. Can you check?${sign(c, ct)}`]]),
      "DOC-REQ": () => [`Copy of declarations page`, `${greet(c)}\n\nOur ${c.kind === "individual" ? "mortgage company" : "lender"} is asking for a copy of the declarations page for ${num}. Could you send it over?${sign(c, ct)}`],
      "LOSS-RUN": () => [`Loss runs`, `${greet(c)}\n\nWe're getting quotes on a bonding line and they want 5 years of loss runs. Can you request those?${sign(c, ct)}`],
      "AUDIT": () => [`Audit notice from ${t?.carrier.name ?? "carrier"}`, `${greet(c)}\n\nWe got an audit request in the mail for policy ${num}. What do they need from us?${sign(c, ct)}`],
      "CLAIM-FNOL": () => c.kind === "individual" ? pick([[`Accident this morning`, `${greet(c)}\n\nI was rear-ended at a light on Glenwood this morning. Nobody hurt but the back of the ${veh} is crunched. Other driver has ${pick(["Progressive", "State Farm", "GEICO"])}. What do I do?${sign(c, ct)}`], [`Water leak`, `${greet(c)}\n\nWe came home to water all over the kitchen floor — the line to the fridge burst. Restoration company is on the way. How do I file a claim?${sign(c, ct)}`], [`Hail damage`, `${greet(c)}\n\nThat storm last night dented the car and the roofer says we have damage too.${sign(c, ct)}`]])
        : pick([[`Employee injury`, `${greet(c)}\n\nOne of our techs cut his hand pretty badly on a job today and went to urgent care. What do we need to report?${sign(c, ct)}`], [`Truck accident`, `${greet(c)}\n\nOur ${veh} backed into a customer's garage door this afternoon. Customer is upset. How do we handle?${sign(c, ct)}`], [`Customer says we damaged their property`, `${greet(c)}\n\nA homeowner says our crew caused water damage to their ceiling. They're threatening to sue.${sign(c, ct)}`]]),
      "CANC-REQ": () => [`Cancel policy`, `${greet(c)}\n\nWe've ${c.kind === "individual" ? "sold the house" : "closed the second location"} and need to cancel ${num} effective the end of the month.${sign(c, ct)}`],
      "INSPECT": () => [`Inspection recommendations`, `${greet(c)}\n\nThe inspector from ${t?.carrier.name ?? "the carrier"} left a list of recommendations. Attaching it. What's the deadline?${sign(c, ct)}`],
      "QUOTE": () => [`Quote request`, `${greet(c)}\n\nWe're thinking about adding cyber coverage. Can you get us a quote?${sign(c, ct)}`],
      "REN-REVIEW": () => [`Renewal ${num}`, `${greet(c)}\n\nOur renewal paperwork came in and the premium went up quite a bit. Can we talk about options?${sign(c, ct)}`],
      "CALL": () => [`Please call me`, `${greet(c)}\n\nCan you give me a call when you have a minute? Question about our coverage.${sign(c, ct)}`],
      "FOLLOW-UP": () => [`Following up`, `${greet(c)}\n\nJust following up on my email from last week.${sign(c, ct)}`],
    };
    const [subject, body] = (T[code] ?? T.CALL)();
    return { subject, body, from: ct.email, fromName: `${ct.first_name} ${ct.last_name}`, date };
  }
  const OUTCOMES = {
    "CERT-REQ": ["Certificate issued and emailed to holder", "Issued COI; AI and waiver endorsements confirmed on policy", "Sent certificate; holder confirmed receipt"],
    "END-REQ": ["Endorsement submitted to carrier; confirmation sent to insured", "Change processed; new dec page sent", "Carrier issued endorsement; premium change billed"],
    "ID-CARD": ["ID cards emailed", "Sent ID cards via email and text"], "BILL-INQ": ["Explained rate change from renewal; insured satisfied", "Set up autopay with carrier", "Confirmed payment received by carrier"],
    "DOC-REQ": ["Dec page sent", "Sent policy copy to lender"], "LOSS-RUN": ["Requested from carrier; received and forwarded", "Loss runs sent to client"], "AUDIT": ["Sent auditor contact; audit scheduled", "Audit complete — small return premium"],
    "CLAIM-FNOL": ["Reported to carrier; claim # sent to insured", "Claim reported online; adjuster assigned"], "CLAIM-FU": ["Spoke with adjuster; estimate approved", "Updated insured on status"], "CANC-REQ": ["Cancellation submitted; return premium to insured", "Signed request received and processed"],
    "INSPECT": ["Recommendations sent to insured; proof submitted to carrier"], "QUOTE": ["Quote presented", "Submitted to markets"], "REN-REVIEW": ["Reviewed — renew as is", "Remarket recommended; client agreed", "Renewal reviewed with client by phone"],
    "REN-PROC": ["Renewal processed; ID cards and certificates reissued", "Renewal confirmed and billed"], "NB-SETUP": ["Policy entered, billing set up, welcome email sent"], "POL-CHECK": ["Policy checked — no discrepancies", "Policy checked — requested correction to mailing address", "Policy checked — missing AI endorsement requested"],
    "CALL": ["Returned call — answered coverage question", "Left voicemail, then spoke with insured"], "FOLLOW-UP": ["Followed up — resolved", "Followed up; waiting on documents"], "ACCT-REVIEW": ["Annual review done; recommended umbrella", "Reviewed exposures; no changes"],
    "LEAD": ["Contacted; created opportunity", "Qualified — scheduled meeting"], "PAY-POST": ["Receipt posted and applied"], "NONPAY": ["Insured paid by phone; carrier confirmed", "Payment link sent; paid same day"], "UW-CANC": ["Notified insured; remarketing started"], "EMAIL-IN": ["Reviewed; no action needed", "Replied to sender"],
  };
  const outcome = (code) => pick(OUTCOMES[code] ?? ["Done"]);

  // Code mix per role and book.
  const COMMERCIAL_MIX = [["CERT-REQ", 26], ["END-REQ", 16], ["BILL-INQ", 7], ["DOC-REQ", 6], ["CALL", 9], ["FOLLOW-UP", 9], ["LOSS-RUN", 4], ["AUDIT", 4], ["INSPECT", 2], ["CLAIM-FNOL", 0.6], ["ACCT-REVIEW", 2], ["QUOTE", 2], ["CANC-REQ", 1]];
  const PERSONAL_MIX = [["END-REQ", 24], ["ID-CARD", 13], ["BILL-INQ", 13], ["DOC-REQ", 10], ["CALL", 13], ["FOLLOW-UP", 10], ["CLAIM-FNOL", 0.9], ["ACCT-REVIEW", 2], ["CANC-REQ", 2], ["QUOTE", 2]];
  const booksBy = (pred) => clients.filter(pred);
  const workers = [
    { u: U.mrivera, book: booksBy((c) => c.am === U.mrivera), mix: COMMERCIAL_MIX, perDay: [7, 12] },
    { u: U.jbrooks, book: booksBy((c) => c.am === U.jbrooks), mix: COMMERCIAL_MIX, perDay: [6, 11] },
    { u: U.apatel, book: booksBy((c) => c.am === U.apatel), mix: PERSONAL_MIX, perDay: [7, 12] },
    { u: U.tnguyen, book: booksBy((c) => c.am === U.tnguyen), mix: PERSONAL_MIX, perDay: [6, 11] },
    { u: U.kowens, book: booksBy((c) => c.csr === U.kowens), mix: [["ID-CARD", 14], ["CERT-REQ", 14], ["DOC-REQ", 14], ["BILL-INQ", 16], ["CALL", 16], ["END-REQ", 12], ["FOLLOW-UP", 8]], perDay: [6, 10] },
    { u: U.dharris, book: booksBy((c) => c.csr === U.dharris), mix: [["ID-CARD", 14], ["CERT-REQ", 14], ["DOC-REQ", 14], ["BILL-INQ", 16], ["CALL", 16], ["END-REQ", 12], ["FOLLOW-UP", 8]], perDay: [5, 9] },
    { u: U.rcallahan, book: booksBy((c) => c.producer === U.rcallahan), mix: [["ACCT-REVIEW", 4], ["CALL", 5], ["FOLLOW-UP", 4], ["QUOTE", 3]], perDay: [1, 3] },
    { u: U.bwhitaker, book: booksBy((c) => c.producer === U.bwhitaker), mix: [["ACCT-REVIEW", 4], ["CALL", 5], ["FOLLOW-UP", 4], ["QUOTE", 3]], perDay: [1, 3] },
    { u: U.sfoster, book: booksBy((c) => c.producer === U.sfoster), mix: [["ACCT-REVIEW", 3], ["CALL", 5], ["FOLLOW-UP", 4], ["QUOTE", 3]], perDay: [1, 3] },
  ];
  const EMAIL_CODES = new Set(["CERT-REQ", "END-REQ", "ID-CARD", "BILL-INQ", "DOC-REQ", "LOSS-RUN", "AUDIT", "CLAIM-FNOL", "CANC-REQ", "INSPECT", "QUOTE", "CALL", "FOLLOW-UP"]);
  const holdersUsed = new Map();

  function serviceEvent(w, day, status) {
    const code = weighted(w.mix);
    const c = pick(w.book);
    if (!c) return;
    const lobsFor = { "CERT-REQ": ["GL", "PROP", "BOP", "CA", "WC", "CUMB"], "ID-CARD": ["PA"], "AUDIT": ["WC", "GL"], "END-REQ": null };
    if (code === "CERT-REQ" && c.kind !== "business") return;
    const t = pick(activeTerm(c, day, lobsFor[code] ?? null)) ?? null;
    if ((code === "ID-CARD" || code === "AUDIT" || code === "CERT-REQ") && !t) return;
    if (c.since && c.since > day) return;
    const createdAt = workTs(day);
    const fromEmail = EMAIL_CODES.has(code) && chance(code === "CALL" ? 0.25 : 0.65);
    let email = null;
    if (fromEmail) {
      const e = emailFor(code, c, t, createdAt);
      const forwarded = chance(0.35);
      email = forwarded
        ? { ...e, from_addr: w.u.email ?? `${w.u.username}@siryousagency.example`, from_name: w.u.full_name, original_from_addr: e.from, original_from_name: e.fromName, subject: `Fwd: ${e.subject}`,
            body_text: `${pick(["Please handle", "Can you take care of this?", "FYI — new request", ""])}\n\n---------- Forwarded message ---------\nFrom: ${e.fromName} <${e.from}>\nSubject: ${e.subject}\nTo: ${w.u.full_name} <${w.u.username}@siryousagency.example>\n\n${e.body}`, to: [`${w.u.username}@amsinbox.siryous.app`], forwarded: true }
        : { ...e, from_addr: e.from, from_name: e.fromName, original_from_addr: null, original_from_name: null, body_text: e.body, to: [chance(0.5) ? `service@amsinbox.siryous.app` : `${w.u.username}@amsinbox.siryous.app`], forwarded: false };
    }
    const subject = { "CERT-REQ": `Issue certificate for ${c.name}`, "END-REQ": `Process policy change for ${c.name}`, "ID-CARD": `Send auto ID cards for ${c.name}`, "BILL-INQ": `Answer billing question for ${c.name}`, "DOC-REQ": `Send requested document for ${c.name}`,
      "LOSS-RUN": `Request loss runs for ${c.name}`, "AUDIT": `Handle premium audit for ${c.name}`, "CLAIM-FNOL": `Report claim for ${c.name}`, "CANC-REQ": `Process cancellation request for ${c.name}`, "INSPECT": `Handle inspection recommendations for ${c.name}`,
      "QUOTE": `Prepare quote for ${c.name}`, "CALL": `Call back ${contactOf(c).first_name} ${contactOf(c).last_name} (${c.name})`, "FOLLOW-UP": `Follow up with ${c.name}`, "ACCT-REVIEW": `Annual account review: ${c.name}` }[code] ?? `${codes[code].label}: ${c.name}`;
    const urgent = email && /today|can't start|asap/i.test(email.body_text ?? "");
    const lag = status === "done" ? weighted([[0, 62], [1, 20], [2, 9], [3, 6], [5, 3]]) : 0;
    const doneDay = bizAdd(day, lag) > TODAY ? TODAY : bizAdd(day, lag);
    const due = addDays(day, codes[code].default_due_days);
    const a = {
      code, subject, description: email ? email.body_text.split("\n").filter((l) => l.trim() && !/^(Hi|Hello|Good morning|Thanks)/.test(l)).slice(0, 2).join(" ").slice(0, 300) : null,
      status, priority: urgent ? "urgent" : undefined, owner: w.u, client: c, term: t, due: status === "done" ? due : due, source: email ? "email" : "manual", createdAt,
      completedAt: status === "done" ? (lag === 0 ? ts(day, Math.min(17, Number(createdAt.slice(11, 13)) + ri(0, 3)), ri(0, 59)) : workTs(doneDay)) : null,
      outcome: status === "done" ? outcome(code) : null, email,
      note: status === "done" && chance(0.25) ? pick(["Spoke with insured.", "Carrier confirmed by phone.", "Sent confirmation email.", "Insured asked about umbrella — follow up at renewal.", "Left voicemail first, insured called back."]) : null,
    };
    const ix = addActivity(a);
    // Side effects that make the history coherent.
    if (code === "CERT-REQ" && status === "done" && t) {
      const h = pick(certHolders);
      const key = `${c.id}:${h.id}`;
      const prev = holdersUsed.get(key);
      const issuedAt = acts[ix].completed_at;
      const certIx = certs.push({ client: c, holder_id: h.id, status: "issued", description_of_operations: pick(["All operations of the named insured.", "Work performed for the certificate holder at job sites in North Carolina.", "Re: Master service agreement — all work performed by the insured."]),
        additional_insured: true, waiver_of_subrogation: chance(0.75), primary_noncontributory: chance(0.45), issued_at: issuedAt, issued_by_id: w.u.id, delivered_to: h.name, delivered_at: issuedAt, created_at: issuedAt, act: ix, prev }) - 1;
      if (prev != null) certs[prev].status = "superseded";
      holdersUsed.set(key, certIx);
      for (const tt of activeTerm(c, day, ["GL", "CA", "WC", "CUMB", "PROP", "BOP"])) certPolicies.push({ cert: certIx, policy_id: tt.id });
    }
    if (code === "END-REQ" && status === "done" && t && chance(0.75)) {
      const change = c.kind === "individual" ? pick([0, 0, ri(180, 720), -ri(120, 480)]) : pick([0, ri(400, 2800), ri(250, 1200), -ri(200, 900)]);
      t.endorsements.push({ date: doneDay, change, desc: email?.subject.replace(/^Fwd: /, "") ?? "Policy change", ix });
    }
    if (code === "CLAIM-FNOL" && t) {
      const cl = { client: c, term: t, loss_date: addDays(day, -ri(0, 3)), reported_date: day, kind: c.kind === "individual" ? (t.lob === "PA" ? pick(["Auto — collision", "Auto — comprehensive"]) : pick(["Property — water", "Property — wind/hail", "Property — theft"])) : pick(["Workers compensation — injury", "General liability — property damage", "Commercial auto — collision"]),
        description: email?.body_text.split("\n").slice(2, 4).join(" ").slice(0, 280) || "Loss reported by insured.", status: "open", act: ix, owner: w.u };
      claims.push(cl);
      a.claimIdx = claims.length - 1;
      acts[ix].claim_id = { ref: claims.length - 1 };
    }
  }

  // Completed history: every business day before today.
  for (const day of BIZ_DAYS) {
    if (day === TODAY) continue;
    for (const w of workers) {
      const n = ri(w.perDay[0], w.perDay[1]) - (dow(day) === 5 ? 1 : 0);
      for (let k = 0; k < n; k++) serviceEvent(w, day, "done");
    }
  }
  // Today's queue per person: overdue, due today, upcoming, waiting, snoozed.
  for (const w of workers) {
    const open = w.u.role === "producer" ? ri(6, 10) : ri(22, 34);
    for (let k = 0; k < open; k++) {
      const day = weighted([[TODAY, 4], [addDays(TODAY, -1), 3], [bizAdd(addDays(TODAY, -6), ri(0, 3)), 3]]);
      const before = acts.length;
      serviceEvent(w, day > TODAY ? TODAY : day, "open");
      if (acts.length === before) continue;
      const a = acts[acts.length - 1];
      const roll = rand();
      if (roll < 0.22) a.due_date = bizAdd(addDays(TODAY, -ri(3, 8)), ri(0, 2)) < TODAY ? bizAdd(addDays(TODAY, -ri(3, 8)), ri(0, 2)) : addDays(TODAY, -1);
      else if (roll < 0.5) a.due_date = TODAY;
      else if (roll < 0.8) a.due_date = bizAdd(TODAY, ri(1, 6));
      else if (roll < 0.92) { a.status = "waiting"; a.waiting_on = pick(["carrier", "client", "carrier", "internal"]); a.follow_up_date = pick([TODAY, addDays(TODAY, -1), bizAdd(TODAY, ri(1, 5))]); a.due_date = addDays(TODAY, -ri(1, 6)); notes.push({ act: acts.length - 1, client_id: a.client_id, author_id: w.u.id, kind: "system", body: `Waiting on ${a.waiting_on} — follow up ${a.follow_up_date}`, created_at: ts(addDays(TODAY, -ri(1, 4)), 15) }); }
      else { a.snoozed_until = bizAdd(TODAY, ri(1, 4)); a.due_date = TODAY; }
    }
  }

  // Leadership and back-office work.
  const anyClient = () => pick(clients.filter((c) => c.kind === "business" && !c.newBiz));
  const officeTasks = [
    [U.choll, "ACCT-REVIEW", "Stewardship meeting prep: top 10 commercial accounts", TODAY, "high"],
    [U.choll, "FOLLOW-UP", "Carrier review meeting with Piedmont Fire & Casualty — bring loss ratio and growth numbers", bizAdd(TODAY, 2), "normal"],
    [U.choll, "FOLLOW-UP", "Approve Ryan Callahan's October producer statement", addDays(TODAY, -1), "high"],
    [U.choll, "FOLLOW-UP", "E&O renewal application due to carrier", bizAdd(TODAY, 5), "normal"],
    [U.choll, "CALL", "Call back key account about rate increase on umbrella", TODAY, "high", true],
    [U.lmorgan, "FOLLOW-UP", "Month-end close: reconcile October direct bill statements", bizAdd(TODAY, 3), "high"],
    [U.lmorgan, "PAY-POST", "Post lockbox deposit from Friday", TODAY, "normal"],
    [U.lmorgan, "FOLLOW-UP", "Trust account bank reconciliation — October", bizAdd(TODAY, 4), "normal"],
    [U.lmorgan, "BILL-INQ", "Research duplicate payment refund request", addDays(TODAY, -2), "high", true],
    [U.admin, "FOLLOW-UP", "Set up logins for the new CSR starting Monday", bizAdd(TODAY, 1), "normal"],
    [U.admin, "FOLLOW-UP", "Quarterly access review: confirm every active user still needs their role", bizAdd(TODAY, 6), "low"],
  ];
  for (const [owner, code, subject, due, priority, withClient] of officeTasks) {
    addActivity({ code, subject, status: "open", priority, owner, client: withClient ? anyClient() : null, due, source: "manual", createdAt: workTs(addDays(TODAY, -ri(1, 5))) });
  }

  // Claims lifecycle: follow-ups and closure.
  const CLAIM_PREFIX = "CLM";
  const claimRows = claims.map((cl, i) => {
    const age = daysBetween(cl.reported_date, TODAY);
    const closed = age > 25 && chance(Math.min(0.92, age / 70));
    cl.closed = closed;
    cl.closedAt = closed ? ts(addDays(cl.reported_date, ri(18, Math.max(19, Math.min(age - 1, 90)))), 15) : null;
    const carrierNo = `${cl.term.carrier.code}${digits(8)}`;
    // weekly-ish follow-ups while open
    let d = bizAdd(cl.reported_date, ri(5, 9));
    const end = closed ? cl.closedAt.slice(0, 10) : TODAY;
    while (d < end) {
      addActivity({ code: "CLAIM-FU", subject: `Claim ${carrierNo} status check: ${cl.client.name}`, status: "done", owner: cl.owner, client: cl.client, term: cl.term, due: d, source: "manual", createdAt: workTs(d), completedAt: workTs(d), outcome: outcome("CLAIM-FU"), claimIdx: i });
      d = bizAdd(d, ri(6, 14));
    }
    return { claim_number: `${CLAIM_PREFIX}-26-${String(i + 1).padStart(4, "0")}`, client_id: cl.client.id, policy_id: cl.term.id, carrier_claim_number: carrierNo, loss_date: cl.loss_date, reported_date: cl.reported_date, kind: cl.kind, description: cl.description,
      location: cl.client.a.city, claimant: cl.kind.includes("liability") || cl.kind.includes("property damage") ? `${pick(FIRST)} ${pick(LAST)}` : null, status: closed ? "closed" : "open",
      adjuster_name: `${pick(FIRST)} ${pick(LAST)}`, adjuster_phone: `(800) 555-${String(ri(1000, 9999))}`, adjuster_email: `claims${ri(10, 99)}@${DOMAINS[cl.term.carrier.code]}`, submitted_to_carrier_at: ts(cl.reported_date, 14), closed_at: cl.closedAt, created_by_id: cl.owner.id, created_at: ts(cl.reported_date, 10) };
  });
  // Today: two fresh claims as urgent tasks.
  const claimIds = await insertMany("claims", ["claim_number", "client_id", "policy_id", "carrier_claim_number", "loss_date", "reported_date", "kind", "description", "location", "claimant", "status", "adjuster_name", "adjuster_phone", "adjuster_email", "submitted_to_carrier_at", "closed_at", "created_by_id", "created_at"], claimRows, "id");

  // Renewal work on terms inside the history window and on in-flight renewals.
  for (const t of terms) {
    const c = t.client;
    const lead = c.kind === "individual" ? 45 : t.premium >= 25000 ? 120 : 90;
    const kick = addDays(t.exp, -lead);
    if (t.exp < START || kick > TODAY) continue;
    const owner = c.am;
    const kickDay = nextBiz(kick < START ? START : kick);
    if (t.renewal_stage === "renewed" || t.renewal_stage === "lost" || t.renewal_stage === "non_renewed") {
      addActivity({ code: "REN-REVIEW", subject: `Renewal review: ${c.name} ${t.lob} ${t.number}`, status: "done", owner, client: c, term: t, due: addDays(kickDay, 5), source: "automation", autoKey: `ren-review:${t.id}`, createdAt: ts(kickDay, 7, 5),
        completedAt: workTs(bizAdd(kickDay, ri(2, 12)) > TODAY ? TODAY : bizAdd(kickDay, ri(2, 12))), outcome: t.remarket ? "Remarket recommended; client agreed" : t.renewal_stage === "renewed" ? outcome("REN-REVIEW") : "Client will not renew", note: t.lostReason ? `Lost: ${t.lostReason}` : null });
      if (t.remarket) addActivity({ code: "REN-REMKT", subject: `Remarket ${c.name} ${t.lob} — renewal up ${ri(11, 24)}%`, status: "done", owner, client: c, term: t, due: addDays(kickDay, 15), source: "manual", createdAt: workTs(bizAdd(kickDay, 3)), completedAt: workTs(bizAdd(kickDay, ri(10, 25)) > TODAY ? TODAY : bizAdd(kickDay, ri(10, 25))), outcome: `Moved to ${t.renewal?.carrier.name ?? "new carrier"} — saved ${ri(6, 17)}%` });
      if (t.renewal_stage === "renewed") {
        const procDay = addDays(t.exp, -ri(3, 20)) > TODAY ? TODAY : addDays(t.exp, -ri(3, 20));
        addActivity({ code: "REN-PROC", subject: `Process renewal ${t.renewal?.number ?? t.number} for ${c.name}`, status: "done", owner, client: c, term: t.renewal ?? t, due: procDay, source: "system", createdBy: owner, createdAt: workTs(nextBiz(procDay) > TODAY ? TODAY : nextBiz(procDay)), completedAt: workTs(nextBiz(procDay) > TODAY ? TODAY : nextBiz(procDay)), outcome: outcome("REN-PROC") });
      }
    } else if (t.status === "active" || t.status === "pending_cancel") {
      const stage = t.renewal_stage;
      if (stage === "not_started") continue; // automation picks these up on the first run
      const reviewDone = stage !== "in_review";
      addActivity({ code: "REN-REVIEW", subject: `Renewal review: ${c.name} ${t.lob} ${t.number}`, status: reviewDone ? "done" : "open", owner, client: c, term: t, due: reviewDone ? addDays(kickDay, 5) : weighted([[addDays(TODAY, -ri(1, 4)), 2], [TODAY, 3], [bizAdd(TODAY, ri(1, 8)), 6]]), source: "automation", autoKey: `ren-review:${t.id}`, createdAt: ts(kickDay, 7, 5),
        completedAt: reviewDone ? workTs(bizAdd(kickDay, ri(2, 6)) > TODAY ? TODAY : bizAdd(kickDay, ri(2, 6))) : null, outcome: reviewDone ? (stage === "remarketing" ? "Remarket recommended; client agreed" : "Renewal reviewed with client by phone") : null });
      if (stage === "remarketing") addActivity({ code: "REN-REMKT", subject: `Remarket ${c.name} ${t.lob} — renewal indication up ${ri(11, 24)}%`, status: chance(0.3) ? "waiting" : "open", waitingOn: "carrier", followUp: bizAdd(TODAY, ri(0, 3)), owner, client: c, term: t, due: bizAdd(TODAY, ri(-2, 6)), source: "manual", createdAt: workTs(bizAdd(kickDay, 3) > TODAY ? TODAY : bizAdd(kickDay, 3)) });
      if (stage === "presented" || stage === "quoted") addActivity({ code: "REN-PROC", subject: `Process renewal for ${c.name} (${t.number}) once client confirms`, status: chance(0.4) ? "waiting" : "open", waitingOn: "client", followUp: bizAdd(TODAY, ri(0, 2)), owner, client: c, term: t, due: addDays(t.exp, -10) < TODAY ? TODAY : addDays(t.exp, -10), source: "system", createdBy: owner, createdAt: workTs(addDays(TODAY, -ri(1, 6))) });
    }
  }

  // New business setup and policy checks for 2026 terms.
  for (const t of terms) {
    if (t.eff < START) continue;
    const c = t.client;
    const created = t.eff > TODAY ? TODAY : nextBiz(addDays(t.eff, -ri(1, 6)) < START ? START : addDays(t.eff, -ri(1, 6)));
    if (t.newRenewal === "new") {
      const done = t.status !== "bound" && daysBetween(created, TODAY) > 3;
      addActivity({ code: "NB-SETUP", subject: `Set up new policy ${t.number} for ${c.name}`, status: done ? "done" : "open", owner: c.am, createdBy: c.producer, client: c, term: t, due: addDays(created, 2), source: "system", createdAt: workTs(created > TODAY ? TODAY : created), completedAt: done ? workTs(bizAdd(created, ri(0, 3)) > TODAY ? TODAY : bizAdd(created, ri(0, 3))) : null, outcome: done ? outcome("NB-SETUP") : null });
    }
    const checkDue = addDays(t.eff, 14);
    const checked = checkDue < addDays(TODAY, -2) || chance(0.2);
    if (t.status !== "lost") addActivity({ code: "POL-CHECK", subject: `Policy check ${t.number} (${c.name})`, status: checked ? "done" : "open", owner: c.am, client: c, term: t, due: checkDue, source: "system", createdBy: c.am, createdAt: workTs(created > TODAY ? TODAY : created), completedAt: checked ? workTs(addDays(t.eff, ri(4, 20)) > TODAY ? TODAY : nextBiz(addDays(t.eff, ri(4, 20))) > TODAY ? TODAY : nextBiz(addDays(t.eff, ri(4, 20)))) : null, outcome: checked ? outcome("POL-CHECK") : null });
  }
  // Pending cancellations: urgent non-pay tasks today.
  for (const t of terms.filter((x) => x.status === "pending_cancel")) {
    addActivity({ code: "NONPAY", subject: `Non-pay notice: ${t.client.name} ${t.number} cancels ${t.cancelDate}`, description: `${t.carrier.name} sent a notice of cancellation for non-payment. Cancels ${t.cancelDate} unless payment is received.`,
      status: "open", owner: t.client.am, client: t.client, term: t, due: addDays(TODAY, -ri(0, 1)), source: chance(0.6) ? "email" : "system", createdAt: workTs(addDays(TODAY, -ri(0, 2))),
      email: { subject: `Notice of Cancellation — Nonpayment of Premium — ${t.number}`, body_text: `This notice is to advise that policy ${t.number} issued to ${t.client.name} will be cancelled effective ${t.cancelDate} at 12:01 AM for nonpayment of premium. Amount due: $${round2(t.premium / 12).toFixed(2)}.\n\n${t.carrier.name} Billing`, from_addr: `billing@${DOMAINS[t.carrier.code]}`, from_name: `${t.carrier.name} Billing`, original_from_addr: null, original_from_name: null, to: [`service@amsinbox.siryous.app`], forwarded: false } });
  }
  // Cancellations: insured requests.
  for (const t of terms.filter((x) => x.status === "cancelled")) {
    const d = nextBiz(addDays(t.cancelDate, -ri(1, 8)) < START ? START : addDays(t.cancelDate, -ri(1, 8)));
    addActivity({ code: "CANC-REQ", subject: `Process cancellation request for ${t.client.name}`, status: "done", owner: t.client.am, client: t.client, term: t, due: d, source: "email", createdAt: workTs(d), completedAt: workTs(bizAdd(d, ri(0, 2)) > TODAY ? TODAY : bizAdd(d, ri(0, 2))), outcome: outcome("CANC-REQ"),
      email: { subject: `Cancel ${t.number}`, body_text: `Hello,\n\nPlease cancel policy ${t.number} effective ${t.cancelDate}. ${t.cancelReason === "Rewritten elsewhere" ? "We've placed coverage elsewhere." : "We no longer need this coverage."}\n\nThank you,\n${contactOf(t.client).first_name} ${contactOf(t.client).last_name}`, from_addr: contactOf(t.client).email, from_name: `${contactOf(t.client).first_name} ${contactOf(t.client).last_name}`, original_from_addr: null, original_from_name: null, to: [`${t.client.am.username}@amsinbox.siryous.app`], forwarded: false } });
  }

  // ───────── Opportunities and submissions (sales pipeline)
  const opps = [], subs = [];
  const prospects = clients.filter((c) => c.newBiz);
  for (const c of prospects) {
    const won = terms.filter((t) => t.client === c);
    const created = addDays(c.since ?? TODAY, -ri(15, 50)) < START ? START : addDays(c.since ?? TODAY, -ri(15, 50));
    const o = { client: c, name: `${c.name} — ${c.kind === "individual" ? "home & auto" : "commercial package"}`, kind: "new", lines: c.lines, stage: won.length ? "won" : "lost", est_premium: round2(won.reduce((s, t) => s + t.premium, 0) || ri(2000, 30000)),
      owner: c.producer, target_date: c.since ?? addDays(created, 30), source: "Referral", won_policy: won[0]?.id ?? null, closed_at: ts(c.since ?? addDays(created, 30), 16), created_at: ts(created, 10) };
    opps.push(o);
    for (const t of won.slice(0, 1)) { subs.push({ opp: opps.length - 1, carrier_id: t.carrier.id, status: "bound", submitted_at: ts(addDays(created, 5), 11), responded_at: ts(addDays(created, 12), 14), quoted_premium: t.premium, commission_pct: t.commission }); const alt = C[pick(carriersFor(t.lob, c.kind, t.es).filter((x) => x !== t.carrier.code))]; if (alt) subs.push({ opp: opps.length - 1, carrier_id: alt.id, status: chance(0.5) ? "declined" : "closed", submitted_at: ts(addDays(created, 5), 11), responded_at: ts(addDays(created, 14), 10), quoted_premium: chance(0.5) ? round2(t.premium * (1.05 + rand() * 0.2)) : null, declination_reason: chance(0.5) ? pick(["Outside appetite — class", "Loss history", "Minimum premium not met"]) : null, commission_pct: alt.cn }); }
  }
  // Open pipeline: new prospects not yet clients.
  const openProspects = [];
  for (let i = 0; i < 34; i++) {
    const branch = chance(0.55) ? "RAL" : "CLT";
    const business = chance(0.7);
    const ind = pick(INDUSTRIES);
    const a = address(branch);
    const name = business ? uniqueName(() => pick(ind.names).replace("{L}", pick(LAST)).replace("{L2}", pick(LAST)).replace("{C}", a.city.split("-")[0])) : uniqueName(() => `${pick(FIRST)} ${pick(LAST)}`);
    openProspects.push({ branch, business, ind, a, name, producer: business ? (branch === "CLT" ? U.bwhitaker : U.rcallahan) : U.sfoster, am: business ? ams.commercial[branch] : ams.personal[branch] });
  }
  const prospectRows = await insertMany("clients", ["code", "name", "kind", "status", "industry", "naics", "employees", "email", "phone", "address1", "city", "state", "zip", "branch_id", "source", "producer_id", "account_manager_id", "csr_id", "created_at", "website"],
    openProspects.map((p, i) => { const domain = p.business ? `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20)}.example` : null; p.email = p.business ? `info@${domain}` : `${p.name.split(" ")[0].toLowerCase()}${ri(1, 99)}@gmail.com`;
      return { code: `${p.name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6)}-P${String(i + 1).padStart(2, "0")}`, name: p.name, kind: p.business ? "business" : "individual", status: "prospect", industry: p.business ? p.ind.label : null, naics: p.business ? p.ind.naics : null,
        employees: p.business ? ri(p.ind.size[0], p.ind.size[1]) : null, email: p.email, phone: phone(p.branch), ...p.a, branch_id: branchId[p.branch], source: pick(SOURCES), producer_id: p.producer.id, account_manager_id: p.am.id, csr_id: csrs[p.branch].id,
        created_at: ts(randomDate(addDays(TODAY, -110), addDays(TODAY, -2)), 10), website: domain ? `www.${domain}` : null }; }), "id, created_at");
  openProspects.forEach((p, i) => { p.id = prospectRows[i].id; p.created = new Date(prospectRows[i].created_at).toISOString().slice(0, 10); });
  await insertMany("contacts", ["client_id", "first_name", "last_name", "title", "email", "phone", "is_primary"], openProspects.map((p) => ({ client_id: p.id, first_name: p.business ? pick(FIRST) : p.name.split(" ")[0], last_name: p.business ? pick(LAST) : p.name.split(" ").slice(-1)[0], title: p.business ? "Owner" : null, email: p.email, phone: phone(p.branch), is_primary: true })), null);
  for (const p of openProspects) {
    const stage = weighted([["lead", 5], ["qualifying", 5], ["submitted", 6], ["quoted", 5], ["proposal", 3], ["lost", 4]]);
    const lines = p.business ? [...p.ind.core] : ["PA", "HO"];
    const est = round2(p.business ? lines.reduce((s, l) => s + BASE[l] * (0.8 + rand()), 0) : 3600 + rand() * 2400);
    opps.push({ client: { id: p.id, name: p.name }, name: `${p.name} — ${p.business ? "commercial package" : "home & auto"}`, kind: "new", lines, stage, est_premium: est, owner: p.producer, target_date: addDays(TODAY, ri(5, 70)), source: "Website quote form",
      lost_reason: stage === "lost" ? pick(["Stayed with incumbent", "Price", "Carrier declined — loss history", "Unresponsive"]) : null, closed_at: stage === "lost" ? ts(addDays(TODAY, -ri(2, 40)), 15) : null, created_at: ts(p.created, 10) });
    const oi = opps.length - 1;
    if (["submitted", "quoted", "proposal", "lost"].includes(stage)) {
      const markets = carriersFor(lines[0], p.business ? "business" : "individual", false).slice(0, ri(2, 4));
      for (const m of markets) {
        const st = stage === "submitted" ? pick(["submitted", "waiting_on_carrier", "preparing"]) : pick(["quoted", "quoted", "declined", "waiting_on_carrier"]);
        subs.push({ opp: oi, carrier_id: C[m].id, status: st, submitted_at: st === "preparing" ? null : ts(addDays(p.created, ri(2, 10)) > TODAY ? TODAY : addDays(p.created, ri(2, 10)), 11), responded_at: ["quoted", "declined"].includes(st) ? ts(addDays(TODAY, -ri(0, 10)), 14) : null,
          quoted_premium: st === "quoted" ? round2(est * (0.85 + rand() * 0.35)) : null, declination_reason: st === "declined" ? pick(["Outside appetite — class", "Loss history", "Years in business under 3"]) : null, commission_pct: C[m].cn });
      }
    }
    if (stage !== "lost") {
      addActivity({ code: stage === "lead" ? "LEAD" : stage === "qualifying" ? "CALL" : "QUOTE", subject: stage === "lead" ? `New lead: ${p.name}` : stage === "qualifying" ? `Qualify ${p.name} — gather exposures` : `${stage === "proposal" ? "Present proposal to" : "Follow up on quotes for"} ${p.name}`,
        status: "open", owner: p.producer, client: { id: p.id, name: p.name }, due: bizAdd(TODAY, ri(-2, 5)) < TODAY && chance(0.5) ? TODAY : bizAdd(TODAY, ri(-2, 5)), source: stage === "lead" ? "lead" : "manual", createdAt: workTs(p.created), oppIdx: oi });
    }
  }
  const oppIds = await insertMany("opportunities", ["client_id", "name", "kind", "lines", "stage", "est_premium", "owner_id", "target_date", "source", "lost_reason", "won_policy_id", "closed_at", "created_at"],
    opps.map((o) => ({ client_id: o.client.id, name: o.name, kind: o.kind, lines: o.lines, stage: o.stage, est_premium: o.est_premium, owner_id: o.owner.id, target_date: o.target_date, source: o.source, lost_reason: o.lost_reason ?? null, won_policy_id: o.won_policy ?? null, closed_at: o.closed_at ?? null, created_at: o.created_at })), "id");
  await insertMany("submissions", ["opportunity_id", "carrier_id", "status", "submitted_at", "responded_at", "quoted_premium", "commission_pct", "declination_reason"], subs.map((s) => ({ ...s, opportunity_id: oppIds[s.opp].id, opp: undefined })).map(({ opp, ...r }) => r), null);
  const wonPairs = opps.map((o, i) => [oppIds[i].id, o.won_policy]).filter(([, p]) => p);
  await db.query("UPDATE policies p SET opportunity_id = v.o FROM (SELECT unnest($1::int[]) AS o, unnest($2::int[]) AS id) v WHERE p.id = v.id", [wonPairs.map((x) => x[0]), wonPairs.map((x) => x[1])]);

  // ───────── Emails and activities insert
  const emailIdx = [];
  for (const [i, a] of acts.entries()) {
    if (!a._email) continue;
    const e = a._email;
    const received = new Date(new Date(a.created_at).getTime() - ri(2, 40) * 60000).toISOString();
    const lowConf = a.status !== "done" && !e.from_addr.startsWith("billing@") && !["NONPAY", "CANC-REQ", "CLAIM-FNOL"].includes(a.code) && chance(0.12);
    emails.push({ message_id: `<${crypto.randomUUID()}@mail.example>`, from_addr: e.from_addr, from_name: e.from_name, original_from_addr: e.original_from_addr, original_from_name: e.original_from_name, to_addrs: e.to, cc_addrs: [], subject: e.subject, body_text: e.body_text,
      received_at: received, routed_user_id: a.owner_id, forwarded_by_user_id: e.forwarded ? a.owner_id : null, client_id: lowConf ? null : a.client_id, policy_id: lowConf ? null : a.policy_id,
      match_method: lowConf ? null : e.forwarded ? "sender is a client contact" : pick(["sender is a client contact", "sender is a client contact", "policy number in email", "sender domain"]), match_confidence: lowConf ? 0 : pick([0.9, 0.95, 0.75]),
      status: lowConf ? "new" : "actioned", classification: JSON.stringify({ activity_code: a.code, subject: a.subject, summary: (a.description ?? e.subject).slice(0, 300), priority: a.priority, due_in_days: null, policy_number: null, requested_change: null, auto_reply: false, confidence: lowConf ? 0.4 : 0.86 }),
      classified_by: chance(0.75) ? "ai" : "rules", source: "seed", created_at: received, _act: i });
    if (lowConf) { acts[i].client_id = null; acts[i].policy_id = null; acts[i].code = "EMAIL-IN"; acts[i].subject = `Review email: ${e.subject.replace(/^Fwd: /, "")}`; }
  }
  // A few auto-replies the pipeline ignored.
  for (let i = 0; i < 18; i++) { const d = pick(BIZ_DAYS); emails.push({ message_id: `<${crypto.randomUUID()}@mail.example>`, from_addr: `noreply@${pick(Object.values(DOMAINS))}`, from_name: "Automatic reply", original_from_addr: null, original_from_name: null, to_addrs: ["service@amsinbox.siryous.app"], cc_addrs: [], subject: `Automatic reply: Out of office`, body_text: "I am out of the office with limited access to email and will respond when I return.", received_at: ts(d, ri(8, 18)), routed_user_id: null, forwarded_by_user_id: null, client_id: null, policy_id: null, match_method: null, match_confidence: 0, status: "ignored", classification: JSON.stringify({ activity_code: "EMAIL-IN", auto_reply: true }), classified_by: "rules", source: "seed", created_at: ts(d, 9), _act: null }); }

  // Resolve placeholders and insert activities.
  const actCols = ["code", "subject", "description", "status", "priority", "owner_id", "created_by_id", "client_id", "policy_id", "claim_id", "certificate_id", "opportunity_id", "email_id", "due_date", "snoozed_until", "waiting_on", "follow_up_date", "source", "checklist", "outcome", "completed_at", "completed_by_id", "auto_key", "created_at", "updated_at"];
  for (const a of acts) { if (a.claim_id?.ref != null) a.claim_id = claimIds[a.claim_id.ref].id; if (a.opportunity_id?.ref != null) a.opportunity_id = oppIds[a.opportunity_id.ref].id; }
  const actIds = await insertMany("activities", actCols, acts, "id");
  acts.forEach((a, i) => { a.id = actIds[i].id; });
  const emailIds = await insertMany("emails", ["message_id", "from_addr", "from_name", "original_from_addr", "original_from_name", "to_addrs", "cc_addrs", "subject", "body_text", "received_at", "routed_user_id", "forwarded_by_user_id", "client_id", "policy_id", "match_method", "match_confidence", "status", "classification", "classified_by", "source", "created_at", "activity_id"],
    emails.map((e) => ({ ...e, activity_id: e._act != null ? acts[e._act].id : null })), "id");
  const pairs = emails.map((e, i) => [e._act, emailIds[i].id]).filter(([a]) => a != null);
  await db.query("UPDATE activities a SET email_id = v.e FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS e) v WHERE a.id = v.id", [pairs.map(([a]) => acts[a].id), pairs.map(([, e]) => e)]);
  // A few emails carry attachments (rendered placeholders).
  emails.forEach((e, i) => { if (e._act != null && chance(0.12)) docs.push({ client_id: e.client_id, policy_id: e.policy_id, email_id: emailIds[i].id, folder: "Email", title: pick(["Photos of damage.pdf", "Signed request.pdf", "Vehicle registration.pdf", "Contract insurance requirements.pdf", "Audit worksheet.pdf"]), mime: "application/pdf", generated_kind: "email_attachment", created_at: e.received_at }); });

  await insertMany("activity_notes", ["activity_id", "client_id", "author_id", "kind", "body", "created_at"], notes.map((n) => ({ activity_id: acts[n.act].id, client_id: n.client_id, author_id: n.author_id, kind: n.kind, body: n.body, created_at: n.created_at })), null);

  // Certificates
  const certRows = await insertMany("certificates", ["cert_number", "client_id", "holder_id", "is_master", "status", "description_of_operations", "additional_insured", "waiver_of_subrogation", "primary_noncontributory", "issued_at", "issued_by_id", "delivered_to", "delivered_at", "created_at"],
    certs.map((ce, i) => ({ cert_number: `COI-26-${String(i + 1).padStart(5, "0")}`, client_id: ce.client.id, holder_id: ce.holder_id, is_master: false, status: ce.status, description_of_operations: ce.description_of_operations, additional_insured: ce.additional_insured, waiver_of_subrogation: ce.waiver_of_subrogation,
      primary_noncontributory: ce.primary_noncontributory, issued_at: ce.issued_at, issued_by_id: ce.issued_by_id, delivered_to: ce.delivered_to, delivered_at: ce.delivered_at, created_at: ce.created_at })), "id");
  await insertMany("certificate_policies", ["certificate_id", "policy_id"], [...new Map(certPolicies.map((cp) => [`${certRows[cp.cert].id}:${cp.policy_id}`, { certificate_id: certRows[cp.cert].id, policy_id: cp.policy_id }])).values()], null);
  await db.query("UPDATE activities a SET certificate_id = v.c FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS c) v WHERE a.id = v.id", [certs.map((ce) => acts[ce.act].id), certRows.map((r) => r.id)]);
  certs.forEach((ce, i) => docs.push({ client_id: ce.client.id, certificate_id: certRows[i].id, folder: "Certificates", title: `Certificate ${`COI-26-${String(i + 1).padStart(5, "0")}`} — ${ce.delivered_to}`, mime: "application/pdf", generated_kind: "certificate", created_at: ce.issued_at }));

  // ───────── Transactions, endorsements, invoices, receipts, ledger
  const invoices = [], invLines = [], receipts = [], applications = [];
  const commissionEvents = [];   // direct bill: {carrier, month, line}
  function invoiceFor(t, date, lines, memo, txIx) {
    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    const number = docNumber("INV", date);
    const inv = { invoice_number: number, client_id: t.client.id, policy_id: t.id, tx: txIx, issue_date: date, due_date: addDays(date, 20), status: total === 0 ? "paid" : "open", total, memo, created_at: ts(date, 12), paidOn: total < 0 ? date : undefined };
    invoices.push(inv);
    const ix = invoices.length - 1;
    const payee = t.wholesaler ?? t.carrier;
    const journal = [];
    for (const l of lines) {
      const prem = l.kind === "premium" || l.kind === "return_premium";
      const com = prem ? round2(l.amount * t.commission / 100) : 0;
      const payable = prem ? round2(l.amount - com) : 0;
      const payTo = prem ? "carrier" : "state";
      invLines.push({ inv: ix, kind: l.kind, description: l.description, amount: l.amount, commission_pct: prem ? t.commission : 0, commission_amount: com, payable_amount: payable, payable_to: payTo, carrier_id: payTo === "carrier" ? payee.id : null });
      const sign = l.amount >= 0 ? 1 : -1, a = Math.abs(l.amount);
      const dr = (acct, v) => journal.push(sign > 0 ? { account: acct, debit: v } : { account: acct, credit: v });
      const cr = (acct, v) => journal.push(sign > 0 ? { account: acct, credit: v } : { account: acct, debit: v });
      dr("premium_receivable", a);
      if (prem) { cr("carrier_payable", Math.abs(payable)); cr("commission_income", Math.abs(com)); } else cr("tax_payable", a);
    }
    post(date, `Invoice ${number}`, "invoice", { inv: ix }, journal, { client_id: t.client.id, policy_id: t.id, carrier_id: payee.id });
    return ix;
  }
  const slRate = { NC: 5.0, SC: 6.0 };
  const invoiceLinesFor = (t, amount) => [{ kind: amount >= 0 ? "premium" : "return_premium", description: amount >= 0 ? "Premium" : "Return premium", amount: round2(amount) },
    ...(t.es ? [{ kind: "surplus_lines_tax", description: `${t.client.a.state} surplus lines tax (${slRate[t.client.a.state] ?? 5}%)`, amount: round2(amount * (slRate[t.client.a.state] ?? 5) / 100) }] : [])];

  for (const t of terms) {
    const issued = t.status !== "bound";
    txRows.push({ policy_id: t.id, kind: t.newRenewal === "new" ? "new" : t.newRenewal, status: issued ? "issued" : "pending", effective_date: t.eff, description: `${t.newRenewal === "new" ? "New business" : t.newRenewal === "rewrite" ? "Rewrite" : "Renewal"} ${t.number}`, premium_change: t.premium, created_by_id: t.client.am.id, created_at: ts(t.eff < START ? t.eff : addDays(t.eff, -5) < START ? START : addDays(t.eff, -5) > TODAY ? TODAY : addDays(t.eff, -5), 10), issued_at: issued ? ts(t.eff > TODAY ? TODAY : t.eff, 11) : null });
    if (t.eff >= START) {
      if (t.billMode === "agency" && t.eff <= addDays(TODAY, 10)) invoiceFor(t, addDays(t.eff, -10) < START ? START : addDays(t.eff, -10) > TODAY ? TODAY : addDays(t.eff, -10), invoiceLinesFor(t, t.premium), `${t.newRenewal === "new" ? "New business" : "Renewal"} ${t.number}`, txRows.length - 1);
      else if (t.billMode === "direct" && t.status !== "bound") commissionEvents.push({ carrier: t.carrier, date: t.eff, t, kind: t.newRenewal === "new" ? "new" : "renewal", premium: t.premium });
    }
    let premium = t.premium;
    for (const en of t.endorsements) {
      premium += en.change;
      txRows.push({ policy_id: t.id, kind: "endorsement", status: "issued", effective_date: en.date, description: en.desc, premium_change: en.change, created_by_id: t.client.am.id, created_at: ts(en.date, 13), issued_at: ts(en.date, 15) });
      if (en.change) {
        if (t.billMode === "agency") invoiceFor(t, en.date, invoiceLinesFor(t, en.change), `Endorsement ${t.number}`, txRows.length - 1);
        else commissionEvents.push({ carrier: t.carrier, date: en.date, t, kind: "endorsement", premium: en.change });
      }
    }
    t.finalPremium = round2(premium);
    if (t.status === "cancelled") {
      txRows.push({ policy_id: t.id, kind: "cancellation", status: "issued", effective_date: t.cancelDate, description: `Cancelled: ${t.cancelReason} (${t.cancelMethod})`, premium_change: -t.returnPremium, created_by_id: t.client.am.id, created_at: ts(t.cancelDate, 14), issued_at: ts(t.cancelDate, 15) });
      if (t.returnPremium) {
        if (t.billMode === "agency" && t.eff >= START) invoiceFor(t, t.cancelDate > TODAY ? TODAY : t.cancelDate, invoiceLinesFor(t, -t.returnPremium), `Return premium ${t.number}`, txRows.length - 1);
        else if (t.billMode === "direct") commissionEvents.push({ carrier: t.carrier, date: t.cancelDate, t, kind: "cancellation", premium: -t.returnPremium });
      }
    }
    if (t.status === "pending_cancel") txRows.push({ policy_id: t.id, kind: "cancellation", status: "pending", effective_date: t.cancelDate, description: "Notice of cancellation: Non-payment (Pro rata)", premium_change: 0, created_by_id: t.client.am.id, created_at: ts(addDays(TODAY, -1), 9), issued_at: null });
    if (t.status === "non_renewed") txRows.push({ policy_id: t.id, kind: "non_renewal", status: "issued", effective_date: t.exp, description: `Carrier non-renewal: ${t.lostReason}`, premium_change: 0, created_by_id: t.client.am.id, created_at: ts(addDays(t.exp, -45) < START ? START : addDays(t.exp, -45), 10), issued_at: ts(addDays(t.exp, -45) < START ? START : addDays(t.exp, -45), 10) });
  }
  // Keep policy premium in step with issued endorsements.
  const endorsed = terms.filter((t) => t.finalPremium !== t.premium);
  await db.query("UPDATE policies p SET premium = v.pr FROM (SELECT unnest($1::int[]) AS id, unnest($2::numeric[]) AS pr) v WHERE p.id = v.id", [endorsed.map((t) => t.id), endorsed.map((t) => t.finalPremium)]);
  await insertMany("policy_transactions", ["policy_id", "kind", "status", "effective_date", "description", "premium_change", "created_by_id", "created_at", "issued_at"], txRows, null);

  // Receipts: most invoices paid 3–35 days after issue; a few still open or past due.
  for (const [ix, inv] of invoices.entries()) {
    if (inv.total < 0) {
      // Return premium: refund check to the client a few days later (most recent ones still due).
      const rd = nextBiz(addDays(inv.issue_date, ri(3, 9)));
      if (rd >= TODAY) continue;
      const number = docNumber("RFND", rd);
      receipts.push({ receipt_number: number, client_id: inv.client_id, received_date: rd, amount: inv.total, method: "check", reference: digits(5), bank_account: "trust", status: "finalized", deposited: true, created_by_id: U.lmorgan.id, created_at: ts(rd, 15), memo: "Refund to client" });
      applications.push({ rc: receipts.length - 1, inv: ix, amount: inv.total });
      inv.status = "paid";
      post(rd, `Refund ${number} for ${inv.invoice_number}`, "receipt", { rc: receipts.length - 1 }, [{ account: "premium_receivable", debit: -inv.total }, { account: "trust_cash", credit: -inv.total }], { client_id: inv.client_id, policy_id: inv.policy_id });
      continue;
    }
    if (inv.total === 0) continue;
    const payDay = nextBiz(addDays(inv.issue_date, weighted([[ri(2, 12), 6], [ri(13, 25), 3], [ri(26, 45), 1]])));
    const open = payDay > TODAY || (inv.issue_date > addDays(TODAY, -25) && chance(0.35)) || (inv.issue_date > addDays(TODAY, -70) && chance(0.08));
    if (open) continue;
    const partial = chance(0.04);
    const amount = partial ? round2(inv.total * 0.5) : inv.total;
    const t = terms.find((x) => x.id === inv.policy_id);
    const number = docNumber("RCPT", payDay);
    receipts.push({ receipt_number: number, client_id: inv.client_id, received_date: payDay, amount, method: weighted([["check", 5], ["ach", 4], ["card", 2], ["wire", 1]]), reference: chance(0.7) ? digits(5) : null, bank_account: "trust", status: "finalized", deposited: true, created_by_id: U.lmorgan.id, created_at: ts(payDay, 14) });
    applications.push({ rc: receipts.length - 1, inv: ix, amount });
    inv.status = partial ? "partial" : "paid";
    inv.paidOn = payDay;
    post(payDay, `Receipt ${number} (check)`, "receipt", { rc: receipts.length - 1 }, [{ account: "trust_cash", debit: amount }, { account: "premium_receivable", credit: amount }], { client_id: inv.client_id, policy_id: inv.policy_id });
    void t;
  }
  // A returned check (NSF) for realism.
  const nsfPick = receipts.filter((x) => x.amount >= 400 && x.amount <= 3000 && x.received_date >= `${TODAY.slice(0, 7)}-01` && x.received_date < TODAY).pop();
  if (nsfPick) { const r = nsfPick; r.status = "reversed"; r.reversed_reason = "NSF — returned by bank"; post(addDays(r.received_date, 6) > TODAY ? TODAY : addDays(r.received_date, 6), `Reversal of ${r.receipt_number}: NSF`, "receipt", { rc: receipts.indexOf(r) }, [{ account: "premium_receivable", debit: r.amount }, { account: "trust_cash", credit: r.amount }], { client_id: r.client_id }); const a = applications.find((x) => x.rc === receipts.indexOf(r)); if (a) invoices[a.inv].status = "open"; }

  const invIds = await insertMany("invoices", ["invoice_number", "client_id", "policy_id", "issue_date", "due_date", "status", "total", "memo", "created_at"], invoices, "id");
  // Carrier statements: on the 15th, pay every line collected in the prior month (pay by statement).
  const carrierStmts = [];
  for (const m of ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]) {
    const payDate = nextBiz(`${m}-15`);
    if (payDate > TODAY) break;
    const prevMonth = addMonths(`${m}-01`, -1).slice(0, 7);
    const byCarrier = new Map();
    invLines.forEach((l, li) => { const inv = invoices[l.inv]; if (l.payable_to === "carrier" && l.stmt === undefined && (inv.status === "paid" || inv.total < 0) && inv.paidOn && inv.paidOn.slice(0, 7) <= prevMonth) { if (!byCarrier.has(l.carrier_id)) byCarrier.set(l.carrier_id, []); byCarrier.get(l.carrier_id).push(li); } });
    for (const [carrierId, lis] of byCarrier) {
      const total = round2(lis.reduce((s, li) => s + invLines[li].payable_amount, 0));
      if (Math.abs(total) < 0.01) continue;
      carrierStmts.push({ carrier_id: carrierId, statement_date: payDate, status: "paid", total, paid_date: payDate, reference: `ACH ${digits(6)}`, created_at: ts(payDate, 11) });
      lis.forEach((li) => { invLines[li].stmt = carrierStmts.length - 1; });
      post(payDate, `Carrier statement payment`, "carrier_statement", { cs: carrierStmts.length - 1 }, [{ account: "carrier_payable", debit: total }, { account: "trust_cash", credit: total }], { carrier_id: carrierId });
    }
    // Monthly sweep of earned commission from trust to operating.
    const bal = (acct) => ledgerRows.filter((r) => r.account === acct && r.entry_date <= payDate).reduce((s, r) => s + r.debit - r.credit, 0);
    const available = round2(bal("trust_cash") + bal("carrier_payable") + bal("tax_payable"));
    if (available > 500) post(payDate, "Earned commission sweep, trust to operating", "sweep", 0, [{ account: "operating_cash", debit: round2(available * 0.7) }, { account: "trust_cash", credit: round2(available * 0.7) }]);
  }
  const csIds = await insertMany("carrier_statements", ["carrier_id", "statement_date", "status", "total", "paid_date", "reference", "created_at"], carrierStmts, "id");
  await insertMany("invoice_lines", ["invoice_id", "kind", "description", "amount", "commission_pct", "commission_amount", "payable_amount", "payable_to", "carrier_id", "carrier_statement_id"],
    invLines.map((l) => ({ invoice_id: invIds[l.inv].id, kind: l.kind, description: l.description, amount: l.amount, commission_pct: l.commission_pct, commission_amount: l.commission_amount, payable_amount: l.payable_amount, payable_to: l.payable_to, carrier_id: l.carrier_id, carrier_statement_id: l.stmt != null ? csIds[l.stmt].id : null })), null);
  const rcIds = await insertMany("receipts", ["receipt_number", "client_id", "received_date", "amount", "method", "reference", "bank_account", "status", "deposited", "reversed_reason", "memo", "created_by_id", "created_at"], receipts, "id");
  await insertMany("receipt_applications", ["receipt_id", "invoice_id", "amount"], applications.map((a) => ({ receipt_id: rcIds[a.rc].id, invoice_id: invIds[a.inv].id, amount: a.amount })), null);
  invoices.forEach((inv, i) => docs.push({ client_id: inv.client_id, policy_id: inv.policy_id, folder: "Billing", title: `Invoice ${inv.invoice_number}`, mime: "application/pdf", generated_kind: "invoice", ref_id: invIds[i].id, created_at: inv.created_at }));

  // Direct bill commission statements, monthly per carrier; the latest month is a draft to reconcile.
  const cStmts = [], cLines = [];
  const months = [...new Set(commissionEvents.map((e) => e.date.slice(0, 7)))].sort();
  const currentMonth = TODAY.slice(0, 7);
  for (const m of months) {
    if (m >= currentMonth) continue;
    const stmtDate = nextBiz(`${addMonths(`${m}-01`, 1).slice(0, 7)}-20`);
    const isDraft = stmtDate > TODAY || addMonths(`${m}-01`, 1).slice(0, 7) === currentMonth;
    const byCarrier = new Map();
    for (const e of commissionEvents.filter((x) => x.date.slice(0, 7) === m)) { if (!byCarrier.has(e.carrier.code)) byCarrier.set(e.carrier.code, []); byCarrier.get(e.carrier.code).push(e); }
    for (const [code, evs] of byCarrier) {
      const lines = evs.map((e) => { const rate = e.t.commission; let commission = round2(e.premium * rate / 100); let status = "matched"; let note = null;
        if (isDraft && chance(0.08)) { commission = round2(e.premium * (rate - 2) / 100); status = "variance"; note = "Paid at lower rate than agreement"; }
        return { policy_number: e.t.number, insured_name: e.t.client.name.toUpperCase(), effective_date: e.date, transaction_kind: e.kind, premium: round2(e.premium), rate_pct: rate, commission, policy_id: isDraft && chance(0.04) ? null : e.t.id, expected_commission: round2(e.premium * rate / 100), match_status: status, note }; });
      if (isDraft && chance(0.5)) lines.push({ policy_number: `${code}${digits(8)}`, insured_name: `${pick(LAST).toUpperCase()} ${pick(["LLC", "INC", ""])}`.trim(), effective_date: `${m}-${String(ri(1, 28)).padStart(2, "0")}`, transaction_kind: "new", premium: round2(ri(800, 6000)), rate_pct: C[code].cn, commission: 0, policy_id: null, expected_commission: null, match_status: "unmatched", note: "Not found in AMS — book transfer?" });
      lines.forEach((l) => { if (!l.policy_id) { l.match_status = "unmatched"; l.expected_commission = null; } if (l.match_status === "unmatched" && !l.commission) l.commission = round2(l.premium * (C[code].cn) / 100); });
      const total = round2(lines.reduce((s, l) => s + l.commission, 0));
      cStmts.push({ carrier_id: C[code].id, statement_date: stmtDate > TODAY ? TODAY : stmtDate, period: m, source: weighted([["download", 0], ["import", 5], ["ai", 3], ["manual", 1]]), status: isDraft ? "draft" : "posted", statement_total: total, deposit_amount: total, deposit_date: stmtDate > TODAY ? TODAY : stmtDate, created_by_id: U.lmorgan.id, posted_at: isDraft ? null : ts(stmtDate, 16), created_at: ts(stmtDate > TODAY ? TODAY : stmtDate, 10) });
      lines.forEach((l) => cLines.push({ ...l, st: cStmts.length - 1 }));
      if (!isDraft) post(stmtDate, `Direct bill commission ${m}`, "commission_statement", { cst: cStmts.length - 1 }, [{ account: "operating_cash", debit: total }, { account: "commission_income", credit: total }], { carrier_id: C[code].id });
    }
  }
  const cstIds = await insertMany("commission_statements", ["carrier_id", "statement_date", "period", "source", "status", "statement_total", "deposit_amount", "deposit_date", "created_by_id", "posted_at", "created_at"], cStmts, "id");
  const clIds = await insertMany("commission_lines", ["statement_id", "policy_number", "insured_name", "effective_date", "transaction_kind", "premium", "rate_pct", "commission", "policy_id", "expected_commission", "match_status", "note"], cLines.map((l) => ({ ...l, statement_id: cstIds[l.st].id })).map(({ st, ...r }) => r), "id, policy_id, commission, statement_id");

  // Producer statements for posted periods (paid), mirroring buildProducerStatement.
  const pStmts = [], pLines = [];
  const postedPeriods = [...new Set(cStmts.filter((s) => s.status === "posted").map((s) => s.period))];
  const termById = new Map(terms.map((t) => [t.id, t]));
  for (const prod of [U.rcallahan, U.bwhitaker, U.sfoster]) {
    for (const period of postedPeriods) {
      const lines = [];
      clIds.forEach((row, i) => { const l = cLines[i]; const st = cStmts[l.st]; const t = termById.get(row.policy_id); if (!t || st.period !== period || st.status !== "posted" || t.client.producer !== prod) return; const isNew = t.newRenewal === "new"; const pctv = isNew ? prod.split[0] : prod.split[1]; lines.push({ policy_id: t.id, commission_line_id: row.id, kind: l.commission < 0 ? "chargeback" : isNew ? "new" : "renewal", agency_commission: l.commission, split_pct: pctv, amount: round2(l.commission * pctv / 100) }); });
      invLines.forEach((l) => { const inv = invoices[l.inv]; const t = termById.get(inv.policy_id); if (!t || inv.status !== "paid" || inv.issue_date.slice(0, 7) !== period || t.client.producer !== prod || !l.commission_amount) return; const isNew = t.newRenewal === "new"; const pctv = isNew ? prod.split[0] : prod.split[1]; lines.push({ policy_id: t.id, commission_line_id: null, kind: l.commission_amount < 0 ? "chargeback" : isNew ? "new" : "renewal", agency_commission: l.commission_amount, split_pct: pctv, amount: round2(l.commission_amount * pctv / 100) }); });
      if (!lines.length) continue;
      const total = round2(lines.reduce((s, l) => s + l.amount, 0));
      const payDate = nextBiz(`${addMonths(`${period}-01`, 1).slice(0, 7)}-28`) > TODAY ? TODAY : nextBiz(`${addMonths(`${period}-01`, 1).slice(0, 7)}-28`);
      const paid = addMonths(`${period}-01`, 2).slice(0, 7) <= currentMonth;
      pStmts.push({ user_id: prod.id, period, status: paid ? "paid" : "draft", total, paid_at: paid ? ts(payDate, 15) : null, created_at: ts(payDate, 9) });
      lines.forEach((l) => pLines.push({ ...l, ps: pStmts.length - 1 }));
      if (paid) { post(payDate, `Producer commission ${period}`, "producer_statement", { ps: pStmts.length - 1 }, [{ account: "producer_expense", debit: total }, { account: "producer_payable", credit: total }]); post(payDate, `Producer commission paid ${period}`, "producer_statement", { ps: pStmts.length - 1 }, [{ account: "producer_payable", debit: total }, { account: "operating_cash", credit: total }]); }
    }
  }
  const psIds = await insertMany("producer_statements", ["user_id", "period", "status", "total", "paid_at", "created_at"], pStmts, "id");
  await insertMany("producer_statement_lines", ["statement_id", "policy_id", "commission_line_id", "kind", "agency_commission", "split_pct", "amount"], pLines.map((l) => ({ ...l, statement_id: psIds[l.ps].id })).map(({ ps, ...r }) => r), null);

  // Ledger: resolve references and insert.
  const refId = (r) => (typeof r === "object" ? (r.inv != null ? invIds[r.inv].id : r.rc != null ? rcIds[r.rc].id : r.cs != null ? csIds[r.cs].id : r.cst != null ? cstIds[r.cst].id : r.ps != null ? psIds[r.ps].id : 0) : r);
  await insertMany("ledger_entries", ["entry_date", "journal", "account", "debit", "credit", "memo", "ref_type", "ref_id", "client_id", "policy_id", "carrier_id", "created_at"], ledgerRows.map((r) => ({ ...r, ref_id: refId(r.ref_id) })), null);
  // Lock closed months.
  const lockMonths = []; for (let m = "2026-01"; addMonths(`${m}-01`, 2).slice(0, 7) <= currentMonth; m = addMonths(`${m}-01`, 1).slice(0, 7)) lockMonths.push(m);
  if (lockMonths.length) await insertMany("accounting_periods", ["period", "locked", "locked_at", "locked_by"], lockMonths.map((m) => ({ period: m, locked: true, locked_at: ts(nextBiz(`${addMonths(`${m}-01`, 1).slice(0, 7)}-10`), 17), locked_by: "lmorgan" })), null);

  // Documents: dec pages for every term, applications for new business, loss runs for some.
  for (const t of terms) {
    docs.push({ client_id: t.client.id, policy_id: t.id, folder: "Policy", title: `Declarations — ${t.number}`, mime: "application/pdf", generated_kind: "dec_page", created_at: ts(t.eff < START ? t.eff : addDays(t.eff, 4) > TODAY ? TODAY : addDays(t.eff, 4), 12) });
    if (t.newRenewal === "new" && t.eff >= START) docs.push({ client_id: t.client.id, policy_id: t.id, folder: "Applications", title: `Signed application — ${t.number}`, mime: "application/pdf", generated_kind: "application", created_at: ts(addDays(t.eff, -7) < START ? START : addDays(t.eff, -7), 11) });
    if (t.lob === "PA" && t.eff >= START) docs.push({ client_id: t.client.id, policy_id: t.id, folder: "Policy", title: `Auto ID cards — ${t.number}`, mime: "application/pdf", generated_kind: "id_card", created_at: ts(addDays(t.eff, 2) > TODAY ? TODAY : addDays(t.eff, 2), 12) });
  }
  for (const c of clients.filter((x) => x.kind === "business" && chance(0.25))) docs.push({ client_id: c.id, folder: "Loss runs", title: `Loss runs ${pick(Object.values(C)).name} 2021–2026`, mime: "application/pdf", generated_kind: "loss_run", created_at: ts(randomDate(START, TODAY), 11) });
  await insertMany("documents", ["client_id", "policy_id", "email_id", "certificate_id", "folder", "title", "filename", "mime", "size", "generated_kind", "ref_id", "restricted", "created_at"],
    docs.map((d) => ({ client_id: d.client_id ?? null, policy_id: d.policy_id ?? null, email_id: d.email_id ?? null, certificate_id: d.certificate_id ?? null, folder: d.folder, title: d.title, filename: `${d.title.replace(/[^\w.-]+/g, "_").replace(/_pdf$/i, "")}${d.title.endsWith(".pdf") ? "" : ".pdf"}`, mime: d.mime, size: ri(38000, 420000), generated_kind: d.generated_kind, ref_id: d.ref_id ?? null, restricted: d.folder === "Loss runs" && chance(0.2), created_at: d.created_at })), null);

  // Account notes (no task) and audit trail for policies.
  const clientNotes = [];
  for (const c of clients.filter(() => chance(0.3))) clientNotes.push({ client_id: c.id, author_id: c.am.id, kind: "call", body: pick(["Called to review renewal options; client wants to keep current deductibles.", "Discussed adding an umbrella; client will think about it.", "Client asked about bundling auto with home — sent quote request to producer.", "Talked through the new location exposures; will update at renewal.", "Client happy with service; mentioned referring a friend."]), created_at: workTs(randomDate(START, addDays(TODAY, -1))) });
  await insertMany("activity_notes", ["client_id", "author_id", "kind", "body", "created_at"], clientNotes, null);
  for (const t of terms.filter((x) => x.eff >= START)) audits.push({ occurred_at: ts(addDays(t.eff, -5) < START ? START : addDays(t.eff, -5) > TODAY ? TODAY : addDays(t.eff, -5), 10), actor: t.client.am.username, action: t.newRenewal === "new" ? "policy.created" : "policy.renewed", entity_type: "policy", entity_id: t.id, summary: `${t.number} ${t.lob} $${t.premium.toFixed(0)} eff ${t.eff}` });
  for (const t of terms.filter((x) => x.status === "cancelled")) audits.push({ occurred_at: ts(t.cancelDate > TODAY ? TODAY : t.cancelDate, 14), actor: t.client.am.username, action: "policy.cancelled", entity_type: "policy", entity_id: t.id, summary: `Cancelled ${t.cancelDate}: ${t.cancelReason}` });
  for (const ce of certs) audits.push({ occurred_at: ce.issued_at, actor: USERS.find((u) => U[u.username].id === ce.issued_by_id)?.username ?? "system", action: "certificate.issued", entity_type: "certificate", entity_id: { cert: certs.indexOf(ce) }, summary: `Issued to ${ce.delivered_to}` });
  await insertMany("audit_events", ["occurred_at", "actor", "action", "entity_type", "entity_id", "summary"],
    audits.map((a) => ({ ...a, entity_id: typeof a.entity_id === "object" ? String(a.entity_id.act != null ? acts[a.entity_id.act].id : certRows[a.entity_id.cert].id) : String(a.entity_id) })), null);

  // Sign-in history: each person, each working day, from their office (occasionally from home).
  const OFFICE = { RAL: { ip: "198.51.100.24", geo: { country: "United States", country_code: "US", region: "North Carolina", city: "Raleigh", timezone: "America/New_York", isp: "Spectrum Business" } },
    CLT: { ip: "203.0.113.57", geo: { country: "United States", country_code: "US", region: "North Carolina", city: "Charlotte", timezone: "America/New_York", isp: "AT&T Business Fiber" } } };
  const UAS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0"];
  const logins = [];
  for (const u of USERS) {
    const ua = pick(UAS);
    for (const day of BIZ_DAYS) {
      if (chance(0.05)) continue; // PTO
      const remote = chance(0.12);
      const geo = remote ? { ...OFFICE[u.branch].geo, isp: pick(["Spectrum", "Google Fiber", "AT&T Internet"]), city: pick(u.branch === "RAL" ? ["Cary", "Apex", "Wake Forest", "Durham"] : ["Matthews", "Huntersville", "Concord"]) } : OFFICE[u.branch].geo;
      const ip = remote ? `192.0.2.${ri(10, 250)}` : OFFICE[u.branch].ip;
      if (chance(0.02)) logins.push({ occurred_at: ts(day, 7, ri(40, 59)), username: u.username, success: false, method: "signin", ip, user_agent: ua, accept_language: "en-US,en;q=0.9", edge_region: "iad", geo: JSON.stringify(geo), geo_source: "ipwho.is" });
      logins.push({ occurred_at: ts(day, ri(7, 9), ri(0, 59)), username: u.username, success: true, method: "signin", ip, user_agent: ua, accept_language: "en-US,en;q=0.9", edge_region: "iad", geo: JSON.stringify(geo), geo_source: "ipwho.is" });
      if (chance(0.2)) logins.push({ occurred_at: ts(day, ri(13, 16), ri(0, 59)), username: u.username, success: true, method: "signin", ip, user_agent: ua, accept_language: "en-US,en;q=0.9", edge_region: "iad", geo: JSON.stringify(geo), geo_source: "ipwho.is" });
    }
  }
  await insertMany("login_events", ["occurred_at", "username", "success", "method", "ip", "user_agent", "accept_language", "edge_region", "geo", "geo_source"], logins, null);
  await db.query("UPDATE users u SET last_active_at = (SELECT max(occurred_at) FROM login_events l WHERE l.username = u.username AND l.success)");
  await db.query("SELECT setval('doc_numbers', $1)", [docNo + 10]);

  const counts = (await db.query(`SELECT (SELECT count(*) FROM clients) c, (SELECT count(*) FROM policies) p, (SELECT count(*) FROM activities) a, (SELECT count(*) FROM activities WHERE status IN ('open','waiting')) ao,
    (SELECT count(*) FROM emails) e, (SELECT count(*) FROM certificates) ce, (SELECT count(*) FROM claims) cl, (SELECT count(*) FROM invoices) i, (SELECT count(*) FROM ledger_entries) l, (SELECT count(*) FROM login_events) le`)).rows[0];
  console.log(`seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, counts);
  await db.end();
}

main().catch(async (err) => { console.error(err); try { await db.end(); } catch {} process.exit(1); });
