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

We adopt a **technology-agnostic, pluggable audit trail architecture** with the following approved implementation options.

---

## Explicitly Rejected: Blockchain / Distributed Ledger

**This architecture explicitly rejects blockchain and distributed ledger technology (DLT) for audit trail implementation.**

### Why Blockchain is Not Recommended

Blockchain and distributed ledger technologies are frequently proposed for audit trails based on a superficial understanding of "immutability." However, for a single-tenant compliance system handling sensitive financial data, **distributed ledger architectures multiplicatively increase the attack surface** without providing proportional security benefits.

#### Attack Surface Multiplication

| Attack Vector | Centralized Audit Trail | Distributed Ledger |
|---------------|------------------------|-------------------|
| **Network endpoints** | 1 (database) | N nodes × M peers |
| **Authentication points** | 1 | N nodes + consensus protocol |
| **Key management** | 1 signing key | N node keys + validator keys |
| **Consensus vulnerabilities** | N/A | BFT attacks, 51% attacks, selfish mining |
| **Smart contract bugs** | N/A | Reentrancy, overflow, logic errors |
| **P2P protocol attacks** | N/A | Eclipse attacks, Sybil attacks, routing attacks |
| **State synchronization** | N/A | Fork resolution, chain reorganization |
| **Dependency chain** | Database + OS | Blockchain client + P2P stack + consensus + crypto libraries + VM |

**Each additional node and protocol layer creates new opportunities for exploitation.**

#### Specific Concerns

1. **Consensus Protocol Vulnerabilities**
   - Byzantine fault tolerance requires 3f+1 nodes to tolerate f failures
   - Consensus bugs have caused major incidents (e.g., Ethereum DAO hack, Bitcoin value overflow)
   - Permissioned blockchains still require complex leader election and view change protocols

2. **Key Management Complexity**
   - Each node requires secure key storage
   - Validator key compromise affects entire network
   - Key rotation across distributed nodes is operationally complex

3. **Smart Contract Risk**
   - If using programmable ledgers, smart contract vulnerabilities become audit trail vulnerabilities
   - Formal verification of smart contracts remains immature
   - Upgrade mechanisms introduce additional attack vectors

4. **Network Partition Handling**
   - Distributed systems must handle network splits
   - CAP theorem tradeoffs affect consistency guarantees
   - Split-brain scenarios can create conflicting audit histories

5. **Operational Complexity**
   - Node patching requires coordination
   - Version upgrades must be synchronized
   - Monitoring and alerting across distributed nodes
   - Incident response is more complex

6. **False Sense of Security**
   - "Immutability" in blockchain means expensive to change, not impossible
   - 51% attacks, governance attacks, and protocol-level changes can alter history
   - Single-tenant systems don't benefit from distributed trust—you already trust yourself

#### When Blockchain Might Be Appropriate (Not This System)

Blockchain/DLT may be justified when:
- Multiple **mutually distrusting parties** must share a ledger
- No single party can be trusted to maintain the authoritative record
- Regulatory mandate **specifically requires** distributed ledger (rare)
- The use case is **inherently multi-party** (e.g., interbank settlement)

**None of these conditions apply to a single-tenant compliance evidence system.** The organization maintaining the system is the single source of truth. A properly implemented centralized audit trail with cryptographic verification provides equivalent integrity guarantees with a fraction of the attack surface.

#### Recommended Alternative

For cryptographic integrity without blockchain complexity:

```
┌─────────────────────────────────────────────────────────────────┐
│            CENTRALIZED CRYPTOGRAPHIC AUDIT TRAIL                │
│                                                                 │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐       │
│   │ Event 1 │──▶│ Event 2 │──▶│ Event 3 │──▶│ Event 4 │       │
│   │ H(prev) │   │ H(prev) │   │ H(prev) │   │ H(prev) │       │
│   └─────────┘   └─────────┘   └─────────┘   └─────────┘       │
│        │                                          │            │
│        └──────────── Hash Chain ──────────────────┘            │
│                           │                                    │
│                           ▼                                    │
│                  ┌─────────────────┐                          │
│                  │  Signed Daily   │  ◀── HSM-backed key      │
│                  │   Checkpoint    │                          │
│                  └─────────────────┘                          │
│                           │                                    │
│                           ▼                                    │
│                  ┌─────────────────┐                          │
│                  │ Published Root  │  ◀── Optional: publish   │
│                  │  (newspaper,    │      to external witness │
│                  │   public log)   │                          │
│                  └─────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘

Attack surface: 1 database + 1 HSM + 1 application
Immutability: Cryptographic (hash chain + signatures)
Verifiability: Full (any auditor can verify chain)
Complexity: Low
```

