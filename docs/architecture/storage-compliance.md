# Storage Provider Compliance Guide

This document explains the storage requirements for SEC 17a-4 compliance and the limitations of each storage provider option.

---

## Critical: PostgreSQL is NOT WORM Compliant

> **WARNING: PostgreSQL CANNOT provide true WORM (Write Once Read Many) guarantees.**
>
> - Database administrators can DELETE or UPDATE rows at any time
> - No hardware-level write protection exists
> - Database triggers can be disabled by superusers
> - Backup restoration can overwrite audit history
>
> **PostgreSQL is suitable ONLY for demos, development, and testing.**
>
> For SEC 17a-4, FINRA 4511, or any regulatory WORM requirement, you MUST use S3 Object Lock (COMPLIANCE mode) or Azure Immutable Blob Storage.

---

## Storage Provider Comparison

| Provider | WORM Support | SEC 17a-4 Compliant | Deletion by Admin | Use Case |
|----------|--------------|---------------------|-------------------|----------|
| **PostgreSQL** | NO | **NO** | Yes (always) | Demo/development only |
| **AWS S3 Object Lock (COMPLIANCE)** | YES | YES | No (until retention expires) | Production |
| **AWS S3 Object Lock (GOVERNANCE)** | Partial | **NO** | Yes (with permissions) | Testing only |
| **Azure Blob Immutable Storage** | YES | YES | No (until retention expires) | Production |
| **GCP Cloud Storage Bucket Lock** | YES | YES | No (until retention expires) | Production |

---

## AWS S3 Object Lock

### COMPLIANCE Mode (Required for SEC 17a-4)

```
┌─────────────────────────────────────────────────────────────────┐
│                    S3 OBJECT LOCK - COMPLIANCE MODE             │
├─────────────────────────────────────────────────────────────────┤
│  • Objects CANNOT be deleted by anyone                          │
│  • Not even the root account can delete before retention ends   │
│  • Retention period: Configure for 7 years (2555 days)          │
│  • Legal holds: Additional protection for litigation            │
│  • Versioning: Required, automatically enabled                  │
└─────────────────────────────────────────────────────────────────┘
```

**Configuration:**
```typescript
// When creating bucket
{
  ObjectLockConfiguration: {
    ObjectLockEnabled: 'Enabled',
    Rule: {
      DefaultRetention: {
        Mode: 'COMPLIANCE',  // NOT 'GOVERNANCE'
        Days: 2555           // 7 years
      }
    }
  }
}
```

### GOVERNANCE Mode (NOT Compliant)

> **WARNING: GOVERNANCE mode is NOT SEC 17a-4 compliant.**
>
> Users with `s3:BypassGovernanceRetention` permission can delete objects.
> This defeats the purpose of WORM storage for regulatory requirements.

---

## Azure Blob Immutable Storage

Azure Immutable Blob Storage is the recommended option for organizations already using the Microsoft ecosystem. Most financial services compliance teams have already approved Azure for sensitive workloads.

### Time-Based Retention Policy

```
┌─────────────────────────────────────────────────────────────────┐
│              AZURE IMMUTABLE BLOB STORAGE                       │
├─────────────────────────────────────────────────────────────────┤
│  • Time-based retention policies (locked)                       │
│  • Legal holds for litigation                                   │
│  • WORM compliance verified by Cohasset Associates              │
│  • SEC 17a-4(f), FINRA 4511, CFTC 1.31 compliant               │
│  • Integrates with Azure AD for access control                  │
└─────────────────────────────────────────────────────────────────┘
```

**Configuration:**
```json
{
  "immutabilityPolicy": {
    "immutabilityPeriodSinceCreationInDays": 2555,
    "allowProtectedAppendWrites": false
  }
}
```

### Legal Hold

Legal holds can be applied independently of retention policies:
- Useful for litigation preservation
- Can be applied/removed without affecting retention
- Multiple holds can be active simultaneously

---

## GCP Cloud Storage Bucket Lock

Google Cloud Storage provides Bucket Lock for WORM compliance:

- Retention policies at bucket level
- Once locked, cannot be shortened or removed
- Objects cannot be deleted until retention expires
- Supports SEC 17a-4 requirements

---

## Provider Selection Guide

### Choose PostgreSQL-Only When:
- Running demos or proof-of-concept
- Local development environment
- Testing without cloud credentials
- **Never for production compliance**

### Choose AWS S3 Object Lock When:
- Already using AWS infrastructure
- Need programmatic access via AWS SDK
- Require integration with AWS services (Lambda, CloudWatch, etc.)
- Multi-region replication needed

### Choose Azure Immutable Storage When:
- Organization uses Microsoft 365 / Azure AD
- Compliance team has pre-approved Microsoft ecosystem
- Need integration with Azure services
- Using Microsoft Sentinel for security monitoring

### Choose GCP Bucket Lock When:
- Organization standardized on Google Cloud
- Using BigQuery for analytics
- Need integration with GCP services

---

## Encryption Requirements

All providers must meet encryption requirements:

### Encryption at Rest
| Provider | Default | Recommended |
|----------|---------|-------------|
| AWS S3 | SSE-S3 | SSE-KMS with CMK |
| Azure Blob | Microsoft-managed | Customer-managed keys |
| GCP GCS | Google-managed | Customer-managed (CMEK) |

### Encryption in Transit
- All providers: TLS 1.2+ required
- Enforce via bucket/container policies
- Reject non-HTTPS requests

---

## Compliance Certifications

Verify your chosen provider has relevant certifications:

| Certification | AWS S3 | Azure Blob | GCP GCS |
|---------------|--------|------------|---------|
| SOC 2 Type II | ✓ | ✓ | ✓ |
| SEC 17a-4 | ✓ (Cohasset) | ✓ (Cohasset) | ✓ |
| FINRA 4511 | ✓ | ✓ | ✓ |
| HIPAA | ✓ (BAA) | ✓ (BAA) | ✓ (BAA) |
| FedRAMP | ✓ (High) | ✓ (High) | ✓ (High) |

---

## Implementation Checklist

- [ ] Select WORM-compliant storage provider (NOT PostgreSQL for production)
- [ ] Configure COMPLIANCE mode retention (not GOVERNANCE)
- [ ] Set retention period to minimum 7 years (2555 days)
- [ ] Enable versioning (required for S3 Object Lock)
- [ ] Configure encryption at rest with customer-managed keys
- [ ] Enforce TLS 1.2+ for all connections
- [ ] Document provider compliance certifications
- [ ] Test legal hold functionality
- [ ] Verify deletion is blocked before retention expires
