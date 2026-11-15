// ============================================================================
//  EDIT THIS FILE to rebrand the app and connect it to your Firebase project.
//  Nothing in this file is secret: Firebase web config is public by design.
//  Real protection comes from the database rules (firebase/database.rules.json).
// ============================================================================

export const APP = {
  name: 'ShaadiWish',
  tagline: 'Your Dreams, Their Blessings.',
  // Brand colours (override the CSS variables in css/style.css). Leave {} to keep the defaults.
  colors: {},
  // People sign in with mobile number + password. Behind the scenes Firebase needs an
  // email address, so the mobile number is joined to this made-up domain. It never
  // receives mail. Choose it once and do not change it after creating accounts.
  loginDomain: 'login.shaadiwish.app',
  // Firebase JavaScript SDK version loaded from Google's CDN.
  firebaseSdkVersion: '12.18.0',
  // Preview mode runs the whole app inside the browser with sample data.
  // It switches on automatically while the Firebase config below is not filled in.
  // Set to false once you are live, so "?preview" in a link can never show sample data.
  allowPreview: true,
};

// Firebase console -> Project settings -> Your apps -> Web app -> "Config".
export const firebaseConfig = {
  apiKey: 'AIzaSyCYd_yZuuAtZyA_cIvBVYsLTdXTRh0f2qE',
  authDomain: 'wedding-gift-ca42d.firebaseapp.com',
  databaseURL: 'https://wedding-gift-ca42d-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'wedding-gift-ca42d',
  messagingSenderId: '1020073289254',
  appId: '1:1020073289254:web:440cc37dfbf3ba930b28e7',
};
