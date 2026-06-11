// ─── Config ────────────────────────────────────────────────────
const WORKER_URL = 'https://mailcraft-proxy.nonbhh8.workers.dev';
const FREE_LIMIT = 5;

// ─── State ─────────────────────────────────────────────────────
let selectedTone = 'Professional';

// ─── Stripe Return ─────────────────────────────────────────────
function handleStripeReturnNotice() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('checkout') === 'success') {
    showToast('Payment received. Pro will activate after Stripe confirms it. Refresh in a few seconds.');
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  }

  if (params.get('checkout') === 'cancelled') {
    showToast('Checkout cancelled. You can upgrade anytime.');
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  }
}

window.addEventListener('load', handleStripeReturnNotice);

// ─── Paywall ───────────────────────────────────────────────────
function showPaywall() {
  if (window._userData?.isPro) return;

  const overlay = document.getElementById('paywall-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function closePaywall() {
  const overlay = document.getElementById('paywall-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function goToStripe() {
  if (!window._currentUser) {
    showToast('Please sign in before upgrading.');
    return;
  }

  try {
    showToast('Opening secure Stripe checkout...');

    const response = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_checkout_session',
        uid: window._currentUser.uid,
        email: window._currentUser.email,
        success_url: `${window.location.origin}${window.location.pathname}?checkout=success`,
        cancel_url: `${window.location.origin}${window.location.pathname}?checkout=cancelled`,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.url) {
      throw new Error(data.error || 'Could not start checkout');
    }

    window.location.href = data.url;
  } catch (err) {
    console.error('Stripe checkout failed:', err);
    showToast('Could not open checkout. Please try again.');
  }
}

function updateUsageBadgeToPro() {
  const badge = document.getElementById('usage-badge');
  if (!badge) return;

  badge.textContent = 'Pro plan';
  badge.classList.add('pro');
  badge.classList.remove('low');
}

window.closePaywall = closePaywall;
window.goToStripe = goToStripe;

// ─── Tone selector ─────────────────────────────────────────────
document.querySelectorAll('.tone-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tone-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedTone = btn.dataset.tone;
  });
});

// ─── Char counter ──────────────────────────────────────────────
const productDescEl = document.getElementById('product-desc');
const charNumEl = document.getElementById('char-num');

productDescEl?.addEventListener('input', () => {
  const len = productDescEl.value.length;
  if (len > 300) productDescEl.value = productDescEl.value.slice(0, 300);
  charNumEl.textContent = Math.min(len, 300);
});

// ─── Helpers ───────────────────────────────────────────────────
function getFormValues() {
  return {
    prospectName: document.getElementById('prospect-name').value.trim(),
    prospectTitle: document.getElementById('prospect-title').value.trim(),
    companyName: document.getElementById('company-name').value.trim(),
    companyDesc: document.getElementById('company-desc').value.trim(),
    personalizationTrigger: document.getElementById('personalization-trigger')?.value.trim() || '',
    emailGoal: document.getElementById('email-goal')?.value || 'Book a 15-minute call',
    emailLength: document.getElementById('email-length')?.value || 'Short, under 130 words',
    ctaStyle: document.getElementById('cta-style')?.value || 'soft and low-pressure',
    extraContext: document.getElementById('extra-context')?.value.trim() || '',
    senderName: document.getElementById('sender-name').value.trim(),
    productDesc: productDescEl.value.trim(),
    keyBenefit: document.getElementById('key-benefit').value.trim(),
    errorEl: document.getElementById('error-msg')
  };
}

function validateRequiredFields(values) {
  values.errorEl.textContent = '';

  if (!values.prospectName || !values.companyName || !values.senderName || !values.productDesc) {
    values.errorEl.textContent = 'Please fill in the required fields (marked with *)';
    return false;
  }

  return true;
}

async function enforceUsageLimit() {
  const allowed = await window.checkUsageLimit?.();

  if (allowed === false && !window._userData?.isPro) {
    showPaywall();
    return false;
  }

  return true;
}

