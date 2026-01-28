# Security Architecture

This document describes the security model for the compliance management system.

## Security Principles

1. **Defense in Depth**: Multiple layers of security controls
2. **Least Privilege**: Minimal access rights for each role
3. **Immutability**: Audit trails and catalog versions cannot be modified
4. **Cryptographic Verification**: All critical data is signed and verifiable
5. **Zero Trust**: All requests authenticated and authorized

---

## Authentication & Authorization

### Identity Providers

| User Type        | Auth Method      | Identity Provider              |
| ---------------- | ---------------- | ------------------------------ |
| Internal Users   | SSO/SAML         | Corporate IdP (Okta, Azure AD) |
| Auditors         | Time-limited JWT | Issued by system admin         |
| Service Accounts | API Keys + mTLS  | Internal PKI                   |

### Role-Based Access Control (RBAC)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           PERMISSION MATRIX                             │
├─────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┤
│ Resource        │  Admin   │ Compliance│ Viewer  │ Auditor  │  System  │
│                 │          │  Team     │         │          │          │
├─────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ Catalog         │  R/W     │  R       │  R      │  R       │  R       │
│ Publish         │  ✓       │  ✗       │  ✗      │  ✗       │  ✗       │
├─────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ Evidence        │  R/W     │  R/W     │  R      │  R       │  R/W     │
│ Submit          │  ✓       │  ✓       │  ✗      │  ✗       │  ✓       │
├─────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ Audit Trail     │  R       │  R       │  R      │  R       │  W       │
│ Write           │  ✗       │  ✗       │  ✗      │  ✗       │  ✓       │
├─────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ Auditor Access  │  Grant   │  ✗       │  ✗      │  ✗       │  ✗       │
│ Manage          │  ✓       │  ✗       │  ✗      │  ✗       │  ✗       │
└─────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

### Auditor Access Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      AUDITOR ACCESS LIFECYCLE                           │
│                                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐         │
│  │  Admin   │───►│  Issue   │───►│  Active  │───►│ Expired  │         │
│  │  Grants  │    │  Token   │    │  Access  │    │ (Revoked)│         │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘         │
│                       │               │               │                │
│                       ▼               ▼               ▼                │
│                  ┌──────────────────────────────────────────┐          │
│                  │            AUDIT TRAIL                   │          │
│                  │  - ACCESS_GRANTED (timestamp, auditor)   │          │
│                  │  - ACCESS_USED (each request logged)     │          │
│                  │  - ACCESS_EXPIRED/REVOKED                │          │
│                  └──────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Constraints**:

- Maximum token lifetime: 7 days (configurable)
- No refresh tokens for auditors (must request new access)
- All auditor requests logged to audit trail
- Admin can revoke access immediately

---

## Cryptographic Controls

### Catalog Signing

**Algorithm**: ES256 (ECDSA with P-256 and SHA-256)

**Process**:

1. Compute SHA-256 hash of each file
2. Create manifest.json with all hashes
3. Sign manifest with catalog signing key
4. Store detached signature as manifest.json.sig

**Key Management**:

- Signing keys stored in HSM (AWS CloudHSM or similar)
- Key rotation: Annual, or on suspected compromise
- Multi-party approval required for signing

**Verification**:

```
1. Fetch manifest.json and manifest.json.sig
2. Verify signature against public key
3. For each file in manifest:
   a. Compute SHA-256
   b. Compare to manifest value
4. If all match → catalog verified
```

### Evidence Hashing (Merkle Tree)

**Leaf Hash Construction**:

```
leaf_hash = SHA-256(
    evidence_id ||
    artifact_sha256 ||
    SHA-256(canonical(metadata_json)) ||
    timestamp
)
```

**Tree Construction**:

- Binary Merkle tree
- Leaves sorted by timestamp (deterministic order)
- Odd leaf count: duplicate last leaf
- Internal nodes: `H(left || right)`

**Checkpoint Signing**:

```json
{
  "checkpoint_id": "uuid",
  "timestamp": "ISO-8601",
  "merkle_root": "sha256:...",
  "evidence_count": 1234,
  "previous_checkpoint": "uuid-of-previous",
  "signature": "JWS-ES256"
}
```

### Audit Trail Immutability

**Implementation: PostgreSQL Hash-Chain (per ADR-001)**

```
Each entry:
{
  "sequence": 12345,
  "timestamp": "ISO-8601",
  "event_type": "...",
  "payload": {...},
  "previous_hash": "sha256:...",
  "hash": "sha256:..."  // H(sequence || timestamp || event_type || payload || previous_hash)
}
```

