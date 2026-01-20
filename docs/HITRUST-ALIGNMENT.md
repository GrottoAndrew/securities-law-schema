# HITRUST Alignment: Certification Levels and Cost Trade-offs

## Overview

This document maps the compliance system architecture to HITRUST CSF certification levels, providing guidance for firms operating under both SEC regulations and healthcare data requirements (common for RIAs with healthcare sector clients or health-focused funds).

---

## HITRUST Certification Levels

| Level | Name | Duration | Control Count | Typical Use Case |
|-------|------|----------|---------------|------------------|
| **e1** | Essentials | 1 year | 44 controls | Startups, low-risk data |
| **i1** | Implemented | 1 year | 182 controls | SMBs, moderate risk |
| **r2** | Risk-based | 2 years | 300-500+ controls | Enterprise, high-risk data, regulatory |

### Why This Matters for Securities Compliance

Many RIAs and fund managers handle:
- **Healthcare sector investments** (PE funds, VC in healthtech)
- **ERISA plan assets** (retirement accounts with health benefits data)
- **Family office clients** with healthcare businesses
- **Institutional clients** requiring HITRUST certification from vendors

If your clients or LPs require HITRUST r2 certification, your compliance evidence system must support that level of rigor.

---

## HITRUST Level Mapping to System Tiers

| System Tier | HITRUST Alignment | Rationale |
|-------------|-------------------|-----------|
| **Demo** | None | No production data, development only |
| **Starter** | e1 (Essentials) | Basic controls, cost-conscious, low AUM |
| **Growth** | i1 (Implemented) | Good hygiene, documented controls |
| **Professional** | r2-ready | Full control coverage, audit support |
| **Enterprise** | r2 certified | Complete evidence, continuous monitoring |

---

## The r2 Cost Reality

### What r2 Certification Actually Costs

| Cost Component | Range | Notes |
|----------------|-------|-------|
| Assessment fees | $50K-150K | Depends on scope |
| Remediation | $50K-500K | Gap-dependent |
| Annual maintenance | $30K-100K | Continuous monitoring |
| Internal staff time | 500-2000 hours | Documentation, evidence |
| **Total first year** | **$150K-750K** | Varies wildly by maturity |

### The Problem for Smaller Firms

A solo RIA managing $50M at 1% earns $500K gross. Spending $200K on HITRUST r2 isn't viable.

**But here's the key insight**: Many firms don't need full r2. They need to demonstrate they *could* achieve r2 with their architecture, or they need i1/e1 with a roadmap to r2.

---

## Control Mapping: Securities Compliance to HITRUST

### Audit Trail Controls (HITRUST 09.aa - 09.af)

| HITRUST Control | SEC Requirement | System Implementation |
|-----------------|-----------------|----------------------|
| 09.aa Audit Logging | 17a-4 record retention | Hash chain in PostgreSQL |
| 09.ab Monitoring System Use | Books and records | All access logged |
| 09.ac Protection of Log Info | Tamper-evident records | Merkle tree checkpoints |
| 09.ad Admin/Operator Logs | Supervisory requirements | Separate admin audit |
| 09.ae Clock Synchronization | Accurate timestamps | NTP, logged in audit |
| 09.af Log Retention | 7-year retention | WORM storage (S3/Azure) |

### Data Protection Controls (HITRUST 06.d - 06.f)

| HITRUST Control | SEC Requirement | System Implementation |
|-----------------|-----------------|----------------------|
| 06.d Data Protection | Client confidentiality | Encryption at rest/transit |
| 06.e Prevention of Misuse | Fiduciary duty | Access controls, audit |
| 06.f Regulation of Crypto | Key management | HSM/KMS for signing keys |

### Access Control (HITRUST 01.a - 01.y)

| HITRUST Control | SEC Requirement | System Implementation |
|-----------------|-----------------|----------------------|
| 01.a Access Control Policy | Need-to-know basis | RBAC implementation |
| 01.b User Registration | Authorized users only | Identity provider integration |
| 01.c Privilege Management | Least privilege | Role-based, audited |
| 01.j User Authentication | Identity verification | MFA required |

---

