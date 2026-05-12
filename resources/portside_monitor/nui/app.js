const warning = document.getElementById('warning');
const reason = document.getElementById('reason');
const author = document.getElementById('author');
const acknowledge = document.getElementById('acknowledge');

let activeActionId = null;

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'warning' && data.warning) {
    activeActionId = data.warning.actionId;
    reason.textContent = data.warning.reason || 'No reason provided';
    author.textContent = `Issued by ${data.warning.author || 'Portside'}`;
    warning.classList.remove('hidden');
    return;
  }

  if (data.type === 'hideWarning') {
    warning.classList.add('hidden');
    activeActionId = null;
  }
});

acknowledge.addEventListener('click', () => {
  fetch(`https://${GetParentResourceName()}/ackWarning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionId: activeActionId }),
  });
});
