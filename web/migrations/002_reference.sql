-- Reference data every install needs (WRK-05 activity codes, TAX-01 rates, settings). Demo data is in scripts/seed.mjs.

INSERT INTO activity_codes (code, label, category, default_priority, default_due_days, sla_hours, checklist) VALUES
  ('NB-SETUP',   'New business setup',              'New business', 'high',   2, 48,  ARRAY['Enter policy and lines','Attach application and binder','Set up billing','Send welcome email','Schedule policy check']),
  ('POL-CHECK',  'Policy check',                    'New business', 'normal', 5, NULL, ARRAY['Compare dec page to binder/quote','Check named insured and address','Check limits, deductibles, forms','Request corrections if needed']),
  ('BINDER-EXP', 'Binder expiring',                 'New business', 'high',   0, NULL, ARRAY['Confirm policy issued','Extend binder if not']),
  ('END-REQ',    'Endorsement request',             'Endorsement',  'high',   1, 24,  ARRAY['Confirm requested change in writing','Submit to carrier','Record premium change','Send confirmation to insured']),
  ('ID-CARD',    'Auto ID card request',            'Endorsement',  'high',   0, 8,   ARRAY['Generate ID card','Email to insured']),
  ('CERT-REQ',   'Certificate request',             'Certificate',  'high',   0, 24,  ARRAY['Check holder requirements','Verify AI / waiver / P&NC wording is on the policy','Issue and deliver certificate']),
  ('COI-RENEW',  'Certificate renewal reissue',     'Certificate',  'normal', 3, NULL, ARRAY['Renew certificates for new term','Deliver to holders']),
  ('CANC-REQ',   'Insured cancellation request',    'Cancellation', 'high',   1, 24,  ARRAY['Get signed cancellation request','Submit to carrier','Calculate return premium','Notify finance company / mortgagee']),
  ('NONPAY',     'Non-pay cancellation notice',     'Cancellation', 'urgent', 0, 4,   ARRAY['Call insured same day','Send payment link','Confirm payment posted with carrier']),
  ('UW-CANC',    'Carrier cancellation / non-renewal notice', 'Cancellation', 'urgent', 0, 4, ARRAY['Notify insured in writing','Start remarketing','Document advice given']),
  ('REINST',     'Reinstatement',                   'Cancellation', 'high',   1, 24,  ARRAY['Confirm payment / conditions met','Request reinstatement','Confirm no lapse in coverage']),
  ('REN-REVIEW', 'Renewal review',                  'Renewal',      'normal', 5, NULL, ARRAY['Review expiring coverage and claims','Send renewal questionnaire','Decide renew as-is or remarket']),
  ('REN-REMKT',  'Remarket renewal',                'Renewal',      'high',   5, NULL, ARRAY['Document remarket reason','Submit to markets','Compare quotes','Present options to client']),
  ('REN-PROC',   'Process renewal',                 'Renewal',      'normal', 3, NULL, ARRAY['Confirm renewal terms','Renew policy record','Invoice if agency bill','Reissue certificates and ID cards']),
  ('CLAIM-FNOL', 'Claim first notice of loss',      'Claim',        'urgent', 0, 24,  ARRAY['Record loss details','Report to carrier','Send claim number to insured']),
  ('CLAIM-FU',   'Claim follow-up',                 'Claim',        'normal', 5, NULL, ARRAY['Check status with adjuster','Update insured']),
  ('BILL-INQ',   'Billing inquiry',                 'Billing',      'normal', 1, 24,  ARRAY['Review account balance','Answer insured']),
  ('PAY-POST',   'Payment received',                'Billing',      'normal', 1, NULL, ARRAY['Post receipt','Apply to invoice']),
  ('AUDIT',      'Premium audit',                   'Service',      'normal', 7, NULL, ARRAY['Help insured prepare records','Review audit result','Bill or credit adjustment']),
  ('LOSS-RUN',   'Loss run request',                'Service',      'normal', 3, NULL, ARRAY['Send signed request to carrier','Follow up','File loss runs']),
  ('DOC-REQ',    'Document request',                'Service',      'normal', 1, 24,  ARRAY['Locate document','Send to requester']),
  ('INSPECT',    'Inspection recommendations',      'Service',      'high',   7, NULL, ARRAY['Send recommendations to insured','Collect proof of completion','Send proof to carrier']),
  ('ACCT-REVIEW','Annual account review',           'Service',      'low',   14, NULL, ARRAY['Review coverage and exposures','Identify gaps / cross-sell','Document conversation']),
  ('LEAD',       'New lead',                        'Sales',        'high',   1, 24,  ARRAY['Contact prospect','Qualify','Create opportunity']),
  ('QUOTE',      'Quote request',                   'Sales',        'normal', 3, NULL, ARRAY['Gather exposure data','Submit to markets','Present quote']),
  ('CALL',       'Call back',                       'General',      'normal', 0, NULL, '{}'),
  ('FOLLOW-UP',  'Follow-up',                       'General',      'normal', 3, NULL, '{}'),
  ('EMAIL-IN',   'Email to review',                 'General',      'normal', 1, 24,  '{}'),
  ('LICENSE',    'License renewal',                 'Compliance',   'normal', 30, NULL, ARRAY['Complete CE','Renew with state']);

-- Surplus lines tax and stamping fee by state (TAX-01). Rates are illustrative: confirm with each state before relying on them.
INSERT INTO tax_rates (state, kind, rate_pct) VALUES
  ('NC','surplus_lines_tax',5.0000),('NC','stamping_fee',0.0000),
  ('SC','surplus_lines_tax',6.0000),('SC','stamping_fee',0.0000),
  ('VA','surplus_lines_tax',2.2500),('VA','stamping_fee',0.0000),
  ('GA','surplus_lines_tax',4.0000),('GA','stamping_fee',0.0000),
  ('TN','surplus_lines_tax',5.0000),('TN','stamping_fee',0.0000),
  ('FL','surplus_lines_tax',4.9400),('FL','stamping_fee',0.0600),
  ('TX','surplus_lines_tax',4.8500),('TX','stamping_fee',0.0400),
  ('CA','surplus_lines_tax',3.0000),('CA','stamping_fee',0.1800),
  ('NY','surplus_lines_tax',3.6000),('NY','stamping_fee',0.1500);

INSERT INTO settings (key, value) VALUES
  ('agency', '{"name":"Siryous Insurance Agency","address":"412 Fayetteville St, Suite 900, Raleigh, NC 27601","phone":"(919) 555-0140","license":"NC 0018834"}'),
  ('renewal_lead_days', '{"personal":45,"commercial_small":90,"commercial_large":120,"large_premium":25000}'),
  ('remarket_threshold_pct', '10'),
  ('waiting_followup_days', '{"client":3,"carrier":5,"internal":2,"other":3}'),
  ('automation_last_run', '"never"');
