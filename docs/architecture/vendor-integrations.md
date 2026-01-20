# Vendor Integrations for Automated Evidence Collection

This document catalogs vendor APIs and integration methods for automated compliance data collection. The goal is to pull data directly from vendors into the evidence locker, proving no opportunity for the firm to alter records.

---

## Direct Vendor-to-Locker Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Vendor APIs    │────▶│  Collection     │────▶│  Evidence       │
│  (Orion, etc.)  │     │  Service        │     │  Locker         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │                        │
                               │ Hash immediately       │ WORM storage
                               │ on receipt             │ (S3/Azure)
                               ▼                        ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  Audit Trail    │     │  Merkle Tree    │
                        │  (hash chain)   │     │  Checkpoints    │
                        └─────────────────┘     └─────────────────┘

KEY PRINCIPLE:
- Data flows directly from vendor → immediate hash → WORM storage
- No intermediate storage where firm could alter data
- Cryptographic proof of data integrity from source
- Demonstrates no opportunity for tampering
```

---

## Pull Interval Decision Matrix

| Factor | High Frequency (1-5 min) | Standard (Hourly) | Batch (Daily) |
|--------|--------------------------|-------------------|---------------|
| API cost per call | Low/unlimited | Metered | Metered |
| Data volume | Low (<1000 records/day) | Medium | High |
| Regulatory sensitivity | Real-time required | Standard | Acceptable |
| Compute cost | Acceptable | Optimize | Optimize |
| Vendor rate limits | Generous | Standard | Restrictive |

### Recommended Intervals by Data Type

| Data Type | Interval | Rationale |
|-----------|----------|-----------|
| Trade executions | 1-5 minutes | Time-sensitive, regulatory scrutiny |
| Client communications | 5-15 minutes | Compliance monitoring, off-channel risk |
| Account positions | Hourly | End-of-day reconciliation sufficient |
| CRM activities | Hourly | Audit trail, not real-time critical |
| Custodian statements | Daily | Batch files, reconciliation |
| Audit reports | On-receipt | Annual/quarterly, hash immediately |

---

## Portfolio Management & CRM

| Vendor | Type | API | Webhook | Recommended Interval | Auth Method |
|--------|------|-----|---------|----------------------|-------------|
| **Orion** | Portfolio Management | REST API | Yes | Hourly | OAuth 2.0 |
| **Redtail** | CRM | REST API | Yes | Hourly | API Key |
| **Salesforce Financial Services Cloud** | CRM | REST API | Yes | Configurable | OAuth 2.0 |
| **Wealthbox** | CRM | REST API | Yes | Hourly | OAuth 2.0 |
| **Tamarac** | Rebalancing/Reporting | REST API | Limited | Daily | API Key |
| **eMoney Advisor** | Financial Planning | REST API | Yes | Daily | OAuth 2.0 |
| **MoneyGuidePro** | Financial Planning | REST API | Limited | Daily | API Key |
| **RightCapital** | Financial Planning | REST API | Yes | Daily | OAuth 2.0 |
| **Riskalyze (Nitrogen)** | Risk Assessment | REST API | Yes | On-demand | OAuth 2.0 |
| **Addepar** | Portfolio Analytics | REST API | Yes | Hourly | OAuth 2.0 |
| **Envestnet** | Unified Managed Accounts | REST API | Yes | Hourly | OAuth 2.0 |

### Key Data Points to Collect

**From Portfolio Systems:**
- Account positions and holdings
- Trade history and executions
- Performance calculations
- Fee schedules and billing
- Model assignments

**From CRM Systems:**
- Client contact records
- Meeting notes and activities
- Document attachments
- Task completions
- Communication logs

---

## Custodians & Clearing Houses

| Vendor | Type | Integration | Auth | Notes |
|--------|------|-------------|------|-------|
| **Pershing (BNY Mellon)** | Clearing/Custody | NetX360 API, SFTP | Certificate | Batch files, end-of-day |
| **Schwab/NFS** | Clearing/Custody | Schwab Advisor Services API | OAuth 2.0 | REST API available |
| **Fidelity** | Custody | Wealthscape API | OAuth 2.0 | REST API |
| **TD Ameritrade Institutional** | Custody | VEO One API | OAuth 2.0 | Migrating to Schwab |
| **Altruist** | Custody | REST API | OAuth 2.0 | Modern API-first |
| **Interactive Brokers** | Prime Brokerage/Custody | Client Portal API | OAuth 2.0 | REST + WebSocket |
| **Apex Clearing** | Clearing | REST API | OAuth 2.0 | Modern fintech clearing |
| **Axos Advisor Services** | Custody | REST API | API Key | Growing platform |
| **SEI** | Custody/Administration | Wealth Platform API | OAuth 2.0 | Enterprise |
| **State Street** | Custody/Administration | Alpha API | OAuth 2.0 | Institutional |
| **Northern Trust** | Custody | Passport API | OAuth 2.0 | Institutional |
| **US Bank** | Custody | REST API | OAuth 2.0 | Fund administration |
| **CAIS** | Alternative Investments | REST API | OAuth 2.0 | Alts platform |

### Key Data Points to Collect

**From Custodians:**
- Daily account statements
- Trade confirmations
- Position reconciliation files
- Corporate actions
- Fee schedules
- Tax documents (1099, K-1)

---

## Communications Archiving (Off-Channel Compliance)

All vendors in this category are **SEC 17a-4 compliant** and meet encryption at rest and in transit requirements.

| Vendor | Type | API | Webhook | Coverage |
|--------|------|-----|---------|----------|
| **Smarsh** | Unified archiving | REST API | Yes | Email, social, SMS, voice |
| **Global Relay** | Unified archiving | REST API | Yes | Email, IM, social, voice |
| **Proofpoint** | Email archiving | REST API | Yes | Email, social |
| **Theta Lake** | Video/voice compliance | REST API | Yes | Zoom, Teams, Webex |
| **MirrorWeb** | Social media archiving | REST API | Yes | LinkedIn, Twitter, Facebook |
| **LeapXpert** | Messaging compliance | REST API | Yes | WhatsApp, WeChat, Telegram |
| **Aware (MessageWatcher)** | Unified comms | REST API | Yes | All channels |
| **Telemessage** | Mobile archiving | REST API | Yes | SMS, WhatsApp, Signal |

### Compliance Note

> These vendors maintain their own 17a-4 compliant archives. Pulling data into your evidence locker creates a **secondary verified copy** with your own cryptographic chain of custody, independent of the vendor's archive.

---

## Compliance & Regulatory Tools

| Vendor | Type | API | Notes |
|--------|------|-----|-------|
| **ComplySci** | Personal trading/Code of Ethics | REST API | Pre-clearance, holdings |
| **StarCompliance** | Personal trading | REST API | Code of ethics, gifts |
| **MCO (MyComplianceOffice)** | Compliance workflow | REST API | Gift/entertainment tracking |
| **NRS (National Regulatory Services)** | Compliance consulting | File export | Mock exams, ADV filings |
| **RIA in a Box** | Compliance software | REST API | ADV management, tasks |
| **Smartria** | Compliance workflow | REST API | Task management, testing |
| **IronGrotto.com** | Compliance intelligence | API (planned) | Regulatory analytics |
| **ADVdraft.com** | ADV preparation | API (planned) | Form ADV automation |

### Key Data Points to Collect

**From Compliance Systems:**
- Personal trading pre-clearances and reports
- Code of ethics attestations
- Gift and entertainment logs
- Policy acknowledgments
- Training completion records
- Compliance testing results

---

## Third-Party CCO Services

| Vendor | Type | Integration | Notes |
|--------|------|-------------|-------|
| **Foreside** | Outsourced CCO | Manual/file-based | Large fund complexes |
| **Vigilant Compliance** | Outsourced CCO | Manual/file-based | RIA focused |
| **IMS (Integrated Management Solutions)** | Outsourced compliance | Manual/file-based | Hedge funds |
| **Hardin Compliance** | Outsourced CCO | Manual/file-based | Boutique |
| **Archer Compliance** | Outsourced compliance | Manual/file-based | Mid-market |
| **CSS (Compliance Solutions Strategies)** | Outsourced CCO | Manual/file-based | RIA/BD |

### Integration Pattern for Manual Providers

```
Third-Party CCO prepares report
        │
        ▼
