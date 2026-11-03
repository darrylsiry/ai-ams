# AI AMS — MVP Scope

**What this is.** The subset of the master process catalog ([AMS-Process-Catalog.md](AMS-Process-Catalog.md)) that the first release must support. The master catalog stays the source of truth. This document only references master IDs and adds an MVP scope note where the MVP version is narrower than the master description.

**Confidentiality.** Inherits the master catalog's rule: internal only.

**Counts.** 269 of 616 master processes are in the MVP: 155 Full and 114 Lite. Four master domains are deferred entirely (portals, benefits, wholesale/MGA, international).

---

## 1. MVP target

| Dimension | MVP assumption |
|---|---|
| Customer | US independent retail P&C agency, roughly 5–50 staff, one legal entity, one or a few branches |
| Lines | Personal lines (auto, home, umbrella) and small commercial (BOP, GL, property, commercial auto, WC) |
| Billing | Direct bill majority, with agency bill supported |
| Goal | Replace the incumbent AMS for daily operations: system of record, servicing, renewals, certificates, commission reconciliation |
| Accounting posture | Insurance sub-ledger plus premium trust inside the AMS; general ledger stays in QuickBooks or similar via export |
| AI posture | AI assists the high-volume document work (policy checking, document intake, commission statements, COI requests, renewal comparison) with human confirmation |

These assumptions drive every cut below. Changing any of them changes the list. The biggest swing factors are the accounting posture and whether IVANS download is available at launch.

## 2. Scoping rules

A master process is in the MVP if at least one of these holds:
1. **Daily operations depend on it.** An agency cannot run a normal day without it.
2. **E&O or regulatory exposure.** Leaving it out creates errors-and-omissions or compliance risk.
3. **Switching blocker.** Agencies will not migrate without it (data conversion, download, certificates).
4. **Core AI differentiator.** It is where the AI-native design visibly beats incumbents.

Processes are marked **Full** when the master description applies as written, or **Lite** when a narrower version ships first. Lite scope is stated in the note.

---

## 3. MVP process list

### 3.1 Parties & Accounts (CRM)
| ID | Process | Scope | MVP note |
|---|---|---|---|
| CRM-01 | Unified account master | Lite | Client, company, broker, employee, finance company, vendor, other interest. One model, typed subtypes. |
| CRM-02 | Create / update client | Full | |
| CRM-03 | Convert prospect to insured | Full | |
| CRM-04 | Inactivate / reactivate account | Full | |
| CRM-05 | Maintain company (carrier) account | Lite | Bill mode, NAIC, issuing vs premium-payable flags, parent company. Ratings and regulatory IDs later. |
| CRM-06 | Maintain broker / intermediary account | Lite | Wholesalers and MGAs used for placement. No payable-contract engine. |
| CRM-07 | Maintain employee account | Lite | Producer flags and commission eligibility. No shared-revenue organizations. |
| CRM-08 | Maintain finance company account | Full | |
| CRM-09 | Maintain vendor account | Lite | Payee details only, for refunds and payables export. |
| CRM-10 | Maintain other-interest account | Full | Reused by certificates and additional interests. |
| CRM-11 | Account search | Full | Including phone/email lookup for inbound calls. |
| CRM-12 | Global search | Full | |
| CRM-13 | Natural-language search and Q&A | Lite | Read-only Q&A over the account file. |
| CRM-14 | Duplicate detection | Full | |
| CRM-15 | Merge duplicates and move items | Lite | Merge clients and contacts. Moving individual items later. |
| CRM-16 | Household / group linkage | Lite | Household grouping for personal lines. |
| CRM-19 | Insured item schedules | Full | Vehicles, drivers, locations reused across policies. |
| CRM-20 | Maintain contacts | Full | |
| CRM-21 | Primary and main business contact | Full | |
| CRM-22 | Contact preferences | Full | Including do-not-call and channel preferences. |
| CRM-23 | Sensitive personal identifiers | Full | Field-level permission and encryption from day one. |
| CRM-26 | Relationship types and roles | Lite | Fixed starter set of relationship types. |
| CRM-28 | Account sources | Full | |
| CRM-30 | Industry classification | Lite | NAICS and SIC lookup only. |
| CRM-31 | Custom fields and tags | Lite | Tags on clients and policies. |
| CRM-33 | Organization hierarchy | Lite | Agency and branch only. Departments and profit centers later. |
| CRM-37 | Servicing roles | Full | |
| CRM-38 | Assign servicing roles | Lite | Account and line level. Submission level later. |

