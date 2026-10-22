const $ = (selector) => document.querySelector(selector);
const showNotice = (el, message, error = false) => {
  el.hidden = false;
  el.classList.toggle('error', error);
  el.textContent = message;
};
$('#year').textContent = new Date().getFullYear();

document.querySelectorAll('[data-loan]').forEach(link => link.addEventListener('click', () => {
  const select = document.querySelector('[name="loan_type"]');
  if (select) select.value = link.dataset.loan;
}));

$('#application-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = $('#application-result');
  result.hidden = true;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Submitting…';
  try {
    const response = await fetch('/api/applications', { method: 'POST', body: new FormData(form) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Application could not be submitted.');
    result.classList.remove('error');
    result.innerHTML = '';
    const heading = document.createElement('strong');
    heading.textContent = 'Application received';
    const ref = document.createElement('span');
    ref.className = 'ref';
    ref.textContent = data.reference_no;
    const p = document.createElement('p');
    p.textContent = 'Save this reference number. Use it with your registered mobile number to check your application status. This acknowledgement is not a loan approval.';
    result.append(heading, ref, p);
    result.hidden = false;
    form.reset();
    result.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    showNotice(result, error.message || 'Network error. Please try again.', true);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Submit application <span>→</span>';
  }
});

$('#status-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = $('#status-result');
  result.hidden = true;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const response = await fetch('/api/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not check status.');
    result.innerHTML = '';
    const title = document.createElement('strong');
    title.textContent = `${data.applicant_name} · ${data.reference_no}`;
    const status = document.createElement('p');
    status.textContent = `Status: ${data.status}`;
    const amount = document.createElement('p');
    amount.textContent = `Requested amount: ₹${Number(data.requested_amount).toLocaleString('en-IN')}`;
    result.append(title, status, amount);
    if (data.approved_amount !== null && data.approved_amount !== undefined) {
      const approved = document.createElement('p');
      approved.textContent = `Approved amount recorded: ₹${Number(data.approved_amount).toLocaleString('en-IN')}`;
      result.append(approved);
    }
    if (data.update_message) {
      const note = document.createElement('p');
      note.textContent = `Update: ${data.update_message}`;
      result.append(note);
    }
    result.classList.remove('error');
    result.hidden = false;
  } catch (error) {
    showNotice(result, error.message || 'Network error. Please try again.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Check status';
  }
});
