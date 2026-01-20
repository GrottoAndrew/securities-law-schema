/**
 * Merkle Tree Implementation
 *
 * Provides cryptographic Merkle tree for efficient audit verification.
 * Supports proof generation and verification for individual leaves.
 *
 * Design decisions:
 * - Uses SHA-256 for all hashing
 * - Odd leaf count: duplicates the last leaf (standard approach)
 * - Leaf nodes are prefixed with 0x00, internal nodes with 0x01 (prevents second preimage attacks)
 * - Tree is built bottom-up and stored in array form
 */

import { createHash, timingSafeEqual } from 'node:crypto';

// =============================================================================
// Types
// =============================================================================

export interface MerkleProof {
  /** Index of the leaf being proven */
  leafIndex: number;
  /** Hash of the leaf being proven */
  leafHash: string;
  /** Sibling hashes from leaf to root, with position indicators */
  siblings: MerkleProofSibling[];
  /** Root hash this proof validates against */
  root: string;
}

export interface MerkleProofSibling {
  /** The sibling hash at this level */
  hash: string;
  /** Position of sibling: 'left' or 'right' */
  position: 'left' | 'right';
}

export interface MerkleTreeData {
  /** Number of original leaves (before any duplication) */
  leafCount: number;
  /** All nodes in the tree (leaves first, then internal nodes, root last) */
  nodes: string[];
  /** The root hash */
  root: string;
  /** Tree depth (0 = root only) */
  depth: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Prefix for leaf node hashes (prevents second preimage attacks) */
const LEAF_PREFIX = Buffer.from([0x00]);

/** Prefix for internal node hashes */
const INTERNAL_PREFIX = Buffer.from([0x01]);

/** Empty tree root (hash of empty data) */
export const EMPTY_ROOT = createHash('sha256').update(LEAF_PREFIX).digest('hex');

// =============================================================================
// Hash Functions
// =============================================================================

/**
 * Hash a leaf value.
 * Prefixed with 0x00 to distinguish from internal nodes.
 */
export function hashLeaf(data: string | Buffer): string {
  const hash = createHash('sha256');
  hash.update(LEAF_PREFIX);
  hash.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  return hash.digest('hex');
}

/**
 * Hash two child nodes to create parent.
 * Prefixed with 0x01 to distinguish from leaf nodes.
 * Children are sorted before hashing for consistency.
 */
export function hashInternal(left: string, right: string): string {
  const hash = createHash('sha256');
  hash.update(INTERNAL_PREFIX);
  // Concatenate in consistent order (left then right)
  hash.update(Buffer.from(left, 'hex'));
  hash.update(Buffer.from(right, 'hex'));
  return hash.digest('hex');
}

// =============================================================================
// MerkleTree Class
// =============================================================================

/**
 * Merkle Tree for audit checkpoint verification.
 *
 * The tree is stored as a flat array where:
 * - Indices 0 to leafCount-1 are leaf hashes
 * - Remaining indices are internal nodes
 * - Last index is the root
 *
 * For a tree with n leaves (padded to power of 2):
 * - Total nodes = 2n - 1
 * - Tree depth = log2(n)
 */
export class MerkleTree {
  private readonly leafHashes: string[];
  private readonly nodes: string[];
  private readonly leafCount: number;
  private readonly paddedLeafCount: number;
  private readonly depth: number;
  private readonly root: string;

