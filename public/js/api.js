const API = {
  async req(method, url, data) {
    const opts = { method, headers: {} };
    if (data instanceof FormData) {
      opts.body = data;
    } else if (data) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(data);
    }
    const res = await fetch(url, opts);
    return res.json();
  },
  get: (url) => API.req('GET', url),
  post: (url, data) => API.req('POST', url, data),
  put: (url, data) => API.req('PUT', url, data),
  delete: (url) => API.req('DELETE', url),

  toast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast-msg toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
  },

  async checkAuth(role) {
    const res = await API.get('/api/auth/me');
    if (!res.ok) { window.location.href = '/consumer/login.html'; return null; }
    if (role && res.user.role !== role) { window.location.href = role === 'admin' ? '/admin/login.html' : '/consumer/index.html'; return null; }
    return res.user;
  },

  currency(n) { return '₹' + parseFloat(n||0).toFixed(2); }
};