## Architecture Decisions by HITRUST Level

### e1-Aligned (Starter Tier)

```
┌─────────────────────────────────────────────────────────┐
│  e1 Architecture: 44 Essential Controls                  │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐                       │
│  │ Supabase    │  │ Backblaze   │                       │
│  │ PostgreSQL  │  │ B2 (WORM)   │                       │
│  └─────────────┘  └─────────────┘                       │
│        │                │                                │
│  Audit metadata    Evidence storage                      │
│  (encrypted)       (Object Lock)                         │
│                                                          │
│  Controls Met:                                           │
│  ✓ 09.af Log Retention (B2 Object Lock)                 │
│  ✓ 06.d Data Protection (TLS + encryption)              │
│  ✓ 01.j Authentication (Supabase Auth)                  │
│                                                          │
│  Controls Partial:                                       │
│  ~ 09.ac Protection of Log Info (no HSM)                │
│  ~ 01.c Privilege Management (basic RBAC)               │
└─────────────────────────────────────────────────────────┘
```

**Cost**: $30-60/month
**Certification path**: e1 achievable, i1 with enhancements

### i1-Aligned (Growth Tier)

```
┌─────────────────────────────────────────────────────────┐
│  i1 Architecture: 182 Implemented Controls               │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ RDS         │  │ S3 Object   │  │ CloudWatch  │     │
│  │ PostgreSQL  │  │ Lock        │  │ Logs        │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│        │                │                │              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Secrets     │  │ KMS         │  │ IAM         │     │
│  │ Manager     │  │ (signing)   │  │ (access)    │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  Controls Met:                                           │
│  ✓ All e1 controls                                      │
│  ✓ 06.f Regulation of Crypto (KMS)                      │
│  ✓ 09.ab Monitoring (CloudWatch)                        │
│  ✓ 01.c Privilege Management (IAM policies)             │
│                                                          │
│  Controls Partial:                                       │
│  ~ 09.ac Full log protection (needs SIEM)               │
│  ~ Continuous monitoring (needs tooling)                │
└─────────────────────────────────────────────────────────┘
```

**Cost**: $100-200/month
**Certification path**: i1 achievable, r2 roadmap clear

### r2-Aligned (Professional/Enterprise Tier)

```
┌─────────────────────────────────────────────────────────────────┐
│  r2 Architecture: 300-500+ Risk-Based Controls                   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Multi-AZ / Multi-Region                                     │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │ │
│  │  │ Aurora      │  │ S3 Object   │  │ CloudHSM    │         │ │
│  │  │ PostgreSQL  │  │ Lock + CRR  │  │ (FIPS 140-2)│         │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│        │                │                │                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Security & Monitoring Stack                                 │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │ │
│  │  │ GuardDuty│ │ Security│ │ Config  │ │ SIEM    │           │ │
│  │  │         │ │ Hub     │ │ Rules   │ │ (Splunk)│           │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Controls Met:                                                    │
│  ✓ All e1 + i1 controls                                          │
│  ✓ 09.ac Full log protection (SIEM, immutable)                   │
│  ✓ 06.f FIPS 140-2 Level 3 (CloudHSM)                           │
│  ✓ Business continuity (Multi-region)                            │
│  ✓ Incident response (GuardDuty, automated)                      │
│  ✓ Continuous monitoring (Security Hub)                          │
└─────────────────────────────────────────────────────────────────┘
```

**Cost**: $800-2,000/month infrastructure + assessment fees
**Certification path**: r2 achievable with proper documentation

---

## Practical Guidance by Firm Type

### Solo RIA / Fee-Only Planner (<$100M AUM)

**Reality**: You probably don't need HITRUST certification. Your clients don't require it.

**What you need**:
- SEC 17a-4 compliance (achievable at Starter tier)
- Basic security hygiene
- Documented controls for examination

**Recommendation**: Starter tier, e1-aligned architecture
**Monthly cost**: $30-60
**Path forward**: If a large client requires HITRUST, you have a clear upgrade path

### Small RIA with Healthcare Clients ($100M-500M AUM)

**Reality**: Some institutional healthcare clients may ask about HITRUST.

