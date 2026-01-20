# Documentation Consistency Audit

**Date**: 2026-01-20
**Scope**: All documentation in securities-law-schema repository
**Audience Standard**: Investment fund sponsors, RIA CCOs, securities compliance professionals

---

## Executive Summary

Analysis identified **one critical issue** requiring immediate action and several moderate issues requiring cleanup. The core technical documentation (DEVELOPMENT-PLAN.md, SYSTEM-HYGIENE.md, vendor-integrations.md) is well-framed for the target audience. However, ADR-003 is entirely off-topic and security.md contains IT-centric framing.

---

## CRITICAL ISSUES

### 1. ADR-003: Compliance Framework Alignment (DELETE OR REWRITE)

**File**: `docs/architecture/decisions/adr-003-compliance-framework-alignment.md`
**Severity**: CRITICAL
**Lines**: 475 total, only ~33 lines (~7%) relevant to securities law

**Problem**: This document maps the system to IT security compliance frameworks that have **nothing to do with securities law**:

| Framework | Relevance to RIA CCOs |
|-----------|----------------------|
| NIST CSF 2.0 | None - cybersecurity framework |
| ISO/IEC 42001 | None - AI management systems |
| NIST AI RMF | None - AI risk management |
| EU AI Act | None - EU AI regulation |
| SOC 2 Type II | Marginal - vendor evaluation only |
| PCI DSS 4.0 | None - payment card industry |
| FedRAMP | None - federal government |
| HIPAA | None - healthcare |
| CJIS | None - criminal justice |
| GDPR/CCPA | Marginal - data privacy |

**Relevant Content** (keep):
- SEC Rule 17a-4 (lines 138-144)
- FINRA Rule 4511 (lines 148-156)
- ABA Model Rules (lines 160-166) - only if law firm deployment

**Recommendation**:
1. DELETE the entire file, OR
2. Rewrite to cover ONLY:
   - SEC Rule 17a-4 (record retention)
   - FINRA Rule 4511 (books and records)
   - SEC Rule 206(4)-7 (compliance programs)
   - Investment Company Act requirements
   - Investment Advisers Act requirements

**Why This Matters**: An RIA CCO opening this document will see HIPAA, CJIS, PCI DSS and immediately question whether this system is for them. This destroys credibility with the target audience.

---

## MODERATE ISSUES

### 2. security.md: IT-Centric Framing

**File**: `docs/architecture/security.md`

| Line | Issue | Fix |
|------|-------|-----|
| 11 | "Zero Trust" | Remove or explain in plain language |
| 161 | "QLDB native" | Remove - QLDB is deprecated |
| 306 | "security team" | Change to "compliance team" or "operations" |

### 3. SBOM/SIEM References

**Files**: adr-003, adr-004, README decisions

| Term | File | Line | Issue |
|------|------|------|-------|
| SBOM | adr-003 | 47 | "Software Bill of Materials" - IT jargon |
| SIEM | adr-003 | 72, 188 | "Security Information and Event Management" - IT jargon |
| SIEM | adr-004 | 41 | "SIEM integrations" |
| SBOM | README.md (decisions) | 56 | Defined but unnecessary for audience |

**Recommendation**: Remove SBOM/SIEM references entirely. If ADR-003 is deleted, most of these disappear.

### 4. Penetration Testing References

**Files**: SYSTEM-HYGIENE.md (line 308), adr-003 (multiple)

**Assessment**: ACCEPTABLE for SYSTEM-HYGIENE.md - CCOs do engage third parties for annual security assessments. The term "penetration test" is understood in context.

### 5. README.md Line 173 - "ACA" Without Full Name

**Current**: `| Compliance | ComplySci, ACA, StarCompliance, RIA in a Box |`
**Fix**: Change "ACA" to "ACA Group" for clarity

---

## ACCEPTABLE (No Action Needed)

### Well-Framed Documents

| Document | Assessment |
|----------|------------|
| **DEVELOPMENT-PLAN.md** | Excellent. AUM-based economics, SEC 17a-4 focus, cost tiers appropriate for RIAs |
| **SYSTEM-HYGIENE.md** | Good. Technical but operational focus, appropriate for compliance teams with IT support |
| **vendor-integrations.md** | Excellent. Lists actual RIA/fund vendors (Orion, Redtail, Schwab, etc.) |
| **storage-compliance.md** | Good. WORM requirements clearly explained for SEC 17a-4 |
| **evidence-locker.md** | Good. Technical but appropriate for system implementers |
| **overview.md** | Good. Clean architecture description |
| **README.md** | Good. Clear purpose and structure |

### Acceptable Technical Terms

| Term | Reason Acceptable |
|------|------------------|
| OSCAL | Core schema format - must use |
| JSON-LD | Core data format - must use |
| Merkle tree | Technical but explained in context |
| Hash chain | Technical but explained in context |
| S3 Object Lock | Specific technology for SEC 17a-4 compliance |
| OAuth 2.0 | Vendor auth method - needed for integrations |

---

## VERIFIED CLEAN

The following problematic items have been successfully removed:

| Item | Status |
|------|--------|
| GRC (Governance, Risk, Compliance) | REMOVED |
| Vanta, Drata, Secureframe, Laika | REMOVED |
| ACA ComplianceAlpha | REMOVED |
| HITRUST references | REMOVED |
| Healthcare CISO references | REMOVED |
| Cloudflare R2 comparisons | REMOVED |

---

## ACTION ITEMS

### Priority 1 (Immediate)

1. **DELETE** `docs/architecture/decisions/adr-003-compliance-framework-alignment.md`
   - Or rewrite to focus exclusively on SEC/FINRA requirements
   - This file actively harms credibility with target audience

2. **EDIT** `docs/architecture/security.md`
   - Line 11: Remove "Zero Trust" or explain plainly
   - Line 161: Remove "QLDB native" reference
   - Line 306: Change "security team" to "compliance team"

### Priority 2 (Before Release)

3. **EDIT** `README.md` line 173
   - Change "ACA" to "ACA Group"

4. **EDIT** `docs/architecture/decisions/README.md`
   - Remove SBOM definition from terminology table (line 56)
   - Target audience doesn't need to know this term

5. **EDIT** `docs/architecture/decisions/adr-004-language-selection.md`
   - Line 41: Remove or rephrase "SIEM integrations"

---

## Framing Test

**Question**: Would an RIA CCO managing a $500M book understand this documentation?

| Document | Pass/Fail | Notes |
|----------|-----------|-------|
| README.md | PASS | Clear purpose |
| DEVELOPMENT-PLAN.md | PASS | Economics make sense |
| vendor-integrations.md | PASS | Recognizable vendors |
| storage-compliance.md | PASS | Explains WORM clearly |
| SYSTEM-HYGIENE.md | PASS | Technical but appropriate |
| security.md | PASS with edits | Minor IT jargon |
| adr-001 | PASS | Good blockchain rejection reasoning |
| adr-002 | PASS | Provider modularity clear |
| adr-003 | **FAIL** | Completely wrong audience |
| adr-004 | PASS with edits | Minor jargon |

---

## Conclusion

The repository is 90% well-framed for investment fund sponsors and RIA CCOs. The critical issue is ADR-003, which appears to have been written for a different audience entirely (IT security teams, healthcare, government contractors). Removing or rewriting this document will bring the repository to a consistent, audience-appropriate standard.
