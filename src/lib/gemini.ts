// Gemini AI Integration
// Using Google Gemini for better reasoning capabilities

/**
 * Comprehensive JSON sanitization utility
 * Fixes all common JSON parsing errors from LLM responses
 */
function sanitizeJsonString(jsonString: string): string {
  // Step 1: Remove markdown code blocks - AGGRESSIVE
  let cleaned = jsonString
    .replace(/```json/gi, '')
    .replace(/```javascript/gi, '')
    .replace(/```js/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*json\s*/gi, '')
    .trim();

  // Step 2: Remove ALL actual control characters (not escaped ones)
  // This includes \x00-\x1F and \x7F (DEL)
  // But we must preserve escaped sequences like \\n, \\t, etc.

  // First, temporarily protect already-escaped sequences
  const escapeProtector = '___ESCAPE___';
  cleaned = cleaned
    .replace(/\\n/g, escapeProtector + 'n')
    .replace(/\\r/g, escapeProtector + 'r')
    .replace(/\\t/g, escapeProtector + 't')
    .replace(/\\f/g, escapeProtector + 'f')
    .replace(/\\b/g, escapeProtector + 'b')
    .replace(/\\"/g, escapeProtector + 'quote')
    .replace(/\\\\/g, escapeProtector + 'backslash');

  // Now remove/replace actual control characters
  cleaned = cleaned.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, ' ');

  // Handle actual newlines, tabs, and carriage returns by replacing with space
  cleaned = cleaned
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\t/g, ' ');

  // Restore protected escape sequences
  cleaned = cleaned
    .replace(new RegExp(escapeProtector + 'n', 'g'), '\\n')
    .replace(new RegExp(escapeProtector + 'r', 'g'), '\\r')
    .replace(new RegExp(escapeProtector + 't', 'g'), '\\t')
    .replace(new RegExp(escapeProtector + 'f', 'g'), '\\f')
    .replace(new RegExp(escapeProtector + 'b', 'g'), '\\b')
    .replace(new RegExp(escapeProtector + 'quote', 'g'), '\\"')
    .replace(new RegExp(escapeProtector + 'backslash', 'g'), '\\\\');

  // Step 3: Fix smart quotes and similar characters
  cleaned = cleaned
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/…/g, '...');

  // Step 4: Fix Unicode escape sequences - NUCLEAR OPTION
  // Valid Unicode escapes: \uXXXX where XXXX is exactly 4 hex digits
  // Everything else gets removed completely

  // First, protect valid Unicode sequences temporarily
  const validUnicodePattern = /\\u[0-9a-fA-F]{4}/g;
  const validUnicodes: string[] = [];
  cleaned = cleaned.replace(validUnicodePattern, (match) => {
    const index = validUnicodes.length;
    validUnicodes.push(match);
    return `___VALID_UNICODE_${index}___`;
  });

  // Now remove ALL remaining \u patterns (they're all invalid)
  cleaned = cleaned.replace(/\\u[^_]/g, 'u');
  cleaned = cleaned.replace(/\\u$/g, 'u');

  // Restore valid Unicode sequences
  validUnicodes.forEach((unicode, index) => {
    cleaned = cleaned.replace(`___VALID_UNICODE_${index}___`, unicode);
  });

  // Step 5: Remove trailing commas before closing brackets
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

  // Step 6: Normalize multiple spaces to single space
  cleaned = cleaned.replace(/\s+/g, ' ');

  // Step 7: Fix common broken escape sequences
  // Remove invalid escape sequences that aren't valid JSON
  // Valid JSON escapes: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
  cleaned = cleaned.replace(/\\([^"\\\/bfnrtu])/g, '$1');

  // Step 8: Final safety - remove any remaining problematic patterns
  cleaned = cleaned
    .replace(/\\x[0-9a-fA-F]{0,2}/g, '') // Remove hex escapes
    .replace(/\\[0-7]{1,3}/g, '') // Remove octal escapes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remove remaining control chars

  return cleaned;
}

/**
 * Robust JSON parser with multiple fallback strategies
 * Returns parsed object or throws detailed error
 */
function parseJsonRobust(response: string, expectedType: 'array' | 'object' = 'array'): any {
  const strategies = [
    // Strategy 1: Direct extraction and sanitization
    () => {
      const pattern = expectedType === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
      const match = response.match(pattern);
      if (!match) throw new Error('No JSON found in response');
      return JSON.parse(sanitizeJsonString(match[0]));
    },

    // Strategy 2: Remove everything before first bracket
    () => {
      const startChar = expectedType === 'array' ? '[' : '{';
      const startIdx = response.indexOf(startChar);
      if (startIdx === -1) throw new Error('No opening bracket found');
      const substring = response.substring(startIdx);
      return JSON.parse(sanitizeJsonString(substring));
    },

    // Strategy 3: Extract between first and last matching brackets
    () => {
      const [openChar, closeChar] = expectedType === 'array' ? ['[', ']'] : ['{', '}'];
      const firstIdx = response.indexOf(openChar);
      const lastIdx = response.lastIndexOf(closeChar);
      if (firstIdx === -1 || lastIdx === -1 || lastIdx <= firstIdx) {
        throw new Error('Invalid bracket positions');
      }
      const substring = response.substring(firstIdx, lastIdx + 1);
      return JSON.parse(sanitizeJsonString(substring));
    },

    // Strategy 4: Ultra-aggressive cleaning with markdown removal
    () => {
      let cleaned = response
        .replace(/```json/gi, '')
        .replace(/```javascript/gi, '')
        .replace(/```js/gi, '')
        .replace(/```/g, '')
        .replace(/^json\\s*/gi, '')
        .trim();

      // Protect valid escape sequences
      const escapeMap: Record<string, string> = {
        '\\n': '___NEWLINE___',
        '\\r': '___RETURN___',
        '\\t': '___TAB___',
        '\\"': '___QUOTE___',
        '\\\\': '___BACKSLASH___',
        '\\f': '___FORMFEED___',
        '\\b': '___BACKSPACE___'
      };

      for (const [escaped, placeholder] of Object.entries(escapeMap)) {
        cleaned = cleaned.split(escaped).join(placeholder);
      }

      // Remove ALL control characters and problematic chars
      cleaned = cleaned.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ');

      // Restore escape sequences
      for (const [escaped, placeholder] of Object.entries(escapeMap)) {
        cleaned = cleaned.split(placeholder).join(escaped);
      }

      // Replace smart quotes
      cleaned = cleaned
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/…/g, '...');

      // Normalize whitespace
      cleaned = cleaned.replace(/\s+/g, ' ');

      const pattern = expectedType === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
      const match = cleaned.match(pattern);
      if (!match) throw new Error('No JSON after aggressive cleaning');

      return JSON.parse(match[0]);
    },

    // Strategy 5: Nuclear option - rebuild JSON byte by byte
    () => {
      const [openChar, closeChar] = expectedType === 'array' ? ['[', ']'] : ['{', '}'];
      const firstIdx = response.indexOf(openChar);
      const lastIdx = response.lastIndexOf(closeChar);

      if (firstIdx === -1 || lastIdx === -1) {
        throw new Error('Cannot find JSON boundaries');
      }

      let str = response.substring(firstIdx, lastIdx + 1);

      // Step 1: Protect all already-escaped sequences
      const protectionMap = new Map<string, string>();
      let protectionCounter = 0;

      // Protect \" sequences
      str = str.replace(/\\"/g, () => {
        const placeholder = `___PROTECTED_${protectionCounter++}___`;
        protectionMap.set(placeholder, '\\"');
        return placeholder;
      });

      // Protect \\ sequences
      str = str.replace(/\\\\/g, () => {
        const placeholder = `___PROTECTED_${protectionCounter++}___`;
        protectionMap.set(placeholder, '\\\\');
        return placeholder;
      });

      // Protect other escape sequences
      ['\\n', '\\r', '\\t', '\\f', '\\b'].forEach(seq => {
        str = str.replace(new RegExp(seq.replace('\\', '\\\\'), 'g'), () => {
          const placeholder = `___PROTECTED_${protectionCounter++}___`;
          protectionMap.set(placeholder, seq);
          return placeholder;
        });
      });

      // Step 2: Remove all control characters and bad chars
      str = str.replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, ' ');

      // Step 3: Clean up formatting
      str = str
        .replace(/\s+/g, ' ')                // Normalize whitespace
        .replace(/,\s*([}\]])/g, '$1')       // Remove trailing commas
        .replace(/"\s+:/g, '":')             // Fix spacing around colons
        .replace(/:\s+"/g, ':"')             // Fix spacing after colons
        .replace(/,\s+"/g, ',"')             // Fix spacing after commas
        .replace(/{\s+"/g, '{"')             // Fix spacing after opening brace
        .replace(/\[\s+/g, '[')              // Fix spacing after opening bracket
        .replace(/\s+\]/g, ']')              // Fix spacing before closing bracket
        .replace(/\s+}/g, '}');              // Fix spacing before closing brace

      // Step 4: Restore protected sequences
      protectionMap.forEach((original, placeholder) => {
        str = str.split(placeholder).join(original);
      });

      return JSON.parse(str);
    },

    // Strategy 6: Smart extraction with bracket balancing
    () => {
      const [openChar, closeChar] = expectedType === 'array' ? ['[', ']'] : ['{', '}'];

      // Find the first opening bracket
      let startIdx = response.indexOf(openChar);
      if (startIdx === -1) throw new Error('No opening bracket found');

      // Balance brackets to find the matching closing bracket
      let depth = 0;
      let endIdx = -1;

      for (let i = startIdx; i < response.length; i++) {
        if (response[i] === openChar) depth++;
        if (response[i] === closeChar) depth--;

        if (depth === 0) {
          endIdx = i;
          break;
        }
      }

      if (endIdx === -1) throw new Error('No matching closing bracket found');

      let jsonStr = response.substring(startIdx, endIdx + 1);

      // Apply sanitization
      jsonStr = sanitizeJsonString(jsonStr);

      return JSON.parse(jsonStr);
    }
  ];

  const errors: string[] = [];

  for (let i = 0; i < strategies.length; i++) {
    try {
      console.log(`Trying JSON parse strategy ${i + 1}/${strategies.length}`);
      const result = strategies[i]();
      console.log(`✓ Strategy ${i + 1} succeeded`);
      return result;
    } catch (error) {
      errors.push(`Strategy ${i + 1}: ${error.message}`);
      console.log(`✗ Strategy ${i + 1} failed: ${error.message}`);
    }
  }

  // All strategies failed
  console.error('All JSON parsing strategies failed:', errors);
  console.error('Raw response (first 2000 chars):', response.slice(0, 2000));
  console.error('Raw response (last 500 chars):', response.slice(-500));

  // Try to identify the specific issue for better error reporting
  let errorSummary = 'Unknown JSON parsing error';
  const responsePreview = response.slice(0, 100);

  if (response.includes('```json') || response.includes('```')) {
    errorSummary = 'Response contains markdown code blocks';
  } else if (/[\x00-\x1F]/.test(response)) {
    errorSummary = 'Response contains control characters';
  } else if (!response.includes(expectedType === 'array' ? '[' : '{')) {
    errorSummary = `No ${expectedType === 'array' ? 'array' : 'object'} bracket found in response`;
  } else if (responsePreview.includes('\\b') || responsePreview.includes('\\f')) {
    errorSummary = 'Response contains invalid escape sequences';
  } else {
    errorSummary = 'Malformed JSON structure';
  }

  throw new Error(`Failed to parse JSON after ${strategies.length} attempts. Issue: ${errorSummary}. First error: ${errors[0]}`);
}

export interface ExtractedQuestion {
  question_statement: string;
  question_type: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective';
  options?: string[];
  answer?: string;
  solution?: string;
  question_number?: string;
  page_number?: number;
  has_image?: boolean;
  image_description?: string;
  is_continuation?: boolean;
  spans_multiple_pages?: boolean;
  uploaded_image?: string;
  topic_id?: string;
}

// Gemini API Keys - Smart Round Robin System with Error Tracking
interface ApiKeyState {
  key: string;
  usageCount: number;
  errorCount: number;
  lastError: string | null;
  lastUsedAt: number | null;
  isActive: boolean;
}

let API_KEY_STATES: ApiKeyState[] = [];
let currentKeyIndex = 0;

// Set API keys from user input with validation
export function setGeminiApiKeys(keys: string[]) {
  const validKeys = keys.filter(key => key.trim() !== '');

  // Checkpoint: Validate API keys are set
  if (validKeys.length === 0) {
    console.error('CHECKPOINT FAILED: No valid API keys provided');
    throw new Error('No valid API keys provided');
  }

  // Initialize API key states
  API_KEY_STATES = validKeys.map(key => ({
    key: key.trim(),
    usageCount: 0,
    errorCount: 0,
    lastError: null,
    lastUsedAt: null,
    isActive: true
  }));

  currentKeyIndex = 0;
  console.log(`CHECKPOINT PASSED: ${API_KEY_STATES.length} API key(s) configured successfully`);
}

// Get next API key in round-robin fashion, skipping recently errored keys
function getNextGeminiKey(): { key: string; index: number } {
  // Checkpoint: Validate API keys exist
  if (API_KEY_STATES.length === 0) {
    console.error('CHECKPOINT FAILED: No Gemini API keys configured');
    throw new Error('No Gemini API keys configured. Please add API keys first.');
  }

  // Find next active key
  let attempts = 0;
  let selectedIndex = currentKeyIndex;

  while (attempts < API_KEY_STATES.length) {
    const keyState = API_KEY_STATES[selectedIndex];

    if (keyState.isActive) {
      // Update usage tracking
      keyState.usageCount++;
      keyState.lastUsedAt = Date.now();

      // Move to next key for round-robin
      currentKeyIndex = (selectedIndex + 1) % API_KEY_STATES.length;

      console.log(`CHECKPOINT PASSED: Using API key ${selectedIndex + 1}/${API_KEY_STATES.length} (used ${keyState.usageCount} times)`);
      return { key: keyState.key, index: selectedIndex };
    }

    // Try next key
    selectedIndex = (selectedIndex + 1) % API_KEY_STATES.length;
    attempts++;
  }

  // All keys are inactive, reset all and try again
  console.warn('All API keys marked as inactive, resetting...');
  API_KEY_STATES.forEach(state => {
    state.isActive = true;
    state.errorCount = 0;
  });

  return getNextGeminiKey();
}

// Mark API key as errored
function markKeyError(keyIndex: number, errorMessage: string) {
  if (keyIndex >= 0 && keyIndex < API_KEY_STATES.length) {
    const keyState = API_KEY_STATES[keyIndex];
    keyState.errorCount++;
    keyState.lastError = errorMessage;

    // Deactivate key after 3 consecutive errors
    if (keyState.errorCount >= 3) {
      keyState.isActive = false;
      console.warn(`API key ${keyIndex + 1} deactivated after ${keyState.errorCount} consecutive errors`);
    }

    console.log(`API key ${keyIndex + 1} error count: ${keyState.errorCount}`);
  }
}

// Reset error count for successful API call
function markKeySuccess(keyIndex: number) {
  if (keyIndex >= 0 && keyIndex < API_KEY_STATES.length) {
    API_KEY_STATES[keyIndex].errorCount = 0;
    API_KEY_STATES[keyIndex].lastError = null;
  }
}

// Get API key statistics
export function getApiKeyStats() {
  return API_KEY_STATES.map((state, index) => ({
    index: index + 1,
    usageCount: state.usageCount,
    errorCount: state.errorCount,
    lastError: state.lastError,
    isActive: state.isActive,
    lastUsedAt: state.lastUsedAt ? new Date(state.lastUsedAt).toLocaleString() : 'Never'
  }));
}

// Gemini API call function with smart retry logic and automatic key switching
async function callGeminiAPI(prompt: string, imageBase64?: string, temperature: number = 0.1, maxTokens: number = 4000): Promise<string> {
  const maxTotalRetries = API_KEY_STATES.length * 3; // Try each key up to 3 times
  let attemptCount = 0;

  // Checkpoint: Validate prompt
  if (!prompt || prompt.trim() === '') {
    console.error('CHECKPOINT FAILED: Empty prompt provided');
    throw new Error('Prompt cannot be empty');
  }

  console.log('CHECKPOINT PASSED: Starting Gemini API call', {
    promptLength: prompt.length,
    hasImage: !!imageBase64,
    temperature,
    maxTokens,
    availableKeys: API_KEY_STATES.length
  });

  while (attemptCount < maxTotalRetries) {
    attemptCount++;

    // Get next API key
    const { key: apiKey, index: keyIndex } = getNextGeminiKey();

    try {
      const requestBody: any = {
        contents: [{
          parts: []
        }],
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: maxTokens,
        }
      };

      // Add text prompt
      requestBody.contents[0].parts.push({
        text: prompt
      });

      // Add image if provided
      if (imageBase64) {
        const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        requestBody.contents[0].parts.push({
          inline_data: {
            mime_type: "image/png",
            data: base64Data
          }
        });
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = errorText;

        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorText;
        } catch (e) {
          // If parsing fails, use raw error text
        }

        console.error(`API call failed with key ${keyIndex + 1}`, {
          status: response.status,
          errorMessage,
          attempt: attemptCount
        });

        // Mark this key as errored
        markKeyError(keyIndex, errorMessage);

        // Check if this is a 403 error (unregistered callers)
        if (response.status === 403 && errorMessage.includes('unregistered callers')) {
          console.warn(`Key ${keyIndex + 1} failed with 403 error. Switching to next key after 10s delay...`);
          await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second delay
          continue; // Try next key
        }

        // Handle invalid API key (400)
        if (response.status === 400 && errorMessage.includes('API key not valid')) {
          console.warn(`Key ${keyIndex + 1} is invalid. Switching to next key...`);
          continue; // Try next key immediately
        }

        // Handle rate limiting (429) or server errors (5xx)
        if (response.status === 429 || response.status >= 500) {
          console.warn(`Key ${keyIndex + 1} hit rate limit or server error. Waiting 10s before trying next key...`);
          await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second delay
          continue; // Try next key
        }

        // For other errors, wait and try next key
        console.warn(`Key ${keyIndex + 1} encountered error ${response.status}. Waiting 10s before trying next key...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }

      console.log('CHECKPOINT PASSED: Gemini API response received successfully');

      const data = await response.json();

      // Checkpoint: Validate response structure
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        console.error('CHECKPOINT FAILED: Invalid response structure', { data });

        // Handle content safety blocks
        if (data.promptFeedback?.blockReason) {
          throw new Error(`Content blocked by Gemini: ${data.promptFeedback.blockReason}`);
        }

        // Try next key after delay
        console.warn('Invalid response structure. Trying next key after 10s...');
        markKeyError(keyIndex, 'Invalid response structure');
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }

      // Checkpoint: Validate text content exists
      if (!data.candidates[0].content.parts || !data.candidates[0].content.parts[0]?.text) {
        console.error('CHECKPOINT FAILED: No text content in response');
        console.warn('No text content in response. Trying next key after 10s...');
        markKeyError(keyIndex, 'No text content in response');
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }

      const responseText = data.candidates[0].content.parts[0].text;
      console.log('CHECKPOINT PASSED: Valid response text received', {
        textLength: responseText.length
      });

      // Mark key as successful
      markKeySuccess(keyIndex);

      return responseText;

    } catch (error) {
      console.error(`CHECKPOINT FAILED: API call exception with key ${keyIndex + 1}`, error);
      markKeyError(keyIndex, error.message);

      // Wait 10 seconds before trying next key
      if (attemptCount < maxTotalRetries) {
        console.log(`Waiting 10 seconds before trying next key... (attempt ${attemptCount}/${maxTotalRetries})`);
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  // All attempts exhausted
  throw new Error(`Failed to generate content after ${attemptCount} attempts across all API keys. Please check your API keys and try again.`);
}

// Convert PDF to images using PDF.js
export async function convertPdfToImages(file: File): Promise<string[]> {
  const pdfjsLib = await import('pdfjs-dist');
  
  // Set worker source
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: string[] = [];
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const scale = 2.0; // Higher scale for better quality
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;
    
    const imageDataUrl = canvas.toDataURL('image/png');
    images.push(imageDataUrl);
  }
  
  return images;
}

