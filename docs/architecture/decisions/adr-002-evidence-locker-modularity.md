# ADR-002: Evidence Locker Modularity

**Status**: Accepted
**Date**: 2026-01-19
**Deciders**: Architecture Team
**Consulted**: Security, Compliance, Operations, Legal

## Context

The evidence locker is a critical component storing compliance evidence linked to regulatory controls. Different organizations have varying requirements for:

- Cloud provider preferences (AWS, Azure, GCP, private cloud)
- Data residency and sovereignty
- Existing infrastructure investments
- Security certification requirements
- Cost constraints
- Operational capabilities

A monolithic, provider-specific implementation would limit adoption and create vendor lock-in. We need a modular architecture that allows component substitution while maintaining security, compliance, and SLA guarantees.

## Decision

We adopt a **modular evidence locker architecture** with clearly defined interfaces, allowing organizations to substitute components based on their requirements while maintaining compliance guarantees.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EVIDENCE LOCKER - MODULAR ARCHITECTURE               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         API GATEWAY LAYER                            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │   │
│  │  │   AuthN     │  │   AuthZ     │  │  Rate       │                  │   │
│  │  │   Module    │  │   Module    │  │  Limiting   │                  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                  │   │
│  │                         │                                            │   │
│  │                    TLS 1.3+ Only                                     │   │
│  └─────────────────────────│────────────────────────────────────────────┘   │
│                            │                                                │
│  ┌─────────────────────────│────────────────────────────────────────────┐   │
│  │                    CORE SERVICE LAYER                                │   │
│  │                         │                                            │   │
│  │  ┌──────────────────────┴──────────────────────────┐                │   │
│  │  │              Evidence Service                    │                │   │
│  │  │  • Business logic                                │                │   │
│  │  │  • Validation                                    │                │   │
│  │  │  • Workflow orchestration                        │                │   │
│  │  └──────────────────────┬──────────────────────────┘                │   │
│  │                         │                                            │   │
│  │         ┌───────────────┼───────────────┐                           │   │
│  │         │               │               │                           │   │
│  │         ▼               ▼               ▼                           │   │
│  │  ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐     │   │
│  │  │ Metadata  │   │ Artifact  │   │  Crypto   │   │  Audit    │     │   │
│  │  │ Store     │   │ Store     │   │ Service   │   │  Trail    │     │   │
│  │  │ Interface │   │ Interface │   │ Interface │   │ Interface │     │   │
│  │  └─────┬─────┘   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘     │   │
│  └────────│───────────────│───────────────│───────────────│──────────────┘   │
│           │               │               │               │                │
│  ┌────────│───────────────│───────────────│───────────────│──────────────┐   │
│  │        │          PLUGGABLE ADAPTERS   │               │              │   │
│  │        │               │               │               │              │   │
│  │   ┌────┴────┐     ┌────┴────┐     ┌────┴────┐     ┌────┴────┐        │   │
│  │   │PostgreSQL│    │   S3    │     │AWS KMS  │     │Postgres │        │   │
│  │   │ MySQL   │     │  GCS    │     │Azure KV │     │ Hash    │        │   │
│  │   │ Aurora  │     │  Azure  │     │HashiCorp│     │ Chain   │        │   │
│  │   │ CockroachDB│  │  MinIO  │     │  Vault  │     │  (ADR-1)│        │   │
│  │   └─────────┘     └─────────┘     └─────────┘     └─────────┘        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Module Interfaces

#### 1. Metadata Store Interface

```typescript
interface MetadataStore {
  // Evidence CRUD (Create and Read only - no Update/Delete)
  createEvidence(evidence: EvidenceRecord): Promise<EvidenceId>;
  getEvidence(id: EvidenceId): Promise<EvidenceRecord>;
  queryEvidence(filter: EvidenceFilter): Promise<EvidenceRecord[]>;

  // Soft delete only (marks as deleted, doesn't remove)
  markDeleted(id: EvidenceId, reason: string, actor: string): Promise<void>;

  // Merkle tree operations
  getLeafHash(id: EvidenceId): Promise<Hash>;
  getEvidenceSinceCheckpoint(checkpointId: CheckpointId): Promise<EvidenceRecord[]>;

  // Health and metrics
  healthCheck(): Promise<HealthStatus>;
  getMetrics(): Promise<StoreMetrics>;
}
```

