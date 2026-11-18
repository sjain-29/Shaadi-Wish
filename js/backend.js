// The one place pages talk to data. Two interchangeable implementations:
//   live    -> your Firebase project (free plan: Authentication + Realtime Database)
//   preview -> sample data kept in this browser, for trying the app before setup
// Every page uses only: call, watch, get, session, login, changePassword, signOut.
import { APP, firebaseConfig } from './app-config.js';

const configured = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PASTE');
const asked = new URLSearchParams(location.search).has('preview');
export const mode = !configured || (APP.allowPreview && asked) ? 'preview' : 'live';

const impl = await (mode === 'live' ? import('./backend-live.js') : import('./backend-preview.js'));
export const backend = impl.default;