  /**
   * Construct a Merkle tree from leaf data.
   *
   * @param leaves - Array of leaf values (strings or Buffers)
   */
  constructor(leaves: Array<string | Buffer>) {
    if (leaves.length === 0) {
      this.leafHashes = [];
      this.nodes = [];
      this.leafCount = 0;
      this.paddedLeafCount = 0;
      this.depth = 0;
      this.root = EMPTY_ROOT;
      return;
    }

    // Hash all leaves
    this.leafHashes = leaves.map((leaf) => hashLeaf(leaf));
    this.leafCount = leaves.length;

    // Pad to power of 2 by duplicating last leaf
    this.paddedLeafCount = nextPowerOfTwo(this.leafCount);
    const paddedLeaves = [...this.leafHashes];
    const lastLeaf = paddedLeaves[paddedLeaves.length - 1];
    if (lastLeaf) {
      while (paddedLeaves.length < this.paddedLeafCount) {
        paddedLeaves.push(lastLeaf);
      }
    }

    // Calculate depth
    this.depth = Math.log2(this.paddedLeafCount);

    // Build tree bottom-up
    this.nodes = this.buildTree(paddedLeaves);
    this.root = this.nodes[this.nodes.length - 1] ?? EMPTY_ROOT;
  }

  /**
   * Build tree from padded leaves.
   * Returns array of all nodes (leaves + internal + root).
   */
  private buildTree(leaves: string[]): string[] {
    if (leaves.length === 0) {
      return [];
    }

    if (leaves.length === 1) {
      return [...leaves];
    }

    const nodes: string[] = [...leaves];
    let levelStart = 0;
    let levelSize = leaves.length;

    while (levelSize > 1) {
      const nextLevelStart = nodes.length;

      for (let i = 0; i < levelSize; i += 2) {
        const left = nodes[levelStart + i];
        const right = nodes[levelStart + i + 1];
        if (left && right) {
          nodes.push(hashInternal(left, right));
        }
      }

      levelStart = nextLevelStart;
      levelSize = levelSize / 2;
    }

    return nodes;
  }

  /**
   * Get the root hash of the tree.
   */
  getRoot(): string {
    return this.root;
  }

  /**
   * Get the number of original (non-padded) leaves.
   */
  getLeafCount(): number {
    return this.leafCount;
  }

  /**
   * Get the tree depth.
   */
  getDepth(): number {
    return this.depth;
  }

  /**
   * Get a specific leaf hash by index.
   */
  getLeafHash(index: number): string | undefined {
    if (index < 0 || index >= this.leafCount) {
      return undefined;
    }
    return this.leafHashes[index];
  }

  /**
   * Get all leaf hashes.
   */
  getLeafHashes(): readonly string[] {
    return this.leafHashes;
  }

  /**
   * Generate a proof for a leaf at the given index.
   *
   * @param leafIndex - Index of the leaf to prove (0-based)
   * @returns MerkleProof or undefined if index is invalid
   */
  generateProof(leafIndex: number): MerkleProof | undefined {
    if (leafIndex < 0 || leafIndex >= this.leafCount) {
      return undefined;
    }

    if (this.leafCount === 0) {
      return undefined;
    }

    const leafHash = this.leafHashes[leafIndex];
    if (!leafHash) {
      return undefined;
    }

    // For single leaf tree
    if (this.paddedLeafCount === 1) {
      return {
        leafIndex,
        leafHash,
        siblings: [],
        root: this.root,
      };
    }

    const siblings: MerkleProofSibling[] = [];
    let currentIndex = leafIndex;
    let levelStart = 0;
    let levelSize = this.paddedLeafCount;

    while (levelSize > 1) {
      // Find sibling
      const isLeftChild = currentIndex % 2 === 0;
      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;

      const siblingHash = this.nodes[levelStart + siblingIndex];
      if (siblingHash) {
        siblings.push({
          hash: siblingHash,
          position: isLeftChild ? 'right' : 'left',
        });
      }

      // Move to parent level
      currentIndex = Math.floor(currentIndex / 2);
      levelStart += levelSize;
      levelSize = levelSize / 2;
    }

    return {
      leafIndex,
      leafHash,
      siblings,
      root: this.root,
    };
  }

  /**
   * Verify a proof against this tree's root.
   */
  verifyProof(proof: MerkleProof): boolean {
    return verifyMerkleProof(proof, this.root);
  }

  /**
   * Export tree data for serialization.
   */
  toJSON(): MerkleTreeData {
    return {
      leafCount: this.leafCount,
      nodes: [...this.nodes],
      root: this.root,
      depth: this.depth,
    };
  }

