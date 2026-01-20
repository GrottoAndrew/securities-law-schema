# System Hygiene: Refactoring, Maintenance, and Best Practices

## Overview

This document provides guidance on maintaining a healthy, compliant codebase. Like securities compliance itself, code hygiene requires ongoing attention—not just periodic audits.

---

## The R2 Analogy: Cost vs. Compliance Trade-offs

### Understanding the Trade-off Spectrum

Just as Cloudflare R2 offers S3 compatibility at lower cost but without Object Lock (WORM), every technical decision in this system involves trade-offs between cost, features, and compliance.

| Decision | R2 Equivalent | Cheap Option | Compliant Option | Guidance |
|----------|---------------|--------------|------------------|----------|
| Storage provider | R2 vs S3 | PostgreSQL (no WORM) | S3 Object Lock | Use PostgreSQL for dev, S3/Azure for prod |
| Backup frequency | Egress costs | Weekly backups | Real-time replication | Scale with firm size |
| Monitoring depth | Pay per metric | Basic health checks | Full APM + tracing | Start basic, add as needed |
| Vendor integrations | API call costs | Manual uploads | Real-time webhooks | Manual is compliant, just slower |

### The Golden Rule

**Compliance is binary. Cost is a spectrum.**

You're either 17a-4 compliant or you're not. But you can achieve compliance at $50/month or $5,000/month depending on your operational needs.

---

## Key Sections Requiring Regular Refactoring

### Priority 1: Security-Critical (Review Monthly)

| Section | File(s) | Why Regular Review |
|---------|---------|-------------------|
| Hash computation | `src/core/hash-chain.ts` | Algorithm weaknesses discovered over time |
| Signature verification | `src/core/signing.ts` | Key rotation, algorithm updates |
| Storage interface | `src/storage/interface.ts` | New compliance requirements |
| Database migrations | `src/db/migrations/*.sql` | Schema drift, performance |

**Review Checklist**:
- [ ] No deprecated crypto algorithms (MD5, SHA-1)
- [ ] Key lengths meet current standards (P-256 minimum)
- [ ] No hardcoded secrets
- [ ] Input validation on all public interfaces

### Priority 2: Vendor Integrations (Review Quarterly)

| Section | File(s) | Why Regular Review |
|---------|---------|-------------------|
| Vendor auth | `src/integrations/*/auth.ts` | OAuth token refresh, API key rotation |
| API endpoints | `src/integrations/*/client.ts` | Vendor API versioning changes |
| Data mapping | `src/integrations/*/mapper.ts` | Schema changes from vendors |

**Review Checklist**:
- [ ] API versions are current (not deprecated)
- [ ] Rate limits are respected
- [ ] Error handling covers new error codes
- [ ] Test credentials are not in code

### Priority 3: Compliance Mapping (Review Annually)

| Section | File(s) | Why Regular Review |
|---------|---------|-------------------|
| OSCAL controls | `controls/*.json` | Regulatory updates |
| Schema definitions | `schemas/**/*.jsonld` | CFR amendments |
| Evidence requirements | `controls/**/parts` | New SEC guidance |

**Review Checklist**:
- [ ] Citations match current CFR text
- [ ] No-action letter guidance incorporated
- [ ] Examination priorities reflected

---

## Best Practices for System Hygiene

### 1. Cryptographic Hygiene

```typescript
// ✅ DO: Use established libraries
import { createHash, timingSafeEqual } from 'node:crypto';

// ❌ DON'T: Roll your own crypto
function myHash(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data.charCodeAt(i);
  }
  return hash.toString(16);
}
```

**Rules**:
1. Never implement your own hash functions
2. Never implement your own encryption
3. Use timing-safe comparison for secrets
4. Rotate keys on schedule (annual minimum)
5. Log key usage but never log key material

### 2. Database Hygiene

```sql
-- ✅ DO: Use parameterized queries
SELECT * FROM audit_events WHERE event_type = $1 AND timestamp > $2;

-- ❌ DON'T: String concatenation
SELECT * FROM audit_events WHERE event_type = '${eventType}';
```

**Rules**:
1. Always use parameterized queries
2. Never store plaintext credentials
3. Audit all schema changes
4. Test migrations in staging first
5. Keep migration files immutable (never edit after applying)

### 3. API Hygiene

```typescript
// ✅ DO: Validate all inputs
const schema = z.object({
  evidenceId: z.string().uuid(),
  controlId: z.string().regex(/^ctrl-[a-z-]+$/),
  timestamp: z.string().datetime(),
});

function handleSubmit(input: unknown) {
  const validated = schema.parse(input);
  // ...
}

// ❌ DON'T: Trust input
function handleSubmit(input: any) {
  await db.query(`INSERT INTO evidence VALUES ('${input.id}')`);
}
```

**Rules**:
1. Validate all external input with schemas
2. Sanitize before logging (no PII in logs)
3. Use rate limiting on all endpoints
4. Return generic errors to clients, detailed to logs
5. Version your APIs (v1, v2)