### 3.2 Sales, Leads & Marketing
| ID | Process | Scope | MVP note |
|---|---|---|---|
| SAL-01 | Lead capture | Lite | Web form and manual entry create a prospect and task. Lead vendor feeds later. |
| SAL-06 | X-date tracking | Full | |
| SAL-08 | Create / update opportunity | Lite | Lines, stage, owner, estimated premium, close date. |
| SAL-10 | Configurable pipeline stages | Lite | Editable stage list. No per-stage prompts. |
| SAL-12 | Mark won / lost with reasons | Full | Closed-won launches policy setup. |
| SAL-28 | Marketing preferences and opt-outs | Full | Needed for TCPA and CAN-SPAM even without campaigns. |

### 3.3 Quoting, Applications & Placement
| ID | Process | Scope | MVP note |
|---|---|---|---|
| PLC-01 | Exposure analysis / coverage checklist | Lite | Per-line checklist recording offered, accepted, declined. |
| PLC-04 | Non-admitted disclosure and acknowledgments | Full | E&O and regulatory requirement. |
| PLC-05 | Capture application data | Lite | Generic risk model plus the core schedules in POL-64 to POL-72. |
| PLC-06 | ACORD form generation and prefill | Lite | Forms 25, 27, 35, 80, 90, 125, 126, 127, 130, 140. Requires an ACORD distribution license. |
| PLC-11 | AI autofill from documents | Lite | Dec pages and prior applications into the risk model, with confirmation. |
| PLC-13 | Loss-run request | Lite | Request letter, log and follow-up task. |
| PLC-16 | Required-document checklist | Lite | Per line, not per carrier. |
| PLC-17 | eSignature | Lite | Through one integrated provider. |
| PLC-22 | Bridge to carrier portals | Lite | Stored portal links per carrier. No data bridging. |
| PLC-29 | Create marketing submission | Lite | Submission groups lines for a client. |
| PLC-31 | Create carrier submission | Lite | Per-market record with emailed packet. No carrier API. |
| PLC-32 | Track carrier submission status | Full | |
| PLC-33 | Record carrier response | Lite | Premium, commission, declination reason. |
| PLC-36 | AI capture of submission emails and replies | Lite | Summarize carrier replies onto the submission. |
| PLC-41 | Move marketed lines to current policy | Full | Bound submission becomes the policy. |
| PLC-48 | Proposal decision capture and declination documentation | Full | E&O requirement. |
| PLC-51 | Binder issuance and management | Lite | Issue, extend, close, binder expiry follow-up. |

