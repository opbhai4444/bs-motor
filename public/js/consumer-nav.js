const ConsumerNav = {
  _user: null,
  _loc: JSON.parse(localStorage.getItem('bsm_loc') || 'null'),
  _afterLogin: null,
  _authWatching: false,

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  async init() {
    this._inject();
    const res = await fetch('/api/auth/me').then(r => r.json()).catch(() => ({ ok: false }));
    this._user = (res.ok && res.user && res.user.role !== 'admin') ? res.user : null;
    this._renderHeader();

    if (this._user) {
      const items = await fetch('/api/consumer/cart').then(r => r.json()).catch(() => []);
      this._setCart(items.length || 0);
    }

    // Pull location from profile if logged in and none stored
    if (this._user && !this._loc && this._user.address) {
      this._loc = { formatted: this._user.address };
      localStorage.setItem('bsm_loc', JSON.stringify(this._loc));
    }
    this._renderLoc();

    // Silently restore Google session if no backend session active
    if (!this._user) {
      this._ensureFirebase().then(ready => { if (ready) this._watchAuthState(); });
    }

    this._loadNavCats();

    return this._user;
  },

  async _loadNavCats() {
    try {
      const f = await fetch('/api/consumer/filters').then(r => r.json());
      const icons = { bumpers:'🚗', lights:'💡', mirrors:'🪞', wipers:'🌧️', 'bumper brackets':'🔩', electrical:'⚡', 'engine parts':'⚙️', filters:'🔄', 'body parts':'🛠️', glass:'🔲', suspension:'🔃', brakes:'🛑', cooling:'❄️', exhaust:'💨', 'interior':'🪑' };
      const el = document.getElementById('bsmNavCats');
      if (!el) return;
      const urlCat = new URLSearchParams(location.search).get('category') || '';
      (f.categories || []).forEach(cat => {
        const a = document.createElement('a');
        a.href = `/consumer/index.html?category=${encodeURIComponent(cat)}`;
        a.textContent = (icons[cat.toLowerCase()] || '⚙️') + ' ' + cat;
        if (urlCat && urlCat.toLowerCase() === cat.toLowerCase()) a.classList.add('nav-active');
        el.appendChild(a);
      });
    } catch(e) {}
  },

  // ── Inject header + overlays ────────────────────────────────────────────────
  _inject() {
    const path   = window.location.pathname;
    const urlCat = new URLSearchParams(location.search).get('category') || '';
    const nav = (href, label, key) => {
      let active = false;
      if (key === 'index.html') {
        active = (path.endsWith('index.html') || path === '/consumer/' || path === '/consumer/index.html') && !urlCat;
      } else {
        active = path.endsWith(key);
      }
      return `<a href="${href}" class="${active ? 'nav-active' : ''}">${label}</a>`;
    };

    const root = document.createElement('div');
    root.id = 'bsm-root';
    root.innerHTML = `
<!-- ── HEADER ── -->
<header class="bsm-header">
  <div class="bsm-header-row">

    <div class="bsm-logo">
      <a href="/consumer/index.html">BS&nbsp;<span>Motors</span></a>
    </div>

    <button class="bsm-location" id="bsmLocBtn">
      <div class="loc-line1">Deliver to</div>
      <div class="loc-line2" id="bsmLocLabel">📍 No location set</div>
    </button>

    <div class="bsm-search">
      <input type="text" id="bsmSearchInput" placeholder="Search spare parts, brands, models…"
             autocomplete="off">
      <button id="bsmSearchBtn">🔍</button>
    </div>

    <button class="bsm-lang" id="bsmLangBtn">हिं&nbsp;/&nbsp;EN</button>

    <div style="position:relative">
      <button class="bsm-account" id="bsmAccBtn">
        <div class="acc-avatar" id="bsmAvatar">?</div>
        <div class="acc-text">
          <div class="acc-line1">Hello,&nbsp;<span id="bsmAccName">sign&nbsp;in</span></div>
          <div class="acc-line2">Account&nbsp;▾</div>
        </div>
      </button>
      <div class="acc-dropdown" id="bsmAccDrop" style="display:none">
        <div id="bsmAccDropAuth" style="display:none">
          <div class="acc-dd-name" id="bsmAccDropName"></div>
          <a href="/consumer/profile.html">My Profile</a>
          <a href="/consumer/orders.html">My Orders</a>
          <hr>
          <a href="#" id="bsmLogoutBtn">Sign Out</a>
        </div>
        <div id="bsmAccDropGuest">
          <a href="#" id="bsmSignInLink">Sign In</a>
          <a href="/consumer/register.html">Create Account</a>
        </div>
      </div>
    </div>

    <div class="bsm-cart">
      <a href="/consumer/cart.html">
        <span class="cart-emoji">🛒</span>
        <span id="bsmCartCnt" class="cart-cnt" style="display:none">0</span>
        <span style="font-size:.82rem;font-weight:700">Cart</span>
      </a>
    </div>

  </div>

  <nav class="bsm-nav-strip">
    <div class="bsm-nav-cats" id="bsmNavCats">
      ${nav('/consumer/index.html', '🔧 All Parts', 'index.html')}
    </div>
    <div class="bsm-nav-utils">
      <span class="nav-promo">✅ Genuine Parts &nbsp;·&nbsp; 🚚 Fast Dispatch</span>
      ${nav('/consumer/orders.html', '📋 My Orders', 'orders.html')}
      ${nav('/consumer/contact.html', '📞 Help', 'contact.html')}
    </div>
  </nav>
</header>

<!-- ── LOGIN OVERLAY ── -->
<div class="bsm-overlay" id="bsmLoginOv">
  <div class="bsm-panel" style="max-width:380px">
    <button class="bsm-panel-close" id="bsmLoginClose">✕</button>
    <div class="bsm-panel-logo">BS&nbsp;<span>Motors</span></div>
    <h3>Sign in to continue</h3>

    <button class="btn-google" id="bsmGoogleBtn">
      <span class="g-circle">G</span>
      Continue with Google
    </button>

    <div class="ov-or">or</div>

    <!-- Tab switcher -->
    <div class="login-tabs">
      <button class="login-tab active" id="bsmTabPhone" onclick="ConsumerNav._switchTab('phone')">📱 Phone OTP</button>
      <button class="login-tab" id="bsmTabEmail" onclick="ConsumerNav._switchTab('email')">✉ Email</button>
    </div>

    <!-- Phone tab -->
    <div id="bsmPhoneTab">
      <div id="bsmPhoneStage">
        <div class="phone-field" style="margin-top:.8rem">
          <input type="tel" id="bsmPhoneInput" placeholder="+91 98765 43210">
          <button id="bsmSendOtpBtn">Send OTP</button>
        </div>
      </div>
      <div id="bsmOtpStage" style="display:none">
        <div style="font-size:.78rem;color:#888;margin:.6rem 0 .5rem">OTP sent to <strong id="bsmOtpNum"></strong></div>
        <div id="bsmDevOtpBox" style="display:none;background:#fff8e1;border:2px solid #f4a261;border-radius:8px;padding:.6rem .9rem;margin-bottom:.7rem;text-align:center">
          <div style="font-size:.72rem;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Dev Mode — Your OTP</div>
          <div id="bsmDevOtpVal" style="font-size:2rem;font-weight:900;letter-spacing:.25em;color:#c44;font-family:monospace"></div>
        </div>
        <div id="recaptcha-container"></div>
        <div class="phone-field">
          <input type="text" id="bsmOtpInput" placeholder="6-digit OTP" maxlength="6">
          <button id="bsmVerifyBtn">Verify</button>
        </div>
        <a href="#" id="bsmChangeNum" style="font-size:.76rem;color:var(--secondary)">← Change number</a>
      </div>
    </div>

    <!-- Email tab -->
    <div id="bsmEmailTab" style="display:none;margin-top:.8rem">
      <div class="phone-field" style="flex-direction:column;gap:.5rem">
        <input type="email" id="bsmEmailInput" placeholder="Email address" style="width:100%">
        <input type="password" id="bsmPassInput" placeholder="Password" style="width:100%">
        <button id="bsmEmailLoginBtn" style="width:100%">Sign In</button>
      </div>
      <div style="text-align:right;margin-top:.4rem">
        <a href="/consumer/register.html" style="font-size:.78rem;color:var(--secondary)">New here? Create account →</a>
      </div>
    </div>

    <div style="text-align:center;margin-top:1rem;font-size:.76rem;color:#bbb">
      Real SMS via Firebase &nbsp;·&nbsp; or use Email tab
    </div>
  </div>
</div>

<!-- ── ADDRESS OVERLAY ── -->
<div class="bsm-overlay stacked" id="bsmAddrOv">
  <div class="bsm-panel" style="max-width:420px">
    <button class="bsm-panel-close" id="bsmAddrClose">✕</button>
    <h3>📍 Delivery Location</h3>
    <div class="addr-grid">
      <input type="text" id="bsmAddrStreet" placeholder="Street / Area / Colony">
      <input type="text" id="bsmAddrCity"   placeholder="City">
      <div class="addr-row2">
        <input type="text" id="bsmAddrState"  placeholder="State">
        <input type="text" id="bsmAddrPin"    placeholder="PIN Code">
      </div>
    </div>
    <button class="btn-save-loc" id="bsmSaveLocBtn">Save Location</button>
  </div>
</div>
`;

    document.body.insertBefore(root, document.body.firstChild);

    // Remove old navbar if still present in the page HTML
    document.querySelectorAll('.bsm-navbar, .bsm-hero').forEach(el => el.remove());

    // ── Mobile bottom navigation bar ────────────────────────────────────────
    const bnav = document.createElement('nav');
    bnav.className = 'bsm-bottom-nav';
    const isHome    = path.includes('index') || path === '/consumer/' || path === '/consumer';
    const isCart    = path.includes('cart');
    const isOrders  = path.includes('orders');
    const isAccount = path.includes('profile') || path.includes('login') || path.includes('register');
    bnav.innerHTML = `
      <a href="/consumer/index.html" class="bnav-item ${isHome ? 'active' : ''}">
        <span class="bnav-icon">🏠</span><span>Home</span>
      </a>
      <a href="#" class="bnav-item" id="bnavSearch">
        <span class="bnav-icon">🔍</span><span>Search</span>
      </a>
      <a href="/consumer/cart.html" class="bnav-item ${isCart ? 'active' : ''}">
        <span class="bnav-icon" style="position:relative">🛒<span class="bnav-badge" id="bnavCartBadge">0</span></span>
        <span>Cart</span>
      </a>
      <a href="/consumer/orders.html" class="bnav-item ${isOrders ? 'active' : ''}">
        <span class="bnav-icon">📋</span><span>Orders</span>
      </a>
      <a href="#" class="bnav-item ${isAccount ? 'active' : ''}" id="bnavAccBtn">
        <span class="bnav-icon">👤</span><span>Account</span>
      </a>`;
    document.body.appendChild(bnav);
    document.getElementById('bnavSearch').onclick = e => {
      e.preventDefault();
      const inp = document.getElementById('bsmSearchInput');
      if (inp) { inp.focus(); inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    };
    document.getElementById('bnavAccBtn').onclick = e => {
      e.preventDefault();
      if (this._user) {
        document.getElementById('bsmAccDrop').style.display =
          document.getElementById('bsmAccDrop').style.display === 'none' ? 'block' : 'none';
      } else {
        this.openLogin();
      }
    };

    this._wire();
  },

  // ── Wire up events ──────────────────────────────────────────────────────────
  _wire() {
    // Location btn
    document.getElementById('bsmLocBtn').onclick = () => this._openAddrFlow();

    // Search
    const searchInput = document.getElementById('bsmSearchInput');
    document.getElementById('bsmSearchBtn').onclick = () => this._doSearch();
    searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') this._doSearch(); });

    // Populate search if we're on index
    if (typeof window._searchInput !== 'undefined') searchInput.value = window._searchInput || '';

    // Lang toggle
    document.getElementById('bsmLangBtn').onclick = () => {
      if (typeof I18n !== 'undefined') I18n.toggle();
    };

    // Account dropdown toggle
    document.getElementById('bsmAccBtn').onclick = e => {
      e.stopPropagation();
      const dd = document.getElementById('bsmAccDrop');
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    };
    document.addEventListener('click', () => {
      const dd = document.getElementById('bsmAccDrop');
      if (dd) dd.style.display = 'none';
    });

    // Sign-in link in dropdown
    document.getElementById('bsmSignInLink').onclick = e => {
      e.preventDefault();
      document.getElementById('bsmAccDrop').style.display = 'none';
      this.openLogin();
    };

    // Logout
    document.getElementById('bsmLogoutBtn').onclick = async e => {
      e.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST' });
      try { if (typeof firebase !== 'undefined' && firebase.auth) await firebase.auth().signOut(); } catch(_) {}
      localStorage.clear();
      sessionStorage.clear();
      location.reload();
    };

    // Login overlay
    document.getElementById('bsmLoginClose').onclick = () => this.closeLogin();
    document.getElementById('bsmLoginOv').onclick = e => { if (e.target === e.currentTarget) this.closeLogin(); };

    // Google sign-in
    document.getElementById('bsmGoogleBtn').onclick = () => this._googleSignIn();

    // Phone OTP (backend — no Firebase needed)
    document.getElementById('bsmSendOtpBtn').onclick = () => this._sendOTP();
    document.getElementById('bsmPhoneInput').addEventListener('keypress', e => { if (e.key === 'Enter') this._sendOTP(); });
    document.getElementById('bsmVerifyBtn').onclick = () => this._verifyOTP();
    document.getElementById('bsmOtpInput').addEventListener('keypress', e => { if (e.key === 'Enter') this._verifyOTP(); });
    document.getElementById('bsmChangeNum').onclick = e => { e.preventDefault(); this._resetOtp(); };

    // Email login
    document.getElementById('bsmEmailLoginBtn').onclick = () => this._emailLogin();
    document.getElementById('bsmPassInput').addEventListener('keypress', e => { if (e.key === 'Enter') this._emailLogin(); });

    // Address overlay
    document.getElementById('bsmAddrClose').onclick = () => this.closeAddr();
    document.getElementById('bsmAddrOv').onclick = e => { if (e.target === e.currentTarget) this.closeAddr(); };
    document.getElementById('bsmSaveLocBtn').onclick = () => this._saveAddr();
  },

  // ── Render state into header ────────────────────────────────────────────────
  _renderHeader() {
    const nameEl   = document.getElementById('bsmAccName');
    const avatarEl = document.getElementById('bsmAvatar');
    const authDiv  = document.getElementById('bsmAccDropAuth');
    const guestDiv = document.getElementById('bsmAccDropGuest');
    const nameDiv  = document.getElementById('bsmAccDropName');

    if (this._user) {
      const words    = this._user.name.trim().split(' ');
      const initials = words.map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const first    = words[0];
      if (nameEl)   nameEl.textContent  = first;
      if (avatarEl) { avatarEl.textContent = initials; avatarEl.style.background = 'var(--accent)'; }
      if (authDiv)  authDiv.style.display  = 'block';
      if (guestDiv) guestDiv.style.display = 'none';
      if (nameDiv)  nameDiv.textContent    = '👤 ' + this._user.name;
    } else {
      if (nameEl)   nameEl.textContent  = 'sign in';
      if (avatarEl) { avatarEl.textContent = '?'; avatarEl.style.background = '#8899aa'; }
      if (authDiv)  authDiv.style.display  = 'none';
      if (guestDiv) guestDiv.style.display = 'block';
    }
  },

  _renderLoc() {
    const el = document.getElementById('bsmLocLabel');
    if (!el) return;
    if (this._loc && (this._loc.city || this._loc.formatted)) {
      el.textContent = '📍 ' + (this._loc.city
        ? this._loc.city + (this._loc.pin ? ' ' + this._loc.pin : '')
        : this._loc.formatted.split(',').slice(0, 2).join(','));
    } else {
      el.textContent = '📍 No location set';
    }
  },

  _setCart(n) {
    const el = document.getElementById('bsmCartCnt');
    if (el) {
      if (n > 0) { el.textContent = n; el.style.display = 'flex'; }
      else el.style.display = 'none';
    }
    const badge = document.getElementById('bnavCartBadge');
    if (badge) {
      if (n > 0) { badge.textContent = n > 99 ? '99+' : n; badge.style.display = 'flex'; }
      else badge.style.display = 'none';
    }
  },

  // ── Search ──────────────────────────────────────────────────────────────────
  _doSearch() {
    const q = (document.getElementById('bsmSearchInput').value || '').trim();
    const path = window.location.pathname;
    if (path.includes('/consumer/index') || path === '/consumer/' || path === '/consumer') {
      // Already on index — sync to the page's own search input if present
      const pageInput = document.getElementById('searchInput');
      if (pageInput) { pageInput.value = q; }
      if (typeof loadParts === 'function') loadParts();
    } else {
      window.location.href = '/consumer/index.html?q=' + encodeURIComponent(q);
    }
  },

  // ── Location / Address ──────────────────────────────────────────────────────
  _openAddrFlow() {
    if (!this._user) {
      this._afterLogin = () => this._openAddr();
      this.openLogin();
    } else {
      this._openAddr();
    }
  },

  _openAddr() {
    const loc = this._loc || {};
    document.getElementById('bsmAddrStreet').value = loc.street  || '';
    document.getElementById('bsmAddrCity').value   = loc.city    || '';
    document.getElementById('bsmAddrState').value  = loc.state   || '';
    document.getElementById('bsmAddrPin').value    = loc.pin     || '';
    document.getElementById('bsmAddrOv').classList.add('open');
  },

  closeAddr() {
    document.getElementById('bsmAddrOv').classList.remove('open');
  },

  _saveAddr() {
    const loc = {
      street: document.getElementById('bsmAddrStreet').value.trim(),
      city:   document.getElementById('bsmAddrCity').value.trim(),
      state:  document.getElementById('bsmAddrState').value.trim(),
      pin:    document.getElementById('bsmAddrPin').value.trim()
    };
    if (!loc.city) {
      if (typeof API !== 'undefined') API.toast('City is required', 'warning');
      return;
    }
    this._loc = loc;
    localStorage.setItem('bsm_loc', JSON.stringify(loc));
    this._renderLoc();
    this.closeAddr();
    if (typeof API !== 'undefined') API.toast('Location saved!');

    if (this._user) {
      const full = [loc.street, loc.city, loc.state, loc.pin].filter(Boolean).join(', ');
      fetch('/api/consumer/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: full })
      }).catch(() => {});
    }
  },

  // ── Login overlay ────────────────────────────────────────────────────────────
  openLogin() {
    document.getElementById('bsmLoginOv').classList.add('open');
  },

  closeLogin() {
    document.getElementById('bsmLoginOv').classList.remove('open');
    this._resetOtp();
  },

  // ── Lazy-load Firebase SDK + config ─────────────────────────────────────────
  _fbLoadPromise: null,
  async _ensureFirebase() {
    if (window._firebaseReady === true) return true;
    if (window._firebaseReady === false) return false;

    if (!this._fbLoadPromise) {
      this._fbLoadPromise = (async () => {
        try {
          await Promise.all([
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js'
          ].map(src => new Promise((res, rej) => {
            if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
            const s = document.createElement('script'); s.src = src;
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          })));
          await new Promise((res, rej) => {
            if (document.querySelector('script[src="/js/firebase-config.js"]')) { res(); return; }
            const s = document.createElement('script'); s.src = '/js/firebase-config.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
        } catch(e) { /* script load failed — _firebaseReady stays undefined */ }
      })();
    }

    await this._fbLoadPromise;
    return window._firebaseReady === true;
  },

  // ── Auto-restore saved Google session ───────────────────────────────────────
  _watchAuthState() {
    if (this._authWatching) return;
    this._authWatching = true;
    firebase.auth().onAuthStateChanged(fbUser => {
      if (fbUser && !this._user) this._syncFirebase(fbUser, true);
    });
  },

  // ── Google sign-in (Firebase) ────────────────────────────────────────────────
  async _googleSignIn() {
    const ready = await this._ensureFirebase();
    if (!ready) {
      if (typeof API !== 'undefined') API.toast('Firebase not configured — fill in /js/firebase-config.js', 'error');
      return;
    }
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result   = await firebase.auth().signInWithPopup(provider);
      await this._syncFirebase(result.user);
    } catch(e) {
      if (typeof API !== 'undefined') API.toast(e.message || 'Google sign-in failed', 'error');
    }
  },

  // ── Login tab switcher ────────────────────────────────────────────────────────
  _switchTab(tab) {
    const isPhone = tab === 'phone';
    document.getElementById('bsmPhoneTab').style.display = isPhone ? 'block' : 'none';
    document.getElementById('bsmEmailTab').style.display = isPhone ? 'none'  : 'block';
    document.getElementById('bsmTabPhone').classList.toggle('active', isPhone);
    document.getElementById('bsmTabEmail').classList.toggle('active', !isPhone);
    if (!isPhone) document.getElementById('bsmEmailInput').focus();
    else          document.getElementById('bsmPhoneInput').focus();
  },

  // ── Phone OTP via Firebase (real SMS) ────────────────────────────────────────
  _rcVerifier: null,
  _confirmResult: null,
  _phoneNum: null,

  _normalizePhone(raw) {
    // Always extract last 10 digits and prepend +91
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10) return null;
    const ten = digits.slice(-10); // take last 10 regardless of country code prefix
    return '+91' + ten;
  },

  async _sendOTP() {
    const ready = await this._ensureFirebase();
    const raw   = (document.getElementById('bsmPhoneInput').value || '').trim();
    const phone = this._normalizePhone(raw);
    if (!phone) {
      if (typeof API !== 'undefined') API.toast('Enter a valid 10-digit number', 'warning'); return;
    }
    document.getElementById('bsmPhoneInput').value = phone;

    const btn = document.getElementById('bsmSendOtpBtn');
    btn.textContent = 'Sending…'; btn.disabled = true;

    if (ready) {
      try {
        // Bypass reCAPTCHA entirely — fake verifier, no RecaptchaVerifier object needed
        firebase.auth().settings.appVerificationDisabledForTesting = true;
        const bypassVerifier = { type: 'recaptcha', verify: () => Promise.resolve(''), _reset: () => {} };
        this._confirmResult = await firebase.auth().signInWithPhoneNumber(phone, bypassVerifier);
        this._phoneNum = phone;
        document.getElementById('bsmPhoneStage').style.display = 'none';
        document.getElementById('bsmOtpStage').style.display   = 'block';
        document.getElementById('bsmOtpNum').textContent       = phone;
        document.getElementById('bsmDevOtpBox').style.display  = 'none';
        document.getElementById('bsmOtpInput').focus();
        if (typeof API !== 'undefined') API.toast('OTP sent to your phone! 📱');
      } catch(e) {
        if (typeof API !== 'undefined') API.toast(e.message || 'Failed to send OTP', 'error');
      } finally {
        btn.textContent = 'Send OTP'; btn.disabled = false;
      }
    } else {
      if (typeof API !== 'undefined') API.toast('Firebase not available — use Email login', 'error');
      btn.textContent = 'Send OTP'; btn.disabled = false;
    }
  },

  async _verifyOTP() {
    const otp = (document.getElementById('bsmOtpInput').value || '').trim();
    if (!otp) { if (typeof API !== 'undefined') API.toast('Enter the OTP', 'warning'); return; }
    const btn = document.getElementById('bsmVerifyBtn');
    btn.textContent = 'Verifying…'; btn.disabled = true;
    try {
      if (this._confirmResult) {
        // Firebase verification
        const result = await this._confirmResult.confirm(otp);
        await this._syncFirebase(result.user);
      } else {
        // Backend verification (fallback)
        const res = await fetch('/api/auth/verify-otp', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: this._phoneNum, otp })
        }).then(r => r.json());
        if (res.ok) {
          this._user = res.user;
          this._renderHeader();
          this.closeLogin();
          if (typeof API !== 'undefined') API.toast('Welcome! 🎉');
          if (this._afterLogin) { this._afterLogin(); this._afterLogin = null; }
        } else {
          if (typeof API !== 'undefined') API.toast(res.message || 'Incorrect OTP', 'error');
        }
      }
    } catch(e) {
      if (typeof API !== 'undefined') API.toast('Incorrect OTP — try again', 'error');
    } finally {
      btn.textContent = 'Verify'; btn.disabled = false;
    }
  },

  _resetOtp() {
    document.getElementById('bsmPhoneStage').style.display = 'block';
    document.getElementById('bsmOtpStage').style.display   = 'none';
    const pi = document.getElementById('bsmPhoneInput');
    const oi = document.getElementById('bsmOtpInput');
    if (pi) pi.value = '';
    if (oi) oi.value = '';
    this._phoneNum = null;
    this._confirmResult = null;
    if (this._rcVerifier) { this._rcVerifier.clear(); this._rcVerifier = null; }
    const devBox = document.getElementById('bsmDevOtpBox');
    if (devBox) devBox.style.display = 'none';
  },

  // ── Email / password login ────────────────────────────────────────────────────
  async _emailLogin() {
    const email    = (document.getElementById('bsmEmailInput').value || '').trim();
    const password = (document.getElementById('bsmPassInput').value  || '');
    if (!email || !password) {
      if (typeof API !== 'undefined') API.toast('Enter email and password', 'warning'); return;
    }
    const btn = document.getElementById('bsmEmailLoginBtn');
    btn.textContent = 'Signing in…'; btn.disabled = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      }).then(r => r.json());

      if (res.ok) {
        const me = await fetch('/api/auth/me').then(r => r.json());
        this._user = me.user;
        this._renderHeader();
        this.closeLogin();
        if (typeof API !== 'undefined') API.toast('Welcome back! 👋');
        if (this._afterLogin) { this._afterLogin(); this._afterLogin = null; }
      } else {
        if (typeof API !== 'undefined') API.toast(res.message || 'Invalid credentials', 'error');
      }
    } catch(e) {
      if (typeof API !== 'undefined') API.toast('Network error', 'error');
    } finally {
      btn.textContent = 'Sign In'; btn.disabled = false;
    }
  },

  // After Firebase auth → create/open backend session ─────────────────────────
  async _syncFirebase(fbUser, silent = false) {
    const res = await fetch('/api/auth/firebase-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:  fbUser.displayName || fbUser.phoneNumber || 'User',
        email: fbUser.email       || null,
        phone: fbUser.phoneNumber || null
      })
    }).then(r => r.json());

    if (res.ok) {
      this._user = res.user;
      this._renderHeader();
      this.closeLogin();
      if (!silent && typeof API !== 'undefined') API.toast('Welcome, ' + res.user.name + '! 🎉');
      if (this._afterLogin) { this._afterLogin(); this._afterLogin = null; }
    } else {
      if (!silent && typeof API !== 'undefined') API.toast(res.message || 'Login failed', 'error');
    }
  },

  // ── For protected pages ──────────────────────────────────────────────────────
  requireLogin() {
    return fetch('/api/auth/me').then(r => r.json()).then(res => {
      if (!res.ok || res.user.role === 'admin') {
        window.location.href = '/consumer/login.html?next=' + encodeURIComponent(window.location.pathname);
        return null;
      }
      return res.user;
    });
  }
};
