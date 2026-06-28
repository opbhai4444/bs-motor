// BS Motors — Firebase Configuration (Spare Links project)
const firebaseConfig = {
  apiKey:            "AIzaSyBlLtrJ_Kmvzcj4LFA66dIJ4t0ROTYloQA",
  authDomain:        "spare-links.firebaseapp.com",
  projectId:         "spare-links",
  storageBucket:     "spare-links.firebasestorage.app",
  messagingSenderId: "1069383639421",
  appId:             "1:1069383639421:web:dda5a328711ebe9d6b2c14",
  measurementId:     "G-9SC2PKHL7Y"
};

(function () {
  if (firebaseConfig.apiKey.startsWith('REPLACE')) {
    console.warn('[BS Motors] Firebase not configured.');
    window._firebaseReady = false;
    return;
  }
  try {
    firebase.initializeApp(firebaseConfig);
    window._firebaseReady = true;
  } catch (e) {
    if (e.code !== 'app/duplicate-app') console.error('[Firebase init]', e);
    window._firebaseReady = true;
  }
})();