### 4. Vendor Integration Hygiene

```typescript
// ✅ DO: Handle errors gracefully
async function pullFromVendor(): Promise<Result> {
  try {
    const response = await client.get('/data');
    return { success: true, data: response.data };
  } catch (error) {
    if (error instanceof RateLimitError) {
      await backoff(error.retryAfter);
      return pullFromVendor(); // Retry
    }
    logger.error('Vendor pull failed', { vendor: 'orion', error: error.message });
    return { success: false, error: 'VENDOR_UNAVAILABLE' };
  }
}

// ❌ DON'T: Let failures cascade
async function pullFromVendor() {
  const response = await client.get('/data'); // Throws on any error
  return response.data;
}
```

**Rules**:
1. Implement exponential backoff for retries
2. Log all vendor interactions (for audit trail)
3. Store credentials in secrets manager, not env vars
4. Test with vendor sandboxes before production
5. Monitor for deprecation warnings in responses

### 5. Evidence Integrity Hygiene

```typescript
// ✅ DO: Hash immediately on receipt
async function storeEvidence(file: Buffer, metadata: Metadata) {
  // Hash BEFORE any other processing
  const hash = createHash('sha256').update(file).digest('hex');

  // Log the hash immediately
  await auditTrail.log({
    eventType: 'EVIDENCE_RECEIVED',
    hash,
    timestamp: new Date(),
  });

  // Now store
  await storage.store(key, file, { metadata });
}

// ❌ DON'T: Process before hashing
async function storeEvidence(file: Buffer) {
  // This allows modification before hashing
  const processed = await transform(file);
  const hash = createHash('sha256').update(processed).digest('hex');
  await storage.store(key, processed);
}
```

**Rules**:
1. Hash on receipt, before any transformation
2. Store original AND transformed (if needed)
3. Link transformed to original via hash reference
4. Timestamp with reliable source (NTP)
5. Never delete evidence, only soft-delete with audit

---

## Refactoring Patterns

### Pattern 1: Dependency Injection for Testability

```typescript
// Before: Hard to test
class AuditWriter {
  private storage = new S3Storage(process.env.S3_BUCKET!);

  async write(event: AuditEvent) {
    await this.storage.store(...);
  }
}

// After: Testable
class AuditWriter {
  constructor(private storage: ImmutableStorage) {}

  async write(event: AuditEvent) {
    await this.storage.store(...);
  }
}

// In tests
const mockStorage = new MockStorage();
const writer = new AuditWriter(mockStorage);
```

### Pattern 2: Extract Configuration

```typescript
// Before: Magic numbers
const CHECKPOINT_INTERVAL = 1000;
const RETENTION_DAYS = 2555;

// After: Configurable
interface Config {
  checkpointInterval: number;
  retentionDays: number;
  storageProvider: 'postgres' | 's3' | 'azure';
}

const config = loadConfig(process.env.NODE_ENV);
```

### Pattern 3: Error Boundaries

```typescript
// Before: Errors leak
async function handleRequest(req: Request) {
  const result = await processEvidence(req.body);
  return result;
}

// After: Errors contained
async function handleRequest(req: Request) {
  try {
    const validated = validateInput(req.body);
    const result = await processEvidence(validated);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { success: false, error: 'INVALID_INPUT', details: error.issues };
    }
    logger.error('Unexpected error', { error, requestId: req.id });
    return { success: false, error: 'INTERNAL_ERROR' };
  }
}
```

---

## Scheduled Maintenance Tasks

### Daily

| Task | Owner | Verification |
|------|-------|--------------|
| Check hash chain integrity | Automated | Cron job logs |
| Verify checkpoint creation | Automated | Dashboard |
| Review failed vendor pulls | Ops | Alert channel |

### Weekly

| Task | Owner | Verification |
|------|-------|--------------|
| Review storage capacity | Ops | Metrics dashboard |
| Check certificate expiration | Ops | Alert if <30 days |
| Review error rate trends | Ops | Grafana/CloudWatch |

### Monthly

| Task | Owner | Verification |
|------|-------|--------------|
| Security patch review | Dev | Dependabot/Snyk |
| Key rotation check | Security | Key management system |
| Access review | Compliance | Access logs |
| Backup restoration test | Ops | Test restore log |

### Quarterly

| Task | Owner | Verification |
|------|-------|--------------|
| Vendor API version review | Dev | Vendor changelogs |
| Full chain validation | Automated | Validation report |
| Disaster recovery test | Ops | DR test report |
| Compliance control review | Compliance | Control matrix |

### Annually

| Task | Owner | Verification |
|------|-------|--------------|
| Regulatory update review | Compliance | CFR diff analysis |
| OSCAL control refresh | Dev | Control validation |
| Penetration test | Security | Pentest report |
| Architecture review | CTO | ADR updates |

---