This approach provides:
- **Equivalent cryptographic integrity** to blockchain
- **Smaller attack surface** (single database, single signing key)
- **Simpler operations** (standard database administration)
- **Better performance** (no consensus overhead)
- **Lower cost** (no node infrastructure)
- **Optional external witnessing** (publish checkpoints to public transparency logs if desired)

---

## Approved Implementation Options

### Option A: Aurora PostgreSQL + S3 Object Lock (RECOMMENDED)

**Description**: Aurora PostgreSQL with pgaudit extension for operational data, combined with S3 Object Lock (COMPLIANCE mode) for evidence artifacts and audit exports.

**Note on QLDB**: AWS deprecated Amazon QLDB for new workloads in 2024. Existing workloads may continue, but new implementations should use this architecture instead.

**Characteristics**:
| Attribute | Value |
|-----------|-------|
| Operational Data | Aurora PostgreSQL with pgaudit |
| Evidence Storage | S3 Object Lock (COMPLIANCE mode) |
| Cryptographic Verification | Application-layer hash chains + signed checkpoints |
| SLA | 99.99% (Aurora), 99.999999999% durability (S3) |
| Retention | Configurable, supports 7+ year regulatory requirements |
| Compliance | SOC 1/2/3, PCI DSS, HIPAA, FedRAMP High, SEC 17a-4 |

**Architecture**:
```
┌─────────────────────────────────────────────────────────────────┐
│            AURORA PostgreSQL + S3 OBJECT LOCK                   │
│                                                                 │
│  ┌─────────────────────────┐    ┌─────────────────────────────┐ │
│  │ Aurora PostgreSQL       │    │ S3 Object Lock              │ │
│  │ (Operational Data)      │    │ (COMPLIANCE Mode)           │ │
│  │                         │    │                             │ │
│  │ • Metadata & indexes    │    │ • Evidence artifacts        │ │
│  │ • Control status        │───▶│ • Audit log exports         │ │
│  │ • User sessions         │    │ • Signed manifests          │ │
│  │ • pgaudit extension     │    │ • TRUE WORM (SEC 17a-4)     │ │
│  │ • Hash chain records    │    │ • 7-year retention lock     │ │
│  └─────────────────────────┘    └─────────────────────────────┘ │
│                                                                 │
│  Hash chains computed at application layer, exported to S3      │
│  for immutable storage. PostgreSQL remains queryable.           │
└─────────────────────────────────────────────────────────────────┘
```

**Pros**:
- Mature, well-understood technology
- Full SQL query capabilities
- FedRAMP authorized (Aurora)
- TRUE WORM with S3 Object Lock COMPLIANCE mode
- Lower cost than specialized ledger databases
- Cloud-portable concepts (PostgreSQL + object storage)

**Cons**:
- Must implement hash chain verification at application layer
- Two-tier architecture (database + object storage)
- Requires understanding of S3 Object Lock modes

**When to Choose**:
- Most deployments (this is the recommended default)
- Need for complex audit queries
- Cost-sensitive environments
- Teams familiar with PostgreSQL operations

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

### Option C: Immutable Object Storage with Verification Layer

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

**Implementation Caveats for Merkle Trees**:

The pseudocode examples in this repository (e.g., in `evidence-locker.md`) are **illustrative, not production-ready**. A production Merkle tree implementation must handle:

| Edge Case | Required Handling |
|-----------|-------------------|
| Odd number of leaves | Duplicate last leaf OR use different tree structure |
| Empty tree | Define null root hash consistently |
| Concurrent inserts | Ensure deterministic ordering (by timestamp, sequence, or mutex) |
| Very large trees | Consider incremental/streaming construction |
| Proof generation | Store intermediate nodes OR recompute on demand |
| Tree rebalancing | Append-only trees don't rebalance; plan for depth |