  /**
   * Reconstruct tree from serialized data.
   */
  static fromJSON(data: MerkleTreeData): MerkleTree {
    const tree = Object.create(MerkleTree.prototype) as MerkleTree;

    // Use Object.defineProperty to set readonly properties
    Object.defineProperty(tree, 'leafCount', { value: data.leafCount, writable: false });
    Object.defineProperty(tree, 'paddedLeafCount', {
      value: nextPowerOfTwo(data.leafCount),
      writable: false,
    });
    Object.defineProperty(tree, 'depth', { value: data.depth, writable: false });
    Object.defineProperty(tree, 'nodes', { value: [...data.nodes], writable: false });
    Object.defineProperty(tree, 'root', { value: data.root, writable: false });

    // Extract leaf hashes from nodes
    const leafHashes = data.nodes.slice(0, data.leafCount);
    Object.defineProperty(tree, 'leafHashes', { value: leafHashes, writable: false });

    return tree;
  }
}

// =============================================================================
// Proof Verification (Standalone)
// =============================================================================

/**
 * Verify a Merkle proof against an expected root.
 *
 * This function can be used independently of the MerkleTree class,
 * e.g., by a verifier who only has the proof and root.
 *
 * @param proof - The proof to verify
 * @param expectedRoot - The expected root hash (optional, uses proof.root if not provided)
 */
export function verifyMerkleProof(proof: MerkleProof, expectedRoot?: string): boolean {
  const root = expectedRoot ?? proof.root;

  // Empty proof for single-leaf tree
  if (proof.siblings.length === 0) {
    return timingSafeCompare(proof.leafHash, root);
  }

  let currentHash = proof.leafHash;

  for (const sibling of proof.siblings) {
    if (sibling.position === 'left') {
      currentHash = hashInternal(sibling.hash, currentHash);
    } else {
      currentHash = hashInternal(currentHash, sibling.hash);
    }
  }

  return timingSafeCompare(currentHash, root);
}

/**
 * Verify that a leaf value is in a tree with the given root.
 *
 * @param leafValue - The original leaf value (not hashed)
 * @param proof - The proof for this leaf
 * @param expectedRoot - The expected root hash
 */
export function verifyLeafInTree(
  leafValue: string | Buffer,
  proof: MerkleProof,
  expectedRoot: string
): boolean {
  const leafHash = hashLeaf(leafValue);

  if (!timingSafeCompare(leafHash, proof.leafHash)) {
    return false;
  }

  return verifyMerkleProof(proof, expectedRoot);
}

// =============================================================================
// Incremental Tree Updates
// =============================================================================

/**
 * Merkle tree that supports incremental leaf additions.
 *
 * Uses a more complex data structure to efficiently handle additions
 * without rebuilding the entire tree.
 */
export class IncrementalMerkleTree {
  private leaves: string[] = [];
  private levels: string[][] = [];

  constructor() {
    this.levels = [];
  }

  /**
   * Add a new leaf to the tree.
   *
   * @param leafData - The leaf value to add
   * @returns The new leaf's index
   */
  addLeaf(leafData: string | Buffer): number {
    const leafHash = hashLeaf(leafData);
    const leafIndex = this.leaves.length;
    this.leaves.push(leafHash);

    // Update tree structure
    this.updateTree(leafIndex, leafHash);

    return leafIndex;
  }

