/**
 * Merkle Tree Unit Tests
 *
 * Comprehensive tests including edge cases:
 * - Empty tree
 * - Single leaf
 * - Odd number of leaves
 * - Power of 2 leaves
 * - Large trees
 * - Proof generation and verification
 * - Incremental tree
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MerkleTree,
  IncrementalMerkleTree,
  hashLeaf,
  hashInternal,
  verifyMerkleProof,
  verifyLeafInTree,
  computeMerkleRoot,
  verifyMultipleProofs,
  EMPTY_ROOT,
  type MerkleProof,
} from '../merkle-tree.js';

describe('hashLeaf', () => {
  it('should produce consistent hash for same input', () => {
    const hash1 = hashLeaf('test data');
    const hash2 = hashLeaf('test data');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different inputs', () => {
    const hash1 = hashLeaf('test1');
    const hash2 = hashLeaf('test2');
    expect(hash1).not.toBe(hash2);
  });

  it('should produce 64-character hex string', () => {
    const hash = hashLeaf('test');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('should handle Buffer input', () => {
    const hash1 = hashLeaf(Buffer.from('test', 'utf8'));
    const hash2 = hashLeaf('test');
    expect(hash1).toBe(hash2);
  });

  it('should handle empty string', () => {
    const hash = hashLeaf('');
    expect(hash).toHaveLength(64);
  });
});

describe('hashInternal', () => {
  it('should produce consistent hash for same inputs', () => {
    const left = 'a'.repeat(64);
    const right = 'b'.repeat(64);
    const hash1 = hashInternal(left, right);
    const hash2 = hashInternal(left, right);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different order', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const hash1 = hashInternal(a, b);
    const hash2 = hashInternal(b, a);
    expect(hash1).not.toBe(hash2);
  });

  it('should be different from leaf hash', () => {
    const data = 'test';
    const leafHash = hashLeaf(data);
    const internalHash = hashInternal(leafHash, leafHash);
    expect(leafHash).not.toBe(internalHash);
  });
});

describe('MerkleTree', () => {
  describe('empty tree', () => {
    it('should have EMPTY_ROOT as root', () => {
      const tree = new MerkleTree([]);
      expect(tree.getRoot()).toBe(EMPTY_ROOT);
    });

    it('should have 0 leaves', () => {
      const tree = new MerkleTree([]);
      expect(tree.getLeafCount()).toBe(0);
    });

    it('should have depth 0', () => {
      const tree = new MerkleTree([]);
      expect(tree.getDepth()).toBe(0);
    });

    it('should return undefined for proof generation', () => {
      const tree = new MerkleTree([]);
      expect(tree.generateProof(0)).toBeUndefined();
    });
  });

  describe('single leaf', () => {
    let tree: MerkleTree;

    beforeEach(() => {
      tree = new MerkleTree(['single leaf']);
    });

    it('should have leaf hash as root', () => {
      const expectedRoot = hashLeaf('single leaf');
      expect(tree.getRoot()).toBe(expectedRoot);
    });

    it('should have 1 leaf', () => {
      expect(tree.getLeafCount()).toBe(1);
    });

    it('should have depth 0', () => {
      expect(tree.getDepth()).toBe(0);
    });

    it('should generate valid proof', () => {
      const proof = tree.generateProof(0);
      expect(proof).toBeDefined();
      expect(proof!.siblings).toHaveLength(0);
      expect(tree.verifyProof(proof!)).toBe(true);
    });
  });

  describe('two leaves (power of 2)', () => {
    let tree: MerkleTree;

    beforeEach(() => {
      tree = new MerkleTree(['leaf1', 'leaf2']);
    });

    it('should have 2 leaves', () => {
      expect(tree.getLeafCount()).toBe(2);
    });

    it('should have depth 1', () => {
      expect(tree.getDepth()).toBe(1);
    });

    it('should compute correct root', () => {
      const leaf1Hash = hashLeaf('leaf1');
      const leaf2Hash = hashLeaf('leaf2');
      const expectedRoot = hashInternal(leaf1Hash, leaf2Hash);
      expect(tree.getRoot()).toBe(expectedRoot);
    });

    it('should generate valid proof for leaf 0', () => {
      const proof = tree.generateProof(0);
      expect(proof).toBeDefined();
      expect(proof!.siblings).toHaveLength(1);
      expect(proof!.siblings[0]!.position).toBe('right');
      expect(tree.verifyProof(proof!)).toBe(true);
    });

    it('should generate valid proof for leaf 1', () => {
      const proof = tree.generateProof(1);
      expect(proof).toBeDefined();
      expect(proof!.siblings).toHaveLength(1);
      expect(proof!.siblings[0]!.position).toBe('left');
      expect(tree.verifyProof(proof!)).toBe(true);
    });
  });

  describe('three leaves (odd)', () => {
    let tree: MerkleTree;

    beforeEach(() => {
      tree = new MerkleTree(['leaf1', 'leaf2', 'leaf3']);
    });

    it('should have 3 leaves', () => {
      expect(tree.getLeafCount()).toBe(3);
    });

    it('should have depth 2 (padded to 4 leaves)', () => {
      expect(tree.getDepth()).toBe(2);
    });

    it('should generate valid proofs for all leaves', () => {
      for (let i = 0; i < 3; i++) {
        const proof = tree.generateProof(i);
        expect(proof).toBeDefined();
        expect(tree.verifyProof(proof!)).toBe(true);
      }
    });

    it('should handle duplicated last leaf correctly', () => {
      // Last leaf (index 2) should have a sibling that is itself (duplicated)
      const proof = tree.generateProof(2);
      expect(proof).toBeDefined();
      // The first sibling should be the same as the leaf (duplicated leaf 3)
      expect(proof!.siblings[0]!.hash).toBe(tree.getLeafHash(2));
    });
  });

  describe('four leaves (power of 2)', () => {
    let tree: MerkleTree;
    const leaves = ['leaf1', 'leaf2', 'leaf3', 'leaf4'];

    beforeEach(() => {
      tree = new MerkleTree(leaves);
    });

    it('should have 4 leaves', () => {
      expect(tree.getLeafCount()).toBe(4);
    });

    it('should have depth 2', () => {
      expect(tree.getDepth()).toBe(2);
    });

    it('should compute correct root', () => {
      const h1 = hashLeaf('leaf1');
      const h2 = hashLeaf('leaf2');
      const h3 = hashLeaf('leaf3');
      const h4 = hashLeaf('leaf4');
      const h12 = hashInternal(h1, h2);
      const h34 = hashInternal(h3, h4);
      const expectedRoot = hashInternal(h12, h34);
      expect(tree.getRoot()).toBe(expectedRoot);
    });

    it('should generate valid proofs for all leaves', () => {
      for (let i = 0; i < 4; i++) {
        const proof = tree.generateProof(i);
        expect(proof).toBeDefined();
        expect(proof!.siblings).toHaveLength(2);
        expect(tree.verifyProof(proof!)).toBe(true);
      }
    });
  });

  describe('large tree (100 leaves)', () => {
    let tree: MerkleTree;
    const leaves = Array.from({ length: 100 }, (_, i) => `leaf${i}`);

    beforeEach(() => {
      tree = new MerkleTree(leaves);
    });

    it('should have 100 leaves', () => {
      expect(tree.getLeafCount()).toBe(100);
    });

    it('should have depth 7 (padded to 128)', () => {
      expect(tree.getDepth()).toBe(7);
    });

    it('should generate valid proofs for first leaf', () => {
      const proof = tree.generateProof(0);
      expect(proof).toBeDefined();
      expect(tree.verifyProof(proof!)).toBe(true);
    });

    it('should generate valid proofs for last leaf', () => {
      const proof = tree.generateProof(99);
      expect(proof).toBeDefined();
      expect(tree.verifyProof(proof!)).toBe(true);
    });

    it('should generate valid proofs for middle leaf', () => {
      const proof = tree.generateProof(50);
      expect(proof).toBeDefined();
      expect(tree.verifyProof(proof!)).toBe(true);
    });

    it('should reject proof for tampered leaf', () => {
      const proof = tree.generateProof(50);
      expect(proof).toBeDefined();

      // Tamper with leaf hash
      const tamperedProof: MerkleProof = {
        ...proof!,
        leafHash: 'f'.repeat(64),
      };

      expect(tree.verifyProof(tamperedProof)).toBe(false);
    });

    it('should reject proof with wrong root', () => {
      const proof = tree.generateProof(50);
      expect(proof).toBeDefined();

      expect(verifyMerkleProof(proof!, 'wrong_root'.padEnd(64, '0'))).toBe(false);
    });
  });

  describe('proof verification', () => {
    it('should reject tampered sibling hash', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      const proof = tree.generateProof(0);
      expect(proof).toBeDefined();

      // Tamper with sibling
      const tamperedProof: MerkleProof = {
        ...proof!,
        siblings: proof!.siblings.map((s, i) =>
          i === 0 ? { ...s, hash: 'x'.repeat(64) } : s
        ),
      };

      expect(tree.verifyProof(tamperedProof)).toBe(false);
    });

    it('should reject proof with swapped position', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      const proof = tree.generateProof(0);
      expect(proof).toBeDefined();

      // Swap position
      const tamperedProof: MerkleProof = {
        ...proof!,
        siblings: proof!.siblings.map((s) => ({
          ...s,
          position: s.position === 'left' ? 'right' : 'left',
        })),
      };

      expect(tree.verifyProof(tamperedProof)).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should export and import correctly', () => {
      const tree = new MerkleTree(['leaf1', 'leaf2', 'leaf3', 'leaf4']);
      const json = tree.toJSON();

      const imported = MerkleTree.fromJSON(json);

      expect(imported.getRoot()).toBe(tree.getRoot());
      expect(imported.getLeafCount()).toBe(tree.getLeafCount());
      expect(imported.getDepth()).toBe(tree.getDepth());
    });

    it('should preserve proof validity after import', () => {
      const tree = new MerkleTree(['leaf1', 'leaf2', 'leaf3']);
      const proof = tree.generateProof(1);

      const json = tree.toJSON();
      const imported = MerkleTree.fromJSON(json);

      expect(imported.verifyProof(proof!)).toBe(true);
    });
  });

  describe('edge case: invalid indices', () => {
    it('should return undefined for negative index', () => {
      const tree = new MerkleTree(['leaf1', 'leaf2']);
      expect(tree.generateProof(-1)).toBeUndefined();
    });

    it('should return undefined for out-of-bounds index', () => {
      const tree = new MerkleTree(['leaf1', 'leaf2']);
      expect(tree.generateProof(2)).toBeUndefined();
      expect(tree.generateProof(100)).toBeUndefined();
    });

    it('should return undefined for getLeafHash with invalid index', () => {
      const tree = new MerkleTree(['leaf1']);
      expect(tree.getLeafHash(-1)).toBeUndefined();
      expect(tree.getLeafHash(1)).toBeUndefined();
    });
  });
});

describe('verifyLeafInTree', () => {
  it('should verify leaf value against tree', () => {
    const tree = new MerkleTree(['leaf1', 'leaf2', 'leaf3', 'leaf4']);
    const proof = tree.generateProof(2);

    expect(verifyLeafInTree('leaf3', proof!, tree.getRoot())).toBe(true);
  });

  it('should reject wrong leaf value', () => {
    const tree = new MerkleTree(['leaf1', 'leaf2', 'leaf3', 'leaf4']);
    const proof = tree.generateProof(2);

    expect(verifyLeafInTree('wrong', proof!, tree.getRoot())).toBe(false);
  });
});

describe('computeMerkleRoot', () => {
  it('should compute same root as MerkleTree', () => {
    const leaves = ['a', 'b', 'c', 'd', 'e'];
    const tree = new MerkleTree(leaves);
    const root = computeMerkleRoot(leaves);

    expect(root).toBe(tree.getRoot());
  });

  it('should return EMPTY_ROOT for empty input', () => {
    expect(computeMerkleRoot([])).toBe(EMPTY_ROOT);
  });
});

describe('verifyMultipleProofs', () => {
  it('should verify all valid proofs', () => {
    const tree = new MerkleTree(['a', 'b', 'c', 'd']);
    const proofs = [0, 1, 2, 3].map((i) => tree.generateProof(i)!);

    expect(verifyMultipleProofs(proofs, tree.getRoot())).toBe(true);
  });

  it('should fail if any proof is invalid', () => {
    const tree = new MerkleTree(['a', 'b', 'c', 'd']);
    const proofs = [0, 1, 2, 3].map((i) => tree.generateProof(i)!);

    // Tamper one proof
    proofs[2] = { ...proofs[2]!, leafHash: 'x'.repeat(64) };

    expect(verifyMultipleProofs(proofs, tree.getRoot())).toBe(false);
  });

  it('should pass for empty proof array', () => {
    expect(verifyMultipleProofs([], 'any_root')).toBe(true);
  });
});

describe('IncrementalMerkleTree', () => {
  describe('basic operations', () => {
    it('should start empty', () => {
      const tree = new IncrementalMerkleTree();
      expect(tree.getLeafCount()).toBe(0);
      expect(tree.getRoot()).toBe(EMPTY_ROOT);
    });

    it('should add single leaf', () => {
      const tree = new IncrementalMerkleTree();
      tree.addLeaf('leaf1');

      expect(tree.getLeafCount()).toBe(1);
      // IncrementalMerkleTree uses hashInternal even for single leaf (duplicates it)
      const leaf = hashLeaf('leaf1');
      expect(tree.getRoot()).toBe(hashInternal(leaf, leaf));
    });

    it('should add multiple leaves', () => {
      const tree = new IncrementalMerkleTree();
      tree.addLeaf('leaf1');
      tree.addLeaf('leaf2');
      tree.addLeaf('leaf3');

      expect(tree.getLeafCount()).toBe(3);
    });

    it('should return correct index on add', () => {
      const tree = new IncrementalMerkleTree();
      expect(tree.addLeaf('a')).toBe(0);
      expect(tree.addLeaf('b')).toBe(1);
      expect(tree.addLeaf('c')).toBe(2);
    });
  });

  describe('root consistency', () => {
    it('should produce same root as batch tree for 2 leaves', () => {
      const incremental = new IncrementalMerkleTree();
      incremental.addLeaf('leaf1');
      incremental.addLeaf('leaf2');

      const batch = new MerkleTree(['leaf1', 'leaf2']);

      expect(incremental.getRoot()).toBe(batch.getRoot());
    });

    it('should produce same root as batch tree for 4 leaves', () => {
      const incremental = new IncrementalMerkleTree();
      incremental.addLeaf('leaf1');
      incremental.addLeaf('leaf2');
      incremental.addLeaf('leaf3');
      incremental.addLeaf('leaf4');

      const batch = new MerkleTree(['leaf1', 'leaf2', 'leaf3', 'leaf4']);

      expect(incremental.getRoot()).toBe(batch.getRoot());
    });
  });

  describe('proof generation', () => {
    it('should generate valid proof for single leaf', () => {
      const tree = new IncrementalMerkleTree();
      tree.addLeaf('only');

      const proof = tree.generateProof(0);
      expect(proof).toBeDefined();
      expect(verifyMerkleProof(proof!)).toBe(true);
    });

    it('should generate valid proofs for multiple leaves', () => {
      const tree = new IncrementalMerkleTree();
      tree.addLeaf('leaf1');
      tree.addLeaf('leaf2');
      tree.addLeaf('leaf3');
      tree.addLeaf('leaf4');

      for (let i = 0; i < 4; i++) {
        const proof = tree.generateProof(i);
        expect(proof).toBeDefined();
        expect(verifyMerkleProof(proof!)).toBe(true);
      }
    });

    it('should return undefined for invalid index', () => {
      const tree = new IncrementalMerkleTree();
      tree.addLeaf('leaf');

      expect(tree.generateProof(-1)).toBeUndefined();
      expect(tree.generateProof(1)).toBeUndefined();
    });
  });

  describe('getLeafHashes', () => {
    it('should return all leaf hashes', () => {
      const tree = new IncrementalMerkleTree();
      tree.addLeaf('a');
      tree.addLeaf('b');
      tree.addLeaf('c');

      const hashes = tree.getLeafHashes();
      expect(hashes).toHaveLength(3);
      expect(hashes[0]).toBe(hashLeaf('a'));
      expect(hashes[1]).toBe(hashLeaf('b'));
      expect(hashes[2]).toBe(hashLeaf('c'));
    });
  });
});

describe('test vectors', () => {
  // Predefined test vectors for cross-implementation verification
  it('should match test vector 1: single leaf', () => {
    const tree = new MerkleTree(['hello']);
    // This is a known value that other implementations should match
    expect(tree.getRoot()).toBe(hashLeaf('hello'));
  });

  it('should match test vector 2: two leaves', () => {
    const tree = new MerkleTree(['hello', 'world']);
    const h1 = hashLeaf('hello');
    const h2 = hashLeaf('world');
    const expectedRoot = hashInternal(h1, h2);

    expect(tree.getRoot()).toBe(expectedRoot);
  });

  it('should match test vector 3: four leaves', () => {
    const tree = new MerkleTree(['a', 'b', 'c', 'd']);

    const ha = hashLeaf('a');
    const hb = hashLeaf('b');
    const hc = hashLeaf('c');
    const hd = hashLeaf('d');

    const hab = hashInternal(ha, hb);
    const hcd = hashInternal(hc, hd);
    const expectedRoot = hashInternal(hab, hcd);

    expect(tree.getRoot()).toBe(expectedRoot);
  });

  it('should generate consistent proofs', () => {
    const tree = new MerkleTree(['a', 'b', 'c', 'd']);
    const proof = tree.generateProof(0);

    // Proof for leaf 'a' should have siblings: [hb, hcd]
    expect(proof).toBeDefined();
    expect(proof!.leafIndex).toBe(0);
    expect(proof!.leafHash).toBe(hashLeaf('a'));
    expect(proof!.siblings).toHaveLength(2);
    expect(proof!.siblings[0]!.hash).toBe(hashLeaf('b'));
    expect(proof!.siblings[0]!.position).toBe('right');
  });
});