**Do not use example code in production without**:
- Formal specification of leaf hash construction
- Test vectors covering edge cases
- Security review by qualified cryptographic engineer
- Consideration of timing attacks on comparison operations

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
- TLS 1.2 minimum (TLS 1.0/1.1 prohibited)
- TLS 1.3 preferred where supported
- Strong cipher suites only (no CBC mode, no SHA-1, no RC4)
- Certificate validation enforced
- HSTS enabled for any web interfaces
```

**Practical note**: While TLS 1.3 is preferred, some legacy systems and integrations may require TLS 1.2. The key requirements are:
1. **All data encrypted in transit** — no plaintext connections
2. **No deprecated protocols** — TLS 1.0 and 1.1 are prohibited by PCI DSS and most modern standards
3. **Strong cipher suites** — avoid known-weak algorithms

If your environment can enforce TLS 1.3-only, do so. If you must support TLS 1.2 for legacy integrations, document the business justification and ensure cipher suite configuration excludes weak options.

### 4. Service Level Requirements

**Note**: "Level 3 SLA" is not an industry-standard term. The following are concrete requirements you should specify in vendor contracts or internal SLAs:

```
Availability:
- Target: 99.95% monthly uptime (approximately 22 minutes downtime/month)
- Measurement: 5-minute polling intervals
- Exclusions: Scheduled maintenance with 72-hour notice

Recovery Objectives:
- RTO (Recovery Time Objective): 4 hours maximum
- RPO (Recovery Point Objective): 1 hour maximum
- These should be tested quarterly via DR exercises

Incident Response:
- Critical (data loss/breach): 15-minute response
- High (service degradation): 1-hour response
- Notification: Defined escalation contacts

Backups:
- Frequency: Hourly incremental, daily full
- Retention: 90 days minimum, 7 years for compliance data
- Testing: Monthly restoration tests
```

**Industry context**: Cloud providers typically offer SLAs in the 99.9%-99.99% range. "Three nines" (99.9%) allows ~8.7 hours downtime/month. "Four nines" (99.99%) allows ~4.3 minutes/month. Choose based on your actual business requirements and budget.

---

## Decision Matrix

| Requirement | Aurora + S3 (Recommended) | Hardened Instance | Object Storage Only |
|-------------|---------------------------|-------------------|---------------------|
| Immutability | ★★★★☆ | ★★★☆☆ | ★★★★☆ (see warning) |
| Operational Simplicity | ★★★★☆ | ★★☆☆☆ | ★★★☆☆ |
| Cost (at scale) | ★★★★☆ | ★★★★☆ | ★★★★★ |
| Query Performance | ★★★★★ | ★★★★★ | ★★★☆☆ |
| Cloud Portability | ★★★☆☆ | ★★★★★ | ★★★☆☆ |
| Compliance Coverage | ★★★★★ | ★★★☆☆ | ★★★★☆ |
| 99.95% SLA Achievable | ✓ | ✓ | ✓ |
| QLDB Replacement | ✓ (recommended) | ✓ | ✓ |

### Critical Warning: Object Lock Modes

If using object storage with retention locks, understand the difference between lock modes:

| Mode | Can Root/Admin Override? | Regulatory Suitability |
|------|--------------------------|------------------------|
| **GOVERNANCE** | **YES** — users with special permissions can delete | **NOT suitable for SEC 17a-4 or true WORM requirements** |
| **COMPLIANCE** | **NO** — cannot be deleted by anyone, including root, until retention expires | Suitable for regulatory WORM requirements |

**If you configure GOVERNANCE mode thinking you have immutability, you do not.** GOVERNANCE mode is designed for testing or soft retention policies. For audit trails subject to SEC 17a-4, FINRA 4511, or similar regulations, you MUST use COMPLIANCE mode.

### QLDB Deprecation Notice

**Amazon QLDB was deprecated for new workloads in 2024.**

AWS announced that QLDB would not accept new customers and recommended existing customers migrate to alternatives. This is why Option A now recommends Aurora PostgreSQL + S3 Object Lock instead of QLDB.

For organizations with existing QLDB deployments:
- Existing workloads continue to function during the deprecation period
- Plan migration to Aurora PostgreSQL + S3 Object Lock architecture
- Export all data and verify integrity before migration
- AWS may provide specific migration guidance and timelines

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

The following standards inform this ADR. Verify current versions before reliance:

| Standard | Description | Where to Find |
|----------|-------------|---------------|
| NIST SP 800-92 | Guide to Computer Security Log Management | Search NIST CSRC publications |
| NIST CSF 2.0 | Cybersecurity Framework | nist.gov/cyberframework |
| SEC Rule 17a-4 | Records to be preserved by brokers and dealers | Search SEC.gov rules |
| FINRA Rule 4511 | General requirements for books and records | FINRA.org rulebook |
| FedRAMP AU controls | Audit and Accountability control family | FedRAMP.gov baselines |

**Note**: URLs are not provided because government and regulatory websites frequently reorganize. Search the authoritative source directly for current versions.