// Extract questions from PDF page using Gemini
export async function performExtraction(
  imageBase64: string, 
  pageNumber: number, 
  previousContext: string = '',
  pageMemory: Map<number, string> = new Map()
): Promise<ExtractedQuestion[]> {
  
  const contextInfo = previousContext ? `\n\nPrevious page context: ${previousContext.slice(-500)}` : '';
  const memoryInfo = pageMemory.size > 0 ? 
    `\n\nPage memory: ${Array.from(pageMemory.entries()).map(([p, content]) => `Page ${p}: ${content.slice(0, 200)}`).join('\n')}` : '';

  const prompt = `You are an expert at extracting questions from academic exam papers. Analyze this page image and extract ALL questions with perfect accuracy.

CRITICAL INSTRUCTIONS:
1. Extract EVERY question from this page, no matter how small or partial
2. For each question, determine the correct question type: MCQ, MSQ, NAT, or Subjective
3. Extract all options exactly as written (including mathematical notation)
4. DO NOT guess answers - only extract if clearly visible
5. Handle multi-page questions by noting continuation
6. Preserve all mathematical expressions, formulas, and special notation

Question Type Guidelines:
- MCQ: Single correct answer from multiple options
- MSQ: Multiple correct answers possible from options  
- NAT: Numerical answer type (no options, answer is a number)
- Subjective: Descriptive/essay type questions

${contextInfo}${memoryInfo}

Return a JSON array of questions in this exact format:
[
  {
    "question_statement": "Complete question text with all mathematical notation",
    "question_type": "MCQ|MSQ|NAT|Subjective",
    "options": ["Option A text", "Option B text", ...] or null for NAT/Subjective,
    "question_number": "Question number if visible",
    "has_image": true/false,
    "image_description": "Description of any diagrams/figures",
    "is_continuation": true/false,
    "spans_multiple_pages": true/false
  }
]

If no questions are found, return an empty array [].
Focus on accuracy and completeness. Extract everything visible.`;

  try {
    const response = await callGeminiAPI(prompt, imageBase64, 0.1, 4000);
    
    // Store page content in memory
    pageMemory.set(pageNumber, response.slice(0, 1000));
    
    // Parse JSON response using robust parser
    let questions: ExtractedQuestion[] = [];
    try {
      questions = parseJsonRobust(response, 'array') as ExtractedQuestion[];
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      return [];
    }

    // Add page number to each question
    questions = questions.map(q => ({
      ...q,
      page_number: pageNumber
    }));

    console.log(`Extracted ${questions.length} questions from page ${pageNumber}`);
    return questions;

  } catch (error) {
    console.error(`Error extracting questions from page ${pageNumber}:`, error);
    throw new Error(`Failed to extract questions from page ${pageNumber}: ${error.message}`);
  }
}