  /**
   * Update tree after adding a leaf.
   */
  private updateTree(index: number, hash: string): void {
    let currentIndex = index;
    let currentHash = hash;
    let level = 0;

    while (true) {
      // Ensure level exists
      if (this.levels.length <= level) {
        this.levels.push([]);
      }

      const currentLevel = this.levels[level];
      if (!currentLevel) break;

      // Set or update node at current position
      currentLevel[currentIndex] = currentHash;

      // If this is a right child, compute parent with left sibling
      if (currentIndex % 2 === 1) {
        const leftSibling = currentLevel[currentIndex - 1];
        if (leftSibling) {
          currentHash = hashInternal(leftSibling, currentHash);
        }
      } else {
        // Left child - if right sibling exists, compute parent
        // Otherwise, duplicate self (will be overwritten if sibling added later)
        const rightSibling = currentLevel[currentIndex + 1];
        currentHash = hashInternal(currentHash, rightSibling ?? currentHash);
      }

      // Move to parent
      currentIndex = Math.floor(currentIndex / 2);
      level++;

      // Stop if we're at the root level
      if (currentIndex === 0 && (this.levels[level]?.length ?? 0) <= 1) {
        if (this.levels.length <= level) {
          this.levels.push([]);
        }
        const rootLevel = this.levels[level];
        if (rootLevel) {
          rootLevel[0] = currentHash;
        }
        break;
      }
    }
  }

  /**
   * Get the current root hash.
   */
  getRoot(): string {
    if (this.leaves.length === 0) {
      return EMPTY_ROOT;
    }

    // Root is at the top level, index 0
    const topLevel = this.levels[this.levels.length - 1];
    return topLevel?.[0] ?? EMPTY_ROOT;
  }

  /**
   * Get the number of leaves.
   */
  getLeafCount(): number {
    return this.leaves.length;
  }

  /**
   * Get all leaf hashes.
   */
  getLeafHashes(): readonly string[] {
    return this.leaves;
  }

  /**
   * Generate proof for a leaf.
   */
  generateProof(leafIndex: number): MerkleProof | undefined {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      return undefined;
    }

    const leafHash = this.leaves[leafIndex];
    if (!leafHash) {
      return undefined;
    }

    if (this.leaves.length === 1) {
      // Single leaf tree: root = hashInternal(leafHash, leafHash)
      // Proof needs sibling (itself) to verify correctly
      return {
        leafIndex,
        leafHash,
        siblings: [{ hash: leafHash, position: 'right' as const }],
        root: this.getRoot(),
      };
    }

    const siblings: MerkleProofSibling[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.levels.length - 1; level++) {
      const currentLevel = this.levels[level];
      if (!currentLevel) break;

      const isLeftChild = currentIndex % 2 === 0;
      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;

      // Handle edge case where sibling doesn't exist (odd leaf count)
      let siblingHash = currentLevel[siblingIndex];
      if (!siblingHash) {
        // Use current node as sibling (duplicated)
        siblingHash = currentLevel[currentIndex];
      }

      if (siblingHash) {
        siblings.push({
          hash: siblingHash,
          position: isLeftChild ? 'right' : 'left',
        });
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      leafIndex,
      leafHash,
      siblings,
      root: this.getRoot(),
    };
  }

  /**
   * Convert to standard MerkleTree for verification.
   */
  toMerkleTree(): MerkleTree {
    // Reconstruct by building from leaves
    const leafData = this.leaves.map((hash) => Buffer.from(hash, 'hex'));
    // Note: this creates leaf hashes from already-hashed data, which is not ideal
    // For proper implementation, we'd need to store original leaf data
    // This is a limitation of the incremental structure
    return new MerkleTree(leafData);
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate the next power of 2 >= n.
 */
function nextPowerOfTwo(n: number): number {
  if (n <= 0) return 1;
  if (n && !(n & (n - 1))) return n; // Already power of 2
  let power = 1;
  while (power < n) {
    power *= 2;
  }
  return power;
}

/**
 * Timing-safe string comparison.
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return timingSafeEqual(bufA, bufB);
}

/**
 * Compute Merkle root directly from leaf values.
 * Utility function when only the root is needed.
 */
export function computeMerkleRoot(leaves: Array<string | Buffer>): string {
  const tree = new MerkleTree(leaves);
  return tree.getRoot();
}

/**
 * Verify multiple proofs against a root efficiently.
 */
export function verifyMultipleProofs(proofs: MerkleProof[], expectedRoot: string): boolean {
  for (const proof of proofs) {
    if (!verifyMerkleProof(proof, expectedRoot)) {
      return false;
    }
  }
  return true;
}