The audit trail uses a SHA-256 hash chain stored in PostgreSQL. Each entry includes the hash of the previous entry, creating a tamper-evident log. Any modification to historical entries breaks the chain and is detectable via the `/api/v1/evidence/:id/verify` endpoint.

---

## Data Protection

### Encryption at Rest

> **NOTE: User-Provisioned Key Management**
> This repository provides the application-layer cryptographic controls (hash chains, Merkle trees, artifact hashing). **Encryption-at-rest key management is user-provisioned** — you bring your own KMS/CMEK solution. The tables below describe the _target architecture_ for production deployments. See [Key Management Options](#key-management-options) for supported providers.

| Data Store | Encryption Method | Key Management | Key Alias (example) |
|------------|-------------------|----------------|-----------|
| S3 / Object Storage (Catalog) | SSE-KMS (AES-256) | Customer-managed CMK | `alias/evidence-locker-catalog` |
| S3 / Object Storage (Evidence) | SSE-KMS (AES-256) | Customer-managed CMK | `alias/evidence-locker-artifacts` |
| PostgreSQL (RDS / self-hosted) | AES-256 TDE | Provider-managed or CMK | `alias/evidence-locker-rds` |
| Audit Trail (PostgreSQL) | AES-256 TDE + application-layer hash chain | Provider-managed or CMK | `alias/evidence-locker-rds` |
| Block Storage (EBS / equivalent) | AES-256 | Provider-managed | `alias/aws/ebs` |
| Log Storage | SSE-KMS | Customer-managed CMK | `alias/evidence-locker-logs` |

#### Key Management Options

This system does **not** ship with a built-in KMS. You must provision your own key management solution. Supported options:

| Provider | Use Case | Notes |
|----------|----------|-------|
| **HashiCorp Vault** | Production (self-hosted / HCP) | Recommended for on-premise or multi-cloud. Transit secrets engine for encryption, PKI for mTLS. |
| **Azure Key Vault (AKV)** | Production (Azure) | FIPS 140-2 Level 2 HSMs. Integrates with Azure SQL TDE and Blob Storage encryption. |
| **AWS KMS** | Production (AWS) | CMK with automatic annual rotation. Integrates with S3 SSE-KMS, RDS TDE, EBS encryption. |
| **Google Cloud KMS** | Production (GCP) | Cloud HSM backed. Integrates with Cloud SQL and Cloud Storage. |
| **Proton / Mezmo** | Secure logging & key management | For log encryption and secure transport of audit trail data. |
| **Demo / Development** | Local development only | No encryption at rest. In-memory fallback with JSON file persistence. **NOT for production.** |

**To configure your KMS provider:**
1. Provision keys using your provider's tooling (Terraform modules provided in `terraform/` for AWS)
2. Set `KMS_KEY_ID` in your `.env` to the key alias or ARN
3. For S3/object storage: configure bucket default encryption to use your CMK
4. For PostgreSQL: enable TDE using your provider's managed encryption
5. For audit logs: the application-layer hash chain provides tamper detection regardless of storage encryption

#### Key Rotation Policy

| Key | Automatic Rotation | Rotation Period | Manual Rotation Trigger |
|-----|-------------------|-----------------|------------------------|
| Catalog signing key | Enabled | 365 days | Key compromise, personnel departure |
| Evidence encryption key | Enabled | 365 days | Key compromise, regulatory requirement change |
| Database encryption key | Provider-managed | 365 days | N/A (provider-managed) |
| Log encryption key | Enabled | 365 days | Key compromise |

**Key rotation process:**
1. Your KMS provider handles automatic rotation of key material
2. Previous key material is retained indefinitely (required for decryption of existing data)
3. All new encryption operations use the latest key material
4. Manual rotation: create new key, re-encrypt active data, retain old key for historical data per SEC Rule 17a-4 (7-year retention)
5. Key deletion: minimum 30-day waiting period, requires CCO + CISO approval

#### Data Classification Levels

| Classification | Description | Encryption Requirement | Access Control | Retention |
|----------------|-------------|----------------------|----------------|-----------|
| **RESTRICTED** | Investor PII, SSNs, accreditation docs, financial statements | KMS-managed CMK, field-level encryption for PII columns | Role: admin only, MFA required | 7 years (SEC 17a-4) |
| **CONFIDENTIAL** | Evidence artifacts, audit logs, compliance status, control assessments | KMS-managed CMK | Role: admin, compliance_officer, auditor (read-only) | 7 years (SEC 17a-4) |
| **INTERNAL** | Regulatory schemas, control catalog, system configuration | Provider-managed encryption OK | Role: all authenticated users | Duration of service |
| **PUBLIC** | Open-source schemas (JSON-LD), published regulatory text | Optional (SSE-S3 / equivalent acceptable) | No restriction | Indefinite |

**Classification enforcement:**
- All stored objects tagged with `data-classification` at upload
- Storage policies deny writes without classification tags
- DLP scanning on evidence upload for PII detection (SSN patterns, financial account numbers)
- Audit logging of all KMS key usage

### Encryption in Transit

- All API traffic: TLS 1.3
- Internal service communication: mTLS
- Database connections: TLS required

### S3 Security

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyUnencryptedUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::evidence-bucket/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms"
        }
      }
    },
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::evidence-bucket", "arn:aws:s3:::evidence-bucket/*"],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

---

## Network Security

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              VPC                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      PUBLIC SUBNET                               │   │
│  │  ┌─────────────┐                                                 │   │
│  │  │    ALB      │ ◄── TLS termination, WAF                        │   │
│  │  └──────┬──────┘                                                 │   │
│  └─────────│────────────────────────────────────────────────────────┘   │
│            │                                                            │
│  ┌─────────│────────────────────────────────────────────────────────┐   │
│  │         │              PRIVATE SUBNET (App)                      │   │
│  │         ▼                                                        │   │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │   │
│  │  │  API        │    │  Worker     │    │  Dashboard  │          │   │
│  │  │  Service    │    │  Service    │    │  Service    │          │   │
│  │  └──────┬──────┘    └──────┬──────┘    └─────────────┘          │   │
│  └─────────│──────────────────│─────────────────────────────────────┘   │
│            │                  │                                         │
│  ┌─────────│──────────────────│─────────────────────────────────────┐   │
│  │         │              PRIVATE SUBNET (Data)                     │   │
│  │         ▼                  ▼                                     │   │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │   │
│  │  │  PostgreSQL │    │  Audit Log │    │  S3 VPC     │          │   │
│  │  │  (RDS)      │    │ (Hash-Chain)│    │  Endpoint   │          │   │
│  │  └─────────────┘    └─────────────┘    └─────────────┘          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Security Groups

| Service     | Inbound            | Outbound               |
| ----------- | ------------------ | ---------------------- |
| ALB         | 443 from 0.0.0.0/0 | App subnet             |
| API Service | ALB SG only        | DB subnet, S3 endpoint |
| PostgreSQL  | App SG only        | None                   |
| S3          | VPC endpoint only  | N/A                    |

---

## Logging & Monitoring

### Log Sources

| Source | Destination | Retention |
|--------|-------------|-----------|
| API Access Logs | CloudWatch + S3 | 90 days / 7 years |
| Application Logs | CloudWatch | 30 days |
| Audit Trail | PostgreSQL (hash-chain) | Indefinite |
| VPC Flow Logs | CloudWatch + S3 | 90 days |
| CloudTrail | S3 | 7 years |

### Security Alerts

| Event                       | Alert Level | Response           |
| --------------------------- | ----------- | ------------------ |
| Failed auth > 5/min         | High        | Block IP, notify   |
| Catalog signing attempted   | Info        | Verify authorized  |
| Auditor access granted      | Info        | Log and track      |
| Evidence deletion attempted | Critical    | Block, investigate |
| Unusual data export         | Medium      | Review access      |

---

## Compliance Considerations

### Data Residency

- All data stored in specified AWS region(s)
- No cross-region replication without explicit approval
- S3 bucket policies enforce region restrictions

### Retention

- Evidence: Minimum 7 years (configurable)
- Audit trail: Indefinite (regulatory requirement)
- Catalog versions: Indefinite (never delete)

### Right to be Forgotten (GDPR/CCPA)

- Investor PII may need deletion capability
- Evidence metadata anonymization process
- Audit trail entries cannot be deleted (regulatory conflict - document exception)

---

## Incident Response

### Evidence Tampering Detection

1. Periodic integrity checks (daily):
   - Recompute all leaf hashes
   - Verify against stored values
   - Verify Merkle roots against checkpoints

2. On detection:
   - Immediate alert to security team
   - Freeze affected evidence records
   - Compare with audit trail
   - Forensic investigation

### Key Compromise Response

1. Catalog signing key:
   - Revoke compromised key
   - Issue new key pair
   - Re-sign all catalog versions
   - Notify all consumers

2. Checkpoint signing key:
   - Revoke compromised key
   - Issue new key
   - Add break marker in audit trail
   - Document incident