### 3.4 Policy Administration
| ID | Process | Scope | MVP note |
|---|---|---|---|
| POL-01 | Create policy | Full | |
| POL-02 | Create / update lines | Full | ACORD standards body only. |
| POL-03 | Policy stage tracking | Lite | Submitted, issued, not issued, cancelled, lapsed. |
| POL-04 | Transaction lineage per line | Lite | New, renew, endorse, cancel, reinstate, rewrite. |
| POL-05 | Package vs monoline policies | Full | |
| POL-12 | Tax option per line | Lite | Auto-generate or exempt. |
| POL-13 | Delivery method per policy | Full | |
| POL-14 | Link policy to submission and opportunity | Full | |
| POL-15 | Prior policy number tracking | Full | |
| POL-17 | AI policy intake from documents | Lite | Carrier PDFs into policy, lines and schedules, with confirmation. Covers non-download carriers. |
| POL-18 | Policy setup from quote or submission | Full | |
| POL-19 | Issue / not issue policy | Full | |
| POL-20 | Policy checking | Full | Core AI differentiator. Compare issued policy to binder, quote and expiring. |
| POL-23 | Policy delivery | Lite | Email with attachment and portal-free tracking of delivery. |
| POL-26 | Service request intake and routing | Full | |
| POL-27 | Endorse / revise existing line | Full | |
| POL-28 | Endorse: add line mid-term | Full | |
| POL-29 | Issue / not issue endorsement | Full | |
| POL-31 | Driver, vehicle, location and limit changes | Full | |
| POL-32 | Named insured change | Lite | Single policy at a time. |
| POL-33 | Maintain additional interests | Full | |
| POL-34 | Forms and endorsements schedule | Lite | Form number, edition, description. |
| POL-35 | Remarks | Full | |
| POL-41 | Carrier notification coordination | Lite | Triage queue for carrier emails and eDocs by priority. |
| POL-48 | Cancel policy | Full | |
| POL-49 | Issue cancellation and return premium | Full | |
| POL-50 | Pending cancellation tracking | Full | |
| POL-51 | Carrier-initiated cancellation handling | Full | E&O requirement. |
| POL-52 | Reinstate policy | Full | |
| POL-53 | Rewrite | Full | |
| POL-54 | Non-renewal handling | Full | |
| POL-56 | Premium finance servicing on cancellation | Lite | Notify finance company task and return-premium routing. |
| POL-57 | Premium audit management | Lite | Audit tracking and follow-up tasks. |
| POL-58 | Audit premium invoice / revision | Full | |
| POL-64 | Personal auto risk detail | Lite | Vehicles, drivers, violations, coverages. No state variants. |
| POL-65 | Residential risk detail | Lite | Homeowners and dwelling: dwelling info, coverages, endorsements. |
| POL-66 | Personal umbrella; watercraft | Lite | Underlying schedule and basic watercraft. |
| POL-67 | Commercial application detail | Lite | Applicant, premises, prior carrier, loss history. |
| POL-68 | General liability risk detail | Lite | Classifications and exposures. |
| POL-69 | Property risk detail | Lite | Premises, subjects of insurance, values. |
| POL-70 | Business auto risk detail | Lite | Vehicles, drivers, coverages. |
| POL-72 | Workers' compensation risk detail | Lite | Locations, class codes, payroll, officers. No assigned-risk variants. |
| POL-73 | Other commercial lines | Lite | BOP and commercial umbrella only, through the generic risk model. |
| POL-76 | Custom forms | Lite | Generic schedule for any line without a dedicated model. |
| POL-78 | Line-level attachments | Full | |

### 3.5 Certificates & Evidence of Insurance
| ID | Process | Scope | MVP note |
|---|---|---|---|
| CRT-01 | Create certificate | Lite | ACORD 25 liability and ACORD 24/27 property. Intermodal later. |
| CRT-02 | Coverage sections | Full | |
| CRT-03 | Certificate holders | Full | |
| CRT-04 | Master certificate and templates | Full | |
| CRT-05 | COI request intake | Full | AI classification of emailed requests. |
| CRT-06 | COI coverage verification | Full | AI checks required wording against policy. |
| CRT-07 | Issue and distribute certificates | Full | Including batch to all holders. |
| CRT-09 | Renew certificates | Full | Switching blocker for commercial books. |
| CRT-10 | Attach endorsements to certificates | Full | |
| CRT-14 | Auto ID cards | Lite | Generate and email. No portal. |
| CRT-15 | Evidence of property insurance | Full | |
| CRT-17 | Log every certificate action | Full | |

### 3.6 Claims
| ID | Process | Scope | MVP note |
|---|---|---|---|
| CLM-01 | FNOL intake and logging | Full | |
| CLM-02 | Record claim | Full | |
| CLM-03 | Submit claim to carrier | Lite | ACORD loss notice or carrier link, with confirmation logged. |
| CLM-04 | Adjusters and parties | Lite | Adjuster and claimant contacts. |
| CLM-07 | Claim status follow-up | Full | |
| CLM-08 | Close / reopen claim | Full | |
| CLM-09 | Claims by client and attachments | Full | |
| CLM-11 | Loss runs | Lite | Store received loss runs per client. |