// Generate new questions for a topic using Gemini
export async function generateQuestionsForTopic(
  topic: any,
  examName: string,
  courseName: string,
  questionType: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective',
  pyqs: any[],
  existingQuestionsContext: string,
  recentQuestions: string[],
  count: number = 1,
  topicNotes: string = ''
): Promise<ExtractedQuestion[]> {

  const pyqContext = pyqs.length > 0 ?
    `\n\nPREVIOUS YEAR QUESTIONS FOR INSPIRATION (Study these patterns carefully):\n${pyqs.map((q, i) =>
      `\nPYQ ${i+1} (${q.year} - ${q.slot || 'N/A'}):\nQuestion: ${q.question_statement}${q.options ? `\nOptions: ${q.options.join(', ')}` : ''}${q.answer ? `\nAnswer: ${q.answer}` : ''}${q.solution ? `\nSolution Approach: ${q.solution.slice(0, 200)}` : ''}`
    ).join('\n')}` : '';

  const existingContext = existingQuestionsContext ?
    `\n\nALREADY GENERATED QUESTIONS (Avoid duplication, create fresh questions):\n${existingQuestionsContext.slice(-1500)}` : '';

  const recentContext = recentQuestions.length > 0 ?
    `\n\nRECENTLY GENERATED (Must be different from these):\n${recentQuestions.slice(-3).join('\n')}` : '';

  const notesContext = topicNotes ?
    `\n\nTOPIC NOTES (Use these methods/concepts for the solution):\n${topicNotes.slice(0, 2000)}` : '';

  const prompt = `You are a professor creating ${examName} - ${courseName} questions. Generate ${count} unique ${questionType} question(s) for: "${topic.name}".

TOPIC INFORMATION:
- Topic: ${topic.name}
- Weightage: ${((topic.weightage || 0.02) * 100).toFixed(1)}%
${notesContext}
${pyqContext}
${existingContext}
${recentContext}

YOUR TASK:
1. Study the Previous Year Questions (PYQs) carefully - understand the pattern, difficulty level, and style
2. Create a NEW question that follows the same pattern but is completely fresh (DO NOT COPY)
3. When generating the solution, strictly use the methods/concepts from the Topic Notes
4. Ensure the question tests deep conceptual understanding

CRITICAL REQUIREMENTS for ${questionType} questions:

${questionType === 'MCQ' ? `
MCQ Requirements:
- Create exactly 4 options (A, B, C, D)
- EXACTLY ONE option must be correct
- Other 3 options must be plausible but incorrect
- Question must test conceptual understanding
- Provide clear, unambiguous correct answer
` : ''}

${questionType === 'MSQ' ? `
MSQ Requirements:
- Create exactly 4 options (A, B, C, D)
- 2-3 options should be correct (never just 1 or all 4)
- Incorrect options must be plausible distractors
- Question should test multiple concepts
- Clearly identify all correct options
` : ''}

${questionType === 'NAT' ? `
NAT Requirements:
- Question must have a numerical answer
- Answer should be a specific number (integer or decimal)
- No options needed
- Include proper units if applicable
- Ensure answer is calculable and unique
` : ''}

${questionType === 'Subjective' ? `
Subjective Requirements:
- Create comprehensive descriptive question
- Should test deep understanding
- Include multiple parts if appropriate
- Provide detailed solution approach
- No options needed
` : ''}

QUALITY STANDARDS:
1. Questions must be 100% original - inspired by PYQs but never duplicates
2. Use proper academic terminology and mathematical notation
3. Solutions MUST use methods from Topic Notes (not alternative approaches)
4. Match the ${examName} difficulty level and exam pattern
5. Write like a professor, not like AI (natural, clear, educational)
6. Avoid repetitive patterns - each question should feel unique
7. If you get stuck on a solution, try a different approach rather than continuing with errors

IMPORTANT: Avoid infinite loops in solution generation. If a solution has mistakes:
- Don't keep trying the same failed approach
- Verify your answer is mathematically/logically correct
- Use a completely different method if needed
- Double-check all calculations before finalizing

ABSOLUTE JSON REQUIREMENTS (NON-NEGOTIABLE):
1. Return ONLY the JSON array - NOTHING before or after
2. NEVER use markdown code blocks (no \`\`\`json, no \`\`\`, no code fences)
3. NEVER include actual line breaks in string values (use spaces instead)
4. NEVER use control characters (\\n, \\r, \\t, etc.) inside strings
5. NEVER use smart quotes (""), always use straight quotes (")
6. NEVER use Unicode escape sequences (\\uXXXX)
7. NEVER use hex escapes (\\xXX) or octal escapes (\\nnn)
8. Keep all text as ONE continuous line - use periods to separate steps
9. Start output directly with [ and end with ] - nothing else

CORRECT JSON FORMAT:
[{"question_statement":"What is X?","question_type":"${questionType}",${questionType === 'MCQ' || questionType === 'MSQ' ? '"options":["Option A","Option B","Option C","Option D"],' : '"options":null,'}"answer":"${questionType === 'MCQ' ? 'A' : questionType === 'MSQ' ? 'A, C' : questionType === 'NAT' ? '42.5' : 'Detailed answer'}","solution":"Step 1. Do X. Step 2. Calculate Y. Step 3. Conclude Z."}]

INCORRECT (will cause errors):
\`\`\`json
[...]
\`\`\`

Generate exactly ${count} question(s). Output only pure JSON. No markdown, no line breaks in strings.`;

  try {
    console.log('CHECKPOINT: Starting question generation for topic', {
      topicName: topic.name,
      questionType,
      count,
      hasPYQs: pyqs.length > 0,
      hasNotes: !!topicNotes
    });

    const response = await callGeminiAPI(prompt, undefined, 0.3, 3000);

    // Checkpoint: Validate response received
    if (!response || response.trim() === '') {
      console.error('CHECKPOINT FAILED: Empty response from Gemini');
      throw new Error('Empty response from Gemini API');
    }

    console.log('CHECKPOINT PASSED: Response received', { responseLength: response.length });

    // Parse JSON response using robust parser
    let questions: ExtractedQuestion[] = [];
    try {
      questions = parseJsonRobust(response, 'array') as ExtractedQuestion[];
      console.log('CHECKPOINT PASSED: Successfully parsed JSON response');

      // Checkpoint: Validate questions structure
      if (!Array.isArray(questions) || questions.length === 0) {
        console.error('CHECKPOINT FAILED: Invalid questions array', { questions });
        throw new Error('Invalid questions array returned');
      }

      console.log('CHECKPOINT PASSED: Valid questions array', { count: questions.length });

      // Checkpoint: Validate each question has required fields
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!q.question_statement || !q.question_type || !q.answer) {
          console.error('CHECKPOINT FAILED: Question missing required fields', {
            questionIndex: i,
            hasStatement: !!q.question_statement,
            hasType: !!q.question_type,
            hasAnswer: !!q.answer
          });
          throw new Error('Question missing required fields (question_statement, question_type, or answer)');
        }

        // Validate options for MCQ/MSQ
        if ((q.question_type === 'MCQ' || q.question_type === 'MSQ') && (!q.options || q.options.length !== 4)) {
          console.error('CHECKPOINT FAILED: MCQ/MSQ must have exactly 4 options', {
            questionIndex: i,
            optionsCount: q.options?.length || 0
          });
          throw new Error(`${q.question_type} question must have exactly 4 options`);
        }
      }

      console.log('CHECKPOINT PASSED: All questions validated successfully');

    } catch (parseError) {
      console.error('CHECKPOINT FAILED: All JSON parsing strategies failed', parseError);
      throw new Error(`Failed to parse generated questions: ${parseError.message}`);
    }

    // Add topic_id to each question
    questions = questions.map(q => ({
      ...q,
      topic_id: topic.id
    }));

    console.log(`CHECKPOINT PASSED: Generated ${questions.length} ${questionType} questions for topic: ${topic.name}`);
    return questions;

  } catch (error) {
    console.error(`CHECKPOINT FAILED: Error generating questions for topic ${topic.name}:`, error);
    throw new Error(`Failed to generate questions: ${error.message}`);
  }
}