**Approved Implementations**:
| Implementation | Use Case | Compliance Notes |
|----------------|----------|------------------|
| PostgreSQL | General purpose, self-managed | Requires hardening per ADR-001 |
| Amazon Aurora | AWS-native, managed | SOC 2, FedRAMP, HIPAA eligible |
| Azure SQL | Azure-native, managed | SOC 2, FedRAMP, HIPAA eligible |
| Google Cloud SQL | GCP-native, managed | SOC 2, FedRAMP, HIPAA eligible |
| CockroachDB | Multi-region, distributed | SOC 2, verify other certs |

#### 2. Artifact Store Interface

```typescript
interface ArtifactStore {
  // Upload with client-side hash verification
  upload(
    artifactId: ArtifactId,
    stream: ReadableStream,
    metadata: ArtifactMetadata,
    expectedHash: Hash
  ): Promise<ArtifactReference>;

  // Download with integrity verification
  download(artifactId: ArtifactId): Promise<{
    stream: ReadableStream;
    metadata: ArtifactMetadata;
    hash: Hash;
  }>;

  // Generate time-limited signed URL
  getSignedUrl(artifactId: ArtifactId, expiresIn: Duration): Promise<SignedUrl>;

  // Verify artifact integrity
  verifyIntegrity(artifactId: ArtifactId, expectedHash: Hash): Promise<boolean>;

  // Health and metrics
  healthCheck(): Promise<HealthStatus>;
  getMetrics(): Promise<StoreMetrics>;
}
```

**Approved Implementations**:
| Implementation | Use Case | Compliance Notes |
|----------------|----------|------------------|
| Amazon S3 | AWS-native | SOC 2, FedRAMP High, SEC 17a-4 |
| Azure Blob Storage | Azure-native | SOC 2, FedRAMP High |
| Google Cloud Storage | GCP-native | SOC 2, FedRAMP |
| MinIO | Self-hosted, air-gapped | Depends on deployment |
| Backblaze B2 | Cost-optimized | SOC 2, verify other certs |

**Required Capabilities**:

- Server-side encryption (AES-256 minimum)
- Object versioning
- Object lock / retention policies
- Access logging
- Cross-region replication (for DR)

#### 3. Cryptographic Service Interface

```typescript
interface CryptoService {
  // Hashing
  hash(data: Buffer, algorithm: 'SHA-256' | 'SHA-384' | 'SHA-512'): Promise<Hash>;

  // Signing
  sign(data: Buffer, keyId: KeyId): Promise<Signature>;
  verify(data: Buffer, signature: Signature, keyId: KeyId): Promise<boolean>;

  // Encryption (for sensitive metadata)
  encrypt(plaintext: Buffer, keyId: KeyId): Promise<EncryptedData>;
  decrypt(ciphertext: EncryptedData, keyId: KeyId): Promise<Buffer>;

  // Key management
  createKey(spec: KeySpec): Promise<KeyId>;
  rotateKey(keyId: KeyId): Promise<KeyId>;
  getPublicKey(keyId: KeyId): Promise<PublicKey>;

  // Health
  healthCheck(): Promise<HealthStatus>;
}
```

**Approved Implementations**:
| Implementation | Use Case | Compliance Notes |
|----------------|----------|------------------|
| AWS KMS | AWS-native | FIPS 140-2 L3, FedRAMP High |
| Azure Key Vault | Azure-native | FIPS 140-2 L2/L3, FedRAMP High |
| Google Cloud KMS | GCP-native | FIPS 140-2 L3, FedRAMP |
| HashiCorp Vault | Multi-cloud, self-hosted | Depends on deployment |
| Hardware HSM | Highest security | FIPS 140-2 L3/L4 |

