# ADR-001: Audit Trail Technology Selection

**Status**: Accepted
**Date**: 2026-01-19
**Deciders**: Architecture Team
**Consulted**: Security, Compliance, Operations

## Context

The compliance management system requires an immutable, cryptographically verifiable audit trail for:
- Evidence submission and modification events
- Catalog version publications
- Access grants and revocations
- Compliance status changes
- System configuration changes

This audit trail must:
1. Be append-only (no updates or deletes)
2. Provide cryptographic verification of integrity
3. Support regulatory retention requirements (7+ years)
4. Meet Level 3 SLA requirements (99.95% availability)
5. Comply with multiple regulatory frameworks (see ADR-003)

## Decision

We adopt a **technology-agnostic, pluggable audit trail architecture** with the following approved implementation options:

### Option A: Amazon QLDB (Managed Ledger)

**Description**: Fully managed ledger database with built-in immutability and cryptographic verification.

**Characteristics**:
| Attribute | Value |
|-----------|-------|
| Immutability | Native, hardware-enforced |
| Cryptographic Verification | SHA-256 hash chaining, journal digest |
| SLA | 99.999% (exceeds L3) |
| Retention | Unlimited |
| Compliance | SOC 1/2/3, PCI DSS, HIPAA, FedRAMP High |

**Pros**:
- Zero operational overhead for immutability
- Built-in verification API
- Automatic journal management
- ACID transactions

**Cons**:
- AWS vendor lock-in
- Higher cost at scale
- Limited query capabilities vs. traditional DB
- Region availability constraints

**When to Choose**:
- AWS-native deployments
- Teams without dedicated database operations
- Strict auditability requirements with minimal custom code

---

### Option B: Hardened Cloud Instance with Append-Only PostgreSQL

**Description**: Self-managed PostgreSQL on a security-hardened cloud compute instance with application-enforced immutability.

**Characteristics**:
| Attribute | Value |
|-----------|-------|
| Immutability | Application-enforced (triggers, permissions) |
| Cryptographic Verification | Custom hash chain implementation |
| SLA | Provider-dependent (select 99.95%+ tier) |
| Retention | Storage-dependent |
| Compliance | Depends on provider certifications |

**Architecture**:
```
┌─────────────────────────────────────────────────────────────────┐
│                 HARDENED COMPUTE INSTANCE                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Security Controls                      │  │
│  │  • Immutable infrastructure (no SSH post-deploy)          │  │
│  │  • Encrypted root volume (AES-256)                        │  │
│  │  • Private subnet only (no public IP)                     │  │
│  │  • Security group: DB port from app tier only             │  │
│  │  • Host-based IDS/IPS                                     │  │
│  │  • CIS benchmark hardened OS                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      PostgreSQL                           │  │
│  │  • TLS 1.3 only for connections                           │  │
│  │  • Certificate-based authentication                       │  │
│  │  • Audit table with:                                      │  │
│  │    - REVOKE UPDATE, DELETE on audit_log                   │  │
│  │    - Trigger-enforced hash chain                          │  │
│  │    - Row-level security policies                          │  │
│  │  • WAL archiving to immutable storage                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Required Hardening**:
```sql
-- Prevent all modifications except INSERT
REVOKE ALL ON audit_log FROM PUBLIC;
REVOKE ALL ON audit_log FROM app_user;
GRANT INSERT, SELECT ON audit_log TO app_user;

-- Prevent even superuser deletes via event trigger
CREATE OR REPLACE FUNCTION prevent_audit_truncate()
RETURNS event_trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_event_trigger_dropped_objects()
    WHERE object_name = 'audit_log'
  ) THEN
    RAISE EXCEPTION 'Cannot drop or truncate audit_log';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE EVENT TRIGGER protect_audit_log ON sql_drop
  EXECUTE FUNCTION prevent_audit_truncate();
```

**Pros**:
- Cloud-agnostic (portable)
- Lower cost at scale
- Full SQL query capabilities
- Complete control over implementation

**Cons**:
- Operational overhead
- Must implement verification logic
- Requires security expertise to harden properly
- Immutability is application-enforced, not hardware-enforced

**When to Choose**:
- Multi-cloud or cloud-agnostic requirements
- Cost-sensitive deployments
- Teams with strong database operations capability
- Need for complex audit queries

---

### Option C: Dedicated Ledger Appliance / Blockchain-Based

**Description**: Purpose-built ledger hardware or permissioned blockchain network.

**Examples** (without endorsement):
- Hyperledger Fabric (permissioned blockchain)
- Hardware Security Module (HSM) backed ledger
- Dedicated compliance appliance vendors

**Characteristics**:
| Attribute | Value |
|-----------|-------|
| Immutability | Hardware or consensus-enforced |
| Cryptographic Verification | Native to platform |
| SLA | Vendor-dependent |
| Retention | Platform-dependent |
| Compliance | Varies significantly |

**Pros**:
- Strongest immutability guarantees
- May satisfy specific regulatory requirements
- Distributed trust (blockchain options)

**Cons**:
- Highest complexity
- Significant operational overhead
- Performance limitations
- Overkill for most use cases

**When to Choose**:
- Regulatory mandate for blockchain/distributed ledger
- Multi-party trust requirements
- Highest security classification data

---

### Option D: Immutable Object Storage with Verification Layer

**Description**: Append-only audit records stored in object storage with retention locks, plus a verification index.

**Architecture**:
```
┌─────────────────────────────────────────────────────────────────┐
│              IMMUTABLE OBJECT STORAGE                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Bucket: audit-trail-{environment}                        │  │
│  │  • Object Lock: GOVERNANCE or COMPLIANCE mode             │  │
│  │  • Retention: 7 years minimum                             │  │
│  │  • Versioning: Enabled                                    │  │
│  │  • Lifecycle: No deletion rules                           │  │
│  │                                                           │  │
│  │  Objects:                                                 │  │
│  │    /2026/01/19/12/00/event-{uuid}.json                    │  │
│  │    /2026/01/19/12/00/event-{uuid}.json.sig                │  │
│  │    /checkpoints/2026-01-19T12:00:00Z.json                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Verification Index (PostgreSQL/DynamoDB)                 │  │
│  │  • Hash chain index for fast verification                 │  │
│  │  • Queryable metadata                                     │  │
│  │  • Points to immutable objects                            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Pros**:
- Very low cost for long retention
- Object Lock provides regulatory-grade immutability
- Scales infinitely
- Simple disaster recovery

