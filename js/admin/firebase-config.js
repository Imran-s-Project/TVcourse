// ==========================================================================
// Firebase কনফিগারেশন
// নিচে আপনার Firebase প্রজেক্টের config বসান
// (Firebase Console → Project settings → General → Your apps → SDK config)
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

// For Firebase JS SDK v7.20.0 and later, measurementId
const firebaseConfig = {
  apiKey: "AIzaSyA7Bzpu_RPI8wqIkSqjmh4aXFK_ARXC88g",
  authDomain: "tv-course.firebaseapp.com",
  projectId: "tv-course",
  storageBucket: "tv-course.firebasestorage.app",
  messagingSenderId: "394638935623",
  appId: "1:394638935623:web:af274fe9001abfa9771362",
  measurementId: "G-VF48BD7CFS"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ── Firestore অফলাইন পার্সিস্টেন্স ──────────────────────────────────────
// একবার অনলাইনে লোড হওয়া ডেটা IndexedDB-তে সেভ হয়ে যাবে।
// পরেরবার নেট না থাকলেও সেই ডেটা দেখা যাবে।
// "failed-precondition" → একাধিক tab খোলা (শুধু একটায় কাজ করে, সমস্যা নেই)
// "unimplemented"       → ব্রাউজার IndexedDB সাপোর্ট করে না (খুবই বিরল)
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Firestore offline: একাধিক ট্যাব খোলা, শুধু একটায় অফলাইন ক্যাশ কাজ করবে।");
  } else if (err.code === "unimplemented") {
    console.warn("Firestore offline: এই ব্রাউজার IndexedDB সাপোর্ট করে না।");
  }
});