### 3.7 Billing & Receivables
| ID | Process | Scope | MVP note |
|---|---|---|---|
| BIL-01 | Agency bill invoicing | Full | |
| BIL-02 | Direct bill recording | Full | |
| BIL-03 | Premium payable vs issuing company | Full | |
| BIL-04 | Transaction codes | Lite | Seeded code set, limited editing. |
| BIL-05 | Create transaction / invoice | Full | |
| BIL-06 | Endorsement invoice | Full | |
| BIL-07 | Audit premium invoice | Full | |
| BIL-08 | Cancellation / return premium credit | Full | |
| BIL-09 | Installment plans | Lite | Fixed schedules. No invoice grouping rules. |
| BIL-12 | Producer splits per transaction | Lite | Default from agreements with override. |
| BIL-13 | Generate taxes and fees | Lite | From rate table in TAX-01. |
| BIL-14 | Revise premium | Full | |
| BIL-17 | Agency, broker and policy fees | Full | Including broker-fee disclosure flag. |
| BIL-23 | Apply / unapply credits to debits | Full | |
| BIL-24 | Receivable write-off | Full | |
| BIL-25 | Reverse transaction; void payment | Full | |
| BIL-29 | Finance transaction | Lite | Agency-forwarded and carrier-paid flows. No finance quoting. |
| BIL-31 | Open receivables and cash on account | Full | |
| BIL-32 | Aged receivables and dunning | Full | |
| BIL-33 | Client statements and invoices | Lite | One layout, email and PDF. |
| BIL-34 | Customer account reconciliation | Full | |

### 3.8 Cash & Payments
| ID | Process | Scope | MVP note |
|---|---|---|---|
| CSH-01 | Enter receipt | Full | |
| CSH-02 | Apply during receipt | Full | |
| CSH-03 | Finalize receipt; bank status | Full | |
| CSH-04 | Transfer of funds | Lite | Trust-to-operating sweep only. |
| CSH-05 | Deposit creation and register | Full | |
| CSH-09 | Online card / ACH acceptance | Lite | Payment links through one processor. |
| CSH-11 | Payment posting from processor | Full | |
| CSH-16 | NSF / returned payment reversal | Full | |
| CSH-17 | Refunds | Full | |
| CSH-19 | PCI / NACHA via tokenization | Full | No card data stored in the AMS. |

### 3.9 Payables, General Ledger & Close
| ID | Process | Scope | MVP note |
|---|---|---|---|
| GL-01 | Create voucher | Lite | Carrier, refund and producer payables only. |
| GL-03 | Disbursement | Lite | Record checks and ACH paid outside. Check printing later. |
| GL-04 | Carrier payable — pay by statement | Full | Core agency-bill workflow. |
| GL-05 | Carrier payable — pay by item | Full | |
| GL-06 | Return premium from carrier | Full | |
| GL-09 | Producer commission payables | Full | |
| GL-10 | Finance company payables and client refunds | Full | |
| GL-17 | GL export | Full | Summarized journal export to QuickBooks and CSV. Replaces an internal GL for MVP. |
| GL-20 | Accounting method configuration | Lite | Accrual on invoice; producer paid on carrier payment. |
| GL-23 | Premium trust accounting | Full | Regulatory requirement. |
| GL-24 | Trust-to-operating sweep | Full | |
| GL-25 | Statement of premium trust | Full | |
| GL-27 | Bank reconciliation | Lite | Trust account only. |
| GL-28 | Direct bill commission reconciliation | Full | See COM-11 to COM-21. |
| GL-29 | Premium (carrier payable) reconciliation | Full | |
| GL-30 | Producer payable reconciliation | Full | |
| GL-33 | Statement lifecycle governance | Lite | Draft, finalized, reopened. |
| GL-34 | Month-end close | Lite | Lock period and balancing reports. |