// Generate solutions for PYQs using Gemini
export async function generateSolutionsForPYQs(
  pyqs: any[],
  topicNotes: string = ''
): Promise<{ answer: string; solution: string }[]> {

  if (pyqs.length === 0) return [];

  const notesContext = topicNotes ?
    `\n\nTOPIC NOTES (Use these concepts and methods to solve):\n${topicNotes.slice(0, 2500)}` : '';

  const prompt = `You are an expert professor solving ${pyqs[0].topics?.name || 'academic'} questions with 100% accuracy.
${notesContext}

CRITICAL ACCURACY REQUIREMENTS:
1. Triple-check every calculation before finalizing
2. For MCQ: Verify each option thoroughly, only mark ONE as correct
3. For MSQ: Check all options, mark ALL correct ones (usually 2-3 options)
4. For NAT: Calculate the exact numerical value, verify with alternative method if possible
5. For Subjective: Provide comprehensive step-by-step answer
6. Use the concepts from Topic Notes when available
7. If unsure, recalculate using a different approach to verify
8. Your answer MUST be 100% correct - wrong answers are unacceptable

VERIFICATION PROCESS:
- Step 1: Read the question carefully and identify what's being asked
- Step 2: Solve using the most reliable method
- Step 3: Double-check your work with alternative approach or reverse calculation
- Step 4: Verify answer matches the question type requirements
- Step 5: Write clear solution explaining each step

Questions to solve:
${pyqs.map((q, i) => `
Question ${i+1}:
Statement: ${q.question_statement}
Type: ${q.question_type}
${q.options ? `Options:\n${q.options.map((opt, idx) => `  ${String.fromCharCode(65+idx)}. ${opt}`).join('\n')}` : ''}
`).join('\n')}

For each question provide:
- CORRECT answer (MCQ: 'A' or 'B' or 'C' or 'D', MSQ: 'A, C' format, NAT: exact numerical value, SUB: comprehensive answer)
- Step-by-step solution with clear explanations
- Verification that your answer is correct

ABSOLUTE JSON REQUIREMENTS (NON-NEGOTIABLE):
1. Return ONLY the JSON array - NOTHING before or after
2. NEVER use markdown code blocks (no \`\`\`json, no \`\`\`, no code fences)
3. NEVER include actual line breaks in string values (use spaces instead)
4. NEVER use control characters (\\n, \\r, \\t, etc.) inside strings
5. NEVER use smart quotes (""), always use straight quotes (")
6. NEVER use Unicode escape sequences (\\uXXXX)
7. NEVER use hex escapes (\\xXX) or octal escapes (\\nnn)
8. Keep solution text as ONE continuous line - use periods to separate steps
9. Start output directly with [ and end with ] - nothing else

CORRECT JSON FORMAT:
[{"answer":"A","solution":"Step 1. Calculate X. Step 2. Verify Y. Step 3. Conclude Z. Therefore answer is A."}]

INCORRECT (will cause errors):
\`\`\`json
[...]
\`\`\`

Remember: 100% accuracy required. Triple-check calculations. Output only pure JSON.`;

  try {
    const response = await callGeminiAPI(prompt, undefined, 0.1, 3000);
    
    // Parse JSON response using robust parser
    let solutions: { answer: string; solution: string }[] = [];
    try {
      solutions = parseJsonRobust(response, 'array') as { answer: string; solution: string }[];
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      throw new Error(`Failed to parse generated solutions: ${parseError.message}`);
    }

    console.log(`Generated solutions for ${solutions.length} PYQs`);
    return solutions;

  } catch (error) {
    console.error('Error generating PYQ solutions:', error);
    throw new Error(`Failed to generate solutions: ${error.message}`);
  }
}