Upload to secure portal ──────▶ Hash on upload ──────▶ WORM storage
        │
        ▼
Audit trail records:
- Upload timestamp
- Uploader identity
- Document hash
- Report period
```

---

## Third-Party Due Diligence Providers

| Vendor | Type | API | Notes |
|--------|------|-----|-------|
| **Morningstar Manager Research** | Manager due diligence | REST API | Fund/manager analysis |
| **eVestment** | Institutional DD | REST API | Manager database |
| **Mercer** | Investment consulting | File-based | Manager research |
| **Callan** | Investment consulting | File-based | Manager search |
| **Cambridge Associates** | Alternatives DD | File-based | PE/VC due diligence |
| **Zanbato** | Private market DD | REST API | Secondary market |
| **DiligenceVault** | DD document management | REST API | DDQ automation |
| **Dun & Bradstreet** | Business verification | REST API | KYB checks |
| **LexisNexis** | Background checks | REST API | AML/KYC screening |

### Key Data Points to Collect

**From DD Providers:**
- Manager questionnaires (DDQs)
- Operational due diligence reports
- Background check results
- AML/KYC verification records
- Manager meeting notes

---

## Independent Valuation Advisory

| Vendor | Type | Integration | Use Case |
|--------|------|-------------|----------|
| **Houlihan Lokey** | Valuation advisory | Secure file transfer | Large transactions |
| **Duff & Phelps (Kroll)** | Valuation services | Secure file transfer | PE/VC portfolios |
| **Lincoln International** | Valuation | Secure file transfer | Middle market |
| **Murray Devine** | Valuation | Secure file transfer | Illiquid assets |
| **RSM** | Valuation services | Secure file transfer | Mid-market |
| **Stout** | Valuation advisory | Secure file transfer | Complex securities |

### Integration Pattern

```
Valuation firm delivers report
        │
        ▼