function setLoading(isLoading, loadingText = 'Generating...') {
  const btn = document.getElementById('generate-btn');
  const btnText = document.getElementById('btn-text');
  const btnLoading = document.getElementById('btn-loading');
  const sequenceBtn = document.getElementById('sequence-btn');
  const placeholder = document.getElementById('output-placeholder');
  const outputContent = document.getElementById('output-content');

  if (btn) btn.disabled = isLoading;
  if (sequenceBtn) sequenceBtn.disabled = isLoading;
  if (btnText) btnText.style.display = isLoading ? 'none' : 'inline';
  if (btnLoading) {
    btnLoading.textContent = loadingText;
    btnLoading.style.display = isLoading ? 'inline' : 'none';
  }

  if (isLoading) {
    if (outputContent) outputContent.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
  }
}

function showOutput(subject, body) {
  const placeholder = document.getElementById('output-placeholder');
  const outputContent = document.getElementById('output-content');
  const subjectEl = document.getElementById('email-subject');
  const bodyEl = document.getElementById('email-body');

  subjectEl.textContent = subject || '';
  bodyEl.textContent = body || '';
  updateQualityPanel(subject || '', body || '');
  renderSubjectVariants(subject || '');

  if (placeholder) placeholder.style.display = 'none';
  if (outputContent) outputContent.style.display = 'block';

  if (window.innerWidth <= 800) {
    document.getElementById('output-panel').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
}

function extractJson(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      return JSON.parse(clean.slice(first, last + 1));
    }
    throw new Error('AI response was not valid JSON');
  }
}

function validateEmailResponse(parsed) {
  if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
    throw new Error('AI response missing subject/body');
  }
  return parsed;
}

function validateSequenceResponse(parsed) {
  if (!parsed || !Array.isArray(parsed.sequence) || parsed.sequence.length !== 4) {
    throw new Error('AI response missing 4-email sequence');
  }

  parsed.sequence.forEach(email => {
    if (typeof email.subject !== 'string' || typeof email.body !== 'string') {
      throw new Error('Sequence email missing subject/body');
    }
  });

  return parsed;
}

async function callAI(prompt, maxTokens = 1200, validator = null) {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) throw new Error(`Error ${response.status}`);

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      const parsed = extractJson(text);
      return validator ? validator(parsed) : parsed;
    } catch (err) {
      lastError = err;
      console.warn(`AI attempt ${attempt} failed:`, err);
    }
  }

  throw lastError;
}

async function recordSuccessfulGeneration(subject, body, values, type = 'email') {
  const newCount = await window.incrementUsageInDB?.();

  await window.saveEmailToHistory?.(
    subject,
    body,
    values.prospectName,
    values.companyName,
    type === 'sequence' ? 'Sequence' : selectedTone
  );

  if (window._userData && !window._userData.isPro) {
    if (newCount === 3) {
      showToast(`${FREE_LIMIT - newCount} free emails left — upgrade for unlimited ✦`);
    }

    if (newCount >= FREE_LIMIT) {
      setTimeout(showPaywall, 800);
    }
  }
}