// Comprehensive question validation using Gemini AI
export async function validateQuestionWithGeminiAI(question: any): Promise<{ isWrong: boolean; reason: string }> {
  const prompt = `You are an expert question validator. Analyze this question thoroughly and determine if it's WRONG or CORRECT based on these strict criteria:

Question Details:
- Statement: ${question.question_statement}
- Type: ${question.question_type}
- Options: ${question.options ? question.options.join(', ') : 'None'}
- Provided Answer: ${question.answer || 'None'}

VALIDATION RULES:

For MCQ (Single Correct):
- WRONG if: No options are correct, multiple options are correct, or provided answer doesn't match any correct option
- CORRECT if: Exactly one option is correct and matches the provided answer

For MSQ (Multiple Correct):
- WRONG if: No options are correct, or provided answer doesn't include all correct options
- CORRECT if: One or more options are correct and provided answer matches all correct options

For NAT (Numerical Answer):
- WRONG if: Answer is not numerical, question is unsolvable, or provided answer is mathematically incorrect
- CORRECT if: Question is solvable and provided answer is mathematically correct

For Subjective:
- Always CORRECT (no validation needed)

ANALYSIS PROCESS:
1. Solve the question independently
2. Check if provided answer matches your solution
3. For MCQ/MSQ: Verify each option's correctness
4. For NAT: Verify numerical accuracy

CRITICAL JSON OUTPUT REQUIREMENTS:
1. Return ONLY the JSON object - no text before or after
2. Do NOT use markdown code blocks (no \`\`\`json or \`\`\`)
3. Do NOT include line breaks in strings - keep all text single-line
4. Use simple ASCII quotes only

JSON FORMAT (all text must be single-line):
{
  "isWrong": true,
  "reason": "Single line explanation without line breaks",
  "correctAnswer": "Correct answer if applicable"
}

Be extremely thorough and accurate in your analysis.`;

  try {
    const response = await callGeminiAPI(prompt, undefined, 0.1, 2000);
    
    // Parse JSON response using robust parser
    let validation: { isWrong: boolean; reason: string; correctAnswer?: string };
    try {
      validation = parseJsonRobust(response, 'object') as { isWrong: boolean; reason: string; correctAnswer?: string };
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      // Fallback: assume question is correct if parsing fails
      return { isWrong: false, reason: 'Validation parsing failed - marked as correct by default' };
    }

    console.log(`Question validation result: ${validation.isWrong ? 'WRONG' : 'CORRECT'} - ${validation.reason}`);
    return validation;

  } catch (error) {
    console.error('Error validating question:', error);
    // Fallback: assume question is correct if validation fails
    return { isWrong: false, reason: `Validation failed: ${error.message} - marked as correct by default` };
  }
}

// Simple client-side validation (kept for backward compatibility)
export function validateQuestionAnswer(question: ExtractedQuestion): { isValid: boolean; reason: string } {
  if (!question.question_statement || question.question_statement.trim().length === 0) {
    return { isValid: false, reason: 'Empty question statement' };
  }

  if (!question.question_type || !['MCQ', 'MSQ', 'NAT', 'Subjective'].includes(question.question_type)) {
    return { isValid: false, reason: 'Invalid question type' };
  }

  // For MCQ and MSQ, options are required
  if ((question.question_type === 'MCQ' || question.question_type === 'MSQ') && 
      (!question.options || question.options.length === 0)) {
    return { isValid: false, reason: 'MCQ/MSQ questions require options' };
  }

  // Basic validation passed
  return { isValid: true, reason: 'Question passes basic validation' };
}

// Export the API key management functions for external use
export { getNextGeminiKey, callGeminiAPI };