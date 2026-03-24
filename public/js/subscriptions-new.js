function showMessage(text, isError) {
  const el = document.getElementById('subscriptionsNewMessage');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = text;
  el.style.color = isError ? '#c00' : '';
}

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('newSubscriptionForm');
  if (!form) return;

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
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