// ─── Generate Email ────────────────────────────────────────────
async function generateEmail() {
  const values = getFormValues();

  if (!validateRequiredFields(values)) return;
  if (!(await enforceUsageLimit())) return;

  setLoading(true, 'Generating...');

  const prompt = `Write a cold sales email with the following details:

Prospect: ${values.prospectName}${values.prospectTitle ? ', ' + values.prospectTitle : ''}
Company: ${values.companyName}${values.companyDesc ? ' — ' + values.companyDesc : ''}
${values.personalizationTrigger ? 'Personalization trigger: ' + values.personalizationTrigger : ''}
Sender: ${values.senderName}
Product/Service: ${values.productDesc}
${values.keyBenefit ? 'Key benefit: ' + values.keyBenefit : ''}
${values.extraContext ? 'Extra context: ' + values.extraContext : ''}
Tone: ${selectedTone}
Email goal: ${values.emailGoal}
Desired length: ${values.emailLength}
CTA style: ${values.ctaStyle}

Requirements:
- Follow the desired length exactly
- One clear CTA at the end aligned with the email goal
- Do NOT use clichés like "I hope this email finds you well"
- Make it feel human and personal, not templated
- Naturally use the personalization trigger if provided
- Reference the company or prospect's role naturally

Respond ONLY with valid JSON, no markdown, no extra text:
{"subject": "subject line here", "body": "email body here with \\n for line breaks"}`;

  try {
    const parsed = await callAI(prompt, 1200, validateEmailResponse);

    showOutput(parsed.subject, parsed.body);

    await recordSuccessfulGeneration(
      parsed.subject,
      parsed.body,
      values,
      'email'
    );

  } catch (err) {
    console.error(err);
    values.errorEl.textContent = 'Something went wrong. Please try again.';
    document.getElementById('output-placeholder').style.display = 'flex';
  } finally {
    setLoading(false);
  }
}

window.generateEmail = generateEmail;

// ─── Generate Follow-Up Sequence ───────────────────────────────
async function generateSequence() {
  const values = getFormValues();

  if (!validateRequiredFields(values)) return;
  if (!(await enforceUsageLimit())) return;

  setLoading(true, 'Generating sequence...');

  const prompt = `Create a 4-email cold outreach sequence.

Prospect: ${values.prospectName}${values.prospectTitle ? ', ' + values.prospectTitle : ''}
Company: ${values.companyName}${values.companyDesc ? ' — ' + values.companyDesc : ''}
${values.personalizationTrigger ? 'Personalization trigger: ' + values.personalizationTrigger : ''}
Sender: ${values.senderName}
Product/Service: ${values.productDesc}
${values.keyBenefit ? 'Key benefit: ' + values.keyBenefit : ''}
${values.extraContext ? 'Extra context: ' + values.extraContext : ''}
Tone: ${selectedTone}
Email goal: ${values.emailGoal}
Desired length: ${values.emailLength}
CTA style: ${values.ctaStyle}

Create:
1. Initial cold email
2. Follow-up after 3 days
3. Value-add follow-up after 7 days
4. Breakup email after 10 days

Rules:
- Each email under 120 words
- No clichés
- Human tone
- Clear CTA
- Make every follow-up different
- Naturally use the personalization trigger if provided
- Respond only in valid JSON, no markdown

Format:
{
  "sequence": [
    { "day": 1, "subject": "...", "body": "..." },
    { "day": 3, "subject": "...", "body": "..." },
    { "day": 7, "subject": "...", "body": "..." },
    { "day": 10, "subject": "...", "body": "..." }
  ]
}`;

  try {
    const parsed = await callAI(prompt, 2500, validateSequenceResponse);

    const sequenceText = parsed.sequence.map(email => {
      return `Day ${email.day}\nSubject: ${email.subject}\n\n${email.body}`;
    }).join('\n\n────────────────────\n\n');

    showOutput('4-Email Outreach Sequence', sequenceText);

    await recordSuccessfulGeneration(
      '4-Email Outreach Sequence',
      sequenceText,
      values,
      'sequence'
    );

    showToast('✓ Follow-up sequence generated!');

  } catch (err) {
    console.error(err);
    values.errorEl.textContent = 'Could not generate sequence. Please try again.';
    document.getElementById('output-placeholder').style.display = 'flex';
  } finally {
    setLoading(false);
  }
}

window.generateSequence = generateSequence;

// ─── Copy Email ────────────────────────────────────────────────
function copyEmail() {
  const subject = document.getElementById('email-subject').innerText.trim();
  const body = document.getElementById('email-body').innerText.trim();

  navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
    .then(() => showToast('✓ Copied to clipboard!'))
    .catch(() => alert('Could not copy — please copy manually.'));
}

window.copyEmail = copyEmail;