**What you need**:
- SEC 17a-4 compliance
- Demonstrable security controls
- Ability to complete HITRUST questionnaires

**Recommendation**: Growth tier, i1-aligned architecture
**Monthly cost**: $100-200
**Path forward**: Can achieve i1 certification if required (~$50K total cost)

### Mid-Tier with ERISA/Healthcare Focus ($500M-2B AUM)

**Reality**: LPs or plan sponsors may require HITRUST r2.

**What you need**:
- Full SEC compliance
- r2-ready architecture
- Continuous monitoring
- Audit-ready evidence

**Recommendation**: Professional tier, r2-aligned architecture
**Monthly cost**: $400-800
**Path forward**: r2 certification achievable (~$150-300K total cost)

### Large Manager / Fund Administrator ($2B+ AUM)

**Reality**: HITRUST r2 is likely required by multiple stakeholders.

**What you need**:
- Everything above
- Multi-region DR
- FIPS 140-2 Level 3 cryptography
- 24/7 SOC integration

**Recommendation**: Enterprise tier, r2 certified
**Monthly cost**: $1,500-3,000+
**Assessment cost**: $200-500K depending on scope

---

## Evidence Collection for HITRUST Assessment

### What Assessors Will Request

| Evidence Type | What They Want | How This System Provides |
|---------------|---------------|-------------------------|
| Audit logs | 90 days of logs | PostgreSQL audit_events + S3 archives |
| Access reviews | Quarterly reviews | Export from audit trail |
| Encryption proof | Key management docs | KMS/HSM configuration exports |
| Incident logs | Last 12 months | Filtered audit trail export |
| Retention proof | 7-year capability | S3 Object Lock configuration |
| Integrity verification | Tamper evidence | Merkle proof generation |

### Automated Evidence Export

```typescript
// Future CLI command for HITRUST evidence collection
slc export hitrust --control-family "09" --period "2024-Q1" --output ./hitrust-evidence/

// Generates:
// ./hitrust-evidence/
// ├── 09.aa-audit-logging/
// │   ├── sample-logs.json
// │   ├── log-retention-policy.md
// │   └── screenshots/
// ├── 09.ac-log-protection/
// │   ├── merkle-proofs.json
// │   ├── worm-configuration.md
// │   └── access-controls.json
// └── manifest.json (with hashes)
```

---

## Cost-Benefit Analysis

### When to Invest in Higher HITRUST Levels

| Trigger | Recommended Action |
|---------|-------------------|
| Single healthcare LP requests it | Ask if i1 suffices |
| Multiple LPs require r2 | Budget for r2 assessment |
| Healthcare >50% of AUM | r2 is cost of doing business |
| Competing for institutional mandates | r2 is table stakes |
| No healthcare exposure | SEC compliance sufficient |

### ROI Calculation

**Scenario**: $500M healthcare-focused fund, 0.75% management fee = $3.75M revenue

| Investment | Cost | Benefit |
|------------|------|---------|
| Professional tier infra | $8K/year | Enables r2 readiness |
| i1 certification | $75K first year | Satisfies most LPs |
| r2 certification | $200K first year | Opens institutional doors |
| Lost mandate without r2 | $0 | Potentially $1M+ in fees |

**If one $100M mandate requires r2, certification pays for itself.**

---

## Summary: The r2 Analogy Revisited

Just as HITRUST offers three levels (e1, i1, r2) with increasing rigor and cost, this compliance system offers tiers that align:

| HITRUST | System Tier | Monthly Cost | Certification Cost | Total Year 1 |
|---------|-------------|--------------|-------------------|--------------|
| e1 | Starter | $50 | $15-25K | ~$16-26K |
| i1 | Growth | $150 | $50-75K | ~$52-77K |
| r2 | Professional | $600 | $150-300K | ~$157-307K |
| r2 + SOC | Enterprise | $2,000 | $250-500K | ~$274-524K |

**The key insight**: You can be SEC 17a-4 compliant at any tier. HITRUST certification is an additional requirement driven by your client base, not SEC regulations. Choose the tier that matches your actual business needs, not aspirational ones.