### 3.10 Taxes & Fees
| ID | Process | Scope | MVP note |
|---|---|---|---|
| TAX-01 | Tax/fee rate tables | Lite | Surplus lines tax and stamping fee by state, seeded and editable. |
| TAX-02 | Surplus lines tax calculation | Full | |
| TAX-03 | Stamping fee calculation | Full | |
| TAX-04 | Fee taxability flagging | Full | |
| TAX-16 | Policy, inspection and company fees | Full | |
| TAX-17 | Broker fee disclosure and refund | Full | |

### 3.11 Commissions & Compensation
| ID | Process | Scope | MVP note |
|---|---|---|---|
| COM-01 | Carrier commission agreements | Lite | Percentage of premium by carrier, line, new vs renewal. |
| COM-02 | Producer commission agreements | Lite | Percentage of commission by producer, new vs renewal. |
| COM-07 | Producer splits and overrides | Full | |
| COM-09 | House account handling | Full | |
| COM-11 | Statement intake — download | Lite | Depends on IVANS availability (see section 5). |
| COM-12 | Statement intake — import | Full | Carrier CSV/Excel mapping. |
| COM-14 | Statement intake — AI/PDF | Full | Core AI differentiator. |
| COM-15 | Auto-match and manual match | Full | |
| COM-16 | Partial pay on direct bill items | Full | |
| COM-17 | Commission variance adjustment | Full | |
| COM-18 | Close item without commission | Full | |
| COM-19 | Statement-to-deposit association | Full | |
| COM-20 | Statement totals balancing | Full | |
| COM-21 | Missing / short-paid detection | Full | |
| COM-23 | Producer payable statements | Full | |
| COM-24 | Chargebacks on cancellation | Full | |

### 3.12 Renewals & Retention
| ID | Process | Scope | MVP note |
|---|---|---|---|
| REN-01 | Expiration / renewal lists | Full | |
| REN-02 | Renewal timeline kickoff by line | Full | Configurable lead times by line. |
| REN-03 | Pre-renewal file review | Lite | Checklist task. |
| REN-04 | Renewal questionnaire | Lite | Emailed questionnaire and follow-up. |
| REN-06 | Remarket decision and documentation | Full | E&O requirement. |
| REN-07 | Remarketing submission | Full | Copies expiring line into a submission. |
| REN-09 | Prepare renewal draft | Full | |
| REN-10 | Renew policy | Full | |
| REN-12 | Renewal via download | Lite | Depends on IVANS availability. |
| REN-14 | Expiring vs renewal comparison | Full | Core AI differentiator, with uprate alerts. |
| REN-17 | Renewal invoicing and certificate reissue | Full | |
| REN-18 | Renewal confirmation and delivery | Full | |
| REN-19 | Non-renewal notice processing | Full | |
| REN-23 | Retention risk flags | Lite | Rule-based flags. Predictive scoring later. |
| REN-25 | Lost-business tracking | Full | |

### 3.13 Activities, Workflow & Communication
| ID | Process | Scope | MVP note |
|---|---|---|---|
| WRK-01 | Create activity | Full | |
| WRK-02 | Attach activities to any item | Lite | All MVP objects. |
| WRK-03 | Note access levels | Lite | Standard and confidential. |
| WRK-04 | System-generated activities | Full | |
| WRK-05 | Activity code configuration | Lite | Seeded codes with defaults. |
| WRK-06 | Suspense / diary management | Full | |
| WRK-07 | Work queues | Full | Personal and team. |
| WRK-08 | Task stages and checklists | Lite | Checklists per service request type. |
| WRK-09 | Activity logging standards | Full | Enforced by design. |
| WRK-14 | Event-triggered automation | Lite | Fixed trigger set, task and email actions. |
| WRK-20 | Two-way email integration | Full | Outlook and Gmail. Switching blocker. |
| WRK-21 | AI email agent | Lite | Classify, summarize, file and suggest a task. |
| WRK-24 | Letter templates and mail merge | Lite | Starter library by lifecycle stage. |
| WRK-25 | Delivery by recipient preference | Lite | Email and print. |
| WRK-29 | Voicemail and email disclaimers | Full | |