#### 4. Audit Trail Interface

See ADR-001 for detailed options. Interface:

```typescript
interface AuditTrail {
  // Append event (never update or delete)
  append(event: AuditEvent): Promise<AuditEventId>;

  // Query events
  query(filter: AuditFilter): Promise<AuditEvent[]>;
  getEventById(id: AuditEventId): Promise<AuditEvent>;

  // Verification
  verifyChain(fromSequence: number, toSequence: number): Promise<VerificationResult>;
  getLatestCheckpoint(): Promise<Checkpoint>;

  // Merkle operations
  createCheckpoint(): Promise<Checkpoint>;
  generateProof(eventId: AuditEventId): Promise<MerkleProof>;
  verifyProof(proof: MerkleProof, root: Hash): Promise<boolean>;

  // Health
  healthCheck(): Promise<HealthStatus>;
}
```

---

### Service Level Requirements

**Note on terminology**: "Level 3 SLA" is not an industry-standard term. The following are concrete service level targets. Adjust based on your business requirements and budget.

All module implementations SHOULD meet these baseline requirements (negotiate specifics in vendor contracts):

```yaml
service_levels:
  # Note: "Three nines" (99.9%) = ~8.7h downtime/month
  # "Four nines" (99.99%) = ~4.3min downtime/month
  # Choose based on actual business needs

  availability:
    target_uptime: '99.95%' # Approximately 22 minutes downtime/month
    max_monthly_downtime: '21.9 minutes'
    measurement: '5-minute intervals'
    exclusions:
      - 'Scheduled maintenance with 72h notice'
      - 'Force majeure events'

  performance:
    api_response_p50: '100ms'
    api_response_p95: '500ms'
    api_response_p99: '1000ms'
    throughput: '1000 requests/second minimum'

  recovery:
    rto: '4 hours' # Recovery Time Objective
    rpo: '1 hour' # Recovery Point Objective
    backup_frequency: 'Hourly incremental, daily full'
    backup_retention: '90 days minimum'
    geo_redundancy: 'Required (separate availability zone minimum)'

  incident_response:
    critical_response: '15 minutes'
    high_response: '1 hour'
    medium_response: '4 hours'
    low_response: '24 hours'

  support:
    availability: '24/7/365'
    channels: ['phone', 'email', 'portal']
    escalation_path: 'Defined and documented'

  reporting:
    frequency: 'Monthly'
    contents:
      - 'Uptime percentage'
      - 'Incident summary'
      - 'Performance metrics'
      - 'Security events'
```

---

### TLS Requirements

All communications MUST enforce:

```yaml
tls:
  minimum_version: '1.3'
  deprecated_versions: ['1.0', '1.1', '1.2']

  cipher_suites:
    allowed:
      - 'TLS_AES_256_GCM_SHA384'
      - 'TLS_CHACHA20_POLY1305_SHA256'
      - 'TLS_AES_128_GCM_SHA256'
    prohibited:
      - 'Any CBC mode cipher'
      - 'Any cipher with SHA-1'
      - 'Any export cipher'
      - 'Any NULL cipher'
      - 'Any RC4 cipher'

  certificate_requirements:
    key_size_minimum: '2048 (RSA), 256 (ECDSA)'
    signature_algorithm: 'SHA-256 minimum'
    validity_period: '1 year maximum'
    revocation_checking: 'OCSP stapling required'
    certificate_transparency: 'Required for public certificates'

  hsts:
    enabled: true
    max_age: 31536000 # 1 year
    include_subdomains: true
    preload: true

  mutual_tls:
    internal_services: 'Required'
    external_apis: 'Optional (client preference)'
```

---

### Deployment Configurations

#### Configuration A: AWS-Native

