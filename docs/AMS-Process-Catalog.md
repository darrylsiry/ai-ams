# Agency Management System — Process Catalog

**Purpose.** An exhaustive inventory of the business processes an insurance Agency Management System (AMS) must support, written as the requirements backbone for the AI AMS project. It covers US and Canadian independent retail agencies and brokerages (personal and commercial P&C), with dedicated sections for employee benefits, wholesale/MGA operations, and UK/Ireland variants.

**Sources include.**
1. **Public documentation of 24 other AMS and adjacent platforms** (Vertafore AMS360/Sagitta/QQCatalyst/PL Rating/InsurLink/BenefitPoint/AIM/RiskMatch/ImageRight/AgencyZoom, HawkSoft, EZLynx, Momentum AMP, Nexsure, Jenesis, Zywave Partner/BrokerageBuilder/AgencyMatrix, Xanatek, AgencyBloc, Newton, eVo, Eclipse, Novidea, Insly, Amplo, BindHQ, Canopy Connect, Patra).
2. **Public industry sources** on agency accounting, carrier connectivity standards (IVANS, ACORD AL3/XML, CSIO), payments, surplus lines filing, licensing, E&O loss control, and agency operating procedures (Big "I", ACT, Utica National, Agency Performance Partners, ResourcePro, Rough Notes, IA Magazine, state regulators and stamping offices). Full list in Appendix D.

**Confidentiality.** Internal working document. Keep it internal.

**How to read.** Processes are grouped into 23 domains. Each has a stable ID (`CRM-07`), a name, a one-line description, and evidence tags:

| Tag | Meaning |
|---|---|
| `[Pub]` | Evidenced in public documentation of one or more AMS vendors, standards bodies, regulators or industry groups |
| `[Inf]` | Inferred as necessary from the above; not directly evidenced |

A process with no tag comes from internal analysis.

**Companion document.** The first-release subset lives in [AMS-MVP-Scope.md](AMS-MVP-Scope.md). It references IDs from this catalog, which remains the source of truth.

**Counts.** 23 domains, 616 processes. Appendix B lists standard timelines and triggers; Appendix C lists standard documents, ACORD forms and reports; Appendix D lists sources.

---

## Domain map

| # | Domain | ID prefix |
|---|---|---|
| 1 | Parties & Accounts (CRM) | CRM |
| 2 | Sales, Leads & Marketing | SAL |
| 3 | Quoting, Applications & Placement | PLC |
| 4 | Policy Administration | POL |
| 5 | Certificates & Evidence of Insurance | CRT |
| 6 | Claims | CLM |
| 7 | Billing & Receivables | BIL |
| 8 | Cash & Payments | CSH |
| 9 | Payables, General Ledger & Close | GL |
| 10 | Taxes & Fees | TAX |
| 11 | Commissions & Compensation | COM |
| 12 | Renewals & Retention | REN |
| 13 | Activities, Workflow & Communication | WRK |
| 14 | Documents & Attachments | DOC |
| 15 | Client Self-Service & Portals | PRT |
| 16 | Carrier Connectivity & Data Exchange | CON |
| 17 | Configuration, Security & Administration | ADM |
| 18 | Compliance, Licensing & E&O | CMP |
| 19 | Reporting & Analytics | RPT |
| 20 | Employee Benefits specifics | BEN |
| 21 | Wholesale / MGA specifics | MGA |
| 22 | International variants (UK, Ireland, Canada) | INT |
| 23 | Platform, Migration & Managed Services | PLT |

---

## 1. Parties & Accounts (CRM)