### 3.14 Documents & Attachments
| ID | Process | Scope | MVP note |
|---|---|---|---|
| DOC-01 | Attachments with upload, download, versions | Full | |
| DOC-02 | Multi-link attachments | Full | |
| DOC-03 | Folder taxonomy | Lite | Seeded folders. |
| DOC-04 | Attachment access levels | Lite | Standard and restricted. |
| DOC-05 | Move, delete, reactivate attachments | Full | |
| DOC-08 | Drag-and-drop and auto-attach | Full | |
| DOC-09 | Scanning, OCR and extraction | Lite | OCR and AI extraction on upload. No TWAIN. |
| DOC-10 | Naming conventions and summary notes | Full | AI-generated summaries. |
| DOC-11 | Retention and disposition schedules | Lite | Retention policy setting; disposition later. |
| DOC-13 | Form mapping and fillable PDFs | Lite | Supports PLC-06 form set. |

### 3.15 Carrier Connectivity & Data Exchange
| ID | Process | Scope | MVP note |
|---|---|---|---|
| CON-01 | Policy download | Lite | IVANS AL3 personal and commercial. Critical path (section 5). |
| CON-02 | Direct bill commission statement download | Lite | IVANS DBCS. |
| CON-04 | eDocs and messages download | Lite | Auto-attach and triage. |
| CON-06 | Download suspense handling | Full | |
| CON-08 | Download matching criteria | Lite | Global defaults. |
| CON-09 | Download-driven alerts and activities | Full | |
| CON-10 | Renewal download merge | Lite | |
| CON-26 | Public APIs and webhooks | Lite | Read APIs and webhooks for core objects. |
| CON-28 | GL export and data feeds | Lite | GL export and full data export. |
| CON-29 | Payment platform integration | Lite | One processor. |
| CON-34 | eSignature integration | Lite | One provider. |

### 3.16 Configuration, Security & Administration
| ID | Process | Scope | MVP note |
|---|---|---|---|
| ADM-01 | Users and logins | Full | SSO, MFA and session time-out included. |
| ADM-02 | Role-based permissions | Lite | Role-based with branch restriction. |
| ADM-03 | Sensitive data permissions | Full | |
| ADM-04 | Audit trail | Full | Immutable change history from day one. |
| ADM-05 | Code tables | Lite | Seeded, admin-editable. |
| ADM-06 | System settings | Lite | |
| ADM-10 | Document types and folders | Lite | |
| ADM-14 | Localization | Lite | en-US and ACORD only. |
| ADM-16 | Data quality management | Lite | Duplicates and missing required fields. |
| ADM-18 | Organization structure configuration | Lite | Agency and branch. |

### 3.17 Compliance, Licensing & E&O
| ID | Process | Scope | MVP note |
|---|---|---|---|
| CMP-01 | Producer license tracking | Lite | License records with expiry reminders. No NIPR sync. |
| CMP-12 | Coverage declination and advice documentation | Full | |
| CMP-13 | Records retention | Lite | Policy setting and legal hold. |
| CMP-14 | Cybersecurity program support | Lite | Controls needed for agency NYDFS Part 500 attestation. |
| CMP-15 | Information security and privacy | Full | SOC 2 readiness is a sales requirement. |
| CMP-17 | Texting and calling consent | Full | |
| CMP-22 | OFAC screening | Lite | Screen at bind for commercial insureds. |

### 3.18 Reporting & Analytics
| ID | Process | Scope | MVP note |
|---|---|---|---|
| RPT-01 | Report library and builder | Lite | Fixed library with filters and CSV export. |
| RPT-03 | Book of business | Full | |
| RPT-04 | Expiration, renewal and retention | Full | |
| RPT-05 | Production reports | Lite | By producer, carrier, line. |
| RPT-06 | Receivables reports | Full | |
| RPT-07 | Payables and commission reports | Full | |
| RPT-09 | Activity and productivity | Lite | |
| RPT-11 | Download exceptions | Full | |
| RPT-12 | Binder, holder and coverage snapshot | Lite | |
| RPT-18 | Data exports | Full | |