**Cons**:
- Two-tier architecture complexity
- Query performance depends on index
- Object Lock modes have different guarantees

**When to Choose**:
- Very long retention requirements
- Cost-sensitive with high volume
- Already using object storage extensively

---

## Implementation Requirements (All Options)

Regardless of technology choice, implementations MUST:

### 1. Hash Chain Integrity
```
Each record MUST include:
- sequence_number: Monotonically increasing
- timestamp: ISO 8601 with microsecond precision
- previous_hash: SHA-256 of previous record
- hash: SHA-256(sequence || timestamp || event_type || payload || previous_hash)
```

### 2. Cryptographic Signing
```
Checkpoint records MUST be signed:
- Algorithm: ECDSA P-256 (ES256) minimum
- Key storage: HSM or managed KMS
- Rotation: Annual or on compromise
```

### 3. TLS Requirements
```
All connections MUST use:
- TLS 1.3 minimum (TLS 1.2 deprecated)
- Strong cipher suites only:
  - TLS_AES_256_GCM_SHA384
  - TLS_CHACHA20_POLY1305_SHA256
  - TLS_AES_128_GCM_SHA256
- Certificate validation enforced
- HSTS enabled for any web interfaces
```

### 4. Service Level Agreement (Level 3)
```
Minimum requirements:
- Availability: 99.95% monthly uptime
- RTO (Recovery Time Objective): 4 hours
- RPO (Recovery Point Objective): 1 hour
- Incident response: 15 minutes (critical)
- Scheduled maintenance windows: Required notification
```

---

## Decision Matrix

| Requirement | QLDB | Hardened Instance | Ledger/Blockchain | Object Storage |
|-------------|------|-------------------|-------------------|----------------|
| Immutability | ★★★★★ | ★★★☆☆ | ★★★★★ | ★★★★☆ |
| Operational Simplicity | ★★★★★ | ★★☆☆☆ | ★☆☆☆☆ | ★★★☆☆ |
| Cost (at scale) | ★★☆☆☆ | ★★★★☆ | ★★☆☆☆ | ★★★★★ |
| Query Performance | ★★★☆☆ | ★★★★★ | ★★☆☆☆ | ★★★☆☆ |
| Cloud Portability | ★☆☆☆☆ | ★★★★★ | ★★★★☆ | ★★★☆☆ |
| Compliance Coverage | ★★★★★ | ★★★☆☆ | ★★★★☆ | ★★★★☆ |
| L3 SLA Achievable | ✓ | ✓ | Varies | ✓ |

---

## Consequences

### Positive
- Flexibility to choose based on organizational constraints
- Clear requirements regardless of implementation
- Compliance mappings documented per option

### Negative
- Multiple code paths for different backends
- Testing must cover all supported options
- Documentation overhead

### Risks
- Hardened instance option requires security expertise
- Misconfiguration could compromise immutability
- Migration between options is complex

---

## Compliance Mapping

| Framework | Relevant Controls | How This ADR Addresses |
|-----------|-------------------|------------------------|
| NIST CSF 2.0 | PR.DS-1, PR.DS-2, DE.CM-3 | Cryptographic integrity, audit logging |
| SOC 2 | CC6.1, CC7.2 | Logical access, system monitoring |
| FedRAMP | AU-2, AU-3, AU-9 | Audit events, content, protection |
| PCI DSS 4.0 | 10.2, 10.3, 10.5 | Audit trails, protection, retention |
| HIPAA | §164.312(b) | Audit controls |
| SEC Rule 17a-4 | (f)(2)(ii)(A) | WORM storage requirements |
| FINRA Rule 4511 | Books and records | Retention, integrity |

---

## References

- [NIST SP 800-92: Guide to Computer Security Log Management](https://csrc.nist.gov/publications/detail/sp/800-92/final)
- [NIST CSF 2.0](https://www.nist.gov/cyberframework)
- [SEC Rule 17a-4 Electronic Storage](https://www.sec.gov/rules/interp/34-47806.htm)
- [FedRAMP Audit and Accountability Controls](https://www.fedramp.gov/)