## Cost Optimization Hygiene

### For Small Firms (Starter/Growth Tier)

| Optimization | Savings | Trade-off |
|-------------|---------|-----------|
| Compress before storing | 60-80% storage | CPU cost |
| Batch uploads (daily vs real-time) | 50%+ API calls | Lag time |
| Single-region deployment | 40% infra | DR risk |
| Reserved capacity (1-year) | 30% | Lock-in |

### For Mid-Tier Firms (Professional)

| Optimization | Savings | Trade-off |
|-------------|---------|-----------|
| S3 Intelligent-Tiering | 20-40% storage | Retrieval latency |
| Spot instances for batch jobs | 60-90% compute | Interruption risk |
| Right-size database instances | 20-50% | Requires monitoring |
| CDN for read-heavy workloads | 30% egress | Cache invalidation |

### For Large Firms (Enterprise)

| Optimization | Savings | Trade-off |
|-------------|---------|-----------|
| Enterprise agreements | 20-40% | Volume commitment |
| Private pricing | Varies | Negotiation effort |
| Multi-cloud arbitrage | 10-30% | Complexity |
| Dedicated hosts for compliance | Varies | Management overhead |

---

## Compliance-Specific Hygiene

### Evidence Chain of Custody

Every piece of evidence must have a complete chain:

```
1. Receipt → Hash immediately, log source
2. Validation → Verify format, log checks performed
3. Storage → WORM storage, log location
4. Retrieval → Log accessor, purpose, timestamp
5. Export → Log destination, format, recipient
```

### Audit Trail Completeness

The audit trail must capture:

| Event Category | Examples | Required Fields |
|----------------|----------|-----------------|
| Evidence events | Submit, retrieve, verify | evidenceId, actor, timestamp |
| Checkpoint events | Create, sign, verify | checkpointId, merkleRoot, signature |
| Access events | Login, logout, permission change | userId, action, ip, timestamp |
| System events | Start, stop, config change | component, action, actor |
| Vendor events | Pull success/failure | vendor, recordCount, duration |

### Retention Enforcement

```typescript
// ✅ Correct: Enforce at storage layer
await s3.putObject({
  Bucket: bucket,
  Key: key,
  Body: data,
  ObjectLockMode: 'COMPLIANCE',
  ObjectLockRetainUntilDate: addYears(new Date(), 7),
});

// ❌ Wrong: Rely on application logic
const retentionEnd = addYears(new Date(), 7);
await db.insert({ data, retentionEnd }); // Nothing enforces this
```

---

## Red Flags Checklist

Review code for these anti-patterns:

| Red Flag | Risk | Fix |
|----------|------|-----|
| Hardcoded credentials | Security breach | Use secrets manager |
| Disabled eslint rules | Code quality | Fix the issue |
| `any` type usage | Type safety | Define proper types |
| Catch-all error handlers | Hidden bugs | Specific error handling |
| Commented-out code | Confusion | Delete it |
| TODO without ticket | Forgotten work | Create ticket or remove |
| Console.log in production | Log leakage | Use proper logger |
| Synchronous file I/O | Performance | Use async |
| Missing input validation | Injection attacks | Add validation |
| Direct SQL strings | SQL injection | Parameterized queries |

---

## Documentation Hygiene

### Required Documentation

| Document | Update Frequency | Owner |
|----------|-----------------|-------|
| README.md | Per release | Dev lead |
| CHANGELOG.md | Per release | Dev lead |
| API documentation | Per API change | Dev |
| ADRs | Per architecture decision | Architect |
| Runbook | Per operational change | Ops |
| Incident post-mortems | Per incident | On-call |

### ADR (Architecture Decision Record) Template

```markdown
# ADR-XXX: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded]

## Context
[Why is this decision needed?]

## Decision
[What was decided?]

## Consequences
[What are the implications?]

### Positive
- ...

### Negative
- ...

### Risks
- ...
```

---

## Monitoring Hygiene

### Essential Metrics

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| Hash chain integrity | Any failure | Page on-call |
| Checkpoint age | >24 hours | Warning |
| Storage capacity | >80% | Scale or archive |
| API error rate | >1% | Investigate |
| Vendor pull success | <95% | Review integration |
| Response latency p99 | >5s | Performance review |

### Log Levels

```typescript
// Use appropriate levels
logger.debug('Processing started', { requestId }); // Dev only
logger.info('Evidence stored', { evidenceId }); // Normal operations
logger.warn('Vendor rate limited, backing off', { vendor }); // Attention needed
logger.error('Failed to store evidence', { error }); // Action required
```

---

## Summary: The Three Laws of Compliance System Hygiene

1. **Hash First**: Always hash evidence on receipt, before any other operation
2. **Log Everything**: If it affects evidence or access, it must be in the audit trail
3. **Verify Always**: Trust but verify—run integrity checks continuously, not just during audits

Following these principles ensures your system remains compliant regardless of which cost tier you operate at.
