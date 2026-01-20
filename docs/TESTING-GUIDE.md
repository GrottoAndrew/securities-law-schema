# Testing Guide: Unit Tests, Integration Tests, and Compliance Verification

## Overview

This document specifies the testing requirements for the securities compliance system. Tests are categorized by:

1. **Unit Tests** - Fast, isolated, no external dependencies
2. **Integration Tests** - Require database or cloud services
3. **Compliance Tests** - Verify regulatory requirements are met
4. **Security Tests** - Validate cryptographic guarantees

---

## Unit Test Specifications

### Core Cryptographic Module (`src/core/`)

#### Hash Chain (`hash-chain.ts`)

| Test ID | Description | Priority |
|---------|-------------|----------|
| HC-001 | Genesis record has null previous hash | P0 |
| HC-002 | Second record references genesis hash | P0 |
| HC-003 | Hash computation is deterministic | P0 |
| HC-004 | Different payloads produce different hashes | P0 |
| HC-005 | Chain validation detects tampered record | P0 |
| HC-006 | Chain validation detects deleted record | P0 |
| HC-007 | Chain validation detects reordered records | P0 |
| HC-008 | Empty chain is valid | P1 |
| HC-009 | Single record chain is valid | P1 |
| HC-010 | Timing-safe comparison prevents timing attacks | P1 |

```typescript
// Example test structure
describe('HashChain', () => {
  describe('computeRecordHash', () => {
    it('HC-001: genesis record has null previous hash', () => {
      const genesis = createGenesisRecord({ eventType: 'SYSTEM_INIT' });
      expect(genesis.previousHash).toBe(GENESIS_PREVIOUS_HASH);
    });

    it('HC-003: hash computation is deterministic', () => {
      const input = { sequenceNumber: 1, timestamp: new Date('2024-01-01'), ... };
      const hash1 = computeRecordHash(input);
      const hash2 = computeRecordHash(input);
      expect(hash1).toBe(hash2);
    });
  });

  describe('validateChain', () => {
    it('HC-005: detects tampered record', () => {
      const chain = createTestChain(5);
      chain[2].payload = { tampered: true }; // Tamper middle record
      const result = validateChain(chain);
      expect(result.isValid).toBe(false);
      expect(result.failedAt).toBe(2);
    });
  });
});
```

#### Merkle Tree (`merkle-tree.ts`)

| Test ID | Description | Priority |
|---------|-------------|----------|
| MT-001 | Single leaf tree has leaf hash as root | P0 |
| MT-002 | Two leaves produce correct root | P0 |
| MT-003 | Odd leaf count duplicates last leaf | P0 |
| MT-004 | Proof generation for leaf 0 is valid | P0 |
| MT-005 | Proof generation for last leaf is valid | P0 |
| MT-006 | Proof verification succeeds for valid proof | P0 |
| MT-007 | Proof verification fails for tampered leaf | P0 |
| MT-008 | Proof verification fails for wrong root | P0 |
| MT-009 | Large tree (1000 leaves) builds correctly | P1 |
| MT-010 | Incremental tree matches batch tree | P0 |
| MT-011 | Leaf prefix differs from internal prefix | P1 |
| MT-012 | Empty tree throws appropriate error | P1 |

```typescript
describe('MerkleTree', () => {
  describe('buildMerkleTree', () => {
    it('MT-003: odd leaf count duplicates last leaf', () => {
      const leaves = ['a', 'b', 'c'];
      const tree = buildMerkleTree(leaves);
      // With 3 leaves, 'c' should be duplicated to make 4
      expect(tree.leafCount).toBe(3);
      expect(tree.root).toBeDefined();
    });
  });

  describe('verifyMerkleProof', () => {
    it('MT-007: fails for tampered leaf', () => {
      const leaves = ['a', 'b', 'c', 'd'];
      const tree = buildMerkleTree(leaves);
      const proof = tree.generateProof(1); // Proof for 'b'

      // Tamper the leaf in the proof
      proof.leaf = 'tampered';

      expect(verifyMerkleProof(proof)).toBe(false);
    });
  });
});
```

#### Signing (`signing.ts`)

