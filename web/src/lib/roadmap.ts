// Features that appear in the interface but are not part of the MVP (docs/AMS-MVP-Scope.md).
// Every annotation in the UI comes from this list, keyed by the master catalog ID, and
// Admin → Roadmap lists them all. "pending" marks MVP features waiting on an outside dependency.

export type RoadmapItem = { id: string; label: string; kind: "not_mvp" | "pending"; phase: string; why: string };

export const ROADMAP: Record<string, RoadmapItem> = {
  "SAL-19": { id: "SAL-19", label: "Drip campaigns", kind: "not_mvp", phase: "Phase 2", why: "Marketing automation is deferred; integrate an AgencyZoom-class tool." },
  "SAL-26": { id: "SAL-26", label: "NPS survey", kind: "not_mvp", phase: "Phase 2", why: "Surveys and review requests are deferred." },
  "SAL-29": { id: "SAL-29", label: "Cross-sell suggestions", kind: "not_mvp", phase: "Phase 2", why: "Cross-sell analytics are deferred." },
  "PLC-18": { id: "PLC-18", label: "Comparative rater", kind: "not_mvp", phase: "Phase 2", why: "Rater integration (EZLynx / PL Rating class) is phase 2." },
  "PLC-19": { id: "PLC-19", label: "Real-time commercial quoting", kind: "not_mvp", phase: "Phase 2", why: "Carrier quoting APIs are phase 2." },
  "PLC-46": { id: "PLC-46", label: "Proposal builder", kind: "not_mvp", phase: "Phase 2", why: "Proposal generation is deferred." },
  "PLC-08": { id: "PLC-08", label: "Client-completed digital application", kind: "not_mvp", phase: "Phase 2", why: "Digital intake forms ship with the client portal." },
  "CON-01": { id: "CON-01", label: "Carrier download (IVANS)", kind: "pending", phase: "MVP · pending IVANS certification", why: "Policy, commission and eDocs download need IVANS vendor certification. Until then use AI document intake and statement import." },
  "CON-18": { id: "CON-18", label: "Real-time carrier inquiry", kind: "not_mvp", phase: "Phase 2", why: "Billing/claims inquiry through carrier connectivity is phase 2." },
  "CON-19": { id: "CON-19", label: "Carrier portal single sign-on", kind: "not_mvp", phase: "Phase 2", why: "MVP stores portal links only." },
  "PRT-01": { id: "PRT-01", label: "Client portal invite", kind: "not_mvp", phase: "Phase 2", why: "The client portal and mobile app are phase 2." },
  "CRT-11": { id: "CRT-11", label: "Insured self-service certificates", kind: "not_mvp", phase: "Phase 2", why: "Ships with the client portal." },
  "CRT-12": { id: "CRT-12", label: "Certificate QR validation", kind: "not_mvp", phase: "Phase 2", why: "Holder verification links are phase 2." },
  "WRK-22": { id: "WRK-22", label: "Two-way texting", kind: "not_mvp", phase: "Phase 2", why: "SMS needs a messaging provider and TCPA tooling; consent capture is in the MVP." },
  "WRK-23": { id: "WRK-23", label: "Click-to-call / phone integration", kind: "not_mvp", phase: "Phase 2", why: "VoIP integration is phase 2." },
  "GL-12": { id: "GL-12", label: "Full general ledger", kind: "not_mvp", phase: "Phase 2", why: "MVP keeps the insurance sub-ledger and exports to QuickBooks." },
  "GL-03": { id: "GL-03", label: "Check printing", kind: "not_mvp", phase: "Phase 2", why: "MVP records checks written outside the system." },
  "GL-19": { id: "GL-19", label: "Budgets", kind: "not_mvp", phase: "Phase 2", why: "Budgets live in the general ledger, phase 2." },
  "TAX-06": { id: "TAX-06", label: "Stamping-office filing", kind: "not_mvp", phase: "Phase 2", why: "Most retail E&S is filed by the wholesaler." },
  "COM-27": { id: "COM-27", label: "Commission forecasting", kind: "not_mvp", phase: "Phase 2", why: "Forecasting is deferred." },
  "CMP-02": { id: "CMP-02", label: "NIPR sync and appointments", kind: "not_mvp", phase: "Phase 2", why: "MVP tracks licenses manually." },
  "RPT-02": { id: "RPT-02", label: "Custom dashboards", kind: "not_mvp", phase: "Phase 2", why: "MVP ships a fixed report library with CSV export." },
  "RPT-14": { id: "RPT-14", label: "Peer benchmarking", kind: "not_mvp", phase: "Phase 2", why: "Benchmarking needs market data." },
  "CLM-06": { id: "CLM-06", label: "Reserves and claim payments", kind: "not_mvp", phase: "Phase 2", why: "Carriers own claim financials." },
  "BEN-01": { id: "BEN-01", label: "Employee benefits", kind: "not_mvp", phase: "Later", why: "Benefits is a different buyer and workflow." },
  "ADM-01P": { id: "ADM-01P", label: "In-app password management", kind: "not_mvp", phase: "Phase 2", why: "Passwords are issued like the Underwriting Desktop: BASIC_AUTH_USERS secret via scripts/fly-users.sh." },
  "PLC-22": { id: "PLC-22", label: "Carrier data bridging", kind: "not_mvp", phase: "Phase 2", why: "MVP stores portal links only." },
  "CSH-09": { id: "CSH-09", label: "Payment links", kind: "pending", phase: "MVP · needs payment processor", why: "Card/ACH payment links turn on with a payment-processor account (ePayPolicy class). Receipts are recorded manually until then." },
  "WRK-20S": { id: "WRK-20S", label: "Mailbox sync and Outlook/Gmail add-in", kind: "not_mvp", phase: "Phase 2", why: "MVP takes email by forwarding or copying to an inbox alias. Reading whole mailboxes over Microsoft Graph or the Gmail API, and a one-click add-in, come later." },
  "WRK-25O": { id: "WRK-25O", label: "Send email from the AMS", kind: "pending", phase: "MVP · needs SMTP settings", why: "Replies and certificates are emailed once SMTP_URL is set. Until then they are only logged." },
};

/** What staff see on the control. "pending" is built but waits on an outside dependency, so someone can act on it. */
export const roadmapBadge = (r?: Pick<RoadmapItem, "kind">) => (r?.kind === "pending" ? "Needs setup" : "Coming later");

export const roadmapList = () => Object.values(ROADMAP).sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
