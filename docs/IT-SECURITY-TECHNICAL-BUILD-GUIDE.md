# IT Security Technical Build Guide

## For CCOs, Fund Sponsors, and Non-Technical Stakeholders

**IMPORTANT**: This document contains the technical specifications your IT team, DevOps engineers, or managed service provider needs to build and secure this system properly.

**If you are not technical**:
1. Share this document with your IT team or technology vendor
2. Ask them to confirm they can implement these requirements
3. Have them explain how their build addresses each section
4. Include these requirements in any vendor RFP or SOW

**Why this matters**: SEC examiners will ask how your records are protected. This document provides the technical specifications that prove compliance. Without proper implementation, your compliance evidence could be questioned during examination.

---

## Table of Contents

1. [Plain-Language Glossary](#plain-language-glossary)
2. [Why Each Security Control Matters for SEC Compliance](#why-each-security-control-matters)
3. [Core Security Architecture](#core-security-architecture)
4. [Framework Compliance Mappings](#framework-compliance-mappings)
5. [Implementation Checklist](#implementation-checklist)

---

## Plain-Language Glossary

Before diving into technical requirements, here's what every term means in plain English:

### Network & Access Security

| Term | What It Means | Why You Care |
|------|---------------|--------------|
| **Zero Trust** | "Never trust, always verify" - every request must prove it's authorized, even from inside your network. This is a network security model, NOT blockchain or distributed ledger. | Prevents insider threats and compromised credentials from accessing records |
| **MFA (Multi-Factor Authentication)** | Requiring two or more proofs of identity (password + phone code, for example) | Stops unauthorized access even if passwords are stolen |
| **SSO (Single Sign-On)** | One login for multiple systems (like using your Google account to log into other apps) | Centralized access control, easier to revoke when employees leave |
| **RBAC (Role-Based Access Control)** | Permissions based on job function (CCO sees everything, analyst sees limited data) | Ensures people only access what they need for their job |
| **mTLS (Mutual TLS)** | Both sides of a connection verify each other's identity with certificates | Prevents man-in-the-middle attacks between your systems |

### Data Protection

| Term | What It Means | Why You Care |
|------|---------------|--------------|
| **Encryption at Rest** | Data is scrambled when stored so it's unreadable without the key | If someone steals your hard drive, they can't read the data |
| **Encryption in Transit** | Data is scrambled while moving between systems | Prevents eavesdropping on data as it moves across networks |
| **AES-256** | The encryption standard (256-bit Advanced Encryption Standard) | Industry standard, approved by U.S. government for classified information |
| **TLS 1.3** | The protocol that encrypts data moving between systems | Latest, most secure version - older versions have known vulnerabilities |
| **WORM (Write Once Read Many)** | Storage where data cannot be modified or deleted for a set period | **Required by SEC 17a-4** for electronic records |
| **Object Lock** | Cloud storage feature that enforces WORM at the storage layer | How AWS S3 and Azure implement SEC 17a-4 compliance |

### Audit & Monitoring

| Term | What It Means | Why You Care |
|------|---------------|--------------|
| **SIEM (Security Information and Event Management)** | Central system that collects all security logs and alerts on suspicious activity | Your IT team's dashboard for "what's happening across all systems" |
| **Audit Trail** | Chronological record of who did what, when | **SEC requires** you to prove what happened and when |
| **Hash Chain** | Each record contains a fingerprint of the previous record, making tampering detectable | Proves records haven't been altered after the fact |
| **Merkle Tree** | Mathematical structure that lets you verify data integrity efficiently | Allows auditors to verify specific records without reviewing everything |

### Software & Development

| Term | What It Means | Why You Care |
|------|---------------|--------------|
| **SBOM (Software Bill of Materials)** | Inventory of all software components and their versions | Know exactly what's in your system; required for some government contracts |
| **SAST/DAST** | Automated security testing of code (Static/Dynamic Application Security Testing) | Finds security vulnerabilities before hackers do |
| **CI/CD** | Automated building, testing, and deployment of software | Consistent, repeatable deployments with less human error |
| **Infrastructure-as-Code** | Server configurations written as code files, not manual setup | Reproducible environments, audit trail of configuration changes |

### Compliance Frameworks

| Framework | Who Uses It | What It Covers |
|-----------|-------------|----------------|
| **SEC 17a-4** | Broker-dealers, investment advisers | Electronic record retention requirements |
| **FINRA 4511** | Broker-dealers | Books and records requirements |
| **SOC 2 Type II** | Any service provider | Security controls verified by independent audit |
| **NIST CSF** | Everyone (voluntary) | Comprehensive cybersecurity framework |
| **FedRAMP** | Government contractors | Federal cloud security requirements |
| **HIPAA** | Healthcare only | Protected health information |
| **PCI DSS** | Payment card handlers | Credit card data protection |
| **GDPR/CCPA** | EU data / California residents | Privacy rights |

---

## Why Each Security Control Matters

### For SEC Examination

When SEC examiners review your compliance program, they will ask:

| Examiner Question | Technical Requirement | This Document Section |
|-------------------|----------------------|----------------------|
| "How do you ensure records can't be altered?" | WORM storage, hash chains | [Data Integrity Controls](#data-integrity-controls) |
| "Who has access to compliance records?" | RBAC, access logging | [Access Control](#access-control) |
| "How do you protect confidential investor data?" | Encryption at rest/in transit | [Encryption Requirements](#encryption-requirements) |
| "Can you produce records from a specific date?" | Audit trail, timestamp verification | [Audit Trail Architecture](#audit-trail-architecture) |
| "How do you know your systems haven't been compromised?" | SIEM, monitoring, penetration testing | [Monitoring & Detection](#monitoring-and-detection) |

### For FINRA Examination

| Examiner Question | Technical Requirement |
|-------------------|----------------------|
| "Where are your books and records stored?" | WORM-compliant storage with documented retention |
| "How do you supervise electronic communications?" | Communications archiving integration |
| "How long do you retain records?" | 6-year retention for general records, 3-year for correspondence |

---

## Core Security Architecture

### Zero Trust Model

**What this is**: A security approach where no user, device, or network is trusted by default. Every access request must be verified.

**What this is NOT**:
- NOT blockchain
- NOT distributed ledger technology
- NOT cryptocurrency-related

**How it works in this system**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ZERO TRUST ARCHITECTURE                          │
│                                                                       │
│  Every request must prove:                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ WHO you are  │  │ WHAT you're  │  │ WHETHER you  │              │
│  │ (Identity)   │  │ accessing    │  │ should have  │              │
│  │              │  │ (Resource)   │  │ access       │              │
│  │ • MFA        │  │ • API path   │  │ • RBAC check │              │
│  │ • Certificate│  │ • Database   │  │ • Time-based │              │
│  │ • Token      │  │ • File       │  │ • Location   │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│         │                  │                  │                      │
│         └──────────────────┼──────────────────┘                      │
│                            ▼                                         │
│                   ┌──────────────┐                                   │
│                   │   LOGGED     │  ← Every access recorded          │
│                   │   & AUDITED  │    for compliance                 │
│                   └──────────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Implementation requirements**:
- All users authenticate with MFA (something they know + something they have)
- Service-to-service communication uses mutual TLS (mTLS)
- All access is logged with timestamp, user identity, resource accessed, and action taken
- Access decisions are made per-request, not per-session

### Encryption Requirements

**At Rest (stored data)**:

| Data Type | Encryption Standard | Key Management |
|-----------|--------------------|--------------------|
| Database records | AES-256 | Cloud KMS or HSM |
| Evidence artifacts | AES-256 via SSE-KMS | Customer-managed key |
| Audit logs | AES-256 | Managed by WORM storage |
| Backups | AES-256 | Separate key from production |

**In Transit (moving data)**:

| Connection Type | Protocol | Minimum Version |
|-----------------|----------|-----------------|
| User to application | HTTPS | TLS 1.3 |
| Application to database | TLS | TLS 1.2+ (1.3 preferred) |
| Service to service | mTLS | TLS 1.3 |
| API calls | HTTPS | TLS 1.3 |

**Why TLS 1.3 specifically**: Older versions (TLS 1.0, 1.1) have known vulnerabilities. TLS 1.2 is acceptable but 1.3 is preferred for all new implementations.

### Access Control

**Role definitions** (customize for your organization):

| Role | Can View | Can Create | Can Modify | Can Delete |
|------|----------|------------|------------|------------|
| **Administrator** | Everything | Users, configs | Configs | Nothing (WORM) |
| **CCO / Compliance** | Everything | Evidence | Nothing | Nothing |
| **Analyst** | Assigned areas | Evidence drafts | Own drafts | Nothing |
| **Auditor** | Read-only, time-limited | Nothing | Nothing | Nothing |
| **System** | Logs only | Audit entries | Nothing | Nothing |

**Key principles**:
1. **Least privilege**: Users get minimum access needed for their job
2. **Separation of duties**: No single person can both create and approve
3. **Time-limited access**: Auditor tokens expire (72 hours recommended)
4. **Access reviews**: Quarterly review of who has access to what

### Data Integrity Controls

**Why this matters for SEC 17a-4**: You must prove records haven't been altered after creation.

**Hash chain implementation**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HASH CHAIN                                    │
│                                                                       │
│  Each record includes a "fingerprint" of the previous record         │
│                                                                       │
│  Record 1          Record 2          Record 3                        │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐                     │
│  │ Data     │     │ Data     │     │ Data     │                     │
│  │ Time: T1 │     │ Time: T2 │     │ Time: T3 │                     │
│  │ Prev: 0  │◄────│ Prev: H1 │◄────│ Prev: H2 │                     │
│  │ Hash: H1 │     │ Hash: H2 │     │ Hash: H3 │                     │
│  └──────────┘     └──────────┘     └──────────┘                     │
│                                                                       │
│  If ANYONE modifies Record 1, the hash changes, breaking the chain   │
│  → Tampering is mathematically detectable                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Merkle tree implementation**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MERKLE TREE                                   │
│                                                                       │
│  Allows efficient verification of any single record                  │
│                                                                       │
│                    ROOT HASH                                         │
│                   (signed daily)                                     │
│                    /        \                                        │
│                   /          \                                       │
│              Hash AB        Hash CD                                  │
│              /    \         /    \                                   │
│          Hash A  Hash B  Hash C  Hash D                              │
│            │       │       │       │                                 │
│         Record  Record  Record  Record                               │
│            A       B       C       D                                 │
│                                                                       │
│  To verify Record B: only need Hash A, Hash CD, and Root             │
│  → Auditor can verify specific records without full database access  │
└─────────────────────────────────────────────────────────────────────┘
```

### Audit Trail Architecture

**What gets logged** (minimum for SEC compliance):

| Event Type | Data Captured | Retention |
|------------|---------------|-----------|
| User login/logout | User ID, timestamp, IP, success/failure | 7 years |
| Record creation | Who, what, when, hash | Indefinite |
| Record access | Who, what, when, purpose | 7 years |
| Failed access attempts | Who, what, when, reason | 7 years |
| Configuration changes | Who, what, before/after, when | 7 years |
| System events | Service, event, timestamp | 90 days |

**Log integrity**: Audit logs themselves must be protected from tampering:
- Store in WORM-compliant storage (S3 Object Lock COMPLIANCE mode)
- Hash chain linking log entries
- Daily signed checkpoints

### Monitoring and Detection

**What your IT team needs to monitor**:

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| Failed login attempts | > 5 in 5 minutes | Block IP, notify security |
| Access outside business hours | Any | Review and confirm |
| Bulk data export | > 1000 records | Require approval |
| Configuration changes | Any | Require dual approval |
| System resource exhaustion | > 80% | Scale or investigate |
| Certificate expiration | < 30 days | Renew |

**SIEM integration** (if applicable):

Your IT team should configure their Security Information and Event Management system to:
1. Collect all logs from this system
2. Correlate with other security data sources
3. Alert on suspicious patterns
4. Retain logs per your retention policy

---

## Framework Compliance Mappings

### SEC Rule 17a-4 (Electronic Storage)

**This is the most important framework for investment advisers and broker-dealers.**

| 17a-4 Requirement | How This System Addresses It |
|-------------------|------------------------------|
| **(f)(2)(ii)(A)**: Preserve records exclusively in non-rewritable, non-erasable format | S3 Object Lock COMPLIANCE mode or Azure Immutable Blob |
| **(f)(2)(ii)(B)**: Verify quality and accuracy | Hash verification, Merkle tree proofs |
| **(f)(2)(ii)(C)**: Serialize, time-date, index | Timestamp on creation, searchable metadata, unique IDs |
| **(f)(2)(ii)(D)**: Download indexes | Export functionality for all metadata |
| **(f)(3)(v)**: Audit system capability | Complete audit trail, third-party verification |

### FINRA Rule 4511 (Books and Records)

| 4511 Requirement | How This System Addresses It |
|------------------|------------------------------|
| **(a)**: Make and keep records | Evidence locker with structured storage |
| **(b)**: Retention periods (6 years general, 3 years correspondence) | Configurable retention policies, automatic enforcement |
| **(c)**: Format requirements | WORM storage, indexed, searchable |

### NIST Cybersecurity Framework 2.0

For organizations that want or need to demonstrate NIST CSF compliance:

#### GOVERN Function

| Control | What It Means | How This System Addresses It |
|---------|---------------|------------------------------|
| GV.OC-01 | Document your organization's context | Deployment configuration documents environment |
| GV.RM-01 | Manage risk | Threat model documented, risk register maintained |
| GV.SC-01 | Manage supply chain risk | SBOM generation, dependency scanning |
| GV.PO-01 | Establish cybersecurity policy | Policy-as-code in access control configurations |

#### IDENTIFY Function

| Control | What It Means | How This System Addresses It |
|---------|---------------|------------------------------|
| ID.AM-01 | Know your hardware | Infrastructure-as-code defines all assets |
| ID.AM-02 | Know your software | SBOM (Software Bill of Materials) lists all components |
| ID.AM-03 | Map your network | Architecture diagrams in this documentation |
| ID.RA-01 | Find vulnerabilities | Automated vulnerability scanning |
| ID.RA-02 | Get threat intelligence | Security advisory monitoring |

#### PROTECT Function

| Control | What It Means | How This System Addresses It |
|---------|---------------|------------------------------|
| PR.AA-01 | Manage identities | SSO integration with your identity provider |
| PR.AA-02 | Verify users | MFA required for all users |
| PR.AA-03 | Control access | RBAC with least privilege |
| PR.DS-01 | Protect stored data | AES-256 encryption at rest |
| PR.DS-02 | Protect moving data | TLS 1.3 for all connections |
| PR.DS-10 | Ensure data integrity | Merkle trees, hash chains |

#### DETECT Function

| Control | What It Means | How This System Addresses It |
|---------|---------------|------------------------------|
| DE.CM-01 | Monitor your network | VPC flow logs, firewall logs |
| DE.CM-03 | Monitor your systems | Audit logging, host monitoring |
| DE.CM-06 | Monitor external services | API access logging |
| DE.AE-02 | Analyze events | SIEM integration, anomaly detection |

#### RESPOND Function

| Control | What It Means | How This System Addresses It |
|---------|---------------|------------------------------|
| RS.MA-01 | Manage incidents | Documented playbooks, on-call rotation |
| RS.AN-03 | Analyze incidents | Forensic logging, evidence preservation |
| RS.MI-01 | Contain incidents | Automated isolation capabilities |

#### RECOVER Function

| Control | What It Means | How This System Addresses It |
|---------|---------------|------------------------------|
| RC.RP-01 | Plan for recovery | Disaster recovery plan documented |
| RC.RP-02 | Execute recovery | Automated recovery procedures |

### SOC 2 Type II

For vendors or organizations needing SOC 2 certification:

| Trust Service Criteria | Implementation |
|------------------------|----------------|
| **CC6.1**: Logical access security | RBAC, MFA, audit logging |
| **CC6.6**: External threats | WAF, vulnerability scanning |
| **CC6.7**: Information transmission | TLS 1.3 mandatory |
| **CC7.1**: Vulnerability management | Automated scanning, patch management |
| **CC7.2**: Incident detection | SIEM integration, monitoring |
| **CC8.1**: Change management | GitOps, approval workflows |
| **A1.2**: System recovery | RTO/RPO defined and tested |
| **PI1.1**: Processing integrity | Data validation, hash verification |
| **C1.1**: Confidentiality | Data classification, encryption |

### Additional Frameworks

**If you are subject to these regulations, additional controls apply:**

| Framework | Additional Requirements |
|-----------|------------------------|
| **FedRAMP** | FIPS 140-2 validated cryptography, continuous monitoring |
| **PCI DSS** | Network segmentation for card data, quarterly scans, annual penetration testing |
| **HIPAA** | Business Associate Agreements, PHI access logging, minimum necessary enforcement |
| **GDPR** | Data Protection Impact Assessment, 72-hour breach notification, data subject request workflows |
| **CCPA/CPRA** | Consumer request handling, data inventory, opt-out mechanisms |

---

## Implementation Checklist

### Pre-Deployment

- [ ] IT team has reviewed this document
- [ ] Cloud provider accounts created (AWS/Azure/GCP)
- [ ] Identity provider configured (Okta, Azure AD, etc.)
- [ ] SSL/TLS certificates obtained
- [ ] KMS (Key Management Service) configured
- [ ] WORM storage configured (S3 Object Lock or Azure Immutable Blob)
- [ ] Network architecture designed (VPC, subnets, security groups)
- [ ] SIEM integration planned (if applicable)

### Security Configuration

- [ ] MFA enabled for all users
- [ ] RBAC roles defined and assigned
- [ ] TLS 1.3 configured for all connections
- [ ] Encryption at rest enabled for all data stores
- [ ] Audit logging enabled and tested
- [ ] Backup and recovery procedures tested
- [ ] Vulnerability scanning scheduled
- [ ] Security monitoring alerts configured

### Compliance Verification

- [ ] WORM storage tested (attempted delete fails)
- [ ] Hash chain integrity verified
- [ ] Merkle tree proof generation tested
- [ ] Audit trail exports reviewed
- [ ] Access logs reviewed
- [ ] Retention policies configured
- [ ] Evidence that IT team reviewed and approved this configuration

### Ongoing Maintenance

- [ ] Quarterly access reviews scheduled
- [ ] Annual penetration testing scheduled
- [ ] Security patches applied within SLA (Critical: 24h, High: 7 days)
- [ ] Backup restoration tested quarterly
- [ ] Disaster recovery tested annually
- [ ] Framework mapping reviewed annually or when frameworks update

---

## Document Maintenance

This technical guide should be reviewed:
- **Annually** at minimum
- **When any referenced framework is updated** (NIST, SEC rules, etc.)
- **When significant architecture changes occur**
- **After any security incident or audit finding**

**Last Updated**: 2026-01-20
**Document Owner**: [Your IT Security Team]
**Review Cycle**: Annual

---

## References

### Regulatory Sources
- [SEC Rule 17a-4](https://www.sec.gov/rules/interp/34-47806.htm) - Electronic storage requirements
- [FINRA Rule 4511](https://www.finra.org/rules-guidance/rulebooks/finra-rules/4511) - Books and records
- [SEC Regulation S-P](https://www.sec.gov/rules/final/34-42974.htm) - Privacy of consumer information

### Security Frameworks
- [NIST Cybersecurity Framework 2.0](https://www.nist.gov/cyberframework)
- [SOC 2 Trust Services Criteria](https://www.aicpa.org/soc2)
- [CIS Controls](https://www.cisecurity.org/controls)

### Technical Standards
- [NIST SP 800-53](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final) - Security and privacy controls
- [FIPS 140-2](https://csrc.nist.gov/publications/detail/fips/140/2/final) - Cryptographic module validation
- [TLS 1.3 Specification](https://datatracker.ietf.org/doc/html/rfc8446)
