# Security Architecture

This document describes the security model for the compliance management system.

## Security Principles

1. **Defense in Depth**: Multiple layers of security controls
2. **Least Privilege**: Minimal access rights for each role
3. **Immutability**: Audit trails and catalog versions cannot be modified
4. **Cryptographic Verification**: All critical data is signed and verifiable
5. **Verify Every Request**: All requests authenticated and authorized, even from internal systems

> **Note for non-technical readers**: These principles ensure that compliance records can't be altered, only authorized people can access data, and every action is logged. See [IT-SECURITY-TECHNICAL-BUILD-GUIDE.md](../IT-SECURITY-TECHNICAL-BUILD-GUIDE.md) for detailed explanations.

---

## Authentication & Authorization

### Identity Providers

| User Type | Auth Method | Identity Provider |
|-----------|-------------|-------------------|
| Internal Users | SSO/SAML | Corporate IdP (Okta, Azure AD) |
| Auditors | Time-limited JWT | Issued by system admin |
| Service Accounts | API Keys + mTLS | Internal PKI |

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

Hash chain implementation with append-only PostgreSQL and S3 Object Lock (see ADR-001):

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

---

## Data Protection

### Encryption at Rest

| Data Store | Encryption | Key Management |
|------------|------------|----------------|
| S3 (Catalog) | SSE-S3 or SSE-KMS | AWS managed or CMK |
| S3 (Evidence) | SSE-KMS | CMK with key policy |
| PostgreSQL | TDE (RDS) | AWS managed |
| Audit Trail | S3 Object Lock + DB TDE | AWS managed |

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
      "Resource": [
        "arn:aws:s3:::evidence-bucket",
        "arn:aws:s3:::evidence-bucket/*"
      ],
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
│  │  │  PostgreSQL │    │   S3 VPC    │    │  KMS VPC    │          │   │
│  │  │  (RDS)      │    │   Endpoint  │    │  Endpoint   │          │   │
│  │  └─────────────┘    └─────────────┘    └─────────────┘          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Security Groups

| Service | Inbound | Outbound |
|---------|---------|----------|
| ALB | 443 from 0.0.0.0/0 | App subnet |
| API Service | ALB SG only | DB subnet, S3 endpoint |
| PostgreSQL | App SG only | None |
| S3 | VPC endpoint only | N/A |

---

## Logging & Monitoring

### Log Sources

| Source | Destination | Retention |
|--------|-------------|-----------|
| API Access Logs | CloudWatch + S3 | 90 days / 7 years |
| Application Logs | CloudWatch | 30 days |
| Audit Trail | PostgreSQL + S3 Object Lock | Indefinite |
| VPC Flow Logs | CloudWatch + S3 | 90 days |
| CloudTrail | S3 | 7 years |

### Security Alerts

| Event | Alert Level | Response |
|-------|-------------|----------|
| Failed auth > 5/min | High | Block IP, notify |
| Catalog signing attempted | Info | Verify authorized |
| Auditor access granted | Info | Log and track |
| Evidence deletion attempted | Critical | Block, investigate |
| Unusual data export | Medium | Review access |

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
   - Immediate alert to compliance and IT operations team
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
