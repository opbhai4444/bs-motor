// Shared admin nav — all admin pages must call this
const AdminNav = {
  async init() {
    const res = await fetch('/api/auth/me').then(r => r.json()).catch(() => ({ ok: false }));
    if (!res.ok || res.user.role !== 'admin') {
      window.location.href = '/admin/login.html';
      return null;
    }
    const el = document.getElementById('adminName');
    if (el) el.textContent = res.user.name;
    document.querySelectorAll('#sidebar-logout').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/admin/login.html';
      });
    });
    return res.user;
  }
};
