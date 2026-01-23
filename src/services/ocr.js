/**
 * OCR Service - Document Text Extraction
 *
 * DEMO IMPLEMENTATION: Uses Tesseract.js for basic OCR.
 * Not suitable for production compliance workloads.
 *
 * PRODUCTION ALTERNATIVES (in order of recommendation):
 *
 * 1. AWS Textract ($1.50/1000 pages)
 *    - Best for structured documents (forms, tables)
 *    - Native AWS integration, HIPAA eligible
 *    - Supports handwriting recognition
 *    - https://aws.amazon.com/textract/
 *
 * 2. Azure AI Document Intelligence ($1.50/1000 pages)
 *    - Formerly Form Recognizer
 *    - Pre-built models for invoices, receipts, IDs
 *    - Custom model training available
 *    - https://azure.microsoft.com/en-us/products/ai-services/ai-document-intelligence
 *
 * 3. Google Document AI ($1.50/1000 pages)
 *    - Best accuracy for complex layouts
 *    - Specialized processors for lending, procurement
 *    - https://cloud.google.com/document-ai
 *
 * 4. ABBYY FineReader Server (Enterprise pricing)
 *    - Industry standard for high-volume processing
 *    - Best for legacy document digitization
 *    - On-premise deployment available
 *
 * COMPLIANCE CONSIDERATIONS:
 * - All OCR services process document content; ensure data residency requirements
 * - For SEC-regulated documents, prefer US-region processing
 * - Extracted text should be hashed and stored, not the original interpretation
 * - OCR confidence scores should be logged for audit trail
 *
 * @module services/ocr
 */

// NOTE: tesseract.js is not included in package.json
// Install with: npm install tesseract.js
// This is intentionally not installed to keep demo lightweight

/**
 * @typedef {Object} OCRResult
 * @property {string} text - Extracted text
 * @property {number} confidence - Confidence score 0-100
 * @property {string} engine - OCR engine used
 * @property {number} processingTimeMs - Processing duration
 * @property {Object} metadata - Additional extraction metadata
 */

/**
 * Extract text from image or PDF using Tesseract.js
 *
 * DEMO ONLY - Production should use cloud OCR services listed above.
 *
 * @param {Buffer|string} input - Image buffer or file path
 * @param {Object} options - OCR options
 * @param {string} [options.language='eng'] - OCR language
 * @param {boolean} [options.preserveLayout=false] - Attempt to preserve document layout
 * @returns {Promise<OCRResult>}
 */
export async function extractText(input, options = {}) {
  const startTime = Date.now();
  const { language = 'eng', preserveLayout = false } = options;

  // Check if tesseract.js is available
  let Tesseract;
  try {
    Tesseract = await import('tesseract.js');
  } catch {
    // Tesseract not installed - return placeholder response
    console.warn('[OCR] tesseract.js not installed. Install with: npm install tesseract.js');
    return {
      text: '[OCR_NOT_AVAILABLE] Install tesseract.js for demo OCR functionality',
      confidence: 0,
      engine: 'tesseract.js (not installed)',
      processingTimeMs: Date.now() - startTime,
      metadata: {
        error: 'tesseract.js not installed',
        installCommand: 'npm install tesseract.js',
        productionRecommendation: 'Use AWS Textract, Azure Document Intelligence, or Google Document AI'
      }
    };
  }

  try {
    const worker = await Tesseract.createWorker(language);

    if (preserveLayout) {
      await worker.setParameters({
        preserve_interword_spaces: '1',
      });
    }

    const { data } = await worker.recognize(input);
    await worker.terminate();

    return {
      text: data.text,
      confidence: data.confidence,
      engine: 'tesseract.js',
      processingTimeMs: Date.now() - startTime,
      metadata: {
        language,
        preserveLayout,
        words: data.words?.length || 0,
        lines: data.lines?.length || 0,
        paragraphs: data.paragraphs?.length || 0,
        warning: 'DEMO ONLY - Use production OCR service for compliance workloads'
      }
    };
  } catch (err) {
    return {
      text: '',
      confidence: 0,
      engine: 'tesseract.js',
      processingTimeMs: Date.now() - startTime,
      metadata: {
        error: err.message,
        productionRecommendation: 'Use AWS Textract, Azure Document Intelligence, or Google Document AI'
      }
    };
  }
}

/**
 * Extract text using production OCR service (placeholder)
 *
 * @param {Buffer} documentBuffer - Document content
 * @param {Object} options - Service options
 * @param {string} options.provider - 'aws' | 'azure' | 'google'
 * @param {string} options.documentType - 'general' | 'form' | 'table' | 'invoice'
 * @returns {Promise<OCRResult>}
 */
export async function extractTextProduction(documentBuffer, options = {}) {
  const { provider = 'aws', documentType = 'general' } = options;

  // Placeholder for production implementation
  // Each provider requires SDK installation and configuration:
  //
  // AWS Textract:
  //   npm install @aws-sdk/client-textract
  //   const { TextractClient, DetectDocumentTextCommand } = require('@aws-sdk/client-textract');
  //
  // Azure Document Intelligence:
  //   npm install @azure/ai-form-recognizer
  //   const { DocumentAnalysisClient } = require('@azure/ai-form-recognizer');
  //
  // Google Document AI:
  //   npm install @google-cloud/documentai
  //   const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');

  throw new Error(
    `Production OCR not configured. ` +
    `Provider: ${provider}, Document type: ${documentType}. ` +
    `Configure ${provider.toUpperCase()}_* environment variables and install SDK.`
  );
}

/**
 * Supported OCR providers and their configuration requirements
 */
export const OCR_PROVIDERS = {
  tesseract: {
    name: 'Tesseract.js',
    type: 'demo',
    install: 'npm install tesseract.js',
    config: [],
    costPer1000Pages: 0,
    accuracy: 'Low-Medium',
    speed: 'Slow',
    compliance: 'Local processing only'
  },
  aws: {
    name: 'AWS Textract',
    type: 'production',
    install: 'npm install @aws-sdk/client-textract',
    config: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
    costPer1000Pages: 1.50,
    accuracy: 'High',
    speed: 'Fast',
    compliance: 'HIPAA, SOC 2, FedRAMP'
  },
  azure: {
    name: 'Azure Document Intelligence',
    type: 'production',
    install: 'npm install @azure/ai-form-recognizer',
    config: ['AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', 'AZURE_DOCUMENT_INTELLIGENCE_KEY'],
    costPer1000Pages: 1.50,
    accuracy: 'High',
    speed: 'Fast',
    compliance: 'HIPAA, SOC 2, ISO 27001'
  },
  google: {
    name: 'Google Document AI',
    type: 'production',
    install: 'npm install @google-cloud/documentai',
    config: ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT'],
    costPer1000Pages: 1.50,
    accuracy: 'Highest',
    speed: 'Fast',
    compliance: 'HIPAA, SOC 2, ISO 27001'
  }
};
