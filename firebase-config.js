// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBRrEogwpZm02d7rKFkJJQditxD6Q24JbU",
  authDomain: "refscard.firebaseapp.com",
  projectId: "refscard",
  storageBucket: "refscard.firebasestorage.app",
  messagingSenderId: "679046308034",
  appId: "1:679046308034:web:47db91f2f69c671ef41b5b",
  measurementId: "G-1S25XMWZFG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