// ─── Toast ─────────────────────────────────────────────────────
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add('show');

  setTimeout(() => toast.classList.remove('show'), 4000);
}

window.showToast = showToast;

// ─── Enter key ─────────────────────────────────────────────────
document.querySelectorAll('input').forEach(input => {
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') generateEmail();
  });
});
function updateQualityPanel(subject, body) {
  const words = body.trim().split(/\s+/).length;
  const wordEl = document.getElementById('word-count');
  const subjectEl = document.getElementById('subject-score');
  const spamEl = document.getElementById('spam-score');
  if (wordEl) wordEl.textContent = `${words} words`;
  if (subjectEl) subjectEl.textContent = subject.length < 60 ? 'Subject ready' : 'Subject too long';
  if (spamEl) spamEl.textContent = 'Clean copy';
}

function fillSampleLead() {
  document.getElementById('prospect-name').value = 'Sarah Johnson';
  document.getElementById('prospect-title').value = 'Head of Marketing';
  document.getElementById('company-name').value = 'Acme Corp';
  document.getElementById('company-desc').value = 'a B2B SaaS startup scaling in Southeast Asia';
  document.getElementById('personalization-trigger').value = 'just expanded into APAC market';
  document.getElementById('sender-name').value = 'Alex from GrowthFlow';
  document.getElementById('product-desc').value = 'an AI tool that automates lead qualification and reduces SDR workload by 60%';
  document.getElementById('key-benefit').value = 'Cut outreach time by 70% without sacrificing personalization';
}

function saveSenderProfile() {
  const profile = {
    senderName: document.getElementById('sender-name').value,
    productDesc: document.getElementById('product-desc').value,
    keyBenefit: document.getElementById('key-benefit').value,
  };
  localStorage.setItem('senderProfile', JSON.stringify(profile));
  showToast('Profile saved!');
}

function loadSenderProfile() {
  const profile = JSON.parse(localStorage.getItem('senderProfile') || '{}');
  if (profile.senderName) document.getElementById('sender-name').value = profile.senderName;
  if (profile.productDesc) document.getElementById('product-desc').value = profile.productDesc;
  if (profile.keyBenefit) document.getElementById('key-benefit').value = profile.keyBenefit;
  showToast('Profile loaded!');
}

function clearGeneratorForm() {
  document.getElementById('prospect-name').value = '';
  document.getElementById('prospect-title').value = '';
  document.getElementById('company-name').value = '';
  document.getElementById('company-desc').value = '';
  document.getElementById('personalization-trigger').value = '';
  document.getElementById('sender-name').value = '';
  document.getElementById('product-desc').value = '';
  document.getElementById('key-benefit').value = '';
  showToast('Form cleared!');
}

function copySubjectOnly() {
  const subject = document.getElementById('email-subject').innerText.trim();
  navigator.clipboard.writeText(subject).then(() => showToast('Subject copied!'));
}

function downloadEmailTxt() {
  const subject = document.getElementById('email-subject').innerText.trim();
  const body = document.getElementById('email-body').innerText.trim();
  const blob = new Blob([`Subject: ${subject}\n\n${body}`], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'email.txt';
  a.click();
}

function saveLocalDraft() {
  const subject = document.getElementById('email-subject').innerText.trim();
  const body = document.getElementById('email-body').innerText.trim();
  localStorage.setItem('localDraft', JSON.stringify({ subject, body }));
  showToast('Draft saved locally!');
}

function renderSubjectVariants(subject) {
  const container = document.getElementById('subject-variants');
  if (!container) return;
  container.innerHTML = '';
}

function importLeadCsv(event) {
  showToast('CSV import coming soon!');
}

function loadNextLead() {
  showToast('No leads in queue.');
}

function filterHistoryCards() {
  const query = document.getElementById('history-search').value.toLowerCase();
  document.querySelectorAll('.history-card').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(query) ? '' : 'none';
  });
}

function exportHistoryCsv() {
  showToast('Export coming soon!');
}