```yaml
deployment:
  name: "AWS Full Stack"
  metadata_store: "Amazon Aurora PostgreSQL"
  artifact_store: "Amazon S3"
  crypto_service: "AWS KMS"
  audit_trail: "Aurora PostgreSQL hash-chain (per ADR-001)"

  compliance_certifications:
    - 'SOC 2 Type II'
    - 'FedRAMP High'
    - 'HIPAA'
    - 'PCI DSS'
    - 'SEC 17a-4'
```

#### Configuration B: Azure-Native

```yaml
deployment:
  name: 'Azure Full Stack'
  metadata_store: 'Azure SQL Database'
  artifact_store: 'Azure Blob Storage'
  crypto_service: 'Azure Key Vault'
  audit_trail: 'Azure SQL with Ledger Tables'

  compliance_certifications:
    - 'SOC 2 Type II'
    - 'FedRAMP High'
    - 'HIPAA'
    - 'PCI DSS'
```

#### Configuration C: Multi-Cloud / Portable

```yaml
deployment:
  name: 'Cloud Agnostic'
  metadata_store: 'CockroachDB (self-managed)'
  artifact_store: 'MinIO (S3-compatible)'
  crypto_service: 'HashiCorp Vault'
  audit_trail: 'PostgreSQL with hardening (ADR-001 Option B)'

  compliance_certifications:
    - 'Depends on infrastructure provider'
    - 'Self-attestation may be required'
```

#### Configuration D: Air-Gapped / High Security

```yaml
deployment:
  name: 'Air-Gapped Deployment'
  metadata_store: 'PostgreSQL on hardened compute'
  artifact_store: 'MinIO on local storage'
  crypto_service: 'Hardware HSM (on-premises)'
  audit_trail: 'PostgreSQL with WORM storage backend'

  compliance_certifications:
    - 'CJIS'
    - 'IL4/IL5'
    - 'ITAR (with additional controls)'
```

---

## Consequences

### Positive

- Organizations can choose components matching their constraints
- No vendor lock-in
- Easier compliance with regional data residency requirements
- Can leverage existing infrastructure investments
- Enables gradual migration between providers

### Negative

- Increased testing complexity (must test all combinations)
- Documentation must cover multiple configurations
- Potential for subtle behavioral differences between implementations
- Integration testing overhead

### Risks

- Implementation drift between adapters
- Security misconfiguration during component substitution
- SLA degradation if components are mixed inappropriately

### Mitigations

- Comprehensive interface compliance tests
- Reference implementations for each approved adapter
- Configuration validation at startup
- Automated compliance scanning

---

## Compliance Mapping

| Framework    | Relevant Controls   | How Modularity Supports                                         |
| ------------ | ------------------- | --------------------------------------------------------------- |
| NIST CSF 2.0 | ID.AM, PR.DS, PR.IP | Asset management, data security, configuration management       |
| SOC 2        | CC6.1, CC6.7, CC8.1 | Infrastructure security, change management                      |
| FedRAMP      | SC-8, SC-12, SC-13  | Transmission security, key management, cryptographic protection |
| PCI DSS 4.0  | 3.5, 4.1, 8.3       | Key management, encryption, authentication                      |
| HIPAA        | §164.312(e)(1)      | Transmission security                                           |
| SEC 17a-4    | (f)(2)              | Electronic storage requirements                                 |
| FINRA 4511   | Record retention    | Books and records integrity                                     |
| CJIS         | 5.10.1              | Encryption requirements                                         |

---

## Implementation Checklist

For each deployment, verify:

- [ ] All interfaces implemented completely
- [ ] TLS 1.3 enforced on all connections
- [ ] Encryption at rest enabled for all stores
- [ ] SLA monitoring configured
- [ ] Backup and recovery tested
- [ ] Compliance certifications documented
- [ ] Incident response procedures defined
- [ ] Audit logging enabled for all operations
- [ ] Key rotation procedures documented
- [ ] Disaster recovery plan tested