### 3.19 Platform & Migration
| ID | Process | Scope | MVP note |
|---|---|---|---|
| PLT-01 | Cloud, browser-native | Full | |
| PLT-02 | Data conversion / migration | Full | Switching blocker. Start with exports from the largest incumbents. |
| PLT-04 | On-demand data export and backups | Full | |
| PLT-08 | AI-assisted operations | Lite | Delivered through the AI-tagged processes above. |

---

## 4. Explicitly deferred

| Domain | Deferred | Reason |
|---|---|---|
| Sales & marketing | Drip campaigns, websites, reviews, NPS, referral programs, sales intelligence, cross-sell analytics | Many agencies use AgencyZoom-class tools. Integrate later rather than rebuild. |
| Quoting | Comparative rating, real-time commercial quoting, carrier APIs, proposals | Raters are separate products. Integrate EZLynx/PL Rating-class raters in phase 2. |
| Policy | Multi-carrier and multi-commission schedules, custom policy fields, specialty lines (truckers, surety, garage, inland marine, Canadian), fee-for-service contracts, BOR workflow | Low frequency for the MVP target. |
| Certificates | Insured self-service, QR validation, intermodal | Phase 2 alongside portals. |
| Claims | Litigation, payments and reserves, claims download | Carriers own claim handling. |
| Accounting | Internal general ledger, chart of accounts, allocations, journal entries, financial statements, budgets, multi-entity, revenue deferral, contingent accruals | MVP exports to an external GL. Full GL is the largest phase-2 item. |
| Taxes | Stamping-office filing, remittance, affidavits, FET, municipal taxes | Most retail agencies place E&S through wholesalers who file. |
| Commissions | Payable-contract engine, multi-term agreements, tiers and overrides, forecasting, contingents | Simple percentage agreements cover the MVP target. |
| Portals | All of Domain 15 | Phase 2. |
| Connectivity | Real-time inquiry, carrier SSO, appetite, submissions API, CSIO, book roll | Phase 2 after download is stable. |
| Compliance | NIPR sync, appointments, carrier relationship management, E&O audit tooling | Phase 2. |
| Reporting | Dashboards, benchmarking, forecasting, custom builder | Phase 2. |
| Benefits | All of Domain 20 | Different buyer and workflow. |
| Wholesale / MGA | All of Domain 21 | Different product. |
| International | All of Domain 22 | US first. |

## 5. Critical dependencies

- **IVANS download.** CON-01, CON-02, CON-04, COM-11, REN-12 and the download alerts depend on becoming an IVANS-certified vendor, which takes months. Until then, AI document intake (POL-17, COM-14) carries the load for carrier data.
- **ACORD forms license.** PLC-06 and CRT-01 require an ACORD distribution agreement.
- **Payment processor and eSignature partners.** CSH-09 and PLC-17 assume one partner each.
- **Data conversion.** PLT-02 needs export formats from the major AMS platforms to win switching customers.
- **Security posture.** CMP-15 and ADM-04 are prerequisites for selling to agencies with carrier and NYDFS obligations.

## 6. AI differentiators in the MVP

| Process | What the AI does |
|---|---|
| POL-20 Policy checking | Compares issued policy to binder, quote and expiring term and lists discrepancies |
| POL-17 Policy intake | Turns carrier PDFs into structured policies and schedules |
| COM-14 Statement intake | Reads commission statements in any format and proposes matches |
| CRT-05 and CRT-06 COI requests | Classifies requests and checks required wording against coverage |
| REN-14 Renewal comparison | Summarizes premium and coverage changes and flags remarket candidates |
| WRK-21 Email agent | Files email to the right account, summarizes, proposes the next task |
| PLC-11 Application autofill | Prefills risk data from dec pages and prior applications |
| PLC-36 Submission replies | Summarizes carrier replies onto the submission |
| CRM-13 Account Q&A | Answers questions over the account file |

## 7. Maintaining this list

- The master catalog owns IDs and descriptions. IDs are never renumbered or reused.
- To add a process to the MVP, add a row here with the master ID. To change a process definition, edit the master.
- When a deferred item is promoted, move it from section 4 into section 3.
- Record scope changes in the change log below.

## Change log

| Date | Change |
|---|---|
| 2026-10-31 | Initial MVP scope created from master catalog v1. |
