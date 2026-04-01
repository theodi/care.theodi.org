function showMessage(text, isError) {
  const el = document.getElementById('subscriptionsNewMessage');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = text;
  el.style.color = isError ? '#c00' : '';
}

function isoDateOnly(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toISOString().slice(0, 10);
}

function parseAdminEmailsField(text) {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('newSubscriptionForm');
  if (!form) return;

  const editIdEl = document.getElementById('subscriptionEditId');
  const editId = editIdEl && editIdEl.value.trim();
  const emailDomainInput = document.getElementById('sub-emailDomain');
  const initialAdminInput = document.getElementById('sub-initialAdminEmail');
  const adminEmailsTa = document.getElementById('sub-adminEmails');

  if (editId) {
    if (emailDomainInput) emailDomainInput.removeAttribute('required');
    if (initialAdminInput) initialAdminInput.removeAttribute('required');
    if (adminEmailsTa) adminEmailsTa.setAttribute('required', 'required');

    showMessage('Loading…', false);
    (async function loadEdit() {
      try {
        const res = await fetch(`/subscriptions/${encodeURIComponent(editId)}`, {
          headers: { Accept: 'application/json' },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || res.statusText);
        }
        const sub = data.subscription;
        if (!sub) throw new Error('Subscription not found');

        form.organisationName.value = sub.organisationName || '';
        form.planTier.value = sub.planTier || 'silver';
        form.seatLimit.value = sub.seatLimit;
        form.startDate.value = isoDateOnly(sub.startDate);
        form.endDate.value = isoDateOnly(sub.endDate);
        form.amount.value = sub.amount != null ? String(sub.amount) : '0';

        const domainDisp = document.getElementById('sub-emailDomainDisplay');
        if (domainDisp) domainDisp.textContent = sub.emailDomain || '';
        if (adminEmailsTa) adminEmailsTa.value = (sub.adminEmails || []).join('\n');

        const msgEl = document.getElementById('subscriptionsNewMessage');
        if (msgEl) {
          msgEl.style.display = 'none';
          msgEl.textContent = '';
          msgEl.style.color = '';
        }
      } catch (e) {
        showMessage(e.message || String(e), true);
      }
    })();
  }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();

    if (editId) {
      const adminEmails = parseAdminEmailsField(adminEmailsTa ? adminEmailsTa.value : '');
      if (adminEmails.length === 0) {
        showMessage('Add at least one admin email on the subscription domain.', true);
        return;
      }
      const body = {
        organisationName: form.organisationName.value.trim(),
        planTier: form.planTier.value,
        seatLimit: form.seatLimit.value,
        startDate: form.startDate.value,
        endDate: form.endDate.value,
        amount: form.amount.value,
        adminEmails,
      };
      showMessage('Saving…', false);
      try {
        const res = await fetch(`/subscriptions/${encodeURIComponent(editId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || res.statusText);
        }
        window.location.href = '/subscriptions';
      } catch (e) {
        showMessage(e.message || String(e), true);
      }
      return;
    }

    const body = {
      organisationName: form.organisationName.value.trim(),
      emailDomain: form.emailDomain.value.trim(),
      initialAdminEmail: form.initialAdminEmail.value.trim(),
      planTier: form.planTier.value,
      seatLimit: form.seatLimit.value,
      startDate: form.startDate.value,
      endDate: form.endDate.value,
      amount: form.amount.value,
    };
    showMessage('Saving…', false);
    try {
      const res = await fetch('/subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || res.statusText);
      }
      window.location.href = '/subscriptions';
    } catch (e) {
      showMessage(e.message || String(e), true);
    }
  });
});