| Test ID | Description | Priority |
|---------|-------------|----------|
| SG-001 | P-256 signature verifies correctly | P0 |
| SG-002 | P-384 signature verifies correctly | P0 |
| SG-003 | Wrong key fails verification | P0 |
| SG-004 | Tampered data fails verification | P0 |
| SG-005 | Key rotation produces new key ID | P1 |
| SG-006 | Signature includes key ID | P0 |
| SG-007 | Checkpoint signing produces valid signature | P0 |
| SG-008 | Expired key is rejected | P2 |

### Storage Module (`src/storage/`)

#### Storage Interface (`interface.ts`)

| Test ID | Description | Priority |
|---------|-------------|----------|
| SI-001 | StorageError has correct code types | P1 |
| SI-002 | RetentionPolicy accepts compliance mode | P1 |
| SI-003 | RetentionPolicy accepts governance mode | P1 |

#### PostgreSQL Provider (`providers/postgres-only.ts`)

| Test ID | Description | Priority | Requires DB |
|---------|-------------|----------|-------------|
| PG-001 | Store creates new object | P0 | Yes |
| PG-002 | Store rejects duplicate key | P0 | Yes |
| PG-003 | Retrieve returns correct data | P0 | Yes |
| PG-004 | Retrieve throws NOT_FOUND for missing | P0 | Yes |
| PG-005 | Verify integrity passes for valid object | P0 | Yes |
| PG-006 | List filters by prefix | P0 | Yes |
| PG-007 | List respects limit | P0 | Yes |
| PG-008 | Legal hold can be applied | P1 | Yes |
| PG-009 | Legal hold can be removed | P1 | Yes |
| PG-010 | Health check returns true when connected | P0 | Yes |
| PG-011 | Health check returns false when disconnected | P1 | No |
| PG-012 | Capabilities correctly reports no WORM | P0 | No |

### Audit Module (`src/audit/`)

#### Audit Writer (`writer.ts`)

| Test ID | Description | Priority |
|---------|-------------|----------|
| AW-001 | Write event creates hash chain record | P0 |
| AW-002 | Checkpoint creates Merkle tree | P0 |
| AW-003 | Auto-checkpoint triggers at threshold | P1 |
| AW-004 | Checkpoint is signed | P0 |
| AW-005 | Failed write does not corrupt chain | P0 |

---

## Integration Test Specifications

### Database Integration

```typescript
// Run with: npm test -- --grep "integration"
describe('PostgreSQL Integration', { timeout: 30000 }, () => {
  let storage: PostgresOnlyStorage;
  let pool: Pool;

  beforeAll(async () => {
    // Requires Docker: docker-compose up -d
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    storage = new PostgresOnlyStorage(pool);
  });

  it('INT-PG-001: full storage lifecycle', async () => {
    const key = `test/${Date.now()}`;
    const data = Buffer.from('test content');

    // Store
    const stored = await storage.store(key, data);
    expect(stored.contentHash).toMatch(/^[a-f0-9]{64}$/);

    // Retrieve
    const retrieved = await storage.retrieve(key);
    expect(retrieved.data.toString()).toBe('test content');

    // Verify
    const valid = await storage.verifyIntegrity(key);
    expect(valid).toBe(true);
  });
});
```

### Cloud Storage Integration (Phase 2)

| Test ID | Description | Provider |
|---------|-------------|----------|
| INT-S3-001 | Store with Object Lock COMPLIANCE | AWS S3 |
| INT-S3-002 | Verify deletion is blocked | AWS S3 |
| INT-S3-003 | Legal hold prevents deletion | AWS S3 |
| INT-AZ-001 | Store with immutability policy | Azure |
| INT-AZ-002 | Verify deletion is blocked | Azure |
| INT-B2-001 | Store with Object Lock | Backblaze |

---

## Compliance Test Specifications

These tests verify SEC 17a-4 and related regulatory requirements.

### Record Retention (17a-4(f))

| Test ID | Requirement | Test |
|---------|-------------|------|
| C17-001 | Records preserved for required period | Verify retention policy is set to 7 years |
| C17-002 | Records cannot be altered | Attempt UPDATE, verify rejection |
| C17-003 | Records cannot be deleted | Attempt DELETE, verify rejection |
| C17-004 | Index allows retrieval | Query by date range, verify results |
| C17-005 | Duplicate copies exist | Verify cross-region replication (Enterprise) |

### Audit Trail Integrity

