// Reference labels shared by screens, the seed script's vocabulary and the email classifier.

export const LOBS: Record<string, { label: string; type: "personal" | "commercial" }> = {
  PA: { label: "Personal Auto", type: "personal" },
  HO: { label: "Homeowners", type: "personal" },
  DP: { label: "Dwelling Fire", type: "personal" },
  UMB: { label: "Personal Umbrella", type: "personal" },
  WTR: { label: "Watercraft", type: "personal" },
  BOP: { label: "Businessowners", type: "commercial" },
  GL: { label: "General Liability", type: "commercial" },
  PROP: { label: "Commercial Property", type: "commercial" },
  CA: { label: "Commercial Auto", type: "commercial" },
  WC: { label: "Workers' Compensation", type: "commercial" },
  CUMB: { label: "Commercial Umbrella", type: "commercial" },
  IM: { label: "Inland Marine", type: "commercial" },
  CYB: { label: "Cyber Liability", type: "commercial" },
  PL: { label: "Professional Liability", type: "commercial" },
};
export const lobLabel = (c: string) => LOBS[c]?.label ?? c;

export const POLICY_STATUS_LABEL: Record<string, string> = {
  quote: "Quote", bound: "Bound", active: "In force", pending_cancel: "Pending cancel", cancelled: "Cancelled",
  non_renewed: "Non-renewed", lost: "Lost", expired: "Expired",
};

export const RENEWAL_STAGES = ["not_started", "in_review", "remarketing", "quoted", "presented", "renewed", "lost", "non_renewed"] as const;
export const RENEWAL_STAGE_LABEL: Record<string, string> = {
  not_started: "Not started", in_review: "In review", remarketing: "Remarketing", quoted: "Quoted",
  presented: "Presented", renewed: "Renewed", lost: "Lost", non_renewed: "Non-renewed",
};

export const OPP_STAGES = ["lead", "qualifying", "submitted", "quoted", "proposal", "won", "lost"] as const;
export const OPP_STAGE_LABEL: Record<string, string> = {
  lead: "Lead", qualifying: "Qualifying", submitted: "Submitted", quoted: "Quoted", proposal: "Proposal", won: "Won", lost: "Lost",
};

export const SUBMISSION_STATUS_LABEL: Record<string, string> = {
  preparing: "Preparing", submitted: "Submitted", waiting_on_carrier: "Waiting on carrier", waiting_on_client: "Waiting on client",
  quoted: "Quoted", declined: "Declined", bound: "Bound", closed: "Closed",
};

export const WAITING_LABEL: Record<string, string> = { client: "client", carrier: "carrier", internal: "internal", other: "someone else" };

export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DOC_FOLDERS = ["Policy", "Applications", "Certificates", "Claims", "Billing", "Correspondence", "Email", "Loss runs", "Statements"];

export const CANCEL_REASONS = ["Insured request", "Non-payment", "Underwriting", "Rewritten elsewhere", "Sold property / vehicle", "Out of business"];

export const STATES = ["NC", "SC", "VA", "GA", "TN", "FL", "TX", "CA", "NY"];