Receive via secure channel ──▶ Hash immediately ──▶ WORM storage
        │
        ▼
Link to:
- Fund/portfolio being valued
- Valuation date
- Asset class
- Methodology used
```

---

## Fund Auditors (Top 20 Accounting Firms)

| Vendor | Type | Integration | Typical Clients |
|--------|------|-------------|-----------------|
| **PwC** | Big 4 Audit | Secure portal | Large funds ($1B+) |
| **Deloitte** | Big 4 Audit | Secure portal | Large funds ($1B+) |
| **EY (Ernst & Young)** | Big 4 Audit | Secure portal | Large funds ($1B+) |
| **KPMG** | Big 4 Audit | Secure portal | Large funds ($1B+) |
| **RSM US** | Fund audit | Secure portal | Mid-market ($100M-$1B) |
| **BDO** | Fund audit | Secure portal | Mid-market |
| **Grant Thornton** | Fund audit | Secure portal | Mid-market |
| **Marcum** | Fund audit | Secure portal | Hedge funds |
| **EisnerAmper** | Fund audit | Secure portal | PE/Hedge funds |
| **Anchin** | Fund audit | Secure portal | Hedge funds (NYC) |
| **WithumSmith+Brown** | Fund audit | Secure portal | Mid-market |
| **Berdon** | Fund audit | Secure file | NY-focused |
| **Citrin Cooperman** | Fund audit | Secure file | Mid-market |
| **Friedman LLP** | Fund audit | Secure file | Alternatives |
| **CohnReznick** | Fund audit | Secure portal | PE/VC |
| **Moss Adams** | Fund audit | Secure portal | West coast |
| **Crowe** | Fund audit | Secure portal | Mid-market |
| **Baker Tilly** | Fund audit | Secure portal | Mid-market |
| **Plante Moran** | Fund audit | Secure portal | Midwest |
| **CBIZ** | Fund audit | Secure file | Mid-market |

### Key Documents to Archive

**From Auditors:**
- Audited financial statements
- Management letters
- Internal control reports
- Tax returns and schedules
- Audit planning documents
- Representation letters

---

## Trade Execution & Market Data

| Vendor | Type | API | Protocol |
|--------|------|-----|----------|
| **Bloomberg EMSX** | Trade execution | FIX | FIX 4.2/4.4 |
| **FactSet** | Data/Analytics | REST API | HTTPS |
| **Morningstar** | Data/Analytics | REST API | HTTPS |
| **Black Diamond** | Performance reporting | REST API | HTTPS |
| **Refinitiv (LSEG)** | Market data | REST API | HTTPS |
| **ICE Data Services** | Pricing/Reference | REST API | HTTPS |
| **S&P Capital IQ** | Research/Data | REST API | HTTPS |

---

## Escrow & Trust Services

| Vendor | Type | Integration |
|--------|------|-------------|
| **Equity Trust** | Self-directed IRA custody | API available |
| **Millennium Trust** | Alternative asset custody | File-based + API |
| **Private escrow agents** | Deal-specific | Manual (varies) |

---

## Implementation Checklist

### Phase 1: Critical Integrations
- [ ] Custodian data feeds (positions, transactions)
- [ ] Communications archiver API connection
- [ ] CRM/Portfolio system integration

### Phase 2: Compliance Tools
- [ ] Personal trading system (ComplySci/Star)
- [ ] Code of ethics platform
- [ ] Gift/entertainment tracking

### Phase 3: Third-Party Reports
- [ ] Auditor document intake workflow
- [ ] Valuation report archival
- [ ] Due diligence document management

### Phase 4: Full Automation
- [ ] Webhook receivers for real-time data
- [ ] Scheduled pull jobs for batch data
- [ ] Alert system for failed pulls
- [ ] Reconciliation reports

---

## Security Requirements

All vendor integrations must meet:

| Requirement | Standard |
|-------------|----------|
| Encryption in Transit | TLS 1.2+ |
| Encryption at Rest | AES-256 |
| Authentication | OAuth 2.0 or API keys with rotation |
| IP Allowlisting | Where supported |
| Audit Logging | All API calls logged |
| Secret Management | Vault or cloud secret manager |

---

## Webhook Configuration

For vendors supporting webhooks, configure:

```typescript
// Example webhook handler
app.post('/webhooks/:vendor', async (req, res) => {
  const { vendor } = req.params;
  const payload = req.body;

  // 1. Verify webhook signature (vendor-specific)
  if (!verifySignature(req, vendor)) {
    return res.status(401).send('Invalid signature');
  }

  // 2. Hash payload immediately
  const hash = sha256(JSON.stringify(payload));

  // 3. Store in WORM storage
  await storage.store(`webhooks/${vendor}/${Date.now()}.json`, payload, {
    retention: { days: 2555, mode: 'compliance' }
  });

  // 4. Record in audit trail
  await auditTrail.record({
    eventType: 'VENDOR_WEBHOOK_RECEIVED',
    vendor,
    payloadHash: hash,
    timestamp: new Date()
  });

  res.status(200).send('OK');
});
```

---

## Contact Information

For vendor API access, contact their respective partner/developer programs:

- **Orion**: [orionadvisortech.com/api](https://orionadvisortech.com)
- **Redtail**: [redtailtechnology.com/api](https://redtailtechnology.com)
- **Schwab**: Schwab Advisor Services
- **Smarsh**: [smarsh.com/partners](https://smarsh.com)
- **ComplySci**: [complysci.com](https://complysci.com)