| Test ID | Requirement | Test |
|---------|-------------|------|
| CAT-001 | Chain is tamper-evident | Modify record, verify detection |
| CAT-002 | Gaps are detectable | Delete record, verify detection |
| CAT-003 | Timestamps are accurate | Compare to NTP, verify within 1s |
| CAT-004 | All events are captured | Generate events, verify all recorded |

### Cryptographic Requirements

| Test ID | Requirement | Test |
|---------|-------------|------|
| CCR-001 | SHA-256 is used | Verify hash length is 64 hex chars |
| CCR-002 | ECDSA P-256 or P-384 | Verify key curve |
| CCR-003 | Signatures are verifiable | Third-party verification tool |

---

## Security Test Specifications

### Timing Attack Resistance

```typescript
describe('Security: Timing Attacks', () => {
  it('SEC-001: hash comparison is constant-time', async () => {
    const correct = 'a'.repeat(64);
    const wrongFirst = 'b' + 'a'.repeat(63);
    const wrongLast = 'a'.repeat(63) + 'b';

    const times: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const start = process.hrtime.bigint();
      timingSafeEqual(correct, wrongFirst);
      times.push(Number(process.hrtime.bigint() - start));
    }

    const timesLast: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const start = process.hrtime.bigint();
      timingSafeEqual(correct, wrongLast);
      timesLast.push(Number(process.hrtime.bigint() - start));
    }

    // Times should be statistically similar
    const avgFirst = times.reduce((a, b) => a + b) / times.length;
    const avgLast = timesLast.reduce((a, b) => a + b) / timesLast.length;
    expect(Math.abs(avgFirst - avgLast)).toBeLessThan(avgFirst * 0.1);
  });
});
```

### Input Validation

| Test ID | Description | Priority |
|---------|-------------|----------|
| SEC-002 | Reject keys with path traversal | P0 |
| SEC-003 | Reject oversized payloads | P0 |
| SEC-004 | Sanitize metadata values | P0 |
| SEC-005 | SQL injection in queries | P0 |

---

## Test Coverage Requirements

### Minimum Coverage by Module

| Module | Line Coverage | Branch Coverage |
|--------|--------------|-----------------|
| `src/core/hash-chain.ts` | 95% | 90% |
| `src/core/merkle-tree.ts` | 95% | 90% |
| `src/core/signing.ts` | 90% | 85% |
| `src/storage/providers/*.ts` | 85% | 80% |
| `src/audit/*.ts` | 85% | 80% |
| Overall | 85% | 80% |

### Running Tests

```bash
# All unit tests
npm test

# With coverage
npm run test:coverage

# Specific module
npm test -- src/core/hash-chain.test.ts

# Integration tests (requires Docker)
docker-compose up -d
npm test -- --grep "integration"

# Watch mode
npm test -- --watch
```

---

## Test Data Management

### Fixtures

```typescript
// tests/fixtures/audit-events.ts
export const sampleAuditEvents = [
  {
    eventType: 'EVIDENCE_SUBMITTED',
    payload: { evidenceId: 'ev-001', controlId: 'ctrl-accredited-investor' },
    timestamp: new Date('2024-01-15T10:00:00Z'),
  },
  {
    eventType: 'CHECKPOINT_CREATED',
    payload: { checkpointId: 'cp-001', merkleRoot: '...' },
    timestamp: new Date('2024-01-15T12:00:00Z'),
  },
];
```

### Database Seeding

```typescript
// tests/setup/seed-database.ts
export async function seedTestDatabase(pool: Pool) {
  await pool.query('TRUNCATE audit_events, audit_checkpoints CASCADE');

  for (const event of sampleAuditEvents) {
    await pool.query(
      'INSERT INTO audit_events (event_type, payload, timestamp) VALUES ($1, $2, $3)',
      [event.eventType, event.payload, event.timestamp]
    );
  }
}
```

---

## Continuous Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test -- --run

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: audit_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm test -- --grep "integration"
        env:
          TEST_DATABASE_URL: postgresql://test:test@localhost:5432/audit_test

  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
```

---

## Test Naming Convention

```
[Module]-[Number]: [Description]

Examples:
HC-001: Genesis record has null previous hash
MT-007: Proof verification fails for tampered leaf
PG-012: Capabilities correctly reports no WORM
INT-S3-001: Store with Object Lock COMPLIANCE
C17-003: Records cannot be deleted
SEC-005: SQL injection in queries
```

This naming allows:
- Easy reference in bug reports
- Traceability to requirements
- Filtering in test runners
