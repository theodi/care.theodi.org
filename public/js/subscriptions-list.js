function showSubscriptionsMessage(text, isError) {
  const el = document.getElementById('subscriptionsMessage');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = text;
  el.style.color = isError ? '#c00' : '';
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString();
}

async function loadSubscriptions() {
  const res = await fetch('/subscriptions', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || res.statusText);
  }
  const data = await res.json();
  return data.subscriptions || [];
}

function renderSubscriptionsTable(rows) {
  const tbody = document.getElementById('subscriptionsTableBody');
  tbody.innerHTML = '';
  rows.forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.organisationName)}<br/><small>id: ${escapeHtml(String(s.id))}</small></td>
      <td>${escapeHtml(s.emailDomain)}</td>
      <td>${escapeHtml(s.planTier)}</td>
      <td>${s.seatLimit}</td>
      <td>${formatDate(s.startDate)} – ${formatDate(s.endDate)}</td>
      <td>${s.status === 'active' ? 'Active' : 'Expired'}</td>
      <td>${escapeHtml((s.adminEmails || []).join(', ') || '—')}</td>
    `;
    tbody.appendChild(tr);
  });
  if ($.fn.DataTable && $.fn.DataTable.isDataTable('#subscriptionsTable')) {
    $('#subscriptionsTable').DataTable().destroy();
  }
  $('#subscriptionsTable').DataTable({ order: [[4, 'desc']] });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

document.addEventListener('DOMContentLoaded', function () {
  loadSubscriptions()
    .then((rows) => renderSubscriptionsTable(rows))
    .catch((e) => showSubscriptionsMessage(e.message || String(e), true));
});
