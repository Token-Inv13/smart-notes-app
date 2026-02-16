const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAssistantVoiceIntent } = require('../lib/assistant/voiceIntent.js');

test('parseAssistantVoiceIntent detects reminder intent with explicit time', () => {
  const now = new Date('2026-02-16T10:00:00.000Z');
  const parsed = parseAssistantVoiceIntent('Rappelle-moi de payer la facture demain à 18h30', now);

  assert.equal(parsed.kind, 'create_reminder');
  assert.equal(parsed.title, 'payer la facture demain à 18h30');
  assert.equal(parsed.requiresConfirmation, false);
  assert.equal(Array.isArray(parsed.missingFields) ? parsed.missingFields.length : 0, 0);
  assert.ok(parsed.remindAt instanceof Date);
  assert.equal(parsed.remindAt.getHours(), 18);
  assert.equal(parsed.remindAt.getMinutes(), 30);
});

test('parseAssistantVoiceIntent asks clarification when reminder has no hour', () => {
  const now = new Date('2026-02-16T10:00:00.000Z');
  const parsed = parseAssistantVoiceIntent("N'oublie pas de relancer Julien demain", now);

  assert.equal(parsed.kind, 'create_reminder');
  assert.equal(parsed.remindAt, null);
  assert.deepEqual(parsed.missingFields, ['time']);
  assert.ok(typeof parsed.clarificationQuestion === 'string' && parsed.clarificationQuestion.length > 0);
});

test('parseAssistantVoiceIntent routes short actionable text to todo', () => {
  const now = new Date('2026-02-16T10:00:00.000Z');
  const parsed = parseAssistantVoiceIntent('Acheter du lait', now);

  assert.equal(parsed.kind, 'create_todo');
  assert.equal(parsed.title, 'Acheter du lait');
  assert.equal(parsed.remindAt, null);
});

test('parseAssistantVoiceIntent routes planning context to task', () => {
  const now = new Date('2026-02-16T10:00:00.000Z');
  const parsed = parseAssistantVoiceIntent('Préparer le projet client pour demain', now);

  assert.equal(parsed.kind, 'create_task');
  assert.equal(parsed.title, 'Préparer le projet client pour demain');
});

test('parseAssistantVoiceIntent detects meeting intent and requires confirmation', () => {
  const now = new Date('2026-02-16T10:00:00.000Z');
  const parsed = parseAssistantVoiceIntent('Planifie une réunion produit ce soir', now);

  assert.equal(parsed.kind, 'schedule_meeting');
  assert.equal(parsed.requiresConfirmation, true);
  assert.equal(parsed.requiresConfirmationReason, 'Confirme pour créer la réunion.');
  assert.ok(parsed.remindAt instanceof Date);
});
