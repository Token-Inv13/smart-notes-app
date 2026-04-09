import { test } from 'node:test';
import assert from 'node:assert';
import { 
  normalizeAssistantText, 
  sanitizeAssistantSnippet, 
  extractBundleTaskTitlesFromText,
  detectIntentsV1
} from '../src/services/ai.js';

test('normalizeAssistantText - should normalize accents and spaces', () => {
  const input = '  Céline   mange  une   pomme  ';
  const expected = 'celine mange une pomme';
  assert.strictEqual(normalizeAssistantText(input), expected);
});

test('sanitizeAssistantSnippet - should remove HTML and extra whitespace', () => {
  const input = '<div>Hello</div><script>alert(1)</script>  <br>World';
  const expected = 'Hello\nWorld';
  assert.strictEqual(sanitizeAssistantSnippet(input), expected);
});

test('extractBundleTaskTitlesFromText - should extract bullet points', () => {
  const input = 'Voici tes tâches:\n- Faire les courses\n* Acheter du pain\n3. Appeler Pierre';
  const results = extractBundleTaskTitlesFromText(input);
  assert.strictEqual(results.length, 3);
  assert.strictEqual(results[0].title, 'Faire les courses');
  assert.strictEqual(results[1].title, 'Acheter du pain');
  assert.strictEqual(results[2].title, 'Appeler Pierre');
});

test('detectIntentsV1 - should detect PAYER intent', () => {
  const now = new Date('2024-05-10T10:00:00Z');
  const params = {
    title: 'Facture EDF',
    content: 'Payer la facture edf demain',
    now
  };
  const intents = detectIntentsV1(params);
  assert.strictEqual(intents.length, 1);
  assert.strictEqual(intents[0].intent, 'PAYER');
  assert.strictEqual(intents[0].kind, 'create_task'); // No reminder keywords or specific time
});