### 1.1 Account model and lifecycle
- **CRM-01 Maintain unified account master** — one account model with typed subtypes: client, broker, company (carrier/market), employee, finance company, vendor, other interest; each with lookup code, name, type and active status. `[Pub]`
- **CRM-02 Create / update client** — individual or business; insured vs prospect designation; custom client ID; account source; agency/branch assignment; business types (personal, commercial, benefits, bonds, agriculture, life & health, financial services, other); FEIN/DOB/website. `[Pub]`
- **CRM-03 Convert prospect to insured** when first policy binds, retaining history and pipeline linkage. `[Pub]`
- **CRM-04 Inactivate / reactivate account** with reason code. `[Pub]`
- **CRM-05 Maintain company (carrier) account** — parent company, primary contact, bill mode (agency, direct, both, none), new/renewal business allowed, business types written, issuing-company vs premium-payable designation, organization mapping, identification numbers (AM Best, NAIC, FEIN, Fitch/Moody's/S&P ratings).
- **CRM-06 Maintain broker / intermediary account** — internal vs external, business types, commissionable flag, new/renewal eligibility, national producer number, payable contracts, GL sub-account.
- **CRM-07 Maintain employee account** — lookup code, status, producer flags (commissionable, house producer, payable-contract required), shared-revenue organizations, GL sub-account, job title/department.
- **CRM-08 Maintain finance company account** for premium-financed transactions.
- **CRM-09 Maintain vendor account** — payees and service providers, including benefits enrollment-portal vendors; 1099 category. `[Pub]`
- **CRM-10 Maintain other-interest account** — mortgagees, loss payees, additional insureds, lienholders reusable across policies and certificates. `[Pub]`
- **CRM-11 Account search** — by name, lookup code, type, status; dedicated search by phone or email across accounts and their contacts for inbound-call handling. `[Pub]`
- **CRM-12 Global search** across clients, policies, documents, activities and history. `[Pub]`
- **CRM-13 Natural-language search and Q&A** over account data (AI assistant). `[Pub]`
- **CRM-14 Duplicate detection** on insert and on demand (name, email, phone, policy number). `[Pub]`
- **CRM-15 Merge duplicates and move items between accounts** (attachments, policies, drivers). `[Pub]`
- **CRM-16 Household / group / individual linkage** — view every policy for a person, household or employer group on one screen. `[Pub]`
- **CRM-17 Bulk import of prospects/customers** from CSV. `[Pub]`
- **CRM-18 KYC / sanctions screening of insured and additional insureds** before bind (OFAC). `[Pub]`
- **CRM-19 Insured item schedules** — vehicles, drivers, locations, equipment maintained at account level and reused across quotes and policies, with bulk edit. `[Pub]`

### 1.2 Contacts and people
- **CRM-20 Maintain contacts on any account type** — person or business; classifications; multiple addresses with descriptions; phones (business, mobile, residence, fax); emails; prefixes/suffixes.
- **CRM-21 Designate primary and main business contact**; change main business contact.
- **CRM-22 Capture contact preferences** — primary, billing and servicing channel preferences (phone, email, mail, fax, SMS, third party); call permission (obtained / not obtained / do-not-call); marketing-preference prompt. `[Pub]`
- **CRM-23 Hold sensitive personal identifiers** — SSN/SIN/NIN, driver's license, government IDs, with elevated scopes and user permissions.
- **CRM-24 Maintain stored payment methods** — ACH direct deposit / direct withdrawal with account type and authorization status (authorized, pending, denied); tokenized cards. `[Pub]`
- **CRM-25 Maintain reusable people** associable to multiple accounts (e.g., the same CFO on two client entities).

### 1.3 Relationships and segmentation
- **CRM-26 Define relationship types and roles** and maintain active relationships between accounts (parent/subsidiary, employer/employee, referral source, agent of record). `[Pub]`
- **CRM-27 Agency-defined categories** — custom taxonomies with options, applied to clients for segmentation, reporting and workflow routing.
- **CRM-28 Account sources** — agency-defined list of how business was obtained. `[Pub]`
- **CRM-29 Lead-source attribution** — which source/vendor/referrer gets credit per lead for ROI and referral payments. `[Pub]`
- **CRM-30 Industry classification** — SIC, UK SIC, NAICS codes; nature of business.
- **CRM-31 Custom fields and tags** at client, policy, contact, note or file level. `[Pub]`
- **CRM-32 Confidential client access** — restrict visibility of designated clients to access groups. `[Pub]`

### 1.4 Organization structure
- **CRM-33 Maintain organization hierarchy** — region, agency, branch, department, profit center; every record carries an organization combination. `[Pub]`
- **CRM-34 Map companies, employees and clients to organizations** (which offices write with which carriers; where revenue is shared).
- **CRM-35 Bulk export organizations** and reference data.
- **CRM-36 Multi-agency / multi-entity operation** — separate legal entities, shared master data, consolidated or per-entity reporting; acquired-agency onboarding. `[Pub]`

### 1.5 Servicing assignment
- **CRM-37 Define servicing roles** (producer, account manager, CSR, claims rep, marketer).
- **CRM-38 Assign servicing roles at account, line and submission level**; list, update, remove.
- **CRM-39 Sales teams** — teams, owners, membership for pipeline ownership.
- **CRM-40 Out-of-office backup designation** for servicing roles and renewal lists. `[Pub]`

---

## 2. Sales, Leads & Marketing

### 2.1 Lead management
- **SAL-01 Lead capture from web forms, quote widgets, consumer rating and partner feeds**, auto-creating the prospect record and a task/notification. `[Pub]`
- **SAL-02 Leads inbox with triage, routing and producer assignment**; lead vendor integrations. `[Pub]`
- **SAL-03 Abandoned-quote lead capture** from consumer quoting flows. `[Pub]`
- **SAL-04 Consumer-authorized data pull** of existing coverage from carrier logins or dec-page upload to seed the prospect record and rater. `[Pub]` (Canopy Connect)
- **SAL-05 Sales intelligence / prospect research** — insurance-specific prospect profiles, intent signals, lead scoring, NAICS-segment prospecting. `[Pub]`
- **SAL-06 X-date (competitor expiration) tracking** on prospects with reminders 60 days out and marketing lists 30–90 days out. `[Pub]`
- **SAL-07 Win-back management** of lost clients. `[Pub]`

### 2.2 Opportunities and pipeline
- **SAL-08 Create / update opportunity** — new or renewal business for an account; products/lines, stage and stage group, owner, sales manager, sales team, target close date, estimated and current premium and revenue, win probability, comments. `[Pub]`
- **SAL-09 Link opportunity contacts and associated items** (policies, submissions, quotes, attachments).
- **SAL-10 Configurable pipeline stages** (rename, reorder) with per-stage data prompts (opportunity, policy, notes, appointment). `[Pub]`
- **SAL-11 Stage-triggered automation** — entering a stage fires email/text/task/notification sequences. `[Pub]`
- **SAL-12 Mark won / lost with reasons**; closed-won converts to policy setup. `[Pub]`
- **SAL-13 Renew (roll forward) opportunity** for the next term.
- **SAL-14 Pipeline reporting** — open / closed-won / closed-lost by stage, owner, premium, close date; deal aging; forecasting. `[Pub]`
- **SAL-15 Producer goals and leaderboards** (monthly/annual production, hit ratio). `[Pub]`
- **SAL-16 Centers-of-influence and vertical/niche programs**; producer scorecards. `[Pub]`

### 2.3 Marketing and engagement
- **SAL-17 Marketing campaigns** as trackable items that activities, attachments and responses link to. `[Pub]`
- **SAL-18 Audience / list building** from book data (lines, carriers, premium, x-dates, benefits fields, activity history). `[Pub]`
- **SAL-19 Drip / engagement sequences** — prospecting, onboarding (45-day sequence), birthdays, milestones, review requests, win-back, rate-increase notices. `[Pub]`
- **SAL-20 Email templates with merge variables, signatures and branding profiles.** `[Pub]`
- **SAL-21 AI-drafted communications for approval.** `[Pub]`
- **SAL-22 Postal mail campaigns and print/mail fulfillment.** `[Pub]`
- **SAL-23 Social media marketing integration.** `[Pub]`
- **SAL-24 Agency website / landing pages with lead capture, SEO and quote forms.** `[Pub]`
- **SAL-25 Referral program management** — referral tracking, incentives, thank-you fulfillment. `[Pub]`
- **SAL-26 NPS / client surveys** with promoter routing to review requests and detractor follow-up. `[Pub]`
- **SAL-27 Online review solicitation and reputation management** (Google/Facebook) with negative-feedback routing. `[Pub]`
- **SAL-28 Marketing preferences and opt-outs** (CAN-SPAM, TCPA) per client and channel. `[Pub]`
- **SAL-29 Cross-sell / account-rounding identification** from book, monoline reports and peer-purchase data. `[Pub]`
- **SAL-30 AI risk profile / coverage-gap analysis** of prospects and clients from public business data. `[Pub]`
- **SAL-31 Source-of-business tracking and reporting.** `[Pub]`

---

## 3. Quoting, Applications & Placement

### 3.1 Needs analysis and eligibility
- **PLC-01 Exposure analysis / coverage checklist** per client, recording coverages offered, accepted and declined (E&O cornerstone). `[Pub]`
- **PLC-02 Carrier appetite and eligibility check** — appetite search by class/NAICS/state/line; mark markets preferred/appointed; identify required documents. `[Pub]`
- **PLC-03 Carrier research and market selection** — compare appetite, minimum premiums, eligible classes, restrictions; record why markets were or were not approached. `[Pub]`
- **PLC-04 Non-admitted / E&S disclosure at proposal stage** and signed acknowledgments (no guaranty fund, minimum earned premium, non-flat cancellation). `[Pub]`

### 3.2 Applications and intake
- **PLC-05 Capture application data** on line-of-business risk screens mirroring ACORD applications; designate application section (ACORD 125, 88, 401). `[Pub]`
- **PLC-06 ACORD form generation and prefill** from account/policy data; retain current and prior versions; custom categories. `[Pub]`
- **PLC-07 Carrier supplemental and custom questionnaires** in a forms library (thousands of forms). `[Pub]`
- **PLC-08 Digital client-completed applications** — create a submission form for a client from a form definition, prefill from existing data, collect responses (bulk save), retrieve, delete; collaborative completion with comments and multi-user access. `[Pub]`
- **PLC-09 Smart question mapping** so answers flow across forms without re-entry. `[Pub]`
- **PLC-10 Live shared schedule workbooks** (statement of values, vehicle, driver, equipment). `[Pub]`
- **PLC-11 AI autofill from dec pages, prior applications or policy documents** with human confirmation and change log. `[Pub]`
- **PLC-12 Third-party data prefill** — driver, vehicle (VIN), property (replacement cost, roof, year built), credit, prior carrier. `[Pub]`
- **PLC-13 Loss-run request (new business)** — signed authorization, request by policy/period for 3–5 years currently valued, log and follow up; no-loss letters for new ventures. `[Pub]`
- **PLC-14 Loss summary preparation** into a carrier-ready format. `[Pub]`
- **PLC-15 MVR / CLUE / credit report ordering** through vendor or carrier. `[Pub]`
- **PLC-16 Required-document checklist by line and carrier** — verify names, limits, deductibles, terms, signatures; request missing items with deadline and recheck. `[Pub]`
- **PLC-17 eSignature** on applications, premium finance agreements, disclosures, statements of no loss, consent forms (native or DocuSign-class). `[Pub]`

### 3.3 Rating and quoting
- **PLC-18 Comparative rating (personal and small commercial)** — single entry to many carriers; quote templates and default scenarios; side-by-side comparison. `[Pub]`
- **PLC-19 Real-time commercial quoting** across appetite-matched markets (BOP, GL, auto, WC, umbrella, cyber, E&S). `[Pub]`
- **PLC-20 Rate / quote via rating service** with vehicle and address lookups.
- **PLC-21 Store quotes, risk variations, risk details, option sets and quote rates** against a prospect/client. `[Pub]`
- **PLC-22 Bridge to carrier portals** (quote data export, portal autofill, credential-embedded single sign-on). `[Pub]`
- **PLC-23 Quote validation / accuracy check-ins before submission.** `[Pub]`
- **PLC-24 Quote-by-text and direct-to-consumer web quoting.** `[Pub]`
- **PLC-25 Instant bind and reserve-quote-in-market from the rater.** `[Pub]`
- **PLC-26 Premium finance quoting at point of sale** — new or existing agreement, additional premium onto existing agreement, e-signed PFA, down payment, carrier funding. `[Pub]`
- **PLC-27 Life / ancillary quoting via partner.** `[Pub]`
- **PLC-28 Promo code validation on quotes.**

### 3.4 Submissions to markets
- **PLC-29 Create marketing submission** grouping one or more marketing lines for a client; business type, dates, servicing roles, attachments. `[Pub]`
- **PLC-30 Create marketing line** from scratch or by copying an existing policy line (renewal remarket).
- **PLC-31 Create carrier submission** selecting lines to send to an issuing company or premium-payable entity; submission packet by email or API. `[Pub]`
- **PLC-32 Track carrier submission status** — preparing, submitted, waiting on carrier, waiting on client, action required, quoted, bound, declined, cancelled, remarket, not received. `[Pub]`
- **PLC-33 Record carrier response per line** — quoted premium/commission, package inclusion, declination reason; distinguish indications, conditional quotes and firm offers; outstanding items. `[Pub]`
- **PLC-34 Record client response** to presented options.
- **PLC-35 Underwriter contact management** per carrier submission. `[Pub]`
- **PLC-36 AI capture of emailed submissions and summarization of carrier replies.** `[Pub]`
- **PLC-37 Change issuing location on a marketed line.**
- **PLC-38 Maintain service summary rows and descriptions** on marketed and current policies.
- **PLC-39 Advance submission stage** (entered ↔ submitted).
- **PLC-40 Remarket an existing marketed policy.** `[Pub]`
- **PLC-41 Move marketed lines to current policy** when bound (promote winning submission).
- **PLC-42 Move marketing submission to history** when the cycle completes.
- **PLC-43 Configure marketing submission statuses** (agency-defined).
- **PLC-44 Automatic cyber bundling with commercial quotes.** `[Pub]`
- **PLC-45 Market-exit re-placement** — identify affected clients when a carrier withdraws. `[Pub]`

### 3.5 Proposals, binding and binders
- **PLC-46 Proposal generation** from templates with policy data, coverage comparisons, recommendations, disclaimers and wrap document around carrier proposals. `[Pub]`
- **PLC-47 Interactive online proposals** with accept / request-change. `[Pub]`
- **PLC-48 Proposal presentation and decision capture** — carrier, coverages, effective date, billing type; coverage declination documentation in writing. `[Pub]`
- **PLC-49 Pre-bind compliance check** — state forms, surplus lines disclosures, terrorism rejection, carrier binding restrictions, coverage adequacy vs agency standards. `[Pub]`
- **PLC-50 Bind request to carrier/MGA** by portal, email or API; confirm binding authority. `[Pub]`
- **PLC-51 Binder issuance and management** — add, issue, issue multiple, extend, close, delete, print; binder report; binder-to-policy follow-up. `[Pub]`
- **PLC-52 Bind-time commission disclosure** where required. `[Pub]`

---

## 4. Policy Administration

### 4.1 Policy and line headers
- **POL-01 Create policy** — policy type, description, number, effective/expiration dates, term, status, source, organization, bill mode (agency/direct), prospective vs contracted, aggregate premium and commission. `[Pub]`
- **POL-02 Create / update lines** — line type (ACORD, CSIO, UK or none standards body), status, issuing company, premium payable entity, commission agreement, payable contract, organization, department/profit center.
- **POL-03 Policy stage tracking** — not submitted, submitted, in process, issued, not issued, cancelled, lapsed, lapse revoked, suspended, not received, migrated.
- **POL-04 Transaction lineage per line** — new, renew, endorse/revise, add-on, cancel, reinstate, lapse, service policy, mid-term adjustment (including temporary and revoked future adjustments).
- **POL-05 Package vs monoline policies** with multiple lines.
- **POL-06 Custom policy information** — agency-defined header fields with managed value lists.
- **POL-07 Rate plans and rate information** per line (tiers, guaranteed-rate-through dates).
- **POL-08 Issuing locations** per line.
- **POL-09 Applicant locations** per policy.
- **POL-10 Multi-carrier schedule** on a line (layered/shared placements); activate/inactivate. `[Pub]`
- **POL-11 Multi-commission schedule** on a policy.
- **POL-12 Tax option per line** — auto-generate, exempt, prompt, not applicable.
- **POL-13 Document delivery method per policy** (mail, email, fax).
- **POL-14 Link policy to originating marketing submission and opportunity.**
- **POL-15 Alternate / prior policy number tracking** carried through renewal. `[Pub]`
- **POL-16 Default MGA / wholesaler per carrier.** `[Pub]`
- **POL-17 Policy intake from documents via AI** (commercial policy PDFs to structured data). `[Pub]`

### 4.2 New business
- **POL-18 Policy setup from quote or submission** ("convert to policy"), completing LOB sections, billing type, commission setup. `[Pub]`
- **POL-19 Issue / not issue policy** — confirm carrier issuance and move lines from submitted to issued (or not issued).
- **POL-20 Policy checking** — compare issued policy to application, binder, proposal, coverage checklist and quote (premium, limits, deductibles, forms, named insured, addresses); flag discrepancies; coordinate corrections; tracked as a work item. `[Pub]`
- **POL-21 Update stage to submitted** for selected lines.
- **POL-22 Change prospective/contracted status.**
- **POL-23 Policy delivery / welcome packet** by email, portal or print; confirm receipt. `[Pub]`
- **POL-24 Carrier issuance confirmation** — upload dec/endorsements, set final stage. `[Pub]`
- **POL-25 Commission verification** of policy commissions against carrier and producer agreements. `[Pub]`

### 4.3 Mid-term servicing
- **POL-26 Service request intake and routing** — type (endorsement, COI, cancellation, billing, general), assignee, priority (normal/high/rush), stages received → in process → completed; email-thread linking. `[Pub]`
- **POL-27 Endorse / revise an existing line** — mid-term change with premium delta and effective date; premium-bearing changes create billing. `[Pub]`
- **POL-28 Endorse: add line mid-term.**
- **POL-29 Issue / not issue endorsement** on carrier confirmation.
- **POL-30 Change policy effective/expiration dates.**
- **POL-31 Driver add/remove/change; vehicle add/remove/VIN confirmation; property/location/limit changes.** `[Pub]`
- **POL-32 Named insured / first named insured change** across multiple policies. `[Pub]`
- **POL-33 Maintain additional interests** (mortgagees, loss payees, additional insureds, lienholders) on lines; lender/mortgagee change requests. `[Pub]`
- **POL-34 Maintain forms and endorsements schedule** per line.
- **POL-35 Maintain remarks** per line and screen.
- **POL-36 Fully-earned endorsement flag.** `[Pub]`
- **POL-37 Umbrella underlying schedule maintenance.** `[Pub]`
- **POL-38 SR-22 / financial responsibility filing** request and confirmation. `[Pub]`
- **POL-39 Flood policy servicing** (NFIP application, change, preferred risk; waiting periods). `[Pub]`
- **POL-40 Inspection and loss-control recommendation compliance** — critical vs advisory items, proof submission, deadlines, underwriting handoff. `[Pub]`
- **POL-41 Carrier notification coordination** — centralize carrier emails/portals/download/mail; classify high (cancel/non-renew), medium (billing, UW requests), low; assign and escalate. `[Pub]`
- **POL-42 Real-time carrier inquiries** — policy, billing, claims, loss runs from the AMS. `[Pub]`
- **POL-43 Coverage summary / snapshot** for the client. `[Pub]`
- **POL-44 Policy document requests** (dec pages, copies). `[Pub]`
- **POL-45 Annual / account review** with scripted call sheet, exposure update, rounding. `[Pub]`
- **POL-46 Mid-term adjustment with temporary changes** (temporary driver/vehicle/substitute), adjustment quote and acceptance.
- **POL-47 Diary actions** against a policy.

### 4.4 Cancellation, reinstatement, rewrite
- **POL-48 Cancel policy** — request reason and method (insured request, non-payment, underwriting, rewrite), effective date, flat / pro-rata / short-rate, additional interests to notify, remarks. `[Pub]`
- **POL-49 Issue cancellation** on carrier confirmation; return premium processing. `[Pub]`
- **POL-50 Pending cancellation tracking** (non-pay notices, pending-cancel list, 12:01 a.m. rule). `[Pub]`
- **POL-51 Carrier/underwriting-initiated cancellation handling** — offer replacement promptly, document notice. `[Pub]`
- **POL-52 Reinstate policy** with or without lapse. `[Pub]`
- **POL-53 Rewrite** — new policy replacing an existing one (carrier or form change), preserving history. `[Pub]`
- **POL-54 Non-renewal handling** — record carrier non-renewal, notify insured within statutory windows, trigger remarketing. `[Pub]`
- **POL-55 Lost-policy release / cancellation request forms** (ACORD 35). `[Pub]`
- **POL-56 Premium finance servicing on cancellation** — notify finance company; handle notices of intent to cancel; return unearned premium to finance company. `[Pub]`

### 4.5 Premium audit
- **POL-57 Premium audit management** — audit adjustments at term end, client preparation (payroll/class records), scheduling. `[Pub]`
- **POL-58 Audit premium invoice / revision** flowing through billing. `[Pub]`
- **POL-59 Premium audit dispute** with supporting documents and deadlines. `[Pub]`

### 4.6 Broker of record
- **POL-60 BOR / AOR letter — acquiring** (insured letterhead or ACORD 36), carrier notification, rescission window, effective on receipt or cancel-rewrite. `[Pub]`
- **POL-61 BOR — defending/losing** within rescission window. `[Pub]`
- **POL-62 Agent-of-record / agency code change** in carrier systems and AMS producer assignment. `[Pub]`
- **POL-63 Benefits BOR date tracking** for compliance and won/at-risk reporting.

### 4.7 Risk detail by line of business
Each line keeps screen-level risk detail mirroring the ACORD application, with common patterns: general information, coverages/limits, additional coverages, additional interests, forms & endorsements, remarks, supplemental screens with blank scheduled items, and line-level attachments.
- **POL-64 Personal auto** — vehicles, drivers, accidents/violations, policy information, state variants (e.g., Massachusetts, Puerto Rico).
- **POL-65 Residential (homeowners, dwelling fire, mobile home)** — insurance requested, coverages and optional endorsements, rating/underwriting, replacement cost, residence-based business, solid-fuel questionnaire, recreational vehicles, mobile home detail.
- **POL-66 Personal umbrella; watercraft; personal application (ACORD 90-style).**
- **POL-67 Commercial application (ACORD 125-style)** — applicant, premises, other named insureds, prior carrier, loss history, status.
- **POL-68 General liability** — hazards/classifications, contractors, products/completed operations, claims-made and employee benefits liability, international exposure.
- **POL-69 Property** — premises, subjects of insurance, statement of values, business income/extra expense, value reporting.
- **POL-70 Business auto** — vehicles, drivers, coverages.
- **POL-71 Truckers / motor carrier** — vehicles, drivers, equipment, commodities, principal shippers, terminals, state/federal filings.
- **POL-72 Workers' compensation** — locations, individuals (owners/officers), class codes and premium calculation by state, prior carrier, assigned-risk variants (FL, MI, MT, NJ, TN, WI), total estimated annual premium.
- **POL-73 Business owners; commercial umbrella; crime; garage & dealers; equipment floater; transportation; electronic data processing; boiler & machinery.**
- **POL-74 Surety / bonds** — account information, principal, obligee, contract surety terms and billing, premium payment supplement, underwriting and remittance.
- **POL-75 Canadian habitational, personal auto, commercial auto** (CSIO forms).
- **POL-76 Custom forms** — agency-defined risk screens for non-standard lines.
- **POL-77 Forms-engine-powered lines** — full form detail for policies on the newer forms engine, including benefits plans.
- **POL-78 Line-level attachments** on any line.

### 4.8 Fee-for-service contracts
- **POL-79 Create / update service contracts** (consulting, loss control, HR services) with fees, terms, servicing contacts, attachments; renew.

---

## 5. Certificates & Evidence of Insurance

- **CRT-01 Create certificate** (liability, property, intermodal interchange) tied to policies/lines, with description of operations, remarks, special conditions, location/description of property. `[Pub]`
- **CRT-02 Maintain coverage sections** — general liability, auto liability, excess/umbrella, workers' comp/employer's liability, property, inland marine, crime, boiler & machinery, cargo, trailer interchange, other.
- **CRT-03 Maintain certificate holders** with nature of interest, holder-specific wording, default from previous certificate, import/export, holder packs, holder list report. `[Pub]`
- **CRT-04 Master certificate and coverage templates** per client; description-of-operations library; preview before issue. `[Pub]`
- **CRT-05 COI request intake** — monitor mailbox/portal, log holder, deadline, required wording (additional insured, waiver, primary & non-contributory), standard vs rush. `[Pub]`
- **CRT-06 COI coverage verification** against policy; trigger endorsement if required wording is missing. `[Pub]`
- **CRT-07 Issue and distribute certificates** to one or all holders by email, print or third-party cert portal; batch/mass distribution. `[Pub]`
- **CRT-08 Holder delivery management** — delivery method and recipients per holder.
- **CRT-09 Renew certificates** for the new term in bulk, carrying operations, attachments, holders. `[Pub]`
- **CRT-10 Attach endorsements to certificates** (AI endorsements, waivers).
- **CRT-11 Insured self-service issuance** — authenticate insured users, check permissions, select template and holders, issue and deliver, with agency rules/approval. `[Pub]`
- **CRT-12 Certificate verification link / QR code** for holders. `[Pub]`
- **CRT-13 Automated COI request processing** (classify, validate, issue, reply, close). `[Pub]`
- **CRT-14 Auto ID cards** — vehicles, templates, deliveries, portal/offline access. `[Pub]`
- **CRT-15 Evidence of property insurance (ACORD 27/28)** to lenders. `[Pub]`
- **CRT-16 Named insureds list** for certificate wording.
- **CRT-17 Log every certificate action to the account** for E&O. `[Pub]`

---

## 6. Claims

- **CLM-01 FNOL intake and logging** — loss details, reporter verification, claim type, photos/reports, note and task. `[Pub]`
- **CLM-02 Record claim** against a policy/line — claim number, date of loss, description, status, claim code. `[Pub]`
- **CLM-03 Submit claim to carrier** (ACORD 1/2/3/4 or carrier portal); report to all potentially applicable policies; save confirmation. `[Pub]`
- **CLM-04 Maintain adjusters, additional parties, insured contact, servicing contacts.**
- **CLM-05 Track litigation.**
- **CLM-06 Track payments, expenses and reserves**; reserve movements and settlements. `[Pub]`
- **CLM-07 Claim status monitoring and adjuster follow-up** cadence until closure. `[Pub]`
- **CLM-08 Close / reopen claim.**
- **CLM-09 List claims by client; link claim attachments.**
- **CLM-10 Claims download** from carriers into the claim record. `[Pub]`
- **CLM-11 Loss runs** — request, receive and store loss history; treat client loss-run requests as shopping signals. `[Pub]`
- **CLM-12 Claims advocacy** — coverage analysis, TPA coordination, litigation monitoring. `[Pub]`
- **CLM-13 Claims dashboards and reporting** (open/closed, loss ratio, trend). `[Pub]`
- **CLM-14 Configure claim codes.**
- **CLM-15 Client-facing FNOL via portal/app with photos.** `[Pub]`

---

## 7. Billing & Receivables

### 7.1 Billing modes and invoicing
- **BIL-01 Agency bill invoicing** — agency invoices insured, collects, retains commission, remits net to carrier/broker/MGA. `[Pub]`
- **BIL-02 Direct bill recording** — carrier bills insured; AMS records the transaction without receivable for commission expectation and reconciliation. `[Pub]`
- **BIL-03 Premium payable entity vs issuing company assignment** per line. `[Pub]`
- **BIL-04 Configure transaction codes** by class (premium, company fee, company tax, agency fee, government tax/fee, service charge, interest, discount, write-off, payment, supplemental income, opening balance) with bill type, GL account, commissionable flags, due-date offset, premium-update behavior, deferred-revenue flag. `[Pub]`
- **BIL-05 Create transaction / invoice** against a policy line — invoice-to (client, finance company, other interest), grouping and layout, premium payable entity and contract, description, due date. `[Pub]`
- **BIL-06 Endorsement (additional/return premium) invoice.** `[Pub]`
- **BIL-07 Audit premium invoice.** `[Pub]`
- **BIL-08 Cancellation / return premium credit** and refund handling. `[Pub]`
- **BIL-09 Installment / billing plans** — installment type, cycles, down payment, count; generate default installments; group future installments onto invoices. `[Pub]`
- **BIL-10 Binder bill transaction and close-out** — receivable and income immediately, premium payable deferred until issuance; close revises to final values. `[Pub]`
- **BIL-11 Multi-policy / consolidated invoices** and split receivable templates (bill multiple payers). `[Pub]`
- **BIL-12 Producer/broker commission splits per transaction** — default from agreements, override, production credit, order, payable due date; ignore-if-less-than rule. `[Pub]`
- **BIL-13 Generate taxes and fees** on a transaction from configured rates (see Domain 10).
- **BIL-14 Revise premium** on an existing transaction. `[Pub]`
- **BIL-15 Adjust commission** on a transaction.
- **BIL-16 Estimated vs final premium handling** (estimated flag; later true-up). `[Pub]`
- **BIL-17 Agency fees, broker fees, policy fees, inspection fees** with disclosure and refund rules. `[Pub]`
- **BIL-18 Late charges, service charges, interest**; waivable at receipt. `[Pub]`
- **BIL-19 Discount transaction.**
- **BIL-20 Revenue deferral schedule** for service fees and multi-period revenue; modify schedule. `[Pub]`
- **BIL-21 Supplemental income transactions** (100% producer-commissionable, non-adjustable in reconciliation). `[Pub]`
- **BIL-22 Opening balance transactions** for conversions. `[Pub]`

### 7.2 Receivables management
- **BIL-23 Apply / unapply credits to debits** (match return premiums and payments to open items; clear unapplied cash before month-end). `[Pub]`
- **BIL-24 Accounts receivable write-off** (within user limits). `[Pub]`
- **BIL-25 Reverse transaction; void payment.** `[Pub]`
- **BIL-26 Move transaction** to another policy/account.
- **BIL-27 Balance transfer and reverse** between accounts.
- **BIL-28 Credit / debit memos** and cross-policy credit application. `[Pub]`
- **BIL-29 Finance transaction** — move balance to finance-company receivable, record down payment, carrier-paid (CFIN) vs agency-forwarded flows. `[Pub]`
- **BIL-30 Hold / resume payments** on a transaction.
- **BIL-31 Open receivables inquiry** per transaction/account; cash on account at account, customer or policy level. `[Pub]`
- **BIL-32 Aged receivables and dunning** — aging buckets, reminder cadence before/after due, arrangements, final notice before cancellation. `[Pub]`
- **BIL-33 Client statements and invoices** — layouts, page breaks by client/item/policy or account/contact; print/email. `[Pub]`
- **BIL-34 Customer account reconciliation** — match payments to invoices, investigate discrepancies, record write-offs/credits/refunds. `[Pub]`
- **BIL-35 Interagency / interdivisional receivable and payable postings** when one receipt spans entities. `[Pub]`
- **BIL-36 Pass-through payment recording** (collected and forwarded to carrier). `[Pub]`

---

## 8. Cash & Payments

- **CSH-01 Enter receipt** — payer, bank account, method (check, card, ACH, cash, wire), batch payment method; detail items apply to receivables (item/policy/account), payables/commissions, GL, cash on account, full balance. `[Pub]`
- **CSH-02 Apply credits to debits and process outstanding payments during receipt**; cannot finalize with unapplied amount. `[Pub]`
- **CSH-03 Finalize receipt; suspended vs finalized states; bank status outstanding/cleared.** `[Pub]`
- **CSH-04 Transfer of funds** between bank accounts (trust ↔ operating sweeps, interbank transfers with references). `[Pub]`
- **CSH-05 Deposit creation and register**; undeposited funds. `[Pub]`
- **CSH-06 Direct bill deposit (pass-through) handling** with trust liability and forwarding. `[Pub]`
- **CSH-07 Direct bill commission receipt** posting to receivable or income. `[Pub]`
- **CSH-08 Import receipts** from payment platforms/lockbox files; batch payment import. `[Pub]`
- **CSH-09 Online card / ACH acceptance** — hosted checkout, wallets, pay-by-text, payment links generated from invoices; deactivate links. `[Pub]`
- **CSH-10 Convenience fee / surcharge configuration** excluded from the AMS transaction amount. `[Pub]`
- **CSH-11 Payment posting / receipt auto-creation** from processor status and reconciliation to invoices. `[Pub]`
- **CSH-12 Recurring payments / auto-pay** and payment plans. `[Pub]`
- **CSH-13 Split funding and multi-invoice payment**; settlement and funding reconciliation. `[Pub]`
- **CSH-14 Lockbox payments, settlements and returns** posted from the payment platform; integrated check scanning with image attachment. `[Pub]`
- **CSH-15 ACH authorization management** on contacts (authorized / pending / denied).
- **CSH-16 NSF / returned payment reversal** with return reason codes, bank fee, re-bill. `[Pub]`
- **CSH-17 Refunds** via processor or agency check; advance premium disbursements. `[Pub]`
- **CSH-18 Finance-at-checkout** (pay in full or finance from one link). `[Pub]`
- **CSH-19 PCI / NACHA compliance via tokenization** (no card data in AMS). `[Pub]`
- **CSH-20 End-of-day cash drawer close** by location/user. `[Pub]`
- **CSH-21 Arrears handling** — available payment options and arrears payment on a policy.
- **CSH-22 Store card / bank details** (IBAN, sort code validation).

---

## 9. Payables, General Ledger & Close

### 9.1 Payables
- **GL-01 Create voucher (payable)** to company, broker, employee, finance company, client (refund), other interest or vendor; detail items apply to transactions or GL accounts and organization structure; discount types. `[Pub]`
- **GL-02 Pay vouchers via disbursement; void voucher with reason.**
- **GL-03 Create disbursement (check/ACH)** from a bank account; pay-to-the-order-of account; void with reason; check printing and reprinting. `[Pub]`
- **GL-04 Carrier premium payable — pay by statement** (account current) — build reconciliation per premium payable entity, select items matching carrier statement, resolve amount-to-pay/write-offs, finalize, pay. `[Pub]`
- **GL-05 Carrier premium payable — pay by item.** `[Pub]`
- **GL-06 Return premium received from carrier** — finalize statement, deposit, associate GL item. `[Pub]`
- **GL-07 Net-funded / third-party-funded payables** (payment platform funds carrier from FBO account). `[Pub]`
- **GL-08 Broker / intermediary payables and receivables** statements. `[Pub]`
- **GL-09 Producer and broker commission payables** — reconciliation and statement payment (see Domain 11). `[Pub]`
- **GL-10 Finance company payables and client refunds.** `[Pub]`
- **GL-11 Vendor payables with 1099 tagging.** `[Pub]`

### 9.2 General ledger
- **GL-12 Chart of accounts** — create, update, inactivate/reactivate; title accounts with sub-accounts per entity; define bank accounts. `[Pub]`
- **GL-13 Allocation methods and structure groupings** across agencies, branches, departments, profit centers.
- **GL-14 Journal entries** — create, submit, void, transfer of funds; recurring entries; default entries; optional approval workflow. `[Pub]`
- **GL-15 System month-end journal entries** (DB commission receivable, AB invoiced items, producer/broker expense). `[Pub]`
- **GL-16 GL activity records / notes.**
- **GL-17 Generate journal entries from sub-ledgers; GL export** to external accounting (QuickBooks and others); chart mapping. `[Pub]`
- **GL-18 GL schedules** (accrual/recognition).
- **GL-19 Budgets** per organization with budget-vs-actual. `[Pub]`
- **GL-20 Accounting method configuration** — cash vs accrual income recognition; producer pay trigger (partially vs fully paid). `[Pub]`
- **GL-21 Multi-entity, interagency and intercompany balancing.** `[Pub]`
- **GL-22 Multi-currency conversion and cash matching** (international brokerage). `[Pub]`

### 9.3 Fiduciary (trust) accounting
- **GL-23 Premium trust accounting** — segregated trust account, no commingling, trust balance reconciliation by category to bank and GL. `[Pub]`
- **GL-24 Trust-to-operating sweep** of earned commissions after reconciling disputed/delinquent items. `[Pub]`
- **GL-25 Statement of premium trust report** and regulator-ready reconciliation records. `[Pub]`
- **GL-26 Unclaimed property (escheat)** of stale return premiums. `[Pub]`

### 9.4 Reconciliations
- **GL-27 Bank reconciliation** — create statement, associate GL items, finalize, reopen, transfer of funds. `[Pub]`
- **GL-28 Direct bill commission reconciliation** — create statement, import carrier statement, record available policies, associate GL items, finalize, close without payment (detail in Domain 11). `[Pub]`
- **GL-29 Premium (carrier payable) reconciliation** — master and detail statements. `[Pub]`
- **GL-30 Producer/broker payable reconciliation** — master and detail. `[Pub]`
- **GL-31 Government payable (tax/fee) reconciliation.**
- **GL-32 Zero-dollar reconciliation cleanup** for manually reversed items. `[Pub]`
- **GL-33 Statement lifecycle governance** — processing → suspended → finalized → approved → paid/closed; reopen rules. `[Pub]`

### 9.5 Period close
- **GL-34 Month-end close** — lock accounting month, run balancing receivables/payables and unapplied reports, trust reconciliation, bank rec, post month-end entries. `[Pub]`
- **GL-35 Year-end close** — roll net income to retained earnings; 1099 production. `[Pub]`
- **GL-36 Financial statements** — balance sheet, income statement, GL, trial balance by entity. `[Pub]`
- **GL-37 Contingent / profit-sharing income accrual and receipt tracking** by program and policy year. `[Pub]`

---

## 10. Taxes & Fees

- **TAX-01 Government tax/fee rate tables** by state/jurisdiction, line and date.
- **TAX-02 Surplus lines tax calculation** on gross premium plus taxable fees; broker-fee treatment. `[Pub]`
- **TAX-03 Stamping fee calculation** per filing at stamping-office rates. `[Pub]`
- **TAX-04 Fee taxability flagging** and tax option per line (auto-generate, exempt, prompt). `[Pub]`
- **TAX-05 Government tax payable to carrier/broker vs to government payee** distinction. `[Pub]`
- **TAX-06 Policy filing with stamping office** (dec page, binder, endorsements) within state deadlines via electronic filing or batch. `[Pub]`
- **TAX-07 Diligent-search / declination documentation and affidavits** where required. `[Pub]`
- **TAX-08 Binder filing** to stop the clock where accepted. `[Pub]`
- **TAX-09 Stamping-office tag/error resolution.** `[Pub]`
- **TAX-10 Stamping fee invoice payment.** `[Pub]`
- **TAX-11 Surplus lines tax remittance** — annual, quarterly or monthly installments by state; zero reports. `[Pub]`
- **TAX-12 Quarterly affidavits and late-filing penalties.** `[Pub]`
- **TAX-13 Multi-state allocation / home-state rule (NRRA)** and clearinghouse participation. `[Pub]`
- **TAX-14 Municipal taxes** (e.g., Kentucky local premium taxes). `[Pub]`
- **TAX-15 Federal Excise Tax** on premiums to foreign insurers (Form 720). `[Pub]`
- **TAX-16 Policy, inspection and company fees** (agency-remitted vs direct-bill). `[Pub]`
- **TAX-17 Broker fee disclosure and refund** per state rules. `[Pub]`
- **TAX-18 Surplus lines tax estimator** for quoting total cost. `[Pub]`

---

## 11. Commissions & Compensation

### 11.1 Agreements and contracts
- **COM-01 Company (carrier) commission agreements** — date-, risk-, premium-based or standard; net agency commission, net split, flat, percentage of premium, flat per risk, percentage of agency commission; by line, business type, new vs renewal. `[Pub]`
- **COM-02 Employee (producer) commission agreements** — single or multi-term; flat fee, percentage of premium or of commission; rate tables over timelines, tiers, overrides (manager, trainer, referral), per-life/PEPM for benefits. `[Pub]`
- **COM-03 Broker agreements and payable contracts** — producer payable, broker payable, broker receivable; net brokerage split; brokerage net commission.
- **COM-04 Copy agreements** between companies, brokers and employees.
- **COM-05 Payable contract requirement** before producer/broker commissions post.
- **COM-06 Producer/broker commission schedule per line** — full-state submission; billed, annualized and estimated figures; system settings (commission required, multi-term eligibility).
- **COM-07 Producer splits (multiple producers) and policy-level overrides.** `[Pub]`
- **COM-08 Shared revenue organizations** for employees; revenue sharing across offices. `[Pub]`
- **COM-09 House producer / house account handling.** `[Pub]`
- **COM-10 Vesting rules and post-termination commission rights.** `[Pub]`

### 11.2 Direct bill commission reconciliation
- **COM-11 Statement intake — download (IVANS DBCS)** into suspense. `[Pub]`
- **COM-12 Statement intake — import** (CSV/Excel mapping per carrier). `[Pub]`
- **COM-13 Statement intake — manual record** from paper statements. `[Pub]`
- **COM-14 Statement intake — AI/PDF/email ingestion** with line matching and exception surfacing. `[Pub]`
- **COM-15 Auto-match and manual match** (customer + policy, optional writing company, dates, line, transaction type, amounts; many-to-one; accept carrier amounts). `[Pub]`
- **COM-16 Partial pay on direct bill items** (installments; mark final or leave open). `[Pub]`
- **COM-17 Commission variance adjustment / write-off** within thresholds; adjusting journal entries. `[Pub]`
- **COM-18 Close item without commission.** `[Pub]`
- **COM-19 Statement-to-deposit association** and payment-month modification. `[Pub]`
- **COM-20 Statement totals balancing** before posting. `[Pub]`
- **COM-21 Missing / short-paid commission detection and reporting.** `[Pub]`
- **COM-22 Agency bill carrier statement reconciliation** in the same workflow (AI-assisted). `[Pub]`

### 11.3 Producer compensation
- **COM-23 Producer/broker payable reconciliation and statements** — finalize/reopen, PDF/CSV, by sub-agency; payout runs. `[Pub]`
- **COM-24 Chargebacks / clawbacks** on cancellation or carrier chargeback, offset against future commissions. `[Pub]`
- **COM-25 Producer expense tracking choice** (agency expense, payable accounts, broker expense). `[Pub]`
- **COM-26 Commission verification reports** against agreements. `[Pub]`
- **COM-27 Commission forecasting and variance analytics**; benchmarking commission rates for carrier negotiations. `[Pub]`
- **COM-28 Contingent / bonus / profit-sharing tracking vs carrier thresholds** (volume, growth, loss ratio). `[Pub]`
- **COM-29 Compensation and contingent-income disclosure** to clients. `[Pub]`
- **COM-30 Carrier-side compensation statement consumption** (consolidated producer comp platforms). `[Pub]`

---

## 12. Renewals & Retention

- **REN-01 Expiration / renewal list generation and assignment** by owner, status, effective date, line; backup designation. `[Pub]`
- **REN-02 Renewal timeline kickoff by line** — auto-create renewal activities at configurable lead times (large commercial 90–120, small commercial 60, personal 30–45 days). `[Pub]`
- **REN-03 Pre-renewal file review** — expiring dec/endorsements, licensing, 5-year loss runs, claims and reserves. `[Pub]`
- **REN-04 Renewal questionnaire / exposure update** with deadlines and no-reply follow-up; client self-update via portal. `[Pub]`
- **REN-05 Pre-renewal client meeting and strategy.** `[Pub]`
- **REN-06 Remarket decision and documentation** — triggers (premium % or $ increase, time with carrier, monoline, appetite change, non-renewal), reason recorded, client informed. `[Pub]`
- **REN-07 Remarketing submission package** (reuse existing line into marketing line). `[Pub]`
- **REN-08 Incumbent renewal quote and competing quotes** comparison. `[Pub]`
- **REN-09 Prepare renewal draft** from the expiring policy, selecting lines to carry forward; defaults dates, premium, commission, line details.
- **REN-10 Renew policy** creating the new-term policy with adjustments. `[Pub]`
- **REN-11 Update renewal stage** for one or many policies (renewal pipeline).
- **REN-12 Renewal via download** — renewal download creates term; merge with quote; prior-term notations carry forward. `[Pub]`
- **REN-13 Renewal download / eDoc reconciliation and automated review** writing analysis to the activity. `[Pub]`
- **REN-14 Expiring vs renewal comparison** (premium and coverage changes, historical premium trend); uprate alerts above thresholds. `[Pub]`
- **REN-15 Renewal benchmarking vs similar policies.** `[Pub]`
- **REN-16 Renewal proposal, decision capture and commission disclosure.** `[Pub]`
- **REN-17 Renewal invoicing, payment and certificate reissue.** `[Pub]`
- **REN-18 Renewal issuance confirmation and delivery.** `[Pub]`
- **REN-19 Non-renewal notice processing and replacement.** `[Pub]`
- **REN-20 Automated renewal communications** (timed emails/texts, rate-increase explanations, "renewal reassurance"). `[Pub]`
- **REN-21 Renewal review call program** with scripts, contact-rate targets, quality monitoring. `[Pub]`
- **REN-22 Renewal meetings cadence and status chart** for large accounts. `[Pub]`
- **REN-23 Predictive retention risk scoring / at-risk flags** (rate increase, claims frequency, past-due, dec/loss-run requests). `[Pub]`
- **REN-24 Retention workflow** — tag at-risk, outreach, offers (endorsement, rewrite, billing adjustment), record won/lost. `[Pub]`
- **REN-25 Retention / lost-business tracking and reasons.** `[Pub]`
- **REN-26 Renewal performance measurement** (remarket counts, time, savings, commission impact). `[Pub]`
- **REN-27 Renewal coverage letters** to all policyholders ("if not scheduled, not covered"). `[Pub]`
- **REN-28 Post-bind renewal filings and file close** (surplus lines filings, audit scheduling, archive). `[Pub]`
- **REN-29 Renew fee-for-service contracts and renewal opportunities.**

---

## 13. Activities, Workflow & Communication

### 13.1 Activities and tasks
- **WRK-01 Create activity** (task/note/follow-up) with code, category, description, owner (employee or work group), follow-up start/end, priority, status open/closed, closed reason, unsuccessful reason. `[Pub]`
- **WRK-02 Attach activities to any item** — client, contact, policy, line, quote, claim, certificate, evidence of insurance, binder, bill, cancellation, transaction, receipt, voucher, disbursement, journal entry, every reconciliation type (bank, direct bill, premium, producer/broker, government payable), GL export, imports, budget, opportunity, marketing campaign, marketing/carrier submission, service, policy checking, company, broker, employee, vendor, finance company, other interest, attachment.
- **WRK-03 Activity notes with access levels** (confidentiality).
- **WRK-04 System-generated activities** on events (download, payment, binder close, policy access). `[Pub]`
- **WRK-05 Activity code configuration** — codes, categories, defaults (description, follow-up offsets, owner), event triggers, enable/disable.
- **WRK-06 Suspense / diary management** — owner, action, due date, priority, daily review, date moves, reassignment, delinquent-diary reporting. `[Pub]`
- **WRK-07 Work queues by employee or work group**; personal and team Kanban; overdue dashboards; workload balancing. `[Pub]`
- **WRK-08 Task categories, stages and checklists per transaction type** with role/priority/interval defaults. `[Pub]`
- **WRK-09 Activity logging standards** — one activity per workflow, topic-specific codes, download activities treated as notifications. `[Pub]`
- **WRK-10 Activity tags for interaction-topic reporting.** `[Pub]`
- **WRK-11 Agency-wide collaborative workspace** (shared notes, checklists, reminders). `[Pub]`
- **WRK-12 Sticky notes on accounts.**
- **WRK-13 Field defaults** for new activities, clients, contacts and policies.

### 13.2 Workflow automation
- **WRK-14 Event-triggered workflow automation** — triggers, conditional filters, actions (tasks, emails, texts, notes, status changes), enable/disable, history log. `[Pub]`
- **WRK-15 Scheduled process activities** running follow-up actions. `[Pub]`
- **WRK-16 Pre-built workflow templates / guided business processes.** `[Pub]`
- **WRK-17 Webhooks and API touchpoints** from workflows to external systems. `[Pub]`
- **WRK-18 Work routing with manual / supervised / autonomous processing modes** (AI agents). `[Pub]`
- **WRK-19 Employee time clock and productivity logging.** `[Pub]`

### 13.3 Communication
- **WRK-20 Two-way email integration (Outlook/Gmail add-in)** — log to account, attach, create tasks; shared inbox. `[Pub]`
- **WRK-21 AI email agent** — interpret, summarize, trigger workflows from inbound email. `[Pub]`
- **WRK-22 Two-way business texting** with opt-in/opt-out logging and templates. `[Pub]`
- **WRK-23 VoIP / CTI integration** — screen pop, click-to-call, call logging and recordings as activities; call tagging to account or policy. `[Pub]`
- **WRK-24 Letter / correspondence templates and mail merge** by lifecycle stage. `[Pub]`
- **WRK-25 Distribution / delivery** by recipient preference (mail, email, fax, portal).
- **WRK-26 Secure document and message exchange with clients.** `[Pub]`
- **WRK-27 Automated routine communications on events** (new business, expirations, cancellations, past-due). `[Pub]`
- **WRK-28 Virtual agent / chatbot** for clients. `[Pub]`
- **WRK-29 Voicemail and email disclaimers** ("coverage cannot be bound by voicemail"). `[Pub]`
- **WRK-30 Customer complaint handling** procedure. `[Pub]`

---

## 14. Documents & Attachments

- **DOC-01 Create attachment record and upload file; download; update binary (new version).** `[Pub]`
- **DOC-02 Link one attachment to multiple items** (policy, claim, activity, submission, etc.).
- **DOC-03 Folder taxonomy** — hierarchical folders applicable to all or specific account types; move between folders. `[Pub]`
- **DOC-04 Attachment access levels** enforcing permissions for sensitive files. `[Pub]`
- **DOC-05 Move attachment to another account; delete / reactivate.**
- **DOC-06 Organizations associated with an attachment.**
- **DOC-07 Line-level, marketing, certificate, opportunity and service attachments.**
- **DOC-08 Drag-and-drop and auto-attach** (email, download eDocs, scans, virtual printer). `[Pub]`
- **DOC-09 Scanning / imaging (TWAIN) and OCR / data extraction.** `[Pub]`
- **DOC-10 Document naming conventions and summary note per attachment.** `[Pub]`
- **DOC-11 Document indexing/metadata, version history, retention and disposition schedules.** `[Pub]`
- **DOC-12 Document generation** (dec pages, policy contracts, endorsement schedules, dynamic templates). `[Pub]`
- **DOC-13 Form mapping and fillable PDF library** (ACORD and custom; reverse mapping to capture data). `[Pub]`
- **DOC-14 AI document intelligence / research across documents.** `[Pub]`
- **DOC-15 Media storage** (photos, licenses, recordings). `[Pub]`
- **DOC-16 Required documents checklist per policy and quote packs.**
- **DOC-17 Print and mail fulfillment** (outsourced). `[Pub]`

---

## 15. Client Self-Service & Portals

- **PRT-01 Branded web portal and mobile app** (iOS/Android) with agency-controlled document visibility and ordering. `[Pub]`
- **PRT-02 View policies, coverages, deductibles, documents, ID cards.** `[Pub]`
- **PRT-03 Policy change requests** with audit trail and agency notification; self-service endorsements. `[Pub]`
- **PRT-04 FNOL submission with photos.** `[Pub]`
- **PRT-05 Online bill pay** (agency bill and direct bill links; partial pay). `[Pub]`
- **PRT-06 Self-service certificates and ID cards** under agency rules. `[Pub]`
- **PRT-07 Portal enrollment and account creation behavior** (system setting). `[Pub]`
- **PRT-08 Portal usage / adoption analytics.** `[Pub]`
- **PRT-09 eDelivery of carrier documents** to the portal with electronic-consent capture and paper fallback. `[Pub]`
- **PRT-10 Producer / partner portal** for external producers and sub-agencies. `[Pub]`
- **PRT-11 Broker portal for MGA/wholesale** submissions and status. `[Pub]`
- **PRT-12 Client document and required-item lists** (quote packs, outstanding documents).

---

## 16. Carrier Connectivity & Data Exchange

### 16.1 Download
- **CON-01 Policy download (personal and commercial)** via IVANS, carrier direct, FTP or other methods; scheduled daily. `[Pub]`
- **CON-02 Direct bill commission statement download.** `[Pub]`
- **CON-03 Claims download.** `[Pub]`
- **CON-04 eDocs and messages download** (dec pages, cancellation notices, billing, underwriting messages) auto-attached at client/policy. `[Pub]`
- **CON-05 Automated download invoicing.** `[Pub]`
- **CON-06 Download suspense handling** — unmatched items, status codes, assign/update/reprocess, out-of-sequence acceptance. `[Pub]`
- **CON-07 Download results / communication log review and recall.** `[Pub]`
- **CON-08 Download matching criteria configuration per carrier** (NAIC code, premium thresholds). `[Pub]`
- **CON-09 Download-driven alerts and activities** (premium increase, cancellation, policy change). `[Pub]`
- **CON-10 Renewal download merge** with quote and prior-term notations. `[Pub]`
- **CON-11 Exchange connection management** — available/wanted connections, mailbox search, feedback, reports, agency profile, groups. `[Pub]`
- **CON-12 Single-policy resend.** `[Pub]`
- **CON-13 Book roll requests** (carrier book transfer; agency-group requests). `[Pub]`
- **CON-14 CSV-to-AL3 conversion** for non-standard carriers. `[Pub]`
- **CON-15 MGA-to-retail-agent download** (MGA pushes policies to retailers' systems). `[Pub]`
- **CON-16 Canada: CSIO policy download and eDocs** with standardized document codes. `[Pub]`

### 16.2 Real-time and upload
- **CON-17 Real-time rating and bridging** to carriers (ACORD XML / API). `[Pub]`
- **CON-18 Real-time inquiries** — billing, policy, claims, loss runs, endorsement processing, payments via carrier connectivity. `[Pub]`
- **CON-19 Carrier portal single sign-on** (credential-embedded). `[Pub]`
- **CON-20 Carrier appetite lookup** integrated with quoting. `[Pub]`
- **CON-21 Digital commercial submissions (API)** with structured data and attachments; rate/quote/bind. `[Pub]`
- **CON-22 Loss-run request workflow** (e-sign, email/e-fax to carriers). `[Pub]`
- **CON-23 Carrier credential (password) management** with audit trail. `[Pub]`

### 16.3 Integration services
- **CON-24 Change tracking** — poll for record changes by table since a timestamp (sync backbone).
- **CON-25 ID conversion** between legacy integer IDs and GUIDs.
- **CON-26 Versioned, scoped APIs with mock server; open developer portal; Zapier-class connectors; webhooks.** `[Pub]`
- **CON-27 Import direct bill reconciliation and receipt files.**
- **CON-28 GL export and bulk data feeds** (S3, API) for warehouses. `[Pub]`
- **CON-29 Payment platform integration** (lockbox, payment links). `[Pub]`
- **CON-30 Digital forms platform integration.** `[Pub]`
- **CON-31 Enrollment platform routing by vendor** (benefits). `[Pub]`
- **CON-32 CRM connectors** (Salesforce and others). `[Pub]`
- **CON-33 Premium finance company integration** (quote, agreement, funding). `[Pub]`
- **CON-34 eSignature provider integration.** `[Pub]`
- **CON-35 Phone, text and email provider integrations.** `[Pub]`

---

## 17. Configuration, Security & Administration

- **ADM-01 Users and logins** — user records with identity (sign-in email), admin flag, active status, linked employee; directory search; IdP reconciliation; SSO; 2FA; session time-out. `[Pub]`
- **ADM-02 Role-, branch- and client-based permissions**; hierarchical security; IP/time restrictions; access revocation for automations. `[Pub]`
- **ADM-03 Scopes/permissions for sensitive data** (PII, attachments, notes).
- **ADM-04 Audit trail of logins and user activity**; record change history; API usage auditing. `[Pub]`
- **ADM-05 Code tables (lookups)** — account types/statuses/sources, activity codes/categories, address descriptions, organizations, bill modes, billing plans, business types, claim codes, classifications, contact methods, countries/states, delivery methods, driver types/training, eligibility, employee classes, GL schedules, installment types, invoice/statement layouts, line types/statuses, marketing methods, NAICS/SIC, occupations, opportunity stages/products/lost reasons, payroll cycles, policy sources/types, premium payables, priorities, producers/brokers, reconciliation methods, relationships, sales teams, service classes, tax options, transaction codes, task statuses, void reasons, waiting periods.
- **ADM-06 System settings** — account defaults (person search, preferred contact defaults, portal account creation, custom client ID label), policy settings (lapsed/cancelled display), accounting settings (payable reconciliation), commission settings. `[Pub]`
- **ADM-07 Field defaults for add screens.**
- **ADM-08 Agency-defined categories and options administration.**
- **ADM-09 Email templates, signatures, branding profiles administration.**
- **ADM-10 Document types and attachment folder administration.** `[Pub]`
- **ADM-11 Coverage / endorsement / form library setup.** `[Pub]`
- **ADM-12 Benefits configuration tables.**
- **ADM-13 Government tax/fee rate tables.**
- **ADM-14 Localization** — cultures (en-US, en-CA, fr-CA, en-UK), country of operation (US, CA, UK, IE), standards body per line (ACORD, CSIO, UK).
- **ADM-15 Employee onboarding, role-based training paths and in-app coaching.** `[Pub]`
- **ADM-16 Data quality management** — duplicate emails/phones/policy numbers, invalid contacts, missing rating data, quote/policy mismatches, misclassified new vs renewal, commission mismatches. `[Pub]`
- **ADM-17 Archive / inactive record management** (holders, interests, insureds). `[Pub]`
- **ADM-18 Agency configuration of organization structure** (agency/branch/department/profit center). `[Pub]`

---

## 18. Compliance, Licensing & E&O

- **CMP-01 Producer license tracking and renewal** per state and line of authority; CE tracking; NIPR/Sircon integration; reminders at 60/30 days. `[Pub]`
- **CMP-02 Carrier appointment and termination tracking** per state/writing company; just-in-time appointing. `[Pub]`
- **CMP-03 Agency/firm licensing and designated responsible producer.** `[Pub]`
- **CMP-04 Surplus lines license and stamping-office registration.** `[Pub]`
- **CMP-05 Carrier appointment acquisition** — production/loss reports, business plan, contract review (expirations ownership, commission schedule, termination notice). `[Pub]`
- **CMP-06 Carrier relationship management** — periodic reviews with agency-generated reports (new, renewals, non-renewals, claims, cancellations, quote outcomes, turnaround). `[Pub]`
- **CMP-07 Carrier contract and commission schedule administration.** `[Pub]`
- **CMP-08 Carrier insolvency / rating monitoring and disclosure.** `[Pub]`
- **CMP-09 E&O procedures manual maintenance** (documentation rules, timelines, disclaimers, PII handling, policy checking, proposal delivery). `[Pub]`
- **CMP-10 E&O self-audit and file review**; corrective-action tasks. `[Pub]`
- **CMP-11 E&O claim reporting** to the E&O carrier. `[Pub]`
- **CMP-12 Coverage declination and advice documentation** in writing. `[Pub]`
- **CMP-13 Records retention policy and secure destruction** (typical 5–7 years; WC longer; state rules). `[Pub]`
- **CMP-14 Cybersecurity program** (e.g., NY DFS Part 500: policies, MFA, risk assessment, incident reporting, annual certification). `[Pub]`
- **CMP-15 Information security and privacy program** (SOC 2/ISO vendor controls, PHI/PII communications policy, GLBA/HIPAA). `[Pub]`
- **CMP-16 Vendor security assurance** (SOC reports, third-party diligence). `[Pub]`
- **CMP-17 Texting / calling consent management** (TCPA opt-in with timestamp, source, staff; annual renewal). `[Pub]`
- **CMP-18 Compensation / contingent-income and broker-fee disclosures.** `[Pub]`
- **CMP-19 Trust-account regulatory reporting.** `[Pub]`
- **CMP-20 Compliance governance** — regulatory change log, compliance audit checklist, staff training cadence, compliance calendar. `[Pub]`
- **CMP-21 Regulator filings and contacts** (e.g., catastrophe contact information). `[Pub]`
- **CMP-22 OFAC / AML / KYC checks.** `[Pub]`
- **CMP-23 Call recording retention for compliance.** `[Pub]`
- **CMP-24 Disengagement (client termination) letters.** `[Pub]`

---

## 19. Reporting & Analytics

- **RPT-01 Pre-built report library with custom report builder**, saved filters, scheduling and distribution to roles. `[Pub]`
- **RPT-02 Role-based dashboards** with favorites, period-over-period comparison, KPI alerts to metric owners. `[Pub]`
- **RPT-03 Book of business** (policy/line, cross-reference, month-over-month, year-over-year). `[Pub]`
- **RPT-04 Expiration / renewal and retention reports** (retained vs lost, reasons). `[Pub]`
- **RPT-05 Production reports** by producer, carrier, line, branch; hit ratio; sales velocity. `[Pub]`
- **RPT-06 Receivables reports** — aged receivables, receivable activity, unapplied cash/credit, balancing reports. `[Pub]`
- **RPT-07 Payables and commission reports** — premium payables aging, direct bill statement, commission payable statement, account current, verify commissions, unbilled policies, policies with no transactions. `[Pub]`
- **RPT-08 Financial statements and GL reports** by entity. `[Pub]`
- **RPT-09 Activity and productivity reports**; workflow bottleneck dashboards. `[Pub]`
- **RPT-10 Claims management and loss-ratio reports.** `[Pub]`
- **RPT-11 Download exception and statement processing reports.** `[Pub]`
- **RPT-12 Binder, certificate holder and coverage snapshot reports.** `[Pub]`
- **RPT-13 Management summary / agency vital-signs** (revenue per employee, organic growth, retention, contact rate). `[Pub]`
- **RPT-14 Peer and industry benchmarking** (premiums, limits, deductibles, commission rates). `[Pub]`
- **RPT-15 Revenue forecasting and financial performance dashboards.** `[Pub]`
- **RPT-16 Carrier usage trends and carrier scorecards.** `[Pub]`
- **RPT-17 Submission, adoption and portal usage reporting.** `[Pub]`
- **RPT-18 Data exports / warehouse feeds and pixel-perfect printable reports.** `[Pub]`
- **RPT-19 Client map views and geographic exposure.** `[Pub]`
- **RPT-20 E&O audit and documentation reports.** `[Pub]`

---

## 20. Employee Benefits specifics

- **BEN-01 Group (benefits client) setup** — employee count and classes, HIPAA compliance, primary renewal month, BOR date, enrollment portal vendor and status, COBRA/state continuation, waiting periods, payroll cycle, deduction frequency. `[Pub]`
- **BEN-02 Benefits plan records** — plan names/types, group size, rate tiers, ways of insuring, rates, contributions, eligibility, stop loss, TPA; plan list with employee cost. `[Pub]`
- **BEN-03 Benefits workspace** — contacts, activities, plans, classes, contracts (renew/close/reopen), servicing. `[Pub]`
- **BEN-04 Census collection and preparation** (current elections, health questionnaires). `[Pub]`
- **BEN-05 Pre-renewal planning by group size** (large group 8–6 months, small group 60 days). `[Pub]`
- **BEN-06 Carrier marketing / RFP distribution** and submission tracking. `[Pub]`
- **BEN-07 Side-by-side plan comparison, modeling and branded proposal.** `[Pub]`
- **BEN-08 Renewal decision** (plans, carriers, vendors, contributions). `[Pub]`
- **BEN-09 Employee communications and benefit guides.** `[Pub]`
- **BEN-10 Open enrollment technology setup, testing and execution**; enrollment platform integration. `[Pub]`
- **BEN-11 Enrollment processing and eligibility** (new hires, terminations, changes). `[Pub]`
- **BEN-12 Carrier EDI/API feed setup, renewal and discrepancy resolution** (integration types per plan). `[Pub]`
- **BEN-13 Post-renewal confirmation and ongoing engagement.** `[Pub]`
- **BEN-14 COBRA administration coordination** (internal or vendor). `[Pub]`
- **BEN-15 ERISA wrap document and SPD; Section 125 / POP documents** with preparers tracked. `[Pub]`
- **BEN-16 Form 5500, ACA 1094/1095-C, PCORI, Medicare Part D notices, SAR, gag-clause attestation, 408(b)(2) disclosure** tracked on a compliance calendar with preparers. `[Pub]`
- **BEN-17 SBC / plan-document AI mapping into plan fields.** `[Pub]`
- **BEN-18 Benefits commission validation** (weighted / PEPM commissions; expected vs received; short-pay detection). `[Pub]`
- **BEN-19 Carrier bill vs enrollment audit.** `[Pub]`
- **BEN-20 Service tickets for employee/HR issues** (claims assistance, eligibility, ID cards). `[Pub]`
- **BEN-21 Plan benchmarking.** `[Pub]`
- **BEN-22 Medicare / individual market items** (scope-of-appointment, ACA consent, Rx data). `[Pub]`

---

## 21. Wholesale / MGA specifics

- **MGA-01 Submission intake and clearance** — broker authorization, market blocking, duplicate handling, sanctions checks. `[Pub]`
- **MGA-02 AI intake of unstructured submissions** (ACORD, SOV, loss runs, supplementals). `[Pub]`
- **MGA-03 Appetite routing and referral queues** — straight-through vs referral; risk scoring and rules checks (TIV, class, prior loss). `[Pub]`
- **MGA-04 Rating / quoting with authorization controls**; low-code product builder (rating, rules, forms). `[Pub]`
- **MGA-05 Binding within delegated authority** with exception referral and audit-ready "who bound under which authority" records. `[Pub]`
- **MGA-06 Policy issuance and document generation** (policy, endorsements, certificates). `[Pub]`
- **MGA-07 Surplus lines filings and taxes** (see Domain 10). `[Pub]`
- **MGA-08 Bordereaux production** (premium and claims; carrier-specific formats; reconciliation to collected premium and reserves). `[Pub]`
- **MGA-09 Carrier and reinsurer reporting** with timeliness controls. `[Pub]`
- **MGA-10 Delegated authority / coverholder / capacity relationship management**; exposure aggregation monitoring. `[Pub]`
- **MGA-11 Program administration** — eligibility, rates, appetite, loss-ratio dashboards, rate adequacy. `[Pub]`
- **MGA-12 Carrier audits and findings tracking.** `[Pub]`
- **MGA-13 Claims governance via TPA; fraud monitoring.** `[Pub]`
- **MGA-14 MGA premium accounting** — policy fees, taxes, ceding and profit commission accruals. `[Pub]`
- **MGA-15 Retail producer / sub-agency management** — appointments, agent payables reconciled with carrier commissions, licensing. `[Pub]`
- **MGA-16 Distribution to retail agents** — download/eDocs to retailers, broker portal, embedded/API distribution. `[Pub]`

---

## 22. International variants (UK, Ireland, Canada)

- **INT-01 UK** — vehicle lookup by registration, address lookup by postcode, private car rating via rating hub.
- **INT-02 Ireland portfolio (customer) search** by name, address, Eircode, email, policy code/number, vehicle registration, telephone, third-party reference.
- **INT-03 Ireland motor and home quoting** with add-ons, acceptance, policy issue, temporary cover.
- **INT-04 Ireland mid-term adjustments** — proposer, driver, vehicle, property, cover details, specified items, interested parties, dynamic form data; adjustment quote and acceptance.
- **INT-05 Ireland renewal quote and acceptance; diary actions; receipts and arrears payments; document lists; marketing preferences; promo codes; bank/card storage; call tagging.**
- **INT-06 Canada** — CSIO forms and line types, fr-CA culture, CSIO download and eDocs. `[Pub]`
- **INT-07 Multi-currency and client-money (IBA) accounting** for London-market brokerage. `[Pub]`

---

## 23. Platform, Migration & Managed Services

- **PLT-01 Cloud / browser-native operation with mobile-optimized UI; on-prem option.** `[Pub]`
- **PLT-02 Data conversion / migration** from legacy systems — participants, export (notes, attachments, emails, tasks), cleanse and standardize carriers/products/statuses, mapping, QA, cutover scheduling. `[Pub]`
- **PLT-03 Acquisition onboarding and book absorption** into multi-office structure. `[Pub]`
- **PLT-04 On-demand data export and backups.** `[Pub]`
- **PLT-05 Knowledge base / insurance reference content** (ISO, NCCI, forms) with AI Q&A. `[Pub]`
- **PLT-06 Outsourced / virtual-assistant task management** within agency systems and SOPs (policy checking, COIs, data entry, small-account servicing, call center, print/mail). `[Pub]`
- **PLT-07 Managed accounting / bookkeeping service tiers.** `[Pub]`
- **PLT-08 AI-assisted operations** — policy checking, document intake, email summaries, AI calling. `[Pub]`
- **PLT-09 Agency operational assessment, perpetuation and business planning.** `[Pub]`

---

## Appendix B — Standard timelines and triggers (public sources)

| Area | Typical practice |
|---|---|
| Renewal kickoff | Large commercial 90–120 days; small commercial 60; personal lines 30–45 (or at renewal download) |
| Renewal cadence | Three-touch 90/60/30; client strategy meeting 90–60 days out; re-shop window 60–45 days |
| Remarket triggers | Premium increase above agency threshold (commonly 8–15%, configurable % or $); time with carrier; monoline; appetite change; non-renewal |
| Benefits renewal | Large group 8–6 / 4 / 3 / 2 months prior; small group 60 / 45 / 30 days; open enrollment ends ≥2 weeks before effective; EDI renewal form ~90 days out; enrollment file 2–3 weeks before effective |
| Claims | Forward to carrier within 24 hours; confirm 1–2 business days; adjuster contact 2–3 days; carrier follow-up day 5; weekly/biweekly until closed |
| COI | Rush within 24 hours |
| Carrier notices | Urgent cancellation escalation within 24 hours |
| Billing | Reminder 5–7 days before due; 1 day past due; arrangements at 30+; aging 0–30 / 31–60 / 61+ |
| Loss runs | 3–5 years, currently valued within 30/60/90 days; request 45–60 days before renewal |
| Surplus lines filing | Varies by state (e.g., 30, 45, 60 days from effective/issue); remittance annual, quarterly or monthly by state |
| BOR | Rescission window roughly 5–10 business days; some carriers require BOR 5–60 days before renewal |
| Licensing | Renewal reminders at 60 and 30 days; CE complete ≥30 days before renewal |
| Inspections | Proof within ~30 days; second notice 30; underwriting handoff ~45 |
| Non-renewal notice | State-dependent, commonly 45–60 days; non-pay cancellation minimum ~10 days |
| Direct bill statements | Monthly reconciliation; statement-to-deposit match before posting |
| Month-end | Lock month after balancing receivables/payables, unapplied review, trust and bank reconciliation |

## Appendix C — Standard documents, forms and reports

**ACORD forms commonly handled**
- Claims: 1 Property Loss Notice, 2 Auto Loss Notice, 3 Liability Notice of Occurrence, 4 WC First Report of Injury.
- Proofs: 22 Intermodal Interchange Certificate, 24 Certificate of Property Insurance, 25 Certificate of Liability Insurance, 27 Evidence of Property Insurance, 28 Evidence of Commercial Property Insurance.
- Changes: 35 Cancellation Request / Policy Release, 36 Agent/Broker of Record Change, 75 Insurance Binder.
- Personal lines: 80 Homeowner Application, 90 Personal Auto Application.
- Commercial: 125 Commercial Insurance Application, 126 CGL Section, 127 Business Auto Section, 128 Garage & Dealers, 129 Vehicle Schedule, 130 Workers Compensation, 131 Umbrella/Excess, 132 Truckers/Motor Carriers, 133 WC Assigned Risk, 137/138 state auto/garage variants, 139 Statement of Values, 140 Property Section, 141 Crime, 143 Transportation/Motor Truck Cargo, 144 Glass & Sign, 145 Accounts Receivable/Valuable Papers, 147 Builders Risk, 148 EDP, 149 Dealers, 152 Inland Marine, 155 Boiler & Machinery, 159 Schedule of Property Limits, 160 Business Owners, 163 Commercial Auto Driver Schedule.
- Flood: 301 Application, 302 General Change Endorsement, 303 Preferred Risk Policy. Agriculture: 401–406.
- All users require an ACORD forms end-user license; certificates may not be modified. Canada uses CSIO forms.

**Other recurring documents**
Binder, declarations page, premium finance agreement, renewal questionnaire, loss runs and loss summary, proposal with wrap/disclaimer, exposure/coverage checklist, coverage declination letter, renewal coverage letter, disengagement letter, surplus lines disclosure and diligent-effort affidavit, terrorism rejection form, commission and broker-fee disclosures, texting consent, bordereaux, census, SPD/wrap document, Form 5500/5558, 1094-C/1095-C, 1099s.

**Standard reports named in AMS documentation**
Book of business (policy / line / cross-reference), expiration/renewal, retention, production (by producer, quarterly, year-over-year), customer aged receivables, receivable activity, activity, claims management, direct bill statement, commission payable statement, account current, statement of premium trust, unbilled policies, policies with no transactions, binder, verify policy commissions, policy information plan list, management summary, customer list, exclusion (no production), coverage snapshot, holder/additional interest list, balance sheet, income and expense, general ledger, transaction, checks to print, premium payables aging, balancing receivables/payables, unapplied cash/credit, download exceptions.

**Standards**
- ACORD AL3: batch, positional flat-record standard carrying most policy and commission download.
- ACORD XML / JSON APIs: real-time rating, inquiry and submission messaging.
- CSIO (Canada): XML/EDI/JSON standards, nightly policy download, eDocs with standardized document codes.
- Payments: PCI DSS (tokenized checkout), NACHA (ACH); lockbox OCR/ICR check digitization.
- Licensing: NIPR Producer Database and Gateway; Sircon in some states.
- Surplus lines: state stamping-office electronic filing (SLIP, SMART, SLIP+) and batch XML/CSV.

## Appendix D — Sources

**Vertafore (AMS360, Sagitta, QQCatalyst, PL Rating, InsurLink, ReferenceConnect, AgencyZoom, BenefitPoint, AIM, Commercial Submissions, RiskMatch, ImageRight, TransactNOW, Sircon)**
- Product pages for each; AMS360 help: Receipt/Voucher Sections, DB Statement Processing, Download Overview, Renewal Management Features, New Business Submission, Renew Policy from Submission, Scheduled Reports list; Sagitta eForms commercial lines; Producer Manager appointments/terminations quick guide; Sircon Managed Services datasheet; AgencyZoom pipeline help.

**Other AMS vendors**
- HawkSoft (tour, accounting, ACORD forms, uprate alerts, commission management blog); EZLynx (management system, rating engine, client center, automation center, payments, product guide PDF); Momentum AMP (AMS page, release notes, support knowledge base incl. FNOL, pre-bind compliance, required document review, commission reconciliation, endorsement, renewal, retention, COI, carrier notification coordination, E&S reporting, new business quoting, billing, x-date, compliance governance, policy servicing, cancel policy, service requests, task categories, data quality, commercial workflow, text management); Nexsure/Dyad; Jenesis; Zywave (Partner Platform, BrokerageBuilder, AgencyMatrix); Xanatek; AgencyBloc (site, commissions, policy management, compliance, commission processing guide PDF, data migration checklist PDF); Novidea (front/middle/back office, client portal); Insly; Amplo; BindHQ; Canopy Connect; Patra (services, retail AI operations, virtual assistant, managed services; Celent profile); Newton/Agency Systems (capabilities pages); eVo (site and comparison chart); Eclipse/NASA.

**Connectivity, payments, premium finance**
- IVANS Download page, eDocs & Messages brochure, IVANS Exchange checklist for agents; CSIO eDocs page; ePayPolicy (AMS360 import help, AMS360 integration page); Input 1 premium finance; Comulate.

**Taxes, licensing, compliance, operations**
- Surplus Line Association of California (broker taxes/fees, FAQ), FSLSO filing requirements, SLTX, InsCipher state filing guides (CA, NY, challenging states); Big "I" records retention guide, Big "I" VU texting best practices; IIAT E&O loss control guide index; Utica National E&O articles (procedures manual; cancellation/claims); Smart Choice office procedures; Ohio Insurance Agents guide to carrier appointments; Agency Performance Partners (retention onboarding, suspense codes); ResourcePro service pages and managed-services brochure; Quandri renewal and requoting triggers; Rough Notes remarketing; IA Magazine retention article; Selectsys; manifest.ly policy issuance and renewal checklists; Applied benefits broker pre-renewal checklist PDF; Ameriflex compliance guide; Umbrex insurance brokers and MGAs primer; AgentSync; LegalClarity agency bill explainer; QuoteSweep ACORD forms.

**Seen only in search summaries (not fully read)**
State statutes and bulletins on cancellation/non-renewal notice, premium trust rules, premium finance, surplus lines deadlines and rates; NY DFS cybersecurity and eDelivery guidance; NIPR state pages; IRMI/Tax Adviser on FET; carrier BOR rules (State Fund, Hylant, Encova, Chubb, BTIS); benefits EDI guides (Maxwell, Paycor, Delta Dental); KPI benchmarks (Best Practices, MarshBerry); policy-checking vendors (Chisel AI, ReSource Pro); Better Agency and Eclipse third-party listings.

**Inaccessible during research**
acord.org standards pages (403), ACT best-practices guides, Big "I" RMS practical guide and sample procedures manual, IIAT E&O lifecycle pages (members-only), CompleteMarkets procedure manual articles (403), PropertyCasualty360 (403), several AMS help index pages.

---

## Maintaining this catalog

- This file owns every process ID and description. IDs are stable: never renumber, never reuse a retired ID.
- New processes get the next free number in their domain prefix. Retired processes stay listed with "(retired)" and a reason.
- Scope decisions live in [AMS-MVP-Scope.md](AMS-MVP-Scope.md), not here. Changing a description here changes it for the MVP too.
- Record every change in the log below.

## Change log

| Date | Change |
|---|---|
| 2026-10-31 | v1: 616 processes across 23 domains. |
| 2026-10-31 | Added link to MVP scope document and this maintenance section. |
